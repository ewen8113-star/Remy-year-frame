/**
 * Summary 表：按大板块（section_name）动态列，仅显示有金额的板块
 */
const { compareQuotationCodes } = require('./quotationCodes');
const { mergeSessionWithTotals, calcMultiGrandTotals } = require('./multiSummaryItems');

/** 多场报价手填费用 → 大板块（无明细 items 时） */
const SESSION_FEE_SECTION_MAP = [
  { section_code: 'A', section_name: '前期沟通', feeKey: 'fee_comm', sort_order: 10 },
  { section_code: 'B', section_name: '设计费', feeKey: 'fee_design', sort_order: 20 },
  { section_code: 'C', section_name: '物料制作费用', feeKey: 'fee_print', sort_order: 30 },
  { section_code: 'D', section_name: '物流运输费用', feeKey: 'fee_freight', sort_order: 40 },
  { section_code: 'E', section_name: '人员费用', feeKey: 'fee_photo', sort_order: 50 },
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
    const name = String(it.section_name || '').trim();
    const key = `${code}|${name}`;
    if (!map.has(key)) {
      map.set(key, { section_code: code, section_name: name, amount: 0, sort_order: 0 });
    }
    const row = map.get(key);
    row.amount = roundMoney(row.amount + lineSubtotal(it));
    const so = aqSortOrderFromSection(code);
    if (so != null) row.sort_order = so;
  });
  return [...map.values()].sort((a, b) => {
    const c = compareQuotationCodes(a.section_code, b.section_code);
    return c !== 0 ? c : String(a.section_name).localeCompare(b.section_name, 'zh');
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

/** @param {Array<Array<{section_code, section_name, amount}>>} rowSectionsList */
function collectVisibleSectionColumns(rowSectionsList) {
  const defs = new Map();
  const footerByKey = new Map();
  (rowSectionsList || []).forEach((sections) => {
    (sections || []).forEach((sec) => {
      const key = `${sec.section_code}|${sec.section_name}`;
      if (!defs.has(key)) {
        defs.set(key, {
          section_code: sec.section_code,
          section_name: sec.section_name,
          label: sec.section_name,
          sort_order: aqSortOrderFromSection(sec.section_code) || 9999,
          rowHasAmount: false,
        });
      }
      if (amountPositive(sec.amount)) defs.get(key).rowHasAmount = true;
      footerByKey.set(key, roundMoney((footerByKey.get(key) || 0) + sec.amount));
    });
  });
  return [...defs.values()]
    .filter((def) => {
      const key = `${def.section_code}|${def.section_name}`;
      return def.rowHasAmount || amountPositive(footerByKey.get(key));
    })
    .sort((a, b) => compareQuotationCodes(a.section_code, b.section_code));
}

function getSectionAmountForRow(sections, sectionCode, sectionName) {
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
  getSectionAmountForRow,
  roundMoney,
};
