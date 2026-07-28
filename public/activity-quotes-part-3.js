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
  if (codes.length === 1) {
    return `<code class="aq-pc-single">${escapeHtml(codes[0])}</code>`;
  }
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

function aqMultiFeeInputValue(n) {
  const v = aqCoerceMoney(n);
  return v === 0 ? '' : String(v);
}

function aqMultiFeeInpFocus(el) {
  if (!el) return;
  if (String(el.value).trim() === '' || parseFloat(el.value) === 0) {
    el.value = '';
  }
  el.select?.();
}

function aqMultiFeeInpBlur(el) {
  if (!el) return;
  if (String(el.value).trim() === '') el.value = '';
}

function aqMultiFeeInputAttrs(extra) {
  let rest = extra || '';
  let cls = 'form-control form-control-sm aq-multi-fee-inp';
  const m = rest.match(/\bclass="([^"]+)"/);
  if (m) {
    cls += ` ${m[1]}`;
    rest = rest.replace(/\bclass="[^"]+"\s*/, '');
  }
  return `class="${cls}" data-no-num-hint="1" data-num-kind="money" min="0" step="0.01" placeholder="0" onfocus="aqMultiFeeInpFocus(this)" onblur="aqMultiFeeInpBlur(this)"${rest ? ` ${rest.trim()}` : ''}`;
}

/** 渲染后把 state 中的费用写回输入框（避免 num-hint 脚本把 0 清空后显示异常） */
function aqSyncMultiFeeInputsFromState() {
  const q = activityQuotesState.editing;
  if (!q || !aqIsMultiQuote(q)) return;
  (q.linked_sessions || []).forEach((s, si) => {
    AQ_MULTI_FEE_COLS.forEach((col) => {
      const inp = document.querySelector(
        `tr[data-session-idx="${si}"] input.aq-multi-fee-inp[data-fee-key="${col.key}"]`
      );
      if (inp) inp.value = aqMultiFeeInputValue(aqParseFee(s, col.key));
    });
  });
}

function aqParseLinkedSessions(raw) {
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
  if (!Number.isFinite(v) || v === 0) return '';
  return String(v);
}

function aqUnitPriceInputAttrs(extra) {
  let cls = 'form-control form-control-sm aq-num-inp aq-price-inp';
  let rest = extra || '';
  const m = rest.match(/\bclass="([^"]+)"/);
  if (m) {
    cls += ` ${m[1]}`;
    rest = rest.replace(/\bclass="[^"]+"\s*/, '');
  }
  return `class="${cls}" placeholder="0.00" min="0" step="0.01" onfocus="aqNumInpFocus(this)" onblur="aqNumInpBlur(this)"${rest ? ` ${rest.trim()}` : ''}`;
}
