async function loadWarehouse() {
  try {
    let qs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : '?';

    const data = await api('GET', `/warehouse${qs}`);
    warehouseState.data = data;
    const filteredData = (warehouseMergeFilter === 'merged')
      ? data.filter((w) => isMergedFlag(w.merged_into_activity))
      : (warehouseMergeFilter === 'unmerged')
        ? data.filter((w) => !isMergedFlag(w.merged_into_activity))
        : data;
    const sumEl = document.getElementById('warSummary');
    if (sumEl) {
      const REGION_META = [
        { key: '东区', label: '东区（上海）', tone: 'accent' },
        { key: '北区', label: '北区（天津）', tone: 'blue' },
        { key: '南区', label: '南区（广州）', tone: 'warning' },
      ];

      const TAX_RATE = 0.06; // 报价含税 6%
      const taxDiv = 1 + TAX_RATE;
      const costRowsOnly = filteredData.filter((w) => !warehouseIsQuoteRecord(w));
      const totalQuotedAll = costRowsOnly.reduce(
        (s, w) => s + warehouseClientQuotedPrice(w, filteredData),
        0,
      );
      const totalCostAll = filteredData.reduce((s, w) => s + (parseFloat(w.actual_cost) || 0), 0);
      const rowsByRegion = new Map(REGION_META.map((r) => [r.key, []]));
      costRowsOnly.forEach((w) => {
        const r = normalizeWarehouseRegion(w.region);
        if (rowsByRegion.has(r)) rowsByRegion.get(r).push(w);
      });

      const calc = (rows) => {
        const quoted = rows.reduce((s, w) => s + warehouseClientQuotedPrice(w, filteredData), 0);
        const cost = rows.reduce((s, w) => s + (parseFloat(w.actual_cost) || 0), 0);
        const profit = quoted / taxDiv - cost;
        return { quoted, cost, profit };
      };

      sumEl.innerHTML = `
        <div class="warehouse-summary-grid">
          <div class="stat-card success">
            <div class="stat-icon"><i data-lucide="receipt" style="width:16px;height:16px"></i></div>
            <div class="stat-label">仓储总报价（含税）</div>
            <div class="stat-value" style="margin-top:8px;font-variant-numeric:tabular-nums">${fmtMoney(totalQuotedAll)}</div>
            <div class="stat-sub">当前年框下列表全部记录合计</div>
          </div>
          <div class="stat-card warning">
            <div class="stat-icon"><i data-lucide="coins" style="width:16px;height:16px"></i></div>
            <div class="stat-label">仓储总成本</div>
            <div class="stat-value" style="margin-top:8px;font-variant-numeric:tabular-nums">${fmtMoney(totalCostAll)}</div>
            <div class="stat-sub">实际成本字段合计</div>
          </div>
          ${REGION_META.map((r) => {
            const rows = rowsByRegion.get(r.key) || [];
            const { quoted, cost, profit } = calc(rows);
            return `
              <div class="stat-card ${r.tone}">
                <div class="stat-icon"><i data-lucide="warehouse" style="width:16px;height:16px"></i></div>
                <div class="stat-label">${r.label}</div>
                <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
                  <div style="display:flex;justify-content:space-between;gap:10px">
                    <span style="font-size:12px;color:var(--text-secondary)">报价（含税）</span>
                    <span class="amount amount-revenue" style="font-weight:700">${fmtMoney(quoted)}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;gap:10px">
                    <span style="font-size:12px;color:var(--text-secondary)">成本</span>
                    <span class="amount ${cost > 0 ? 'amount-cost' : 'amount-neutral'}" style="font-weight:700">${fmtMoney(cost)}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;gap:10px">
                    <span style="font-size:12px;color:var(--text-secondary)">利润（不含税）</span>
                    <span class="amount ${profit >= 0 ? 'amount-revenue' : 'amount-cost'}" style="font-weight:800">${fmtMoney(profit)}</span>
                  </div>
                </div>
                <div class="stat-sub">利润 = 报价 ÷ 1.06 − 成本</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const tableEl = document.getElementById('warTable');
    if (tableEl) {
      tableEl.innerHTML = `
        <div class="warehouse-table-card">
          <div class="warehouse-table-head">
            <div>
              <div class="warehouse-table-title">仓储成本记录</div>
              <div class="warehouse-table-sub">固定成本、报价记录与付款状态</div>
            </div>
            <span class="badge badge-gray">${filteredData.length} 条</span>
          </div>
        <div class="table-wrapper warehouse-table-scroll act-table-scroll-wrap">
          <table class="data-table act-table-sticky-head warehouse-cost-table">
            <thead><tr>
              <th>财年</th>
              <th>月份</th>
              <th>品牌</th>
              <th>区域</th>
              <th>数量</th>
              <th>单价</th>
              <th>报价</th>
              <th>实际成本</th>
              <th>付款状态</th>
              <th>操作</th>
            </tr></thead>
            <tbody>
              ${filteredData.length ? filteredData.map(w => {
                const { qty: qtySafe, unit: qtyUnit } = warehouseQuantityDisplay(w);
                const upNum = parseFloat(w.unit_price);
                const hasUnitPrice = w.unit_price != null && w.unit_price !== '' && Number.isFinite(upNum);
                const isQuote = warehouseIsQuoteRecord(w);
                const clientQuoted = warehouseClientQuotedPrice(w, filteredData);
                const wid = Number(w.id);
                return `
                <tr>
                  <td><span class="badge badge-gray" style="font-weight:600">${escapeHtml(yearFrameDisplayLabel({ year: w.year_frame_name, id: w.year_frame_id }))}</span></td>
                  <td>${escapeHtml(w.month || '—')}</td>
                  <td><span class="badge badge-gray">${escapeHtml((w.brand != null && String(w.brand).trim() !== '' ? String(w.brand).trim() : 'PHD'))}</span></td>
                  <td><span class="badge badge-accent">${(() => { const r = normalizeWarehouseRegion(w.region); return r ? escapeHtml(r) : '—'; })()}</span></td>
                  <td>${qtySafe}<span style="font-size:11px;color:var(--text-muted);margin-left:3px">${escapeHtml(qtyUnit)}</span></td>
                  <td>${hasUnitPrice ? fmtMoney(upNum) : '—'}</td>
                  <td class="amount amount-revenue">${isQuote ? fmtMoney(clientQuoted) : (clientQuoted > 0 ? fmtMoney(clientQuoted) : '—')}</td>
                  <td class="amount ${w.no_actual_cost ? 'amount-neutral' : (parseFloat(w.actual_cost)>0?'amount-cost':'amount-neutral')}">${w.no_actual_cost ? '无' : (parseFloat(w.actual_cost)>0?fmtMoney(w.actual_cost):'—')}</td>
                  <td>${paymentStatusHtml(w.payment_status, w.payment_order_id)}</td>
                  <td>
                    <div style="display:flex;gap:4px">
                      <button class="btn btn-secondary btn-sm" onclick="showWarehouseModal(${w.id})">编辑</button>
                      <button class="btn btn-danger btn-sm" onclick="deleteWarehouse(${w.id})">删</button>
                    </div>
                  </td>
                </tr>
              `;
              }).join('') : '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:30px">暂无数据</td></tr>'}
            </tbody>
          </table>
        </div>
        </div>
      `;
    }
    void updateBadges();
    renderLucideIcons();
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

function setWarehouseMergeFilter(v) {
  warehouseMergeFilter = v || 'all';
  loadWarehouse();
}

function warehouseFiscalMonths() {
  const yy = parseInt(String(currentYear || '').match(/\d{2}/)?.[0] || '26', 10);
  const startYear = 2000 + yy;
  const out = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(Date.UTC(startYear, 3 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function daysInMonthValue(monthValue) {
  const [y, m] = String(monthValue || '').split('-').map((x) => parseInt(x, 10));
  if (!y || !m) return 0;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function warehouseFixedCostPreviewRows() {
  const region = document.getElementById('warFixedRegion')?.value || '北区';
  const monthChecks = Array.from(document.querySelectorAll('.war-fixed-month:checked')).map((x) => x.value);
  return monthChecks.map((month) => {
    const days = daysInMonthValue(month);
    const amount = region === '北区' ? roundMoney2(days * 100) : 5600;
    return { region, month, days, amount };
  });
}

function updateWarehouseFixedCostPreview() {
  const rows = warehouseFixedCostPreviewRows();
  const total = roundMoney2(rows.reduce((s, r) => s + r.amount, 0));
  const el = document.getElementById('warFixedPreview');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="color:var(--text-secondary);font-size:13px">将生成 ${rows.length} 条记录</span>
      <span class="amount" style="font-weight:800">${fmtMoney(total)}</span>
    </div>
    <div style="max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px">
      <table class="data-table">
        <thead><tr><th>区域</th><th>月份</th><th>计算</th><th style="text-align:right">成本</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.region)}</td><td>${escapeHtml(r.month)}</td><td>${r.region === '北区' ? `${r.days}天 x 100元` : '仓储+人工固定 5600元/月'}</td><td class="amount" style="text-align:right">${fmtMoney(r.amount)}</td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:14px">请选择月份</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function showWarehouseFixedCostModal() {
  const body = document.getElementById('warFixedCostBody');
  if (!body) return;
  const months = warehouseFiscalMonths();
  const monthHtml = months
    .map((m) => `<label style="display:flex;align-items:center;gap:6px;padding:8px;border:1px solid var(--border);border-radius:8px;cursor:pointer"><input type="checkbox" class="war-fixed-month" value="${m}" onchange="updateWarehouseFixedCostPreview()"> <span>${m}</span></label>`)
    .join('');
  body.innerHTML = `
    <div class="form-grid" style="grid-template-columns:1fr 1fr">
      <div class="form-group">
        <label class="form-label">财年</label>
        <input type="text" class="form-control" value="${escapeHtml(String(currentYear || '').padStart(2, '0'))}年度" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">区域</label>
        <select class="form-control" id="warFixedRegion" onchange="updateWarehouseFixedCostPreview()">
          <option value="北区">北区：按天 100 元</option>
          <option value="南区">南区：5600 元/月</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">品牌</label>
        <select class="form-control" id="warFixedBrand">
          ${WAREHOUSE_BRAND_OPTIONS.map((b) => `<option value="${b}" ${b === 'PHD' ? 'selected' : ''}>${b}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">收款方 <span class="required">*</span></label>
        <select class="form-control" id="warFixedPayee" onchange="supplierPayeeSelectChanged('warFixedPayee')">
          <option value="">请选择供应商</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">月份</label>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">${monthHtml}</div>
    </div>
    <div id="warFixedPreview"></div>
  `;
  openModal('modalWarehouseFixedCost');
  updateWarehouseFixedCostPreview();
  loadSupplierPayeeSelect('warFixedPayee', '');
}

async function saveWarehouseFixedCosts() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可保存', 'warning');
    return;
  }
  const payee = document.getElementById('warFixedPayee')?.value?.trim() || '';
  const brand = document.getElementById('warFixedBrand')?.value || 'PHD';
  const rows = warehouseFixedCostPreviewRows();
  if (!payee) {
    showToast('请选择收款方（供应商）', 'warning');
    return;
  }
  if (!rows.length) {
    showToast('请选择月份', 'warning');
    return;
  }
  const existing = new Set((warehouseState.data || []).map((w) => `${w.year_frame_id}:${normalizeWarehouseRegion(w.region)}:${w.month}`));
  const toCreate = rows.filter((r) => !existing.has(`${currentYearFrameId}:${r.region}:${r.month}`));
  if (!toCreate.length) {
    showToast('所选月份已存在同区域仓储记录，未生成重复记录', 'warning');
    return;
  }
  try {
    for (const r of toCreate) {
      await api('POST', '/warehouse', {
        year_frame_id: currentYearFrameId,
        month: r.month,
        brand,
        region: r.region,
        wine_name: '',
        specifications: r.region === '北区' ? '固定仓储费' : '固定仓储+人工',
        quantity: r.region === '北区' ? r.days : 1,
        unit_price: r.region === '北区' ? 100 : 5600,
        quoted_price: 0,
        actual_cost: r.amount,
        no_actual_cost: 0,
        payee_name: payee,
        remarks: r.region === '北区' ? `${r.month} 北区固定仓储费：${r.days}天 x 100元` : `${r.month} 南区固定仓储+人工：5600元/月`,
      });
    }
    const skipped = rows.length - toCreate.length;
    showToast(`已生成 ${toCreate.length} 条固定仓储成本${skipped ? `，跳过重复 ${skipped} 条` : ''}`, 'success');
    closeModal();
    await loadWarehouse();
  } catch (e) {
    showToast(e.message || '生成失败', 'error');
  }
}
