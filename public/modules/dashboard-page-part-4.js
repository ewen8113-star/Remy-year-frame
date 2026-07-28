function dashboardDetailFilterRows(rows) {
  return (rows || []).filter((r) => {
    if (dashboardDetailFilters.region && String(r.region || '') !== dashboardDetailFilters.region) return false;
    if (dashboardDetailFilters.city && String(r.city || '') !== dashboardDetailFilters.city) return false;
    if (!dashboardDetailFilters.costType) return true;
    const keyMap = {
      logistics: 'logisticsCost',
      personnel: 'personnelCost',
      procurement: 'procurementCost',
      other: 'otherCost',
    };
    const k = keyMap[dashboardDetailFilters.costType];
    if (!k) return true;
    return Number(r[k] || 0) > 0;
  });
}

function onDashboardDetailFiltersChange() {
  dashboardDetailFilters.region = document.getElementById('dashDetailRegion')?.value || '';
  dashboardDetailFilters.city = document.getElementById('dashDetailCity')?.value || '';
  dashboardDetailFilters.costType = document.getElementById('dashDetailCostType')?.value || '';
  renderDashboard();
}

function exportDashboardDetailCsv() {
  if (!dashboardLastPayload || !Array.isArray(dashboardLastPayload.detailRows)) {
    showToast('暂无可导出的明细数据', 'warning');
    return;
  }
  const rows = dashboardDetailFilterRows(dashboardLastPayload.detailRows);
  if (!rows.length) {
    showToast('当前筛选下无明细可导出', 'warning');
    return;
  }
  const head = ['场次编号', '活动名称', '大区', '城市', '报价', '物流', '人员', '采购', '其他', '总成本', '毛利', '毛利率'];
  const lines = [head.map(toCsvCell).join(',')];
  rows.forEach((r) => {
    lines.push([
      r.projectCode || '',
      r.activityName || '',
      r.region || '',
      r.city || '',
      roundMoney2(r.quotedPrice || 0).toFixed(2),
      roundMoney2(r.logisticsCost || 0).toFixed(2),
      roundMoney2(r.personnelCost || 0).toFixed(2),
      roundMoney2(r.procurementCost || 0).toFixed(2),
      roundMoney2(r.otherCost || 0).toFixed(2),
      roundMoney2(r.totalCost || 0).toFixed(2),
      roundMoney2(r.grossProfit || 0).toFixed(2),
      formatPercent(r.grossMarginRate || 0),
    ].map(toCsvCell).join(','));
  });
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadTextFile(`dashboard-detail-${now}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
  showToast('明细 CSV 已导出', 'success');
}

async function renderDashboard() {
  const container = document.getElementById('pageContainer');
  try {
    Object.values(charts).forEach((c) => c && c.destroy());
    charts = {};

    const query = dashboardQueryString();
    const dash = await api('GET', `/dashboard${query}${query ? '&' : '?'}_ts=${Date.now()}`);
    dashboardLastPayload = dash;
    dashboardLastQuery = query;

    const {
      overview = {},
      regionSummary = [],
      trendByMonth = [],
      trendByMonthFull = [],
      costComposition = [],
      regionCityBreakdown = [],
      detailRows = [],
      metricDefinition = {},
    } = dash;
    const financeTrendRows = (trendByMonthFull && trendByMonthFull.length) ? trendByMonthFull : trendByMonth;

    const regionOptions = [...new Set((detailRows || []).map((r) => String(r.region || '').trim()).filter(Boolean))];
    const cityOptions = [...new Set((detailRows || []).map((r) => String(r.city || '').trim()).filter(Boolean))];
    if (dashboardDetailFilters.region && !regionOptions.includes(dashboardDetailFilters.region)) dashboardDetailFilters.region = '';
    if (dashboardDetailFilters.city && !cityOptions.includes(dashboardDetailFilters.city)) dashboardDetailFilters.city = '';
    const filteredDetailRows = dashboardDetailFilterRows(detailRows);
    const selectedRegionForDrill = dashboardDetailFilters.region || dashboardState.region || '';
    const drillRows = regionCityBreakdown.filter((r) => !selectedRegionForDrill || String(r.region || '') === String(selectedRegionForDrill));

    const regionSummaryRows = (regionSummary || []).map((r) => `
      <tr>
        <td>${escapeHtml(r.region || '未分区')}</td>
        <td class="dash-num">${r.sessions || 0}</td>
        <td class="dash-num">${fmtMoney(r.revenue || 0)}</td>
        <td class="dash-num">${fmtMoney(r.cost || 0)}</td>
        <td class="dash-num">${formatPercent(r.grossMarginRate || 0)}</td>
      </tr>
    `).join('');
    const regionSummaryTotal = {
      sessions: regionSummary.reduce((s, r) => s + (Number(r.sessions) || 0), 0),
      revenue: regionSummary.reduce((s, r) => s + (Number(r.revenue) || 0), 0),
      cost: regionSummary.reduce((s, r) => s + (Number(r.cost) || 0), 0),
    };
    const totalMargin = regionSummaryTotal.revenue > 0 ? (regionSummaryTotal.revenue - regionSummaryTotal.cost) / regionSummaryTotal.revenue : 0;

    const drillRowsHtml = drillRows.map((r) => `
      <tr>
        <td>${escapeHtml(r.region || '')}</td>
        <td>${escapeHtml(r.city || '')}</td>
        <td class="dash-num">${r.sessions || 0}</td>
        <td class="dash-num">${fmtMoney(r.revenue || 0)}</td>
        <td class="dash-num">${fmtMoney(r.cost || 0)}</td>
        <td class="dash-num">${formatPercent(r.grossMarginRate || 0)}</td>
      </tr>
    `).join('');

    const detailRowsHtml = filteredDetailRows.map((r) => `
      <tr>
        <td>${escapeHtml(r.projectCode || '')}</td>
        <td>${escapeHtml(r.activityName || '')}</td>
        <td>${escapeHtml(r.region || '')}</td>
        <td>${escapeHtml(r.city || '')}</td>
        <td class="dash-num">${fmtMoney(r.quotedPrice || 0)}</td>
        <td class="dash-num">${fmtMoney(r.logisticsCost || 0)}</td>
        <td class="dash-num">${fmtMoney(r.personnelCost || 0)}</td>
        <td class="dash-num">${fmtMoney(r.procurementCost || 0)}</td>
        <td class="dash-num">${fmtMoney(r.otherCost || 0)}</td>
        <td class="dash-num">${fmtMoney(r.totalCost || 0)}</td>
        <td class="dash-num">${formatPercent(r.grossMarginRate || 0)}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="page-dashboard">
      <div class="dash-card dash-filter-card">
        <div class="dash-filter-card__header">
          <h2 class="dash-page-title">数据详情</h2>
          <div class="dash-filter-actions">
            <button type="button" class="dash-btn dash-btn--secondary" onclick="resetDashboardFilters()">重置筛选</button>
            <button type="button" class="dash-btn dash-btn--primary" onclick="exportDashboardJson()">导出看板JSON</button>
            <button type="button" class="dash-btn dash-btn--primary" onclick="exportDashboardCityDrillCsv()">导出城市明细CSV</button>
            <button type="button" class="dash-btn dash-btn--primary" onclick="exportDashboardDetailCsv()">导出明细CSV</button>
          </div>
        </div>
        <div class="dash-filter-fields">
          <div class="dash-grid dash-grid--3col">
            <div class="dash-field">
              <span class="dash-label">日期区间</span>
              <div id="dashboardDateRangeHost" class="dash-field__control"></div>
            </div>
            <div class="dash-field">
              <label class="dash-label" for="dashFilterType">类型</label>
              <select class="dash-control" id="dashFilterType" onchange="filterDashboard()"><option value="">类型</option></select>
            </div>
            <div class="dash-field">
              <label class="dash-label" for="dashFilterPeriod">时段</label>
              <select class="dash-control" id="dashFilterPeriod" onchange="filterDashboard()"><option value="">时段</option></select>
            </div>
            <div class="dash-field">
              <label class="dash-label" for="dashFilterRegion">区域</label>
              <select class="dash-control" id="dashFilterRegion" onchange="filterDashboard()"><option value="">区域</option></select>
            </div>
            <div class="dash-field">
              <label class="dash-label" for="dashFilterBrand">品牌</label>
              <select class="dash-control" id="dashFilterBrand" onchange="filterDashboard()"><option value="">品牌</option></select>
            </div>
            <div class="dash-field">
              <label class="dash-label" for="dashFilterExecution">执行</label>
              <select class="dash-control" id="dashFilterExecution" onchange="filterDashboard()">
                <option value="">执行</option>
                <option value="有">有</option>
                <option value="无">无</option>
              </select>
            </div>
            <div class="dash-field">
              <label class="dash-label" for="dashFilterPg">PG礼仪</label>
              <select class="dash-control" id="dashFilterPg" onchange="filterDashboard()">
                <option value="">PG礼仪</option>
                <option value="有">有</option>
                <option value="无">无</option>
              </select>
            </div>
          </div>
          <div class="dash-filter-compare-slot">
            <div class="dash-field dash-field--compare">
              <label class="dash-label" for="dashCompareRegion">对比区域</label>
              <select class="dash-control" id="dashCompareRegion" onchange="filterDashboard()"><option value="">不对比</option><option value="全国">全国</option></select>
            </div>
          </div>
        </div>
      </div>

      <div class="stats-grid page-dashboard__stats">
        <div class="stat-card accent"><div class="stat-label">本期场次总数</div><div class="stat-value">${overview.totalSessions || 0}</div><div class="stat-sub">当前筛选条件</div></div>
        <div class="stat-card danger"><div class="stat-label">含 PG 礼仪场次</div><div class="stat-value">${overview.pgSessions ?? 0}</div><div class="stat-sub">礼仪成本大于 0 的场次</div></div>
        <div class="stat-card success"><div class="stat-label">本期项目总收入</div><div class="stat-value sm">${fmtMoney(overview.totalRevenue || 0)}</div><div class="stat-sub">${escapeHtml(metricDefinition.revenue || '')}</div></div>
        <div class="stat-card warning"><div class="stat-label">本期总成本</div><div class="stat-value sm">${fmtMoney(overview.totalCost || 0)}</div><div class="stat-sub">${escapeHtml(metricDefinition.cost || '')}</div></div>
        <div class="stat-card blue"><div class="stat-label">本期项目毛利率</div><div class="stat-value">${formatPercent(overview.grossMarginRate || 0)}</div><div class="stat-sub">${escapeHtml(metricDefinition.grossMarginRate || '')}</div></div>
      </div>

      ${renderDashboardCostPanel(dash)}

      <div class="dash-card dash-summary-card">
        <div class="card-header">
          <div><div class="card-title">全国汇总（大区）</div><div class="card-sub">按大区对比场次、收入、成本、毛利率</div></div>
        </div>
        <div class="table-wrapper">
          <table class="dash-table">
            <thead><tr><th>大区</th><th class="dash-num">场次</th><th class="dash-num">收入</th><th class="dash-num">成本</th><th class="dash-num">毛利率</th></tr></thead>
            <tbody>
              ${regionSummaryRows || '<tr><td colspan="5" class="dash-empty">暂无数据</td></tr>'}
            </tbody>
            <tfoot><tr><th>合计</th><th class="dash-num">${regionSummaryTotal.sessions}</th><th class="dash-num">${fmtMoney(regionSummaryTotal.revenue)}</th><th class="dash-num">${fmtMoney(regionSummaryTotal.cost)}</th><th class="dash-num">${formatPercent(totalMargin)}</th></tr></tfoot>
          </table>
        </div>
      </div>

      <div class="dash-card dash-analysis-card">
        <div class="dash-tabs">
          <button type="button" class="dash-tab ${dashboardAnalysisTab === 'trend' ? 'is-active' : ''}" onclick="setDashboardAnalysisTab('trend')">月度趋势</button>
          <button type="button" class="dash-tab ${dashboardAnalysisTab === 'structure' ? 'is-active' : ''}" onclick="setDashboardAnalysisTab('structure')">成本结构占比</button>
          <button type="button" class="dash-tab ${dashboardAnalysisTab === 'drill' ? 'is-active' : ''}" onclick="setDashboardAnalysisTab('drill')">大区详情下钻</button>
        </div>
        <div class="dash-tab-panel ${dashboardAnalysisTab === 'trend' ? 'is-active' : ''}">
          <div class="card-header"><div><div class="card-title">月度趋势（收入/成本/毛利率）</div><div class="card-sub">成本含物流月结等各板块当月发生额</div></div></div>
          <canvas id="chartFinanceTrend"></canvas>
        </div>
        <div class="dash-tab-panel ${dashboardAnalysisTab === 'structure' ? 'is-active' : ''}">
          <div class="card-header"><div><div class="card-title">成本结构占比</div><div class="card-sub">物流 / 人员 / 采购 / 其他</div></div></div>
          <canvas id="chartCostComposition"></canvas>
        </div>
        <div class="dash-tab-panel ${dashboardAnalysisTab === 'drill' ? 'is-active' : ''}">
          <div class="card-header">
            <div><div class="card-title">大区城市下钻明细</div><div class="card-sub">${selectedRegionForDrill ? `当前区域：${escapeHtml(selectedRegionForDrill)}` : '显示全部区域'}</div></div>
          </div>
          <div class="table-wrapper">
            <table class="dash-table">
              <thead><tr><th>大区</th><th>城市</th><th class="dash-num">场次</th><th class="dash-num">收入</th><th class="dash-num">成本</th><th class="dash-num">毛利率</th></tr></thead>
              <tbody>${drillRowsHtml || '<tr><td colspan="6" class="dash-empty">暂无城市明细</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="dash-card dash-detail-card">
        <div class="card-header">
          <div><div class="card-title">场次级明细</div><div class="card-sub">支持大区 / 城市 / 成本类型筛选</div></div>
        </div>
        <div class="dash-detail-filters">
          <select class="dash-control" id="dashDetailRegion" onchange="onDashboardDetailFiltersChange()">
            <option value="">全部大区</option>
            ${regionOptions.map((r) => `<option value="${escapeHtml(r)}" ${dashboardDetailFilters.region === r ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
          </select>
          <select class="dash-control" id="dashDetailCity" onchange="onDashboardDetailFiltersChange()">
            <option value="">全部城市</option>
            ${cityOptions.map((c) => `<option value="${escapeHtml(c)}" ${dashboardDetailFilters.city === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
          <select class="dash-control" id="dashDetailCostType" onchange="onDashboardDetailFiltersChange()">
            <option value="">全部成本类型</option>
            <option value="logistics" ${dashboardDetailFilters.costType === 'logistics' ? 'selected' : ''}>物流成本</option>
            <option value="personnel" ${dashboardDetailFilters.costType === 'personnel' ? 'selected' : ''}>人员成本</option>
            <option value="procurement" ${dashboardDetailFilters.costType === 'procurement' ? 'selected' : ''}>采购成本</option>
            <option value="other" ${dashboardDetailFilters.costType === 'other' ? 'selected' : ''}>其他成本</option>
          </select>
        </div>
        <div class="table-wrapper">
          <table class="dash-table dash-table--detail">
            <thead><tr><th>场次编号</th><th>活动名称</th><th>大区</th><th>城市</th><th class="dash-num">报价</th><th class="dash-num">物流</th><th class="dash-num">人员</th><th class="dash-num">采购</th><th class="dash-num">其他</th><th class="dash-num">总成本</th><th class="dash-num">毛利率</th></tr></thead>
            <tbody>${detailRowsHtml || '<tr><td colspan="11" class="dash-empty">暂无明细数据</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      </div>

    `;

    drawDashboardFinanceTrend(financeTrendRows);
    drawDashboardCostComposition(costComposition);
    drawDashboardFullCostBreakdown(dash.costBreakdown || [], dash.overview || {});
    await populateDashboardFilterSelects();
    renderLucideIcons();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${err.message}</div></div>`;
    renderLucideIcons();
  }
}
