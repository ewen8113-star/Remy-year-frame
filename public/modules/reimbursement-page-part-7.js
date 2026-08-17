async function buildPaymentOrderSheetHtml(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const reimbIds = [
    ...new Set(
      items
        .filter((i) => i && i.source_type === 'reimbursement')
        .map((i) => Number(i.source_id))
        .filter(Number.isFinite),
    ),
  ];
  const detailRows = [];
  let advanceTotal = 0;
  let hasInvoice = false;
  const invoices = [];
  let mergedIntoActivity = false;
  let firstPaymentType = null;
  let firstCostModule = null;
  let firstPaymentMethod = null;
  let firstPayeeBankName = null;
  let firstPayeeBankAccount = null;

  for (const rid of reimbIds) {
    try {
      const rec = await api('GET', `/reimbursements/${rid}`);
      const p = reimbursementPayloadFromRecord(rec);
      if (!firstPaymentType) firstPaymentType = p.payment_type;
      if (!firstCostModule) firstCostModule = p.cost_module;
      if (!firstPaymentMethod && p.payment_method) firstPaymentMethod = p.payment_method;
      if (!firstPayeeBankName && p.payee_bank_name) firstPayeeBankName = p.payee_bank_name;
      if (!firstPayeeBankAccount && p.payee_bank_account) firstPayeeBankAccount = p.payee_bank_account;
      if (Array.isArray(p.detail_rows) && p.detail_rows.length) {
        p.detail_rows.forEach((row) => {
          detailRows.push({
            ...row,
            brand: row.brand || p.brand || '',
            applicant: row.applicant || p.payee_name || order.payee_name || '',
          });
        });
      } else {
        detailRows.push({
          block: 'other',
          category: 'other',
          description: `成本登记 #${rid}`,
          subtotal: Number(p.amount) || 0,
          brand: p.brand || '',
          remarks: '',
          applicant: p.payee_name || order.payee_name || '',
          invoice: p.has_invoice ? '有' : '无',
        });
      }
      advanceTotal += Number(p.advance_amount) || 0;
      if (p.has_invoice) hasInvoice = true;
      if (Array.isArray(p.invoices)) invoices.push(...p.invoices);
      if (p.merged_into_activity) mergedIntoActivity = true;
    } catch (_) {
      /* 忽略单条失败，继续合成其它行 */
    }
  }

  items
    .filter((i) => i && i.source_type !== 'reimbursement')
    .forEach((i) => {
      detailRows.push({
        block: 'other',
        category: 'other',
        description:
          paymentOrderDescriptionText(i)
          || `${paymentSourceLabel(i.source_type)} #${i.source_id || ''}`.trim(),
        subtotal: Number(i.amount) || 0,
        brand: i.brand || '',
        remarks: i.city || '',
        applicant: order.payee_name || '',
        invoice: '无',
      });
    });

  const composedPayload = {
    id: order.id,
    date: order.order_date,
    remarks: order.remarks || '',
    activity_id: null,
    brand: '',
    payee_name: order.payee_name || '',
    payment_method: firstPaymentMethod,
    payee_bank_name: firstPayeeBankName,
    payee_bank_account: firstPayeeBankAccount,
    project_code: '',
    payment_type: firstPaymentType || 'personal_reimbursement',
    cost_module: firstCostModule || 'activity',
    claim_status: String(order.status || '').toLowerCase() === 'paid' ? 'paid' : 'submitted',
    has_invoice: hasInvoice,
    invoices,
    cost_details: [],
    detail_rows: detailRows,
    advance_amount: roundMoney2(advanceTotal),
    amount: Number(order.total_amount) || 0,
    merged_into_activity: mergedIntoActivity,
    payment_status: String(order.status || '').toLowerCase() === 'paid' ? 'paid' : 'unpaid',
  };

  const sheet = buildReimbursementPrintableHtml(composedPayload);
  const titleReplaced = sheet.replace(
    /<h1 class="sr-title">[^<]*<\/h1>/,
    `<h1 class="sr-title">付款申请单</h1>`,
  );
  const docTitleReplaced = titleReplaced.replace(
    /<title>[^<]*<\/title>/,
    `<title>付款申请单 ${escapeHtml(order.order_no || `#${order.id}`)}</title>`,
  );
  const metaReplaced = docTitleReplaced.replace(
    /<div class="sr-meta">[\s\S]*?<\/div>/,
    `<div class="sr-meta">
      <span>付款单号：<strong>${escapeHtml(order.order_no || `#${order.id}`)}</strong></span>
      <span>收款方信息：<strong>${escapeHtml(order.payee_name || '—')}</strong></span>
      <span>申请日期：${escapeHtml(fmtDateShort(order.order_date) || '—')}</span>
      <span>付款日期：${escapeHtml(fmtDateShort(order.payment_date) || '—')}</span>
    </div>`,
  );
  return metaReplaced;
}

function reimbursementEnsurePaymentOrderStateSets() {
  if (!reimbursementPageState.expandedPaymentOrderIds) reimbursementPageState.expandedPaymentOrderIds = new Set();
  if (!reimbursementPageState.paymentOrderDetailCache) reimbursementPageState.paymentOrderDetailCache = {};
  if (!reimbursementPageState.expandedRegistrationPoIds) reimbursementPageState.expandedRegistrationPoIds = new Set();
}

async function reimbursementTogglePaymentOrderRow(orderId) {
  reimbursementEnsurePaymentOrderStateSets();
  const id = Number(orderId);
  if (!Number.isFinite(id)) return;
  const set = reimbursementPageState.expandedPaymentOrderIds;
  if (set.has(id)) {
    set.delete(id);
    reimbursementRenderListTableOnly();
    return;
  }
  set.add(id);
  if (!reimbursementPageState.paymentOrderDetailCache[id]) {
    try {
      reimbursementPageState.paymentOrderDetailCache[id] = await api('GET', `/payment-orders/${id}`);
    } catch (e) {
      set.delete(id);
      showToast(e.message || '加载付款单明细失败', 'error');
      return;
    }
  }
  reimbursementRenderListTableOnly();
}

async function paymentOrderSubmitPay(orderId) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可确认支付', 'warning');
    return;
  }
  const id = Number(orderId);
  const dateEl = document.getElementById(`poPayDate_${id}`);
  const payment_date = dateEl?.value || todayDateInputValue();
  if (!payment_date) {
    showToast('请选择付款日期', 'warning');
    return;
  }
  if (!confirm(`确认该付款单已完成支付？\n付款日期：${payment_date}`)) return;
  try {
    await api('POST', `/payment-orders/${id}/pay`, { payment_date });
    showToast('付款单已确认支付', 'success');
    delete reimbursementPageState.paymentOrderDetailCache[id];
    reimbursementPageState.expandedPaymentOrderIds?.delete(id);
    if (currentPage === 'reimbursement') await renderReimbursements();
    if (currentPage === 'logistics') await loadLogistics();
    if (currentPage === 'warehouse') await loadWarehouse();
    if (currentPage === 'material') await renderMaterialPurchases();
    if (currentPage === 'prop-repair') await renderPropRepairs();
    void updateBadges();
  } catch (e) {
    showToast(e.message || '支付失败', 'error');
  }
}

function reimbursementBuildPaymentOrderItemsDetailHtml(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) return '<div class="reimb-po-detail-empty">暂无明细</div>';
  const total = roundMoney2(items.reduce((s, it) => s + roundMoney2(it.amount), 0));
  return `<div class="reimb-po-detail-head">
      <span class="reimb-po-detail-meta">${items.length} 条明细 · 合计 <strong class="amount">${fmtMoney(total)}</strong></span>
    </div>
    <div class="reimb-po-detail-scroll">
    <table class="data-table reimb-po-detail-table act-table-sticky-head">
    <thead><tr><th style="width:88px">板块</th><th>项目编号</th><th style="width:72px">品牌</th><th>说明</th><th style="text-align:right;width:100px">金额</th></tr></thead>
    <tbody>${items.map((it) => {
      const desc = paymentOrderItemDescriptionText(it);
      const full = String(it.description || '').trim();
      return `<tr>
      <td>${escapeHtml(paymentSourceLabel(it.source_type))}</td>
      <td class="reimb-stats-key reimb-po-pc-cell" title="${escapeHtml(it.project_code || '')}">${escapeHtml(it.project_code || '—')}</td>
      <td>${escapeHtml(it.brand || '—')}</td>
      <td class="reimb-stats-key reimb-po-desc-cell" title="${escapeHtml(full || desc)}">${escapeHtml(desc)}</td>
      <td class="amount" style="text-align:right">${fmtMoney(it.amount)}</td>
    </tr>`;
    }).join('')}</tbody>
  </table>
  </div>`;
}

function reimbursementBuildPaymentOrderPayBarHtml(orderId, isPaid) {
  if (isPaid || !hasWriteAccess()) return '';
  const oid = Number(orderId);
  return `<div class="reimb-po-pay-bar" onclick="event.stopPropagation()">
    <span class="reimb-po-pay-hint">确认支付后，付款单移入「已支付」，关联成本同步更新</span>
    <div class="reimb-po-pay-actions">
      <label class="reimb-po-pay-field">
        <span class="reimb-po-pay-label">付款日期</span>
        <input type="date" class="form-control" id="poPayDate_${oid}" value="${escapeHtml(todayDateInputValue())}">
      </label>
      <button type="button" class="btn btn-primary btn-sm" onclick="event.stopPropagation();paymentOrderSubmitPay(${oid})">确认支付</button>
    </div>
  </div>`;
}

function reimbursementBuildPaymentOrdersTableHtml(ordersFiltered) {
  reimbursementEnsurePaymentOrderStateSets();
  if (!ordersFiltered.length) {
    return '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:24px">暂无付款单</td></tr>';
  }
  const unpaid = ordersFiltered.filter((o) => String(o.status || '').toLowerCase() !== 'paid');
  const paid = ordersFiltered.filter((o) => String(o.status || '').toLowerCase() === 'paid');
  const expanded = reimbursementPageState.expandedPaymentOrderIds;
  const cache = reimbursementPageState.paymentOrderDetailCache || {};

  const rowHtml = (o) => {
    const oid = Number(o.id);
    const isOpen = expanded.has(oid);
    const isPaid = String(o.status || '').toLowerCase() === 'paid';
    const chevron = isOpen ? '▾' : '▸';
    const detail = cache[oid];
    const detailHtml = isOpen
      ? `<tr class="reimb-po-detail-row"><td colspan="9">
          <div class="reimb-po-detail">
            ${reimbursementBuildPaymentOrderItemsDetailHtml(detail || { items: [] })}
            ${reimbursementBuildPaymentOrderPayBarHtml(oid, isPaid)}
          </div>
        </td></tr>`
      : '';
    return `<tr class="reimb-po-row${isOpen ? ' reimb-po-row--open' : ''}" role="button" tabindex="0" aria-expanded="${isOpen ? 'true' : 'false'}" onclick="reimbursementTogglePaymentOrderRow(${oid})" title="点击展开明细">
      <td class="reimb-stats-key" title="${escapeHtml(o.order_no || '')}">
        <span class="reimb-stats-project-chevron" aria-hidden="true">${chevron}</span>
        ${escapeHtml(o.order_no || `#${o.id}`)}
      </td>
      <td>${escapeHtml(fmtDateShort(o.order_date))}</td>
      <td>${escapeHtml(fmtDateShort(o.payment_date) || '—')}</td>
      <td class="reimbursement-list-payee" title="${escapeHtml(o.payee_name || '')}">${escapeHtml(o.payee_name || '—')}</td>
      <td class="amount" style="text-align:left">${fmtMoney(o.total_amount)}</td>
      <td>${paymentOrderStatusBadgeHtml(o.status)}</td>
      <td>${escapeHtml(o.item_count || 0)}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(o.remarks || '')}">${escapeHtml(o.remarks || '—')}</td>
      <td onclick="event.stopPropagation()" style="white-space:nowrap">
        <div class="reimbursement-row-actions">
          ${hasWriteAccess() && !isPaid ? `<button type="button" class="btn btn-primary btn-sm" onclick="event.stopPropagation();paymentOrderSubmitPay(${oid})">支付</button>` : ''}
          <button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation();paymentOrderViewDetail(${oid})">预览</button>
          ${hasWriteAccess() ? `<button type="button" class="btn btn-danger btn-sm" onclick="event.stopPropagation();paymentOrderDelete(${oid}, '${escapeHtml(o.order_no || `#${o.id}`)}')">删除</button>` : ''}
        </div>
      </td>
    </tr>${detailHtml}`;
  };

  let html = '';
  if (unpaid.length) {
    html += `<tr><td colspan="9" style="padding:8px 12px;font-size:12px;font-weight:600;color:var(--text-secondary);background:var(--bg-input)">未支付 · ${unpaid.length} 笔</td></tr>`;
    html += unpaid.map(rowHtml).join('');
  }
  if (paid.length) {
    html += `<tr><td colspan="9" style="padding:8px 12px;font-size:12px;font-weight:600;color:var(--text-secondary);background:var(--bg-input)">已支付 · ${paid.length} 笔</td></tr>`;
    html += paid.map(rowHtml).join('');
  }
  return html;
}
