const express = require('express');
const router = express.Router();
const db = require('../config/database');

function parseItems(raw) {
  if (raw == null) return [];
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v
    .map((row) => ({
      name: String(row && row.name != null ? row.name : '').trim(),
      amount: Math.round((parseFloat(row && row.amount) || 0) * 100) / 100,
    }))
    .filter((row) => row.name);
}

function sumItems(items) {
  return Math.round(items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0) * 100) / 100;
}

const LIST_SQL = `
  SELECT mp.*, bi.brand_name, bi.brand_code,
         act.project_code AS activity_project_code
  FROM material_purchases mp
  LEFT JOIN brand_inventory bi ON mp.brand_id = bi.id
  LEFT JOIN activities act ON act.id = mp.activity_id
  WHERE 1 = 1
`;

/** 部署自检：应返回 200 JSON；若 404 则当前 node 未挂本路由 */
router.get('/__ready', (req, res) => {
  res.json({ ok: true, route: 'material-purchases' });
});

router.get('/summary', async (req, res) => {
  try {
    const { yearFrameId } = req.query;
    let sql = `
      SELECT mp.brand_id,
             bi.brand_name,
             bi.brand_code,
             DATE_FORMAT(mp.purchase_date, '%Y-%m') AS ym,
             SUM(CASE WHEN COALESCE(mp.merged_into_activity, 0) = 0 THEN mp.total_amount ELSE 0 END) AS subtotal
      FROM material_purchases mp
      LEFT JOIN brand_inventory bi ON mp.brand_id = bi.id
      WHERE 1 = 1
    `;
    const params = [];
    if (yearFrameId) {
      sql += ' AND mp.year_frame_id = ?';
      params.push(parseInt(yearFrameId, 10));
    }
    sql +=
      ' GROUP BY mp.brand_id, bi.brand_name, bi.brand_code, DATE_FORMAT(mp.purchase_date, \'%Y-%m\') ' +
      'ORDER BY DATE_FORMAT(mp.purchase_date, \'%Y-%m\') DESC, mp.brand_id ASC';
    const [byMonth] = await db.query(sql, params);

    let totalSql = `SELECT
      COALESCE(SUM(total_amount), 0) AS total,
      COALESCE(SUM(CASE WHEN COALESCE(merged_into_activity, 0) = 0 THEN total_amount ELSE 0 END), 0) AS pooled_total,
      COALESCE(SUM(CASE WHEN COALESCE(merged_into_activity, 0) = 1 THEN total_amount ELSE 0 END), 0) AS merged_total
      FROM material_purchases mp WHERE 1=1`;
    const totalParams = [];
    if (yearFrameId) {
      totalSql += ' AND mp.year_frame_id = ?';
      totalParams.push(parseInt(yearFrameId, 10));
    }
    const [[tot]] = await db.query(totalSql, totalParams);

    res.json({
      grandTotal: Math.round((parseFloat(tot.total) || 0) * 100) / 100,
      pooledTotal: Math.round((parseFloat(tot.pooled_total) || 0) * 100) / 100,
      mergedTotal: Math.round((parseFloat(tot.merged_total) || 0) * 100) / 100,
      byMonth: byMonth || [],
    });
  } catch (e) {
    res.status(500).json({ error: '汇总失败', message: e.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { yearFrameId, brandId } = req.query;
    let sql = LIST_SQL;
    const params = [];
    if (yearFrameId) {
      sql += ' AND mp.year_frame_id = ?';
      params.push(parseInt(yearFrameId, 10));
    }
    if (brandId) {
      sql += ' AND mp.brand_id = ?';
      params.push(parseInt(brandId, 10));
    }
    sql += ' ORDER BY mp.purchase_date DESC, mp.id DESC';
    const [rows] = await db.query(sql, params);
    const out = rows.map((r) => {
      const row = { ...r };
      if (row.items && typeof row.items === 'string') {
        try {
          row.items = JSON.parse(row.items);
        } catch {
          row.items = [];
        }
      }
      return row;
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: '获取列表失败', message: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '无效 ID' });
    const sql = `${LIST_SQL} AND mp.id = ? LIMIT 1`;
    const [rows] = await db.query(sql, [id]);
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    const row = rows[0];
    if (row.items && typeof row.items === 'string') {
      try {
        row.items = JSON.parse(row.items);
      } catch {
        row.items = [];
      }
    }
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: '获取记录失败', message: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { year_frame_id, activity_id, merged_into_activity, allocation_note, payee_name, brand_id, purchase_date, items, remarks } = req.body || {};
    const activityId = activity_id != null && String(activity_id).trim() !== '' ? parseInt(activity_id, 10) : null;
    const mergedFlag = merged_into_activity === true || merged_into_activity === 1 || String(merged_into_activity) === '1' ? 1 : 0;
    const yf = parseInt(year_frame_id, 10);
    const bid = parseInt(brand_id, 10);
    if (!yf || !bid) return res.status(400).json({ error: '年框与品牌不能为空' });
    if (!purchase_date) return res.status(400).json({ error: '报销日期不能为空' });
    const parsed = parseItems(items);
    const total = sumItems(parsed);
    if (parsed.length === 0) return res.status(400).json({ error: '请至少填写一项费用明细' });
    if (total <= 0) return res.status(400).json({ error: '合计金额须大于 0' });

    const [result] = await db.query(
      `INSERT INTO material_purchases (year_frame_id, activity_id, merged_into_activity, allocation_note, payee_name, brand_id, purchase_date, items, total_amount, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [yf, Number.isFinite(activityId) ? activityId : null, mergedFlag, allocation_note || null, payee_name || null, bid, purchase_date, JSON.stringify(parsed), total, remarks || null]
    );
    const [rows] = await db.query(`${LIST_SQL} AND mp.id = ?`, [result.insertId]);
    const row = rows[0];
    if (row.items && typeof row.items === 'string') row.items = JSON.parse(row.items);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: '创建失败', message: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '无效 ID' });
    const { activity_id, merged_into_activity, allocation_note, payee_name, brand_id, purchase_date, items, remarks } = req.body || {};
    const activityId = activity_id != null && String(activity_id).trim() !== '' ? parseInt(activity_id, 10) : null;
    const mergedFlag = merged_into_activity === true || merged_into_activity === 1 || String(merged_into_activity) === '1' ? 1 : 0;
    const bid = parseInt(brand_id, 10);
    if (!bid) return res.status(400).json({ error: '品牌不能为空' });
    if (!purchase_date) return res.status(400).json({ error: '报销日期不能为空' });
    const parsed = parseItems(items);
    const total = sumItems(parsed);
    if (parsed.length === 0) return res.status(400).json({ error: '请至少填写一项费用明细' });
    if (total <= 0) return res.status(400).json({ error: '合计金额须大于 0' });

    const [ret] = await db.query(
      `UPDATE material_purchases SET activity_id = ?, merged_into_activity = ?, allocation_note = ?, payee_name = ?, brand_id = ?, purchase_date = ?, items = ?, total_amount = ?, remarks = ? WHERE id = ?`,
      [Number.isFinite(activityId) ? activityId : null, mergedFlag, allocation_note || null, payee_name || null, bid, purchase_date, JSON.stringify(parsed), total, remarks || null, id]
    );
    if (!ret.affectedRows) return res.status(404).json({ error: '记录不存在' });
    const [rows] = await db.query(`${LIST_SQL} AND mp.id = ?`, [id]);
    const row = rows[0];
    if (row.items && typeof row.items === 'string') row.items = JSON.parse(row.items);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: '更新失败', message: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '无效 ID' });
    const [ret] = await db.query('DELETE FROM material_purchases WHERE id = ?', [id]);
    if (!ret.affectedRows) return res.status(404).json({ error: '记录不存在' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败', message: e.message });
  }
});

module.exports = router;
