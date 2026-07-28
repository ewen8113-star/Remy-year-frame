function materialDashboardSectionHtml(detailRowsFY, fy) {
  materialDashboardState.detailRowsFY = detailRowsFY || [];
  materialDashboardState.fy = fy || currentFiscalYearRange();
  const open = !!materialDashboardState.open;
  const fyLabel = materialDashboardState.fy.label;
  const totalRows = (detailRowsFY || []).length;
  const totalAmount = roundMoney2((detailRowsFY || []).reduce((s, x) => s + roundMoney2(x.subtotal), 0));
  return `
    <div class="card mp-dash-card" id="mpDashCard" style="margin-bottom:16px">
      <div class="card-header mp-dash-header" onclick="materialDashboardToggle()" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="card-title" style="display:flex;align-items:center;gap:8px">
            <i data-lucide="line-chart" style="width:16px;height:16px"></i>
            成本分析
          </div>
          <span class="badge badge-gray" title="${escapeHtml(materialDashboardState.fy.fullLabel || fyLabel)}">${escapeHtml(fyLabel)}</span>
          <span style="color:var(--text-muted);font-size:12px">${totalRows} 条明细 · 合计 ${fmtMoney(totalAmount)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;color:var(--text-secondary);font-size:13px">
          <span>${open ? '收起' : '展开'}</span>
          <i data-lucide="${open ? 'chevron-up' : 'chevron-down'}" style="width:14px;height:14px"></i>
        </div>
      </div>
      <div class="card-body mp-dash-body" id="mpDashBody" style="display:${open ? 'block' : 'none'};padding:14px"></div>
    </div>
  `;
}

function materialDashboardToggle() {
  materialDashboardState.open = !materialDashboardState.open;
  const body = document.getElementById('mpDashBody');
  if (body) body.style.display = materialDashboardState.open ? 'block' : 'none';
  const card = document.getElementById('mpDashCard');
  if (card) {
    const chev = card.querySelector('.mp-dash-header [data-lucide]');
    if (chev) {
      chev.setAttribute('data-lucide', materialDashboardState.open ? 'chevron-up' : 'chevron-down');
      const span = chev.parentElement.querySelector('span');
      if (span) span.textContent = materialDashboardState.open ? '收起' : '展开';
      renderLucideIcons();
    }
  }
  if (materialDashboardState.open) materialDashboardRender();
}

function materialDashboardMount(detailRowsFY, fy) {
  materialDashboardState.detailRowsFY = detailRowsFY || [];
  materialDashboardState.fy = fy || currentFiscalYearRange();
  if (materialDashboardState.open) materialDashboardRender();
}

function materialDashboardOnKeywordInput(v) {
  materialDashboardState.keyword = String(v || '');
  // 防抖：250ms 内合并多次输入
  clearTimeout(materialDashboardOnKeywordInput._t);
  materialDashboardOnKeywordInput._t = setTimeout(() => {
    materialDashboardRender({ preserveFocus: true });
  }, 220);
}

function materialDashboardClearKeyword() {
  materialDashboardState.keyword = '';
  materialDashboardRender();
}

function materialDashboardSetBrand(v) {
  materialDashboardState.brand = v || '';
  materialDashboardRender();
}

function materialDashboardSetCategory(v) {
  materialDashboardState.category = v || '';
  materialDashboardRender();
}

function materialDashboardSetTopLimit(v) {
  materialDashboardState.topLimit = Number(v) || 10;
  materialDashboardRender();
}

function materialDashboardCurrentDetailRows() {
  const { detailRowsFY, brand, category } = materialDashboardState;
  return (detailRowsFY || []).filter((d) => {
    if (brand && d.brandBucket !== brand) return false;
    if (category && d.category !== category) return false;
    return true;
  });
}

function materialDashboardRender(opts = {}) {
  const body = document.getElementById('mpDashBody');
  if (!body) return;
  const state = materialDashboardState;
  const filtered = materialDashboardCurrentDetailRows();
  const data = aggregateMaterialDashboardData(filtered, state.keyword);
  const fy = state.fy || currentFiscalYearRange();
  const kw = state.keyword.trim();

  const overview = data.overview;
  const overviewCards = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:12px">
      <div class="stat-card" style="min-height:96px">
        <div class="stat-label">${kw ? `命中"${escapeHtml(kw)}"金额` : '财年总金额'}</div>
        <div class="stat-value sm">${fmtMoney(overview.matchedAmount)}</div>
        <div class="stat-sub">${overview.matchedCount} 条明细 · ${overview.distinctReimb} 张报销</div>
      </div>
      <div class="stat-card" style="min-height:96px">
        <div class="stat-label">${kw ? '命中数量合计' : '财年明细数量合计'}</div>
        <div class="stat-value sm">${fmtNumber(overview.matchedQty || 0)}</div>
        <div class="stat-sub">数量字段累计</div>
      </div>
      <div class="stat-card" style="min-height:96px">
        <div class="stat-label">${kw ? '占财年总金额比' : '财年合计'}</div>
        <div class="stat-value sm">${overview.totalAmount > 0 ? formatPercent(overview.matchedAmount / overview.totalAmount) : '—'}</div>
        <div class="stat-sub">${fmtMoney(overview.totalAmount)} · ${overview.totalCount} 条</div>
      </div>
    </div>
  `;

  // 类别选项（从财年明细动态生成，按 block 在常量数组中的顺序排序）
  const blockOrder = new Map(REIMB_DETAIL_BLOCKS.map((b, i) => [b.value, i]));
  const categorySet = new Map();
  (state.detailRowsFY || []).forEach((d) => {
    if (!categorySet.has(d.category)) categorySet.set(d.category, { label: d.categoryLabel, block: d.block });
  });
  const categoryEntries = Array.from(categorySet.entries()).sort((a, b) => {
    const oa = blockOrder.has(a[1].block) ? blockOrder.get(a[1].block) : 99;
    const ob = blockOrder.has(b[1].block) ? blockOrder.get(b[1].block) : 99;
    if (oa !== ob) return oa - ob;
    return String(a[1].label).localeCompare(String(b[1].label), 'zh-CN');
  });
  const categoryOpts = categoryEntries
    .map(([v, info]) => `<option value="${escapeHtml(v)}" ${state.category === v ? 'selected' : ''}>${escapeHtml(info.label)}</option>`)
    .join('');
  const brandOpts = MATERIAL_BRAND_BUCKETS
    .map((b) => `<option value="${escapeHtml(b)}" ${state.brand === b ? 'selected' : ''}>${escapeHtml(b)}</option>`)
    .join('');

  const filterBar = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
      <div style="position:relative;flex:1 1 240px;min-width:200px">
        <i data-lucide="search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text-muted)"></i>
        <input id="mpDashSearch" class="filter-select" placeholder="按物料/项目名称检索，如：腰果、印刷、快递..."
               value="${escapeHtml(kw)}" oninput="materialDashboardOnKeywordInput(this.value)"
               style="padding-left:30px;width:100%" />
        ${kw ? `<button class="btn btn-ghost btn-sm" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);padding:4px 8px" onclick="materialDashboardClearKeyword()">清除</button>` : ''}
      </div>
      <select class="filter-select" onchange="materialDashboardSetBrand(this.value)">
        <option value="">全部品牌桶</option>${brandOpts}
      </select>
      <select class="filter-select" onchange="materialDashboardSetCategory(this.value)">
        <option value="">全部类别</option>${categoryOpts}
      </select>
      <select class="filter-select" onchange="materialDashboardSetTopLimit(this.value)">
        ${[5, 10, 20, 50].map((n) => `<option value="${n}" ${state.topLimit === n ? 'selected' : ''}>Top ${n}</option>`).join('')}
      </select>
    </div>
  `;

  const monthsList = fy.monthsList();
  const monthData = monthsList.map((m) => roundMoney2(data.byMonth.get(m) || 0));
  const brandBadgeClass = (bucket) => ({
    PHD: 'badge-accent',
    'X.O': 'badge-warning',
    CLUB: 'badge-blue',
    RC: 'badge-success',
    '其他': 'badge-gray',
  }[bucket] || 'badge-gray');
  const brandTableRows = data.byBrand
    .map(
      (b) => `<tr>
        <td><span class="badge ${brandBadgeClass(b.bucket)}">${escapeHtml(b.bucket)}</span></td>
        <td style="text-align:right" class="amount">${fmtMoney(b.amount)}</td>
        <td style="text-align:right;color:var(--text-secondary)">${b.count}</td>
      </tr>`
    )
    .join('');
  const categoryTableRows = data.byCategory.length
    ? data.byCategory
        .map(
          (c) => `<tr>
            <td>${escapeHtml(c.label)}</td>
            <td style="text-align:right" class="amount">${fmtMoney(c.amount)}</td>
            <td style="text-align:right;color:var(--text-secondary)">${c.count}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:14px">暂无数据</td></tr>';

  const topItems = data.topItems.slice(0, state.topLimit);
  const topRows = topItems.length
    ? topItems
        .map(
          (t, i) => `<tr>
            <td style="color:var(--text-muted);width:32px">${i + 1}</td>
            <td>${escapeHtml(t.name)}</td>
            <td style="text-align:right" class="amount">${fmtMoney(t.amount)}</td>
            <td style="text-align:right;color:var(--text-secondary)">${fmtNumber(t.qty || 0)}</td>
            <td style="text-align:right;color:var(--text-secondary)">${t.count}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:14px">暂无命中</td></tr>';

  const hits = kw ? data.matched.slice(0, 50) : [];
  const hitsBlock = kw
    ? `
    <div class="card" style="margin-top:12px">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <div class="card-title">命中明细（前 50 条）</div>
        <div style="color:var(--text-muted);font-size:12px">关键字："${escapeHtml(kw)}" · 共 ${data.matched.length} 条</div>
      </div>
      <div class="card-body" style="padding:0">
        <div class="table-wrapper mp-hits-scroll">
          <table class="mp-hits-table">
            <thead><tr><th>日期</th><th>报销#</th><th>品牌</th><th>类别</th><th>项目名称</th><th style="text-align:right">数量</th><th style="text-align:right">单价</th><th style="text-align:right">小计</th></tr></thead>
            <tbody>${hits.map((h) => `<tr style="cursor:pointer" onclick="reimbursementOpenDetailModal(${h.reimbId})">
              <td>${escapeHtml(h.reimbDate)}</td>
              <td>#${escapeHtml(h.reimbId)}</td>
              <td><span class="badge ${brandBadgeClass(h.brandBucket)}">${escapeHtml(h.brandBucket)}</span></td>
              <td>${escapeHtml(h.categoryLabel)}</td>
              <td title="${escapeHtml(h.description || '')}">${escapeHtml(h.description || '—')}</td>
              <td style="text-align:right">${fmtNumber(h.quantity || 0)}</td>
              <td style="text-align:right">${fmtMoney(h.unitPrice)}</td>
              <td style="text-align:right" class="amount">${fmtMoney(h.subtotal)}</td>
            </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:14px">无命中</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`
    : '';

  body.innerHTML = `
    ${filterBar}
    ${overviewCards}
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-bottom:12px">
      <div class="card mp-dash-chart">
        <div class="card-header"><div class="card-title">月度走势（财年）</div></div>
        <div class="card-body" style="padding:10px 12px"><div style="position:relative;height:240px"><canvas id="chartMpMonth"></canvas></div></div>
      </div>
      <div class="card mp-dash-chart">
        <div class="card-header"><div class="card-title">品牌占比</div></div>
        <div class="card-body" style="padding:10px 12px"><div style="position:relative;height:240px"><canvas id="chartMpBrand"></canvas></div></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="card">
        <div class="card-header"><div class="card-title">品牌明细（明细行级）</div></div>
        <div class="card-body" style="padding:0">
          <div class="table-wrapper"><table>
            <thead><tr><th>品牌桶</th><th style="text-align:right">金额</th><th style="text-align:right">明细数</th></tr></thead>
            <tbody>${brandTableRows}</tbody>
          </table></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">类别分布</div></div>
        <div class="card-body" style="padding:0">
          <div class="table-wrapper"><table>
            <thead><tr><th>类别</th><th style="text-align:right">金额</th><th style="text-align:right">明细数</th></tr></thead>
            <tbody>${categoryTableRows}</tbody>
          </table></div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <div class="card-title">成本明细 Top ${state.topLimit}${kw ? `（含"${escapeHtml(kw)}"）` : ''}</div>
        <div style="color:var(--text-muted);font-size:12px">按金额降序，按项目名称聚合</div>
      </div>
      <div class="card-body" style="padding:0">
        <div class="table-wrapper"><table>
          <thead><tr><th style="width:32px">#</th><th>项目名称</th><th style="text-align:right">金额</th><th style="text-align:right">数量</th><th style="text-align:right">出现次数</th></tr></thead>
          <tbody>${topRows}</tbody>
        </table></div>
      </div>
    </div>
    ${hitsBlock}
  `;

  renderLucideIcons();
  materialDashboardDrawCharts(monthsList, monthData, data.byBrand);
  if (opts.preserveFocus) {
    const input = document.getElementById('mpDashSearch');
    if (input) {
      input.focus();
      const len = input.value.length;
      try { input.setSelectionRange(len, len); } catch (_) { /* ignore */ }
    }
  }
}
