const express = require('express');
const db = require('../config/database');
const { createInventoryPdfPrinter, hasSystemUnicodeFont } = require('./pdfRuntime');
const { buildOutboundPdfPayload } = require('./outboundPdf');
const { loadOrderDetail } = require('./outboundHelpers');

const router = express.Router();

router.get('/outbound/:id/pdf', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const detail = await loadOrderDetail(db, id);
    if (!detail) return res.status(404).json({ error: '单据不存在' });
    const { order, lines } = detail;
    const { docDefinition, filename } = buildOutboundPdfPayload(order, lines, {
      hasSystemUnicodeFont,
    });

    const printer = createInventoryPdfPrinter();
    const pdfDocument = await printer.createPdfKitDocument(docDefinition);
    const encodedFilename = encodeURIComponent(filename);
    const asDownload = req.query.download === '1' || req.query.download === 'true';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      asDownload
        ? `attachment; filename*=UTF-8''${encodedFilename}`
        : `inline; filename*=UTF-8''${encodedFilename}`,
    );
    pdfDocument.pipe(res);
    pdfDocument.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'PDF 失败' });
  }
});

module.exports = router;
