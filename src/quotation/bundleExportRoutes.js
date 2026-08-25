const express = require('express');
const { streamBundledQuotationPdf } = require('./buildQuotationPdf');
const {
  streamBundledQuotationExcel,
  streamBundledQuotationExcelWithLayout,
} = require('./buildQuotationExcel');
const { mergeSessionWithTotals } = require('./multiSummaryItems');
const {
  normalizeEventDate,
  parseJsonArray,
  shouldTreatAsMergedBundle,
  sortSingleQuotesByEventDateAsc,
} = require('./routeUtils');
const {
  loadOrderedSingleQuotesByIds,
  loadQuotation,
  loadQuotationsByIds,
  loadSingleQuotesByQuotationNos,
  loadSingleQuotesForMultiQuote,
} = require('./routeLoaders');

const router = express.Router();

router.get('/:id/bundle-edit', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    if (String(row.quote_mode || 'single') !== 'multi') {
      return res.status(400).json({ error: '仅合并多场报价支持 bundle 编辑' });
    }
    const mergedFromIds = parseJsonArray(row.merged_from_quote_ids);
    const singles = await loadSingleQuotesForMultiQuote(row);
    if (!shouldTreatAsMergedBundle(row, mergedFromIds, singles)) {
      return res.status(400).json({ error: '该报价不是由单场报价合并生成，请使用多场编辑' });
    }
    res.json({
      data: {
        parent: {
          id: row.id,
          quotation_no: row.quotation_no,
          project_name: row.project_name,
          quote_mode: row.quote_mode,
          merged_from_quote_ids: mergedFromIds,
        },
        singles: singles || [],
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message || '加载合并编辑数据失败' });
  }
});

router.get('/:id/bundle-preview', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    if (String(row.quote_mode || 'single') !== 'multi') return res.json({ data: [] });
    const mergedFromIds = parseJsonArray(row.merged_from_quote_ids);
    const singles = await loadSingleQuotesForMultiQuote(row);
    if (!shouldTreatAsMergedBundle(row, mergedFromIds, singles)) return res.json({ data: [] });
    res.json({ data: singles || [] });
  } catch (e) {
    res.status(500).json({ error: e.message || '加载预览失败' });
  }
});

router.get('/bundle/export-excel', async (req, res) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((x) => parseInt(x, 10))
      .filter(Number.isFinite);
    const uniqIds = [...new Set(ids)];
    if (uniqIds.length < 2) return res.status(400).json({ error: '请至少选择 2 条报价导出汇总' });
    const quotes = await loadQuotationsByIds(uniqIds);
    if (quotes.length !== uniqIds.length) return res.status(404).json({ error: '部分报价不存在，导出已取消' });
    if (quotes.some((q) => String(q.quote_mode || 'single') !== 'single')) {
      return res.status(400).json({ error: '汇总导出仅支持单场报价，请取消多场报价后重试' });
    }
    const yearSet = new Set(quotes.map((q) => Number(q.year_frame_id)));
    if (yearSet.size > 1) return res.status(400).json({ error: '仅支持同一财年的报价合并导出' });
    const ordered = quotes.slice();
    const baseName = `${ordered[0].project_name || '报价'}-summary`;
    await streamBundledQuotationExcel(res, ordered, baseName);
  } catch (e) {
    console.error('报价汇总 Excel 导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || '汇总 Excel 导出失败' });
  }
});

router.post('/bundle/preview', async (req, res) => {
  try {
    let orderedIds = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x) => parseInt(x, 10)).filter(Number.isFinite)
      : [];
    if (!orderedIds.length && Array.isArray(req.body?.quotation_nos)) {
      const qtNos = req.body.quotation_nos
        .map((n) => String(n || '').trim().toUpperCase())
        .filter(Boolean);
      const quotesByNo = await loadSingleQuotesByQuotationNos(qtNos);
      orderedIds = quotesByNo.map((q) => Number(q.id)).filter(Number.isFinite);
    }
    const uniqIds = [...new Set(orderedIds)];
    if (!uniqIds.length) return res.status(400).json({ error: '请至少选择 1 条报价' });
    const quotes = sortSingleQuotesByEventDateAsc(await loadOrderedSingleQuotesByIds(orderedIds));
    if (quotes.length !== orderedIds.length) return res.status(404).json({ error: '部分报价不存在，请刷新后重试' });
    if (quotes.some((q) => String(q.quote_mode || 'single') !== 'single')) {
      return res.status(400).json({ error: '导出报价预览仅支持单场报价' });
    }
    const data = quotes.map((q) => ({
      id: q.id,
      activity_id: q.activity_id,
      quotation_no: q.quotation_no,
      project_name: q.project_name,
      project_code: q.project_code,
      client_brand: q.client_brand,
      client_contact: q.client_contact,
      city: q.city,
      customer_name: q.customer_name,
      event_date: q.event_date,
      event_type: q.event_type,
      total_amount: q.total_amount,
      subtotal_ex_tax: q.subtotal_ex_tax,
      service_charge: q.service_charge,
      tax_amount: q.tax_amount,
      service_rate: q.service_rate,
      tax_rate: q.tax_rate,
      items: q.items || [],
    }));
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message || '加载导出预览失败' });
  }
});

function buildPreviewBundleMultiStub(quotes, projectName) {
  const linked_sessions = quotes.map((q, i) =>
    mergeSessionWithTotals({
      activity_id: q.activity_id,
      project_code: q.project_code || '',
      event_date: normalizeEventDate(q.event_date),
      city: q.city || '',
      customer_name: q.customer_name || '',
      event_type: q.event_type || '',
      remarks: '',
      sort_order: i,
      fee_comm: Number(q.subtotal_ex_tax) || 0,
      fee_executor: 0,
      fee_design: 0,
      fee_freight: 0,
      fee_print: 0,
      fee_photo: 0,
    })
  );
  return {
    quote_mode: 'multi',
    project_name: projectName || quotes[0]?.project_name || '合并报价',
    client_brand: quotes[0]?.client_brand || 'REMY COINTREAU',
    client_contact: quotes[0]?.client_contact || '',
    linked_sessions,
  };
}

router.post('/bundle/export-pdf', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x) => parseInt(x, 10)).filter(Number.isFinite)
      : [];
    const uniqIds = [...new Set(ids)];
    if (uniqIds.length < 1) return res.status(400).json({ error: '请至少选择 1 条报价导出' });
    const quotes = sortSingleQuotesByEventDateAsc(await loadQuotationsByIds(uniqIds));
    if (quotes.length !== uniqIds.length) return res.status(404).json({ error: '部分报价不存在，导出已取消' });
    if (quotes.some((q) => String(q.quote_mode || 'single') !== 'single')) {
      return res.status(400).json({ error: '仅支持单场报价导出' });
    }
    const yearSet = new Set(quotes.map((q) => Number(q.year_frame_id)));
    if (yearSet.size > 1) return res.status(400).json({ error: '仅支持同一财年的报价合并导出' });
    const projectName = String(req.body?.project_name || '').trim() || quotes[0]?.project_name || '合并报价';
    const multiStub = buildPreviewBundleMultiStub(quotes, projectName);
    const layoutByQuoteId =
      req.body?.layoutByQuoteId && typeof req.body.layoutByQuoteId === 'object'
        ? req.body.layoutByQuoteId
        : {};
    const pageOrientation =
      String(req.body?.pageOrientation || 'landscape').toLowerCase() === 'portrait'
        ? 'portrait'
        : 'landscape';
    await streamBundledQuotationPdf(res, multiStub, quotes, { layoutByQuoteId, pageOrientation });
  } catch (e) {
    console.error('报价汇总 PDF 导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || '汇总 PDF 导出失败' });
  }
});

router.post('/bundle/export-excel', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x) => parseInt(x, 10)).filter(Number.isFinite)
      : [];
    const uniqIds = [...new Set(ids)];
    if (uniqIds.length < 1) return res.status(400).json({ error: '请至少选择 1 条报价导出' });
    const quotes = sortSingleQuotesByEventDateAsc(await loadQuotationsByIds(uniqIds));
    if (quotes.length !== uniqIds.length) return res.status(404).json({ error: '部分报价不存在，导出已取消' });
    if (quotes.some((q) => String(q.quote_mode || 'single') !== 'single')) {
      return res.status(400).json({ error: '仅支持单场报价导出' });
    }
    const yearSet = new Set(quotes.map((q) => Number(q.year_frame_id)));
    if (yearSet.size > 1) return res.status(400).json({ error: '仅支持同一财年的报价合并导出' });
    const ordered = quotes;
    const baseName = `${ordered[0].project_name || '报价'}-summary`;
    const layoutByQuoteId = req.body?.layoutByQuoteId && typeof req.body.layoutByQuoteId === 'object'
      ? req.body.layoutByQuoteId
      : {};
    await streamBundledQuotationExcelWithLayout(res, ordered, baseName, layoutByQuoteId);
  } catch (e) {
    console.error('报价汇总 Excel（带版式）导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || '汇总 Excel 导出失败' });
  }
});

module.exports = router;
