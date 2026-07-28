function reimbursementToggleRegistrationPoGroup(poId) {
  reimbursementEnsurePaymentOrderStateSets();
  const id = Number(poId);
  if (!Number.isFinite(id)) return;
  const set = reimbursementPageState.expandedRegistrationPoIds;
  if (set.has(id)) set.delete(id);
  else set.add(id);
  reimbursementRenderListTableOnly();
}

function reimbursementRegistrationRowHtml(r, opts = {}) {
  const nested = !!opts.nested;
  const m = r.merged_into_activity === 1 || r.merged_into_activity === true;
  const paymentType = r.payment_type || 'personal_reimbursement';
  const claimStatus = r.claim_status || 'draft';
  const visibleRemarks = reimbVisibleRemarks(r.remarks || '');
  const projectDisp = reimbListProjectCodeDisplay(r);
  const amt = parseFloat(r.amount) || 0;
  const amtStyle =
    amt > 0 ? 'color:var(--accent);font-weight:600' : amt < 0 ? 'color:var(--danger);font-weight:600' : '';
  const eligible = reimbursementSelectionEligible(r);
  const selectedIds = reimbursementPageState.selectedIds || new Set();
  const checked = selectedIds.has(Number(r.id));
  const cbAttrs = `${eligible ? '' : 'disabled'} ${checked ? 'checked' : ''}`.trim();
  const cbTitle = eligible
    ? '勾选用于合并生成付款单'
    : '已支付或已关联付款单的记录不可合并';
  const nestedCls = nested ? ' reimb-list-row--nested' : '';
  return `<tr class="reimb-list-row${checked ? ' reimb-list-row--selected' : ''}${nestedCls}" style="cursor:pointer" onclick="reimbursementRowClick(event, ${r.id})">
    <td class="reimb-select-cell" onclick="event.stopPropagation()" style="width:36px;text-align:center">
      ${nested ? '' : `<input type="checkbox" ${cbAttrs} title="${escapeHtml(cbTitle)}" onclick="event.stopPropagation();reimbursementToggleRowSelect(${r.id}, this.checked)">`}
    </td>
    <td>${escapeHtml(fmtDateShort(r.date))}</td>
    <td>${escapeHtml(reimbPayeePartyLabel(reimbPayeePartyFromPaymentType(paymentType)))}</td>
    <td>${escapeHtml(reimbRecordCostAttributionLabel(r))}</td>
    <td class="reimbursement-list-code" title="${escapeHtml(projectDisp.title)}">${escapeHtml(projectDisp.text)}</td>
    <td>${m ? '<span class="badge badge-success">已计入</span>' : '—'}</td>
    <td class="amount" style="text-align:left;${amtStyle}">${fmtMoney(r.amount)}</td>
    <td><span class="badge ${reimbClaimStatusBadgeClass(claimStatus)}">${escapeHtml(reimbClaimStatusLabel(claimStatus))}</span></td>
    <td>${paymentStatusHtml(r.payment_status, r.payment_order_id)}</td>
    <td class="reimbursement-list-payee" title="${escapeHtml(r.payee_name || '')}">${escapeHtml(r.payee_name || '—')}</td>
    <td class="reimbursement-list-remarks" title="${escapeHtml(visibleRemarks)}">${escapeHtml(visibleRemarks || '—')}</td>
    <td onclick="event.stopPropagation()">
      <div class="reimbursement-row-actions">
      <button type="button" class="btn btn-secondary btn-sm" title="盛融报销单预览/打印" onclick="event.stopPropagation();reimbursementPrintTemplateById(${r.id})">打印</button>
      ${reimbCanUnmerge(r) ? `<button type="button" class="btn btn-secondary btn-sm" title="恢复为合并前的多条记录" onclick="event.stopPropagation();reimbursementUnmergeRecord(${r.id})">撤销合并</button>` : ''}
      <button type="button" class="btn btn-secondary btn-sm" onclick="reimbursementEditById(${r.id})">编辑</button>
      <button type="button" class="btn btn-danger btn-sm" onclick="deleteReimbursementRecord(${r.id})">删除</button>
      </div>
    </td>
  </tr>`;
}

function reimbursementBuildRegistrationListHtml(list, orderMap) {
  reimbursementEnsurePaymentOrderStateSets();
  const standalone = [];
  const byPoId = new Map();
  (list || []).forEach((r) => {
    const poId = Number(r.payment_order_id);
    if (Number.isFinite(poId) && poId > 0) {
      if (!byPoId.has(poId)) byPoId.set(poId, []);
      byPoId.get(poId).push(r);
    } else {
      standalone.push(r);
    }
  });
  const expandedPo = reimbursementPageState.expandedRegistrationPoIds;
  let html = '';

  [...byPoId.entries()].sort((a, b) => b[0] - a[0]).forEach(([poId, rows]) => {
    const order = orderMap.get(poId);
    const total = roundMoney2(rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0));
    const isPaid = rows.every((r) => String(r.payment_status || '').toLowerCase() === 'paid');
    const isOpen = expandedPo.has(poId);
    const chevron = isOpen ? '▾' : '▸';
    html += `<tr class="reimb-po-group-row${isOpen ? ' reimb-po-group-row--open' : ''}" role="button" tabindex="0" onclick="reimbursementToggleRegistrationPoGroup(${poId})" title="点击展开付款单内明细">
      <td class="reimb-select-cell" onclick="event.stopPropagation()"></td>
      <td>${escapeHtml(fmtDateShort(order?.order_date || rows[0]?.date))}</td>
      <td>公司</td>
      <td colspan="2" class="reimbursement-list-code">
        <span class="reimb-stats-project-chevron" aria-hidden="true">${chevron}</span>
        付款单 ${escapeHtml(order?.order_no || `#${poId}`)} · ${rows.length} 条明细
      </td>
      <td>—</td>
      <td class="amount" style="text-align:left;font-weight:600">${fmtMoney(order?.total_amount || total)}</td>
      <td>${paymentOrderStatusBadgeHtml(isPaid ? 'paid' : 'unpaid')}</td>
      <td>${isPaid ? paymentStatusHtml('paid', poId) : paymentStatusHtml('unpaid', poId)}</td>
      <td class="reimbursement-list-payee" title="${escapeHtml(order?.payee_name || rows[0]?.payee_name || '')}">${escapeHtml(order?.payee_name || rows[0]?.payee_name || '—')}</td>
      <td>—</td>
      <td onclick="event.stopPropagation()">
        <button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation();reimbursementPageState.view='payment_orders';reimbursementRenderListDom()">付款单</button>
      </td>
    </tr>`;
    if (isOpen) {
      html += `<tr class="reimb-po-nested-banner" aria-hidden="true"><td colspan="11"><div class="reimb-po-nested-banner-inner">↳ 付款单明细 · ${rows.length} 条成本登记</div></td></tr>`;
      rows.sort((a, b) => Number(a.id) - Number(b.id)).forEach((r) => {
        html += reimbursementRegistrationRowHtml(r, { nested: true });
      });
      html += `<tr class="reimb-po-nested-end" aria-hidden="true"><td colspan="11"></td></tr>`;
    }
  });

  standalone.forEach((r) => {
    html += reimbursementRegistrationRowHtml(r);
  });
  return html;
}

async function paymentOrderViewDetail(id) {
  try {
    const order = await api('GET', `/payment-orders/${id}`);
    const html = await buildPaymentOrderSheetHtml(order);
    openReimbursementPreviewModal({
      title: `付款单 ${order.order_no || `#${order.id}`}`,
      type: 'pdf',
      bodyHtml: `<iframe id="reimbPreviewPdfFrame" style="width:100%;height:70vh;border:1px solid #e5e7eb;border-radius:8px;background:#fff" srcdoc="${escapeHtml(html)}"></iframe>`,
    });
  } catch (e) {
    showToast(e.message || '加载付款单失败', 'error');
  }
}

/**
 * 删除付款单：后端会先把明细对应的成本记录回退到「未支付」状态，再删除主单 + 明细。
 */
async function paymentOrderDelete(id, label) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除付款单', 'warning');
    return;
  }
  const name = label || `#${id}`;
  if (!confirm(`确认删除付款单 ${name}？\n所属成本记录将解除关联并回退为未支付，可重新生成付款单。`)) return;
  try {
    const res = await api('DELETE', `/payment-orders/${id}`);
    showToast(res?.message || '已删除付款单', 'success');
    delete reimbursementPageState.paymentOrderDetailCache?.[Number(id)];
    if (currentPage === 'reimbursement') await renderReimbursements();
    if (currentPage === 'logistics') await loadLogistics();
    if (currentPage === 'warehouse') await loadWarehouse();
    if (currentPage === 'material') await renderMaterialPurchases();
    if (currentPage === 'prop-repair') await renderPropRepairs();
    void updateBadges();
  } catch (e) {
    showToast(e.message || '删除付款单失败', 'error');
  }
}

function reimbToggleInvoiceSection() {
  const yes = document.getElementById('reimbHasInvY')?.checked;
  const sec = document.getElementById('reimbInvoiceSection');
  if (!sec) return;
  sec.style.display = yes ? 'block' : 'none';
  if (yes) {
    const wrap = document.getElementById('reimbInvoiceRows');
    if (wrap && !wrap.querySelector('.reimb-inv-row')) reimbAppendInvoiceRow(null);
  }
}

function reimbAppendInvoiceRow(row) {
  const wrap = document.getElementById('reimbInvoiceRows');
  if (!wrap) return;
  const ct = row && row.invoice_content != null ? escapeHtml(String(row.invoice_content)) : '';
  const no = row && row.invoice_no != null ? escapeHtml(String(row.invoice_no)) : '';
  const dt = row && row.invoice_date ? String(row.invoice_date).slice(0, 10) : '';
  const k = row && row.invoice_kind === '普票' ? '普票' : '专票';
  const div = document.createElement('div');
  div.className = 'reimb-inv-row';
  div.style.cssText =
    'display:grid;grid-template-columns:1.2fr 1fr 130px 88px 44px;gap:8px;margin-bottom:8px;align-items:center';
  div.innerHTML = `
    <input type="text" class="form-control reimb-inv-content" placeholder="发票内容" value="${ct}">
    <input type="text" class="form-control reimb-inv-no" placeholder="发票号码" value="${no}">
    <input type="date" class="form-control reimb-inv-date" value="${dt}">
    <select class="form-control reimb-inv-kind">
      <option value="专票" ${k === '专票' ? 'selected' : ''}>专票</option>
      <option value="普票" ${k === '普票' ? 'selected' : ''}>普票</option>
    </select>
    <button type="button" class="btn btn-secondary btn-sm" onclick="reimbRemoveInvoiceRow(this)">删</button>`;
  wrap.appendChild(div);
}

function reimbRemoveInvoiceRow(btn) {
  const row = btn && btn.closest && btn.closest('.reimb-inv-row');
  if (!row) return;
  row.remove();
  const wrap = document.getElementById('reimbInvoiceRows');
  if (wrap && !wrap.querySelector('.reimb-inv-row') && document.getElementById('reimbHasInvY')?.checked) {
    reimbAppendInvoiceRow(null);
  }
}

function updateReimbCostTotal() {
  const d = collectCostDetails('reimb-cost-field');
  const t = calcCostDetailsTotal(d);
  const el = document.getElementById('reimbCostTotal');
  if (el) el.textContent = fmtMoney(t);
}

function reimbCollectInvoicesFromForm() {
  const out = [];
  document.querySelectorAll('.reimb-inv-row').forEach((row) => {
    const invoice_content = row.querySelector('.reimb-inv-content')?.value?.trim() || '';
    const invoice_no = row.querySelector('.reimb-inv-no')?.value?.trim() || '';
    const invoice_date = row.querySelector('.reimb-inv-date')?.value?.trim() || '';
    const invoice_kind = row.querySelector('.reimb-inv-kind')?.value || '';
    if (invoice_content || invoice_no || invoice_date || invoice_kind) out.push({ invoice_content, invoice_no, invoice_date, invoice_kind });
  });
  return out;
}

function reimbExportPayloadFromForm() {
  const id = document.getElementById('reimbRecordId')?.value?.trim();
  const date = document.getElementById('reimbDate')?.value || '';
  const remarks = document.getElementById('reimbRemarks')?.value?.trim() || '';
  const actId = parseInt(document.getElementById('reimbActivityId')?.value, 10);
  const act = (reimbursementPageState.activities || []).find((x) => Number(x.id) === actId);
  const payee_name = document.getElementById('reimbPayeeName')?.value?.trim() || '';
  const payment_method = document.getElementById('reimbPaymentMethod')?.value || '';
  const payee_bank_name = document.getElementById('reimbPayeeBankName')?.value?.trim() || '';
  const payee_bank_account = document.getElementById('reimbPayeeBankAccount')?.value?.trim() || '';
  const payment_type = document.getElementById('reimbPaymentType')?.value || 'personal_reimbursement';
  const cost_module = document.getElementById('reimbCostModule')?.value || 'activity';
  const claim_status = document.getElementById('reimbClaimStatus')?.value || 'draft';
  const rows = reimbCollectDetailRows();
  const brand = reimbResolveRecordBrand(rows);
  const use_advance = !!document.getElementById('reimbUseAdvance')?.checked;
  const advance_amount = use_advance ? roundMoney2(document.getElementById('reimbAdvanceAmount')?.value) : 0;
  const invoices = rows
    .filter((row) => row.invoice_no && row.invoice_date)
    .map((row) => ({ invoice_content: row.description, invoice_no: row.invoice_no, invoice_date: row.invoice_date, invoice_kind: '普票' }));
  const has_invoice = invoices.length > 0;
  const cost_details = reimbRowsToCostDetails(rows, advance_amount);
  const amount = roundMoney2(calcCostDetailsTotal(cost_details));
  const merged = document.getElementById('reimbMergedNote')?.dataset?.merged === '1';
  return {
    id,
    date,
    remarks,
    activity_id: actId,
    brand,
    payee_name,
    payment_method: payment_method || null,
    payee_bank_name: payment_method === 'bank_transfer' ? payee_bank_name : null,
    payee_bank_account: payment_method === 'bank_transfer' ? payee_bank_account : null,
    payment_type,
    cost_module,
    claim_status,
    project_code: act?.project_code || '',
    has_invoice,
    invoices,
    cost_details,
    detail_rows: rows,
    advance_amount,
    amount,
    merged_into_activity: merged,
  };
}
