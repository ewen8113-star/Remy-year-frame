const express = require('express');
const {
  streamQuotationPdf,
  streamBundledQuotationPdf,
} = require('./buildQuotationPdf');
const {
  streamQuotationExcel,
  streamBundledQuotationExcel,
  streamBundledQuotationExcelWithLayout,
} = require('./buildQuotationExcel');
const {
  parseJsonArray,
  shouldTreatAsMergedBundle,
} = require('./routeUtils');
const {
  loadQuotation,
  loadSingleQuotesForMultiQuote,
} = require('./routeLoaders');

const router = express.Router();

router.post('/:id/export-pdf', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    const layoutByQuoteId =
      req.body?.layoutByQuoteId && typeof req.body.layoutByQuoteId === 'object'
        ? req.body.layoutByQuoteId
        : {};
    const pageOrientation =
      String(req.body?.pageOrientation || 'landscape').toLowerCase() === 'portrait'
        ? 'portrait'
        : 'landscape';
    if (String(row.quote_mode || 'single') === 'multi') {
      const mergedFromIds = parseJsonArray(row.merged_from_quote_ids);
      const singles = await loadSingleQuotesForMultiQuote(row);
      if (shouldTreatAsMergedBundle(row, mergedFromIds, singles) && singles.length) {
        await streamBundledQuotationPdf(res, row, singles, { layoutByQuoteId, pageOrientation });
        return;
      }
    }
    await streamQuotationPdf(res, row);
  } catch (e) {
    console.error('报价 PDF（自定义版式）导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'PDF 导出失败' });
  }
});

router.post('/:id/export-excel', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    const layoutByQuoteId =
      req.body?.layoutByQuoteId && typeof req.body.layoutByQuoteId === 'object'
        ? req.body.layoutByQuoteId
        : {};
    if (String(row.quote_mode || 'single') === 'multi') {
      const mergedFromIds = parseJsonArray(row.merged_from_quote_ids);
      const singles = await loadSingleQuotesForMultiQuote(row);
      if (shouldTreatAsMergedBundle(row, mergedFromIds, singles) && singles.length) {
        const baseName = `${row.project_name || row.quotation_no || '报价'}-summary`;
        await streamBundledQuotationExcelWithLayout(res, singles, baseName, layoutByQuoteId);
        return;
      }
    }
    await streamQuotationExcel(res, row);
  } catch (e) {
    console.error('报价 Excel（自定义版式）导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'Excel 导出失败' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    if (String(row.quote_mode || 'single') === 'multi') {
      const mergedFromIds = parseJsonArray(row.merged_from_quote_ids);
      const singles = await loadSingleQuotesForMultiQuote(row);
      if (shouldTreatAsMergedBundle(row, mergedFromIds, singles) && singles.length) {
        await streamBundledQuotationPdf(res, row, singles);
        return;
      }
    }
    await streamQuotationPdf(res, row);
  } catch (e) {
    console.error('报价 PDF 导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'PDF 导出失败' });
  }
});

router.get('/:id/excel', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    if (String(row.quote_mode || 'single') === 'multi') {
      const mergedFromIds = parseJsonArray(row.merged_from_quote_ids);
      const singles = await loadSingleQuotesForMultiQuote(row);
      if (shouldTreatAsMergedBundle(row, mergedFromIds, singles) && singles.length) {
        const baseName = `${row.project_name || row.quotation_no || '报价'}-summary`;
        await streamBundledQuotationExcel(res, singles, baseName);
        return;
      }
    }
    await streamQuotationExcel(res, row);
  } catch (e) {
    console.error('报价 Excel 导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'Excel 导出失败' });
  }
});

module.exports = router;
