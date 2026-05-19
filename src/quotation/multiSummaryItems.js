/**
 * 多场报价（Summary 模版）— 每场一行，含 5 项费用 + 行内合计
 */
const MULTI_SUMMARY_FEE_LINES = [
  { key: 'fee_comm', description: '人员沟通费', unit: '项', default_unit_price: 0, sort_order: 10 },
  { key: 'fee_design', description: '设计费', unit: '项', default_unit_price: 0, sort_order: 20 },
  { key: 'fee_freight', description: '往返运费', unit: '项', default_unit_price: 0, sort_order: 30 },
  { key: 'fee_print', description: '印刷品', unit: '项', default_unit_price: 0, sort_order: 40 },
  { key: 'fee_photo', description: '摄影师&相册', unit: '项', default_unit_price: 0, sort_order: 50 },
];

const MULTI_FEE_KEYS = MULTI_SUMMARY_FEE_LINES.map((r) => r.key);

const MULTI_SECTION = {
  section_code: 'S',
  section_name: '汇总报价',
  subsection_code: 'S.01',
  subsection_name: '费用明细',
};

function roundMoney(n) {
  const x = parseFloat(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function parseFeeAmount(raw, key) {
  if (raw == null) return 0;
  const direct = parseFloat(raw[key]);
  if (Number.isFinite(direct) && direct >= 0) return roundMoney(direct);
  const line = MULTI_SUMMARY_FEE_LINES.find((r) => r.key === key);
  if (line && raw.fees && typeof raw.fees === 'object') {
    const alt = parseFloat(raw.fees[line.description]);
    if (Number.isFinite(alt) && alt >= 0) return roundMoney(alt);
  }
  return 0;
}

function extractSessionFees(raw) {
  const fees = {};
  MULTI_FEE_KEYS.forEach((k) => {
    fees[k] = parseFeeAmount(raw || {}, k);
  });
  return fees;
}

function calcSessionRowTotals(fees, serviceRate = 0.1, taxRate = 0.06) {
  const subtotalExTax = roundMoney(
    MULTI_FEE_KEYS.reduce((s, k) => s + (Number(fees[k]) || 0), 0)
  );
  const sr = 0.1;
  const tr = 0.06;
  const serviceCharge = roundMoney(subtotalExTax * sr);
  const taxAmount = roundMoney((subtotalExTax + serviceCharge) * tr);
  const rowTotal = roundMoney(subtotalExTax + serviceCharge + taxAmount);
  return {
    subtotal_ex_tax: subtotalExTax,
    service_charge: serviceCharge,
    tax_amount: taxAmount,
    row_total: rowTotal,
    service_rate: sr,
    tax_rate: tr,
  };
}

function mergeSessionWithTotals(raw) {
  const fees = extractSessionFees(raw);
  const calc = calcSessionRowTotals(fees);
  return {
    activity_id: raw.activity_id != null ? raw.activity_id : null,
    project_code: String(raw.project_code || '').trim(),
    event_date: raw.event_date || null,
    city: raw.city != null ? String(raw.city).trim() : '',
    customer_name: raw.customer_name != null ? String(raw.customer_name).trim() : '',
    event_type: raw.event_type != null ? String(raw.event_type).trim() : '',
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
    ...fees,
    ...calc,
  };
}

function calcMultiGrandTotals(sessions) {
  let subtotalExTax = 0;
  let serviceCharge = 0;
  let taxAmount = 0;
  let totalAmount = 0;
  (sessions || []).forEach((s) => {
    const row = mergeSessionWithTotals(s);
    subtotalExTax += row.subtotal_ex_tax;
    serviceCharge += row.service_charge;
    taxAmount += row.tax_amount;
    totalAmount += row.row_total;
  });
  return {
    subtotalExTax: roundMoney(subtotalExTax),
    serviceCharge: roundMoney(serviceCharge),
    taxAmount: roundMoney(taxAmount),
    totalAmount: roundMoney(totalAmount),
    serviceRate: 0.1,
    taxRate: 0.06,
  };
}

function buildMultiSummaryItems() {
  return MULTI_SUMMARY_FEE_LINES.map((row, i) => ({
    section_code: MULTI_SECTION.section_code,
    section_name: MULTI_SECTION.section_name,
    subsection_code: MULTI_SECTION.subsection_code,
    subsection_name: MULTI_SECTION.subsection_name,
    description: row.description,
    quantity: 1,
    unit: row.unit,
    unit_price: row.default_unit_price,
    remarks: null,
    sort_order: row.sort_order || i,
    is_custom: 0,
    is_template: 1,
  }));
}

/** 将多场行数据展开为 quotation_items（便于 PDF / 兼容旧逻辑） */
function buildQuotationItemsFromMultiSessions(sessions) {
  const items = [];
  let sort = 0;
  (sessions || []).forEach((sess) => {
    const s = mergeSessionWithTotals(sess);
    const secName = s.project_code ? `场次 ${s.project_code}` : '场次';
    MULTI_SUMMARY_FEE_LINES.forEach((line) => {
      const amt = Number(s[line.key]) || 0;
      items.push({
        section_code: MULTI_SECTION.section_code,
        section_name: secName,
        subsection_code: MULTI_SECTION.subsection_code,
        subsection_name: MULTI_SECTION.subsection_name,
        description: line.description,
        quantity: 1,
        unit: line.unit,
        unit_price: amt,
        subtotal: amt,
        remarks: null,
        sort_order: sort++,
        is_custom: 0,
        is_template: 1,
      });
    });
  });
  return items;
}

module.exports = {
  MULTI_SUMMARY_FEE_LINES,
  MULTI_FEE_KEYS,
  MULTI_SECTION,
  roundMoney,
  extractSessionFees,
  calcSessionRowTotals,
  mergeSessionWithTotals,
  calcMultiGrandTotals,
  buildMultiSummaryItems,
  buildQuotationItemsFromMultiSessions,
};
