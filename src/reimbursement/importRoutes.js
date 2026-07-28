const express = require('express');
const multer = require('multer');
const {
  importReimbursementFromExcelBuffer,
  previewReimbursementFromExcelBuffer,
} = require('./importReimbursementFromExcel');
const { formatDateTimeMinute } = require('../lib/businessTime');

const router = express.Router();
const reimbImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const ok = name.endsWith('.xlsx') || name.endsWith('.xls');
    cb(ok ? null : new Error('仅支持 .xlsx 或 .xls 文件'), ok);
  },
});

router.post('/import/preview', (req, res) => {
  reimbImportUpload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || '文件上传失败' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: '请选择要导入的 Excel 文件' });
    }
    try {
      const yearFrameId = req.body && req.body.yearFrameId != null ? Number(req.body.yearFrameId) : null;
      if (!Number.isFinite(yearFrameId)) {
        return res.status(400).json({ error: '缺少 yearFrameId' });
      }
      const payeeName = req.body && req.body.payeeName != null ? String(req.body.payeeName).trim() : '';
      const date = req.body && req.body.date != null ? String(req.body.date).slice(0, 10) : '';
      const syncActivity = req.body && String(req.body.syncActivity) === '0' ? false : true;
      const result = await previewReimbursementFromExcelBuffer(req.file.buffer, {
        yearFrameId,
        payeeName: payeeName || undefined,
        date: date || undefined,
        syncActivity,
      });
      res.json({ data: result, message: result.message });
    } catch (error) {
      res.status(400).json({ error: error.message || '预览失败' });
    }
  });
});

// 批量导入成本登记（Excel 报销单）
router.post('/import', (req, res) => {
  reimbImportUpload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || '文件上传失败' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: '请选择要导入的 Excel 文件' });
    }
    try {
      const yearFrameId = req.body && req.body.yearFrameId != null ? Number(req.body.yearFrameId) : null;
      if (!Number.isFinite(yearFrameId)) {
        return res.status(400).json({ error: '缺少 yearFrameId' });
      }
      const payeeName = req.body && req.body.payeeName != null ? String(req.body.payeeName).trim() : '';
      const date = req.body && req.body.date != null ? String(req.body.date).slice(0, 10) : '';
      const syncActivity = req.body && String(req.body.syncActivity) === '0' ? false : true;
      const result = await importReimbursementFromExcelBuffer(req.file.buffer, {
        yearFrameId,
        payeeName: payeeName || undefined,
        date: date || undefined,
        syncActivity,
      });
      const atBj = formatDateTimeMinute(new Date());
      res.json({
        data: result,
        importedAtBeijing: atBj,
        message: `${result.message}（北京时间 ${atBj}）`,
      });
    } catch (error) {
      res.status(400).json({ error: error.message || '导入失败' });
    }
  });
});

module.exports = router;
