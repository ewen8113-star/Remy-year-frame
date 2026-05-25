/**
 * 多场报价预览/导出表格（与前端 activity-quotes 预览列一致）
 */
const { MULTI_SUMMARY_FEE_LINES, mergeSessionWithTotals, calcMultiGrandTotals } = require('./multiSummaryItems');
const { buildSummaryColumnModel, TOTAL_COLUMN_DEFS } = require('./summaryColumnVisibility');
const {
  sectionTotalsFromSession,
  sectionTotalsFromQuote,
  getSectionAmountForRow,
} = require('./summarySectionColumns');

function fmtNum(n, dec = 2) {
  const x = parseFloat(n);
  if (!Number.isFinite(x)) return dec > 0 ? '0.00' : '0';
  return x.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

const { toCalendarDateYmd } = require('./calendarDate');

function normalizeEventDate(raw) {
  return toCalendarDateYmd(raw);
}

function cellOrDash(v) {
  const t = v == null ? '' : String(v).trim();
  return t || '—';
}

/** Summary 备注：仅保留用户填写内容，去掉「来自报价 QT-xxx」等系统标记（勿用 \\b，中文词边界无效） */
function sanitizeSessionRemarks(raw) {
  const t = raw == null ? '' : String(raw).trim();
  if (!t) return '';
  if (/^来自报价/i.test(t)) return '';
  const cleaned = t.replace(/来自报价\s*(?:QT-\d{8}-\d{3})?\s*/gi, '').trim();
  if (!cleaned || /^来自报价/i.test(cleaned)) return '';
  return cleaned;
}

function colsBeforeTotals(feeColCount = MULTI_SUMMARY_FEE_LINES.length) {
  return 4 + feeColCount;
}

function getMultiTableHeaders(q) {
  const sessions = (q?.linked_sessions || []).map((s) => mergeSessionWithTotals(s));
  return buildSummaryColumnModel({ sessions }).headers;
}

function buildRowCellsFromSession(s, columns) {
  const merged = mergeSessionWithTotals(s);
  const secs = sectionTotalsFromSession(s);
  return [
    cellOrDash(normalizeEventDate(merged.event_date)),
    cellOrDash(merged.city),
    cellOrDash(merged.customer_name),
    cellOrDash(merged.event_type),
    ...columns.sectionColumns.map((col) =>
      getSectionAmountForRow(secs, col.section_code, col.section_name)
    ),
    ...columns.totalColumns.map((col) => Number(merged[col.key]) || 0),
    cellOrDash(sanitizeSessionRemarks(merged.remarks)),
  ];
}

function buildRowCellsFromQuote(q, columns) {
  const secs = sectionTotalsFromQuote(q);
  const merged = mergeSessionWithTotals(q);
  return [
    cellOrDash(normalizeEventDate(q.event_date)),
    cellOrDash(q.city),
    cellOrDash(q.customer_name),
    cellOrDash(q.event_type),
    ...columns.sectionColumns.map((col) =>
      getSectionAmountForRow(secs, col.section_code, col.section_name)
    ),
    ...columns.totalColumns.map((col) => {
      if (col.key === 'row_total') return Number(q.total_amount) || 0;
      if (col.key === 'subtotal_ex_tax') return Number(q.subtotal_ex_tax) || 0;
      if (col.key === 'service_charge') return Number(q.service_charge) || 0;
      if (col.key === 'tax_amount') return Number(q.tax_amount) || 0;
      return Number(merged[col.key]) || 0;
    }),
    '',
  ];
}

function buildMultiPreviewTableData(q) {
  const sessions = (q.linked_sessions || []).map((s) => mergeSessionWithTotals(s));
  const columns = buildSummaryColumnModel({ sessions });
  const headers = columns.headers;
  const dataRows = (q.linked_sessions || []).map((s) => ({
    session: mergeSessionWithTotals(s),
    cells: buildRowCellsFromSession(s, columns),
  }));

  const totals = calcMultiGrandTotals(q.linked_sessions || []);
  const footerCells = new Array(headers.length).fill('');
  footerCells[0] = '多场含税总计';
  columns.totalColumns.forEach((col, i) => {
    footerCells[columns.subtotalCol + i] = totals[col.totalKey];
  });

  return {
    headers,
    dataRows,
    footerCells,
    totals,
    columns,
    spanBeforeTotals: columns.spanBeforeTotals,
    colCount: columns.colCount,
    feeColStart: columns.feeColStart,
    subtotalCol: columns.subtotalCol,
    serviceCol: columns.serviceCol,
    taxCol: columns.taxCol,
    totalCol: columns.totalCol,
    remarksCol: columns.remarksCol,
    totalColumns: columns.totalColumns,
  };
}

/** 合并导出 Excel Summary（单场报价列表） */
function buildBundleSummaryTableData(quotes) {
  const columns = buildSummaryColumnModel({ quotes: quotes || [] });
  const headers = columns.headers;
  const dataRows = (quotes || []).map((q) => ({
    quote: q,
    cells: buildRowCellsFromQuote(q, columns),
  }));
  let subtotalExTax = 0;
  let serviceCharge = 0;
  let taxAmount = 0;
  let totalAmount = 0;
  (quotes || []).forEach((q) => {
    subtotalExTax += Number(q.subtotal_ex_tax) || 0;
    serviceCharge += Number(q.service_charge) || 0;
    taxAmount += Number(q.tax_amount) || 0;
    totalAmount += Number(q.total_amount) || 0;
  });
  const totals = { subtotalExTax, serviceCharge, taxAmount, totalAmount };
  const footerCells = new Array(headers.length).fill('');
  footerCells[0] = '多场含税总计';
  columns.totalColumns.forEach((col, i) => {
    footerCells[columns.subtotalCol + i] = totals[col.totalKey];
  });
  return {
    headers,
    dataRows,
    footerCells,
    totals,
    columns,
    spanBeforeTotals: columns.spanBeforeTotals,
    remarksCol: columns.remarksCol,
    totalCol: columns.totalCol,
    feeColStart: columns.feeColStart,
  };
}

function isMultiQuote(q) {
  return q && String(q.quote_mode || '').toLowerCase() === 'multi';
}

module.exports = {
  MULTI_SUMMARY_FEE_LINES,
  fmtNum,
  normalizeEventDate,
  colsBeforeTotals,
  getMultiTableHeaders,
  buildMultiPreviewTableData,
  buildBundleSummaryTableData,
  sanitizeSessionRemarks,
  isMultiQuote,
  buildSummaryColumnModel,
  TOTAL_COLUMN_DEFS,
};
