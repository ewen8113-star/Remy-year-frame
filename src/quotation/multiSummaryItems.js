/**
 * 多场报价（Summary 模版）— 每场一行，含 6 项费用 + 行内合计
 */
const MULTI_SUMMARY_FEE_LINES = [
  { key: 'fee_comm', description: '沟通调度', unit: '项', default_unit_price: 0, sort_order: 10 },
  { key: 'fee_executor', description: '执行人员', unit: '项', default_unit_price: 0, sort_order: 15 },
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
    if (key === 'fee_comm') {
      const legacy = parseFloat(raw.fees['人员沟通费']);
      if (Number.isFinite(legacy) && legacy >= 0) return roundMoney(legacy);
    }
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

const FEE_DESC_TO_KEY = new Map(
  MULTI_SUMMARY_FEE_LINES.map((line) => [line.description, line.key])
);
FEE_DESC_TO_KEY.set('人员沟通费', 'fee_comm');

function collectMultiFeeLineItems(items) {
  return (items || [])
    .filter((it) => FEE_DESC_TO_KEY.has(String(it.description || '').trim()))
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
}

function sessionItemsForLinkedRow(items, sess, sessionIndex, sessionCount) {
  const code = String(sess.project_code || '').trim();
  const all = items || [];
  const lineCount = MULTI_SUMMARY_FEE_LINES.length;
  const feeLines = collectMultiFeeLineItems(all);

  if (feeLines.length >= lineCount * sessionCount) {
    return feeLines.slice(sessionIndex * lineCount, sessionIndex * lineCount + lineCount);
  }

  if (code) {
    const exact = all.filter((it) => String(it.section_name || '').trim() === `场次 ${code}`);
    if (exact.length) return exact;
    const fuzzy = all.filter((it) => {
      const sn = String(it.section_name || '').trim();
      return sn.includes(code) || code.includes(sn.replace(/^场次\s*/, ''));
    });
    if (fuzzy.length) return fuzzy;
  }

  const summaryName = MULTI_SECTION.section_name;
  const summaryRows = all.filter((it) => {
    const sn = String(it.section_name || '').trim();
    return sn === summaryName || sn === '汇总报价';
  });
  if (summaryRows.length >= lineCount) {
    const start = sessionIndex * lineCount;
    return summaryRows.slice(start, start + lineCount);
  }
  if (sessionCount === 1 && feeLines.length) return feeLines;
  if (sessionCount === 1) return all;
  return [];
}

function feeSumFromKeys(fees) {
  return MULTI_FEE_KEYS.reduce((s, k) => s + (Number(fees[k]) || 0), 0);
}

/** linked_sessions 仅有行合计、fee_* 为空时，回填到沟通调度便于继续编辑 */
function hydrateSessionFromStoredTotals(sess) {
  const current = extractSessionFees(sess);
  if (feeSumFromKeys(current) > 0.001) return { ...sess, ...current };
  const sub = parseFloat(sess.subtotal_ex_tax);
  if (!Number.isFinite(sub) || sub <= 0) return { ...sess, ...current };
  return {
    ...sess,
    ...current,
    fee_comm: roundMoney(sub),
  };
}

function feesFromQuotationItems(items, sess, sessionIndex, sessionCount) {
  const fees = {};
  MULTI_FEE_KEYS.forEach((k) => {
    fees[k] = 0;
  });
  sessionItemsForLinkedRow(items, sess, sessionIndex, sessionCount).forEach((it) => {
    const desc = String(it.description || '').trim();
    const key = FEE_DESC_TO_KEY.get(desc);
    if (!key) return;
    const amt = roundMoney(parseFloat(it.unit_price) || parseFloat(it.subtotal) || 0);
    fees[key] = roundMoney((fees[key] || 0) + amt);
  });
  return fees;
}

/** 从 quotation_items 还原 linked_sessions 六项费用（兼容仅写入 items 的历史数据） */
function hydrateLinkedSessionsFeesFromItems(sessions, items) {
  const list = Array.isArray(sessions) ? sessions : [];
  const rows = Array.isArray(items) ? items : [];
  if (!list.length) return list;
  return list.map((sess, i) => {
    let next = { ...sess };
    const cur = extractSessionFees(next);
    const curSum = feeSumFromKeys(cur);
    if (rows.length) {
      const fromItems = feesFromQuotationItems(rows, sess, i, list.length);
      const itemsSum = feeSumFromKeys(fromItems);
      if (curSum > 0.001) {
        MULTI_FEE_KEYS.forEach((k) => {
          next[k] = cur[k] > 0 ? cur[k] : fromItems[k] || 0;
        });
      } else if (itemsSum > 0) {
        next = { ...next, ...fromItems };
      }
    }
    next = hydrateSessionFromStoredTotals(next);
    return mergeSessionWithTotals(next);
  });
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
    remarks: raw.remarks != null ? String(raw.remarks).trim() : '',
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
  hydrateLinkedSessionsFeesFromItems,
  hydrateSessionFromStoredTotals,
  feesFromQuotationItems,
  collectMultiFeeLineItems,
};
