function paymentOrderRenderModal() {
  const body = document.getElementById('modalPaymentOrderBody');
  if (!body) return;
  const scrollState = {
    bodyTop: body.scrollTop,
    tableTop: body.querySelector('.payment-order-table-wrap')?.scrollTop ?? 0,
  };
  const filterVals = { ...(paymentOrderState.filters || {}) };
  ['payee', 'brand', 'sourceType', 'projectCode', 'expenseYm', 'dateFrom', 'dateTo'].forEach((id) => {
    const el = document.getElementById(`poFilter_${id}`);
    if (el) filterVals[id] = el.value || filterVals[id] || '';
  });
  const orderDateVal = document.getElementById('poOrderDate')?.value || todayDateInputValue();
  const remarksVal = document.getElementById('poRemarks')?.value || '';
  const rows = paymentOrderState.candidates || [];
  const selected = paymentOrderSelectedRows();
  const total = roundMoney2(selected.reduce((s, r) => s + roundMoney2(r.amount), 0));
  const previewRows = paymentOrderState.previewRows || [];
  const sourceOpts = [
    ['', '全部板块'],
    ['warehouse', '仓储'],
    ['logistics', '物流'],
    ['material_purchase', '物料采购'],
    ['prop_repair', '道具维修'],
    ['reimbursement', '成本登记'],
  ].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  body.innerHTML = `
    <div class="payment-order-wizard">
      <span class="payment-order-wizard-label">快捷筛选：</span>
      <button type="button" class="btn btn-secondary btn-xs" onclick="poQuickFilter('warehouse')">仓储</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="poQuickFilter('logistics')">物流</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="poQuickFilter('material_purchase')">物料采购</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="poQuickFilter('prop_repair')">道具维修</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="poQuickFilter('reimbursement')">成本登记</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="poQuickFilter('')">全部</button>
    </div>
    <div class="payment-order-filter-panel">
      <div class="payment-order-filter-grid payment-order-filter-grid--primary">
        <label class="po-filter-field">
          <span class="po-filter-label">收款方</span>
          <input class="form-control" id="poFilter_payee" placeholder="关键字" value="${escapeHtml(filterVals.payee || '')}" onkeydown="poFilterEnter(event)">
        </label>
        <label class="po-filter-field">
          <span class="po-filter-label">费用归属月</span>
          <input type="month" class="form-control" id="poFilter_expenseYm" value="${escapeHtml(filterVals.expenseYm || '')}" onchange="paymentOrderLoadCandidates()">
        </label>
        <label class="po-filter-field">
          <span class="po-filter-label">板块</span>
          <select class="form-control" id="poFilter_sourceType">${sourceOpts}</select>
        </label>
        <label class="po-filter-field">
          <span class="po-filter-label">品牌</span>
          <select class="form-control" id="poFilter_brand">
            <option value="">全部品牌</option>${FIXED_BRAND_CODES.map((b) => `<option value="${b}">${b}</option>`).join('')}
          </select>
        </label>
        <label class="po-filter-field">
          <span class="po-filter-label">项目编号</span>
          <input class="form-control" id="poFilter_projectCode" placeholder="可选" value="${escapeHtml(filterVals.projectCode || '')}" onkeydown="poFilterEnter(event)">
        </label>
      </div>
      <div class="payment-order-filter-grid payment-order-filter-grid--secondary">
        <label class="po-filter-field">
          <span class="po-filter-label">录账日期起</span>
          <input type="date" class="form-control" id="poFilter_dateFrom" value="${escapeHtml(filterVals.dateFrom || '')}" onkeydown="poFilterEnter(event)">
        </label>
        <label class="po-filter-field">
          <span class="po-filter-label">录账日期止</span>
          <input type="date" class="form-control" id="poFilter_dateTo" value="${escapeHtml(filterVals.dateTo || '')}" onkeydown="poFilterEnter(event)">
        </label>
        <div class="payment-order-filter-actions">
          <button type="button" class="btn btn-secondary btn-sm payment-order-filter-btn" onclick="paymentOrderLoadCandidates()">筛选</button>
          <button type="button" class="btn btn-secondary btn-sm payment-order-filter-btn" onclick="poClearFilters()">清除</button>
        </div>
      </div>
      ${filterVals.expenseYm ? `<div class="payment-order-filter-hint">已按归属月 <strong>${escapeHtml(filterVals.expenseYm)}</strong> 筛选；成本登记按明细行拆分，金额与费用统计一致</div>` : ''}
    </div>
    <div class="payment-order-meta-grid">
      <label class="po-inline-field">
        <span class="po-inline-label">申请日期</span>
        <input type="date" class="form-control" id="poOrderDate" value="${escapeHtml(orderDateVal)}">
      </label>
      <label class="po-inline-field po-inline-field--grow">
        <span class="po-inline-label">备注</span>
        <input type="text" class="form-control" id="poRemarks" placeholder="选填" value="${escapeHtml(remarksVal)}">
      </label>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 10px">
      <div id="poSelectionSummary" style="font-size:13px;color:var(--text-secondary)">未支付记录 ${rows.length} 条 · 已选 ${selected.length} 条</div>
      <div id="poSelectionTotal" class="amount" style="font-weight:800">${fmtMoney(total)}</div>
    </div>
    <div class="table-wrapper payment-order-table-wrap">
      <table class="data-table payment-order-table">
        <thead><tr><th><input type="checkbox" class="payment-order-check" id="poSelectAll" ${rows.length ? '' : 'disabled'} onchange="paymentOrderToggleSelectAll(this.checked)" aria-label="全选当前列表"></th><th>录账日期</th><th>归属月</th><th>板块</th><th>收款方信息</th><th>品牌</th><th>项目编号</th><th style="text-align:right">金额</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((r) => {
            const key = paymentOrderKey(r);
            const brandText = paymentOrderResolveBrand(r);
            const pcText = String(r.project_code || '—');
            const ymText = paymentOrderExpenseYmLabel(r);
            return `<tr>
              <td><input type="checkbox" class="payment-order-check" ${paymentOrderState.selectedKeys.has(key) ? 'checked' : ''} onchange="paymentOrderToggleRow('${escapeHtml(key)}', this.checked)" aria-label="选择该条待付款记录"></td>
              <td>${escapeHtml(fmtDateShort(r.source_date))}</td>
              <td class="payment-order-ym-cell" title="${escapeHtml(ymText)}">${escapeHtml(ymText)}</td>
              <td>${escapeHtml(paymentSourceLabel(r.source_type))}</td>
              <td class="payment-order-payee-cell" title="${escapeHtml(r.payee_name || '')}">${escapeHtml(r.payee_name || '（未填）')}</td>
              <td class="payment-order-brand-cell" title="${escapeHtml(brandText)}">${escapeHtml(brandText)}</td>
              <td class="payment-order-pc-cell" title="${escapeHtml(pcText)}">${escapeHtml(pcText)}</td>
              <td class="amount payment-order-amount-cell">${fmtMoney(r.amount)}</td>
            </tr>`;
          }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:22px">暂无未支付记录</td></tr>'}
        </tbody>
      </table>
    </div>
    <div id="paymentOrderPreviewBlock" style="margin-top:14px">${previewRows.length ? paymentOrderPreviewBlockHtml(previewRows) : ''}</div>
  `;
  ['sourceType', 'brand'].forEach((id) => {
    const el = document.getElementById(`poFilter_${id}`);
    if (el) el.value = filterVals[id] || '';
  });
  paymentOrderState.filters = { ...filterVals };
  paymentOrderSyncSelectAllCheckbox();
  const tableWrap = body.querySelector('.payment-order-table-wrap');
  if (tableWrap) tableWrap.scrollTop = scrollState.tableTop;
  body.scrollTop = scrollState.bodyTop;
  paymentOrderUpdateFooterButtons();
}

function paymentOrderUpdateFooterButtons() {
  const selectedCount = (paymentOrderState.selectedKeys || new Set()).size;
  const saving = !!paymentOrderState.saving;
  const previewBtn = document.getElementById('poPreviewBtn');
  const confirmBtn = document.getElementById('poConfirmBtn');
  if (previewBtn) {
    previewBtn.disabled = selectedCount === 0 || saving;
    previewBtn.title = selectedCount === 0 ? '请先勾选至少 1 条待付款记录' : '生成付款申请单预览（可选）';
  }
  if (confirmBtn) {
    confirmBtn.disabled = selectedCount === 0 || saving;
    confirmBtn.textContent = saving ? '保存中…' : '保存';
    confirmBtn.title = selectedCount === 0
      ? '请先勾选至少 1 条记录'
      : '保存付款单（待支付）；确认支付请在「付款单」Tab 操作';
  }
}

function paymentOrderPreviewBlockHtml(rows) {
  const payee = rows[0]?.payee_name || '';
  const total = roundMoney2(rows.reduce((s, r) => s + roundMoney2(r.amount), 0));
  return `<div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg-elevated)">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px">
      <strong>付款申请单预览 · ${escapeHtml(payee)}</strong>
      <span class="amount" style="font-weight:800">${fmtMoney(total)}</span>
    </div>
    <table class="data-table"><thead><tr><th>录账日期</th><th>归属月</th><th>板块</th><th>项目编号</th><th>品牌</th><th>城市</th><th>说明</th><th style="text-align:right">金额</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${escapeHtml(fmtDateShort(r.source_date))}</td><td>${escapeHtml(paymentOrderExpenseYmLabel(r))}</td><td>${escapeHtml(paymentSourceLabel(r.source_type))}</td><td>${escapeHtml(r.project_code || '—')}</td><td>${escapeHtml(r.brand || '—')}</td><td>${escapeHtml(r.city || '—')}</td><td>${escapeHtml(paymentOrderDescriptionText(r) || '—')}</td><td class="amount" style="text-align:right">${fmtMoney(r.amount)}</td></tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function paymentOrderPreviewSelected() {
  const rows = paymentOrderSelectedRows();
  if (!paymentOrderValidateSelection(rows)) return;
  paymentOrderState.previewRows = rows;
  const block = document.getElementById('paymentOrderPreviewBlock');
  if (block) {
    block.innerHTML = paymentOrderPreviewBlockHtml(rows);
    requestAnimationFrame(() => {
      try {
        block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (_) {
        block.scrollIntoView();
      }
    });
  }
  paymentOrderUpdateFooterButtons();
  showToast(`已生成 ${rows.length} 条预览，可继续保存`, 'success');
}

async function paymentOrderConfirmSave() {
  if (paymentOrderState.saving) return;
  if (!hasWriteAccess()) {
    showToast('仅管理员可保存', 'warning');
    return;
  }
  const rows = paymentOrderSelectedRows();
  if (!paymentOrderValidateSelection(rows)) return;
  paymentOrderState.previewRows = rows;
  const body = {
    year_frame_id: currentYearFrameId,
    payee_name: rows[0].payee_name,
    order_date: document.getElementById('poOrderDate')?.value || todayDateInputValue(),
    remarks: document.getElementById('poRemarks')?.value?.trim() || null,
    items: rows.map((r) => ({
      source_type: r.source_type,
      source_id: r.source_id,
      line_index: r.line_index ?? undefined,
      candidate_key: paymentOrderKey(r),
    })),
  };
  paymentOrderState.saving = true;
  paymentOrderUpdateFooterButtons();
  try {
    const saved = await api('POST', '/payment-orders', body);
    showToast(`付款单已保存：${saved.order_no || saved.id}（待支付）`, 'success');
    closeModal();
    reimbursementPageState.view = 'payment_orders';
    if (currentPage === 'reimbursement') await renderReimbursements();
    if (currentPage === 'logistics') await loadLogistics();
    if (currentPage === 'warehouse') await loadWarehouse();
    if (currentPage === 'material') await renderMaterialPurchases();
    if (currentPage === 'prop-repair') await renderPropRepairs();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  } finally {
    paymentOrderState.saving = false;
    paymentOrderUpdateFooterButtons();
  }
}

/**
 * 把付款单组装成「盛融报销单」格式的可打印 HTML。
 * - 来源 reimbursement：取原报销单 detail_rows
 * - 其他来源（活动/物料采购/物流/道具维修）：每条 item 作为一行明细兜底
 * - 替换原 sr-meta 行：付款单号 / 收款方 / 申请日期 / 付款日期
 */
