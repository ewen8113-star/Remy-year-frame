function aqSortQuotesByEventDateAsc(quotes) {
  return (quotes || []).slice().sort((a, b) => {
    const da = aqNormalizeEventDate(a?.event_date) || '';
    const db = aqNormalizeEventDate(b?.event_date) || '';
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    }
    return (Number(a?.id) || 0) - (Number(b?.id) || 0);
  });
}

/** 多场 linked_sessions：预览/导出按活动日期升序 */
function aqSortLinkedSessionsByEventDateAsc(sessions) {
  return (sessions || []).slice().sort((a, b) => {
    const da = aqNormalizeEventDate(a?.event_date) || '';
    const db = aqNormalizeEventDate(b?.event_date) || '';
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    }
    const sa = Number(a?.sort_order);
    const sb = Number(b?.sort_order);
    if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
    return String(a?.project_code || '').localeCompare(String(b?.project_code || ''), 'zh');
  });
}

/** 已保存的合并报价：Summary 表行顺序与场次 Sheet 一致（按活动日） */
function aqAlignMultiLinkedSessionsToSortedSingles(multiQ, singles) {
  if (!multiQ || !Array.isArray(multiQ.linked_sessions) || !singles?.length) return;
  const sessions = multiQ.linked_sessions;
  const orderByAct = new Map();
  singles.forEach((s, i) => {
    const aid = Number(s.activity_id);
    if (Number.isFinite(aid)) orderByAct.set(aid, i);
  });
  const sorted = sessions.slice().sort((a, b) => {
    const ia = orderByAct.has(Number(a.activity_id))
      ? orderByAct.get(Number(a.activity_id))
      : 9999;
    const ib = orderByAct.has(Number(b.activity_id))
      ? orderByAct.get(Number(b.activity_id))
      : 9999;
    if (ia !== ib) return ia - ib;
    const da = aqNormalizeEventDate(a.event_date) || '';
    const db = aqNormalizeEventDate(b.event_date) || '';
    return da.localeCompare(db);
  });
  sorted.forEach((s, i) => {
    s.sort_order = i;
  });
  multiQ.linked_sessions = sorted;
}

const AQ_BJ_OFFSET_MS = 8 * 60 * 60 * 1000;

function aqCalendarYmdFromMs(ms) {
  const d = new Date(ms + AQ_BJ_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 日历日 YYYY-MM-DD（+08:00），避免 ISO / mysql2 DATE 差一天 */
function aqResolveQuoteEventDate(q) {
  if (!q) return '';
  const actDate = aqNormalizeEventDate(q.activity_date);
  const quoteDate = aqNormalizeEventDate(q.event_date);
  if (q.activity_id != null && actDate) return actDate;
  return quoteDate || actDate || '';
}

function aqNormalizeEventDate(raw) {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return aqCalendarYmdFromMs(raw.getTime());
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const head = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (head && (s.includes('T') || /\d{2}:\d{2}/.test(s))) {
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) return aqCalendarYmdFromMs(dt.getTime());
  }
  if (head) return `${head[1]}-${head[2]}-${head[3]}`;
  const slash = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (slash) {
    return `${slash[1]}-${String(slash[2]).padStart(2, '0')}-${String(slash[3]).padStart(2, '0')}`;
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return '';
  return aqCalendarYmdFromMs(dt.getTime());
}

function aqIsCustomItem(it) {
  return Number(it?.is_custom) === 1;
}

function aqActivityOptionLabel(a) {
  const code = String(a.project_code || '').trim();
  const meta = aqFormatActivityTypeSource(a);
  return meta ? `${code} · ${meta}` : code;
}

async function aqLoadActivitiesForPicker() {
  let qs = '?sortBy=date&sortOrder=DESC&isVirtual=0';
  if (currentYearFrameId) qs += `&yearFrameId=${currentYearFrameId}`;
  const res = await api('GET', `/activities${qs}`);
  const rows = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
  const list = rows.filter((a) => String(a.project_code || '').trim());
  activityQuotesState.createActivities = list;
  const byCode = new Map();
  list.forEach((a) => {
    const code = String(a.project_code || '').replace(/^\uFEFF/, '').trim();
    if (code && !byCode.has(code)) byCode.set(code, a);
  });
  activityQuotesState.projectActivityByCode = byCode;
  activityQuotesState.projectCodeList = [...byCode.keys()].sort();
  aqFillMultiProjectDatalist();
}

function aqFillMultiProjectDatalist() {
  const dl = document.getElementById('aqMultiProjectList');
  if (!dl) return;
  const seen = new Set();
  const codes = [];
  aqGetFilteredActivitiesForPicker().forEach((a) => {
    const code = String(a.project_code || '').replace(/^\uFEFF/, '').trim();
    if (code && !seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  });
  codes.sort();
  dl.innerHTML = codes.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
}

function aqMarkMultiDirty() {
  activityQuotesState.multiDraftPristine = false;
}

function aqIsMultiPristine() {
  const q = activityQuotesState.editing;
  if (!q || !aqIsMultiQuote(q)) return false;
  if (!activityQuotesState.multiDraftPristine) return false;
  const sessions = q.linked_sessions || [];
  const hasAct = sessions.some((s) => s && s.activity_id);
  const hasFee = sessions.some((s) => AQ_MULTI_FEE_COLS.some((col) => aqParseFee(s, col.key) > 0));
  return !hasAct && !hasFee;
}

async function aqDiscardPristineMultiDraft() {
  const q = activityQuotesState.editing;
  if (!q || !q.id || !aqIsMultiPristine()) return false;
  if (currentUserRole !== 'admin') return false;
  try {
    await api('DELETE', `/quotations/${q.id}`);
    return true;
  } catch (e) {
    showToast(e.message || '删除空草稿失败', 'error');
    return false;
  }
}

async function aqTryLeaveMultiEdit(isCancel) {
  const q = activityQuotesState.editing;
  if (!q || !aqIsMultiQuote(q)) return true;
  if (aqIsMultiPristine()) {
    return aqDiscardPristineMultiDraft();
  }
  const msg = isCancel
    ? '已填写内容尚未保存，确定取消并放弃本次编辑？'
    : '当前有多场报价未保存，确定返回列表？（已保存过的记录会保留在列表中）';
  return confirm(msg);
}

function aqFmtNum(n, dec = 2) {
  const x = parseFloat(n);
  if (!Number.isFinite(x)) return '0';
  return x.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function aqCalcTotals(items, serviceRate, taxRate) {
  const subtotalExTax = (items || []).reduce(
    (s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0),
    0
  );
  const sr = Math.min(0.15, Math.max(0.1, parseFloat(serviceRate) || aqDefaultServiceRate()));
  const tr = parseFloat(taxRate) || 0.06;
  const serviceCharge = subtotalExTax * sr;
  const taxAmount = (subtotalExTax + serviceCharge) * tr;
  const totalAmount = subtotalExTax + serviceCharge + taxAmount;
  return {
    subtotalExTax: Math.round(subtotalExTax * 100) / 100,
    serviceCharge: Math.round(serviceCharge * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    totalAmount: Math.round(totalAmount * 100) / 100,
    serviceRate: sr,
    taxRate: tr,
  };
}

function aqItemSubtotal(it) {
  return Math.round((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0) * 100) / 100;
}

function aqEmptyMultiSession() {
  const row = {
    activity_id: null,
    project_code: '',
    event_date: '',
    city: '',
    customer_name: '',
    event_type: '',
    remarks: '',
  };
  AQ_MULTI_FEE_COLS.forEach((col) => {
    row[col.key] = 0;
  });
  return row;
}

function aqEnsureMultiSessions(q) {
  if (!aqIsMultiQuote(q)) return;
  q.service_rate = 0.1;
  q.tax_rate = 0.06;
  if (!Array.isArray(q.linked_sessions)) q.linked_sessions = [];
  if (!q.linked_sessions.length) {
    q.linked_sessions.push(aqEmptyMultiSession());
  }
  aqNormalizeMultiQuoteAfterLoad(q);
}

function aqFilterProjectPickerOptionsFromActs(acts, keyword) {
  const q = String(keyword || '').trim().toLowerCase();
  const seen = new Set();
  const out = [];
  (acts || []).forEach((a) => {
    const code = String(a.project_code || '').replace(/^\uFEFF/, '').trim();
    if (!code || seen.has(code)) return;
    const city = String(a.city || '').toLowerCase();
    const client = String(a.client_name || a.client || '').toLowerCase();
    if (!q || code.toLowerCase().includes(q) || city.includes(q) || client.includes(q)) {
      seen.add(code);
      const hint = [a.city, a.client_name || a.client].filter(Boolean).join(' · ');
      out.push({ code, label: hint ? `${code} · ${hint}` : code });
    }
  });
  return out.slice(0, 80);
}

function aqFilterProjectPickerOptions(keyword) {
  return aqFilterProjectPickerOptionsFromActs(aqGetFilteredActivitiesForPicker(), keyword);
}

function aqFilterProjectPickerOptionsForCreate(keyword) {
  return aqFilterProjectPickerOptionsFromActs(activityQuotesState.createActivities || [], keyword);
}

/** 新建单场报价弹窗用的场次选择器 key（与多场表格行下标区分） */
const AQ_CREATE_PC_KEY = 'create';
