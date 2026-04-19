const express = require('express');
const router = express.Router();
const db = require('../config/database');
const PROP_REPAIR_REGIONS = ['东区', '北区', '南区', '东南区', '西南区'];

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

function roundMoney(v) {
  return Math.round((parseFloat(v) || 0) * 100) / 100;
}

function canonicalRegion(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/^\uFEFF/, '').trim().normalize('NFKC');
  if (!s) return null;
  return PROP_REPAIR_REGIONS.includes(s) ? s : null;
}

const LIST_SQL = `
  SELECT pr.*, bi.brand_name, bi.brand_code,
         act.project_code AS activity_project_code
  FROM prop_repairs pr
  LEFT JOIN brand_inventory bi ON pr.brand_id = bi.id
  LEFT JOIN activities act ON act.id = pr.activity_id
  WHERE 1 = 1
`;

router.get('/__ready', (req, res) => {
  res.json({ ok: true, route: 'prop-repairs' });
});

router.get('/summary', async (req, res) => {
  try {
    const { yearFrameId } = req.query;
    let sql = `
      SELECT pr.brand_id,
             bi.brand_name,
             bi.brand_code,
             DATE_FORMAT(pr.repair_date, '%Y-%m') AS ym,
             SUM(CASE WHEN COALESCE(pr.merged_into_activity, 0) = 0 THEN pr.total_amount ELSE 0 END) AS subtotal
      FROM prop_repairs pr
      LEFT JOIN brand_inventory bi ON pr.brand_id = bi.id
      WHERE 1 = 1
    `;
    const params = [];
    if (yearFrameId) {
      sql += ' AND pr.year_frame_id = ?';
      params.push(parseInt(yearFrameId, 10));
    }
    sql +=
      " GROUP BY pr.brand_id, bi.brand_name, bi.brand_code, DATE_FORMAT(pr.repair_date, '%Y-%m') " +
      "ORDER BY DATE_FORMAT(pr.repair_date, '%Y-%m') DESC, pr.brand_id ASC";
    const [byMonth] = await db.query(sql, params);

    let totalSql = `SELECT
      COALESCE(SUM(total_amount), 0) AS total,
      COALESCE(SUM(CASE WHEN COALESCE(merged_into_activity, 0) = 0 THEN total_amount ELSE 0 END), 0) AS pooled_total,
      COALESCE(SUM(CASE WHEN COALESCE(merged_into_activity, 0) = 1 THEN total_amount ELSE 0 END), 0) AS merged_total
      FROM prop_repairs pr WHERE 1=1`;
    const totalParams = [];
    if (yearFrameId) {
      totalSql += ' AND pr.year_frame_id = ?';
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
      sql += ' AND pr.year_frame_id = ?';
      params.push(parseInt(yearFrameId, 10));
    }
    if (brandId) {
      sql += ' AND pr.brand_id = ?';
      params.push(parseInt(brandId, 10));
    }
    sql += ' ORDER BY pr.repair_date DESC, pr.id DESC';
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
    const sql = `${LIST_SQL} AND pr.id = ? LIMIT 1`;
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
    const { year_frame_id, activity_id, merged_into_activity, allocation_note, brand_id, repair_date, region, items, quoted_price, remarks, no_cost } = req.body || {};
    const activityId = activity_id != null && String(activity_id).trim() !== '' ? parseInt(activity_id, 10) : null;
    const mergedFlag = merged_into_activity === true || merged_into_activity === 1 || String(merged_into_activity) === '1' ? 1 : 0;
    const yf = parseInt(year_frame_id, 10);
    const bid = parseInt(brand_id, 10);
    const regionNorm = canonicalRegion(region);
    const isNoCost = no_cost === true || no_cost === 1 || String(no_cost) === '1';
    if (!yf || !bid) return res.status(400).json({ error: '年框与品牌不能为空' });
    if (!repair_date) return res.status(400).json({ error: '维修日期不能为空' });
    if (!regionNorm) return res.status(400).json({ error: '请选择区域：东区 / 北区 / 南区 / 东南区 / 西南区' });
    const parsed = isNoCost ? [] : parseItems(items);
    const total = isNoCost ? 0 : sumItems(parsed);
    const quotedPrice = roundMoney(quoted_price);
    if (!isNoCost && parsed.length === 0) return res.status(400).json({ error: '请至少填写一项维修明细' });
    if (!isNoCost && total <= 0) return res.status(400).json({ error: '合计金额须大于 0' });

    const [result] = await db.query(
      `INSERT INTO prop_repairs (year_frame_id, activity_id, merged_into_activity, allocation_note, brand_id, repair_date, region, items, quoted_price, total_amount, no_cost, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [yf, Number.isFinite(activityId) ? activityId : null, mergedFlag, allocation_note || null, bid, repair_date, regionNorm, JSON.stringify(parsed), quotedPrice, total, isNoCost ? 1 : 0, remarks || null]
    );
    const [rows] = await db.query(`${LIST_SQL} AND pr.id = ?`, [result.insertId]);
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
    const { activity_id, merged_into_activity, allocation_note, brand_id, repair_date, region, items, quoted_price, remarks, no_cost } = req.body || {};
    const activityId = activity_id != null && String(activity_id).trim() !== '' ? parseInt(activity_id, 10) : null;
    const mergedFlag = merged_into_activity === true || merged_into_activity === 1 || String(merged_into_activity) === '1' ? 1 : 0;
    const bid = parseInt(brand_id, 10);
    const regionNorm = canonicalRegion(region);
    const isNoCost = no_cost === true || no_cost === 1 || String(no_cost) === '1';
    if (!bid) return res.status(400).json({ error: '品牌不能为空' });
    if (!repair_date) return res.status(400).json({ error: '维修日期不能为空' });
    if (!regionNorm) return res.status(400).json({ error: '请选择区域：东区 / 北区 / 南区 / 东南区 / 西南区' });
    const parsed = isNoCost ? [] : parseItems(items);
    const total = isNoCost ? 0 : sumItems(parsed);
    const quotedPrice = roundMoney(quoted_price);
    if (!isNoCost && parsed.length === 0) return res.status(400).json({ error: '请至少填写一项维修明细' });
    if (!isNoCost && total <= 0) return res.status(400).json({ error: '合计金额须大于 0' });

    const [ret] = await db.query(
      `UPDATE prop_repairs
       SET activity_id = ?, merged_into_activity = ?, allocation_note = ?, brand_id = ?, repair_date = ?, region = ?, items = ?, quoted_price = ?, total_amount = ?, no_cost = ?, remarks = ?
       WHERE id = ?`,
      [Number.isFinite(activityId) ? activityId : null, mergedFlag, allocation_note || null, bid, repair_date, regionNorm, JSON.stringify(parsed), quotedPrice, total, isNoCost ? 1 : 0, remarks || null, id]
    );
    if (!ret.affectedRows) return res.status(404).json({ error: '记录不存在' });
    const [rows] = await db.query(`${LIST_SQL} AND pr.id = ?`, [id]);
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
    const [ret] = await db.query('DELETE FROM prop_repairs WHERE id = ?', [id]);
    if (!ret.affectedRows) return res.status(404).json({ error: '记录不存在' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败', message: e.message });
  }
});

module.exports = router;
