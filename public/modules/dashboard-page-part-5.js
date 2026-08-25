function drawDashboardFinanceTrend(rows) {
  const ctx = document.getElementById('chartFinanceTrend');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');
  const labels = (rows || []).map((r) => String(r.month || '').slice(5));
  const revenueData = (rows || []).map((r) => Number(r.revenue) || 0);
  const costData = (rows || []).map((r) => Number(r.cost) || 0);
  const marginData = (rows || []).map((r) => Number(r.grossMarginRate || 0) * 100);
  charts.financeTrend = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: '收入', data: revenueData, backgroundColor: '#3b82f6', yAxisID: 'yAmount', borderRadius: 6 },
        { type: 'bar', label: '成本', data: costData, backgroundColor: '#f59e0b', yAxisID: 'yAmount', borderRadius: 6 },
        { type: 'line', label: '毛利率', data: marginData, yAxisID: 'yMargin', borderColor: '#10b981', backgroundColor: '#10b981', tension: 0.25, pointRadius: 3 },
      ],
    },
    options: {
      plugins: { legend: { labels: { color: sec } } },
      scales: {
        x: { ticks: { color: sec }, grid: { display: false } },
        yAmount: { beginAtZero: true, position: 'left', ticks: { color: sec, callback: (v) => fmtMoney(v || 0) } },
        yMargin: { beginAtZero: true, position: 'right', ticks: { color: sec, callback: (v) => `${v}%` }, grid: { display: false } },
      },
    },
  });
}

function drawDashboardCostComposition(rows) {
  const ctx = document.getElementById('chartCostComposition');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');
  const labels = (rows || []).map((r) => `${r.costType} ${formatPercent(r.ratio || 0)}`);
  const values = (rows || []).map((r) => Number(r.amount) || 0);
  charts.costComposition = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#a78bfa'], borderWidth: 0, hoverOffset: 6 }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { color: sec, padding: 12, font: { size: 12 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label} · ${fmtMoney(ctx.raw || 0)}` } },
      },
      cutout: '58%',
    },
  });
}

function drawDashboardFullCostBreakdown(buckets, overview) {
  const ctx = document.getElementById('chartFullCostBreakdown');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');
  const rows = Array.isArray(buckets) ? buckets.filter((b) => b && b.key && b.key !== 'overview') : [];
  const labels = rows.map((r) => `${r.label || r.key} ${formatPercent(r.ratio || 0)}`);
  const values = rows.map((r) => Number(r.amount) || 0);
  const colors = DASHBOARD_FULL_COST_CHART_COLORS.slice(0, rows.length);
  const totalCost = Number(overview?.totalCost) || values.reduce((s, v) => s + (Number(v) || 0), 0);

  charts.fullCostBreakdown = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { color: sec, padding: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (c) => `${c.label} · ${fmtMoney(c.raw || 0)}`,
            footer: () => `全链路总成本：${fmtMoney(totalCost)}`,
          },
        },
      },
      cutout: '58%',
    },
  });
}

function dashboardChartCssHost() {
  return document.querySelector('.page-dashboard');
}

/** 白底看板内图表：优先读 `.page-dashboard` 上的 CSS 变量，避免全局暗色主题下图例/坐标过浅 */
function dashboardChartCssVar(name, fallback) {
  const host = dashboardChartCssHost();
  const fromHost = host ? getComputedStyle(host).getPropertyValue(name).trim() : '';
  if (fromHost) return fromHost;
  const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return fromRoot || fallback;
}

function drawMonthTrendChart(data, compare) {
  const ctx = document.getElementById('chartMonthTrend');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');
  const labels = data.map((d) => d.monthLabel);
  if (compare && compare.nationalActivityByMonth) {
    const nat = compare.nationalActivityByMonth;
    charts.monthTrend = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: compare.region || '主口径',
            data: data.map((d) => dashboardMetricValue(d)),
            backgroundColor: DASHBOARD_COMPARE_COLOR_REGION,
            borderRadius: 6,
          },
          {
            label: compare.compareLabel || '对比',
            data: nat.map((d) => dashboardMetricValue(d)),
            backgroundColor: DASHBOARD_COMPARE_COLOR_NATIONAL,
            borderRadius: 6,
          },
        ],
      },
      options: {
        datasets: { bar: { categoryPercentage: 0.72, barPercentage: 0.85 } },
        plugins: {
          legend: { display: true, labels: { color: sec, padding: 12, font: { size: 11 } } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: sec } },
          y: { beginAtZero: true, ticks: { color: sec, callback: (v) => dashboardMetricTick(v) } },
        },
      },
    });
    return;
  }
  charts.monthTrend = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: dashboardMetricText(),
        data: data.map((d) => dashboardMetricValue(d)),
        backgroundColor: '#7c6af7',
        borderRadius: 6,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: sec } },
        y: { beginAtZero: true, ticks: { color: sec, callback: (v) => dashboardMetricTick(v) } },
      },
    },
  });
}

function drawTypeChart(data, compare) {
  const ctx = document.getElementById('chartType');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');

  if (compare && compare.nationalActivityByType) {
    const regMap = new Map((data || []).map((r) => [r.activity_type, dashboardMetricValue(r)]));
    const natMap = new Map((compare.nationalActivityByType || []).map((r) => [r.activity_type, dashboardMetricValue(r)]));
    const labels = DASHBOARD_ACTIVITY_TYPES;
    charts.type = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: compare.region || '主口径',
            data: labels.map((t) => regMap.get(t) || 0),
            backgroundColor: DASHBOARD_COMPARE_COLOR_REGION,
            borderRadius: 6,
          },
          {
            label: compare.compareLabel || '对比',
            data: labels.map((t) => natMap.get(t) || 0),
            backgroundColor: DASHBOARD_COMPARE_COLOR_NATIONAL,
            borderRadius: 6,
          },
        ],
      },
      options: {
        datasets: { bar: { categoryPercentage: 0.72, barPercentage: 0.85 } },
        plugins: {
          legend: { display: true, labels: { color: sec, padding: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${dashboardMetricTooltipValue(c.raw)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: sec, font: { size: 11 } } },
          y: { beginAtZero: true, ticks: { color: sec, callback: (v) => dashboardMetricTick(v) } },
        },
      },
    });
    return;
  }

  const total = data.reduce((s, d) => s + dashboardMetricValue(d), 0);
  const labels = data.map((d) => {
    const c = dashboardMetricValue(d);
    const p = total > 0 ? ((c / total) * 100).toFixed(1) : '0.0';
    return `${d.activity_type} (${dashboardMetricTooltipValue(c)} / ${p}%)`;
  });
  charts.type = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: data.map((d) => dashboardMetricValue(d)),
        backgroundColor: ['#7c6af7','#60a5fa','#34d399','#fbbf24','#f87171'],
        borderWidth: 0,
        hoverOffset: 6,
      }]
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { color: sec, padding: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: { label: (ctx) => ` ${ctx.label}: ${dashboardMetricTooltipValue(ctx.raw)}` }
        }
      },
      cutout: '60%',
    }
  });
}
