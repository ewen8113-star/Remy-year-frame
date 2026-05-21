/**
 * 多场报价预览/导出表格（与前端 activity-quotes 预览列一致）
 */
const { MULTI_SUMMARY_FEE_LINES, mergeSessionWithTotals, calcMultiGrandTotals } = require('./multiSummaryItems');

function fmtNum(n, dec = 2) {
  const x = parseFloat(n);
  if (!Number.isFinite(x)) return dec > 0 ? '0.00' : '0';
  return x.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function normalizeEventDate(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
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

function colsBeforeTotals() {
  return 4 + MULTI_SUMMARY_FEE_LINES.length;
}

function getMultiTableHeaders() {
  return [
    '日期',
    '城市',
    '客户名称',
    '类型',
    ...MULTI_SUMMARY_FEE_LINES.map((c) => c.description),
    '小计',
    '服务费10%',
    '税费6%',
    '合计',
    '备注',
  ];
}

function buildMultiPreviewTableData(q) {
  const sessions = (q.linked_sessions || []).map((s) => mergeSessionWithTotals(s));
  const headers = getMultiTableHeaders();
  const dataRows = sessions.map((s) => {
    const fees = MULTI_SUMMARY_FEE_LINES.map((col) => ({
      key: col.key,
      amount: Number(s[col.key]) || 0,
    }));
    return {
      session: s,
      cells: [
        cellOrDash(normalizeEventDate(s.event_date)),
        cellOrDash(s.city),
        cellOrDash(s.customer_name),
        cellOrDash(s.event_type),
        ...fees.map((f) => f.amount),
        Number(s.subtotal_ex_tax) || 0,
        Number(s.service_charge) || 0,
        Number(s.tax_amount) || 0,
        Number(s.row_total) || 0,
        cellOrDash(sanitizeSessionRemarks(s.remarks)),
      ],
      feeAmounts: fees.map((f) => f.amount),
    };
  });

  const totals = calcMultiGrandTotals(sessions);
  const spanBefore = colsBeforeTotals();
  const footerCells = new Array(headers.length).fill('');
  footerCells[0] = '多场含税总计';
  footerCells[spanBefore] = totals.subtotalExTax;
  footerCells[spanBefore + 1] = totals.serviceCharge;
  footerCells[spanBefore + 2] = totals.taxAmount;
  footerCells[spanBefore + 3] = totals.totalAmount;

  return {
    headers,
    dataRows,
    footerCells,
    totals,
    spanBeforeTotals: spanBefore,
    colCount: headers.length,
    /** 费用列在表头中的 0-based 起始索引 */
    feeColStart: 4,
    /** 小计/服务费/税费/合计列索引 */
    subtotalCol: spanBefore,
    serviceCol: spanBefore + 1,
    taxCol: spanBefore + 2,
    totalCol: spanBefore + 3,
    remarksCol: spanBefore + 4,
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
  sanitizeSessionRemarks,
  isMultiQuote,
};
