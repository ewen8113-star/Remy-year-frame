function dashboardQueryString() {
  const sp = new URLSearchParams();
  if (currentYearFrameId) sp.set('yearFrameId', String(currentYearFrameId));
  if (dashboardState.brand) sp.set('brands', dashboardState.brand);
  if (dashboardState.region) sp.set('regions', dashboardState.region);
  if (dashboardState.activityType) sp.set('activityTypes', dashboardState.activityType);
  if (dashboardState.executionFlag) sp.set('executionFlags', dashboardState.executionFlag);
  if (dashboardState.pgFlag) sp.set('pgFlags', dashboardState.pgFlag);
  if (dashboardState.period) sp.set('periods', dashboardState.period);
  if (dashboardState.dateStart) sp.set('dateStart', dashboardState.dateStart);
  if (dashboardState.dateEnd) sp.set('dateEnd', dashboardState.dateEnd);
  if (dashboardState.compareRegion) sp.set('compareRegion', dashboardState.compareRegion);
  const q = sp.toString();
  return q ? `?${q}` : '';
}

function toCsvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportDashboardJson() {
  if (!dashboardLastPayload) {
    showToast('暂无可导出的看板数据', 'warning');
    return;
  }
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const payload = {
    exportedAt: new Date().toISOString(),
    query: dashboardLastQuery,
    state: { ...dashboardState },
    data: dashboardLastPayload,
  };
  downloadTextFile(`dashboard-export-${now}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  showToast('看板 JSON 已导出', 'success');
}

function exportDashboardCityDrillCsv() {
  if (!dashboardLastPayload || !Array.isArray(dashboardLastPayload.cityBreakdown)) {
    showToast('暂无可导出的城市明细', 'warning');
    return;
  }
  const selectedRegion = dashboardDrillRegion || dashboardState.region || '';
  const rows = dashboardLastPayload.cityBreakdown
    .filter((r) => !selectedRegion || String(r.region || '') === String(selectedRegion))
    .map((r) => ({
      region: r.region || '',
      city: r.city || '',
      count: parseInt(r.count, 10) || 0,
      revenue: parseFloat(r.revenue) || 0,
    }))
    .sort((a, b) => b.count - a.count || b.revenue - a.revenue);
  if (!rows.length) {
    showToast('当前口径下没有城市明细可导出', 'warning');
    return;
  }
  const head = ['区域', '城市', '场次', '报价'];
  const lines = [head.map(toCsvCell).join(',')];
  rows.forEach((r) => {
    lines.push([r.region, r.city, r.count, roundMoney2(r.revenue).toFixed(2)].map(toCsvCell).join(','));
  });
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const regionTag = selectedRegion ? selectedRegion : 'all-regions';
  downloadTextFile(`dashboard-city-drill-${regionTag}-${now}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
  showToast('城市下钻 CSV 已导出', 'success');
}

function formatPercent(v) {
  return `${(Number(v || 0) * 100).toFixed(1)}%`;
}

function setDashboardAnalysisTab(tab) {
  const next = ['trend', 'structure', 'drill'].includes(tab) ? tab : 'trend';
  if (dashboardAnalysisTab === next) return;
  dashboardAnalysisTab = next;
  renderDashboard();
}

function setDashboardCostTab(tab) {
  const allowed = DASHBOARD_COST_TAB_DEFS.map((t) => t.key);
  const next = allowed.includes(tab) ? tab : 'overview';
  if (dashboardCostTab === next) return;
  dashboardCostTab = next;
  renderDashboard();
}

function renderDashboardCostBucketRow(bucket) {
  if (!bucket) return '';
  return `<tr>
    <td>${escapeHtml(bucket.label || '')}</td>
    <td class="dash-num">${bucket.count ?? '—'}</td>
    <td class="dash-num">${fmtMoney(bucket.amount || 0)}</td>
    <td class="dash-num">${formatPercent(bucket.ratio || 0)}</td>
    <td class="dash-cost-hint">${escapeHtml(bucket.hint || '')}</td>
  </tr>`;
}

function renderDashboardCostPanel(dash) {
  const { overview = {}, costBreakdown = [], reimbCostByModule = [], metricDefinition = {} } = dash;
  const buckets = Array.isArray(costBreakdown) ? costBreakdown : [];
  const activeKey = DASHBOARD_COST_TAB_DEFS.some((t) => t.key === dashboardCostTab) ? dashboardCostTab : 'overview';
  const activeBucket = buckets.find((b) => b.key === activeKey);

  const overviewHtml = `
    <div class="dash-cost-overview-grid">
      <div class="dash-cost-kpi">
        <span class="dash-cost-kpi__label">项目收入（场次报价）</span>
        <span class="dash-cost-kpi__value">${fmtMoney(overview.totalRevenue || 0)}</span>
      </div>
      <div class="dash-cost-kpi dash-cost-kpi--minus">−</div>
      <div class="dash-cost-kpi">
        <span class="dash-cost-kpi__label">全链路总成本</span>
        <span class="dash-cost-kpi__value">${fmtMoney(overview.totalCost || 0)}</span>
        <span class="dash-cost-kpi__sub">场次 ${fmtMoney(overview.activityCost || 0)} · 其他板块 ${fmtMoney(overview.poolCost || 0)}</span>
      </div>
      <div class="dash-cost-kpi dash-cost-kpi--eq">=</div>
      <div class="dash-cost-kpi dash-cost-kpi--profit">
        <span class="dash-cost-kpi__label">项目毛利</span>
        <span class="dash-cost-kpi__value">${fmtMoney(overview.grossProfit || 0)}</span>
        <span class="dash-cost-kpi__sub">毛利率 ${formatPercent(overview.grossMarginRate || 0)}</span>
      </div>
    </div>
    <p class="dash-hint">${escapeHtml(metricDefinition.cost || '')}</p>
    <div class="dash-cost-overview-body">
      <div class="table-wrapper dash-cost-table-wrap">
        <table class="dash-table">
          <thead><tr><th>成本板块</th><th class="dash-num">笔数</th><th class="dash-num">金额</th><th class="dash-num">占全链路</th><th>口径说明</th></tr></thead>
          <tbody>${buckets.map(renderDashboardCostBucketRow).join('') || '<tr><td colspan="5" class="dash-empty">暂无成本数据</td></tr>'}</tbody>
          <tfoot><tr><th>合计</th><th></th><th class="dash-num">${fmtMoney(overview.totalCost || 0)}</th><th class="dash-num">100%</th><th></th></tr></tfoot>
        </table>
      </div>
      <div class="dash-cost-chart-slot"><canvas id="chartFullCostBreakdown"></canvas></div>
    </div>`;

  let detailHtml = '';
  if (activeKey === 'activity') {
    detailHtml = `
      <p class="dash-hint">${escapeHtml(metricDefinition.activityCostDetail || '')}</p>
      <p class="dash-hint">下方「成本结构占比」图展示场次内物流/人员/采购/其他拆分；场次级明细见页面底部表格。</p>`;
  } else if (activeKey === 'reimbursement') {
    const reimbRows = (reimbCostByModule || [])
      .filter((r) => String(r.module || '') === 'activity')
      .map((r) => `
      <tr>
        <td>${escapeHtml(r.label || r.module || '')}</td>
        <td class="dash-num">${r.count ?? 0}</td>
        <td class="dash-num">${fmtMoney(r.amount || 0)}</td>
        <td class="dash-num">${formatPercent(r.ratio || 0)}</td>
      </tr>`).join('');
    detailHtml = `
      <p class="dash-hint">按活动成本报销拆分，同一笔不会与场次成本重复计算。</p>
      <div class="table-wrapper">
        <table class="dash-table">
          <thead><tr><th>报销模块</th><th class="dash-num">笔数</th><th class="dash-num">金额</th><th class="dash-num">占报销池</th></tr></thead>
          <tbody>${reimbRows || '<tr><td colspan="4" class="dash-empty">暂无报销成本</td></tr>'}</tbody>
          <tfoot><tr><th>合计</th><th></th><th class="dash-num">${fmtMoney(activeBucket?.amount || 0)}</th><th></th></tr></tfoot>
        </table>
      </div>`;
  } else if (activeKey === 'material_purchase') {
    const coordReimbRows = (reimbCostByModule || [])
      .filter((r) => String(r.module || '') !== 'activity')
      .map((r) => `
      <tr>
        <td>${escapeHtml(r.label || r.module || '')}</td>
        <td class="dash-num">${r.count ?? 0}</td>
        <td class="dash-num">${fmtMoney(r.amount || 0)}</td>
        <td class="dash-num">${formatPercent(r.ratio || 0)}</td>
      </tr>`).join('');
    detailHtml = `
      <div class="dash-cost-single">
        <div class="dash-cost-single__amount">${fmtMoney(activeBucket.amount || 0)}</div>
        <div class="dash-cost-single__meta">${activeBucket.count ?? 0} 笔 · 占全链路 ${formatPercent(activeBucket.ratio || 0)}</div>
        <p class="dash-hint">${escapeHtml(activeBucket.hint || '')}</p>
      </div>
      <div class="table-wrapper" style="margin-top:14px">
        <table class="dash-table">
          <thead><tr><th>统筹来源</th><th class="dash-num">笔数</th><th class="dash-num">金额</th><th class="dash-num">占统筹报销</th></tr></thead>
          <tbody>${coordReimbRows || '<tr><td colspan="4" class="dash-empty">暂无统筹报销明细</td></tr>'}</tbody>
        </table>
      </div>`;
  } else if (activeBucket) {
    detailHtml = `
      <div class="dash-cost-single">
        <div class="dash-cost-single__amount">${fmtMoney(activeBucket.amount || 0)}</div>
        <div class="dash-cost-single__meta">${activeBucket.count ?? 0} 笔 · 占全链路 ${formatPercent(activeBucket.ratio || 0)}</div>
        <p class="dash-hint">${escapeHtml(activeBucket.hint || '')}</p>
      </div>`;
  } else {
    detailHtml = '<p class="dash-empty">暂无该板块数据</p>';
  }

  const tabsHtml = DASHBOARD_COST_TAB_DEFS.map((t) => {
    const b = buckets.find((x) => x.key === t.key);
    const badge = t.key !== 'overview' && b ? fmtMoney(b.amount || 0) : '';
    return `<button type="button" class="dash-tab ${activeKey === t.key ? 'is-active' : ''}" onclick="setDashboardCostTab('${t.key}')">${escapeHtml(t.label)}${badge ? `<span class="dash-tab__badge">${badge}</span>` : ''}</button>`;
  }).join('');

  return `
    <div class="dash-card dash-cost-card">
      <div class="card-header">
        <div><div class="card-title">全链路成本与利润</div><div class="card-sub">收入减各板块成本合计为项目毛利</div></div>
      </div>
      <div class="dash-tabs dash-tabs--cost">${tabsHtml}</div>
      <div class="dash-tab-panel is-active dash-cost-panel">
        ${activeKey === 'overview' ? overviewHtml : detailHtml}
      </div>
    </div>`;
}
