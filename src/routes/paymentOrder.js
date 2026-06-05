const express = require('express');
const router = express.Router();
const db = require('../config/database');

const SOURCE_TYPES = new Set(['warehouse', 'logistics', 'material_purchase', 'prop_repair', 'reimbursement']);
const SOURCE_TABLES = {
  warehouse: 'warehouse',
  logistics: 'logistics',
  material_purchase: 'material_purchases',
  prop_repair: 'prop_repairs',
  reimbursement: 'reimbursements',
};
const REIMB_DETAIL_META_MARKER = '[REIMB_DETAIL_JSON]';
const COST_MODULE_LABELS = {
  activity: '项目成本',
  warehouse: '仓储成本',
  logistics: '物流成本',
  prop_repair: '道具维修成本',
  material_purchase: '统筹成本',
  general: '内部成本',
};

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function normText(v) {
  return v == null ? '' : String(v).trim();
}

function visibleReimbursementRemarks(v) {
  const text = normText(v);
  const idx = text.indexOf(REIMB_DETAIL_META_MARKER);
  return idx >= 0 ? text.slice(0, idx).trim() : text;
}

function cleanDescription(v) {
  return visibleReimbursementRemarks(v).replace(/\s+/g, ' ').trim();
}

function dateOnly(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function candidateMatches(row, q) {
  const keyword = normText(q.keyword).toLowerCase();
  if (q.payee && normText(row.payee_name) !== normText(q.payee)) return false;
  if (q.brand && normText(row.brand) !== normText(q.brand)) return false;
  if (q.sourceType && row.source_type !== q.sourceType) return false;
  if (q.projectCode && !normText(row.project_code).includes(normText(q.projectCode))) return false;
  if (q.dateFrom && row.source_date && row.source_date < q.dateFrom) return false;
  if (q.dateTo && row.source_date && row.source_date > q.dateTo) return false;
  if (!keyword) return true;
  return [
    row.payee_name,
    row.brand,
    row.project_code,
    row.city,
    row.description,
    row.source_label,
    row.source_id,
  ].some((x) => normText(x).toLowerCase().includes(keyword));
}

function sortCandidates(rows) {
  return rows.sort((a, b) => {
    const ad = a.source_date || '';
    const bd = b.source_date || '';
    if (ad !== bd) return bd.localeCompare(ad);
    return String(a.source_type).localeCompare(String(b.source_type)) || Number(b.source_id) - Number(a.source_id);
  });
}

async function fetchCandidates(query, conn = db) {
  const yearFrameId = parseInt(query.yearFrameId, 10);
  const params = [];
  const yearWhere = Number.isFinite(yearFrameId) ? ' AND {alias}.year_frame_id = ?' : '';
  if (Number.isFinite(yearFrameId)) params.push(yearFrameId);

  const queries = [
    {
      type: 'warehouse',
      label: '仓储成本',
      sql: `
        SELECT w.id source_id, w.payee_name, COALESCE(w.payment_status, 'unpaid') payment_status,
               w.month source_date, w.brand, act.project_code project_code, NULL city,
               w.actual_cost amount,
               CONCAT('仓储 ', COALESCE(w.region, ''), ' ', COALESCE(w.wine_name, ''), ' ', COALESCE(w.remarks, '')) description
        FROM warehouse w
        LEFT JOIN activities act ON act.id = w.activity_id
        WHERE COALESCE(w.payment_status, 'unpaid') <> 'paid' AND COALESCE(w.actual_cost, 0) > 0
        ${yearWhere.replaceAll('{alias}', 'w')}
      `,
    },
    {
      type: 'logistics',
      label: '物流成本',
      sql: `
        SELECT l.id source_id, l.payee_name, COALESCE(l.payment_status, 'unpaid') payment_status,
               COALESCE(l.shipping_date, CONCAT(l.settlement_month, '-01')) source_date,
               l.brand, COALESCE(act.project_code, l.related_project_code) project_code, l.destination_city city,
               l.fee amount,
               CONCAT(COALESCE(l.logistics_company, ''), ' ', COALESCE(l.express_company, ''), ' ', COALESCE(l.tracking_number, ''), ' ', COALESCE(l.remarks, '')) description
        FROM logistics l
        LEFT JOIN activities act ON act.id = l.activity_id
        WHERE COALESCE(l.payment_status, 'unpaid') <> 'paid' AND COALESCE(l.fee, 0) > 0
        ${yearWhere.replaceAll('{alias}', 'l')}
      `,
    },
    {
      type: 'material_purchase',
      label: '物料采购',
      sql: `
        SELECT mp.id source_id, mp.payee_name, COALESCE(mp.payment_status, 'unpaid') payment_status,
               mp.purchase_date source_date, COALESCE(bi.brand_code, bi.brand_name) brand,
               act.project_code project_code, NULL city, mp.total_amount amount,
               CONCAT('物料采购 ', COALESCE(mp.remarks, '')) description
        FROM material_purchases mp
        LEFT JOIN brand_inventory bi ON bi.id = mp.brand_id
        LEFT JOIN activities act ON act.id = mp.activity_id
        WHERE COALESCE(mp.payment_status, 'unpaid') <> 'paid' AND COALESCE(mp.total_amount, 0) > 0
        ${yearWhere.replaceAll('{alias}', 'mp')}
      `,
    },
    {
      type: 'prop_repair',
      label: '道具维修',
      sql: `
        SELECT pr.id source_id, pr.payee_name, COALESCE(pr.payment_status, 'unpaid') payment_status,
               pr.repair_date source_date, COALESCE(bi.brand_code, bi.brand_name) brand,
               act.project_code project_code, pr.region city, pr.total_amount amount,
               CONCAT('道具维修 ', COALESCE(pr.region, ''), ' ', COALESCE(pr.remarks, '')) description
        FROM prop_repairs pr
        LEFT JOIN brand_inventory bi ON bi.id = pr.brand_id
        LEFT JOIN activities act ON act.id = pr.activity_id
        WHERE COALESCE(pr.payment_status, 'unpaid') <> 'paid' AND COALESCE(pr.total_amount, 0) > 0
        ${yearWhere.replaceAll('{alias}', 'pr')}
      `,
    },
    {
      type: 'reimbursement',
      label: '成本登记',
      sql: `
        SELECT r.id source_id, r.payee_name, COALESCE(r.payment_status, 'unpaid') payment_status,
               r.date source_date, r.brand, COALESCE(act.project_code, r.related_project_code) project_code,
               r.city, r.amount, r.cost_module, r.remarks,
               CONCAT('成本登记 ', COALESCE(r.cost_module, ''), ' ', COALESCE(r.remarks, '')) description
        FROM reimbursements r
        LEFT JOIN activities act ON act.id = r.activity_id
        WHERE COALESCE(r.payment_status, 'unpaid') <> 'paid' AND COALESCE(r.amount, 0) > 0
        ${yearWhere.replaceAll('{alias}', 'r')}
      `,
    },
  ];

  const all = [];
  for (const q of queries) {
    const [rows] = await conn.query(q.sql, params);
    rows.forEach((row) => {
      const costModuleLabel = COST_MODULE_LABELS[row.cost_module] || normText(row.cost_module);
      const reimbursementDesc = q.type === 'reimbursement'
        ? ['成本登记', costModuleLabel, visibleReimbursementRemarks(row.remarks)].filter(Boolean).join(' ')
        : row.description;
      const item = {
        source_type: q.type,
        source_label: q.label,
        source_id: Number(row.source_id),
        payee_name: normText(row.payee_name),
        payment_status: row.payment_status || 'unpaid',
        source_date: dateOnly(row.source_date),
        brand: normText(row.brand),
        project_code: normText(row.project_code),
        city: normText(row.city),
        amount: round2(row.amount),
        description: cleanDescription(reimbursementDesc),
      };
      if (candidateMatches(item, query)) all.push(item);
    });
  }
  return sortCandidates(all);
}

async function fetchSelectedCandidates(items, yearFrameId, conn) {
  const wanted = new Set(
    (items || [])
      .filter((x) => SOURCE_TYPES.has(String(x.source_type)) && Number.isFinite(Number(x.source_id)))
      .map((x) => `${x.source_type}:${Number(x.source_id)}`)
  );
  const rows = await fetchCandidates({ yearFrameId }, conn);
  return rows.filter((row) => wanted.has(`${row.source_type}:${row.source_id}`));
}

function requireSamePayee(rows, explicitPayee) {
  const names = [...new Set(rows.map((x) => normText(x.payee_name)).filter(Boolean))];
  if (explicitPayee && names.some((x) => x !== explicitPayee)) {
    const e = new Error('所选记录收款方与付款单收款方不一致');
    e.statusCode = 400;
    throw e;
  }
  if (!explicitPayee && names.length !== 1) {
    const e = new Error('请选择同一收款方的记录；旧数据缺少收款方时请先补填');
    e.statusCode = 400;
    throw e;
  }
  return explicitPayee || names[0];
}

router.get('/candidates', async (req, res) => {
  try {
    const rows = await fetchCandidates(req.query);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message || '加载待付款记录失败' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { yearFrameId } = req.query;
    const params = [];
    let sql = `
      SELECT po.*, COUNT(poi.id) item_count
      FROM payment_orders po
      LEFT JOIN payment_order_items poi ON poi.payment_order_id = po.id
      WHERE 1=1
    `;
    if (yearFrameId) {
      sql += ' AND po.year_frame_id = ?';
      params.push(parseInt(yearFrameId, 10));
    }
    sql += ' GROUP BY po.id ORDER BY po.created_at DESC, po.id DESC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message || '加载付款单失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [orders] = await db.query('SELECT * FROM payment_orders WHERE id = ?', [id]);
    if (!orders.length) return res.status(404).json({ error: '付款单不存在' });
    const [items] = await db.query('SELECT * FROM payment_order_items WHERE payment_order_id = ? ORDER BY id ASC', [id]);
    res.json({ ...orders[0], items });
  } catch (e) {
    res.status(500).json({ error: e.message || '加载付款单详情失败' });
  }
});

router.post('/', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const yearFrameId = parseInt(req.body.year_frame_id, 10);
    const orderDate = dateOnly(req.body.order_date) || dateOnly(new Date().toISOString());
    const paymentDate = dateOnly(req.body.payment_date) || orderDate;
    const explicitPayee = normText(req.body.payee_name);
    const selectedInput = Array.isArray(req.body.items) ? req.body.items : [];
    if (!Number.isFinite(yearFrameId)) return res.status(400).json({ error: '缺少年框' });
    if (!selectedInput.length) return res.status(400).json({ error: '请选择付款明细' });

    await conn.beginTransaction();
    const selected = await fetchSelectedCandidates(selectedInput, yearFrameId, conn);
    if (selected.length !== selectedInput.length) {
      const e = new Error('部分记录不存在、已支付或金额为 0，请刷新后重试');
      e.statusCode = 400;
      throw e;
    }
    selected.forEach((row) => {
      if (!normText(row.payee_name)) {
        const e = new Error('所选记录存在空收款方，请先补填收款方');
        e.statusCode = 400;
        throw e;
      }
    });
    const payeeName = requireSamePayee(selected, explicitPayee);
    const total = round2(selected.reduce((s, row) => s + round2(row.amount), 0));
    if (total <= 0) {
      const e = new Error('付款金额须大于 0');
      e.statusCode = 400;
      throw e;
    }

    const createdBy = req.session?.user?.username || null;
    const [ret] = await conn.query(
      `INSERT INTO payment_orders (year_frame_id, payee_name, order_date, payment_date, status, total_amount, remarks, created_by)
       VALUES (?, ?, ?, ?, 'paid', ?, ?, ?)`,
      [yearFrameId, payeeName, orderDate, paymentDate, total, normText(req.body.remarks) || null, createdBy]
    );
    const orderId = ret.insertId;
    const orderNo = `PAY-${String(yearFrameId).padStart(2, '0')}-${String(orderId).padStart(5, '0')}`;
    await conn.query('UPDATE payment_orders SET order_no = ? WHERE id = ?', [orderNo, orderId]);

    for (const row of selected) {
      await conn.query(
        `INSERT INTO payment_order_items
          (payment_order_id, source_type, source_id, amount, project_code, city, brand, description, source_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          row.source_type,
          row.source_id,
          row.amount,
          row.project_code || null,
          row.city || null,
          row.brand || null,
          row.description || null,
          row.source_date || null,
        ]
      );
      const table = SOURCE_TABLES[row.source_type];
      await conn.query(
        `UPDATE ${table} SET payment_status = 'paid', payment_order_id = ?, paid_at = NOW() WHERE id = ? AND COALESCE(payment_status, 'unpaid') <> 'paid'`,
        [orderId, row.source_id]
      );
      if (row.source_type === 'reimbursement') {
        await conn.query('UPDATE reimbursements SET claim_status = ? WHERE id = ?', ['paid', row.source_id]);
      }
    }

    await conn.commit();
    const [orders] = await db.query('SELECT * FROM payment_orders WHERE id = ?', [orderId]);
    const [items] = await db.query('SELECT * FROM payment_order_items WHERE payment_order_id = ? ORDER BY id ASC', [orderId]);
    res.status(201).json({ ...orders[0], items });
  } catch (e) {
    await conn.rollback();
    res.status(e.statusCode || 500).json({ error: e.message || '创建付款单失败' });
  } finally {
    conn.release();
  }
});

/**
 * 删除付款单：先把所有 items 对应来源表回退到 unpaid，再删除明细 + 主单。
 * 仅回退 payment_order_id 仍指向本单的源记录，避免影响之后已被重新归属到其它付款单的记录。
 */
router.delete('/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [orders] = await conn.query('SELECT id FROM payment_orders WHERE id = ?', [id]);
    if (!orders.length) return res.status(404).json({ error: '付款单不存在' });
    const [items] = await conn.query(
      'SELECT id, source_type, source_id FROM payment_order_items WHERE payment_order_id = ?',
      [id]
    );

    await conn.beginTransaction();
    for (const item of items) {
      const table = SOURCE_TABLES[item.source_type];
      if (!table) continue;
      await conn.query(
        `UPDATE ${table} SET payment_status = 'unpaid', payment_order_id = NULL, paid_at = NULL
         WHERE id = ? AND payment_order_id = ?`,
        [item.source_id, id]
      );
      if (item.source_type === 'reimbursement') {
        await conn.query(
          `UPDATE reimbursements SET claim_status = 'submitted' WHERE id = ? AND claim_status = 'paid'`,
          [item.source_id]
        );
      }
    }
    await conn.query('DELETE FROM payment_order_items WHERE payment_order_id = ?', [id]);
    await conn.query('DELETE FROM payment_orders WHERE id = ?', [id]);
    await conn.commit();
    res.json({ message: '付款单已删除；已回退所属成本记录为未支付' });
  } catch (e) {
    await conn.rollback();
    res.status(e.statusCode || 500).json({ error: e.message || '删除付款单失败' });
  } finally {
    conn.release();
  }
});

module.exports = router;
