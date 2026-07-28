const { mergeSessionWithTotals } = require('./multiSummaryItems');
const { normalizeItemCategory } = require('./quotationItemCategories');
const { toCalendarDateYmd } = require('./calendarDate');

/** 从场次 executor + activity_type 推导报价 event_type */
function deriveEventTypeFromActivity(act) {
  if (!act) return null;
  const ex = String(act.executor || '').trim();
  const execution = ex === '无' || !ex ? '无' : '有';
  const kind = String(act.activity_type || '').trim() || '晚宴';
  return `${execution}执行${kind}`;
}

function roundMoney(v) {
  return Math.round((parseFloat(v) || 0) * 100) / 100;
}

function roundQty(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
}

function normalizeEventDate(raw) {
  const ymd = toCalendarDateYmd(raw);
  return ymd || null;
}

function normalizeItemRow(raw, sortOrder = 0) {
  const qty = roundQty(raw.quantity);
  const price = roundQty(raw.unit_price);
  return {
    section_code: String(raw.section_code || '').trim(),
    section_name: String(raw.section_name || '').trim(),
    subsection_code: String(raw.subsection_code || '').trim(),
    subsection_name: String(raw.subsection_name || '').trim(),
    description: String(raw.description || '').trim(),
    item_category: normalizeItemCategory(raw.item_category),
    quantity: qty,
    unit: raw.unit != null ? String(raw.unit).trim() : '',
    unit_price: price,
    subtotal: roundMoney(qty * price),
    remarks: raw.remarks != null ? String(raw.remarks).trim() : null,
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : sortOrder,
    is_custom: raw.is_custom ? 1 : 0,
    is_template: raw.is_template === false || raw.is_custom ? 0 : 1,
  };
}

function defaultServiceRate(raw, quoteMode) {
  if (String(quoteMode || '').toLowerCase() === 'multi') return 0.1;
  const n = parseFloat(raw);
  if (Number.isFinite(n) && n >= 0.1 && n <= 0.15) return n;
  return 0.1;
}

function parseLinkedSessions(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return [raw];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonArray(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw;
  if (Buffer.isBuffer(raw)) {
    try {
      const parsed = JSON.parse(raw.toString('utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeLinkedSessionRow(raw, sortOrder = 0) {
  const activityId = parseInt(raw.activity_id, 10);
  const base = {
    activity_id: Number.isFinite(activityId) ? activityId : null,
    project_code: String(raw.project_code || '').trim(),
    event_date: normalizeEventDate(raw.event_date),
    city: raw.city != null ? String(raw.city).trim() : '',
    customer_name: raw.customer_name != null ? String(raw.customer_name).trim() : '',
    event_type: raw.event_type != null ? String(raw.event_type).trim() : '',
    remarks: raw.remarks != null ? String(raw.remarks).trim() : '',
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : sortOrder,
  };
  return mergeSessionWithTotals({ ...raw, ...base });
}

/** 写入 quotations.project_code：单场用完整编号，多场用首条+场次数（避免 VARCHAR 超长） */
function projectCodesSummary(sessions) {
  const codes = (sessions || []).map((s) => String(s.project_code || '').trim()).filter(Boolean);
  if (!codes.length) return null;
  if (codes.length === 1) return codes[0];
  const first = codes[0];
  const suffix = ` 等${codes.length}场`;
  const maxLen = 480;
  if (first.length + suffix.length <= maxLen) return first + suffix;
  return first.slice(0, Math.max(1, maxLen - suffix.length)) + suffix;
}

/** 单场报价展示/保存：有关联场次时以 activities.date 为准 */
function resolveQuotationDisplayEventDate(row) {
  const fromActivity = normalizeEventDate(row?.activity_date);
  const fromQuote = normalizeEventDate(row?.event_date);
  const aid = parseInt(row?.activity_id, 10);
  if (Number.isFinite(aid) && fromActivity) return fromActivity;
  return fromQuote || fromActivity || null;
}

/** 合并预览/导出：各场次 Sheet 按活动日期从早到晚（无日期排最后） */
function sortSingleQuotesByEventDateAsc(quotes) {
  return (quotes || []).slice().sort((a, b) => {
    const da = normalizeEventDate(a?.event_date) || '';
    const db = normalizeEventDate(b?.event_date) || '';
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    }
    return (Number(a?.id) || 0) - (Number(b?.id) || 0);
  });
}

function calcTotalsFromItems(items, serviceRate, taxRate) {
  const subtotalExTax = roundMoney(
    (items || []).reduce((s, it) => s + (Number(it.subtotal) || roundMoney((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))), 0)
  );
  const sr = Math.min(0.15, Math.max(0.1, defaultServiceRate(serviceRate)));
  const tr = parseFloat(taxRate) || 0.06;
  const serviceCharge = roundMoney(subtotalExTax * sr);
  const taxAmount = roundMoney((subtotalExTax + serviceCharge) * tr);
  const totalAmount = roundMoney(subtotalExTax + serviceCharge + taxAmount);
  return { subtotalExTax, serviceCharge, taxAmount, totalAmount, serviceRate: sr, taxRate: tr };
}

function templateItemKey(subsectionCode, description) {
  return `${String(subsectionCode || '').trim()}|${String(description || '').trim()}`;
}

function extractQuotationNosFromSessions(row) {
  const sessions = parseLinkedSessions(row?.linked_sessions);
  const nos = [];
  sessions.forEach((s) => {
    const r = String(s?.remarks || '');
    const m = r.match(/(?:来自报价\s*)?(QT-\d{8}-\d{3})/i);
    if (m && m[1]) nos.push(String(m[1]).toUpperCase());
  });
  return nos;
}

function hasMergedSourceHints(row) {
  if (extractQuotationNosFromSessions(row).length > 0) return true;
  return parseLinkedSessions(row?.linked_sessions).some((s) => /来自报价/.test(String(s?.remarks || '')));
}

function isMergedExportQuote(row) {
  const mergedFromIds = parseJsonArray(row?.merged_from_quote_ids);
  if (mergedFromIds.length > 0) return true;
  if (hasMergedSourceHints(row)) return true;
  const name = String(row?.project_name || '').trim();
  return /合并/.test(name) || /等\s*\d+\s*场/.test(name);
}

function shouldTreatAsMergedBundle(row, mergedFromIds, singleQuotes) {
  if (!isMergedExportQuote(row)) return false;
  return Array.isArray(singleQuotes) && singleQuotes.length > 0;
}

module.exports = {
  calcTotalsFromItems,
  defaultServiceRate,
  deriveEventTypeFromActivity,
  extractQuotationNosFromSessions,
  hasMergedSourceHints,
  isMergedExportQuote,
  normalizeEventDate,
  normalizeItemRow,
  normalizeLinkedSessionRow,
  parseJsonArray,
  parseLinkedSessions,
  projectCodesSummary,
  resolveQuotationDisplayEventDate,
  roundMoney,
  roundQty,
  shouldTreatAsMergedBundle,
  sortSingleQuotesByEventDateAsc,
  templateItemKey,
};
