function invOnWineStatsSearchInput(value) {
  const v = String(value == null ? '' : value);
  wineUsageStatsState.projectCode = v.trim();
  const input = document.getElementById('invWineStatsSearch');
  if (input && input.value !== v) input.value = v;
  const wrap = document.getElementById('invWineStatsSearchWrap');
  if (wrap) {
    const existed = wrap.querySelector('.inv-ob-search-clear');
    if (v.trim() && !existed) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inv-ob-search-clear';
      btn.setAttribute('aria-label', '清除搜索');
      btn.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
      btn.addEventListener('click', () => invOnWineStatsSearchInput(''));
      wrap.appendChild(btn);
      renderLucideIcons();
    } else if (!v.trim() && existed) {
      existed.remove();
    }
  }
  clearTimeout(wineStatsSearchTimer);
  wineStatsSearchTimer = setTimeout(() => invWineStatsApplyFilters(), 400);
}

function invWineStatsResetFilters() {
  wineUsageStatsState.region = '';
  wineUsageStatsState.belonging = '';
  wineUsageStatsState.projectCode = '';
  wineUsageStatsState.dateFrom = '';
  wineUsageStatsState.dateTo = '';
  wineUsageStatsState.month = '';
  renderWineUsageStats();
}

async function invWineStatsDownloadExcel() {
  try {
    const qs = invWineUsageStatsQueryString(true);
    const res = await fetch(`/api/inventory/wine-usage-stats/excel?${qs}`, { credentials: 'include' });
    if (!res.ok) {
      let msg = `导出失败 (${res.status})`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = invFilenameFromDisposition(
      res.headers.get('content-disposition'),
      `用酒统计_${todayDateInputValue()}.xlsx`,
    );
    a.click();
    URL.revokeObjectURL(url);
    showToast('Excel 已下载', 'success');
  } catch (e) {
    showToast(e.message || 'Excel 导出失败', 'error');
  }
}

function invWineStatsPrint() {
  const area = document.getElementById('invWineStatsPrintArea');
  if (!area) {
    showToast('请先加载统计表格', 'warning');
    return;
  }
  const win = window.open('', '_blank');
  if (!win) {
    showToast('无法打开打印窗口，请允许弹窗', 'warning');
    return;
  }
  const payload = wineUsageStatsState.lastPayload;
  const summary = payload?.summary || {};
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>用酒统计</title>
    <style>
      body{font-family:system-ui,sans-serif;font-size:12px;padding:16px;color:#111}
      h1{font-size:18px;margin:0 0 8px}
      .meta{color:#444;margin-bottom:12px}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #888;padding:4px 6px;text-align:center}
      th{background:#f0f0f0;font-size:11px}
      td.proj{text-align:left;max-width:220px;word-break:break-all}
      .wine-h{display:block;font-weight:700}
      .wine-t{font-size:10px;color:#555}
    </style></head><body>
    <h1>用酒统计</h1>
    <p class="meta">场次 ${summary.session_count ?? 0} · 酒品 ${summary.wine_kind_count ?? 0} · 合计 ${summary.total_bottles ?? 0} 瓶</p>
    ${area.outerHTML}
    </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

async function renderWineUsageStats() {
  const container = document.getElementById('pageContainer');
  let regionOpts = '';
  let belongingOpts = '<option value="">全部归属</option>';
  try {
    const regions = await api('GET', '/lookups?category=activity_region');
    regionOpts = (regions || [])
      .map(
        (r) =>
          `<option value="${escapeHtml(String(r.value))}"${wineUsageStatsState.region === String(r.value) ? ' selected' : ''}>${escapeHtml(String(r.label || r.value))}</option>`,
      )
      .join('');
  } catch (e) {
    console.warn('用酒统计·区域筛选项加载失败', e);
  }
  try {
    const rows = await api('GET', '/lookups?category=activity_belonging');
    belongingOpts +=
      (rows || [])
        .map(
          (r) =>
            `<option value="${escapeHtml(String(r.value))}"${wineUsageStatsState.belonging === String(r.value) ? ' selected' : ''}>${escapeHtml(String(r.label || r.value))}</option>`,
        )
        .join('') || '';
  } catch (_) { /* ignore */ }

  const searchVal = escapeHtml(wineUsageStatsState.projectCode || '');
  const searchClearBtn = wineUsageStatsState.projectCode
    ? `<button type="button" class="inv-ob-search-clear" aria-label="清除搜索" onclick="invOnWineStatsSearchInput('')"><i data-lucide="x" aria-hidden="true"></i></button>`
    : '';

  container.innerHTML = `
    <div class="inv-wine-stats-page">
      <p class="form-hint inv-wine-stats-lead">按<strong>场次</strong>汇总已标记「参与用酒统计」的出库酒品数量。酒品列按<strong>固定顺序</strong>全部展示（含本期零用量）；数字为各场次出库瓶数，无出库显示「—」。表头为仓库<strong>酒类统计名</strong>全文。</p>
      <div class="toolbar inv-wine-stats-toolbar">
        <select class="filter-select" id="invWineStatsRegion" onchange="invWineStatsApplyFilters()">
          <option value="">全部区域</option>${regionOpts}
        </select>
        <select class="filter-select" id="invWineStatsBelonging" onchange="invWineStatsApplyFilters()">${belongingOpts}</select>
        <div class="inv-ob-search inv-wine-stats-search" id="invWineStatsSearchWrap">
          <input type="search" id="invWineStatsSearch" class="form-control form-control-sm inv-ob-search-input"
            placeholder="关键词：项目编号（空格分隔多词）"
            value="${searchVal}"
            oninput="invOnWineStatsSearchInput(this.value)"
            aria-label="按项目编号关键词筛选">
          ${searchClearBtn}
        </div>
        <input type="month" class="filter-input" id="invWineStatsMonth" value="${escapeHtml(wineUsageStatsState.month)}" onchange="invWineStatsApplyFilters()" title="按活动月份">
        <input type="date" class="filter-input" id="invWineStatsDateFrom" value="${escapeHtml(wineUsageStatsState.dateFrom)}" onchange="invWineStatsApplyFilters()" title="活动日起">
        <input type="date" class="filter-input" id="invWineStatsDateTo" value="${escapeHtml(wineUsageStatsState.dateTo)}" onchange="invWineStatsApplyFilters()" title="活动日止">
        <button type="button" class="btn btn-secondary btn-sm" onclick="invWineStatsResetFilters()">重置</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="invWineStatsApplyFilters()">查询</button>
        <span style="flex:1"></span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="invWineStatsDownloadExcel()">导出 Excel</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="invWineStatsPrint()">打印</button>
      </div>
      <div id="invWineStatsTableHost"></div>
    </div>`;

  await invLoadWineUsageStats();
}

function invSetItemsListFilter(mode) {
  if (mode !== 'all' && mode !== 'common' && mode !== 'uncommon' && mode !== 'wine') return;
  inventoryPageState.itemsListFilter = mode;
  try {
    localStorage.setItem('remy_invItemsListFilter', mode);
  } catch (_) { /* ignore */ }
  renderInventory();
}

function invRenderItemsListFilterBar(current) {
  const cur = current || 'all';
  const mk = (id, label) =>
    `<button type="button" class="btn btn-xs inv-items-filter-btn ${cur === id ? 'btn-primary' : 'btn-secondary'}" onclick="invSetItemsListFilter('${id}')" aria-pressed="${cur === id ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
  return `<div class="inv-items-filter-bar" role="group" aria-label="物料范围">
    ${mk('all', '全部')}
    ${mk('common', '常用')}
    ${mk('uncommon', '非常用')}
    ${mk('wine', '酒')}
  </div>`;
}

const INV_ITEMS_VIEW_MODES = [
  { id: 'cards', label: '卡片' },
  { id: 'list', label: '列表' },
  { id: 'thumbnails', label: '缩略图' },
];

/** 列表图标；卡片与缩略图共用四宫格图标 */
const INV_VIEW_LIST_ICON =
  '<svg class="inv-view-icon-svg" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="6" r="1.75"/><circle cx="5" cy="12" r="1.75"/><circle cx="5" cy="18" r="1.75"/><rect x="9" y="5" width="12" height="2" rx="0.5"/><rect x="9" y="11" width="12" height="2" rx="0.5"/><rect x="9" y="17" width="12" height="2" rx="0.5"/></svg>';
const INV_VIEW_GRID_ICON =
  '<svg class="inv-view-icon-svg" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';

function invSetItemsViewMode(mode) {
  if (!INV_ITEMS_VIEW_MODES.some((m) => m.id === mode)) return;
  inventoryPageState.itemsViewMode = mode;
  try {
    localStorage.setItem('remy_inventoryItemsViewMode', mode);
  } catch (_) { /* ignore */ }
  renderInventory();
}

/** 四宫格：在「卡片 ↔ 缩略图」间切换；当前为列表时先进入卡片 */
function invCycleGridItemsView() {
  const m = inventoryPageState.itemsViewMode || 'cards';
  if (m === 'list') {
    invSetItemsViewMode('cards');
    return;
  }
  if (m === 'cards') {
    invSetItemsViewMode('thumbnails');
    return;
  }
  if (m === 'thumbnails') {
    invSetItemsViewMode('cards');
    return;
  }
  invSetItemsViewMode('cards');
}

function invRenderWarehouseCardsHtml(warehouses, selectedId) {
  if (!warehouses.length) {
    return '<div class="empty-state inv-wh-cards-empty">暂无仓库。点击右上「+ 新建仓库」开始添加（仅管理员）。</div>';
  }
  const orderedWarehouses = invReorderWarehouseCards(warehouses);
  const sid = selectedId != null ? Number(selectedId) : null;
  return `
    <div class="inv-warehouse-cards" role="list" aria-label="选择仓库">
      ${orderedWarehouses
        .map((w) => {
          const active = sid != null && Number(w.id) === sid;
          const label = w.label ? `<div class="inv-wh-card-label">${escapeHtml(w.label)}</div>` : '';
          const city = w.city ? `<div class="inv-wh-card-city" title="所在城市">${escapeHtml(w.city)}</div>` : '';
          return `
        <div class="inv-wh-card-wrap">
          <button type="button" class="inv-wh-card ${active ? 'active' : ''}" data-wh-id="${w.id}" onclick="invSelectWarehouse(${w.id})" role="listitem">
            <div class="inv-wh-card-brand">${escapeHtml(invWarehouseBrandDisplay(w))}</div>
            <div class="inv-wh-card-region">${escapeHtml(w.region)}</div>
            ${city}
            ${label}
          </button>
          <button type="button" class="inv-wh-card-edit inv-admin-only" title="编辑仓库" aria-label="编辑仓库" onclick="event.stopPropagation();invOpenWarehouseModal(${w.id})"><i data-lucide="pencil" aria-hidden="true"></i></button>
        </div>`;
        })
        .join('')}
    </div>`;
}

/** 库存管理页：四仓 + 酒品目录 + 物品目录 + 空瓶回收（与仓库同排） */
