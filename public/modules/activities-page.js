/* 场次记录页面模块：从 app.js/dashboard-page.js 机械迁移，保持列表、导入、表单、详情和旧成本弹窗逻辑。 */

/* =============================================
   页面：场次记录（原活动记录）
   ============================================= */
function triggerActivityImport() {
  const inp = document.getElementById('actImportFile');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

async function onActivityImportFileSelected(ev) {
  const file = ev.target && ev.target.files && ev.target.files[0];
  if (!file) return;
  const name = String(file.name || '').toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    showToast('请选择 Excel 文件（.xlsx 或 .xls）', 'warning');
    return;
  }
  const fd = new FormData();
  fd.append('file', file);
  if (currentYearFrameId) fd.append('yearFrameId', String(currentYearFrameId));
  try {
    showToast('正在导入场次，请稍候…', 'info');
    const res = await fetch('/api/activities/import', {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || res.statusText || '导入失败');
    const data = payload.data || payload;
    const failed = data.failed || [];
    const skipped = data.skipped || [];
    const created = data.created || [];
    const msg =
      payload.message ||
      `导入完成：成功 ${data.createdCount || 0} 条，跳过 ${data.skippedCount || 0} 条，失败 ${data.failedCount || 0} 条`;
    const hasIssue = failed.length || skipped.length;
    showToast(msg, hasIssue ? 'warning' : 'success');
    const detailLines = [];
    created.forEach((c) => detailLines.push(`第 ${c.row} 行：已导入 ${c.project_code || ''}`));
    skipped.forEach((s) =>
      detailLines.push(`第 ${s.row} 行：已跳过 — ${s.reason || ''}${s.project_code ? `（${s.project_code}）` : ''}`)
    );
    failed.forEach((f) => detailLines.push(`第 ${f.row} 行：失败 — ${f.error || ''}`));
    if (detailLines.length) {
      console.info('场次导入明细\n' + detailLines.join('\n'));
    }
    if (hasIssue && detailLines.length) {
      alert(`导入明细：\n\n${detailLines.join('\n')}\n\n若「已跳过」为项目编号已存在，说明该场次此前已导入；若列表少一条，请检查「月份/年框」筛选是否过滤掉了另一条。`);
    }
    if (currentPage === 'activities') await loadActivities();
    else if (currentPage === 'calendar' && typeof window._calYear === 'number') drawCalendar(window._calYear, window._calMonth);
  } catch (err) {
    showToast('导入失败: ' + (err.message || err), 'error');
  } finally {
    ev.target.value = '';
  }
}

async function renderActivities() {
  const container = document.getElementById('pageContainer');

  // 初始化筛选状态
  activitiesState.page = 1;

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <input type="text" class="search-input" id="actSearch" placeholder="搜索城市/客户/项目编号..." oninput="debounceSearch()" value="${activitiesState.search}">
        <select class="filter-select" id="actYear" onchange="filterActivities()">
          <option value="">全部年份</option>
          <option value="2025">2025年</option>
          <option value="2026">2026年</option>
        </select>
        <select class="filter-select" id="actMonth" onchange="filterActivities()">
          <option value="">全部月份</option>
          <option value="1">1月</option>
          <option value="2">2月</option>
          <option value="3">3月</option>
          <option value="4">4月</option>
          <option value="5">5月</option>
          <option value="6">6月</option>
          <option value="7">7月</option>
          <option value="8">8月</option>
          <option value="9">9月</option>
          <option value="10">10月</option>
          <option value="11">11月</option>
          <option value="12">12月</option>
        </select>
        <select class="filter-select" id="actType" onchange="filterActivities()">
          <option value="">全部类型</option>
        </select>
        <select class="filter-select" id="actFilterPeriod" onchange="filterActivities()">
          <option value="">全部时段</option>
        </select>
        <select class="filter-select" id="actFilterRegion" onchange="filterActivities()">
          <option value="">全部区域</option>
        </select>
        <select class="filter-select" id="actBrand" onchange="filterActivities()">
          <option value="">全部品牌</option>
        </select>
        <select class="filter-select" id="actFilterBelonging" onchange="filterActivities()">
          <option value="">全部归属</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm" onclick="resetActivityFilters()">重置筛选</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleSortOrder()">
          日期 <span id="sortIcon">${activitiesState.sortOrder === 'DESC' ? '↓' : '↑'}</span>
        </button>
      </div>
      <div class="toolbar-right" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <a class="btn btn-secondary btn-sm" href="/templates/activity-import-template.xlsx" download="场次导入模板.xlsx">下载导入模板</a>
        <input type="file" id="actImportFile" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style="display:none" onchange="onActivityImportFileSelected(event)">
        <button type="button" class="btn btn-secondary btn-sm" onclick="triggerActivityImport()">排期导入</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="showActivityModal()">+ 新建活动</button>
      </div>
    </div>

    <div id="actTable"></div>
    <div id="actPagination"></div>
  `;

  try {
    const types = await api('GET', '/lookups?category=activity_type');
    const typeSel = document.getElementById('actType');
    if (typeSel) {
      const keep = activitiesState.type;
      typeSel.innerHTML =
        '<option value="">全部类型</option>' +
        types
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...typeSel.options].some((o) => o.value === keep)) typeSel.value = keep;
    }
  } catch (e) {
    console.warn('活动类型筛选项加载失败', e);
  }
  try {
    const periods = await api('GET', '/lookups?category=activity_period');
    const periodSel = document.getElementById('actFilterPeriod');
    if (periodSel) {
      const keep = activitiesState.period;
      periodSel.innerHTML =
        '<option value="">全部时段</option>' +
        periods
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...periodSel.options].some((o) => o.value === keep)) periodSel.value = keep;
    }
  } catch (e) {
    console.warn('活动时段筛选项加载失败', e);
  }
  try {
    const regions = await api('GET', '/lookups?category=activity_region');
    const regionSel = document.getElementById('actFilterRegion');
    if (regionSel) {
      const keep = activitiesState.region;
      regionSel.innerHTML =
        '<option value="">全部区域</option>' +
        regions
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...regionSel.options].some((o) => o.value === keep)) regionSel.value = keep;
    }
  } catch (e) {
    console.warn('活动区域筛选项加载失败', e);
  }
  try {
    const belongs = await api('GET', '/lookups?category=activity_belonging');
    actBelongingLabelByValue = Object.fromEntries(
      (belongs || []).map((r) => [String(r.value), String(r.label || r.value)])
    );
    const belongSel = document.getElementById('actFilterBelonging');
    if (belongSel) {
      const keep = activitiesState.belonging;
      belongSel.innerHTML =
        '<option value="">全部归属</option>' +
        belongs
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...belongSel.options].some((o) => o.value === keep)) belongSel.value = keep;
    }
  } catch (e) {
    actBelongingLabelByValue = {};
    console.warn('活动归属筛选项加载失败', e);
  }
  renderBrandOptions();
  const bsel = document.getElementById('actBrand');
  const bk = activitiesState.brand;
  if (bsel && bk && [...bsel.options].some((o) => o.value === bk)) bsel.value = bk;

  await loadActivities();
}

let searchTimer = null;
function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    activitiesState.search = document.getElementById('actSearch')?.value || '';
    activitiesState.page = 1;
    loadActivities();
  }, 400);
}

function filterActivities() {
  activitiesState.type = document.getElementById('actType')?.value || '';
  activitiesState.period = document.getElementById('actFilterPeriod')?.value || '';
  activitiesState.region = document.getElementById('actFilterRegion')?.value || '';
  activitiesState.belonging = document.getElementById('actFilterBelonging')?.value || '';
  activitiesState.brand = document.getElementById('actBrand')?.value || '';
  activitiesState.year = document.getElementById('actYear')?.value || '';
  activitiesState.month = document.getElementById('actMonth')?.value || '';
  activitiesState.page = 1;
  loadActivities();
}

function resetActivityFilters() {
  activitiesState.type = '';
  activitiesState.period = '';
  activitiesState.region = '';
  activitiesState.belonging = '';
  activitiesState.brand = '';
  activitiesState.year = '';
  activitiesState.month = '';
  activitiesState.search = '';
  activitiesState.page = 1;
  const s = document.getElementById('actSearch');
  if (s) s.value = '';
  ['actYear', 'actMonth', 'actType', 'actFilterPeriod', 'actFilterRegion', 'actBrand', 'actFilterBelonging'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  loadActivities();
}

function toggleSortOrder() {
  activitiesState.sortOrder = activitiesState.sortOrder === 'DESC' ? 'ASC' : 'DESC';
  const icon = document.getElementById('sortIcon');
  if (icon) icon.textContent = activitiesState.sortOrder === 'DESC' ? '↓' : '↑';
  loadActivities();
}
