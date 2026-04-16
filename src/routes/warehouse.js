const express = require('express');
const router = express.Router();
const db = require('../config/database');

const WAREHOUSE_REGIONS = ['东区', '北区', '南区'];
const TRAD_TO_SIMP = { '東區': '东区', '北區': '北区', '南區': '南区' };
const WAREHOUSE_BRANDS = ['PHD', 'X.O', 'CLUB', 'REMY'];

const WAREHOUSE_ROW_SQL = `
  SELECT
    w.id,
    w.year_frame_id,
    w.activity_id,
    w.merged_into_activity,
    w.allocation_note,
    w.month,
    w.\`region\` AS region,
    w.brand,
    w.wine_name,
    w.specifications,
    w.quantity,
    w.unit_price,
    w.quoted_price,
    w.actual_cost,
    w.no_actual_cost,
    w.remarks,
    w.created_at,
    w.updated_at,
    yf.year AS year_frame_name
  FROM warehouse w
  LEFT JOIN year_frames yf ON w.year_frame_id = yf.id
  WHERE w.id = ?
`;

function serializeWarehouseRow(row) {
  if (!row) return row;
  const out = { ...row };
  if (out.region != null && Buffer.isBuffer(out.region)) {
    out.region = out.region.toString('utf8');
  }
  if (out.region != null) {
    out.region = String(out.region).replace(/^\uFEFF/, '').trim();
  }
  return out;
}

/** 从请求体解析区域：兼容大小写 key、去 BOM、NFKC、繁体「東區」等 */
function canonicalWarehouseRegionFromBody(body) {
  if (!body) return null;
  const raw = body.region != null ? body.region : body.Region;
  if (raw == null) return null;
  let s = String(raw).replace(/^\uFEFF/, '').trim().normalize('NFKC');
  if (TRAD_TO_SIMP[s]) s = TRAD_TO_SIMP[s];
  if (!s) return null;
  return WAREHOUSE_REGIONS.includes(s) ? s : null;
}

/** 品牌：PHD、X.O、CLUB、REMY */
function canonicalWarehouseBrandFromBody(body) {
  if (!body) return null;
  const raw = body.brand != null ? body.brand : body.Brand;
  if (raw == null) return null;
  const s = String(raw).replace(/^\uFEFF/, '').trim().normalize('NFKC');
  if (!s) return null;
  return WAREHOUSE_BRANDS.includes(s) ? s : null;
}

async function fetchWarehouseRowById(id) {
  const [rows] = await db.query(WAREHOUSE_ROW_SQL, [id]);
  return rows.length ? serializeWarehouseRow(rows[0]) : null;
}

// 获取仓储列表
router.get('/', async (req, res) => {
  try {
    const { yearFrameId, month } = req.query;

    let sql = `
      SELECT
        w.id,
        w.year_frame_id,
        w.activity_id,
        w.merged_into_activity,
        w.allocation_note,
        w.month,
        w.\`region\` AS region,
        w.brand,
        w.wine_name,
        w.specifications,
        w.quantity,
        w.unit_price,
        w.quoted_price,
        w.actual_cost,
        w.no_actual_cost,
        w.remarks,
        w.created_at,
        w.updated_at,
        yf.year AS year_frame_name
      FROM warehouse w
      LEFT JOIN year_frames yf ON w.year_frame_id = yf.id
      WHERE 1=1
    `;
    const params = [];

    if (yearFrameId) {
      sql += ' AND w.year_frame_id = ?';
      params.push(yearFrameId);
    }
    if (month) {
      sql += ' AND w.month = ?';
      params.push(month);
    }

    sql += ' ORDER BY w.month DESC, w.created_at DESC';

    const [rows] = await db.query(sql, params);
    res.json(rows.map(serializeWarehouseRow));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 按月统计仓储
router.get('/summary', async (req, res) => {
  try {
    const { yearFrameId } = req.query;

    let sql = `
      SELECT 
        month,
        COUNT(*) as count,
        SUM(quoted_price) as total_revenue,
        SUM(CASE WHEN COALESCE(merged_into_activity, 0) = 0 THEN actual_cost ELSE 0 END) as total_cost,
        SUM(CASE WHEN COALESCE(merged_into_activity, 0) = 0 THEN actual_cost ELSE 0 END) as pooled_cost,
        SUM(CASE WHEN COALESCE(merged_into_activity, 0) = 1 THEN actual_cost ELSE 0 END) as merged_cost
      FROM warehouse
      WHERE 1=1
    `;
    const params = [];

    if (yearFrameId) {
      sql += ' AND year_frame_id = ?';
      params.push(yearFrameId);
    }

    sql += ' GROUP BY month ORDER BY month DESC';

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 单条仓储（须在 /summary 之后注册，避免 "summary" 被当成 id）
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: '无效的记录 ID' });
    }
    const row = await fetchWarehouseRowById(id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建仓储记录
router.post('/', async (req, res) => {
  try {
    const { month, wine_name, specifications, quantity, unit_price, quoted_price, actual_cost, no_actual_cost, remarks, activity_id, merged_into_activity, allocation_note } = req.body;
    const activityId = activity_id != null && String(activity_id).trim() !== '' ? parseInt(activity_id, 10) : null;
    const mergedFlag = merged_into_activity === true || merged_into_activity === 1 || String(merged_into_activity) === '1' ? 1 : 0;
    const yfid = parseInt(req.body.year_frame_id, 10);
    if (!Number.isFinite(yfid)) {
      return res.status(400).json({ error: '无效的年框（年份）选择' });
    }
    const regionNorm = canonicalWarehouseRegionFromBody(req.body);
    if (!regionNorm) {
      return res.status(400).json({ error: '区域无效或缺失：请选择 东区、北区 或 南区' });
    }
    const brandNorm = canonicalWarehouseBrandFromBody(req.body);
    if (!brandNorm) {
      return res.status(400).json({ error: '品牌无效或缺失：请选择 PHD、X.O、CLUB 或 REMY' });
    }
    const wn = wine_name != null ? wine_name : '';
    const sp = specifications != null ? specifications : '';
    const monthVal =
      month != null && String(month).trim() !== '' ? String(month).trim() : null;

    const noActualCost = no_actual_cost === true || no_actual_cost === 1 || String(no_actual_cost) === '1' ? 1 : 0;
    const actualCostVal = noActualCost ? 0 : (actual_cost || 0);

    const [result] = await db.query(
      `
      INSERT INTO warehouse (year_frame_id, activity_id, merged_into_activity, allocation_note, month, \`region\`, brand, wine_name, specifications, quantity, unit_price, quoted_price, actual_cost, no_actual_cost, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [yfid, Number.isFinite(activityId) ? activityId : null, mergedFlag, allocation_note || null, monthVal, regionNorm, brandNorm, wn, sp, quantity, unit_price, quoted_price, actualCostVal, noActualCost, remarks]
    );

    const saved = await fetchWarehouseRowById(result.insertId);
    res.json(saved || { id: result.insertId, message: '创建成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量更新成本
router.post('/batch-update-cost', async (req, res) => {
  try {
    const { updates } = req.body;

    for (const item of updates) {
      await db.query('UPDATE warehouse SET actual_cost = ? WHERE id = ?', [item.actual_cost, item.id]);
    }

    res.json({ message: `成功更新 ${updates.length} 条记录` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新仓储记录
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const nid = parseInt(id, 10);
    if (!Number.isFinite(nid)) {
      return res.status(400).json({ error: '无效的记录 ID' });
    }
    const { month, wine_name, specifications, quantity, unit_price, quoted_price, actual_cost, no_actual_cost, remarks, activity_id, merged_into_activity, allocation_note } = req.body;
    const activityId = activity_id != null && String(activity_id).trim() !== '' ? parseInt(activity_id, 10) : null;
    const mergedFlag = merged_into_activity === true || merged_into_activity === 1 || String(merged_into_activity) === '1' ? 1 : 0;
    const yfid = parseInt(req.body.year_frame_id, 10);
    if (!Number.isFinite(yfid)) {
      return res.status(400).json({ error: '无效的年框（年份）选择' });
    }
    const regionNorm = canonicalWarehouseRegionFromBody(req.body);
    if (!regionNorm) {
      return res.status(400).json({ error: '区域无效或缺失：请选择 东区、北区 或 南区' });
    }
    const brandNorm = canonicalWarehouseBrandFromBody(req.body);
    if (!brandNorm) {
      return res.status(400).json({ error: '品牌无效或缺失：请选择 PHD、X.O、CLUB 或 REMY' });
    }
    const wn = wine_name != null ? wine_name : '';
    const sp = specifications != null ? specifications : '';
    const monthVal =
      month != null && String(month).trim() !== '' ? String(month).trim() : null;

    const noActualCost = no_actual_cost === true || no_actual_cost === 1 || String(no_actual_cost) === '1' ? 1 : 0;
    const actualCostVal = noActualCost ? 0 : actual_cost;

    await db.query(
      `
      UPDATE warehouse SET
        year_frame_id = ?,
        activity_id = ?, merged_into_activity = ?, allocation_note = ?,
        month = ?, \`region\` = ?, brand = ?, wine_name = ?, specifications = ?,
        quantity = ?, unit_price = ?, quoted_price = ?,
        actual_cost = ?, no_actual_cost = ?, remarks = ?
      WHERE id = ?
    `,
      [yfid, Number.isFinite(activityId) ? activityId : null, mergedFlag, allocation_note || null, monthVal, regionNorm, brandNorm, wn, sp, quantity, unit_price, quoted_price, actualCostVal, noActualCost, remarks, nid]
    );

    const saved = await fetchWarehouseRowById(nid);
    res.json(saved || { message: '更新成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除仓储记录
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM warehouse WHERE id = ?', [id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
