const activityQuotesState = {
  view: 'list',
  list: [],
  listSummary: null,
  filterQ: '',
  editing: null,
  templateSections: [],
  createActivities: [],
  projectCodeList: [],
  projectActivityByCode: null,
  projectMenuBound: false,
  openProjectMenuIdx: null,
  multiDraftPristine: false,
  createForm: {},
  multiFilterRegion: '',
  multiFilterBelonging: '',
  multiFilterDateFrom: '',
  multiFilterDateTo: '',
  belongingFilterOptions: [],
  multiPickSelectedIds: [],
  multiAddSelectedIds: [],
  multiProjectName: '',
  listSelectedIds: [],
  exportPickSelectedIds: [],
  exportPreviewQuotes: [],
  exportPreviewActiveSheetId: null,
  exportLayoutByQuoteId: {},
  exportPdfSettings: { pageOrientation: 'landscape' },
  exportMergeProjectName: '',
  previewBundleQuotes: [],
  previewBundleActive: 'summary',
  /** 合并报价编辑：父级多场 + 各单场 tab */
  mergedEditParent: null,
  mergedEditQuotes: [],
  mergedEditActiveId: null,
  /** 单场报价编辑：撤销删除行（Ctrl/Cmd+Z） */
  editUndoStack: [],
  editUndoKeyBound: false,
};

const AQ_EDIT_UNDO_MAX = 30;

/** 编辑表行拖拽排序（document 级监听，避免 innerHTML 重建后失效） */
let aqEditRowDragSession = null;

function aqDefaultServiceRate() {
  return 0.1;
}

function aqIsMultiQuote(q) {
  return q && String(q.quote_mode || '').toLowerCase() === 'multi';
}

function aqParseMergedFromIds(q) {
  const raw = q && q.merged_from_quote_ids;
  if (Array.isArray(raw)) return raw.map((x) => parseInt(x, 10)).filter(Number.isFinite);
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map((x) => parseInt(x, 10)).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

function aqExtractQuotationNosFromSessions(q) {
  const sessions = q && q.linked_sessions ? q.linked_sessions : [];
  const nos = [];
  sessions.forEach((s) => {
    const r = String(s && s.remarks ? s.remarks : '');
    const m = r.match(/(?:来自报价\s*)?(QT-\d{8}-\d{3})/i);
    if (m && m[1]) nos.push(String(m[1]).toUpperCase());
  });
  return nos;
}

function aqHasMergedSourceHints(q) {
  if (aqExtractQuotationNosFromSessions(q).length > 0) return true;
  return (q && q.linked_sessions ? q.linked_sessions : []).some((s) => /来自报价/.test(String(s && s.remarks ? s.remarks : '')));
}

/** 合并导出生成的多场报价（非普通多场如「南区培训」） */
function aqIsMergedExportQuote(q) {
  if (!aqIsMultiQuote(q)) return false;
  if (aqParseMergedFromIds(q).length > 0) return true;
  if (aqHasMergedSourceHints(q)) return true;
  const name = String(q.project_name || '').trim();
  return /合并/.test(name) || /等\s*\d+\s*场/.test(name);
}

async function aqLoadPreviewBundleQuotes(multiId) {
  let list = [];
  try {
    const res = await api('GET', `/quotations/${multiId}/bundle-preview`);
    list = Array.isArray(res.data) ? res.data : [];
  } catch (_) {
    list = [];
  }
  if (list.length) return list;
  const q = activityQuotesState.editing;
  if (!aqIsMergedExportQuote(q)) return [];
  const ids = aqParseMergedFromIds(q);
  if (ids.length) {
    try {
      const prev = await api('POST', '/quotations/bundle/preview', { ids });
      return Array.isArray(prev.data) ? prev.data : [];
    } catch (_) {
      return [];
    }
  }
  const qtNos = aqExtractQuotationNosFromSessions(q);
  if (qtNos.length) {
    try {
      const prev = await api('POST', '/quotations/bundle/preview', { quotation_nos: qtNos });
      return Array.isArray(prev.data) ? prev.data : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function aqCoerceMoney(raw) {
  if (raw == null || raw === '') return 0;
  const v =
    typeof raw === 'number' && Number.isFinite(raw)
      ? raw
      : parseFloat(String(raw).trim().replace(/,/g, ''));
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : 0;
}

function aqParseFee(s, key) {
  if (!s) return 0;
  const direct = aqCoerceMoney(s[key]);
  if (direct > 0) return direct;
  const col = AQ_MULTI_FEE_COLS.find((c) => c.key === key);
  if (col && s.fees && typeof s.fees === 'object') {
    const alt = aqCoerceMoney(s.fees[col.label]);
    if (alt > 0) return alt;
    if (key === 'fee_comm') {
      const legacy = aqCoerceMoney(s.fees['人员沟通费']);
      if (legacy > 0) return legacy;
    }
  }
  return 0;
}

const AQ_FEE_DESC_TO_KEY = new Map(AQ_MULTI_FEE_COLS.map((c) => [c.label, c.key]));
AQ_FEE_DESC_TO_KEY.set('人员沟通费', 'fee_comm');

function aqCollectMultiFeeLineItems(items) {
  return (items || [])
    .filter((it) => AQ_FEE_DESC_TO_KEY.has(String(it.description || '').trim()))
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
}

function aqSessionItemsForLinkedRow(items, sess, sessionIndex, sessionCount) {
  const code = String(sess.project_code || '').trim();
  const all = items || [];
  const lineCount = AQ_MULTI_FEE_COLS.length;
  const feeLines = aqCollectMultiFeeLineItems(all);

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

  const summaryRows = all.filter((it) => {
    const sn = String(it.section_name || '').trim();
    return sn === '汇总报价';
  });
  if (summaryRows.length >= lineCount) {
    const start = sessionIndex * lineCount;
    return summaryRows.slice(start, start + lineCount);
  }
  if (sessionCount === 1 && feeLines.length) return feeLines;
  if (sessionCount === 1) return all;
  return [];
}

function aqFeesFromQuotationItems(items, sess, sessionIndex, sessionCount) {
  const fees = {};
  AQ_MULTI_FEE_COLS.forEach((col) => {
    fees[col.key] = 0;
  });
  aqSessionItemsForLinkedRow(items, sess, sessionIndex, sessionCount).forEach((it) => {
    const desc = String(it.description || '').trim();
    const key = AQ_FEE_DESC_TO_KEY.get(desc);
    if (!key) return;
    const amt =
      Math.round((parseFloat(it.unit_price) || parseFloat(it.subtotal) || 0) * 100) / 100;
    fees[key] = Math.round(((fees[key] || 0) + amt) * 100) / 100;
  });
  return fees;
}

function aqFeeSumFromSession(sess) {
  return AQ_MULTI_FEE_COLS.reduce((sum, col) => sum + aqParseFee(sess, col.key), 0);
}

function aqApplySessionFeesFromItems(sess, items, sessionIndex, sessionCount) {
  if (!sess) return;
  const cur = {};
  AQ_MULTI_FEE_COLS.forEach((col) => {
    cur[col.key] = aqParseFee(sess, col.key);
  });
  const curSum = aqFeeSumFromSession(sess);
  const fromItems = aqFeesFromQuotationItems(items, sess, sessionIndex, sessionCount);
  const itemsSum = AQ_MULTI_FEE_COLS.reduce((s, col) => s + (fromItems[col.key] || 0), 0);

  if (curSum > 0.001) {
    AQ_MULTI_FEE_COLS.forEach((col) => {
      const k = col.key;
      sess[k] = cur[k] > 0 ? cur[k] : fromItems[k] || 0;
    });
    return;
  }
  if (itemsSum > 0) {
    AQ_MULTI_FEE_COLS.forEach((col) => {
      sess[col.key] = fromItems[col.key] || 0;
    });
    return;
  }
  aqHydrateSessionFromStoredTotals(sess);
}

function aqHydrateSessionFromStoredTotals(sess) {
  if (!sess) return;
  if (aqFeeSumFromSession(sess) > 0.001) return;
  const sub = aqCoerceMoney(sess.subtotal_ex_tax);
  if (sub > 0) sess.fee_comm = sub;
}

function aqHydrateMultiSessionFeesFromItems(q) {
  if (!q || !aqIsMultiQuote(q)) return;
  const sessions = q.linked_sessions || [];
  const items = q.items || [];
  if (!sessions.length) return;
  sessions.forEach((sess, i) => {
    aqApplySessionFeesFromItems(sess, items, i, sessions.length);
  });
}

/** 加载/进入编辑前：从 items 与行内合计还原六项费用 */
function aqNormalizeMultiQuoteAfterLoad(q) {
  if (!q || !aqIsMultiQuote(q)) return;
  aqHydrateMultiSessionFeesFromItems(q);
  (q.linked_sessions || []).forEach((s) => aqNormalizeSessionFees(s));
}

function aqCalcSessionRow(s) {
  let subtotalExTax = AQ_MULTI_FEE_COLS.reduce((sum, col) => sum + aqParseFee(s, col.key), 0);
  subtotalExTax = Math.round(subtotalExTax * 100) / 100;
  if (subtotalExTax <= 0) {
    const stored = aqCoerceMoney(s && s.subtotal_ex_tax);
    if (stored > 0) subtotalExTax = stored;
  }
  const sub = subtotalExTax;
  const serviceCharge = Math.round(sub * 0.1 * 100) / 100;
  const taxAmount = Math.round((sub + serviceCharge) * 0.06 * 100) / 100;
  const rowTotal = Math.round((sub + serviceCharge + taxAmount) * 100) / 100;
  return {
    subtotal_ex_tax: sub,
    service_charge: serviceCharge,
    tax_amount: taxAmount,
    row_total: rowTotal,
  };
}
