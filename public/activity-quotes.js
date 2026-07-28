/**
 * 活动报价模块（活动场次报价 EVENT）
 * 依赖全局：api, escapeHtml, fmtMoney, showToast, currentYearFrameId, currentUserRole, renderLucideIcons, openModal, closeModal
 */

/** 组合为库内 event_type：如 有执行晚宴 */
function aqComposeEventType(execution, activityKind) {
  const e = execution === '有' ? '有' : '无';
  const k = String(activityKind || '').trim() || '晚宴';
  return `${e}执行${k}`;
}

function aqParseEventType(eventType) {
  const s = String(eventType || '').trim();
  let execution = '无';
  let activityKind = '晚宴';
  if (s.startsWith('有执行')) {
    execution = '有';
    activityKind = s.slice(3).trim() || '晚宴';
  } else if (s.startsWith('无执行')) {
    execution = '无';
    activityKind = s.slice(3).trim() || '晚宴';
  }
  return { execution, activityKind };
}

function aqInferExecutionFromActivity(act) {
  const ex = String((act && act.executor) || '').trim();
  if (ex === '无' || !ex) return '无';
  return '有';
}

/** 场次 activity_type 原样用于报价类型后缀（晚宴/品鉴/婚宴等） */
function aqActivityKindLabel(activityType) {
  const t = String(activityType || '').trim();
  return t || '晚宴';
}

function aqFormatActivityTypeSource(act) {
  if (!act) return '';
  const kind = aqActivityKindLabel(act.activity_type);
  const ex = aqInferExecutionFromActivity(act);
  const exLabel = ex === '有' ? '有执行' : '无执行';
  return `${kind} · ${exLabel}`;
}

const AQ_REGIONS = ['东区', '南区', '北区', '东南区', '西南区'];

/** 多场报价：每场一行，6 项手填费用 + 行内自动合计 */
const AQ_MULTI_FEE_COLS = [
  { key: 'fee_comm', label: '沟通调度' },
  { key: 'fee_executor', label: '执行人员' },
  { key: 'fee_design', label: '设计费' },
  { key: 'fee_freight', label: '往返运费' },
  { key: 'fee_print', label: '印刷品' },
  { key: 'fee_photo', label: '摄影师&相册' },
];

/** Summary 预览/导出：合计类列（与后端 summaryColumnVisibility 一致） */
const AQ_SUMMARY_TOTAL_COLS = [
  { key: 'subtotal_ex_tax', label: '小计', quoteKey: 'subtotal_ex_tax' },
  { key: 'service_charge', label: '服务费10%', quoteKey: 'service_charge' },
  { key: 'tax_amount', label: '税费6%', quoteKey: 'tax_amount' },
  { key: 'row_total', label: '合计', quoteKey: 'total_amount' },
];

/** Summary 列名归并（与 src/quotation/summarySectionMerge.js 一致） */
const AQ_SUMMARY_SECTION_ALIASES = {
  人员沟通费: '前期沟通',
  沟通调度: '前期沟通',
  物料运输费用: '物流运输费用',
  物料运输: '物流运输费用',
  运输费用: '物流运输费用',
  往返运费: '物流运输费用',
  '摄影师&相册': '摄影及直播相册',
  摄影师相册: '摄影及直播相册',
  人员费用: '摄影及直播相册',
  摄影摄像: '摄影及直播相册',
};

const AQ_SUMMARY_SECTION_SORT_ORDER = {
  前期沟通: 10,
  执行人员: 15,
  设计费: 20,
  物料制作费用: 30,
  物流运输费用: 40,
  摄影及直播相册: 50,
};

function aqNormalizeSummarySectionName(raw) {
  const name = String(raw || '').trim();
  if (!name) return '';
  if (AQ_SUMMARY_SECTION_ALIASES[name]) return AQ_SUMMARY_SECTION_ALIASES[name];
  if (/物料.*运输|运输.*物料/.test(name)) return '物流运输费用';
  if (name.includes('物流运输')) return '物流运输费用';
  return name;
}

function aqSummarySectionSortOrder(canonicalName, sectionCode) {
  if (AQ_SUMMARY_SECTION_SORT_ORDER[canonicalName] != null) {
    return AQ_SUMMARY_SECTION_SORT_ORDER[canonicalName];
  }
  const c = String(sectionCode || '').trim().toUpperCase();
  if (/^[A-Z]$/.test(c)) return (c.charCodeAt(0) - 64) * 100;
  const n = parseFloat(c);
  return Number.isFinite(n) ? n * 100 : 9999;
}

/** 多场手填费用 → 大板块名（与后端 SESSION_FEE_SECTION_MAP 一致） */
const AQ_SESSION_FEE_SECTION_MAP = [
  { section_code: 'A', section_name: '沟通调度', feeKey: 'fee_comm' },
  { section_code: 'F', section_name: '执行人员', feeKey: 'fee_executor' },
  { section_code: 'B', section_name: '设计费', feeKey: 'fee_design' },
  { section_code: 'C', section_name: '物料制作费用', feeKey: 'fee_print' },
  { section_code: 'D', section_name: '物流运输费用', feeKey: 'fee_freight' },
  { section_code: 'E', section_name: '摄影及直播相册', feeKey: 'fee_photo' },
];

function aqSectionTotalsFromItems(items) {
  const map = new Map();
  (items || []).forEach((it) => {
    const code = String(it.section_code || '').trim();
    const rawName = String(it.section_name || '').trim();
    const canonical = aqNormalizeSummarySectionName(rawName) || rawName;
    if (!canonical) return;
    const key = canonical;
    if (!map.has(key)) {
      map.set(key, {
        section_code: code,
        section_name: canonical,
        amount: 0,
        sort_order: aqSummarySectionSortOrder(canonical, code),
      });
    } else {
      const row = map.get(key);
      row.sort_order = Math.min(row.sort_order, aqSummarySectionSortOrder(canonical, code));
    }
    map.get(key).amount += aqItemSubtotal(it);
  });
  return [...map.values()]
    .map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 }))
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return String(a.section_name).localeCompare(b.section_name, 'zh');
    });
}

function aqSectionTotalsFromSession(s) {
  return AQ_SESSION_FEE_SECTION_MAP.map((m) => ({
    section_code: m.section_code,
    section_name: m.section_name,
    amount: aqParseFee(s, m.feeKey),
  }));
}

function aqSectionTotalsFromQuote(q) {
  if (Array.isArray(q.items) && q.items.length) return aqSectionTotalsFromItems(q.items);
  return AQ_SESSION_FEE_SECTION_MAP.map((m) => ({
    section_code: m.section_code,
    section_name: m.section_name,
    amount: Number(q[m.feeKey]) || 0,
  }));
}

function aqCollectVisibleSummarySectionColumns(rowSectionsList) {
  const defs = new Map();
  const footerByKey = new Map();
  (rowSectionsList || []).forEach((sections) => {
    (sections || []).forEach((sec) => {
      const canonical = aqNormalizeSummarySectionName(sec.section_name);
      if (!canonical) return;
      const key = canonical;
      if (!defs.has(key)) {
        defs.set(key, {
          section_code: String(sec.section_code || '').trim(),
          section_name: canonical,
          canonical_name: canonical,
          sort_order: aqSummarySectionSortOrder(canonical, sec.section_code),
          rowHasAmount: false,
        });
      }
      if (aqAmountPositive(sec.amount)) defs.get(key).rowHasAmount = true;
      footerByKey.set(key, (footerByKey.get(key) || 0) + (Number(sec.amount) || 0));
    });
  });
  return [...defs.values()]
    .filter((def) => def.rowHasAmount || aqAmountPositive(footerByKey.get(def.canonical_name)))
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return String(a.section_name).localeCompare(b.section_name, 'zh');
    });
}

function aqSectionAmount(sections, sectionCode, sectionName) {
  const canonical = aqNormalizeSummarySectionName(sectionName);
  if (canonical) {
    const merged = (sections || []).filter(
      (s) => aqNormalizeSummarySectionName(s.section_name) === canonical
    );
    if (merged.length) {
      return Math.round(merged.reduce((sum, s) => sum + (Number(s.amount) || 0), 0) * 100) / 100;
    }
  }
  const hit = (sections || []).find(
    (s) => s.section_code === sectionCode && s.section_name === sectionName
  );
  return hit ? Number(hit.amount) || 0 : 0;
}

function aqAmountPositive(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0;
}

/** 合并报价 Summary：多场固定 6 项费用列；合并单场报价仍按有金额显示板块 */
function aqBuildSummaryPreviewLayout(opts = {}) {
  const sessions = opts.sessions || [];
  const quotes = opts.quotes || [];
  const rowSectionsList = quotes.length
    ? quotes.map((q) => aqSectionTotalsFromQuote(q))
    : sessions.map((s) => aqSectionTotalsFromSession(s));
  const sectionCols = quotes.length
    ? aqCollectVisibleSummarySectionColumns(rowSectionsList)
    : AQ_SESSION_FEE_SECTION_MAP.map((m) => ({
        section_code: m.section_code,
        section_name: m.section_name,
      }));
  if (quotes.length) {
    let footSub = 0;
    let footSvc = 0;
    let footTax = 0;
    let footTotal = 0;
    quotes.forEach((q) => {
      footSub += Number(q.subtotal_ex_tax) || 0;
      footSvc += Number(q.service_charge) || 0;
      footTax += Number(q.tax_amount) || 0;
      footTotal += Number(q.total_amount) || 0;
    });
    const footByKey = {
      subtotal_ex_tax: footSub,
      service_charge: footSvc,
      tax_amount: footTax,
      row_total: footTotal,
    };
    const totalCols = AQ_SUMMARY_TOTAL_COLS.filter((col) => {
      const rowAny = quotes.some((q) => aqAmountPositive(q[col.quoteKey]));
      return rowAny || aqAmountPositive(footByKey[col.key]);
    });
    return { sectionCols, totalCols };
  }
  const t = aqCalcMultiGrandTotals(sessions);
  const footByKey = {
    subtotal_ex_tax: t.subtotalExTax,
    service_charge: t.serviceCharge,
    tax_amount: t.taxAmount,
    row_total: t.totalAmount,
  };
  const totalCols = AQ_SUMMARY_TOTAL_COLS.filter((col) => {
    const rowAny = sessions.some((s) => aqAmountPositive(aqCalcSessionRow(s)[col.key]));
    return rowAny || aqAmountPositive(footByKey[col.key]);
  });
  return { sectionCols, totalCols };
}
