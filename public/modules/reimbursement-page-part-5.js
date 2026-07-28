function reimbCollectDetailRows() {
  const rows = [];
  document.querySelectorAll('#reimbDetailRows .reimb-detail-row').forEach((row) => {
    const quantity = roundMoney2(row.querySelector('.reimb-line-qty')?.value);
    const unit_price = reimbReadLinePrice(row.querySelector('.reimb-line-price'));
    const subtotal = roundMoney2(quantity * unit_price);
    const project_code = row.dataset.projectCode || '';
    let brand = row.querySelector('.reimb-line-brand')?.value?.trim() || '';
    if (!brand || brand === '内部') {
      const fromPc = extractBrandFromProjectCode(project_code);
      if (fromPc) brand = fromPc;
    }
    const item = {
      brand,
      project_code,
      block: row.querySelector('.reimb-line-block')?.value || '',
      category: row.querySelector('.reimb-line-category')?.value || '',
      description: row.querySelector('.reimb-line-desc')?.value?.trim() || '',
      quantity,
      unit_price,
      subtotal,
      cost_month: parseInt(row.querySelector('.reimb-line-cost-month')?.value, 10) || null,
      invoice: row.querySelector('.reimb-line-invoice')?.value || '有',
      invoice_date: row.querySelector('.reimb-line-invoice-date')?.value || '',
      invoice_no: row.querySelector('.reimb-line-invoice-no')?.value?.trim() || '',
      applicant: row.querySelector('.reimb-line-applicant')?.value?.trim() || '',
      remarks: row.querySelector('.reimb-line-remarks')?.value?.trim() || '',
    };
    if (item.description || item.quantity || item.unit_price || item.subtotal || item.invoice_no || item.remarks) rows.push(item);
  });
  return rows;
}

/** 写入 reimbursements.brand（VARCHAR(30)）：汇总为品牌桶 PHD / X.O 等，优先从项目编号推导 */
function reimbResolveRecordBrand(rows, fallbackBrand) {
  const label = reimbBrandsLabelFromRows(rows, fallbackBrand);
  if (label) return label.length <= 30 ? label : label.split('，')[0];
  const fromFb = extractBrandFromProjectCode(String(fallbackBrand || '').trim());
  if (fromFb) return fromFb;
  const fb = String(fallbackBrand || '').trim();
  if (fb && fb !== '内部') {
    const bucket = detectBrandBucket(fb, extractBrandFromProjectCode(fb));
    return bucket || fb;
  }
  return '内部';
}

function reimbRowsToCostDetails(rows, advanceAmount) {
  const details = {};
  rows.forEach((row) => {
    const key = row.category;
    if (!key) return;
    details[key] = roundMoney2((details[key] || 0) + roundMoney2(row.subtotal));
  });
  if (advanceAmount > 0) details.advance_offset = -roundMoney2(advanceAmount);
  return details;
}

function reimbUpdateDetailTotals() {
  let gross = 0;
  document.querySelectorAll('#reimbDetailRows .reimb-detail-row').forEach((row) => {
    const unit_price = reimbReadLinePrice(row.querySelector('.reimb-line-price'));
    const subtotal = roundMoney2(roundMoney2(row.querySelector('.reimb-line-qty')?.value) * unit_price);
    gross += subtotal;
    const el = row.querySelector('.reimb-line-subtotal');
    if (el) el.textContent = fmtMoney(subtotal);
  });
  const useAdvance = !!document.getElementById('reimbUseAdvance')?.checked;
  const advance = useAdvance ? roundMoney2(document.getElementById('reimbAdvanceAmount')?.value) : 0;
  const net = roundMoney2(gross - advance);
  const grossEl = document.getElementById('reimbGrossTotal');
  const netEl = document.getElementById('reimbCostTotal');
  if (grossEl) grossEl.textContent = fmtMoney(gross);
  if (netEl) {
    netEl.textContent = fmtMoney(net);
    netEl.style.color = net > 0 ? 'var(--accent)' : net < 0 ? 'var(--danger)' : 'var(--text-secondary)';
    netEl.style.fontWeight = '700';
  }
}

function reimbOnCostAttributionChange() {
  const mergedNote = document.getElementById('reimbMergedNote');
  const merged = mergedNote && mergedNote.dataset.merged === '1';
  if (merged) return;
  const v = document.querySelector('input[name="reimbCostAttribution"]:checked')?.value || 'activity';
  const isNon = v === 'non_activity';
  const proj = document.querySelector('.reimb-form-body .reimb-project-field');
  const syncRow = document.querySelector('.reimb-form-body .reimb-sync-row');
  const costModHidden = document.getElementById('reimbCostModule');
  if (proj) proj.style.display = isNon ? 'none' : '';
  if (syncRow) syncRow.style.display = isNon ? 'none' : '';
  if (costModHidden) costModHidden.value = isNon ? 'general' : 'activity';
  if (isNon) {
    const hid = document.getElementById('reimbActivityId');
    const pci = document.getElementById('reimbProjectCode');
    if (hid) hid.value = '';
    if (pci) pci.value = '';
    const syncEl = document.getElementById('reimbSyncToActivity');
    if (syncEl && !syncEl.disabled) syncEl.checked = false;
  }
  reimbOnSyncToActivityChange();
  reimbUpdateDetailTotals();
}

/**
 * 「同步项目成本」勾选状态变更：
 * 1. 项目编号 label 动态加/去 * 红星，提示必填
 * 2. 勾选时隐藏费用明细中的「品牌」列（同步项目成本场景下品牌由项目自动决定，不允许逐行差异化）
 * 3. 未勾选时品牌列恢复可见
 */
function reimbOnSyncToActivityChange() {
  const syncEl = document.getElementById('reimbSyncToActivity');
  const checked = !!syncEl?.checked;
  const lbl = document.getElementById('reimbProjectCodeLabel');
  if (lbl) {
    const existed = lbl.querySelector('.required');
    if (checked && !existed) {
      lbl.insertAdjacentHTML('beforeend', ' <span class="required">*</span>');
    } else if (!checked && existed) {
      existed.remove();
    }
  }
  const table = document.getElementById('reimbDetailTable');
  if (table) table.classList.toggle('no-brand-col', checked);
  const projInput = document.getElementById('reimbProjectCode');
  if (projInput) {
    if (checked) {
      projInput.classList.add('reimb-project-required');
      projInput.setAttribute('placeholder', '已勾选「同步项目成本」，必须从下拉选中项目编号');
    } else {
      projInput.classList.remove('reimb-project-required');
      projInput.setAttribute('placeholder', '输入关键字并从下拉选择项目编号');
    }
  }
}

function reimbToggleAdvanceAmount() {
  const checked = !!document.getElementById('reimbUseAdvance')?.checked;
  const wrap = document.getElementById('reimbAdvanceAmountWrap');
  if (wrap) wrap.style.display = checked ? 'block' : 'none';
  reimbUpdateDetailTotals();
}

function reimbClaimStatusChanged() {
  const status = document.getElementById('reimbClaimStatus')?.value || 'draft';
  const wrap = document.getElementById('reimbPaymentDateWrap');
  const paymentDate = document.getElementById('reimbPaymentDate');
  if (wrap) wrap.style.display = reimbClaimStatusNeedsPaymentDate(status) ? 'block' : 'none';
  if (reimbClaimStatusNeedsPaymentDate(status) && paymentDate && !paymentDate.value) {
    paymentDate.value = todayDateInputValue();
  }
}

async function showCorporatePaymentTodo() {
  if (!currentYearFrameId) {
    showToast('请先选择年度', 'warning');
    return;
  }
  paymentOrderState = { candidates: [], selectedKeys: new Set(), previewRows: [], filters: {}, saving: false };
  const body = document.getElementById('modalPaymentOrderBody');
  if (body) body.innerHTML = '<div class="empty-state"><div class="skeleton skeleton-title"></div></div>';
  openModal('modalPaymentOrder');
  await paymentOrderLoadCandidates();
}

async function paymentOrderLoadCandidates() {
  const qs = new URLSearchParams();
  qs.set('yearFrameId', String(currentYearFrameId || ''));
  qs.set('_', String(Date.now()));
  const filterVals = poReadFilterValues();
  ['payee', 'brand', 'sourceType', 'projectCode', 'expenseYm', 'dateFrom', 'dateTo'].forEach((id) => {
    const v = filterVals[id];
    if (v) qs.set(id, v);
  });
  try {
    const url = `${API}/payment-orders/candidates?${qs.toString()}`;
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(res.ok ? '响应不是合法 JSON' : `请求失败 (${res.status})`);
    }
    if (!res.ok) throw new Error(data.error || data.message || `请求失败 (${res.status})`);
    paymentOrderState.candidates = data;
    const visibleKeys = new Set(paymentOrderState.candidates.map(paymentOrderKey));
    paymentOrderState.selectedKeys = new Set([...paymentOrderState.selectedKeys].filter((k) => visibleKeys.has(k)));
    paymentOrderRenderModal();
  } catch (e) {
    const body = document.getElementById('modalPaymentOrderBody');
    if (body) body.innerHTML = `<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message || '')}</div></div>`;
  }
}

function paymentOrderToggleRow(key, checked) {
  if (checked) paymentOrderState.selectedKeys.add(key);
  else paymentOrderState.selectedKeys.delete(key);
  paymentOrderState.previewRows = [];
  const previewBlock = document.getElementById('paymentOrderPreviewBlock');
  if (previewBlock) previewBlock.innerHTML = '';
  paymentOrderUpdateSelectionSummary();
  paymentOrderUpdateFooterButtons();
}

function paymentOrderSyncSelectAllCheckbox() {
  const el = document.getElementById('poSelectAll');
  if (!el) return;
  const rows = paymentOrderState.candidates || [];
  if (!rows.length) {
    el.checked = false;
    el.indeterminate = false;
    el.disabled = true;
    return;
  }
  el.disabled = false;
  const visibleKeys = rows.map(paymentOrderKey);
  const selectedCount = visibleKeys.filter((k) => paymentOrderState.selectedKeys.has(k)).length;
  el.checked = selectedCount === visibleKeys.length;
  el.indeterminate = selectedCount > 0 && selectedCount < visibleKeys.length;
}

function paymentOrderToggleSelectAll(checked) {
  const rows = paymentOrderState.candidates || [];
  rows.forEach((r) => {
    const key = paymentOrderKey(r);
    if (checked) paymentOrderState.selectedKeys.add(key);
    else paymentOrderState.selectedKeys.delete(key);
  });
  paymentOrderState.previewRows = [];
  const previewBlock = document.getElementById('paymentOrderPreviewBlock');
  if (previewBlock) previewBlock.innerHTML = '';
  const body = document.getElementById('modalPaymentOrderBody');
  body?.querySelectorAll('.payment-order-table tbody .payment-order-check').forEach((cb) => {
    cb.checked = checked;
  });
  paymentOrderUpdateSelectionSummary();
  paymentOrderUpdateFooterButtons();
}

function paymentOrderUpdateSelectionSummary() {
  const rows = paymentOrderState.candidates || [];
  const selected = paymentOrderSelectedRows();
  const total = roundMoney2(selected.reduce((s, r) => s + roundMoney2(r.amount), 0));
  const summaryEl = document.getElementById('poSelectionSummary');
  const totalEl = document.getElementById('poSelectionTotal');
  if (summaryEl) summaryEl.textContent = `未支付记录 ${rows.length} 条 · 已选 ${selected.length} 条`;
  if (totalEl) totalEl.textContent = fmtMoney(total);
  paymentOrderSyncSelectAllCheckbox();
}

function paymentOrderExpenseYmLabel(row) {
  const yms = Array.isArray(row?.expense_yms) ? row.expense_yms.filter(Boolean) : [];
  if (!yms.length && row?.expense_ym) yms.push(row.expense_ym);
  if (!yms.length) return '—';
  if (yms.length === 1) return yms[0];
  return yms.join('、');
}

function paymentOrderResolveBrand(row) {
  const pc = String(row?.project_code || '').trim();
  const fromPc = extractBrandFromProjectCode(pc);
  if (fromPc) return fromPc;
  const b = String(row?.brand || '').trim();
  if (b && b !== '内部') {
    const fromB = extractBrandFromProjectCode(b);
    return fromB || b;
  }
  return b || '—';
}
