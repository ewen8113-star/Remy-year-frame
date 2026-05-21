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

/** 多场报价：每场一行，5 项手填费用 + 行内自动合计 */
const AQ_MULTI_FEE_COLS = [
  { key: 'fee_comm', label: '人员沟通费' },
  { key: 'fee_design', label: '设计费' },
  { key: 'fee_freight', label: '往返运费' },
  { key: 'fee_print', label: '印刷品' },
  { key: 'fee_photo', label: '摄影师&相册' },
];

const activityQuotesState = {
  view: 'list',
  list: [],
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
};

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

function aqParseFee(s, key) {
  const n = parseFloat(s && s[key]);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function aqCalcSessionRow(s) {
  const subtotalExTax = AQ_MULTI_FEE_COLS.reduce((sum, col) => sum + aqParseFee(s, col.key), 0);
  const sub = Math.round(subtotalExTax * 100) / 100;
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

function aqCalcMultiGrandTotals(sessions) {
  let subtotalExTax = 0;
  let serviceCharge = 0;
  let taxAmount = 0;
  let totalAmount = 0;
  (sessions || []).forEach((s) => {
    const r = aqCalcSessionRow(s);
    subtotalExTax += r.subtotal_ex_tax;
    serviceCharge += r.service_charge;
    taxAmount += r.tax_amount;
    totalAmount += r.row_total;
  });
  return {
    subtotalExTax: Math.round(subtotalExTax * 100) / 100,
    serviceCharge: Math.round(serviceCharge * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    totalAmount: Math.round(totalAmount * 100) / 100,
    serviceRate: 0.1,
    taxRate: 0.06,
  };
}

function aqCalcTotalsForQuote(q) {
  if (aqIsMultiQuote(q)) return aqCalcMultiGrandTotals(q.linked_sessions || []);
  return aqCalcTotals(q.items, q.service_rate, q.tax_rate);
}

function aqNormalizeSessionFees(s) {
  if (!s) return;
  AQ_MULTI_FEE_COLS.forEach((col) => {
    if (s[col.key] == null) s[col.key] = 0;
    else s[col.key] = aqParseFee(s, col.key);
  });
}

function aqListProjectCodes(row) {
  if (Array.isArray(row.linked_sessions) && row.linked_sessions.length) {
    return row.linked_sessions.map((s) => String(s.project_code || '').trim()).filter(Boolean);
  }
  const pc = String(row.project_code || '').trim();
  if (!pc) return [];
  return pc.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
}

function aqRenderListProjectCodeCell(row) {
  const codes = aqListProjectCodes(row);
  if (!codes.length) return '—';
  let lines;
  if (codes.length <= 3) lines = codes;
  else lines = [codes[0], '︙', codes[codes.length - 1]];
  const inner = lines
    .map((c) => {
      if (c === '︙') return '<div class="aq-pc-line aq-pc-ellipsis">︙</div>';
      return `<div class="aq-pc-line"><code>${escapeHtml(c)}</code></div>`;
    })
    .join('');
  return `<div class="aq-pc-stack">${inner}</div>`;
}

function aqServiceRateOptionsHtml(selected) {
  const sr = parseFloat(selected);
  const cur = Number.isFinite(sr) ? sr : aqDefaultServiceRate();
  const opts = [
    { v: 0.1, label: '10%（默认）' },
    { v: 0.12, label: '12%' },
    { v: 0.15, label: '15%' },
  ];
  return opts
    .map((o) => `<option value="${o.v}"${Math.abs(cur - o.v) < 0.0001 ? ' selected' : ''}>${o.label}</option>`)
    .join('');
}

function aqMapActivityEventType(actOrType) {
  const act =
    actOrType && typeof actOrType === 'object'
      ? actOrType
      : { activity_type: actOrType, executor: '' };
  return aqComposeEventType(aqInferExecutionFromActivity(act), aqActivityKindLabel(act.activity_type));
}

function aqSyncCreateFormEventTypeFromActivity(act) {
  const f = activityQuotesState.createForm;
  if (!act) {
    f.event_type = '';
    return;
  }
  f.event_type = aqMapActivityEventType(act);
}

function aqUpdateCreateFormTypeHint(act) {
  const el = document.getElementById('aqActivityTypeHint');
  if (!el) return;
  if (!act) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  const typeLabel = aqMapActivityEventType(act);
  activityQuotesState.createForm.event_type = typeLabel;
  el.innerHTML = `报价类型：<strong>${escapeHtml(typeLabel)}</strong>（来自场次：${escapeHtml(aqFormatActivityTypeSource(act))}）`;
  el.style.display = 'block';
}

function aqActivityBelongingValue(a) {
  if (typeof displayActivityBelongingValue === 'function') return displayActivityBelongingValue(a);
  const stored = a && a.belonging != null ? String(a.belonging).trim() : '';
  return stored;
}

function aqReadMultiFiltersFromDom() {
  activityQuotesState.multiFilterRegion = document.getElementById('aqMultiFilterRegion')?.value || '';
  activityQuotesState.multiFilterBelonging = document.getElementById('aqMultiFilterBelonging')?.value || '';
  activityQuotesState.multiFilterDateFrom = document.getElementById('aqMultiFilterDateFrom')?.value || '';
  activityQuotesState.multiFilterDateTo = document.getElementById('aqMultiFilterDateTo')?.value || '';
}

function aqGetFilteredActivitiesForPicker() {
  const list = activityQuotesState.createActivities || [];
  return list.filter((a) => aqActivityMatchesMultiFilter(a));
}

function aqActivityMatchesMultiFilter(a) {
  const r = activityQuotesState.multiFilterRegion || '';
  const b = activityQuotesState.multiFilterBelonging || '';
  const df = activityQuotesState.multiFilterDateFrom || '';
  const dt = activityQuotesState.multiFilterDateTo || '';
  if (r && String(a.region || '').trim() !== r) return false;
  if (b && aqActivityBelongingValue(a) !== b) return false;
  const d = aqFormatActivityDate(a);
  if (df && (!d || d < df)) return false;
  if (dt && (!d || d > dt)) return false;
  return true;
}

function aqFilteredSessionStats() {
  const acts = aqGetFilteredActivitiesForPicker();
  const codes = new Set();
  acts.forEach((a) => {
    const c = String(a.project_code || '').replace(/^\uFEFF/, '').trim();
    if (c) codes.add(c);
  });
  return { sessions: acts.length, codes: codes.size };
}

function aqFilteredSessionHintText() {
  const { sessions, codes } = aqFilteredSessionStats();
  if (!sessions) return '当前筛选下无场次';
  if (codes === sessions) return `共 ${sessions} 场`;
  return `共 ${sessions} 场 · ${codes} 个项目编号（行内下拉按编号去重）`;
}

function aqSessionFromActivity(act, sortOrder) {
  const row = aqEmptyMultiSession();
  if (!act) return row;
  row.activity_id = act.id;
  row.project_code = String(act.project_code || '').replace(/^\uFEFF/, '').trim();
  row.event_date = aqFormatActivityDate(act);
  row.city = act.city || '';
  row.customer_name = act.client_name || act.client || '';
  row.event_type = aqMapActivityEventType(act);
  row.remarks = act.remarks != null ? String(act.remarks).trim() : '';
  row.sort_order = sortOrder != null ? sortOrder : 0;
  return row;
}

/** 数字输入：展示可为空，聚焦清空 0，失焦空则回 0 */
function aqNumInputValue(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v) || v === 0) return '';
  return String(v);
}

function aqNumInpFocus(el) {
  if (!el) return;
  if (String(el.value).trim() === '' || parseFloat(el.value) === 0) {
    el.value = '';
  }
  el.select?.();
}

function aqNumInpBlur(el) {
  if (!el) return;
  if (String(el.value).trim() === '') el.value = '';
}

function aqNumInpParse(el) {
  const v = String(el && el.value).trim();
  if (v === '') return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function aqNumInputAttrs(extra) {
  let cls = 'form-control form-control-sm aq-num-inp';
  let rest = extra || '';
  const m = rest.match(/\bclass="([^"]+)"/);
  if (m) {
    cls += ` ${m[1]}`;
    rest = rest.replace(/\bclass="[^"]+"\s*/, '');
  }
  return `class="${cls}" placeholder="0" min="0" onfocus="aqNumInpFocus(this)" onblur="aqNumInpBlur(this)"${rest ? ` ${rest.trim()}` : ''}`;
}

/** 单价输入：始终展示数值（兼容字符串 / Decimal 序列化） */
function aqUnitPriceInputValue(n) {
  if (n == null || n === '') return '';
  const v = typeof n === 'number' && Number.isFinite(n) ? n : parseFloat(String(n).trim().replace(/,/g, ''));
  return Number.isFinite(v) ? String(v) : '';
}

function aqUnitPriceInputAttrs(extra) {
  let cls = 'form-control form-control-sm aq-num-inp aq-price-inp';
  let rest = extra || '';
  const m = rest.match(/\bclass="([^"]+)"/);
  if (m) {
    cls += ` ${m[1]}`;
    rest = rest.replace(/\bclass="[^"]+"\s*/, '');
  }
  return `class="${cls}" placeholder="单价" min="0" step="0.01"${rest ? ` ${rest.trim()}` : ''}`;
}

function aqTemplateItemKey(subsectionCode, description) {
  return `${String(subsectionCode || '').trim()}|${String(description || '').trim()}`;
}

function aqBuildTemplateDefaultsMap() {
  const map = new Map();
  (activityQuotesState.templateSections || []).forEach((t) => {
    map.set(aqTemplateItemKey(t.subsection_code, t.description), t);
  });
  return map;
}

/** 模版行单价为 0 时，从模版表 default_unit_price 回填 */
function aqEnrichItemsFromTemplateDefaults(q) {
  if (!q || !Array.isArray(q.items) || !activityQuotesState.templateSections?.length) return;
  const map = aqBuildTemplateDefaultsMap();
  q.items.forEach((it) => {
    if (Number(it.is_custom) === 1) return;
    const price = parseFloat(it.unit_price);
    if (Number.isFinite(price) && price > 0) return;
    const tpl = map.get(aqTemplateItemKey(it.subsection_code, it.description));
    if (!tpl) return;
    const def = parseFloat(tpl.default_unit_price);
    if (!Number.isFinite(def) || def <= 0) return;
    it.unit_price = def;
    if (!it.unit && tpl.default_unit) it.unit = tpl.default_unit;
    it.subtotal = aqItemSubtotal(it);
  });
}

async function aqEnsureBelongingFilterOptions() {
  if (activityQuotesState.belongingFilterOptions.length) return;
  try {
    const rows = await api('GET', '/lookups?category=activity_belonging');
    activityQuotesState.belongingFilterOptions = (rows || []).map((r) => ({
      value: String(r.value),
      label: String(r.label || r.value),
    }));
  } catch (_) {
    activityQuotesState.belongingFilterOptions = [];
  }
}

function aqRenderMultiFilterSelectsHtml() {
  const region = activityQuotesState.multiFilterRegion || '';
  const belonging = activityQuotesState.multiFilterBelonging || '';
  const regionOpts = [
    '<option value="">全部区域</option>',
    ...AQ_REGIONS.map(
      (r) => `<option value="${escapeHtml(r)}"${region === r ? ' selected' : ''}>${escapeHtml(r)}</option>`
    ),
  ].join('');
  const belOpts = [
    '<option value="">全部归属</option>',
    ...(activityQuotesState.belongingFilterOptions || []).map(
      (o) =>
        `<option value="${escapeHtml(o.value)}"${belonging === o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
    ),
  ].join('');
  const dateFrom = activityQuotesState.multiFilterDateFrom || '';
  const dateTo = activityQuotesState.multiFilterDateTo || '';
  const hasFilter = !!(region || belonging || dateFrom || dateTo);
  const hint = hasFilter
    ? `<span class="aq-multi-filter-hint" id="aqMultiFilterHint">${escapeHtml(aqFilteredSessionHintText())}</span>`
    : '';
  return `
    <div class="aq-multi-filters">
      <label class="aq-multi-filter-label">区域
        <select class="form-control form-control-sm" id="aqMultiFilterRegion" onchange="aqOnMultiSessionFilterChange()">${regionOpts}</select>
      </label>
      <label class="aq-multi-filter-label">归属
        <select class="form-control form-control-sm" id="aqMultiFilterBelonging" onchange="aqOnMultiSessionFilterChange()">${belOpts}</select>
      </label>
      <label class="aq-multi-filter-label">开始日期
        <input type="date" class="form-control form-control-sm" id="aqMultiFilterDateFrom" value="${escapeHtml(dateFrom)}" onchange="aqOnMultiSessionFilterChange()">
      </label>
      <label class="aq-multi-filter-label">结束日期
        <input type="date" class="form-control form-control-sm" id="aqMultiFilterDateTo" value="${escapeHtml(dateTo)}" onchange="aqOnMultiSessionFilterChange()">
      </label>
      ${hint}
    </div>`;
}

async function aqOnMultiSessionFilterChange() {
  aqReadMultiFiltersFromDom();
  if (activityQuotesState.view === 'multiPick') {
    await renderActivityQuotes();
    return;
  }
  if (activityQuotesState.view === 'exportPick') {
    await renderActivityQuotes();
    return;
  }
  aqFillMultiProjectDatalist();
  const idx = activityQuotesState.openProjectMenuIdx;
  if (idx != null && Number.isFinite(Number(idx))) {
    const input = document.getElementById(`aqPcInput-${idx}`);
    aqRenderProjectMenu(idx, input ? input.value : '');
  }
  const hintEl = document.getElementById('aqMultiFilterHint');
  if (hintEl) hintEl.textContent = aqFilteredSessionHintText();
  aqRefreshMultiAddPanel();
}


function aqLinkedActivityIdSet(q) {
  const s = new Set();
  (q?.linked_sessions || []).forEach((row) => {
    const id = parseInt(row.activity_id, 10);
    if (Number.isFinite(id)) s.add(id);
  });
  return s;
}

function aqToggleMultiPickId(id, checked) {
  const ids = new Set((activityQuotesState.multiPickSelectedIds || []).map(Number));
  const n = Number(id);
  if (checked) ids.add(n);
  else ids.delete(n);
  activityQuotesState.multiPickSelectedIds = [...ids];
  const el = document.getElementById('aqMultiPickNextBtn');
  if (el) el.textContent = `下一步（已选 ${ids.size} 场）`;
}

function aqIsMultiPickAllSelected() {
  const filtered = aqGetFilteredActivitiesForPicker();
  if (!filtered.length) return false;
  const selected = new Set((activityQuotesState.multiPickSelectedIds || []).map(Number));
  return filtered.every((a) => selected.has(Number(a.id)));
}

async function aqToggleMultiPickAll(checked) {
  if (checked) {
    activityQuotesState.multiPickSelectedIds = aqGetFilteredActivitiesForPicker().map((a) => Number(a.id));
  } else {
    activityQuotesState.multiPickSelectedIds = [];
  }
  await renderActivityQuotes();
}

function aqRenderMultiPickRows() {
  const filtered = aqGetFilteredActivitiesForPicker();
  const selected = new Set((activityQuotesState.multiPickSelectedIds || []).map(Number));
  if (!filtered.length) {
    return '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">无符合筛选条件的场次</td></tr>';
  }
  return filtered
    .map((a) => {
      const id = Number(a.id);
      const checked = selected.has(id) ? ' checked' : '';
      const date = aqFormatActivityDate(a) || '—';
      const bel =
        typeof formatActivityBelongingForTable === 'function' ? formatActivityBelongingForTable(a) : '';
      return `<tr>
      <td><input type="checkbox" class="aq-multi-pick-cb"${checked} onchange="aqToggleMultiPickId(${id}, this.checked)"></td>
      <td><code>${escapeHtml(a.project_code || '')}</code></td>
      <td>${escapeHtml(date)}</td>
      <td>${escapeHtml(a.city || '—')}</td>
      <td>${escapeHtml(a.client_name || a.client || '—')}</td>
      <td>${escapeHtml(a.activity_type || '—')}</td>
      <td>${escapeHtml(a.region || '—')}${bel && bel !== '—' ? ' · ' + escapeHtml(bel) : ''}</td>
    </tr>`;
    })
    .join('');
}

function aqOnMultiProjectNameInput(value) {
  const v = String(value || '').trim();
  activityQuotesState.multiProjectName = v;
  if (activityQuotesState.editing) activityQuotesState.editing.project_name = v;
  const el = document.getElementById('aqQtHeaderProjectName');
  if (el) el.textContent = v || '—';
}

function aqReadMultiProjectNameFromDom() {
  const el = document.getElementById('aqMultiProjectName') || document.getElementById('aqMultiPickProjectName');
  const v = el ? String(el.value || '').trim() : '';
  if (v) activityQuotesState.multiProjectName = v;
  if (activityQuotesState.editing) activityQuotesState.editing.project_name = activityQuotesState.multiProjectName;
  return activityQuotesState.multiProjectName;
}

function aqRenderMultiPickHtml() {
  const selCount = (activityQuotesState.multiPickSelectedIds || []).length;
  const pickAllChecked = aqIsMultiPickAllSelected() ? ' checked' : '';
  const nameVal = activityQuotesState.multiProjectName || '';
  const hasFilter = !!(
    activityQuotesState.multiFilterRegion ||
    activityQuotesState.multiFilterBelonging ||
    activityQuotesState.multiFilterDateFrom ||
    activityQuotesState.multiFilterDateTo
  );
  return `
    <div class="aq-edit-head">
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqBackToList()">← 返回列表</button>
      <span class="aq-multi-pick-step-title">新建多场报价 · 第 1 步：筛选并选择场次</span>
    </div>
    <div class="aq-multi-pick-wrap">
      <div class="aq-multi-sessions-head aq-multi-pick-head">
        <div class="aq-multi-sessions-head-main">
          <h3 class="aq-multi-title">筛选条件</h3>
          ${aqRenderMultiFilterSelectsHtml()}
        </div>
      </div>
      <div class="aq-multi-pick-name-row form-group">
        <label class="form-label" for="aqMultiPickProjectName">报价名称 *</label>
        <input type="text" class="form-control" id="aqMultiPickProjectName" value="${escapeHtml(nameVal)}"
          placeholder="如 南区 RC 培训合集报价" oninput="activityQuotesState.multiProjectName=this.value">
      </div>
      <p class="form-hint aq-multi-pick-lead">${hasFilter ? escapeHtml(aqFilteredSessionHintText()) + '。' : ''}勾选需要纳入报价的场次后点击下一步；若同一项目编号有多条记录，请分别勾选。</p>
      <div class="table-wrapper aq-multi-pick-table-scroll">
        <table class="data-table aq-multi-pick-table">
          <thead><tr>
            <th style="width:40px"><input type="checkbox" title="全选/取消全选当前筛选结果"${pickAllChecked} onchange="aqToggleMultiPickAll(this.checked)"></th>
            <th>项目编号</th><th>日期</th><th>城市</th><th>客户</th><th>类型</th><th>区域/归属</th>
          </tr></thead>
          <tbody>${aqRenderMultiPickRows()}</tbody>
        </table>
      </div>
      <div class="aq-multi-pick-actions">
        <button type="button" class="btn btn-secondary" onclick="aqBackToList()">取消</button>
        <button type="button" class="btn btn-primary" id="aqMultiPickNextBtn" onclick="aqConfirmMultiPickStep()">下一步（已选 ${selCount} 场）</button>
      </div>
    </div>`;
}

async function aqConfirmMultiPickStep() {
  const ids = activityQuotesState.multiPickSelectedIds || [];
  if (!ids.length) {
    showToast('请至少勾选一场活动', 'warning');
    return;
  }
  const sessions = [];
  ids.forEach((id, i) => {
    const act = activityQuotesState.createActivities.find((a) => Number(a.id) === Number(id));
    if (act) sessions.push(aqSessionFromActivity(act, i));
  });
  if (!sessions.length) {
    showToast('所选场次无效，请重新勾选', 'warning');
    return;
  }
  const projectName = (document.getElementById('aqMultiPickProjectName')?.value || activityQuotesState.multiProjectName || '').trim();
  if (!projectName) {
    showToast('请填写报价名称', 'warning');
    return;
  }
  activityQuotesState.multiProjectName = projectName;
  try {
    const res = await api('POST', '/quotations', {
      type: 'EVENT',
      quote_mode: 'multi',
      year_frame_id: currentYearFrameId,
      project_name: projectName,
      linked_sessions: sessions,
    });
    const q = res.data;
    if (!q) throw new Error('创建失败');
    q.event_date = aqNormalizeEventDate(q.event_date);
    activityQuotesState.editing = q;
    activityQuotesState.multiDraftPristine = false;
    aqEnsureMultiSessions(q);
    aqPrepareEditingItems();
    activityQuotesState.view = 'edit';
    activityQuotesState.multiPickSelectedIds = [];
    activityQuotesState.multiAddSelectedIds = [];
    await renderActivityQuotes();
    showToast(`已载入 ${sessions.length} 场，请填写各行费用`, 'success');
  } catch (e) {
    showToast(e.message || '创建失败', 'error');
  }
}

function aqGetMultiAddAvailableActivities() {
  const q = activityQuotesState.editing;
  if (!q || !aqIsMultiQuote(q)) return [];
  const linked = aqLinkedActivityIdSet(q);
  return aqGetFilteredActivitiesForPicker().filter((a) => !linked.has(Number(a.id)));
}

function aqIsMultiAddAllSelected() {
  const available = aqGetMultiAddAvailableActivities();
  if (!available.length) return false;
  const selected = new Set((activityQuotesState.multiAddSelectedIds || []).map(Number));
  return available.every((a) => selected.has(Number(a.id)));
}

function aqUpdateMultiAddToggleAllBtn() {
  const btn = document.getElementById('aqMultiAddToggleAllBtn');
  if (!btn) return;
  const available = aqGetMultiAddAvailableActivities();
  if (!available.length) {
    btn.disabled = true;
    btn.textContent = '全选';
    return;
  }
  btn.disabled = false;
  btn.textContent = aqIsMultiAddAllSelected() ? '取消全选' : '全选';
}

function aqRefreshMultiAddPanel() {
  const addPanel = document.getElementById('aqMultiAddPanelBody');
  if (addPanel) addPanel.innerHTML = aqRenderMultiAddPanelRows();
  aqUpdateMultiAddToggleAllBtn();
}

/** 点一下全选当前可添加场次，再点一下取消全选，可循环 */
function aqToggleMultiAddSelectAll() {
  const available = aqGetMultiAddAvailableActivities();
  if (!available.length) {
    showToast('当前没有可勾选的场次', 'warning');
    return;
  }
  if (aqIsMultiAddAllSelected()) {
    activityQuotesState.multiAddSelectedIds = [];
  } else {
    activityQuotesState.multiAddSelectedIds = available.map((a) => Number(a.id));
  }
  aqRefreshMultiAddPanel();
}

function aqToggleMultiAddId(id, checked) {
  const ids = new Set((activityQuotesState.multiAddSelectedIds || []).map(Number));
  const n = Number(id);
  if (checked) ids.add(n);
  else ids.delete(n);
  activityQuotesState.multiAddSelectedIds = [...ids];
  aqUpdateMultiAddToggleAllBtn();
}

function aqRenderMultiAddPanelRows() {
  const q = activityQuotesState.editing;
  if (!q || !aqIsMultiQuote(q)) return '';
  const linked = aqLinkedActivityIdSet(q);
  const available = aqGetFilteredActivitiesForPicker().filter((a) => !linked.has(Number(a.id)));
  const selected = new Set((activityQuotesState.multiAddSelectedIds || []).map(Number));
  if (!available.length) {
    return '<p class="form-hint" style="margin:0">当前筛选下没有可添加的场次（或已全部加入表格）</p>';
  }
  return available
    .map((a) => {
      const id = Number(a.id);
      const checked = selected.has(id) ? ' checked' : '';
      const date = aqFormatActivityDate(a) || '—';
      return `<label class="aq-multi-add-row">
      <input type="checkbox" value="${id}"${checked} onchange="aqToggleMultiAddId(${id}, this.checked)">
      <span><code>${escapeHtml(a.project_code || '')}</code> · ${escapeHtml(date)} · ${escapeHtml(a.city || '—')}</span>
    </label>`;
    })
    .join('');
}

function aqAddSelectedSessionsFromPanel() {
  const q = activityQuotesState.editing;
  if (!q) return;
  const ids = activityQuotesState.multiAddSelectedIds || [];
  if (!ids.length) {
    showToast('请先勾选要添加的场次', 'warning');
    return;
  }
  const linked = aqLinkedActivityIdSet(q);
  let added = 0;
  ids.forEach((id) => {
    if (linked.has(Number(id))) return;
    const act = activityQuotesState.createActivities.find((a) => Number(a.id) === Number(id));
    if (!act) return;
    if (!Array.isArray(q.linked_sessions)) q.linked_sessions = [];
    q.linked_sessions.push(aqSessionFromActivity(act, q.linked_sessions.length));
    linked.add(Number(id));
    added += 1;
  });
  activityQuotesState.multiAddSelectedIds = [];
  if (!added) {
    showToast('所选场次已在表格中', 'warning');
    return;
  }
  aqMarkMultiDirty();
  aqRefreshEditView();
  aqRefreshMultiAddPanel();
  showToast(`已添加 ${added} 场`, 'success');
}

function aqOnMultiFeeInput(sessionIdx, feeKey, el) {
  aqOnMultiFeeChange(sessionIdx, feeKey, aqNumInpParse(el));
}

function aqFormatActivityDate(a) {
  const d = a.date || a.activity_date;
  return aqNormalizeEventDate(d);
}

/** 统一为 YYYY-MM-DD，避免 ISO 字符串写入 MySQL DATE 报错 */
function aqNormalizeEventDate(raw) {
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
  q.linked_sessions.forEach((s) => aqNormalizeSessionFees(s));
}

function aqFilterProjectPickerOptions(keyword) {
  const q = String(keyword || '').trim().toLowerCase();
  const acts = aqGetFilteredActivitiesForPicker();
  const seen = new Set();
  const out = [];
  acts.forEach((a) => {
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

function aqEnsureProjectMenuGlobalClose() {
  if (activityQuotesState.projectMenuBound) return;
  document.addEventListener('click', (evt) => {
    const t = evt && evt.target;
    if (t && t.closest && (t.closest('.aq-pc-combobox') || t.closest('.aq-pc-menu'))) return;
    aqCloseAllProjectMenus();
  });
  const reposition = () => {
    const idx = activityQuotesState.openProjectMenuIdx;
    if (idx != null && Number.isFinite(Number(idx))) aqPositionProjectMenu(idx);
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  activityQuotesState.projectMenuBound = true;
}

function aqCloseAllProjectMenus() {
  activityQuotesState.openProjectMenuIdx = null;
  document.querySelectorAll('.aq-pc-menu').forEach((el) => {
    el.style.display = 'none';
  });
}

function aqPositionProjectMenu(sessionIdx) {
  const menu = document.getElementById(`aqPcMenu-${sessionIdx}`);
  const input = document.getElementById(`aqPcInput-${sessionIdx}`);
  if (!menu || !input) return;
  const r = input.getBoundingClientRect();
  const top = Math.round(r.bottom + 4);
  menu.style.position = 'fixed';
  menu.style.left = `${Math.round(r.left)}px`;
  menu.style.top = `${top}px`;
  menu.style.width = `${Math.max(Math.round(r.width), 260)}px`;
  menu.style.zIndex = '2000';
  menu.style.maxHeight = `min(280px, calc(100vh - ${top + 8}px))`;
}

function aqRenderProjectMenu(sessionIdx, keyword) {
  const menu = document.getElementById(`aqPcMenu-${sessionIdx}`);
  if (!menu) return;
  const all = activityQuotesState.projectCodeList || [];
  if (!all.length) {
    menu.innerHTML = '<div class="inv-project-menu-empty">当前财年暂无可选项目编号，请先在场次记录中填写</div>';
    return;
  }
  const shown = aqFilterProjectPickerOptions(keyword);
  if (!shown.length) {
    menu.innerHTML = '<div class="inv-project-menu-empty">无匹配项目编号</div>';
    return;
  }
  menu.innerHTML = shown
    .map(
      (row) =>
        `<button type="button" class="inv-project-option" data-value="${escapeHtml(row.code)}" onclick="aqPickProjectCode(${sessionIdx}, this.getAttribute('data-value'))">${escapeHtml(row.label)}</button>`
    )
    .join('');
}

function aqOpenProjectMenu(sessionIdx) {
  aqEnsureProjectMenuGlobalClose();
  aqCloseAllProjectMenus();
  const menu = document.getElementById(`aqPcMenu-${sessionIdx}`);
  if (!menu) return;
  const input = document.getElementById(`aqPcInput-${sessionIdx}`);
  aqRenderProjectMenu(sessionIdx, input ? input.value : '');
  menu.style.display = 'block';
  activityQuotesState.openProjectMenuIdx = sessionIdx;
  aqPositionProjectMenu(sessionIdx);
}

function aqToggleProjectMenu(sessionIdx) {
  const menu = document.getElementById(`aqPcMenu-${sessionIdx}`);
  if (!menu) return;
  if (menu.style.display === 'block') aqCloseAllProjectMenus();
  else aqOpenProjectMenu(sessionIdx);
}

function aqOnProjectInput(sessionIdx, value) {
  const q = activityQuotesState.editing;
  if (q && q.linked_sessions && q.linked_sessions[sessionIdx]) {
    q.linked_sessions[sessionIdx].project_code = String(value || '').trim();
  }
  aqOpenProjectMenu(sessionIdx);
  aqRenderProjectMenu(sessionIdx, value);
  aqPositionProjectMenu(sessionIdx);
}

function aqOnProjectInputBlur(sessionIdx) {
  window.setTimeout(() => {
    const wrap = document.querySelector(`#aqPcInput-${sessionIdx}`)?.closest('.aq-pc-combobox');
    const active = document.activeElement;
    if (wrap && active && wrap.contains(active)) return;
    aqCloseAllProjectMenus();
    const input = document.getElementById(`aqPcInput-${sessionIdx}`);
    const code = input ? String(input.value || '').trim() : '';
    if (!code) {
      const q = activityQuotesState.editing;
      if (q && q.linked_sessions) q.linked_sessions[sessionIdx] = aqEmptyMultiSession();
      return;
    }
    const byCode = activityQuotesState.projectActivityByCode;
    if (byCode && byCode.has(code)) aqApplyProjectCodeToSession(sessionIdx, code, false);
  }, 120);
}

function aqOnProjectInputKeydown(evt, sessionIdx) {
  if (!evt) return;
  if (evt.key === 'Escape') {
    aqCloseAllProjectMenus();
    return;
  }
  if (evt.key === 'Enter') {
    const first = document.querySelector(`#aqPcMenu-${sessionIdx} .inv-project-option`);
    if (first) {
      evt.preventDefault();
      const code = first.getAttribute('data-value');
      if (code) aqPickProjectCode(sessionIdx, code);
    }
  }
}

function aqApplyProjectCodeToSession(sessionIdx, code, refresh) {
  const q = activityQuotesState.editing;
  if (!q || !Array.isArray(q.linked_sessions)) return;
  const byCode = activityQuotesState.projectActivityByCode;
  const act = byCode && byCode.get ? byCode.get(String(code || '').trim()) : null;
  if (!act) {
    showToast('请从下拉列表中选择有效的项目编号', 'warning');
    return;
  }
  if (!aqActivityMatchesMultiFilter(act)) {
    showToast('该场次不在当前区域/归属筛选范围内，请调整筛选后再选', 'warning');
    return;
  }
  const prev = q.linked_sessions[sessionIdx] || aqEmptyMultiSession();
  q.linked_sessions[sessionIdx] = {
    activity_id: act.id,
    project_code: String(act.project_code || '').trim(),
    event_date: aqFormatActivityDate(act),
    city: act.city || '',
    customer_name: act.client_name || act.client || '',
    event_type: aqMapActivityEventType(act),
    remarks: act.remarks != null ? String(act.remarks).trim() : prev.remarks || '',
    sort_order: sessionIdx,
    fee_comm: prev.fee_comm || 0,
    fee_design: prev.fee_design || 0,
    fee_freight: prev.fee_freight || 0,
    fee_print: prev.fee_print || 0,
    fee_photo: prev.fee_photo || 0,
  };
  if (refresh !== false) aqRefreshMultiSessionRow(sessionIdx);
  aqMarkMultiDirty();
}

function aqOnMultiProjectCodeInput(sessionIdx, value) {
  const q = activityQuotesState.editing;
  if (!q || !q.linked_sessions || !q.linked_sessions[sessionIdx]) return;
  q.linked_sessions[sessionIdx].project_code = String(value || '').trim();
}

function aqOnMultiProjectCodeChange(sessionIdx, value) {
  const code = String(value || '').replace(/^\uFEFF/, '').trim();
  const byCode = activityQuotesState.projectActivityByCode;
  if (!byCode || typeof byCode.get !== 'function' || !byCode.has(code)) {
    if (code) showToast('请从下拉建议中选择有效的项目编号', 'warning');
    return;
  }
  aqApplyProjectCodeToSession(sessionIdx, code, true);
}

/** 仅刷新场次表某一行的只读列，避免重绘输入框打断输入 */
function aqRefreshMultiSessionRow(sessionIdx) {
  const q = activityQuotesState.editing;
  if (!q || !q.linked_sessions || !q.linked_sessions[sessionIdx]) return;
  const s = q.linked_sessions[sessionIdx];
  const row = document.querySelector(`tr[data-session-idx="${sessionIdx}"]`);
  if (!row) {
    aqRefreshEditView();
    return;
  }
  const input = document.getElementById(`aqPcInput-${sessionIdx}`);
  if (input) input.value = s.project_code || '';
  const date = aqNormalizeEventDate(s.event_date) || '—';
  const setAuto = (field, text) => {
    const el = row.querySelector(`[data-aq-auto="${field}"]`);
    if (el) el.textContent = text || '—';
  };
  setAuto('event_date', date);
  setAuto('city', s.city || '—');
  setAuto('customer_name', s.customer_name || '—');
  setAuto('event_type', s.event_type || '—');
  const calc = aqCalcSessionRow(s);
  const subEl = row.querySelector('[data-aq-calc="subtotal"]');
  const svcEl = row.querySelector('[data-aq-calc="service"]');
  const taxEl = row.querySelector('[data-aq-calc="tax"]');
  const totEl = row.querySelector('[data-aq-calc="total"]');
  if (subEl) subEl.textContent = aqFmtNum(calc.subtotal_ex_tax);
  if (svcEl) svcEl.textContent = aqFmtNum(calc.service_charge);
  if (taxEl) taxEl.textContent = aqFmtNum(calc.tax_amount);
  if (totEl) totEl.textContent = aqFmtNum(calc.row_total);
}

function aqOnMultiFeeChange(sessionIdx, feeKey, value) {
  const q = activityQuotesState.editing;
  if (!q || !q.linked_sessions || !q.linked_sessions[sessionIdx]) return;
  q.linked_sessions[sessionIdx][feeKey] = parseFloat(value) || 0;
  aqMarkMultiDirty();
  aqRefreshMultiSessionRow(sessionIdx);
  aqRefreshEditTotalsOnly();
}

function aqRenderMultiGridRows(q) {
  return (q.linked_sessions || [])
    .map((s, si) => {
      const date = aqNormalizeEventDate(s.event_date);
      const calc = aqCalcSessionRow(s);
      const feeInputs = AQ_MULTI_FEE_COLS.map(
        (col) =>
          `<td><input type="number" ${aqNumInputAttrs(`class="aq-multi-fee-inp" step="0.01" oninput="aqOnMultiFeeInput(${si}, '${col.key}', this)" onchange="aqOnMultiFeeChange(${si}, '${col.key}', aqNumInpParse(this))`)} value="${aqNumInputValue(aqParseFee(s, col.key))}"></td>`
      ).join('');
      const removeBtn =
        (q.linked_sessions || []).length > 1
          ? `<button type="button" class="btn btn-xs btn-ghost" onclick="aqRemoveMultiSession(${si})" title="移除">×</button>`
          : '';
      return `<tr data-session-idx="${si}" class="aq-multi-grid-row">
        <td class="aq-pc-cell">
          <input type="text" class="form-control form-control-sm aq-pc-datalist-inp" id="aqPcInput-${si}"
            list="aqMultiProjectList"
            value="${escapeHtml(s.project_code || '')}"
            autocomplete="off"
            placeholder="输入关键字并从下拉选择项目编号"
            oninput="aqOnMultiProjectCodeInput(${si}, this.value)"
            onchange="aqOnMultiProjectCodeChange(${si}, this.value)">
        </td>
        <td class="aq-auto-val" data-aq-auto="event_date">${escapeHtml(date) || '—'}</td>
        <td class="aq-auto-val" data-aq-auto="city">${escapeHtml(s.city || '') || '—'}</td>
        <td class="aq-auto-val" data-aq-auto="customer_name">${escapeHtml(s.customer_name || '') || '—'}</td>
        <td class="aq-auto-val" data-aq-auto="event_type">${escapeHtml(s.event_type || '') || '—'}</td>
        ${feeInputs}
        <td class="numeric aq-calc-cell" data-aq-calc="subtotal">${aqFmtNum(calc.subtotal_ex_tax)}</td>
        <td class="numeric aq-calc-cell" data-aq-calc="service">${aqFmtNum(calc.service_charge)}</td>
        <td class="numeric aq-calc-cell" data-aq-calc="tax">${aqFmtNum(calc.tax_amount)}</td>
        <td class="numeric aq-calc-cell aq-row-total" data-aq-calc="total">${aqFmtNum(calc.row_total)}</td>
        <td>${removeBtn}</td>
      </tr>`;
    })
    .join('');
}

function aqRenderMultiSessionRows(q) {
  return aqRenderMultiGridRows(q);
}

function aqAddMultiSession() {
  const q = activityQuotesState.editing;
  if (!q) return;
  if (!Array.isArray(q.linked_sessions)) q.linked_sessions = [];
  q.linked_sessions.push(aqEmptyMultiSession());
  aqMarkMultiDirty();
  aqRefreshEditView();
}

function aqRemoveMultiSession(idx) {
  const q = activityQuotesState.editing;
  if (!q || !Array.isArray(q.linked_sessions) || q.linked_sessions.length <= 1) return;
  q.linked_sessions.splice(idx, 1);
  aqMarkMultiDirty();
  aqRefreshEditView();
}

function aqMultiGridHeadHtml() {
  const feeTh = AQ_MULTI_FEE_COLS.map((c) => `<th class="aq-fee-th">${escapeHtml(c.label)}</th>`).join('');
  return `<tr>
    <th>项目编号</th><th>日期</th><th>城市</th><th>客户名称</th><th>类型</th>
    ${feeTh}
    <th class="numeric">小计</th><th class="numeric">服务费10%</th><th class="numeric">税费6%</th><th class="numeric">合计</th>
    <th></th>
  </tr>`;
}

/** 预览/打印：无项目编号列，末列为备注 */
function aqMultiPreviewColsBeforeTotals() {
  return 4 + AQ_MULTI_FEE_COLS.length;
}

function aqMultiPreviewHeadHtml() {
  const feeTh = AQ_MULTI_FEE_COLS.map((c) => `<th class="aq-fee-th">${escapeHtml(c.label)}</th>`).join('');
  return `<tr>
    <th>日期</th><th>城市</th><th>客户名称</th><th>类型</th>
    ${feeTh}
    <th class="numeric">小计</th><th class="numeric">服务费10%</th><th class="numeric">税费6%</th><th class="numeric">合计</th>
    <th class="aq-remarks-th">备注</th>
  </tr>`;
}

function aqRenderMultiPreviewTable(q) {
  const sessions = q.linked_sessions || [];
  const spanBeforeTotals = aqMultiPreviewColsBeforeTotals();
  let rows = '';
  sessions.forEach((s, i) => {
    const calc = aqCalcSessionRow(s);
    const feeTd = AQ_MULTI_FEE_COLS.map((col) => `<td class="numeric">${aqFmtNum(aqParseFee(s, col.key))}</td>`).join('');
    let remarks = String(s.remarks || '').trim();
    if (/^来自报价/i.test(remarks)) remarks = '';
    rows += `<tr class="${i % 2 ? 'qt-alt-row' : ''}">
      <td>${escapeHtml(aqNormalizeEventDate(s.event_date) || '—')}</td>
      <td>${escapeHtml(s.city || '—')}</td>
      <td>${escapeHtml(s.customer_name || '—')}</td>
      <td>${escapeHtml(s.event_type || '—')}</td>
      ${feeTd}
      <td class="numeric formula-field">${aqFmtNum(calc.subtotal_ex_tax)}</td>
      <td class="numeric formula-field">${aqFmtNum(calc.service_charge)}</td>
      <td class="numeric formula-field">${aqFmtNum(calc.tax_amount)}</td>
      <td class="numeric formula-field aq-row-total">${aqFmtNum(calc.row_total)}</td>
      <td class="remark left aq-remarks-cell" title="${escapeHtml(remarks)}">${escapeHtml(remarks || '—')}</td>
    </tr>`;
  });
  const t = aqCalcMultiGrandTotals(sessions);
  rows += `<tr class="qt-footer-row qt-total-row">
    <td colspan="${spanBeforeTotals}" style="text-align:right">多场含税总计</td>
    <td class="numeric formula-field">${aqFmtNum(t.subtotalExTax)}</td>
    <td class="numeric formula-field">${aqFmtNum(t.serviceCharge)}</td>
    <td class="numeric formula-field">${aqFmtNum(t.taxAmount)}</td>
    <td class="numeric formula-field">${aqFmtNum(t.totalAmount)}</td>
    <td class="aq-remarks-cell"></td>
  </tr>`;
  return rows;
}


function aqListQuery() {
  const p = new URLSearchParams();
  p.set('type', 'EVENT');
  if (currentYearFrameId) p.set('yearFrameId', String(currentYearFrameId));
  if (activityQuotesState.filterQ) p.set('q', activityQuotesState.filterQ);
  return `?${p.toString()}`;
}

async function aqLoadList() {
  const res = await api('GET', `/quotations${aqListQuery()}`);
  activityQuotesState.list = Array.isArray(res.data) ? res.data : [];
  const visible = new Set(activityQuotesState.list.map((r) => Number(r.id)));
  activityQuotesState.listSelectedIds = (activityQuotesState.listSelectedIds || [])
    .map(Number)
    .filter((id) => visible.has(id));
}

async function aqLoadTemplateSections() {
  const res = await api('GET', '/quotations/template-sections?type=EVENT');
  activityQuotesState.templateSections = Array.isArray(res.data) ? res.data : [];
}

async function aqLoadQuotation(id) {
  const res = await api('GET', `/quotations/${id}`);
  const q = res.data || null;
  if (q) q.event_date = aqNormalizeEventDate(q.event_date);
  activityQuotesState.editing = q;
  return activityQuotesState.editing;
}

function aqGroupTemplateSections(rows) {
  const sections = [];
  const map = new Map();
  (rows || []).forEach((r) => {
    const sk = `${r.section_code}|${r.section_name}`;
    if (!map.has(sk)) {
      const sec = { section_code: r.section_code, section_name: r.section_name, subsections: [] };
      map.set(sk, sec);
      sections.push(sec);
    }
    const sec = map.get(sk);
    let sub = sec.subsections.find((s) => s.subsection_code === r.subsection_code);
    if (!sub) {
      sub = { subsection_code: r.subsection_code, subsection_name: r.subsection_name, items: [] };
      sec.subsections.push(sub);
    }
    sub.items.push(r);
  });
  return sections;
}

function aqGroupItemsForTable(items) {
  const sections = [];
  const secMap = new Map();
  (items || [])
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0))
    .forEach((it) => {
      const sk = `${it.section_code}|${it.section_name}`;
      if (!secMap.has(sk)) {
        const sec = {
          section_code: it.section_code,
          section_name: it.section_name,
          subsections: [],
          sectionSubtotal: 0,
        };
        secMap.set(sk, sec);
        sections.push(sec);
      }
      const sec = secMap.get(sk);
      let sub = sec.subsections.find((s) => s.subsection_code === it.subsection_code);
      if (!sub) {
        sub = { subsection_code: it.subsection_code, subsection_name: it.subsection_name, items: [] };
        sec.subsections.push(sub);
      }
      sub.items.push(it);
      sec.sectionSubtotal += aqItemSubtotal(it);
    });
  sections.forEach((s) => {
    s.sectionSubtotal = Math.round(s.sectionSubtotal * 100) / 100;
  });
  return sections;
}

function aqRenderTemplatePicker() {
  const groups = aqGroupTemplateSections(activityQuotesState.templateSections);
  return groups
    .map((sec) => {
      const subs = sec.subsections
        .map((sub) => {
          const chips = sub.items
            .map((t) => {
              const checked = activityQuotesState.selectedTemplateIds.has(t.id);
              return `<label class="aq-tpl-chip${checked ? ' aq-tpl-chip-on' : ''}">
              <input type="checkbox" ${checked ? 'checked' : ''} onchange="aqToggleTemplateItem(${t.id}, this.checked)">
              <span>${escapeHtml(String(t.description).replace(/\n/g, ' '))}</span>
            </label>`;
            })
            .join('');
          return `<div class="aq-tpl-sub">
            <div class="aq-tpl-sub-head">
              <label class="aq-tpl-sub-all">
                <input type="checkbox" onchange="aqToggleSubsectionAll('${escapeHtml(sub.subsection_code)}', this.checked)">
                <strong>${escapeHtml(sub.subsection_code)} ${escapeHtml(sub.subsection_name)}</strong>
              </label>
            </div>
            <div class="aq-tpl-chips">${chips}</div>
          </div>`;
        })
        .join('');
      return `<div class="aq-tpl-section">
        <div class="aq-tpl-section-title">${escapeHtml(sec.section_code)}. ${escapeHtml(sec.section_name)}</div>
        ${subs}
      </div>`;
    })
    .join('');
}

function aqToggleTemplateItem(id, on) {
  if (on) activityQuotesState.selectedTemplateIds.add(id);
  else activityQuotesState.selectedTemplateIds.delete(id);
  const el = document.getElementById('aqTemplatePickerHost');
  if (el) el.innerHTML = aqRenderTemplatePicker();
}

function aqToggleSubsectionAll(subCode, on) {
  activityQuotesState.templateSections.forEach((t) => {
    if (t.subsection_code === subCode) {
      if (on) activityQuotesState.selectedTemplateIds.add(t.id);
      else activityQuotesState.selectedTemplateIds.delete(t.id);
    }
  });
  const el = document.getElementById('aqTemplatePickerHost');
  if (el) el.innerHTML = aqRenderTemplatePicker();
}

function aqRenderEditTableRows(q) {
  const groups = aqGroupItemsForTable(q.items || []);
  let alt = false;
  const rows = [];
  groups.forEach((sec) => {
    rows.push(`<tr class="qt-section-header">
      <td colspan="6" class="left">${escapeHtml(sec.section_code)}.${escapeHtml(sec.section_name)}</td>
      <td class="right">${aqFmtNum(sec.sectionSubtotal)}</td>
      <td></td>
    </tr>`);
    sec.subsections.forEach((sub) => {
      const n = sub.items.length;
      sub.items.forEach((it, idx) => {
        const subCodeCell =
          idx === 0
            ? `<td rowspan="${n}">${escapeHtml(sub.subsection_code)}</td>
               <td rowspan="${n}">${escapeHtml(sub.subsection_name)}</td>`
            : '';
        const descPlain = String(it.description || '');
        const descCell = aqIsCustomItem(it)
          ? `<td class="left"><input type="text" class="form-control form-control-sm aq-inp-desc"
              value="${escapeHtml(descPlain)}"
              placeholder="填写项目名称"
              oninput="aqOnItemFieldChange(${it._idx}, &quot;description&quot;, event.target.value)"></td>`
          : `<td class="left">${escapeHtml(descPlain.replace(/\n/g, '<br>'))}</td>`;
        const qtyDisp = aqNumInputValue(parseFloat(it.quantity) || 0);
        const priceDisp = aqUnitPriceInputValue(it.unit_price);
        rows.push(`<tr class="${alt ? 'qt-alt-row' : ''}" data-item-idx="${it._idx}">
          ${subCodeCell}
          ${descCell}
          <td><input type="number" value="${escapeHtml(qtyDisp)}" ${aqNumInputAttrs(`class="aq-inp-qty" step="any" oninput="aqOnItemFieldChange(${it._idx}, &quot;quantity&quot;, aqNumInpParse(event.target))" onchange="aqOnItemFieldChange(${it._idx}, &quot;quantity&quot;, aqNumInpParse(event.target))"`)}></td>
          <td><input type="text" class="form-control form-control-sm"
            value="${escapeHtml(it.unit || '')}" onchange="aqOnItemFieldChange(${it._idx}, &quot;unit&quot;, event.target.value)"></td>
          <td><input type="number" value="${escapeHtml(priceDisp)}" ${aqUnitPriceInputAttrs(`class="aq-inp-price" oninput="aqOnItemFieldChange(${it._idx}, &quot;unit_price&quot;, aqNumInpParse(event.target))" onchange="aqOnItemFieldChange(${it._idx}, &quot;unit_price&quot;, aqNumInpParse(event.target))"`)}></td>
          <td class="right aq-line-sub">${aqFmtNum(aqItemSubtotal(it))}</td>
          <td><input type="text" class="form-control form-control-sm"
            value="${escapeHtml(it.remarks || '')}" onchange="aqOnItemFieldChange(${it._idx}, &quot;remarks&quot;, event.target.value)"></td>
          <td><button type="button" class="btn btn-xs btn-ghost" onclick="aqRemoveItem(${it._idx})" title="删除行">×</button></td>
        </tr>`);
        alt = !alt;
      });
      rows.push(`<tr class="aq-add-row-tr"><td colspan="9" class="left">
        <button type="button" class="btn btn-xs btn-secondary" onclick='aqAddCustomItem(${JSON.stringify(String(sub.subsection_code || ''))})'>+ 本类添加自定义行</button>
      </td></tr>`);
    });
  });
  return rows.join('');
}

/** 预览/导出表 8 列：分类(2) + 明细(4) + 小计 + 备注；底栏与分区行按此分列，避免 colspan 与固定列宽错位 */
function aqPreviewSectionHeaderRow(sec) {
  return `<tr class="qt-section-header">
      <td colspan="2" class="qt-footer-gap"></td>
      <td colspan="4" class="left">${escapeHtml(sec.section_code)}.${escapeHtml(sec.section_name)}</td>
      <td class="right formula-field">${aqFmtNum(sec.sectionSubtotal)}</td>
      <td class="qt-footer-gap"></td>
    </tr>`;
}

function aqPreviewFooterRowsHtml(q) {
  const t = aqCalcTotalsForQuote(q);
  const pct = Math.round(t.serviceRate * 100);
  const mk = (label, val, total) => {
    const trCls = total ? 'qt-footer-row qt-total-row' : 'qt-footer-row';
    return `<tr class="${trCls}">
      <td colspan="2" class="qt-footer-gap"></td>
      <td colspan="4" class="qt-footer-label">${label}</td>
      <td class="val-cell right">${aqFmtNum(val)}</td>
      <td class="qt-footer-gap"></td>
    </tr>`;
  };
  return [
    mk('1. 不含税小计 Subtotal excluding Tax', t.subtotalExTax, false),
    mk(`2. 公司服务费 Service Charge(${pct}%)`, t.serviceCharge, false),
    mk('3. 国家及地方政府税收(6%) Government Tax', t.taxAmount, false),
    mk('4. 含税总计 TOTAL', t.totalAmount, true),
  ].join('');
}

function aqRenderPreviewTable(q) {
  const groups = aqGroupItemsForTable(q.items || []);
  let alt = false;
  const rows = [];
  groups.forEach((sec) => {
    rows.push(aqPreviewSectionHeaderRow(sec));
    sec.subsections.forEach((sub) => {
      const n = sub.items.length;
      sub.items.forEach((it, idx) => {
        const subCodeCell =
          idx === 0
            ? `<td rowspan="${n}">${escapeHtml(sub.subsection_code)}</td>
               <td rowspan="${n}">${escapeHtml(sub.subsection_name)}</td>`
            : '';
        rows.push(`<tr class="${alt ? 'qt-alt-row' : ''}">
          ${subCodeCell}
          <td class="left">${escapeHtml(String(it.description || '').replace(/\n/g, '<br>'))}</td>
          <td>${aqFmtNum(it.quantity, 0)}</td>
          <td>${escapeHtml(it.unit || '')}</td>
          <td>${aqFmtNum(it.unit_price)}</td>
          <td class="formula-field right">${aqFmtNum(aqItemSubtotal(it))}</td>
          <td class="remark left">${escapeHtml(it.remarks || '')}</td>
        </tr>`);
        alt = !alt;
      });
    });
  });
  rows.push(aqPreviewFooterRowsHtml(q));
  return rows.join('');
}

const AQ_EXPORT_COL_LABELS = ['内容', '分类', '说明', '数量', '单位', '单价', '小计', '备注'];
const AQ_EXPORT_LAYOUT_STORAGE_KEY = 'remy_aq_export_layout_v1';

function aqDefaultExportLayout() {
  return { columnWidths: [5, 7, 42, 6, 6, 8, 9, 12], defaultRowHeight: 7 };
}

function aqCloneExportLayout(src) {
  const base = src && typeof src === 'object' ? src : aqDefaultExportLayout();
  const def = aqDefaultExportLayout();
  return {
    columnWidths: Array.isArray(base.columnWidths)
      ? base.columnWidths.map((w) => Number(w) || 1)
      : def.columnWidths.slice(),
    defaultRowHeight:
      Number.isFinite(Number(base.defaultRowHeight)) && Number(base.defaultRowHeight) > 0
        ? Number(base.defaultRowHeight)
        : def.defaultRowHeight,
  };
}

function aqLoadPersistedLayoutStore() {
  try {
    const raw = localStorage.getItem(AQ_EXPORT_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

function aqPersistExportLayout() {
  try {
    localStorage.setItem(
      AQ_EXPORT_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        pageOrientation: activityQuotesState.exportPdfSettings?.pageOrientation || 'landscape',
        byQuoteId: activityQuotesState.exportLayoutByQuoteId || {},
      })
    );
  } catch (_) {
    /* ignore quota */
  }
}

function aqApplyPersistedPdfOrientation() {
  const store = aqLoadPersistedLayoutStore();
  if (!store?.pageOrientation) return;
  activityQuotesState.exportPdfSettings = activityQuotesState.exportPdfSettings || {};
  activityQuotesState.exportPdfSettings.pageOrientation =
    store.pageOrientation === 'portrait' ? 'portrait' : 'landscape';
}

function aqGetPersistedLayoutForQuote(quoteId) {
  const store = aqLoadPersistedLayoutStore();
  const raw = store?.byQuoteId?.[String(quoteId)];
  return raw ? aqCloneExportLayout(raw) : null;
}

function aqGetLayoutForQuote(quoteId) {
  const key = String(quoteId);
  if (activityQuotesState.exportLayoutByQuoteId[key]) {
    return aqCloneExportLayout(activityQuotesState.exportLayoutByQuoteId[key]);
  }
  return aqGetPersistedLayoutForQuote(quoteId) || aqDefaultExportLayout();
}

function aqColumnWidthsHtml(cols) {
  const sum = cols.reduce((a, b) => a + Number(b), 0) || 1;
  return cols
    .map((w) => `<col style="width:${((Number(w) / sum) * 100).toFixed(2)}%">`)
    .join('');
}

function aqApplyColumnWidthsToTable(table, cols) {
  if (!table || !Array.isArray(cols)) return;
  const colEls = table.querySelectorAll('colgroup col');
  const sum = cols.reduce((a, b) => a + Number(b), 0) || 1;
  cols.forEach((w, i) => {
    if (colEls[i]) colEls[i].style.width = `${((Number(w) / sum) * 100).toFixed(2)}%`;
  });
}

function aqRenderQuotePreviewTableForExport(q) {
  const layout = aqGetLayoutForQuote(q.id);
  activityQuotesState.exportLayoutByQuoteId[String(q.id)] = aqCloneExportLayout(layout);
  const cols = layout.columnWidths;
  const heads = [
    ['内容', 'Item'],
    ['', ''],
    ['说明', 'Summary'],
    ['数量', 'Quantity'],
    ['单位', 'Unit'],
    ['单价', 'Unit Price'],
    ['单项小计', 'Subtotal'],
    ['备注', 'Remarks'],
  ];
  const thHtml = heads
    .map(
      (pair, i) =>
        `<th class="aq-col-head aq-col-resizable" data-col="${i}">
          <span class="aq-col-head-text">${pair[0]}<br>${pair[1]}</span>
          ${i < heads.length - 1 ? `<span class="aq-col-resizer" data-col="${i}" role="separator" title="拖拽调整列宽"></span>` : ''}
        </th>`
    )
    .join('');
  return `<table class="qt-detail-table aq-export-preview-table" data-quote-id="${q.id}">
    <colgroup>${aqColumnWidthsHtml(cols)}</colgroup>
    <thead><tr>${thHtml}</tr></thead>
    <tbody>${aqRenderPreviewTable(q)}</tbody>
  </table>`;
}

function aqIsMergedPreviewWithLayout() {
  const q = activityQuotesState.editing;
  return (
    activityQuotesState.view === 'preview' &&
    aqIsMergedExportQuote(q) &&
    (activityQuotesState.previewBundleQuotes || []).length > 0
  );
}

function aqGetPreviewLayoutActiveKey() {
  if (activityQuotesState.view === 'exportPreview') {
    return activityQuotesState.exportPreviewActiveSheetId;
  }
  if (activityQuotesState.view === 'preview') {
    const active = activityQuotesState.previewBundleActive || 'summary';
    if (active === 'summary') return 'summary';
    const sid = parseInt(String(active).replace(/^q-/, ''), 10);
    return Number.isFinite(sid) ? sid : 'summary';
  }
  return null;
}

function aqInitMergedPreviewLayout(bundleQuotes) {
  aqApplyPersistedPdfOrientation();
  const layout = {};
  (bundleQuotes || []).forEach((s) => {
    layout[String(s.id)] = aqGetLayoutForQuote(s.id);
  });
  activityQuotesState.exportLayoutByQuoteId = layout;
  if (!activityQuotesState.exportPdfSettings) {
    activityQuotesState.exportPdfSettings = { pageOrientation: 'landscape' };
  }
}

function aqInitExportPreviewLayout(quotes) {
  aqApplyPersistedPdfOrientation();
  const layout = {};
  (quotes || []).forEach((q) => {
    layout[String(q.id)] = aqGetLayoutForQuote(q.id);
  });
  activityQuotesState.exportLayoutByQuoteId = layout;
  if (!activityQuotesState.exportPdfSettings) {
    activityQuotesState.exportPdfSettings = { pageOrientation: 'landscape' };
  }
}

function aqRefreshPreviewLayoutPanes() {
  if (activityQuotesState.view === 'exportPreview') {
    const layoutPanel = document.getElementById('aqExportLayoutPanel');
    if (layoutPanel) layoutPanel.innerHTML = aqRenderExportLayoutPanel();
    const pane = document.getElementById('aqExportSheetPane');
    if (pane) pane.innerHTML = aqRenderExportActiveSheetPane();
    aqInitPreviewColumnResizeBindings();
    return;
  }
  if (activityQuotesState.view === 'preview' && aqIsMergedPreviewWithLayout()) {
    const layoutPanel = document.getElementById('aqPreviewLayoutPanel');
    if (layoutPanel) layoutPanel.innerHTML = aqRenderExportLayoutPanel();
    const host = document.getElementById('aqPreviewBundleHost');
    if (host) host.innerHTML = aqRenderMultiBundlePreviewBody();
    aqInitPreviewColumnResizeBindings();
  }
}

function aqAfterPreviewPageRender() {
  if (activityQuotesState.view === 'exportPreview' || activityQuotesState.view === 'preview') {
    aqInitPreviewColumnResizeBindings();
  }
}

function aqRenderExportLayoutPanel() {
  const activeId = aqGetPreviewLayoutActiveKey();
  const orient = activityQuotesState.exportPdfSettings?.pageOrientation || 'landscape';
  const orientOpts = [
    ['landscape', '横向 A4'],
    ['portrait', '纵向 A4'],
  ]
    .map(
      ([v, label]) =>
        `<option value="${v}"${orient === v ? ' selected' : ''}>${label}</option>`
    )
    .join('');
  const canEditCols = activeId !== 'summary' && activeId != null;
  let sheetTools = '';
  if (canEditCols) {
    const qid = String(activeId);
    if (!activityQuotesState.exportLayoutByQuoteId[qid]) {
      activityQuotesState.exportLayoutByQuoteId[qid] = aqGetLayoutForQuote(activeId);
    }
    const layout = activityQuotesState.exportLayoutByQuoteId[qid];
    const rh = layout.defaultRowHeight || 7;
    sheetTools = `
      <span class="aq-preview-toolbar-hint">在下方表格表头<strong>拖拽竖线</strong>调整列宽（与 Excel 类似），设置会自动保存</span>
      <label class="aq-preview-toolbar-field">行高(pt)
        <input type="number" class="form-control form-control-sm" min="4" step="0.5" value="${rh}"
          onchange="aqOnExportLayoutChange(${activeId}, 'defaultRowHeight', 0, this.value)">
      </label>
      <button type="button" class="btn btn-ghost btn-sm" onclick="aqResetExportLayoutForActiveSheet()">重置本 Sheet 列宽</button>`;
  } else {
    sheetTools =
      '<span class="aq-preview-toolbar-hint">Summary 页为汇总表；切换到单场 Sheet 后可拖拽表头调整列宽。</span>';
  }
  return `<div class="aq-preview-toolbar">
    <label class="aq-preview-toolbar-field">PDF 纸张方向
      <select class="form-control form-control-sm" onchange="aqOnExportPdfOrientationChange(this.value)">${orientOpts}</select>
    </label>
    ${sheetTools}
  </div>`;
}

function aqOnExportPdfOrientationChange(value) {
  activityQuotesState.exportPdfSettings = activityQuotesState.exportPdfSettings || {};
  activityQuotesState.exportPdfSettings.pageOrientation =
    value === 'portrait' ? 'portrait' : 'landscape';
  aqPersistExportLayout();
}

function aqResetExportLayoutForActiveSheet() {
  const activeId = aqGetPreviewLayoutActiveKey();
  if (activeId === 'summary' || activeId == null) return;
  activityQuotesState.exportLayoutByQuoteId[String(activeId)] = aqDefaultExportLayout();
  aqPersistExportLayout();
  aqRefreshPreviewLayoutPanes();
}

function aqSetExportActiveSheet(id) {
  activityQuotesState.exportPreviewActiveSheetId = id;
  const tabs = document.getElementById('aqExportTabs');
  if (tabs) tabs.innerHTML = aqRenderExportTabsHtml();
  aqRefreshPreviewLayoutPanes();
}

function aqOnExportLayoutChange(quoteId, key, index, value) {
  const qid = String(quoteId);
  if (!activityQuotesState.exportLayoutByQuoteId[qid]) {
    activityQuotesState.exportLayoutByQuoteId[qid] = aqGetLayoutForQuote(quoteId);
  }
  const layout = activityQuotesState.exportLayoutByQuoteId[qid];
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return;
  if (key === 'columnWidths') {
    if (!Array.isArray(layout.columnWidths)) layout.columnWidths = aqDefaultExportLayout().columnWidths.slice();
    layout.columnWidths[index] = Math.round(n * 100) / 100;
  } else if (key === 'defaultRowHeight') {
    layout.defaultRowHeight = Math.round(n * 100) / 100;
  }
  aqPersistExportLayout();
  if (key === 'columnWidths') {
    const host =
      document.getElementById('aqExportSheetPane') || document.getElementById('aqPreviewBundleHost');
    const table = host?.querySelector?.(`.aq-export-preview-table[data-quote-id="${qid}"]`);
    if (table) aqApplyColumnWidthsToTable(table, layout.columnWidths);
    return;
  }
  aqRefreshPreviewLayoutPanes();
}

function aqBindPreviewColumnResize(container, quoteId) {
  if (!container || quoteId == null) return;
  const table = container.querySelector(`.aq-export-preview-table[data-quote-id="${quoteId}"]`);
  if (!table || table.dataset.resizeBound === '1') return;
  table.dataset.resizeBound = '1';
  const qid = String(quoteId);
  table.querySelectorAll('.aq-col-resizer').forEach((handle) => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const col = parseInt(handle.getAttribute('data-col'), 10);
      if (!Number.isFinite(col)) return;
      if (!activityQuotesState.exportLayoutByQuoteId[qid]) {
        activityQuotesState.exportLayoutByQuoteId[qid] = aqGetLayoutForQuote(quoteId);
      }
      const layout = activityQuotesState.exportLayoutByQuoteId[qid];
      const startWidths = (layout.columnWidths || aqDefaultExportLayout().columnWidths).map((w) => Number(w) || 1);
      const totalUnits = startWidths.reduce((a, b) => a + b, 0) || 1;
      const neighbor = col < startWidths.length - 1 ? col + 1 : col - 1;
      if (neighbor < 0) return;
      const startX = e.clientX;
      const tableW = table.getBoundingClientRect().width || 1;
      const minW = 1;
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const deltaUnits = (dx / tableW) * totalUnits;
        const widths = startWidths.slice();
        let nextCol = widths[col] + deltaUnits;
        let nextNeighbor = widths[neighbor] - deltaUnits;
        if (nextCol < minW) {
          nextNeighbor -= minW - nextCol;
          nextCol = minW;
        }
        if (nextNeighbor < minW) {
          nextCol -= minW - nextNeighbor;
          nextNeighbor = minW;
        }
        widths[col] = Math.round(nextCol * 100) / 100;
        widths[neighbor] = Math.round(nextNeighbor * 100) / 100;
        layout.columnWidths = widths;
        aqApplyColumnWidthsToTable(table, widths);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('aq-col-resizing');
        aqPersistExportLayout();
      };
      document.body.classList.add('aq-col-resizing');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function aqInitPreviewColumnResizeBindings() {
  const activeId = aqGetPreviewLayoutActiveKey();
  if (activeId === 'summary' || activeId == null) return;
  const host = document.getElementById('aqExportSheetPane') || document.getElementById('aqPreviewBundleHost');
  if (!host) return;
  host.querySelectorAll('.aq-export-preview-table').forEach((t) => {
    t.dataset.resizeBound = '';
  });
  aqBindPreviewColumnResize(host, activeId);
}

function aqRenderExportActiveSheetPane() {
  const activeId = activityQuotesState.exportPreviewActiveSheetId;
  if (activeId === 'summary') {
    const rows = activityQuotesState.exportPreviewQuotes || [];
    const feeCols = ['fee_comm', 'fee_design', 'fee_freight', 'fee_print', 'fee_photo'];
    const sum = { sub: 0, svc: 0, tax: 0, total: 0 };
    const trs = rows
      .map((q) => {
        const sub = Number(q.subtotal_ex_tax) || 0;
        const svc = Number(q.service_charge) || 0;
        const tax = Number(q.tax_amount) || 0;
        const total = Number(q.total_amount) || 0;
        sum.sub += sub;
        sum.svc += svc;
        sum.tax += tax;
        sum.total += total;
        const feeTds = feeCols.map(() => '<td class="numeric">0.00</td>').join('');
        return `<tr>
          <td>${escapeHtml(aqNormalizeEventDate(q.event_date) || '—')}</td>
          <td>${escapeHtml(q.city || '—')}</td>
          <td>${escapeHtml(q.customer_name || '—')}</td>
          <td>${escapeHtml(q.event_type || '—')}</td>
          ${feeTds}
          <td class="numeric formula-field">${aqFmtNum(sub)}</td>
          <td class="numeric formula-field">${aqFmtNum(svc)}</td>
          <td class="numeric formula-field">${aqFmtNum(tax)}</td>
          <td class="numeric formula-field">${aqFmtNum(total)}</td>
          <td class="remark left aq-remarks-cell">—</td>
        </tr>`;
      })
      .join('');
    return `<div class="qt-sheet-wrap">
      <div class="info-row form-hint qt-header-extra">Summary 多场报价（一行一场）</div>
      <div class="table-wrapper qt-table-scroll">
        <table class="qt-detail-table">
          <thead>${aqMultiPreviewHeadHtml()}</thead>
          <tbody>${trs}<tr class="qt-footer-row qt-total-row">
            <td colspan="${aqMultiPreviewColsBeforeTotals()}" style="text-align:right">多场含税总计</td>
            <td class="numeric formula-field">${aqFmtNum(sum.sub)}</td>
            <td class="numeric formula-field">${aqFmtNum(sum.svc)}</td>
            <td class="numeric formula-field">${aqFmtNum(sum.tax)}</td>
            <td class="numeric formula-field">${aqFmtNum(sum.total)}</td>
            <td class="aq-remarks-cell"></td>
          </tr></tbody>
        </table>
      </div>
    </div>`;
  }
  const q = (activityQuotesState.exportPreviewQuotes || []).find((x) => Number(x.id) === Number(activeId));
  if (!q) return '<div class="empty-state">请选择一个 Sheet</div>';
  return `<div class="qt-sheet-wrap">
      ${aqRenderQtHeaderHtml(q, true)}
      <div class="table-wrapper qt-table-scroll">${aqRenderQuotePreviewTableForExport(q)}</div>
    </div>`;
}

function aqRenderExportTabsHtml() {
  const quotes = activityQuotesState.exportPreviewQuotes || [];
  const active = activityQuotesState.exportPreviewActiveSheetId;
  const summaryBtn = `<button type="button" class="btn btn-xs ${active === 'summary' ? 'btn-primary' : 'btn-secondary'}" onclick="aqSetExportActiveSheet('summary')">Summary</button>`;
  const quoteBtns = quotes
    .map((q) => {
      const on = Number(active) === Number(q.id);
      return `<button type="button" class="btn btn-xs ${on ? 'btn-primary' : 'btn-secondary'}" onclick="aqSetExportActiveSheet(${q.id})">${escapeHtml(q.project_code || q.project_name || `Sheet-${q.id}`)}</button>`;
    })
    .join('');
  return `${summaryBtn}${quoteBtns}`;
}

async function aqExportPdfFromMergedPreview() {
  const q = activityQuotesState.editing;
  if (!q || !q.id) {
    showToast('请先打开合并报价预览', 'warning');
    return;
  }
  try {
    const res = await fetch(`/api/quotations/${q.id}/export-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        layoutByQuoteId: activityQuotesState.exportLayoutByQuoteId || {},
        pageOrientation: activityQuotesState.exportPdfSettings?.pageOrientation || 'landscape',
      }),
    });
    if (!res.ok) {
      let msg = `导出失败（${res.status}）`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    const filename = aqParseDownloadFilename(res, `quotation-${q.id}.pdf`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('报价 PDF 已导出', 'success');
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
}

async function aqExportExcelFromMergedPreview() {
  const q = activityQuotesState.editing;
  if (!q || !q.id) {
    showToast('请先打开合并报价预览', 'warning');
    return;
  }
  try {
    const res = await fetch(`/api/quotations/${q.id}/export-excel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        layoutByQuoteId: activityQuotesState.exportLayoutByQuoteId || {},
      }),
    });
    if (!res.ok) {
      let msg = `导出失败（${res.status}）`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    const filename = aqParseDownloadFilename(res, `quotation-${q.id}.xlsx`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('报价 Excel 已导出', 'success');
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
}

async function aqExportPdfFromPreview() {
  const ids = (activityQuotesState.exportPreviewQuotes || []).map((q) => Number(q.id)).filter(Number.isFinite);
  if (!ids.length) {
    showToast('请先选择报价', 'warning');
    return;
  }
  const projectName = String(activityQuotesState.exportMergeProjectName || '').trim();
  try {
    const res = await fetch('/api/quotations/bundle/export-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        ids,
        project_name: projectName,
        layoutByQuoteId: activityQuotesState.exportLayoutByQuoteId || {},
        pageOrientation: activityQuotesState.exportPdfSettings?.pageOrientation || 'landscape',
      }),
    });
    if (!res.ok) {
      let msg = `导出失败（${res.status}）`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    const filename = aqParseDownloadFilename(res, 'quotation-summary.pdf');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('报价 PDF 已导出', 'success');
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
}

async function aqExportFromPreview() {
  const ids = (activityQuotesState.exportPreviewQuotes || []).map((q) => Number(q.id)).filter(Number.isFinite);
  if (!ids.length) {
    showToast('请先选择报价', 'warning');
    return;
  }
  try {
    const res = await fetch('/api/quotations/bundle/export-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        ids,
        layoutByQuoteId: activityQuotesState.exportLayoutByQuoteId || {},
      }),
    });
    if (!res.ok) {
      let msg = `导出失败（${res.status}）`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    const filename = aqParseDownloadFilename(res, 'quotation-summary.xlsx');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('报价 Excel 已导出', 'success');
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
}

async function aqGenerateMergedQuoteFromPreview() {
  const quotes = activityQuotesState.exportPreviewQuotes || [];
  if (!quotes.length) {
    showToast('请先选择报价', 'warning');
    return;
  }
  const projectName = String(activityQuotesState.exportMergeProjectName || '').trim();
  if (!projectName) {
    showToast('请填写合并报价名称', 'warning');
    return;
  }
  const fallbackSessions = quotes
    .filter((q) => Number.isFinite(Number(q.activity_id)))
    .map((q, i) => ({
      activity_id: Number(q.activity_id),
      project_code: q.project_code || '',
      event_date: aqNormalizeEventDate(q.event_date) || null,
      city: q.city || '',
      customer_name: q.customer_name || '',
      event_type: q.event_type || '',
      remarks: '',
      sort_order: i,
      fee_comm: Number(q.subtotal_ex_tax) || 0,
      fee_design: 0,
      fee_freight: 0,
      fee_print: 0,
      fee_photo: 0,
    }));
  try {
    await api('POST', '/quotations/bundle/create-merged', {
      ids: quotes.map((q) => Number(q.id)).filter(Number.isFinite),
      project_name: projectName,
    });
    showToast('合并报价已生成，已加入活动报价列表', 'success');
    activityQuotesState.view = 'list';
    activityQuotesState.exportPickSelectedIds = [];
    activityQuotesState.exportPreviewQuotes = [];
    await renderActivityQuotes();
  } catch (e) {
    const msg = String(e.message || '');
    // 兼容未重启后端的场景：新接口 404 时回退旧创建逻辑，避免阻塞用户
    if (msg.includes('404') && msg.includes('/quotations/bundle/create-merged')) {
      if (!fallbackSessions.length) {
        showToast('后端接口未生效且所选报价缺少关联场次，请重启服务后重试', 'error');
        return;
      }
      try {
        await api('POST', '/quotations', {
          type: 'EVENT',
          quote_mode: 'multi',
          year_frame_id: currentYearFrameId,
          project_name: projectName,
          merged_from_quote_ids: quotes.map((q) => Number(q.id)).filter(Number.isFinite),
          linked_sessions: fallbackSessions,
        });
        showToast('已用兼容模式生成合并报价（建议重启服务启用新接口）', 'success');
        activityQuotesState.view = 'list';
        activityQuotesState.exportPickSelectedIds = [];
        activityQuotesState.exportPreviewQuotes = [];
        await renderActivityQuotes();
        return;
      } catch (e2) {
        showToast(e2.message || '合并生成失败，请重启服务后重试', 'error');
        return;
      }
    }
    showToast(msg || '合并生成失败', 'error');
  }
}

function aqRenderExportPreviewHtml() {
  return `<div class="aq-edit-head">
      <button type="button" class="btn btn-secondary btn-sm" onclick="activityQuotesState.view='exportPick';renderActivityQuotes()">← 上一步</button>
      <span class="aq-multi-pick-step-title">合并导出报价 · 第 2 步：预览与版式调整</span>
      <input type="text" class="form-control form-control-sm" style="max-width:320px" value="${escapeHtml(activityQuotesState.exportMergeProjectName || '')}" placeholder="合并报价名称" oninput="activityQuotesState.exportMergeProjectName=this.value">
      <button type="button" class="btn btn-primary btn-sm" onclick="aqGenerateMergedQuoteFromPreview()">合并生成</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqExportPdfFromPreview()">导出 PDF</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="aqExportFromPreview()">导出 Excel</button>
    </div>
    <div class="aq-preview-workspace">
      <div id="aqExportLayoutPanel">${aqRenderExportLayoutPanel()}</div>
      <div class="aq-export-tabs" id="aqExportTabs">${aqRenderExportTabsHtml()}</div>
      <div id="aqExportSheetPane" class="aq-preview-table-stage">${aqRenderExportActiveSheetPane()}</div>
    </div>`;
}

function aqPrepareEditingItems() {
  const q = activityQuotesState.editing;
  if (!q || !Array.isArray(q.items)) return;
  aqEnsureMultiSessions(q);
  aqEnrichItemsFromTemplateDefaults(q);
  q.items.forEach((it, i) => {
    it._idx = i;
    it.subtotal = aqItemSubtotal(it);
  });
}

function aqRefreshSectionSubtotals() {
  const q = activityQuotesState.editing;
  const tbody = document.getElementById('aqEditTableBody');
  if (!q || !tbody) return;
  const groups = aqGroupItemsForTable(q.items || []);
  const headers = tbody.querySelectorAll('tr.qt-section-header');
  groups.forEach((sec, i) => {
    const tr = headers[i];
    if (!tr) return;
    const cell = tr.querySelector('td.right');
    if (cell) cell.textContent = aqFmtNum(sec.sectionSubtotal);
  });
}

function aqRefreshEditTotalsOnly() {
  const foot = document.getElementById('aqEditTotals');
  const q = activityQuotesState.editing;
  if (!foot || !q) return;
  const t = aqCalcTotalsForQuote(q);
  foot.innerHTML = `
      <div class="aq-totals-grid">
        <span>不含税小计</span><strong>${aqFmtNum(t.subtotalExTax)}</strong>
        <span>服务费 (${Math.round(t.serviceRate * 100)}%)</span><strong>${aqFmtNum(t.serviceCharge)}</strong>
        <span>税费 (6%)</span><strong>${aqFmtNum(t.taxAmount)}</strong>
        <span>含税总计</span><strong class="aq-total-amt">${aqFmtNum(t.totalAmount)}</strong>
      </div>`;
}

function aqOnItemFieldChange(idx, field, value) {
  const q = activityQuotesState.editing;
  if (!q || !q.items || !q.items[idx]) return;
  const it = q.items[idx];
  if (field === 'quantity' || field === 'unit_price') {
    it[field] = parseFloat(value) || 0;
    it.subtotal = aqItemSubtotal(it);
    const row = document.querySelector(`tr[data-item-idx="${idx}"]`);
    const sub = row?.querySelector('.aq-line-sub');
    if (sub) sub.textContent = aqFmtNum(it.subtotal);
    aqRefreshSectionSubtotals();
    aqRefreshEditTotalsOnly();
    return;
  }
  it[field] = value;
}

function aqRemoveItem(idx) {
  const q = activityQuotesState.editing;
  if (!q || !q.items) return;
  q.items.splice(idx, 1);
  aqPrepareEditingItems();
  aqRefreshEditView();
}

function aqAddCustomItem(subsectionCode) {
  const q = activityQuotesState.editing;
  if (!q) return;
  const ref = (q.items || []).find((it) => it.subsection_code === subsectionCode);
  if (!ref) return;
  const maxSort = Math.max(0, ...(q.items || []).map((it) => it.sort_order || 0));
  q.items.push({
    section_code: ref.section_code,
    section_name: ref.section_name,
    subsection_code: ref.subsection_code,
    subsection_name: ref.subsection_name,
    description: '',
    quantity: 0,
    unit: '项',
    unit_price: 0,
    subtotal: 0,
    remarks: '',
    sort_order: maxSort + 1,
    is_custom: 1,
    is_template: 0,
  });
  aqPrepareEditingItems();
  aqRefreshEditView();
}

function aqRefreshEditView() {
  const host = document.getElementById('aqEditTableBody');
  const multiHost = document.getElementById('aqMultiGridBody');
  const foot = document.getElementById('aqEditTotals');
  const q = activityQuotesState.editing;
  if (!q) return;
  if (aqIsMultiQuote(q)) {
    if (multiHost) multiHost.innerHTML = aqRenderMultiGridRows(q);
  } else if (host) {
    host.innerHTML = aqRenderEditTableRows(q);
    aqRefreshSectionSubtotals();
  }
  if (foot) {
    const t = aqCalcTotalsForQuote(q);
    foot.innerHTML = `
      <div class="aq-totals-grid">
        <span>不含税小计</span><strong>${aqFmtNum(t.subtotalExTax)}</strong>
        <span>服务费 (${Math.round(t.serviceRate * 100)}%)</span><strong>${aqFmtNum(t.serviceCharge)}</strong>
        <span>税费 (6%)</span><strong>${aqFmtNum(t.taxAmount)}</strong>
        <span>含税总计</span><strong class="aq-total-amt">${aqFmtNum(t.totalAmount)}</strong>
      </div>`;
  }
}

async function aqOpenCreate() {
  if (!currentYearFrameId) {
    showToast('请先在左侧选择财年，再新建单场报价', 'warning');
    return;
  }
  activityQuotesState.createForm = {
    activity_id: null,
    project_code: '',
    client_brand: 'REMY COINTREAU',
    client_contact: '',
    project_name: '',
    event_date: '',
    city: '',
    event_type: '',
    service_rate: aqDefaultServiceRate(),
  };
  try {
    await Promise.all([aqLoadTemplateSections(), aqLoadActivitiesForPicker()]);
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
    return;
  }
  if (!activityQuotesState.createActivities.length) {
    showToast('当前财年暂无已填写项目编号的场次，请先在场次记录中创建', 'warning');
    return;
  }
  aqRenderCreateModal();
  openModal('modalActivityQuote');
}

async function aqOpenMultiCreate() {
  if (!currentYearFrameId) {
    showToast('请先在左侧选择财年，再新建多场报价', 'warning');
    return;
  }
  activityQuotesState.multiFilterRegion = '';
  activityQuotesState.multiFilterBelonging = '';
  activityQuotesState.multiFilterDateFrom = '';
  activityQuotesState.multiFilterDateTo = '';
  activityQuotesState.multiPickSelectedIds = [];
  activityQuotesState.multiAddSelectedIds = [];
  activityQuotesState.multiProjectName = '';
  activityQuotesState.editing = null;
  try {
    await Promise.all([aqLoadActivitiesForPicker(), aqEnsureBelongingFilterOptions()]);
    if (!activityQuotesState.createActivities.length) {
      showToast('当前财年暂无已填写项目编号的场次，请先在场次记录中创建', 'warning');
      return;
    }
    activityQuotesState.view = 'multiPick';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
  }
}

async function aqOpenExportQuote() {
  if (!currentYearFrameId) {
    showToast('请先在左侧选择财年，再合并导出报价', 'warning');
    return;
  }
  activityQuotesState.multiFilterRegion = '';
  activityQuotesState.multiFilterBelonging = '';
  activityQuotesState.multiFilterDateFrom = '';
  activityQuotesState.multiFilterDateTo = '';
  activityQuotesState.exportPickSelectedIds = [];
  activityQuotesState.exportPreviewQuotes = [];
  activityQuotesState.exportPreviewActiveSheetId = null;
  activityQuotesState.exportLayoutByQuoteId = {};
  activityQuotesState.exportMergeProjectName = '';
  activityQuotesState.editing = null;
  activityQuotesState.view = 'exportPick';
  await renderActivityQuotes();
}

function aqRenderExportPickRows() {
  const selected = new Set((activityQuotesState.exportPickSelectedIds || []).map(Number));
  const rows = (activityQuotesState.list || []).filter((q) => {
    if (!q || String(q.quote_mode || 'single') !== 'single') return false;
    const date = aqNormalizeEventDate(q.event_date);
    const region = activityQuotesState.multiFilterRegion || '';
    const belonging = activityQuotesState.multiFilterBelonging || '';
    const df = activityQuotesState.multiFilterDateFrom || '';
    const dt = activityQuotesState.multiFilterDateTo || '';
    if (df && (!date || date < df)) return false;
    if (dt && (!date || date > dt)) return false;
    if (region || belonging) {
      const act = (activityQuotesState.createActivities || []).find((a) => String(a.project_code || '').trim() === String(q.project_code || '').trim());
      if (region && String(act?.region || '').trim() !== region) return false;
      if (belonging && aqActivityBelongingValue(act) !== belonging) return false;
    }
    return true;
  });
  if (!rows.length) return '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">无符合条件的单场报价</td></tr>';
  return rows
    .map((r) => `<tr>
      <td><input type="checkbox"${selected.has(Number(r.id)) ? ' checked' : ''} onchange="aqToggleExportPickId(${r.id}, this.checked)"></td>
      <td><code>${escapeHtml(r.project_code || '—')}</code></td>
      <td>${escapeHtml(r.project_name || '—')}</td>
      <td>${escapeHtml(r.city || '—')}</td>
      <td>${escapeHtml(r.customer_name || '—')}</td>
      <td>${escapeHtml(aqNormalizeEventDate(r.event_date) || '—')}</td>
      <td>${escapeHtml(r.event_type || '—')}</td>
      <td class="numeric">${fmtMoney(r.total_amount)}</td>
    </tr>`)
    .join('');
}

function aqToggleExportPickId(id, checked) {
  const ids = new Set((activityQuotesState.exportPickSelectedIds || []).map(Number));
  if (checked) ids.add(Number(id));
  else ids.delete(Number(id));
  activityQuotesState.exportPickSelectedIds = [...ids];
  const btn = document.getElementById('aqExportPickNextBtn');
  if (btn) btn.textContent = `下一步（已选 ${ids.size} 条报价）`;
}

async function aqConfirmExportPickStep() {
  const ids = (activityQuotesState.exportPickSelectedIds || []).map(Number).filter(Number.isFinite);
  if (!ids.length) {
    showToast('请至少选择 1 条报价', 'warning');
    return;
  }
  const projectName = String(
    document.getElementById('aqExportPickProjectName')?.value || activityQuotesState.exportMergeProjectName || ''
  ).trim();
  if (!projectName) {
    showToast('请填写报价单名称', 'warning');
    return;
  }
  activityQuotesState.exportMergeProjectName = projectName;
  try {
    const res = await api('POST', '/quotations/bundle/preview', { ids });
    const quotes = Array.isArray(res.data) ? res.data : [];
    if (!quotes.length) {
      showToast('未加载到可预览的报价', 'warning');
      return;
    }
    activityQuotesState.exportPreviewQuotes = quotes;
    activityQuotesState.exportPreviewActiveSheetId = 'summary';
    aqInitExportPreviewLayout(quotes);
    activityQuotesState.view = 'exportPreview';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '加载预览失败', 'error');
  }
}

function aqRenderExportPickHtml() {
  const selected = (activityQuotesState.exportPickSelectedIds || []).length;
  const nameVal = activityQuotesState.exportMergeProjectName || '';
  return `<div class="aq-edit-head">
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqBackToList()">← 返回列表</button>
      <span class="aq-multi-pick-step-title">合并导出报价 · 第 1 步：筛选并选择报价</span>
    </div>
    <div class="aq-multi-pick-wrap">
      <div class="aq-multi-sessions-head aq-multi-pick-head">
        <div class="aq-multi-sessions-head-main">
          <h3 class="aq-multi-title">筛选条件</h3>
          ${aqRenderMultiFilterSelectsHtml()}
        </div>
      </div>
      <div class="aq-multi-pick-name-row form-group">
        <label class="form-label" for="aqExportPickProjectName">报价单名称 *</label>
        <input type="text" class="form-control" id="aqExportPickProjectName" value="${escapeHtml(nameVal)}"
          placeholder="如 深圳晚宴等2场合并报价" oninput="activityQuotesState.exportMergeProjectName=this.value">
      </div>
      <div class="table-wrapper aq-multi-pick-table-scroll">
        <table class="data-table aq-multi-pick-table">
          <thead><tr><th style="width:40px"></th><th>项目编号</th><th>报价名称</th><th>城市</th><th>客户</th><th>活动日期</th><th>类型</th><th class="numeric">含税总计</th></tr></thead>
          <tbody>${aqRenderExportPickRows()}</tbody>
        </table>
      </div>
      <div class="aq-multi-pick-actions">
        <button type="button" class="btn btn-secondary" onclick="aqBackToList()">取消</button>
        <button type="button" class="btn btn-primary" id="aqExportPickNextBtn" onclick="aqConfirmExportPickStep()">下一步（已选 ${selected} 条报价）</button>
      </div>
    </div>`;
}

function aqOnActivityPick(idStr) {
  const id = parseInt(idStr, 10);
  const f = activityQuotesState.createForm;
  if (!Number.isFinite(id)) {
    f.activity_id = null;
    f.project_code = '';
    f.event_type = '';
    aqUpdateCreateFormTypeHint(null);
    const hint = document.getElementById('aqActivityLinkHint');
    if (hint) {
      hint.textContent = '选择场次后将自动同步活动日期、城市与报价类型';
      hint.style.display = 'block';
    }
    return;
  }
  const act = activityQuotesState.createActivities.find((a) => Number(a.id) === id);
  if (!act) return;
  f.activity_id = id;
  f.project_code = String(act.project_code || '').trim();
  f.city = act.city || '';
  f.event_date = aqFormatActivityDate(act);
  aqSyncCreateFormEventTypeFromActivity(act);
  const autoName = [act.city, act.activity_type].filter(Boolean).join('');
  f.project_name = autoName ? `${autoName}报价` : f.project_code;
  const hint = document.getElementById('aqActivityLinkHint');
  if (hint) {
    const dateHint = f.event_date ? ` · 活动日期 ${escapeHtml(f.event_date)}` : '';
    hint.innerHTML = `已关联：<strong>${escapeHtml(f.project_code)}</strong>${dateHint}`;
    hint.style.display = 'block';
  }
  aqUpdateCreateFormTypeHint(act);
  const cityEl = document.getElementById('aqFCity');
  if (cityEl) cityEl.value = f.city || '';
}

function aqRenderCreateModal() {
  const body = document.getElementById('modalActivityQuoteBody');
  if (!body) return;
  const f = activityQuotesState.createForm;
  const pickedAct = f.activity_id
    ? activityQuotesState.createActivities.find((a) => Number(a.id) === Number(f.activity_id))
    : null;
  const typeHint =
    pickedAct && f.event_type
      ? `报价类型：<strong>${escapeHtml(f.event_type)}</strong>（来自场次：${escapeHtml(aqFormatActivityTypeSource(pickedAct))}）`
      : '';
  const actOpts = activityQuotesState.createActivities
    .map((a) => {
      const sel = Number(f.activity_id) === Number(a.id) ? ' selected' : '';
      return `<option value="${a.id}"${sel}>${escapeHtml(aqActivityOptionLabel(a))}</option>`;
    })
    .join('');
  const linkHint = f.activity_id
    ? `已关联：<strong>${escapeHtml(f.project_code || '')}</strong>${f.event_date ? ` · 活动日期 ${escapeHtml(f.event_date)}` : ''}`
    : '选择场次后将自动同步活动日期、城市与报价类型';
  body.innerHTML = `
    <p class="modal-activity-lead">须关联场次<strong>项目编号</strong>；类型（有无执行、活动形式）从场次自动读取，无需再选。创建后含全部预置明细，可在列表中点「编辑」调整。服务费默认 10%。</p>
    <div class="form-grid">
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">关联项目编号 *</label>
        <select class="form-control" id="aqFActivity" onchange="aqOnActivityPick(this.value)">
          <option value="">请选择场次…</option>
          ${actOpts}
        </select>
        <p id="aqActivityLinkHint" class="form-hint" style="margin-top:6px${f.activity_id ? '' : ';display:none'}">${linkHint}</p>
        <p id="aqActivityTypeHint" class="form-hint aq-type-from-activity" style="margin-top:6px${typeHint ? '' : ';display:none'}">${typeHint}</p>
      </div>
      <div class="form-group"><label class="form-label">客户/品牌</label>
        <input class="form-control" id="aqFBrand" value="${escapeHtml(f.client_brand || '')}"></div>
      <div class="form-group"><label class="form-label">客户方负责人</label>
        <input class="form-control" id="aqFContact" value="${escapeHtml(f.client_contact || '')}" placeholder="选填"></div>
      <div class="form-group"><label class="form-label">报价单项目名称 *</label>
        <input class="form-control" id="aqFProject" value="${escapeHtml(f.project_name || '')}" placeholder="如 福州晚宴报价"></div>
      <div class="form-group"><label class="form-label">城市</label>
        <input class="form-control" id="aqFCity" value="${escapeHtml(f.city || '')}"></div>
      <div class="form-group"><label class="form-label">服务费率</label>
        <select class="form-control" id="aqFRate">${aqServiceRateOptionsHtml(f.service_rate)}</select></div>
    </div>`;
  document.getElementById('modalActivityQuoteFooter').innerHTML = `
    <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
    <button type="button" class="btn btn-primary" onclick="aqSubmitCreate()">创建报价</button>`;
  renderLucideIcons();
}

function aqReadCreateFormFromDom() {
  const f = activityQuotesState.createForm;
  f.client_brand = document.getElementById('aqFBrand')?.value?.trim() || f.client_brand;
  f.client_contact = document.getElementById('aqFContact')?.value?.trim() || '';
  f.project_name = document.getElementById('aqFProject')?.value?.trim() || '';
  f.city = document.getElementById('aqFCity')?.value?.trim() || '';
  const actId = parseInt(document.getElementById('aqFActivity')?.value, 10);
  f.activity_id = Number.isFinite(actId) ? actId : null;
  if (f.activity_id) {
    const act = activityQuotesState.createActivities.find((a) => Number(a.id) === f.activity_id);
    if (act) {
      f.project_code = String(act.project_code || '').trim();
      f.event_date = aqFormatActivityDate(act);
      f.event_type = aqMapActivityEventType(act);
    }
  } else {
    f.event_type = '';
  }
  f.service_rate = parseFloat(document.getElementById('aqFRate')?.value) || aqDefaultServiceRate();
}

async function aqSubmitCreate() {
  aqReadCreateFormFromDom();
  const f = activityQuotesState.createForm;
  if (!f.activity_id) {
    showToast('请选择关联项目编号（场次）', 'warning');
    return;
  }
  if (!f.project_name) {
    showToast('请填写报价单项目名称', 'warning');
    return;
  }
  if (!f.event_type) {
    showToast('无法从场次读取报价类型，请重新选择场次', 'warning');
    return;
  }
  const ids = (activityQuotesState.templateSections || []).map((t) => t.id).filter(Boolean);
  if (!ids.length) {
    showToast('预置模版未加载，请刷新后重试', 'error');
    return;
  }
  try {
    await api('POST', '/quotations', {
      type: 'EVENT',
      year_frame_id: currentYearFrameId || null,
      activity_id: f.activity_id,
      client_brand: f.client_brand,
      client_contact: f.client_contact || null,
      project_name: f.project_name,
      event_date: f.event_date || null,
      city: f.city || null,
      event_type: f.event_type,
      service_rate: f.service_rate,
      template_item_ids: ids,
    });
    closeModal();
    showToast('报价已创建，预置明细已全部载入', 'success');
    activityQuotesState.editing = null;
    activityQuotesState.view = 'list';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '创建失败', 'error');
  }
}

function aqBuildSavePayload(q) {
  const totals = aqCalcTotalsForQuote(q);
  const payload = {
    client_brand: q.client_brand,
    client_contact: q.client_contact,
    project_name: q.project_name,
    event_date: aqNormalizeEventDate(q.event_date) || null,
    city: q.city,
    customer_name: q.customer_name,
    event_type: q.event_type,
    service_rate: totals.serviceRate,
    tax_rate: totals.taxRate,
    items: (q.items || []).map((it, i) => ({
      section_code: it.section_code,
      section_name: it.section_name,
      subsection_code: it.subsection_code,
      subsection_name: it.subsection_name,
      description: it.description,
      quantity: it.quantity,
      unit: it.unit,
      unit_price: it.unit_price,
      remarks: it.remarks,
      sort_order: i,
      is_custom: it.is_custom ? 1 : 0,
      is_template: it.is_template ? 1 : 0,
    })),
  };
  if (aqIsMultiQuote(q)) {
    const sessions = (q.linked_sessions || [])
      .filter((s) => s && s.activity_id)
      .map((s, i) => {
        const calc = aqCalcSessionRow(s);
        const row = {
          activity_id: s.activity_id,
          project_code: s.project_code,
          event_date: aqNormalizeEventDate(s.event_date) || null,
          city: s.city || '',
          customer_name: s.customer_name || '',
          event_type: s.event_type || '',
          remarks: s.remarks != null ? String(s.remarks).trim() : '',
          sort_order: i,
        };
        AQ_MULTI_FEE_COLS.forEach((col) => {
          row[col.key] = aqParseFee(s, col.key);
        });
        return { ...row, ...calc };
      });
    payload.linked_sessions = sessions;
    payload.items = [];
    payload.service_rate = 0.1;
    payload.tax_rate = 0.06;
    if (sessions[0]) {
      payload.event_date = sessions[0].event_date;
      payload.city = sessions[0].city;
      payload.customer_name = sessions[0].customer_name;
      payload.event_type = sessions[0].event_type;
    }
  }
  return payload;
}

async function aqSaveEditing() {
  const q = activityQuotesState.editing;
  if (!q || !q.id) return;
  if (aqIsMultiQuote(q)) {
    aqReadMultiProjectNameFromDom();
    if (!String(q.project_name || '').trim()) {
      showToast('请填写报价名称', 'warning');
      return;
    }
    const filled = (q.linked_sessions || []).filter((s) => s && s.activity_id);
    if (!filled.length) {
      showToast('请至少关联一场活动（项目编号）', 'warning');
      return;
    }
  }
  try {
    await api('PUT', `/quotations/${q.id}`, aqBuildSavePayload(q));
    showToast('已保存', 'success');
    activityQuotesState.multiDraftPristine = false;
    activityQuotesState.editing = null;
    activityQuotesState.view = 'list';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

function aqRenderQtHeaderHtml(q, bilingual) {
  const bi = bilingual !== false;
  const brandL = bi ? 'Client / Brand 客户/品牌：' : 'Client / Brand：';
  const attendL = bi ? 'Attend to 客户方负责人：' : 'Attend to：';
  const projectL = bi ? 'Project Name 项目名称：' : 'Project Name：';
  return `
    <div class="qt-header-info qt-header-info--with-logo">
      <div class="qt-header-info-main">
        <div class="info-row"><span class="info-label">${brandL}</span><span class="info-value">${escapeHtml(q.client_brand || '')}</span></div>
        <div class="info-row"><span class="info-label">${attendL}</span><span class="info-value">${escapeHtml(q.client_contact || '')}</span></div>
        <div class="info-row"><span class="info-label">${projectL}</span><span class="info-value" id="aqQtHeaderProjectName">${escapeHtml(q.project_name || '')}</span></div>
      </div>
      <img class="qt-company-logo" src="/logo.png?v=2" alt="公司 Logo" width="140" height="auto">
    </div>`;
}

function aqParseDownloadFilename(res, fallback) {
  const cd = res.headers.get('Content-Disposition') || '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  if (star) return decodeURIComponent(star[1]);
  if (plain) return plain[1];
  return fallback;
}

async function aqDownloadQuotationExport(kind, id) {
  const qid = id || activityQuotesState.editing?.id;
  if (!qid) {
    showToast('请先保存报价后再导出', 'warning');
    return;
  }
  const isExcel = kind === 'excel';
  let path = isExcel ? `/api/quotations/${qid}/excel` : `/api/quotations/${qid}/pdf`;
  if (isExcel) {
    const selected = (activityQuotesState.listSelectedIds || []).map(Number).filter(Number.isFinite);
    if (selected.length > 1) {
      const qs = new URLSearchParams();
      qs.set('ids', selected.join(','));
      path = `/api/quotations/bundle/export-excel?${qs.toString()}`;
    }
  }
  const fallback = isExcel ? `quotation-${qid}.xlsx` : `quotation-${qid}.pdf`;
  const label = isExcel ? 'Excel' : 'PDF';
  try {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) {
      let msg = `导出失败（${res.status}）`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) {
        if (res.status === 404) msg = `${label} 接口未找到，请重启 Node 服务后重试`;
      }
      showToast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    if (!blob.size) {
      showToast(`${label} 为空，请检查报价明细`, 'error');
      return;
    }
    const filename = aqParseDownloadFilename(res, fallback);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (isExcel && (activityQuotesState.listSelectedIds || []).length > 1) {
      showToast(`Excel 已下载（汇总 ${activityQuotesState.listSelectedIds.length} 场）`, 'success');
    } else {
      showToast(`${label} 已下载`, 'success');
    }
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
}

function aqToggleListSelect(id, checked) {
  const ids = new Set((activityQuotesState.listSelectedIds || []).map(Number));
  const n = Number(id);
  if (checked) ids.add(n);
  else ids.delete(n);
  activityQuotesState.listSelectedIds = [...ids];
  const all = document.getElementById('aqListSelectAll');
  if (all) {
    const visible = activityQuotesState.list.map((r) => Number(r.id));
    all.checked = visible.length > 0 && visible.every((vid) => ids.has(vid));
  }
}

function aqToggleListSelectAll(checked) {
  if (checked) {
    activityQuotesState.listSelectedIds = activityQuotesState.list.map((r) => Number(r.id));
  } else {
    activityQuotesState.listSelectedIds = [];
  }
  renderActivityQuotes();
}

function aqClearListSelection() {
  activityQuotesState.listSelectedIds = [];
  renderActivityQuotes();
}

async function aqExportPdf(id) {
  return aqDownloadQuotationExport('pdf', id);
}

async function aqExportExcel(id) {
  return aqDownloadQuotationExport('excel', id);
}

function aqPrintPreview() {
  document.body.classList.add('aq-print-mode');
  const done = () => document.body.classList.remove('aq-print-mode');
  window.addEventListener('afterprint', done, { once: true });
  window.print();
}

async function aqOpenEdit(id) {
  try {
    await aqLoadQuotation(id);
    if (!aqIsMultiQuote(activityQuotesState.editing)) {
      await aqLoadTemplateSections();
    }
    activityQuotesState.multiDraftPristine = false;
    if (aqIsMultiQuote(activityQuotesState.editing)) {
      await aqLoadActivitiesForPicker();
      activityQuotesState.multiProjectName = String(activityQuotesState.editing.project_name || '').trim();
    }
    aqPrepareEditingItems();
    activityQuotesState.view = 'edit';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
  }
}

async function aqOpenPreview(id) {
  try {
    await aqLoadQuotation(id);
    activityQuotesState.previewBundleQuotes = [];
    activityQuotesState.previewBundleActive = 'summary';
    if (!aqIsMultiQuote(activityQuotesState.editing)) {
      await aqLoadTemplateSections();
    } else if (aqIsMergedExportQuote(activityQuotesState.editing)) {
      activityQuotesState.previewBundleQuotes = await aqLoadPreviewBundleQuotes(id);
      if (activityQuotesState.previewBundleQuotes.length) {
        aqInitMergedPreviewLayout(activityQuotesState.previewBundleQuotes);
      }
    } else {
      activityQuotesState.previewBundleQuotes = [];
    }
    aqPrepareEditingItems();
    activityQuotesState.view = 'preview';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
  }
}

function aqSetPreviewBundleActive(key) {
  activityQuotesState.previewBundleActive = key;
  aqRefreshPreviewLayoutPanes();
}

function aqRenderMultiBundlePreviewBody() {
  const q = activityQuotesState.editing;
  if (!q) return '';
  const list = activityQuotesState.previewBundleQuotes || [];
  const active = activityQuotesState.previewBundleActive || 'summary';
  if (!list.length) {
    return `<div class="table-wrapper qt-table-scroll aq-multi-preview-scroll">
      <table class="qt-detail-table aq-multi-preview-table">
        <thead>${aqMultiPreviewHeadHtml()}</thead>
        <tbody>${aqRenderMultiPreviewTable(q)}</tbody>
      </table>
    </div>`;
  }
  const tabs = [
    `<button type="button" class="btn btn-xs ${active === 'summary' ? 'btn-primary' : 'btn-secondary'}" onclick="aqSetPreviewBundleActive('summary')">Summary</button>`,
    ...list.map((s) => `<button type="button" class="btn btn-xs ${active === `q-${s.id}` ? 'btn-primary' : 'btn-secondary'}" onclick="aqSetPreviewBundleActive('q-${s.id}')">${escapeHtml(s.project_name || s.project_code || `Sheet-${s.id}`)}</button>`),
  ].join('');
  let body = '';
  if (active === 'summary') {
    body = `<div class="table-wrapper qt-table-scroll aq-multi-preview-scroll">
      <table class="qt-detail-table aq-multi-preview-table">
        <thead>${aqMultiPreviewHeadHtml()}</thead>
        <tbody>${aqRenderMultiPreviewTable(q)}</tbody>
      </table>
    </div>`;
  } else {
    const sid = parseInt(String(active).replace(/^q-/, ''), 10);
    const single = list.find((x) => Number(x.id) === sid);
    body = single
      ? `<div class="table-wrapper qt-table-scroll">${aqRenderQuotePreviewTableForExport(single)}</div>`
      : '<div class="empty-state">该场次报价不存在</div>';
  }
  return `<div class="aq-export-tabs">${tabs}</div><div class="aq-preview-table-stage">${body}</div>`;
}

async function aqDelete(id) {
  if (!confirm('确定删除该报价？')) return;
  try {
    await api('DELETE', `/quotations/${id}`);
    showToast('已删除', 'success');
    if (activityQuotesState.editing && activityQuotesState.editing.id === id) {
      activityQuotesState.editing = null;
      activityQuotesState.view = 'list';
    }
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

async function aqCancelMultiEdit() {
  const q = activityQuotesState.editing;
  if (!q || !aqIsMultiQuote(q)) {
    activityQuotesState.view = 'list';
    activityQuotesState.editing = null;
    await renderActivityQuotes();
    return;
  }
  const wasPristine = aqIsMultiPristine();
  if (!(await aqTryLeaveMultiEdit(true))) return;
  activityQuotesState.view = 'list';
  activityQuotesState.editing = null;
  activityQuotesState.multiDraftPristine = false;
  await renderActivityQuotes();
  if (wasPristine) showToast('已取消，未保存的空报价已删除', 'success');
}

async function aqBackToList() {
  if (
    activityQuotesState.view === 'multiPick' ||
    activityQuotesState.view === 'exportPick' ||
    activityQuotesState.view === 'exportPreview'
  ) {
    activityQuotesState.view = 'list';
    activityQuotesState.multiPickSelectedIds = [];
    activityQuotesState.exportPickSelectedIds = [];
    activityQuotesState.exportPreviewQuotes = [];
    activityQuotesState.exportMergeProjectName = '';
    activityQuotesState.editing = null;
    await renderActivityQuotes();
    return;
  }
  const q = activityQuotesState.editing;
  if (activityQuotesState.view === 'edit' && q && aqIsMultiQuote(q)) {
    const wasPristine = aqIsMultiPristine();
    if (!(await aqTryLeaveMultiEdit(false))) return;
    if (wasPristine) showToast('未编辑的空报价已自动删除', 'success');
  }
  activityQuotesState.view = 'list';
  activityQuotesState.editing = null;
  activityQuotesState.multiDraftPristine = false;
  await renderActivityQuotes();
}

function aqRenderListHtml() {
  const rows = activityQuotesState.list;
  const canWrite = currentUserRole === 'admin';
  const selected = new Set((activityQuotesState.listSelectedIds || []).map(Number));
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(Number(r.id)));
  const exportHint =
    selected.size > 1
      ? `<span class="form-hint">已选 ${selected.size} 场；点任一「导出Excel」将导出汇总（Sheet1=Summary）</span>
         <button type="button" class="btn btn-xs btn-ghost" onclick="aqClearListSelection()">清空选择</button>`
      : '';
  const tbody = rows.length
    ? rows
        .map((r) => {
          const date = r.event_date ? String(r.event_date).slice(0, 10) : '—';
          const checked = selected.has(Number(r.id)) ? ' checked' : '';
          return `<tr>
            <td><input type="checkbox"${checked} onchange="aqToggleListSelect(${r.id}, this.checked)"></td>
            <td class="aq-list-pc-cell">${aqRenderListProjectCodeCell(r)}</td>
            <td>${escapeHtml(r.project_name || '—')}</td>
            <td>${escapeHtml(r.city || '—')}</td>
            <td>${escapeHtml(r.customer_name || '—')}</td>
            <td>${date}</td>
            <td>${escapeHtml(r.event_type || '—')}</td>
            <td class="numeric">${fmtMoney(r.total_amount)}</td>
            <td class="aq-list-actions">
              <button type="button" class="btn btn-xs btn-secondary" onclick="aqOpenPreview(${r.id})">预览</button>
              <button type="button" class="btn btn-xs btn-secondary" onclick="aqExportPdf(${r.id})">导出PDF</button>
              <button type="button" class="btn btn-xs btn-secondary" onclick="aqExportExcel(${r.id})">导出Excel</button>
              <button type="button" class="btn btn-xs btn-primary" onclick="aqOpenEdit(${r.id})">编辑</button>
              ${canWrite ? `<button type="button" class="btn btn-xs btn-ghost" style="color:var(--danger)" onclick="aqDelete(${r.id})">删除</button>` : ''}
            </td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="9" style="color:var(--text-muted);text-align:center">暂无报价，点击「新建单场报价」或「新建多场报价」开始</td></tr>';

  return `
    <div class="page-toolbar aq-toolbar">
      <div class="aq-toolbar-filters">
        <input type="search" class="form-control form-control-sm" placeholder="搜索项目/客户/城市"
          value="${escapeHtml(activityQuotesState.filterQ)}"
          oninput="aqOnFilterQ(this.value)" style="max-width:280px">
        ${exportHint}
      </div>
      ${canWrite ? `<div class="aq-toolbar-actions"><button type="button" class="btn btn-primary btn-sm" onclick="aqOpenCreate()">+ 新建单场报价</button><button type="button" class="btn btn-secondary btn-sm" onclick="aqOpenMultiCreate()">+ 新建多场报价</button><button type="button" class="btn btn-secondary btn-sm" onclick="aqOpenExportQuote()">合并导出报价</button></div>` : ''}
    </div>
    <div class="table-wrapper">
      <table class="data-table">
        <thead><tr>
          <th style="width:42px"><input type="checkbox" id="aqListSelectAll"${allChecked ? ' checked' : ''} onchange="aqToggleListSelectAll(this.checked)" title="全选当前列表"></th>
          <th>项目编号</th><th>报价单名称</th><th>城市</th><th>客户</th><th>活动日期</th>
          <th>类型</th><th class="numeric">含税总计</th><th>操作</th>
        </tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>`;
}

function aqRenderEditHtml() {
  const q = activityQuotesState.editing;
  if (!q) return '';
  const isMulti = aqIsMultiQuote(q);
  const pct = isMulti ? 10 : Math.round((parseFloat(q.service_rate) || aqDefaultServiceRate()) * 100);
  const multiGridBlock = isMulti
    ? `<div class="aq-multi-grid-wrap">
        <datalist id="aqMultiProjectList"></datalist>
        <div class="aq-multi-sessions-head">
          <div class="aq-multi-sessions-head-main">
            <h3 class="aq-multi-title">Summary 多场报价（一行一场）</h3>
            ${aqRenderMultiFilterSelectsHtml()}
          </div>
          <button type="button" class="btn btn-xs btn-secondary" onclick="aqAddMultiSession()">+ 添加场次</button>
        </div>
        <div class="aq-multi-add-panel">
          <div class="aq-multi-add-panel-head">
            <strong>从筛选结果批量添加</strong>
            <div class="aq-multi-add-panel-actions">
              <button type="button" class="btn btn-xs btn-secondary" id="aqMultiAddToggleAllBtn" onclick="aqToggleMultiAddSelectAll()">全选</button>
              <button type="button" class="btn btn-xs btn-primary" onclick="aqAddSelectedSessionsFromPanel()">添加所选到场次表</button>
            </div>
          </div>
          <div id="aqMultiAddPanelBody" class="aq-multi-add-panel-body">${aqRenderMultiAddPanelRows()}</div>
        </div>
        <div class="table-wrapper aq-multi-grid-scroll">
          <table class="data-table aq-multi-grid-table">
            <thead>${aqMultiGridHeadHtml()}</thead>
            <tbody id="aqMultiGridBody">${aqRenderMultiGridRows(q)}</tbody>
          </table>
        </div>
        <p class="form-hint aq-multi-hint">在表格中填写各行费用；筛选后可在上方勾选批量添加（「全选」/「取消全选」可循环切换），或使用「+ 添加场次」逐行选择。</p>
      </div>`
    : '';
  const feeTableHead = isMulti
    ? ''
    : `<thead><tr>
            <th>Item</th><th></th><th>说明</th><th>数量</th><th>单位</th><th>单价</th><th>单项小计</th><th>备注</th><th></th>
          </tr></thead>`;
  const feeTableClass = isMulti ? '' : 'qt-detail-table aq-edit-table-sticky-head';
  const linkedLabel = isMulti
    ? '<span class="aq-badge-multi">多场报价</span>'
    : `<code class="aq-linked-pc">${escapeHtml(q.project_code || q.activity_project_code || '—')}</code>`;
  const singleTableBlock = isMulti
    ? ''
    : `<div class="table-wrapper qt-table-scroll aq-edit-table-scroll">
        <table class="${feeTableClass}">
          ${feeTableHead}
          <tbody id="aqEditTableBody">${aqRenderEditTableRows(q)}</tbody>
        </table>
      </div>`;
  return `
    <div class="aq-edit-head">
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqBackToList()">← 返回列表</button>
      <div class="aq-edit-head-meta">
        ${linkedLabel}
        ${
          isMulti
            ? `<label class="aq-multi-project-name-field">
            <span class="aq-multi-project-name-label">报价名称</span>
            <input type="text" class="form-control form-control-sm" id="aqMultiProjectName"
              value="${escapeHtml(q.project_name || activityQuotesState.multiProjectName || '')}"
              placeholder="请输入报价名称" oninput="aqOnMultiProjectNameInput(this.value)">
          </label>`
            : `<span>${escapeHtml(q.project_name || '')}</span>
            <span class="form-hint">${escapeHtml(q.city || '')} · ${escapeHtml(q.customer_name || '')}</span>`
        }
      </div>
      <div class="aq-edit-head-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="aqOpenPreview(${q.id})">预览版式</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="aqExportPdf(${q.id})">导出PDF</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="aqExportExcel(${q.id})">导出Excel</button>
        ${isMulti ? '<button type="button" class="btn btn-secondary btn-sm" onclick="aqCancelMultiEdit()">取消</button>' : ''}
        <button type="button" class="btn btn-primary btn-sm" onclick="aqSaveEditing()">保存</button>
      </div>
    </div>
    <div class="qt-sheet-wrap">
      ${aqRenderQtHeaderHtml(q, false)}
      <div class="info-row form-hint qt-header-extra">服务费率 ${pct}% · ${isMulti ? 'Summary 模版 · 每场独立报价' : `活动类型 ${escapeHtml(q.event_type || '—')}`}</div>
      ${multiGridBlock}
      ${singleTableBlock}
      <div id="aqEditTotals" class="aq-totals-bar"></div>
    </div>`;
}

function aqRenderPreviewHtml() {
  const q = activityQuotesState.editing;
  if (!q) return '';
  const mergedLayout = aqIsMergedPreviewWithLayout();
  const isMulti = aqIsMultiQuote(q);
  let previewBody = '';
  if (mergedLayout) {
    previewBody = `<div class="aq-preview-workspace">
      <div id="aqPreviewLayoutPanel">${aqRenderExportLayoutPanel()}</div>
      <div id="aqPreviewBundleHost">${aqRenderMultiBundlePreviewBody()}</div>
    </div>`;
  } else if (isMulti) {
    previewBody = `<div id="aqPreviewBundleHost">${aqRenderMultiBundlePreviewBody()}</div>`;
  } else {
    previewBody = `<div class="table-wrapper qt-table-scroll">
      <table class="qt-detail-table">
        <thead><tr>
          <th>内容<br>Item</th><th></th><th>说明<br>Summary</th>
          <th>数量<br>Quantity</th><th>单位<br>Unit</th><th>单价<br>Unit Price</th>
          <th>单项小计<br>Subtotal</th><th>备注<br>Remarks</th>
        </tr></thead>
        <tbody>${aqRenderPreviewTable(q)}</tbody>
      </table>
    </div>`;
  }
  const exportBtns = mergedLayout
    ? `<button type="button" class="btn btn-secondary btn-sm" onclick="aqExportPdfFromMergedPreview()">导出 PDF</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqExportExcelFromMergedPreview()">导出 Excel</button>`
    : `<button type="button" class="btn btn-secondary btn-sm" onclick="aqExportPdf(${q.id})">导出PDF</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqExportExcel(${q.id})">导出Excel</button>`;
  return `
    <div class="aq-edit-head">
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqBackToList()">← 返回列表</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="activityQuotesState.view='edit';renderActivityQuotes()">编辑</button>
      ${exportBtns}
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqPrintPreview()">打印</button>
    </div>
    <div class="qt-sheet-wrap qt-print-area">
      ${aqRenderQtHeaderHtml(q, true)}
      ${previewBody}
    </div>`;
}

function aqOnFilterQ(v) {
  clearTimeout(activityQuotesState._qTimer);
  activityQuotesState._qTimer = setTimeout(async () => {
    activityQuotesState.filterQ = v;
    await renderActivityQuotes();
  }, 350);
}

async function renderActivityQuotes() {
  const container = document.getElementById('pageContainer');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">加载中…</div>';
  try {
    if (activityQuotesState.view === 'list') {
      await aqLoadList();
      container.innerHTML = `<div class="aq-page"><h2 class="page-title">活动报价</h2>${aqRenderListHtml()}</div>`;
    } else if (activityQuotesState.view === 'multiPick') {
      await Promise.all([aqLoadActivitiesForPicker(), aqEnsureBelongingFilterOptions()]);
      container.innerHTML = `<div class="aq-page aq-page-multi-pick"><h2 class="page-title">活动报价</h2>${aqRenderMultiPickHtml()}</div>`;
    } else if (activityQuotesState.view === 'exportPick') {
      await Promise.all([aqLoadList(), aqLoadActivitiesForPicker(), aqEnsureBelongingFilterOptions()]);
      container.innerHTML = `<div class="aq-page aq-page-multi-pick"><h2 class="page-title">活动报价</h2>${aqRenderExportPickHtml()}</div>`;
    } else if (activityQuotesState.view === 'exportPreview') {
      container.innerHTML = `<div class="aq-page aq-page-preview"><h2 class="page-title">活动报价</h2>${aqRenderExportPreviewHtml()}</div>`;
    } else if (activityQuotesState.view === 'edit') {
      if (activityQuotesState.editing && aqIsMultiQuote(activityQuotesState.editing)) {
        await Promise.all([aqLoadActivitiesForPicker(), aqEnsureBelongingFilterOptions()]);
      }
      container.innerHTML = `<div class="aq-page aq-page-edit">${aqRenderEditHtml()}</div>`;
      aqRefreshEditView();
      if (activityQuotesState.editing && aqIsMultiQuote(activityQuotesState.editing)) {
        aqFillMultiProjectDatalist();
        aqUpdateMultiAddToggleAllBtn();
      }
    } else if (activityQuotesState.view === 'preview') {
      container.innerHTML = `<div class="aq-page aq-page-preview">${aqRenderPreviewHtml()}</div>`;
    }
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message || '')}</div></div>`;
  }
  renderLucideIcons();
  aqAfterPreviewPageRender();
}
