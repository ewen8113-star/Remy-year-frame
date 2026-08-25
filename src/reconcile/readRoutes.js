const express = require('express');
const db = require('../config/database');
const { cleanCell } = require('./parseLogisticsBillExcel');
const {
  fetchBatch,
  fetchLines,
  serializeBatch,
} = require('./routeHelpers');

const router = express.Router();

router.get('/batches', async (req, res) => {
  try {
    const yearFrameId = req.query.yearFrameId != null ? parseInt(req.query.yearFrameId, 10) : null;
    const batchType = cleanCell(req.query.type || 'logistics') || 'logistics';
    let sql = 'SELECT * FROM reconciliation_batches WHERE batch_type = ?';
    const params = [batchType];
    if (Number.isFinite(yearFrameId)) {
      sql += ' AND year_frame_id = ?';
      params.push(yearFrameId);
    }
    sql += ' ORDER BY id DESC LIMIT 100';
    const [rows] = await db.query(sql, params);
    res.json({ data: (rows || []).map(serializeBatch) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批次详情
router.get('/batches/:id', async (req, res) => {
  try {
    const batch = await fetchBatch(req.params.id);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const lines = await fetchLines(batch.id);
    res.json({ data: { batch, lines } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
