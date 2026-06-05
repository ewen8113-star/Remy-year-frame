/**
 * 合并报价 Summary：固定信息列 + 费用大板块列 + 合计列（多场固定 6 列）
 */
const { mergeSessionWithTotals, calcMultiGrandTotals } = require('./multiSummaryItems');
const {
  collectVisibleSectionColumns,
  collectAllSessionFeeSectionColumns,
  sectionTotalsFromSession,
  sectionTotalsFromQuote,
  getSectionAmountForRow,
  amountPositive,
} = require('./summarySectionColumns');

const FIXED_HEADERS = ['日期', '城市', '客户名称', '类型'];
const REMARKS_HEADER = '备注';

const TOTAL_COLUMN_DEFS = [
  { key: 'subtotal_ex_tax', label: '小计', totalKey: 'subtotalExTax', quoteKey: 'subtotal_ex_tax' },
  { key: 'service_charge', label: '服务费10%', totalKey: 'serviceCharge', quoteKey: 'service_charge' },
  { key: 'tax_amount', label: '税费6%', totalKey: 'taxAmount', quoteKey: 'tax_amount' },
  { key: 'row_total', label: '合计', totalKey: 'totalAmount', quoteKey: 'total_amount' },
];

function getVisibleTotalColumnsFromSessions(sessions) {
  const merged = (sessions || []).map((s) => mergeSessionWithTotals(s));
  const totals = calcMultiGrandTotals(sessions || []);
  return TOTAL_COLUMN_DEFS.filter((col) => {
    const rowAny = merged.some((s) => amountPositive(s[col.key]));
    const foot = amountPositive(totals[col.totalKey]);
    return rowAny || foot;
  });
}

function getVisibleTotalColumnsFromQuotes(quotes) {
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
  return TOTAL_COLUMN_DEFS.filter((col) => {
    const rowAny = (quotes || []).some((q) => amountPositive(q[col.quoteKey]));
    const foot = amountPositive(totals[col.totalKey]);
    return rowAny || foot;
  });
}

function buildSummaryColumnModel({ sessions, quotes }) {
  const useQuotes = Array.isArray(quotes) && quotes.length > 0;
  const rowSectionsList = useQuotes
    ? (quotes || []).map((q) => sectionTotalsFromQuote(q))
    : (sessions || []).map((s) => sectionTotalsFromSession(s));

  const sectionColumns = useQuotes
    ? collectVisibleSectionColumns(rowSectionsList)
    : collectAllSessionFeeSectionColumns();
  const totalColumns = useQuotes
    ? getVisibleTotalColumnsFromQuotes(quotes)
    : getVisibleTotalColumnsFromSessions(sessions || []);

  const headers = [
    ...FIXED_HEADERS,
    ...sectionColumns.map((c) => c.section_name),
    ...totalColumns.map((c) => c.label),
    REMARKS_HEADER,
  ];
  const spanBeforeTotals = FIXED_HEADERS.length + sectionColumns.length;
  const totalColCount = totalColumns.length;
  const colIndexForTotalKey = (key) => {
    const i = totalColumns.findIndex((c) => c.key === key);
    return i < 0 ? -1 : spanBeforeTotals + i;
  };
  return {
    headers,
    sectionColumns,
    totalColumns,
    fixedCount: FIXED_HEADERS.length,
    feeColStart: FIXED_HEADERS.length,
    spanBeforeTotals,
    feeColEnd: sectionColumns.length ? spanBeforeTotals - 1 : -1,
    totalColCount,
    totalCol: totalColCount ? spanBeforeTotals + totalColCount - 1 : spanBeforeTotals - 1,
    subtotalCol: colIndexForTotalKey('subtotal_ex_tax'),
    serviceCol: colIndexForTotalKey('service_charge'),
    taxCol: colIndexForTotalKey('tax_amount'),
    totalColKey: colIndexForTotalKey('row_total'),
    remarksCol: headers.length - 1,
    colCount: headers.length,
    colIndexForTotalKey,
    rowSectionsList,
    getSectionAmountForRow,
  };
}

module.exports = {
  FIXED_HEADERS,
  REMARKS_HEADER,
  TOTAL_COLUMN_DEFS,
  amountPositive,
  buildSummaryColumnModel,
};
