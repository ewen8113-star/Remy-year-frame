function materialDashboardDrawCharts(monthsList, monthData, byBrand) {
  if (charts.mpMonth) { try { charts.mpMonth.destroy(); } catch (_) {} charts.mpMonth = null; }
  if (charts.mpBrand) { try { charts.mpBrand.destroy(); } catch (_) {} charts.mpBrand = null; }
  const monthCtx = document.getElementById('chartMpMonth');
  const brandCtx = document.getElementById('chartMpBrand');
  const sec = (typeof getComputedStyle === 'function')
    ? (getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#64748b')
    : '#64748b';
  if (monthCtx && typeof Chart !== 'undefined') {
    charts.mpMonth = new Chart(monthCtx, {
      type: 'bar',
      data: {
        labels: monthsList.map((m) => m.slice(5) + '月'),
        datasets: [{ label: '金额', data: monthData, backgroundColor: '#3b82f6', borderRadius: 6 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => fmtMoney(c.raw || 0) } },
        },
        scales: {
          x: { ticks: { color: sec }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: sec, callback: (v) => fmtMoney(v || 0) } },
        },
      },
    });
  }
  if (brandCtx && typeof Chart !== 'undefined') {
    const colors = { PHD: '#a855f7', 'X.O': '#f59e0b', CLUB: '#3b82f6', RC: '#10b981', '其他': '#94a3b8' };
    const nonZero = byBrand.filter((b) => b.amount > 0);
    const labels = nonZero.length ? nonZero.map((b) => b.bucket) : ['无数据'];
    const values = nonZero.length ? nonZero.map((b) => b.amount) : [1];
    const bg = nonZero.length ? nonZero.map((b) => colors[b.bucket] || '#94a3b8') : ['#e5e7eb'];
    charts.mpBrand = new Chart(brandCtx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: bg, borderWidth: 0, hoverOffset: 6 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: sec, font: { size: 12 } } },
          tooltip: { callbacks: { label: (c) => `${c.label} · ${fmtMoney(c.raw || 0)}` } },
        },
        cutout: '55%',
      },
    });
  }
}

function sortMaterialPurchaseRows(rows) {
  return (rows || []).slice().sort((a, b) => {
    const at = new Date(a.purchase_date || 0).getTime() || 0;
    const bt = new Date(b.purchase_date || 0).getTime() || 0;
    if (bt !== at) return bt - at;
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

const MATERIAL_FIXED_ITEM_NAMES = [
  '奶酪',
  '巧克力',
  '糖渍橙皮丁',
  '芒果',
  '桂皮',
  '茉莉花',
  '西梅',
  '杏脯',
  '巴达木',
  '腰果',
  '九制陈皮',
  '香草荚',
];

function materialPurchaseRowHtml(r) {
  const rem = r.remarks ? String(r.remarks).slice(0, 48) + (String(r.remarks).length > 48 ? '…' : '') : '—';
  const merged = isMergedFlag(r.merged_into_activity);
  const isReimbursement = r.source_type === 'reimbursement';
  // 行点击 → 详情弹窗：reimbursement 派生走付款申请详情，直接登记走物料采购详情
  const openCall = isReimbursement
    ? `reimbursementOpenDetailModal(${r.id})`
    : `materialPurchaseOpenDetailModal(${r.id})`;
  return `<tr class="mp-list-row" style="cursor:pointer" onclick="${openCall}">
    <td>${isReimbursement ? `报销#${escapeHtml(r.id)}` : escapeHtml(r.id)}</td>
    <td>${escapeHtml(fmtDate(r.purchase_date))}</td>
    <td><span class="badge badge-${brandColor(r.brand_code || r.brand_name)}">${escapeHtml(r.brand_name || r.brand_code || '—')}</span></td>
    <td class="amount" style="text-align:right">${fmtMoney(r.total_amount)}</td>
    <td>${listActivityProjectHtml(r)}</td>
    <td>${listAllocationNoteHtml(r.allocation_note)}</td>
    <td>${merged ? '<span class="badge badge-success">已计入</span>' : '<span class="badge badge-gray">未计入</span>'}</td>
    <td>${paymentStatusHtml(r.payment_status, r.payment_order_id)}</td>
    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--text-secondary)" title="${escapeHtml(r.remarks || '')}">${escapeHtml(rem)}</td>
  </tr>`;
}

function materialSetBrandFilter(v) {
  materialPageState.filterBrandId = v || '';
  renderMaterialPurchases();
}

function materialSetMergeFilter(v) {
  materialPageState.mergeFilter = v || 'all';
  renderMaterialPurchases();
}

async function renderMaterialPurchases() {
  const container = document.getElementById('pageContainer');
  container.innerHTML =
    '<div style="text-align:center;padding:36px;color:var(--text-muted)">加载中...</div>';
  try {
    const yf = currentYearFrameId || '';
    const qs = new URLSearchParams();
    if (yf) qs.set('yearFrameId', String(yf));
    if (materialPageState.filterBrandId) qs.set('brandId', materialPageState.filterBrandId);
    const qStr = qs.toString();
    const yfOnlyQs = new URLSearchParams();
    if (yf) yfOnlyQs.set('yearFrameId', String(yf));
    const yfOnlyStr = yfOnlyQs.toString();

    const [rows, rowsAllYear, brands, reimbursementRows] = await Promise.all([
      api('GET', `/material-purchases${qStr ? `?${qStr}` : ''}`),
      api('GET', `/material-purchases${yfOnlyStr ? `?${yfOnlyStr}` : ''}`),
      api('GET', '/brand?active=true'),
      api('GET', `/reimbursements${yfOnlyStr ? `?${yfOnlyStr}` : ''}`),
    ]);

    const brandOpts = (brands || [])
      .map(
        (b) =>
          `<option value="${b.id}" ${String(materialPageState.filterBrandId) === String(b.id) ? 'selected' : ''}>${escapeHtml(b.brand_name || b.brand_code)}</option>`
      )
      .join('');

    const reimbursementMaterialRowsAllYear = materialPurchaseRowsFromReimbursements(reimbursementRows, brands);
    const reimbursementMaterialRowsForList = materialPurchaseRowsFromReimbursements(
      reimbursementRows,
      brands,
      materialPageState.filterBrandId
    );
    const listRows = sortMaterialPurchaseRows([...(rows || []), ...reimbursementMaterialRowsForList]);

    // 财年范围与方案B明细行（仪表盘 + 5桶卡共用）
    const fy = currentFiscalYearRange();
    const reimbDetailRowsFY = materialPurchaseDetailRowsFromReimbursements(reimbursementRows, { fiscalYear: fy });
    // 5桶卡：直接采购登记按整条 brand 归桶（限当前年框） + 报销明细行按 row brand 归桶（限当前财年）
    const bucketItems = [
      ...((rowsAllYear || []).map((r) => ({
        brandBucket: detectBrandBucket(r.brand_code, r.brand_name, r.brand),
        total_amount: r.total_amount,
      }))),
      ...reimbDetailRowsFY.map((d) => ({ brandBucket: d.brandBucket, subtotal: d.subtotal })),
    ];
    const { totals: bt, counts: bc } = materialPurchaseAggFiveBuckets(bucketItems);
    const grandTotal = roundMoney2(Object.values(bt).reduce((s, v) => s + roundMoney2(v), 0));

    const bucketDefs = [
      { key: 'PHD', title: 'PHD', sub: '布赫拉迪 PHD', icon: 'flask-conical', card: 'stat-card accent' },
      { key: 'X.O', title: 'X.O', sub: '人头马 X.O / XO*', icon: 'wine', card: 'stat-card warning' },
      { key: 'CLUB', title: 'CLUB', sub: '人头马 CLUB*', icon: 'sparkles', card: 'stat-card blue' },
      { key: 'RC', title: 'RC', sub: '特级干邑 RC / Remy', icon: 'orbit', card: 'stat-card success' },
      { key: '其他', title: '其他', sub: '内部 / 未归类', icon: 'shapes', card: 'stat-card' },
    ];
    const bucketCardsHtml = bucketDefs
      .map(
        (d) => `
      <div class="${d.card}" style="min-height:120px">
        <div class="stat-icon">${materialBrandBucketIconHtml(d.key, d.icon)}</div>
        <div class="stat-label">${d.title}</div>
        <div class="stat-value sm">${fmtMoney(bt[d.key] || 0)}</div>
        <div class="stat-sub">${bc[d.key] || 0} 笔 · ${escapeHtml(d.sub)}</div>
      </div>`
      )
      .join('');

    const listBody = listRows.length
      ? listRows.map((r) => materialPurchaseRowHtml(r)).join('')
      : '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px">暂无记录</td></tr>';

    container.innerHTML = `
      <div class="mp-page-banner" style="margin-bottom:12px;padding:10px 14px;border-radius:10px;background:var(--bg-input);color:var(--text-secondary);font-size:13px;display:flex;align-items:center;gap:8px">
        <i data-lucide="info" style="width:14px;height:14px"></i>
        统筹成本：不计入具体场次的成本统计（物料采购 / 物流 / 道具维修 / 统筹支出等，按"成本归属 ≠ 活动成本"的报销与直接登记汇总）
      </div>
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card accent">
          <div class="stat-label">统筹成本合计（当前年框）</div>
          <div class="stat-value sm">${fmtMoney(grandTotal)}</div>
          <div class="stat-sub">直接登记 + 不计入活动的报销明细（明细级品牌归桶）</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:16px">
        ${bucketCardsHtml}
      </div>
      ${materialDashboardSectionHtml(reimbDetailRowsFY, fy)}
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div class="card-title">成本记录</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select class="filter-select" id="mpListBrandFilter" onchange="materialSetBrandFilter(this.value)">
              <option value="">全部品牌</option>${brandOpts}
            </select>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>ID</th><th>日期</th><th>品牌</th><th style="text-align:right">合计</th><th>关联项目</th><th>计入说明</th><th>计入状态</th><th>付款状态</th><th>备注</th></tr></thead>
              <tbody>${listBody}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    renderLucideIcons();
    applyRoleUiGuards();
    materialDashboardMount(reimbDetailRowsFY, fy);
  } catch (e) {
    const msg = String(e.message || '');
    const is404 = msg.includes('404');
    const hint404 =
      '<p style="margin-top:14px;font-size:13px;color:var(--text-muted)"><strong>接口 404</strong>：当前响应的 Node 进程<strong>没有注册</strong> <code>/api/material-purchases</code>，几乎都是因为<strong>仍在跑旧进程</strong>。请先 <code>lsof -i :3088</code>（或你的端口）找到旧 node 并结束进程，再在项目目录执行 <code>npm run start</code>。可打开 <code>/api/health</code> 查看 JSON 里 <code>features.materialPurchasesApi</code> 是否为 <code>true</code>。</p>';
    const hintDb =
      '<p style="margin-top:10px;font-size:13px;color:var(--text-muted)">若错误为数据库表不存在，请执行：<code style="font-size:12px">npm run migrate:material-purchases</code> 后再重启服务。</p>';
    container.innerHTML = `<div class="card"><div class="card-body empty-state">
      <div class="empty-title">加载失败</div>
      <div class="empty-sub">${escapeHtml(msg)}</div>
      ${is404 ? hint404 : hintDb}
    </div></div>`;
    renderLucideIcons();
  }
}
