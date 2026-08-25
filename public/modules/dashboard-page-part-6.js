function buildBrandCompareRows(regional, national) {
  const m = new Map();
  (regional || []).forEach((r) => {
    const b = r.brand || '未知';
    m.set(b, { brand: b, reg: dashboardMetricValue(r), nat: 0 });
  });
  (national || []).forEach((r) => {
    const b = r.brand || '未知';
    const row = m.get(b) || { brand: b, reg: 0, nat: 0 };
    row.nat = dashboardMetricValue(r);
    m.set(b, row);
  });
  const arr = [...m.values()];
  arr.sort((a, b) => Math.max(b.reg, b.nat) - Math.max(a.reg, a.nat));
  return arr.slice(0, 15);
}

function drawBrandChart(data, compare) {
  const ctx = document.getElementById('chartBrand');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');
  const borderCol = dashboardChartCssVar('--border', '#e2e8f0');

  if (compare && compare.nationalActivityByBrand) {
    const rows = buildBrandCompareRows(data, compare.nationalActivityByBrand);
    const labels = rows.map((r) => r.brand);
    charts.brand = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: compare.region || '主口径',
            data: rows.map((r) => r.reg),
            backgroundColor: DASHBOARD_COMPARE_COLOR_REGION,
            borderRadius: 6,
          },
          {
            label: compare.compareLabel || '对比',
            data: rows.map((r) => r.nat),
            backgroundColor: DASHBOARD_COMPARE_COLOR_NATIONAL,
            borderRadius: 6,
          },
        ],
      },
      options: {
        datasets: { bar: { categoryPercentage: 0.72, barPercentage: 0.85 } },
        plugins: { legend: { display: true, labels: { color: sec, padding: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: sec, font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: sec, font: { size: 11 }, callback: (v) => dashboardMetricTick(v) }, grid: { color: borderCol } },
        },
      },
    });
    return;
  }

  const colors = { 'X.O': '#fbbf24', 'PHD': '#7c6af7', 'CLUB': '#60a5fa', 'REMY': '#34d399' };
  charts.brand = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.brand),
      datasets: [{
        label: dashboardMetricText(),
        data: data.map((d) => dashboardMetricValue(d)),
        backgroundColor: data.map(d => colors[d.brand] || '#9ea3b8'),
        borderRadius: 6,
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: sec, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: sec, font: { size: 11 }, callback: (v) => dashboardMetricTick(v) }, grid: { color: borderCol } }
      }
    }
  });
}

function drawRegionChart(data, compare, regionShare) {
  const ctx = document.getElementById('chartRegion');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');

  if (compare && regionShare) {
    const natReg = compare.nationalActivityByRegion;
    const isNational = compare.compareMode === 'national';
    const primaryMark = String(dashboardState.region || '').trim();
    const highlightName = primaryMark || String(compare.region || regionShare.region || '').trim();
    const useMultiBar = isNational && Array.isArray(natReg) && natReg.length > 1;

    if (useMultiBar) {
      const natRows = [...natReg].sort((a, b) => (parseInt(b.count, 10) || 0) - (parseInt(a.count, 10) || 0));
      natRows.sort((a, b) => dashboardMetricValue(b) - dashboardMetricValue(a));
      const labels = natRows.map((r) => r.region || '未知');
      const metricVals = natRows.map((r) => dashboardMetricValue(r));
      const bg = natRows.map((r) => {
        const name = String(r.region || '').trim();
        return highlightName && name === highlightName ? DASHBOARD_COMPARE_COLOR_REGION : DASHBOARD_COMPARE_COLOR_NATIONAL;
      });
      charts.region = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: dashboardMetricText(),
              data: metricVals,
              backgroundColor: bg,
              borderRadius: 4,
            },
          ],
        },
        options: {
          indexAxis: 'y',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const i = ctx.dataIndex;
                  const row = natRows[i];
                  const n = dashboardMetricValue(row);
                  const rev = Number(row?.revenue || 0);
                  const isSel = highlightName && String(row?.region || '').trim() === highlightName;
                  return ` ${dashboardMetricTooltipValue(n)} · 报价 ${fmtMoney(rev)}${isSel ? ' · 左侧主区域' : ''}`;
                },
                footer: () => '对比=全国时展示各区域；深紫=左侧所选区域 · 点击深紫条：城市下钻',
              },
            },
          },
          scales: {
            x: { beginAtZero: true, ticks: { color: sec, callback: (v) => dashboardMetricTick(v) } },
            y: { ticks: { color: sec, font: { size: 11 } }, grid: { display: false } },
          },
          onClick: (evt, elements) => {
            if (!elements || !elements.length) return;
            const idx = elements[0].index;
            const row = natRows[idx];
            const name = String(row?.region || '').trim();
            if (highlightName && name === highlightName) {
              dashboardDrillRegion = dashboardDrillRegion === name ? null : name;
              renderDashboard();
            }
          },
        },
      });
      return;
    }

    const pl = compare.region || regionShare.region || '主口径';
    const cl = compare.compareLabel || '对比';
    const rc = dashboardChartMetric === 'revenue'
      ? (data || []).reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0)
      : Number(compare.primaryTotalCount ?? regionShare.regionCount ?? 0);
    const cc = dashboardChartMetric === 'revenue'
      ? ((compare.nationalActivityByRegion || []).reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0))
      : Number(compare.compareTotalCount ?? regionShare.compareCount ?? 0);
    charts.region = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [pl, cl],
        datasets: [
          {
            label: dashboardMetricText(),
            data: [rc, cc],
            backgroundColor: [DASHBOARD_COMPARE_COLOR_REGION, DASHBOARD_COMPARE_COLOR_NATIONAL],
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              footer: () => '点击左侧（深紫）条形：城市下钻（需左侧已选单一区域）',
            },
          },
        },
        scales: {
          x: { beginAtZero: true, ticks: { color: sec, callback: (v) => dashboardMetricTick(v) } },
          y: { ticks: { color: sec, font: { size: 11 } }, grid: { display: false } },
        },
        onClick: (evt, elements) => {
          if (!elements || !elements.length) return;
          const idx = elements[0].index;
          if (idx !== 0) return;
          const r = dashboardState.region;
          if (!r) return;
          dashboardDrillRegion = dashboardDrillRegion === r ? null : r;
          renderDashboard();
        },
      },
    });
    return;
  }

  const total = data.reduce((s, d) => s + dashboardMetricValue(d), 0);
  const labels = data.map((d) => {
    const c = dashboardMetricValue(d);
    const p = total > 0 ? ((c / total) * 100).toFixed(1) : '0.0';
    return `${d.region || '未知'} (${dashboardMetricTooltipValue(c)} / ${p}%)`;
  });
  const bg = ['#7c6af7', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee'];
  const drill = dashboardDrillRegion;
  const backgroundColor = data.map((d, i) => {
    const r = d.region || '';
    if (drill && r === drill) return bg[i % bg.length];
    if (drill) return withAlphaHex(bg[i % bg.length], 0.35);
    return bg[i % bg.length];
  });
  charts.region = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: data.map((d) => dashboardMetricValue(d)),
        backgroundColor,
        borderWidth: 0,
        hoverOffset: 6,
      }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { color: sec, padding: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            footer: () => '点击扇区：城市下钻 / 再点同一扇区关闭',
          },
        },
      },
      cutout: '60%',
      onClick: (evt, elements) => {
        if (!elements || !elements.length) return;
        const i = elements[0].index;
        const row = data[i];
        if (!row) return;
        const r = row.region || '';
        dashboardDrillRegion = dashboardDrillRegion === r ? null : r;
        renderDashboard();
      },
    },
  });
}

function withAlphaHex(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `#${h}${a.toString(16).padStart(2, '0')}`;
}
