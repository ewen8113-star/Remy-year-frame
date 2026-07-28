const express = require('express');
const multer = require('multer');
const db = require('../config/database');
const {
  DEFAULT_PAYEE,
  parseLogisticsBillExcelBuffer,
  cleanCell,
} = require('./parseLogisticsBillExcel');
const {
  LINE_INSERT_SQL,
  assertEditable,
  fetchBatch,
  fetchLines,
  insertLineParams,
  loadActivitiesForYearFrame,
  normalizeYm,
} = require('./routeHelpers');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.post('/logistics/upload', (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message || '上传失败' });
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: '请选择 Excel 文件' });
    const conn = await db.getConnection();
    try {
      const yearFrameId = parseInt(req.body.yearFrameId, 10);
      if (!Number.isFinite(yearFrameId)) {
        return res.status(400).json({ error: '缺少 yearFrameId' });
      }
      const activities = await loadActivitiesForYearFrame(yearFrameId);
      const parsed = parseLogisticsBillExcelBuffer(req.file.buffer, {
        activities,
        filename: req.file.originalname,
        settlementMonth: normalizeYm(req.body.settlementMonth) || undefined,
        payeeName: cleanCell(req.body.payeeName) || DEFAULT_PAYEE,
      });
      const settlementMonth = normalizeYm(parsed.settlement_month);
      if (!settlementMonth) return res.status(400).json({ error: '无法识别对账月份' });

      await conn.beginTransaction();
      const [result] = await conn.query(
        `INSERT INTO reconciliation_batches
          (year_frame_id, batch_type, settlement_month, payee_name, source_filename, status, summary_json, created_by)
         VALUES (?, 'logistics', ?, ?, ?, 'draft', ?, ?)`,
        [
          yearFrameId,
          settlementMonth,
          parsed.payee_name || DEFAULT_PAYEE,
          req.file.originalname || null,
          JSON.stringify(parsed.summary),
          req.session?.user?.id || null,
        ]
      );
      const batchId = result.insertId;
      for (const line of parsed.lines) {
        await conn.query(LINE_INSERT_SQL, insertLineParams(batchId, line));
      }
      await conn.commit();
      const batch = await fetchBatch(batchId);
      const lines = await fetchLines(batchId);
      res.json({
        data: { batch, lines },
        message: `已导入临时区 ${lines.length} 行（仓储费等已自动跳过）`,
      });
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) { /* ignore */ }
      res.status(400).json({ error: error.message || '解析失败' });
    } finally {
      conn.release();
    }
  });
});

// 更新批次头信息
router.patch('/batches/:id', async (req, res) => {
  try {
    const batch = await fetchBatch(req.params.id);
    assertEditable(batch);
    const payee = req.body.payee_name != null ? cleanCell(req.body.payee_name) : batch.payee_name;
    const ym = req.body.settlement_month != null ? normalizeYm(req.body.settlement_month) : batch.settlement_month;
    if (!ym) return res.status(400).json({ error: '对账月份格式应为 YYYY-MM' });
    const note = req.body.note != null ? cleanCell(req.body.note).slice(0, 500) : batch.note;
    await db.query(
      'UPDATE reconciliation_batches SET payee_name = ?, settlement_month = ?, note = ? WHERE id = ?',
      [payee || DEFAULT_PAYEE, ym, note || null, batch.id]
    );
    res.json({ data: await fetchBatch(batch.id), message: '已保存' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// 删除草稿批次
router.delete('/batches/:id', async (req, res) => {
  try {
    const batch = await fetchBatch(req.params.id);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    if (batch.status === 'committed') {
      return res.status(400).json({ error: '已入库批次不可删除' });
    }
    await db.query('DELETE FROM reconciliation_batches WHERE id = ?', [batch.id]);
    res.json({ message: '已删除' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
