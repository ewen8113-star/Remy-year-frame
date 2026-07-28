function applyDashboardDatePicker() {
  dashboardState.dateStart = dashboardDatePickerState.draftStart || '';
  dashboardState.dateEnd = dashboardDatePickerState.draftEnd || '';
  if (dashboardState.dateStart && dashboardState.dateEnd && dashboardState.dateStart > dashboardState.dateEnd) {
    showToast('结束日期不能早于开始日期', 'warning');
    return;
  }
  dashboardDatePickerState.open = false;
  renderDashboardDatePicker();
  renderDashboard();
}

function dashboardMetricTick(v) {
  if (dashboardChartMetric === 'revenue') return '¥' + (Number(v) / 10000).toFixed(0) + 'w';
  return String(v);
}

function dashboardMetricTooltipValue(v) {
  if (dashboardChartMetric === 'revenue') return fmtMoney(v || 0);
  return `${parseInt(v, 10) || 0} 场`;
}

function setDashboardChartMetric(metric) {
  const m = metric === 'revenue' ? 'revenue' : 'count';
  dashboardChartMetric = m;
  localStorage.setItem('remy_dashboardChartMetric', m);
  renderDashboard();
}

/**
 * 单选区域时用于双系列图表；优先顶层 regionNationalCompare，
 * 否则从 summary.regionShare 内嵌的对比序列读取（避免代理/缓存丢字段）。
 */
function resolveDashboardChartCompare(dash) {
  if (!dash) return null;
  const top = dash.regionNationalCompare;
  if (top && Array.isArray(top.nationalActivityByMonth) && top.nationalActivityByMonth.length > 0) {
    return top;
  }
  const rs = dash.summary && dash.summary.regionShare;
  if (rs && Array.isArray(rs.nationalActivityByMonth) && rs.nationalActivityByMonth.length > 0) {
    return {
      region: rs.region || rs.primaryLabel,
      compareLabel: rs.compareLabel,
      compareMode: 'national',
      primaryTotalCount: rs.regionCount,
      compareTotalCount: rs.compareCount,
      nationalActivityByMonth: rs.nationalActivityByMonth,
      nationalActivityByType: rs.nationalActivityByType,
      nationalActivityByBrand: rs.nationalActivityByBrand,
      nationalActivityByRegion: rs.nationalActivityByRegion,
    };
  }
  if (top && (top.nationalActivityByBrand || top.nationalActivityByType)) return top;
  return null;
}

function renderLucideIcons() {
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function filterDashboard() {
  dashboardState.activityType = document.getElementById('dashFilterType')?.value || '';
  dashboardState.period = document.getElementById('dashFilterPeriod')?.value || '';
  dashboardState.region = document.getElementById('dashFilterRegion')?.value || '';
  dashboardState.brand = document.getElementById('dashFilterBrand')?.value || '';
  dashboardState.executionFlag = document.getElementById('dashFilterExecution')?.value || '';
  dashboardState.pgFlag = document.getElementById('dashFilterPg')?.value || '';
  dashboardState.compareRegion = document.getElementById('dashCompareRegion')?.value || '';
  if (dashboardState.dateStart && dashboardState.dateEnd && dashboardState.dateStart > dashboardState.dateEnd) {
    showToast('结束日期不能早于开始日期', 'warning');
    return;
  }
  renderDashboard();
}

async function populateDashboardFilterSelects() {
  renderDashboardDatePicker();

  try {
    const types = await api('GET', '/lookups?category=activity_type');
    const typeSel = document.getElementById('dashFilterType');
    if (typeSel) {
      const keep = dashboardState.activityType;
      typeSel.innerHTML =
        '<option value="">类型</option>' +
        types
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...typeSel.options].some((o) => o.value === keep)) typeSel.value = keep;
    }
  } catch (e) {
    console.warn('数据看板活动类型筛选项加载失败', e);
  }
  try {
    const periods = await api('GET', '/lookups?category=activity_period');
    const periodSel = document.getElementById('dashFilterPeriod');
    if (periodSel) {
      const keep = dashboardState.period;
      periodSel.innerHTML =
        '<option value="">时段</option>' +
        periods
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...periodSel.options].some((o) => o.value === keep)) periodSel.value = keep;
    }
  } catch (e) {
    console.warn('数据看板时段筛选项加载失败', e);
  }
  try {
    const regions = await api('GET', '/lookups?category=activity_region');
    const regionSel = document.getElementById('dashFilterRegion');
    if (regionSel) {
      const keep = dashboardState.region;
      regionSel.innerHTML =
        '<option value="">区域</option>' +
        regions
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...regionSel.options].some((o) => o.value === keep)) regionSel.value = keep;
    }
    const cmpSel = document.getElementById('dashCompareRegion');
    if (cmpSel) {
      const keepCmp = dashboardState.compareRegion;
      cmpSel.innerHTML =
        '<option value="">不对比</option>' +
        '<option value="全国">全国</option>' +
        regions
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keepCmp && [...cmpSel.options].some((o) => o.value === keepCmp)) cmpSel.value = keepCmp;
      else cmpSel.value = '';
      dashboardState.compareRegion = cmpSel.value || '';
    }
  } catch (e) {
    console.warn('数据看板区域/对比区域筛选项加载失败', e);
  }

  renderBrandOptions();
  const bsel = document.getElementById('dashFilterBrand');
  const bk = dashboardState.brand;
  if (bsel && bk && [...bsel.options].some((o) => o.value === bk)) bsel.value = bk;

  const exSel = document.getElementById('dashFilterExecution');
  if (exSel) exSel.value = dashboardState.executionFlag || '';
  const pgSel = document.getElementById('dashFilterPg');
  if (pgSel) pgSel.value = dashboardState.pgFlag || '';
}

function resetDashboardFilters() {
  const defaultDashboardDateRange = getDashboardDefaultDateRange();
  dashboardState = {
    brand: '',
    region: '',
    activityType: '',
    executionFlag: '',
    pgFlag: '',
    period: '',
    dateStart: defaultDashboardDateRange.start,
    dateEnd: defaultDashboardDateRange.end,
    compareRegion: '',
  };
  dashboardDatePickerState = {
    open: false,
    leftMonth: '',
    draftStart: '',
    draftEnd: '',
    hoverDate: '',
  };
  dashboardDrillRegion = null;
  renderDashboard();
}

function clearDashboardRegionDrill() {
  dashboardDrillRegion = null;
  renderDashboard();
}

function toggleDashboardDrillForFilteredRegion() {
  const r = dashboardState.region;
  if (!r) return;
  dashboardDrillRegion = dashboardDrillRegion === r ? null : r;
  renderDashboard();
}

function renderDashboardRegionDrillPanel(region, cityBreakdown, hasRegionCompare) {
  if (!region) {
    const hint = hasRegionCompare
      ? '在区域对比图中点击左侧主区域（深紫）条形，或使用下方按钮，展开城市排行'
      : '点击环形图扇区查看该区域内城市场次排行';
    return `<div class="card-sub dashboard-region-drill-hint" style="margin-top:10px">${hint}</div>`;
  }
  const rows = (cityBreakdown || [])
    .filter((r) => (r.region || '') === region)
    .map((r) => ({
      city: r.city || '未知',
      count: parseInt(r.count, 10) || 0,
      revenue: parseFloat(r.revenue) || 0,
    }))
    .sort((a, b) => b.count - a.count);
  const total = rows.reduce((s, r) => s + r.count, 0);
  const head = `
    <div class="dashboard-region-drill">
      <div class="dashboard-region-drill-head">
        <div class="card-sub" style="margin:0"><strong>${escapeHtml(region)}</strong> · 城市分布（共 ${total} 场）</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="clearDashboardRegionDrill()">关闭下钻</button>
      </div>`;
  if (!rows.length) {
    return `${head}<div class="card-sub">暂无城市明细</div></div>`;
  }
  const body = rows
    .map((r) => {
      const pct = total > 0 ? ((r.count / total) * 100).toFixed(1) : '0.0';
      return `<tr><td>${escapeHtml(r.city)}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${r.count}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${pct}%</td><td style="text-align:right;font-variant-numeric:tabular-nums">${fmtMoney(r.revenue)}</td></tr>`;
    })
    .join('');
  return `${head}
      <div class="table-wrapper" style="margin-top:8px">
        <table>
          <thead><tr><th>城市</th><th style="text-align:right">场次</th><th style="text-align:right">区内占比</th><th style="text-align:right">报价</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
}
