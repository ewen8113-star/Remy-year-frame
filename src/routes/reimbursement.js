const express = require('express');
const router = express.Router();
const db = require('../config/database');

const PAYMENT_TYPES = ['personal_reimbursement', 'corporate_payment'];
const COST_MODULES = ['activity', 'warehouse', 'logistics', 'prop_repair', 'general'];
const CLAIM_STATUSES = ['draft', 'submitted', 'paid', 'rejected'];

/** 与 public/app.js COST_DETAIL_GROUPS 键一致 */
const COST_DETAIL_KEYS = [
  'supervisor', 'pg', 'parttime', 'bartender', 'photo', 'cloud_album_edit', 'performance',
  'travel_supervisor', 'travel_company',
  'structure', 'print', 'spray',
  'floral', 'payment', 'tasting',
  'warehouse', 'express', 'logistics',
];

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function sumCostDetails(details) {
  if (!details || typeof details !== 'object') return 0;
  return round2(COST_DETAIL_KEYS.reduce((s, k) => s + round2(details[k]), 0));
}

function parseJsonObject(v) {
  if (v == null) return {};
  if (typeof v === 'object' && !Array.isArray(v)) return { ...v };
  if (typeof v === 'string') {
    try {
      const o = JSON.parse(v);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseJsonArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 仅当报销某键金额 > 0 时覆盖场次对应键 */
function mergeCostDetailsIntoActivity(activityDetails, reimbDetails) {
  const base = parseJsonObject(activityDetails);
  const r = parseJsonObject(reimbDetails);
  COST_DETAIL_KEYS.forEach((k) => {
    const v = round2(r[k]);
    if (v > 0) base[k] = v;
  });
  return base;
}

function normalizeCostDetailsInput(body) {
  const raw = body && body.cost_details;
  const o = parseJsonObject(raw);
  const out = {};
  COST_DETAIL_KEYS.forEach((k) => {
    out[k] = round2(o[k]);
  });
  return out;
}

function normalizeInvoices(body) {
  const raw = body && body.invoices;
  const arr = Array.isArray(raw) ? raw : parseJsonArray(raw);
  return arr
    .map((row) => ({
      invoice_content: row && row.invoice_content != null ? String(row.invoice_content).trim() : '',
      invoice_no: row && row.invoice_no != null ? String(row.invoice_no).trim() : '',
      invoice_date: row && row.invoice_date != null ? String(row.invoice_date).slice(0, 10) : '',
      invoice_kind: row && (row.invoice_kind === '普票' || row.invoice_kind === '专票') ? row.invoice_kind : '',
    }))
    .filter((row) => row.invoice_content || row.invoice_no || row.invoice_date || row.invoice_kind);
}

function serializeRow(row) {
  if (!row) return row;
  const r = { ...row };
  r.cost_details = parseJsonObject(r.cost_details);
  r.invoices = parseJsonArray(r.invoices);
  r.merged_into_activity = r.merged_into_activity === 1 || r.merged_into_activity === true ? 1 : 0;
  r.has_invoice = r.has_invoice === 1 || r.has_invoice === true ? 1 : 0;
  r.payment_type = PAYMENT_TYPES.includes(String(r.payment_type || '')) ? String(r.payment_type) : 'personal_reimbursement';
  r.cost_module = COST_MODULES.includes(String(r.cost_module || '')) ? String(r.cost_module) : 'activity';
  r.claim_status = CLAIM_STATUSES.includes(String(r.claim_status || '')) ? String(r.claim_status) : 'draft';
  return r;
}

function normalizePaymentType(v) {
  const s = v == null ? '' : String(v).trim();
  return PAYMENT_TYPES.includes(s) ? s : 'personal_reimbursement';
}
function normalizeCostModule(v) {
  const s = v == null ? '' : String(v).trim();
  return COST_MODULES.includes(s) ? s : 'activity';
}
function normalizeClaimStatus(v) {
  const s = v == null ? '' : String(v).trim();
  return CLAIM_STATUSES.includes(s) ? s : 'draft';
}

async function mergeReimbIntoActivity(conn, activityId, reimbCostDetails) {
  const [acts] = await conn.query(
    'SELECT id, year_frame_id, cost_details, no_cost FROM activities WHERE id = ? FOR UPDATE',
    [activityId]
  );
  if (!acts.length) {
    const e = new Error('关联场次不存在');
    e.statusCode = 400;
    throw e;
  }
  const act = acts[0];
  const noCost = act.no_cost === 1 || act.no_cost === true;
  if (noCost) {
    const e = new Error('该场次已标记为无成本，禁止同步报销到场次成本');
    e.statusCode = 400;
    throw e;
  }
  const merged = mergeCostDetailsIntoActivity(act.cost_details, reimbCostDetails);
  const total = sumCostDetails(merged);
  await conn.query(
    'UPDATE activities SET cost_details = ?, total_cost = ? WHERE id = ?',
    [JSON.stringify(merged), total, activityId]
  );
}

// 获取报销列表
router.get('/', async (req, res) => {
  try {
    const { yearFrameId, city } = req.query;

    let sql = `
      SELECT r.*, yf.year as year_frame_name
      FROM reimbursements r
      LEFT JOIN year_frames yf ON r.year_frame_id = yf.id
      WHERE 1=1
    `;
    const params = [];

    if (yearFrameId) {
      sql += ' AND r.year_frame_id = ?';
      params.push(yearFrameId);
    }
    if (city) {
      sql += ' AND r.city LIKE ?';
      params.push(`%${city}%`);
    }

    sql += ' ORDER BY r.date DESC, r.id DESC';

    const [rows] = await db.query(sql, params);
    res.json(rows.map(serializeRow));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT r.*, yf.year as year_frame_name
       FROM reimbursements r
       LEFT JOIN year_frames yf ON r.year_frame_id = yf.id
       WHERE r.id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    res.json(serializeRow(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建报销记录
router.post('/', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const {
      year_frame_id,
      activity_id,
      reimbursement_type,
      payment_type,
      cost_module,
      claim_status,
      city,
      brand,
      date,
      related_project_code,
      remarks,
      has_invoice,
      sync_to_activity,
    } = req.body;

    if (!year_frame_id) {
      return res.status(400).json({ error: '缺少 year_frame_id' });
    }
    if (!date) {
      return res.status(400).json({ error: '缺少 date' });
    }
    const brandVal = brand != null ? String(brand).trim() : '';
    if (!brandVal) {
      return res.status(400).json({ error: '请选择品牌' });
    }

    const cost_details = normalizeCostDetailsInput(req.body);
    const amount = sumCostDetails(cost_details);
    if (amount <= 0) {
      return res.status(400).json({ error: '费用明细合计须大于 0' });
    }

    const hi = !!(has_invoice === true || has_invoice === 1 || String(has_invoice) === '1');
    let invoices = normalizeInvoices(req.body);
    if (hi) {
      const valid = invoices.filter(
        (x) => x.invoice_no && x.invoice_date && (x.invoice_kind === '专票' || x.invoice_kind === '普票')
      );
      if (!valid.length) {
        return res.status(400).json({ error: '有发票时至少填写一行完整发票（号码、日期、专票/普票）' });
      }
      invoices = valid;
    } else {
      invoices = [];
    }

    const sync = !!(sync_to_activity === true || sync_to_activity === 1 || String(sync_to_activity) === '1');
    const actId = activity_id == null || activity_id === '' ? null : Number(activity_id);
    if (sync && !actId) {
      return res.status(400).json({ error: '勾选同步到场次成本时，必须选择关联场次' });
    }

    const paymentType = normalizePaymentType(payment_type);
    const costModule = normalizeCostModule(cost_module);
    const claimStatus = normalizeClaimStatus(claim_status);

    let act = null;
    if (actId) {
      const [acts] = await conn.query(
        'SELECT id, year_frame_id, project_code, city, brand FROM activities WHERE id = ?',
        [actId]
      );
      if (!acts.length) {
        return res.status(400).json({ error: '关联场次不存在' });
      }
      if (Number(acts[0].year_frame_id) !== Number(year_frame_id)) {
        return res.status(400).json({ error: '场次所属年框与当前报销年框不一致' });
      }
      act = acts[0];
    }
    const rpc = related_project_code != null && String(related_project_code).trim()
      ? String(related_project_code).trim()
      : (act ? (act.project_code || null) : null);
    const cityVal = city != null && String(city).trim()
      ? String(city).trim()
      : (act ? (act.city || null) : null);

    await conn.beginTransaction();

    const invoicesJson = invoices.length ? JSON.stringify(invoices) : null;
    const costJson = JSON.stringify(cost_details);

    const [result] = await conn.query(
      `INSERT INTO reimbursements (
        year_frame_id, activity_id, reimbursement_type, payment_type, cost_module, claim_status, city, brand, amount, date, related_project_code,
        props, printing, express, other,
        cost_details, merged_into_activity, has_invoice, invoices, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?)`,
      [
        year_frame_id,
        actId,
        reimbursement_type || null,
        paymentType,
        costModule,
        claimStatus,
        cityVal,
        brandVal,
        amount,
        date,
        rpc,
        costJson,
        sync ? 1 : 0,
        hi ? 1 : 0,
        invoicesJson,
        remarks || null,
      ]
    );

    const newId = result.insertId;

    if (sync && actId) {
      await mergeReimbIntoActivity(conn, actId, cost_details);
    }

    await conn.commit();
    res.json({ id: newId, message: '创建成功', merged_into_activity: sync ? 1 : 0 });
  } catch (error) {
    await conn.rollback();
    const code = error.statusCode || 500;
    res.status(code).json({ error: error.message || '创建失败' });
  } finally {
    conn.release();
  }
});

// 更新报销记录
router.put('/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { id } = req.params;
    const [existing] = await conn.query('SELECT * FROM reimbursements WHERE id = ?', [id]);
    if (!existing.length) {
      return res.status(404).json({ error: '记录不存在' });
    }
    const ex = existing[0];
    const alreadyMerged = ex.merged_into_activity === 1 || ex.merged_into_activity === true;

    const {
      activity_id,
      reimbursement_type,
      payment_type,
      cost_module,
      claim_status,
      city,
      brand,
      date,
      related_project_code,
      remarks,
      has_invoice,
      sync_to_activity,
    } = req.body;

    if (!date) {
      return res.status(400).json({ error: '缺少 date' });
    }

    const cost_details = normalizeCostDetailsInput(req.body);
    const amount = sumCostDetails(cost_details);
    if (amount <= 0) {
      return res.status(400).json({ error: '费用明细合计须大于 0' });
    }

    const hi = !!(has_invoice === true || has_invoice === 1 || String(has_invoice) === '1');
    let invoices = normalizeInvoices(req.body);
    if (hi) {
      const valid = invoices.filter(
        (x) => x.invoice_no && x.invoice_date && (x.invoice_kind === '专票' || x.invoice_kind === '普票')
      );
      if (!valid.length) {
        return res.status(400).json({ error: '有发票时至少填写一行完整发票（号码、日期、专票/普票）' });
      }
      invoices = valid;
    } else {
      invoices = [];
    }

    const sync = !!(sync_to_activity === true || sync_to_activity === 1 || String(sync_to_activity) === '1');
    const paymentType = normalizePaymentType(payment_type != null ? payment_type : ex.payment_type);
    const costModule = normalizeCostModule(cost_module != null ? cost_module : ex.cost_module);
    const claimStatus = normalizeClaimStatus(claim_status != null ? claim_status : ex.claim_status);
    const incomingActId = activity_id == null || activity_id === '' ? null : Number(activity_id);
    const actId = incomingActId == null ? (ex.activity_id ? Number(ex.activity_id) : null) : incomingActId;
    if (alreadyMerged) {
      if (!actId || Number(ex.activity_id) !== Number(actId)) {
        return res.status(400).json({ error: '已计入活动成本（场次）的记录不可更换/清空关联场次' });
      }
    } else if (sync && !actId) {
      return res.status(400).json({ error: '勾选同步到场次成本时，必须选择关联场次' });
    }

    let act = null;
    if (actId) {
      const [acts] = await conn.query(
        'SELECT id, year_frame_id, project_code, city, brand FROM activities WHERE id = ?',
        [actId]
      );
      if (!acts.length) {
        return res.status(400).json({ error: '关联场次不存在' });
      }
      if (Number(acts[0].year_frame_id) !== Number(ex.year_frame_id)) {
        return res.status(400).json({ error: '场次所属年框与报销记录年框不一致' });
      }
      act = acts[0];
    }
    const brandVal = brand != null ? String(brand).trim() : String(ex.brand || '').trim();
    if (!brandVal) {
      return res.status(400).json({ error: '请选择品牌' });
    }
    const rpc = related_project_code != null && String(related_project_code).trim()
      ? String(related_project_code).trim()
      : (act ? (act.project_code || ex.related_project_code) : ex.related_project_code);
    const cityVal = city != null && String(city).trim()
      ? String(city).trim()
      : (act ? (act.city || ex.city) : ex.city);

    await conn.beginTransaction();

    const mergedFlag = alreadyMerged ? 1 : (sync ? 1 : 0);
    const invoicesJson = invoices.length ? JSON.stringify(invoices) : null;
    const costJson = JSON.stringify(cost_details);

    await conn.query(
      `UPDATE reimbursements SET
        activity_id = ?,
        reimbursement_type = ?, payment_type = ?, cost_module = ?, claim_status = ?,
        city = ?, brand = ?, amount = ?,
        date = ?, related_project_code = ?,
        props = 0, printing = 0, express = 0, other = 0,
        cost_details = ?, merged_into_activity = ?, has_invoice = ?, invoices = ?,
        remarks = ?
      WHERE id = ?`,
      [
        actId,
        reimbursement_type || null,
        paymentType,
        costModule,
        claimStatus,
        cityVal || null,
        brandVal,
        amount,
        date,
        rpc,
        costJson,
        mergedFlag,
        hi ? 1 : 0,
        invoicesJson,
        remarks || null,
        id,
      ]
    );

    if (mergedFlag === 1 && actId) {
      await mergeReimbIntoActivity(conn, actId, cost_details);
    }

    await conn.commit();
    res.json({ message: '更新成功', merged_into_activity: mergedFlag });
  } catch (error) {
    await conn.rollback();
    const code = error.statusCode || 500;
    res.status(code).json({ error: error.message || '更新失败' });
  } finally {
    conn.release();
  }
});

// 删除报销记录
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      'SELECT merged_into_activity FROM reimbursements WHERE id = ?',
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: '记录不存在' });
    }
    await db.query('DELETE FROM reimbursements WHERE id = ?', [id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
