const express = require('express');
const router = express.Router();
const db = require('../config/database');

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

async function fetchLogisticsRowById(id) {
  const nid = parseInt(id, 10);
  if (!Number.isFinite(nid)) return null;
  const [rows] = await db.query(LOGISTICS_ROW_SQL, [nid]);
  return rows.length ? serializeLogisticsRow(rows[0]) : null;
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
    res.json(rows.map(serializeLogisticsRow));
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
        SUM(fee) as total_fee
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
    const { year_frame_id, logistics_company, tracking_number, origin_city, destination_city, shipping_date, fee, remarks } = req.body;
    const relatedProjectCode = parseRelatedProjectCodeFromBody(req.body);
    const yfid = parseInt(year_frame_id, 10);
    if (!Number.isFinite(yfid)) {
      return res.status(400).json({ error: '无效的年框（年份）' });
    }
    const feeNum = fee != null && fee !== '' ? parseFloat(fee) : 0;

    const [result] = await db.query(`
      INSERT INTO logistics (year_frame_id, logistics_company, tracking_number, origin_city, destination_city, shipping_date, fee, related_project_code, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      yfid,
      logistics_company,
      tracking_number,
      origin_city,
      destination_city,
      shipping_date,
      Number.isFinite(feeNum) ? feeNum : 0,
      relatedProjectCode,
      remarks != null ? remarks : null,
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
    const { logistics_company, tracking_number, origin_city, destination_city, shipping_date, fee, remarks } = req.body;
    const relatedProjectCode = parseRelatedProjectCodeFromBody(req.body);
    const feeNum = fee != null && fee !== '' ? parseFloat(fee) : 0;

    await db.query(`
      UPDATE logistics SET
        logistics_company = ?, tracking_number = ?,
        origin_city = ?, destination_city = ?, shipping_date = ?,
        fee = ?, related_project_code = ?, remarks = ?
      WHERE id = ?
    `, [
      logistics_company,
      tracking_number,
      origin_city,
      destination_city,
      shipping_date,
      Number.isFinite(feeNum) ? feeNum : 0,
      relatedProjectCode,
      remarks != null ? remarks : null,
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
