/* 道具维修页面模块：从 app.js 机械迁移，保持原有展示和保存逻辑。 */

/* =============================================
   页面：道具维修（品牌 + 明细项目 + 报价/成本 + 付款状态）
   ============================================= */
function propRepairRowHtml(r) {
  const noCost = r.no_cost === true || r.no_cost === 1 || String(r.no_cost) === '1';
  const payee = String(r.payee_name || '').trim();
  return `<tr>
    <td>${r.id}</td>
    <td>${escapeHtml(fmtDate(r.repair_date))}</td>
    <td><span class="badge badge-accent">${escapeHtml(String(r.region || '—'))}</span></td>
    <td><span class="badge badge-${brandColor(r.brand_code || r.brand_name)}">${escapeHtml(r.brand_name || r.brand_code || '—')}</span></td>
    <td class="amount amount-revenue" style="text-align:right">${fmtMoney(r.quoted_price || 0)}</td>
    <td class="amount" style="text-align:right">${noCost ? '无成本' : fmtMoney(r.total_amount)}</td>
    <td>${payee ? escapeHtml(payee) : '—'}</td>
    <td>${paymentStatusHtml(r.payment_status, r.payment_order_id)}</td>
    <td onclick="event.stopPropagation()" style="white-space:nowrap">
      <button type="button" class="btn btn-secondary btn-sm" onclick="showPropRepairModal(${r.id})">编辑</button>
      <button type="button" class="btn btn-danger btn-sm" onclick="deletePropRepairRecord(${r.id})">删除</button>
    </td>
  </tr>`;
}

function propRepairSetBrandFilter(v) {
  propRepairPageState.filterBrandId = v || '';
  renderPropRepairs();
}

function collectPropRepairItemsFromForm() {
  const out = [];
  document.querySelectorAll('.pr-custom-row').forEach((row) => {
    const nm = row.querySelector('.pr-custom-name')?.value?.trim();
    const am = roundMoney2(row.querySelector('.pr-custom-amt')?.value);
    if (nm && am > 0) out.push({ name: nm, amount: am });
  });
  return out;
}

function updatePrTotal() {
  const noCost = !!document.getElementById('prNoCost')?.checked;
  const rows = document.querySelectorAll('.pr-custom-row .pr-custom-amt');
  rows.forEach((el) => {
    el.disabled = noCost;
    if (noCost) el.value = '';
  });
  const t = noCost
    ? 0
    : roundMoney2(collectPropRepairItemsFromForm().reduce((s, x) => s + roundMoney2(x.amount), 0));
  const el = document.getElementById('prTotalDisplay');
  if (el) el.textContent = noCost ? '无成本' : fmtMoney(t);
}

function propRepairAppendCustomRow(name = '', amount = '') {
  const wrap = document.getElementById('prCustomRows');
  if (!wrap) return;
  const div = document.createElement('div');
  div.className = 'form-group pr-custom-row';
  div.style.cssText = 'display:grid;grid-template-columns:1fr 120px 52px;gap:8px;align-items:center;margin-bottom:8px';
  div.innerHTML = `
    <input type="text" class="form-control pr-custom-name" placeholder="项目名称" value="${escapeHtml(name)}">
    <input type="number" class="form-control pr-custom-amt" step="0.01" min="0" placeholder="0.00" value="${amount}" oninput="updatePrTotal()">
    <button type="button" class="btn btn-secondary btn-sm" onclick="this.closest('.pr-custom-row').remove();updatePrTotal()">删</button>
  `;
  wrap.appendChild(div);
}

async function renderPropRepairs() {
  const container = document.getElementById('pageContainer');
  container.innerHTML = '<div style="text-align:center;padding:36px;color:var(--text-muted)">加载中...</div>';
  try {
    const yf = currentYearFrameId || '';
    const qs = new URLSearchParams();
    if (yf) qs.set('yearFrameId', String(yf));
    if (propRepairPageState.filterBrandId) qs.set('brandId', propRepairPageState.filterBrandId);
    const qStr = qs.toString();
    const yfOnlyQs = new URLSearchParams();
    if (yf) yfOnlyQs.set('yearFrameId', String(yf));
    const yfOnlyStr = yfOnlyQs.toString();

    const [rows, rowsAllYear, brands] = await Promise.all([
      api('GET', `/prop-repairs${qStr ? `?${qStr}` : ''}`),
      api('GET', `/prop-repairs${yfOnlyStr ? `?${yfOnlyStr}` : ''}`),
      api('GET', '/brand?active=true'),
    ]);

    const brandOpts = (brands || [])
      .map(
        (b) =>
          `<option value="${b.id}" ${String(propRepairPageState.filterBrandId) === String(b.id) ? 'selected' : ''}>${escapeHtml(b.brand_name || b.brand_code)}</option>`
      )
      .join('');

    const quotedTotals = {};
    const costTotals = {};
    const counts = {};
    (rowsAllYear || []).forEach((r) => {
      const key = String(r.brand_name || r.brand_code || '未知品牌');
      const noCost = r.no_cost === true || r.no_cost === 1 || String(r.no_cost) === '1';
      const quoted = roundMoney2(r.quoted_price);
      const cost = noCost ? 0 : roundMoney2(r.total_amount);
      quotedTotals[key] = roundMoney2((quotedTotals[key] || 0) + quoted);
      costTotals[key] = roundMoney2((costTotals[key] || 0) + cost);
      counts[key] = (counts[key] || 0) + 1;
    });
    const grandQuoted = roundMoney2(Object.values(quotedTotals).reduce((s, v) => s + roundMoney2(v), 0));
    const grandCost = roundMoney2(Object.values(costTotals).reduce((s, v) => s + roundMoney2(v), 0));

    const brandCardsHtml = Object.keys(quotedTotals)
      .sort((a, b) => quotedTotals[b] - quotedTotals[a])
      .map(
        (name) => `
      <div class="stat-card blue" style="min-height:120px">
        <div class="stat-icon"><i data-lucide="wrench" style="width:16px;height:16px"></i></div>
        <div class="stat-label">${escapeHtml(name)}</div>
        <div class="stat-value sm">${fmtMoney(quotedTotals[name] || 0)}</div>
        <div class="stat-sub">${counts[name] || 0} 笔 · 维修费 ${fmtMoney(costTotals[name] || 0)}</div>
      </div>`
      )
      .join('');

    const listRows = rows || [];
    const listBody = listRows.length
      ? listRows.map((r) => propRepairRowHtml(r)).join('')
      : '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px">暂无记录</td></tr>';

    container.innerHTML = `
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card accent">
          <div class="stat-label">道具维修报价合计（当前年框）</div>
          <div class="stat-value sm">${fmtMoney(grandQuoted)}</div>
          <div class="stat-sub">维修费合计 ${fmtMoney(grandCost)} · 与下方筛选无关</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-bottom:16px">
        ${brandCardsHtml || '<div class="card"><div class="card-body" style="color:var(--text-muted)">暂无品牌分布数据</div></div>'}
      </div>
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div class="card-title">维修登记记录</div>
            <div class="card-sub">明细金额自动汇总为维修成本（成本）；对公付款生成后状态为已支付</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select class="filter-select" id="prListBrandFilter" onchange="propRepairSetBrandFilter(this.value)">
              <option value="">全部品牌</option>${brandOpts}
            </select>
            <button type="button" class="btn btn-primary btn-sm" onclick="showPropRepairModal(null)">+ 新建登记</button>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>ID</th><th>日期</th><th>区域</th><th>品牌</th><th style="text-align:right">报价</th><th style="text-align:right">成本</th><th>收款方</th><th>付款状态</th><th>操作</th></tr></thead>
              <tbody>${listBody}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    renderLucideIcons();
    applyRoleUiGuards();
  } catch (e) {
    const msg = String(e.message || '');
    container.innerHTML = `<div class="card"><div class="card-body empty-state">
      <div class="empty-title">加载失败</div>
      <div class="empty-sub">${escapeHtml(msg)}</div>
      <p style="margin-top:10px;font-size:13px;color:var(--text-muted)">若为数据库表不存在，请执行：<code style="font-size:12px">npm run migrate:prop-repairs</code> 后重启服务。</p>
    </div></div>`;
    renderLucideIcons();
  }
}
