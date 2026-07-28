function aqTemplateItemKey(subsectionCode, description) {
  return `${String(subsectionCode || '').trim()}|${String(description || '').trim()}`;
}

/** B-1 / C-4 / C-5 旧说明 → 与后端 eventTemplateRows 一致 */
const AQ_TEMPLATE_DESC_LEGACY = {
  'B-1': ['公司级设计'],
  'C-4': ['设计费'],
  'C-5': ['鲜花'],
};
const AQ_TEMPLATE_DESC_SYNC_CODES = new Set(['B-1', 'C-4', 'C-5']);

function aqApplyTemplateDescriptionSync(q) {
  if (!q?.items?.length || !activityQuotesState.templateSections?.length) return;
  const bySub = new Map();
  activityQuotesState.templateSections.forEach((t) => {
    if (!bySub.has(t.subsection_code)) bySub.set(t.subsection_code, t);
  });
  q.items.forEach((it) => {
    if (Number(it.is_custom) === 1) return;
    const code = String(it.subsection_code || '').trim();
    if (!AQ_TEMPLATE_DESC_SYNC_CODES.has(code)) return;
    const desc = String(it.description || '').trim();
    const legacy = AQ_TEMPLATE_DESC_LEGACY[code] || [];
    if (!legacy.includes(desc)) return;
    const tpl = bySub.get(code);
    if (tpl?.description) it.description = tpl.description;
  });
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
  aqApplyTemplateDescriptionSync(q);
  const map = aqBuildTemplateDefaultsMap();
  const bySub = new Map();
  activityQuotesState.templateSections.forEach((t) => {
    if (!bySub.has(t.subsection_code)) bySub.set(t.subsection_code, t);
  });
  q.items.forEach((it) => {
    if (Number(it.is_custom) === 1) return;
    const price = parseFloat(it.unit_price);
    if (Number.isFinite(price) && price > 0) return;
    const tpl =
      map.get(aqTemplateItemKey(it.subsection_code, it.description)) ||
      bySub.get(String(it.subsection_code || '').trim());
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
  if (el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = v;
    else el.textContent = v || '—';
  }
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
