/* 虚拟场次列表页模块：从 app.js 机械迁移，保持原有展示逻辑。 */

/* -------- 虚拟场次（is_virtual=1，默认东南区、分品牌预存统计）-------- */
const VIRTUAL_BRAND_STAT_ORDER = ['PHD', 'X.O', 'CLUB', 'REMY', 'RC'];

function aggregateVirtualQuotedByBrand(rows) {
  const byBrand = {};
  let total = 0;
  (rows || []).forEach((r) => {
    const q = Number(r.quoted_price) || 0;
    total += q;
    const b = String(r.brand || '').trim() || '未填';
    byBrand[b] = (byBrand[b] || 0) + q;
  });
  return { byBrand, total };
}

function formatVirtualBrandStatCards(agg) {
  const { byBrand, total } = agg;
  const seen = new Set();
  const parts = [];
  VIRTUAL_BRAND_STAT_ORDER.forEach((b) => {
    if (byBrand[b] == null) return;
    seen.add(b);
    const v = byBrand[b];
    parts.push(
      `<div class="virtual-prepaid-card">
        <div class="vpc-label">${escapeHtml(b)}</div>
        <div class="vpc-value">¥${roundMoney2(v).toFixed(2)}</div>
      </div>`
    );
  });
  Object.keys(byBrand)
    .filter((b) => !seen.has(b))
    .sort()
    .forEach((b) => {
      const v = byBrand[b];
      parts.push(
        `<div class="virtual-prepaid-card">
          <div class="vpc-label">${escapeHtml(b)}</div>
          <div class="vpc-value">¥${roundMoney2(v).toFixed(2)}</div>
        </div>`
      );
    });
  parts.push(
    `<div class="virtual-prepaid-card virtual-prepaid-total">
      <div class="vpc-label">预存报价合计</div>
      <div class="vpc-value">¥${roundMoney2(total).toFixed(2)}</div>
    </div>`
  );
  return `<div class="virtual-prepaid-strip">${parts.join('')}</div>`;
}

let virtualSearchTimer = null;
function debounceVirtualSearch() {
  clearTimeout(virtualSearchTimer);
  virtualSearchTimer = setTimeout(() => {
    virtualActivitiesState.search = document.getElementById('virtActSearch')?.value || '';
    virtualActivitiesState.page = 1;
    loadVirtualActivities();
  }, 400);
}

function filterVirtualActivities() {
  virtualActivitiesState.brand = document.getElementById('virtActBrand')?.value || '';
  virtualActivitiesState.region = document.getElementById('virtActRegion')?.value ?? '';
  virtualActivitiesState.page = 1;
  loadVirtualActivities();
}

function resetVirtualFilters() {
  virtualActivitiesState.brand = '';
  virtualActivitiesState.region = '东南区';
  virtualActivitiesState.search = '';
  virtualActivitiesState.page = 1;
  const s = document.getElementById('virtActSearch');
  if (s) s.value = '';
  const b = document.getElementById('virtActBrand');
  if (b) b.value = '';
  const r = document.getElementById('virtActRegion');
  if (r) r.value = '东南区';
  loadVirtualActivities();
}

function toggleVirtualSortOrder() {
  virtualActivitiesState.sortOrder = virtualActivitiesState.sortOrder === 'DESC' ? 'ASC' : 'DESC';
  const icon = document.getElementById('virtSortIcon');
  if (icon) icon.textContent = virtualActivitiesState.sortOrder === 'DESC' ? '↓' : '↑';
  loadVirtualActivities();
}

function goVirtPage(p) {
  virtualActivitiesState.page = p;
  loadVirtualActivities();
}

async function renderVirtualActivities() {
  const container = document.getElementById('pageContainer');
  virtualActivitiesState.page = 1;

  container.innerHTML = `
    <div class="virtual-page-hint">
      虚拟场次用于<strong>报价预估</strong>，不计入<strong>排期日历</strong>与数据看板活动统计。
      下方<strong>预存报价合计</strong>为当前筛选条件下各品牌报价之和（年框编号对应品牌条线，可覆盖多个品牌）。
    </div>
    <div class="toolbar">
      <div class="toolbar-left">
        <input type="text" class="search-input" id="virtActSearch" placeholder="搜索客户/项目编号..." oninput="debounceVirtualSearch()" value="${escapeHtml(virtualActivitiesState.search)}">
        <select class="filter-select" id="virtActRegion" onchange="filterVirtualActivities()">
          <option value="">全部区域</option>
        </select>
        <select class="filter-select" id="virtActBrand" onchange="filterVirtualActivities()">
          <option value="">全部品牌</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm" onclick="resetVirtualFilters()">重置筛选</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleVirtualSortOrder()">
          日期 <span id="virtSortIcon">${virtualActivitiesState.sortOrder === 'DESC' ? '↓' : '↑'}</span>
        </button>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-primary btn-sm" onclick="showVirtualActivityModal()">+ 新建虚拟场次</button>
      </div>
    </div>
    <div id="virtualPrepaidStats"></div>
    <div id="virtActTable"></div>
    <div id="virtActPagination"></div>
  `;

  try {
    const regions = await api('GET', '/lookups?category=activity_region');
    const regionSel = document.getElementById('virtActRegion');
    if (regionSel) {
      const keep = virtualActivitiesState.region;
      regionSel.innerHTML =
        '<option value="">全部区域</option>' +
        (regions || [])
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep !== '' && [...regionSel.options].some((o) => o.value === keep)) regionSel.value = keep;
      else if (keep === '') regionSel.value = '';
      else regionSel.value = '东南区';
      virtualActivitiesState.region = regionSel.value;
    }
  } catch (e) {
    console.warn('虚拟场次区域筛选项加载失败', e);
  }
  const virtBrandSel = document.getElementById('virtActBrand');
  if (virtBrandSel) {
    const keep = virtualActivitiesState.brand;
    virtBrandSel.innerHTML =
      '<option value="">全部品牌</option>' +
      FIXED_BRAND_CODES.map((code) => `<option value="${code}">${code}</option>`).join('');
    if (keep && FIXED_BRAND_CODES.includes(keep)) virtBrandSel.value = keep;
  }
  await loadVirtualActivities();
}

async function loadVirtualActivities() {
  const container = document.getElementById('virtActTable');
  const statsEl = document.getElementById('virtualPrepaidStats');
  if (!container) return;

  container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">加载中...</div>';

  try {
    let qs = `?sortBy=activity_date&sortOrder=${virtualActivitiesState.sortOrder}&isVirtual=1`;
    if (currentYearFrameId) qs += `&yearFrameId=${currentYearFrameId}`;
    const regionVal = document.getElementById('virtActRegion')?.value ?? virtualActivitiesState.region;
    if (regionVal) qs += `&region=${encodeURIComponent(regionVal)}`;
    if (virtualActivitiesState.brand) qs += `&brand=${encodeURIComponent(virtualActivitiesState.brand)}`;

    const data = await api('GET', `/activities${qs}`);

    let filtered = data || [];
    if (virtualActivitiesState.search) {
      const kw = virtualActivitiesState.search.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          (a.city || '').toLowerCase().includes(kw) ||
          (a.client || '').toLowerCase().includes(kw) ||
          (a.client_name || '').toLowerCase().includes(kw) ||
          (a.project_code || '').toLowerCase().includes(kw)
      );
    }

    virtualActivitiesState.data = filtered;

    const agg = aggregateVirtualQuotedByBrand(filtered);
    if (statsEl) statsEl.innerHTML = formatVirtualBrandStatCards(agg);

    const pageSize = 50;
    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (virtualActivitiesState.page - 1) * pageSize;
    const pageData = filtered.slice(start, start + pageSize);

    const grouped = {};
    pageData.forEach((a) => {
      const d = new Date(a.date || a.activity_date);
      const key = Number.isNaN(d.getTime()) ? '未定日期' : `${d.getFullYear()}年${d.getMonth() + 1}月`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(a);
    });

    const vth = 'position:sticky;top:0;z-index:20;background:var(--bg-input);box-shadow:0 1px 0 var(--border);';
    let html = `<div class="table-wrapper" style="max-height:min(60vh,calc(100vh - 260px));overflow:auto;position:relative;"><table class="data-table act-table-sticky-head virtual-activities-table">
      <thead><tr>
        <th style="${vth}">日期</th><th style="${vth}">项目编号</th><th style="${vth}">品牌</th><th style="${vth}">区域</th><th style="${vth}">客户</th>
        <th style="${vth}">类型</th><th class="numeric" style="${vth}">报价</th><th style="${vth}">备注</th><th style="${vth}">操作</th>
      </tr></thead><tbody>`;

    Object.entries(grouped).forEach(([month, acts]) => {
      html += `<tr><td colspan="9" class="group-title">${month}（${acts.length}条）</td></tr>`;
      acts.forEach((a) => {
        html += `
          <tr onclick="showVirtualActivityDetail(${a.id})" style="cursor:pointer">
            <td>${fmtDateShort(a.date || a.activity_date)}</td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${escapeHtml(String(a.project_code || ''))}">${escapeHtml(String(a.project_code || '—'))}</td>
            <td><span class="badge badge-${brandColor(a.brand)}">${escapeHtml(String(a.brand || '—'))}</span></td>
            <td style="font-size:11px;color:var(--text-secondary)">${escapeHtml(String(a.region || '—'))}</td>
            <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${escapeHtml(String(a.client || a.client_name || '—'))}</td>
            <td><span class="badge badge-${typeColor(a.activity_type)}">${escapeHtml(String(a.activity_type || '—'))}</span></td>
            <td class="numeric"><span class="amount amount-revenue">${fmtMoney(a.quoted_price)}</span></td>
            <td style="max-width:160px;font-size:11px;color:var(--text-secondary)">${escapeHtml(String(a.remarks || '').slice(0, 80))}${String(a.remarks || '').length > 80 ? '…' : ''}</td>
            <td onclick="event.stopPropagation()">
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                <button class="btn btn-secondary btn-sm" onclick="showVirtualActivityModal(${a.id})">编辑</button>
                <button type="button" class="btn btn-danger btn-sm activity-row-remove-btn" onclick="openRemoveVirtualActivityDialog(${a.id})">删除</button>
              </div>
            </td>
          </tr>`;
      });
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
    renderLucideIcons();

    const pgEl = document.getElementById('virtActPagination');
    if (pgEl) {
      pgEl.innerHTML = renderPagination(
        virtualActivitiesState.page,
        totalPages,
        total,
        'goVirtPage'
      );
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(err.message)}</div></div>`;
    renderLucideIcons();
  }
}
