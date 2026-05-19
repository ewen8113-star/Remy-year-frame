/**
 * 活动报价模块（活动场次报价 EVENT）
 * 依赖全局：api, escapeHtml, fmtMoney, showToast, currentYearFrameId, currentUserRole, renderLucideIcons, openModal, closeModal
 */

const AQ_EVENT_TYPES = ['无执行晚宴', '有执行晚宴', '全系列执行晚宴', '12|15|18年品鉴'];

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
};

function aqDefaultServiceRate() {
  return 0.1;
}

function aqIsMultiQuote(q) {
  return q && String(q.quote_mode || '').toLowerCase() === 'multi';
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

function aqMapActivityEventType(activityType) {
  const t = String(activityType || '').trim();
  if (t === '品鉴') return '12|15|18年品鉴';
  return '无执行晚宴';
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
  return String(a.project_code || '').trim();
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
  const codes = activityQuotesState.projectCodeList || [];
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
  const acts = activityQuotesState.createActivities || [];
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
  const prev = q.linked_sessions[sessionIdx] || aqEmptyMultiSession();
  q.linked_sessions[sessionIdx] = {
    activity_id: act.id,
    project_code: String(act.project_code || '').trim(),
    event_date: aqFormatActivityDate(act),
    city: act.city || '',
    customer_name: act.client_name || act.client || '',
    event_type: aqMapActivityEventType(act.activity_type),
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
          `<td><input type="number" class="form-control form-control-sm aq-multi-fee-inp" min="0" step="0.01"
            value="${aqParseFee(s, col.key)}"
            onchange="aqOnMultiFeeChange(${si}, '${col.key}', this.value)"></td>`
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

function aqRenderMultiPreviewTable(q) {
  const sessions = q.linked_sessions || [];
  let rows = '';
  sessions.forEach((s, i) => {
    const calc = aqCalcSessionRow(s);
    const feeTd = AQ_MULTI_FEE_COLS.map((col) => `<td class="numeric">${aqFmtNum(aqParseFee(s, col.key))}</td>`).join('');
    rows += `<tr class="${i % 2 ? 'qt-alt-row' : ''}">
      <td class="left">${escapeHtml(s.project_code || '—')}</td>
      <td>${escapeHtml(aqNormalizeEventDate(s.event_date) || '—')}</td>
      <td>${escapeHtml(s.city || '—')}</td>
      <td>${escapeHtml(s.customer_name || '—')}</td>
      <td>${escapeHtml(s.event_type || '—')}</td>
      ${feeTd}
      <td class="numeric formula-field">${aqFmtNum(calc.subtotal_ex_tax)}</td>
      <td class="numeric formula-field">${aqFmtNum(calc.service_charge)}</td>
      <td class="numeric formula-field">${aqFmtNum(calc.tax_amount)}</td>
      <td class="numeric formula-field aq-row-total">${aqFmtNum(calc.row_total)}</td>
      <td></td>
    </tr>`;
  });
  const t = aqCalcMultiGrandTotals(sessions);
  rows += `<tr class="qt-footer-row qt-total-row">
    <td colspan="10" class="left-text">多场含税总计</td>
    <td class="numeric formula-field">${aqFmtNum(t.subtotalExTax)}</td>
    <td class="numeric formula-field">${aqFmtNum(t.serviceCharge)}</td>
    <td class="numeric formula-field">${aqFmtNum(t.taxAmount)}</td>
    <td class="numeric formula-field">${aqFmtNum(t.totalAmount)}</td>
    <td></td>
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
              oninput="aqOnItemFieldChange(${it._idx}, 'description', this.value)"></td>`
          : `<td class="left">${escapeHtml(descPlain.replace(/\n/g, '<br>'))}</td>`;
        rows.push(`<tr class="${alt ? 'qt-alt-row' : ''}" data-item-idx="${it._idx}">
          ${subCodeCell}
          ${descCell}
          <td><input type="number" class="form-control form-control-sm aq-inp-qty" min="0" step="any"
            value="${parseFloat(it.quantity) || 0}" onchange="aqOnItemFieldChange(${it._idx}, 'quantity', this.value)"></td>
          <td><input type="text" class="form-control form-control-sm"
            value="${escapeHtml(it.unit || '')}" onchange="aqOnItemFieldChange(${it._idx}, 'unit', this.value)"></td>
          <td><input type="number" class="form-control form-control-sm aq-inp-price" min="0" step="0.01"
            value="${parseFloat(it.unit_price) || 0}" onchange="aqOnItemFieldChange(${it._idx}, 'unit_price', this.value)"></td>
          <td class="right aq-line-sub">${aqFmtNum(aqItemSubtotal(it))}</td>
          <td><input type="text" class="form-control form-control-sm"
            value="${escapeHtml(it.remarks || '')}" onchange="aqOnItemFieldChange(${it._idx}, 'remarks', this.value)"></td>
          <td><button type="button" class="btn btn-xs btn-ghost" onclick="aqRemoveItem(${it._idx})" title="删除行">×</button></td>
        </tr>`);
        alt = !alt;
      });
      rows.push(`<tr class="aq-add-row-tr"><td colspan="9" class="left">
        <button type="button" class="btn btn-xs btn-secondary" onclick="aqAddCustomItem('${escapeHtml(sub.subsection_code)}')">+ 本类添加自定义行</button>
      </td></tr>`);
    });
  });
  return rows.join('');
}

function aqRenderPreviewTable(q) {
  const groups = aqGroupItemsForTable(q.items || []);
  let alt = false;
  const rows = [];
  groups.forEach((sec) => {
    rows.push(`<tr class="qt-section-header">
      <td colspan="6" class="left">${escapeHtml(sec.section_code)}.${escapeHtml(sec.section_name)}</td>
      <td class="right formula-field">${aqFmtNum(sec.sectionSubtotal)}</td>
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
  const t = aqCalcTotalsForQuote(q);
  const pct = Math.round(t.serviceRate * 100);
  rows.push(
    `<tr class="qt-footer-row"><td colspan="6" class="left-text">1. 不含税小计 Subtotal excluding Tax</td>
      <td class="val-cell right">${aqFmtNum(t.subtotalExTax)}</td><td></td></tr>`,
    `<tr class="qt-footer-row"><td colspan="6" class="left-text">2. 公司服务费 Service Charge(${pct}%)</td>
      <td class="val-cell right">${aqFmtNum(t.serviceCharge)}</td><td></td></tr>`,
    `<tr class="qt-footer-row"><td colspan="6" class="left-text">3. 国家及地方政府税收(6%) Government Tax</td>
      <td class="val-cell right">${aqFmtNum(t.taxAmount)}</td><td></td></tr>`,
    `<tr class="qt-footer-row qt-total-row"><td colspan="6" class="left-text">4. 含税总计 TOTAL</td>
      <td class="val-cell right">${aqFmtNum(t.totalAmount)}</td><td></td></tr>`
  );
  return rows.join('');
}

function aqPrepareEditingItems() {
  const q = activityQuotesState.editing;
  if (!q || !Array.isArray(q.items)) return;
  aqEnsureMultiSessions(q);
  q.items.forEach((it, i) => {
    it._idx = i;
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
    if (sub) sub.textContent = aqFmtNum(aqItemSubtotal(it));
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
    event_type: '无执行晚宴',
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
  try {
    await aqLoadActivitiesForPicker();
    const res = await api('POST', '/quotations', {
      type: 'EVENT',
      quote_mode: 'multi',
      year_frame_id: currentYearFrameId,
      linked_sessions: [],
    });
    const q = res.data;
    if (!q) throw new Error('创建失败');
    q.event_date = aqNormalizeEventDate(q.event_date);
    activityQuotesState.editing = q;
    activityQuotesState.multiDraftPristine = true;
    aqEnsureMultiSessions(activityQuotesState.editing);
    aqPrepareEditingItems();
    activityQuotesState.view = 'edit';
    await renderActivityQuotes();
    aqFillMultiProjectDatalist();
    if (!activityQuotesState.projectCodeList.length) {
      showToast('已进入编辑页；当前财年暂无项目编号，请先在场次记录中填写', 'warning');
    } else {
      showToast('请在下方表格第一列选择项目编号，系统将自动带出后续字段', 'success');
    }
  } catch (e) {
    showToast(e.message || '创建失败', 'error');
  }
}

function aqOnActivityPick(idStr) {
  const id = parseInt(idStr, 10);
  const f = activityQuotesState.createForm;
  if (!Number.isFinite(id)) {
    f.activity_id = null;
    f.project_code = '';
    return;
  }
  const act = activityQuotesState.createActivities.find((a) => Number(a.id) === id);
  if (!act) return;
  f.activity_id = id;
  f.project_code = String(act.project_code || '').trim();
  f.city = act.city || '';
  f.event_date = aqFormatActivityDate(act);
  f.event_type = aqMapActivityEventType(act.activity_type);
  const autoName = [act.city, act.activity_type].filter(Boolean).join('');
  f.project_name = autoName ? `${autoName}报价` : f.project_code;
  const hint = document.getElementById('aqActivityLinkHint');
  if (hint) {
    const dateHint = f.event_date ? ` · 活动日期 ${escapeHtml(f.event_date)}` : '';
    hint.innerHTML = `已关联：<strong>${escapeHtml(f.project_code)}</strong>${dateHint}`;
    hint.style.display = 'block';
  }
  const cityEl = document.getElementById('aqFCity');
  if (cityEl) cityEl.value = f.city || '';
}

function aqRenderCreateModal() {
  const body = document.getElementById('modalActivityQuoteBody');
  if (!body) return;
  const f = activityQuotesState.createForm;
  const typeOpts = AQ_EVENT_TYPES.map(
    (t) => `<option value="${escapeHtml(t)}"${f.event_type === t ? ' selected' : ''}>${escapeHtml(t)}</option>`
  ).join('');
  const actOpts = activityQuotesState.createActivities
    .map((a) => {
      const sel = Number(f.activity_id) === Number(a.id) ? ' selected' : '';
      return `<option value="${a.id}"${sel}>${escapeHtml(aqActivityOptionLabel(a))}</option>`;
    })
    .join('');
  const linkHint = f.activity_id
    ? `已关联：<strong>${escapeHtml(f.project_code || '')}</strong>${f.event_date ? ` · 活动日期 ${escapeHtml(f.event_date)}` : ''}`
    : '选择场次后将自动同步活动日期与城市';
  body.innerHTML = `
    <p class="modal-activity-lead">须关联场次<strong>项目编号</strong>；创建后含全部预置明细，可在列表中点「编辑」调整。服务费默认 10%。</p>
    <div class="form-grid">
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">关联项目编号 *</label>
        <select class="form-control" id="aqFActivity" onchange="aqOnActivityPick(this.value)">
          <option value="">请选择场次…</option>
          ${actOpts}
        </select>
        <p id="aqActivityLinkHint" class="form-hint" style="margin-top:6px${f.activity_id ? '' : ';display:none'}">${linkHint}</p>
      </div>
      <div class="form-group"><label class="form-label">客户/品牌</label>
        <input class="form-control" id="aqFBrand" value="${escapeHtml(f.client_brand || '')}"></div>
      <div class="form-group"><label class="form-label">客户方负责人</label>
        <input class="form-control" id="aqFContact" value="${escapeHtml(f.client_contact || '')}" placeholder="选填"></div>
      <div class="form-group"><label class="form-label">报价单项目名称 *</label>
        <input class="form-control" id="aqFProject" value="${escapeHtml(f.project_name || '')}" placeholder="如 福州晚宴报价"></div>
      <div class="form-group"><label class="form-label">城市</label>
        <input class="form-control" id="aqFCity" value="${escapeHtml(f.city || '')}"></div>
      <div class="form-group"><label class="form-label">报价类型</label>
        <select class="form-control" id="aqFType">${typeOpts}</select></div>
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
  f.event_type = document.getElementById('aqFType')?.value || AQ_EVENT_TYPES[0];
  const actId = parseInt(document.getElementById('aqFActivity')?.value, 10);
  f.activity_id = Number.isFinite(actId) ? actId : null;
  if (f.activity_id) {
    const act = activityQuotesState.createActivities.find((a) => Number(a.id) === f.activity_id);
    if (act) {
      f.project_code = String(act.project_code || '').trim();
      f.event_date = aqFormatActivityDate(act);
    }
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
        <div class="info-row"><span class="info-label">${projectL}</span><span class="info-value">${escapeHtml(q.project_name || '')}</span></div>
      </div>
      <img class="qt-company-logo" src="/logo.png?v=2" alt="公司 Logo" width="140" height="auto">
    </div>`;
}

async function aqExportPdf(id) {
  const qid = id || activityQuotesState.editing?.id;
  if (!qid) {
    showToast('请先保存报价后再导出', 'warning');
    return;
  }
  try {
    const res = await fetch(`/api/quotations/${qid}/pdf`, { credentials: 'same-origin' });
    if (!res.ok) {
      let msg = `导出失败（${res.status}）`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) {
        if (res.status === 404) msg = 'PDF 接口未找到，请重启 Node 服务后重试';
      }
      showToast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    if (!blob.size) {
      showToast('PDF 为空，请检查报价明细', 'error');
      return;
    }
    const cd = res.headers.get('Content-Disposition') || '';
    let filename = `quotation-${qid}.pdf`;
    const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const plain = cd.match(/filename="?([^";]+)"?/i);
    if (star) filename = decodeURIComponent(star[1]);
    else if (plain) filename = plain[1];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('PDF 已下载', 'success');
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
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
    activityQuotesState.multiDraftPristine = false;
    if (aqIsMultiQuote(activityQuotesState.editing)) {
      await aqLoadActivitiesForPicker();
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
    aqPrepareEditingItems();
    activityQuotesState.view = 'preview';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
  }
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
  const tbody = rows.length
    ? rows
        .map((r) => {
          const date = r.event_date ? String(r.event_date).slice(0, 10) : '—';
          return `<tr>
            <td><code>${escapeHtml(r.quotation_no || '')}</code></td>
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
        <input type="search" class="form-control form-control-sm" placeholder="搜索编号/项目/客户/城市"
          value="${escapeHtml(activityQuotesState.filterQ)}"
          oninput="aqOnFilterQ(this.value)" style="max-width:280px">
      </div>
      ${canWrite ? `<div class="aq-toolbar-actions"><button type="button" class="btn btn-primary btn-sm" onclick="aqOpenCreate()">+ 新建单场报价</button><button type="button" class="btn btn-secondary btn-sm" onclick="aqOpenMultiCreate()">+ 新建多场报价</button></div>` : ''}
    </div>
    <div class="table-wrapper">
      <table class="data-table">
        <thead><tr>
          <th>报价编号</th><th>项目编号</th><th>报价单名称</th><th>城市</th><th>客户</th><th>活动日期</th>
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
          <h3 class="aq-multi-title">Summary 多场报价（一行一场）</h3>
          <button type="button" class="btn btn-xs btn-secondary" onclick="aqAddMultiSession()">+ 添加场次</button>
        </div>
        <div class="table-wrapper aq-multi-grid-scroll">
          <table class="data-table aq-multi-grid-table">
            <thead>${aqMultiGridHeadHtml()}</thead>
            <tbody id="aqMultiGridBody">${aqRenderMultiGridRows(q)}</tbody>
          </table>
        </div>
        <p class="form-hint aq-multi-hint">项目编号请从下拉建议中选择（与报销登记相同）；选中后自动带出日期/城市/客户/类型。</p>
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
        <strong>${escapeHtml(q.quotation_no || '')}</strong>
        ${linkedLabel}
        <span>${escapeHtml(q.project_name || '')}</span>
        ${isMulti ? '' : `<span class="form-hint">${escapeHtml(q.city || '')} · ${escapeHtml(q.customer_name || '')}</span>`}
      </div>
      <div class="aq-edit-head-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="aqOpenPreview(${q.id})">预览版式</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="aqExportPdf(${q.id})">导出PDF</button>
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
  const isMulti = aqIsMultiQuote(q);
  const tableBlock = isMulti
    ? `<table class="qt-detail-table aq-multi-preview-table"><thead>${aqMultiGridHeadHtml()}</thead><tbody>${aqRenderMultiPreviewTable(q)}</tbody></table>`
    : `<table class="qt-detail-table">
        <thead><tr>
          <th>内容<br>Item</th><th></th><th>说明<br>Summary</th>
          <th>数量<br>Quantity</th><th>单位<br>Unit</th><th>单价<br>Unit Price</th>
          <th>单项小计<br>Subtotal</th><th>备注<br>Remarks</th>
        </tr></thead>
        <tbody>${aqRenderPreviewTable(q)}</tbody>
      </table>`;
  return `
    <div class="aq-edit-head">
      <button type="button" class="btn btn-secondary btn-sm" onclick="activityQuotesState.view='edit';renderActivityQuotes()">← 返回编辑</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqBackToList()">列表</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqExportPdf(${q.id})">导出PDF</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqPrintPreview()">打印</button>
    </div>
    <div class="qt-sheet-wrap qt-print-area">
      ${aqRenderQtHeaderHtml(q, true)}
      ${tableBlock}
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
    } else if (activityQuotesState.view === 'edit') {
      if (activityQuotesState.editing && aqIsMultiQuote(activityQuotesState.editing)) {
        await aqLoadActivitiesForPicker();
      }
      container.innerHTML = `<div class="aq-page aq-page-edit">${aqRenderEditHtml()}</div>`;
      aqRefreshEditView();
      if (activityQuotesState.editing && aqIsMultiQuote(activityQuotesState.editing)) {
        aqFillMultiProjectDatalist();
      }
    } else if (activityQuotesState.view === 'preview') {
      container.innerHTML = `<div class="aq-page aq-page-preview">${aqRenderPreviewHtml()}</div>`;
    }
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message || '')}</div></div>`;
  }
  renderLucideIcons();
}
