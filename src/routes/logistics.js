const express = require('express');
const router = express.Router();
const db = require('../config/database');
const LOGISTICS_BRANDS = new Set(['PHD', 'X.O', 'CLUB', 'REMY']);

const LOGISTICS_ROW_SQL = `
  SELECT l.*, yf.year as year_frame_name
  FROM logistics l
  LEFT JOIN year_frames yf ON l.year_frame_id = yf.id
  WHERE l.id = ?
`;

/** 请求体中的关联项目编号：兼容 camelCase / project_code，去 BOM、trim */
function parseRelatedProjectCodeFromBody(body) {
  if (!body) return null;
  const raw =
    body.related_project_code != null
      ? body.related_project_code
      : body.relatedProjectCode != null
        ? body.relatedProjectCode
        : body.project_code != null
          ? body.project_code
          : null;
  if (raw == null) return null;
  const s = String(raw).replace(/^\uFEFF/, '').trim();
  return s || null;
}

function serializeLogisticsRow(row) {
  if (!row) return row;
  const out = { ...row };
  const textKeys = [
    'related_project_code',
    'project_code',
    'remarks',
    'tracking_number',
    'origin_city',
    'destination_city',
    'logistics_company',
    'express_company',
    'settlement_month',
    'brand',
    'payee_name',
    'payment_status',
  ];
  textKeys.forEach((k) => {
    if (out[k] != null && Buffer.isBuffer(out[k])) out[k] = out[k].toString('utf8');
  });
  if (out.related_project_code != null) {
    out.related_project_code = String(out.related_project_code).replace(/^\uFEFF/, '').trim() || null;
  }
  if (
    (out.related_project_code == null || out.related_project_code === '') &&
    out.project_code != null &&
    out.project_code !== ''
  ) {
    const pc = String(out.project_code).replace(/^\uFEFF/, '').trim();
    out.related_project_code = pc || null;
  }
  return out;
}

function parseInventoryOutboundIdFromRemarks(remarks) {
  const m = String(remarks || '').match(/\[INV-OB:(\d+)\]/);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  return Number.isFinite(id) ? id : null;
}

async function enrichLogisticsRowsWithOutboundTracking(rows) {
  const serializedRows = (rows || []).map(serializeLogisticsRow);
  const outboundIds = [
    ...new Set(
      serializedRows
        .filter((row) => !String(row.tracking_number || '').trim())
        .map((row) => parseInventoryOutboundIdFromRemarks(row.remarks))
        .filter(Number.isFinite)
    ),
  ];
  if (!outboundIds.length) return serializedRows;

  const [orders] = await db.query(
    `SELECT id, tracking_number FROM inv_outbound_orders WHERE id IN (${outboundIds.map(() => '?').join(',')})`,
    outboundIds
  );
  const trackingByOutboundId = new Map(
    orders
      .map((row) => [Number(row.id), row.tracking_number != null ? String(row.tracking_number).trim() : ''])
      .filter(([, trackingNumber]) => trackingNumber)
  );
  if (!trackingByOutboundId.size) return serializedRows;

  return serializedRows.map((row) => {
    if (String(row.tracking_number || '').trim()) return row;
    const outboundId = parseInventoryOutboundIdFromRemarks(row.remarks);
    const trackingNumber = trackingByOutboundId.get(outboundId);
    return trackingNumber ? { ...row, tracking_number: trackingNumber } : row;
  });
}

function canonicalBrand(brand) {
  const v = String(brand || '').trim();
  return LOGISTICS_BRANDS.has(v) ? v : 'PHD';
}

async function fetchLogisticsRowById(id) {
  const nid = parseInt(id, 10);
  if (!Number.isFinite(nid)) return null;
  const [rows] = await db.query(LOGISTICS_ROW_SQL, [nid]);
  const enrichedRows = await enrichLogisticsRowsWithOutboundTracking(rows);
  return enrichedRows.length ? enrichedRows[0] : null;
}

// 获取物流列表
router.get('/', async (req, res) => {
  try {
    const { yearFrameId, logisticsCompany } = req.query;
    
    let sql = `
      SELECT l.*, yf.year as year_frame_name
      FROM logistics l
      LEFT JOIN year_frames yf ON l.year_frame_id = yf.id
      WHERE 1=1
    `;
    const params = [];
    
    if (yearFrameId) {
      sql += ' AND l.year_frame_id = ?';
      params.push(yearFrameId);
    }
    if (logisticsCompany) {
      sql += ' AND l.logistics_company = ?';
      params.push(logisticsCompany);
    }
    
    sql += ' ORDER BY l.shipping_date DESC';
    
    const [rows] = await db.query(sql, params);
    res.json(await enrichLogisticsRowsWithOutboundTracking(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 统计物流费用
router.get('/summary', async (req, res) => {
  try {
    const { yearFrameId } = req.query;
    
    let sql = `
      SELECT 
        logistics_company,
        COUNT(*) as count,
        SUM(fee) as total_fee,
        SUM(CASE WHEN COALESCE(merged_into_activity, 0) = 0 THEN fee ELSE 0 END) as pooled_fee,
        SUM(CASE WHEN COALESCE(merged_into_activity, 0) = 1 THEN fee ELSE 0 END) as merged_fee
      FROM logistics
      WHERE 1=1
    `;
    const params = [];
    
    if (yearFrameId) {
      sql += ' AND year_frame_id = ?';
      params.push(yearFrameId);
    }
    
    sql += ' GROUP BY logistics_company ORDER BY total_fee DESC';
    
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 单条物流（须在 /summary 之后注册，避免 "summary" 被当成 id）
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: '无效的记录 ID' });
    }
    const row = await fetchLogisticsRowById(id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建物流记录
router.post('/', async (req, res) => {
  try {
    const { year_frame_id, activity_id, merged_into_activity, allocation_note, payee_name, logistics_company, express_company, tracking_number, origin_city, destination_city, shipping_date, fee, remarks, special_car, monthly_settlement, settlement_month, brand } = req.body;
    const relatedProjectCode = parseRelatedProjectCodeFromBody(req.body);
    const yfid = parseInt(year_frame_id, 10);
    const activityId = activity_id != null && String(activity_id).trim() !== '' ? parseInt(activity_id, 10) : null;
    const mergedFlag = merged_into_activity === true || merged_into_activity === 1 || String(merged_into_activity) === '1' ? 1 : 0;
    if (!Number.isFinite(yfid)) {
      return res.status(400).json({ error: '无效的年框（年份）' });
    }
    const feeNum = fee != null && fee !== '' ? parseFloat(fee) : 0;

    const settlementMonthInput =
      settlement_month != null && String(settlement_month).trim() !== '' ? String(settlement_month).trim() : null;
    const monthlySettlement = monthly_settlement ? 1 : (settlementMonthInput ? 1 : 0);
    const specialCar = monthlySettlement ? 0 : (special_car ? 1 : 0);
    const expressCompany = monthlySettlement || specialCar
      ? null
      : (express_company != null && String(express_company).trim() !== '' ? String(express_company).trim() : null);
    const trackingNumber = monthlySettlement || specialCar
      ? null
      : (tracking_number != null && String(tracking_number).trim() !== '' ? String(tracking_number).trim() : null);
    const settlementMonth = monthlySettlement ? settlementMonthInput : null;
    const logisticsBrand = canonicalBrand(brand);

    const [result] = await db.query(`
      INSERT INTO logistics (year_frame_id, activity_id, merged_into_activity, allocation_note, payee_name, logistics_company, brand, express_company, tracking_number, settlement_month, origin_city, destination_city, shipping_date, fee, related_project_code, remarks, special_car, monthly_settlement)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      yfid,
      Number.isFinite(activityId) ? activityId : null,
      mergedFlag,
      allocation_note || null,
      payee_name || null,
      logistics_company,
      logisticsBrand,
      expressCompany,
      trackingNumber,
      settlementMonth,
      origin_city,
      destination_city,
      shipping_date,
      Number.isFinite(feeNum) ? feeNum : 0,
      relatedProjectCode,
      remarks != null ? remarks : null,
      specialCar,
      monthlySettlement,
    ]);

    const saved = await fetchLogisticsRowById(result.insertId);
    res.json(saved || { id: result.insertId, message: '创建成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量更新费用
router.post('/batch-update-fee', async (req, res) => {
  try {
    const { updates } = req.body; // [{id, fee}, ...]
    
    for (const item of updates) {
      await db.query('UPDATE logistics SET fee = ? WHERE id = ?', [item.fee, item.id]);
    }
    
    res.json({ message: `成功更新 ${updates.length} 条记录` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新物流记录
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const nid = parseInt(id, 10);
    if (!Number.isFinite(nid)) {
      return res.status(400).json({ error: '无效的记录 ID' });
    }
    const { activity_id, merged_into_activity, allocation_note, payee_name, logistics_company, express_company, tracking_number, origin_city, destination_city, shipping_date, fee, remarks, special_car, monthly_settlement, settlement_month, brand } = req.body;
    const activityId = activity_id != null && String(activity_id).trim() !== '' ? parseInt(activity_id, 10) : null;
    const mergedFlag = merged_into_activity === true || merged_into_activity === 1 || String(merged_into_activity) === '1' ? 1 : 0;
    const relatedProjectCode = parseRelatedProjectCodeFromBody(req.body);
    const feeNum = fee != null && fee !== '' ? parseFloat(fee) : 0;
    const settlementMonthInput =
      settlement_month != null && String(settlement_month).trim() !== '' ? String(settlement_month).trim() : null;
    const monthlySettlement = monthly_settlement ? 1 : (settlementMonthInput ? 1 : 0);
    const specialCar = monthlySettlement ? 0 : (special_car ? 1 : 0);
    const expressCompany = monthlySettlement || specialCar
      ? null
      : (express_company != null && String(express_company).trim() !== '' ? String(express_company).trim() : null);
    const trackingNumber = monthlySettlement || specialCar
      ? null
      : (tracking_number != null && String(tracking_number).trim() !== '' ? String(tracking_number).trim() : null);
    const settlementMonth = monthlySettlement ? settlementMonthInput : null;
    const logisticsBrand = canonicalBrand(brand);

    await db.query(`
      UPDATE logistics SET
        activity_id = ?, merged_into_activity = ?, allocation_note = ?, payee_name = ?,
        logistics_company = ?, brand = ?, express_company = ?, tracking_number = ?, settlement_month = ?,
        origin_city = ?, destination_city = ?, shipping_date = ?,
        fee = ?, related_project_code = ?, remarks = ?, special_car = ?, monthly_settlement = ?
      WHERE id = ?
    `, [
      Number.isFinite(activityId) ? activityId : null,
      mergedFlag,
      allocation_note || null,
      payee_name || null,
      logistics_company,
      logisticsBrand,
      expressCompany,
      trackingNumber,
      settlementMonth,
      origin_city,
      destination_city,
      shipping_date,
      Number.isFinite(feeNum) ? feeNum : 0,
      relatedProjectCode,
      remarks != null ? remarks : null,
      specialCar,
      monthlySettlement,
      nid,
    ]);

    const saved = await fetchLogisticsRowById(nid);
    res.json(saved || { message: '更新成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除物流记录
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM logistics WHERE id = ?', [id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
