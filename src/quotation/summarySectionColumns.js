/**
 * Summary 表：按大板块（section_name）动态列，仅显示有金额的板块
 */
const { compareQuotationCodes } = require('./quotationCodes');
const { mergeSessionWithTotals, calcMultiGrandTotals } = require('./multiSummaryItems');
const {
  normalizeSummarySectionName,
  summarySectionSortOrder,
} = require('./summarySectionMerge');

/** 多场报价手填费用 → 大板块（无明细 items 时） */
const SESSION_FEE_SECTION_MAP = [
  { section_code: 'A', section_name: '沟通调度', feeKey: 'fee_comm', sort_order: 10 },
  { section_code: 'F', section_name: '执行人员', feeKey: 'fee_executor', sort_order: 15 },
  { section_code: 'B', section_name: '设计费', feeKey: 'fee_design', sort_order: 20 },
  { section_code: 'C', section_name: '物料制作费用', feeKey: 'fee_print', sort_order: 30 },
  { section_code: 'D', section_name: '物流运输费用', feeKey: 'fee_freight', sort_order: 40 },
  { section_code: 'E', section_name: '摄影及直播相册', feeKey: 'fee_photo', sort_order: 50 },
];

function roundMoney(n) {
  const x = parseFloat(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function amountPositive(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0;
}

function lineSubtotal(it) {
  return roundMoney((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0));
}

function sectionTotalsFromItems(items) {
  const map = new Map();
  (items || []).forEach((it) => {
    const code = String(it.section_code || '').trim();
    const rawName = String(it.section_name || '').trim();
    const canonical = normalizeSummarySectionName(rawName) || rawName;
    if (!canonical) return;
    const key = canonical;
    if (!map.has(key)) {
      map.set(key, {
        section_code: code,
        section_name: canonical,
        amount: 0,
        sort_order: summarySectionSortOrder(canonical, code),
      });
    } else {
      const row = map.get(key);
      row.sort_order = Math.min(row.sort_order, summarySectionSortOrder(canonical, code));
      if (!row.section_code && code) row.section_code = code;
    }
    const row = map.get(key);
    row.amount = roundMoney(row.amount + lineSubtotal(it));
  });
  return [...map.values()].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return String(a.section_name).localeCompare(b.section_name, 'zh');
  });
}

function aqSortOrderFromSection(code) {
  const c = String(code || '').trim().toUpperCase();
  if (/^[A-Z]$/.test(c)) return (c.charCodeAt(0) - 64) * 100;
  const n = parseFloat(c);
  return Number.isFinite(n) ? n * 100 : null;
}

function sectionTotalsFromSession(session) {
  const s = mergeSessionWithTotals(session);
  return SESSION_FEE_SECTION_MAP.map((def) => ({
    section_code: def.section_code,
    section_name: def.section_name,
    amount: roundMoney(Number(s[def.feeKey]) || 0),
    sort_order: def.sort_order,
  }));
}

function sectionTotalsFromQuote(q) {
  if (Array.isArray(q.items) && q.items.length) return sectionTotalsFromItems(q.items);
  return SESSION_FEE_SECTION_MAP.map((def) => ({
    section_code: def.section_code,
    section_name: def.section_name,
    amount: roundMoney(Number(q[def.feeKey]) || 0),
    sort_order: def.sort_order,
  }));
}

/** 多场手填费用：预览/导出固定展示全部大板块列（含金额为 0 的执行人员等） */
function collectAllSessionFeeSectionColumns() {
  return SESSION_FEE_SECTION_MAP.map((def) => ({
    section_code: def.section_code,
    section_name: def.section_name,
    label: def.section_name,
    sort_order: def.sort_order,
  }));
}

/** @param {Array<Array<{section_code, section_name, amount}>>} rowSectionsList */
function collectVisibleSectionColumns(rowSectionsList) {
  const defs = new Map();
  const footerByKey = new Map();
  (rowSectionsList || []).forEach((sections) => {
    (sections || []).forEach((sec) => {
      const canonical = normalizeSummarySectionName(sec.section_name);
      if (!canonical) return;
      const key = canonical;
      if (!defs.has(key)) {
        defs.set(key, {
          section_code: String(sec.section_code || '').trim(),
          section_name: canonical,
          canonical_name: canonical,
          label: canonical,
          sort_order: summarySectionSortOrder(canonical, sec.section_code),
          rowHasAmount: false,
        });
      } else {
        const def = defs.get(key);
        if (!def.section_code && sec.section_code) def.section_code = String(sec.section_code).trim();
        def.sort_order = Math.min(def.sort_order, summarySectionSortOrder(canonical, sec.section_code));
      }
      if (amountPositive(sec.amount)) defs.get(key).rowHasAmount = true;
      footerByKey.set(key, roundMoney((footerByKey.get(key) || 0) + sec.amount));
    });
  });
  return [...defs.values()]
    .filter((def) => def.rowHasAmount || amountPositive(footerByKey.get(def.canonical_name)))
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return String(a.section_name).localeCompare(b.section_name, 'zh');
    });
}

function getSectionAmountForRow(sections, sectionCode, sectionName) {
  const canonical = normalizeSummarySectionName(sectionName);
  if (canonical) {
    const merged = (sections || []).filter(
      (s) => normalizeSummarySectionName(s.section_name) === canonical
    );
    if (merged.length) {
      return roundMoney(merged.reduce((sum, s) => sum + (Number(s.amount) || 0), 0));
    }
  }
  const hit = sections.find(
    (s) => s.section_code === sectionCode && s.section_name === sectionName
  );
  return hit ? hit.amount : 0;
}

module.exports = {
  SESSION_FEE_SECTION_MAP,
  amountPositive,
  sectionTotalsFromItems,
  sectionTotalsFromSession,
  sectionTotalsFromQuote,
  collectVisibleSectionColumns,
  collectAllSessionFeeSectionColumns,
  getSectionAmountForRow,
  normalizeSummarySectionName,
  roundMoney,
};
