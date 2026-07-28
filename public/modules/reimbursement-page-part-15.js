async function saveReimbursementForm() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可保存', 'warning');
    return;
  }
  const rid = document.getElementById('reimbRecordId')?.value?.trim();
  const mergedNote = document.getElementById('reimbMergedNote');
  const alreadyMerged = mergedNote && mergedNote.dataset.merged === '1';
  const attribution = alreadyMerged
    ? 'activity'
    : document.querySelector('input[name="reimbCostAttribution"]:checked')?.value || 'activity';
  const isNonActivity = !alreadyMerged && attribution === 'non_activity';
  let actId = parseInt(document.getElementById('reimbActivityId')?.value, 10);
  const projectCodeInput = (document.getElementById('reimbProjectCode')?.value || '').replace(/^\uFEFF/, '').trim();
  const date = document.getElementById('reimbDate')?.value;
  const payee_name = document.getElementById('reimbPayeeName')?.value?.trim() || '';
  const payment_method = document.getElementById('reimbPaymentMethod')?.value || '';
  const payee_bank_name = document.getElementById('reimbPayeeBankName')?.value?.trim() || '';
  const payee_bank_account = document.getElementById('reimbPayeeBankAccount')?.value?.trim() || '';
  const remarks = document.getElementById('reimbRemarks')?.value?.trim() || '';
  const payment_type = document.getElementById('reimbPaymentType')?.value || 'personal_reimbursement';
  let cost_module = document.getElementById('reimbCostModule')?.value || 'activity';
  const claim_status = document.getElementById('reimbClaimStatus')?.value || 'draft';
  const payment_status = document.getElementById('reimbPaymentStatus')?.value === 'paid' ? 'paid' : 'unpaid';
  const rows = reimbCollectDetailRows();
  const use_advance = !!document.getElementById('reimbUseAdvance')?.checked;
  const advance_amount = use_advance ? roundMoney2(document.getElementById('reimbAdvanceAmount')?.value) : 0;
  const cost_details = reimbRowsToCostDetails(rows, advance_amount);
  const grossTotal = roundMoney2(rows.reduce((s, row) => s + roundMoney2(row.subtotal), 0));
  const total = roundMoney2(calcCostDetailsTotal(cost_details));
  const payment_date = document.getElementById('reimbPaymentDate')?.value || '';
  const syncEl = document.getElementById('reimbSyncToActivity');
  const sync_to_activity = alreadyMerged ? true : isNonActivity ? false : !!syncEl?.checked;
  if (isNonActivity) {
    actId = NaN;
    cost_module = 'general';
  }
  const hasAct = Number.isFinite(actId) && actId > 0;
  const a = hasAct ? reimbursementPageState.activities.find((x) => Number(x.id) === actId) : null;
  const brand = reimbResolveRecordBrand(
    rows,
    (a && a.brand) || extractBrandFromProjectCode(projectCodeInput) || '',
  );
  if (payment_method === 'bank_transfer' && payee_name && (!payee_bank_name || !payee_bank_account)) {
    showToast('银行汇款请填写开户行和银行账号', 'warning');
    return;
  }
  const invoices = rows
    .filter((row) => row.invoice_no && row.invoice_date)
    .map((row) => ({
      invoice_content: row.description,
      invoice_no: row.invoice_no,
      invoice_date: row.invoice_date,
      invoice_kind: '普票',
    }));
  const has_invoice = invoices.length > 0;

  if (!currentYearFrameId) {
    showToast('年框未就绪', 'warning');
    return;
  }
  if (!date) {
    showToast('请选择申请日期', 'warning');
    return;
  }
  if (!payee_name) {
    showToast('请选择收款方信息', 'warning');
    return;
  }
  if (projectCodeInput && !hasAct) {
    showToast('项目编号请从下拉候选中选中；若不关联请清空输入', 'warning');
    return;
  }
  if (reimbClaimStatusNeedsPaymentDate(claim_status) && !payment_date) {
    showToast('状态为已支付或已报销时，请填写付款日期', 'warning');
    return;
  }
  if (!rows.length) {
    showToast('请至少填写一行费用明细', 'warning');
    return;
  }
  if (total === 0) {
    showToast('金额合计不能为 0', 'warning');
    return;
  }
  if (!isNonActivity && total <= 0) {
    showToast('活动成本模式下金额合计须大于 0', 'warning');
    return;
  }
  if (total < 0 && !isNonActivity) {
    showToast('负金额仅适用于「统筹成本（不同步场次）」归属', 'warning');
    return;
  }
  if (use_advance && advance_amount <= 0) {
    showToast('勾选备用金时，请填写备用金金额', 'warning');
    return;
  }
  if (sync_to_activity && !hasAct) {
    showToast('勾选「同步项目成本」时，必须填写项目编号并从下拉中选中', 'warning');
    const projInput = document.getElementById('reimbProjectCode');
    if (projInput) {
      projInput.classList.add('reimb-project-required-error');
      try {
        projInput.focus();
      } catch (_) {
        /* ignore */
      }
      setTimeout(() => projInput.classList.remove('reimb-project-required-error'), 2400);
    }
    return;
  }

  let mergePreserve = {};
  const mergeMetaRaw = document.getElementById('reimbMergeMetaJson')?.value?.trim();
  if (mergeMetaRaw) {
    try {
      const parsed = JSON.parse(mergeMetaRaw);
      if (Array.isArray(parsed.merge_sources) && parsed.merge_sources.length >= 2) {
        mergePreserve = {
          merge_sources: parsed.merge_sources,
          merged_from_ids: parsed.merged_from_ids,
          merged_at: parsed.merged_at,
        };
      }
    } catch (_) {
      /* ignore */
    }
  }

  const body = {
    year_frame_id: currentYearFrameId,
    activity_id: hasAct ? actId : null,
    brand,
    date,
    payee_name,
    payment_method: payment_method || null,
    payee_bank_name: payment_method === 'bank_transfer' ? payee_bank_name : null,
    payee_bank_account: payment_method === 'bank_transfer' ? payee_bank_account : null,
    payment_status,
    remarks: reimbRemarksWithMeta(remarks, {
      rows,
      use_advance,
      advance_amount,
      gross_total: grossTotal,
      payment_date,
      ...mergePreserve,
    }),
    payment_type,
    cost_module,
    claim_status,
    has_invoice,
    invoices,
    cost_details,
    sync_to_activity,
  };
  if (a) {
    body.city = a.city || null;
    body.related_project_code = a.project_code || null;
    if (!body.brand) body.brand = a.brand || '';
  }

  try {
    if (rid) {
      await api('PUT', `/reimbursements/${rid}`, body);
      showToast('已更新', 'success');
    } else {
      await api('POST', '/reimbursements', body);
      showToast('付款申请已保存', 'success');
    }
    await reimbUpsertPersonalPayeeDict(payee_name, payment_method, payee_bank_name, payee_bank_account);
    hideReimbursementInline();
    if (currentPage === 'reimbursement') await renderReimbursements();
    if (currentPage === 'material') await renderMaterialPurchases();
    if (currentPage === 'cost') await renderCost();
    void updateBadges();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

async function deleteReimbursementRecord(id) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除', 'warning');
    return;
  }
  if (!confirm('确定删除该条报销？')) return;
  try {
    await api('DELETE', `/reimbursements/${id}`);
    showToast('已删除', 'success');
    if (currentPage === 'reimbursement') await renderReimbursements();
    if (currentPage === 'material') await renderMaterialPurchases();
    void updateBadges();
    if (currentPage === 'cost') await renderCost();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

async function reimbursementUnmergeRecord(id) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可撤销合并', 'warning');
    return;
  }
  const nid = Number(id);
  if (!Number.isFinite(nid)) return;
  let r = reimbursementDetailState.record;
  if (!r || Number(r.id) !== nid) {
    try {
      r = await api('GET', `/reimbursements/${nid}`);
    } catch (e) {
      showToast(e.message || '加载失败', 'error');
      return;
    }
  }
  if (!reimbCanUnmerge(r)) {
    showToast('该记录不可撤销合并（可能已支付、已计入场次，或为旧版合并无快照）', 'warning');
    return;
  }
  const meta = reimbReadDetailMeta(r.remarks || '');
  const count = meta.merge_sources.length;
  const fromIds = (meta.merged_from_ids || meta.merge_sources.map((s) => s.source_id).filter(Boolean))
    .map((x) => `#${x}`)
    .join('、');
  if (
    !confirm(
      `确认撤销合并 #${nid}？\n将恢复为 ${count} 条独立记录（原 ${fromIds || '合并前'}），并删除本条合并记录。`,
    )
  ) {
    return;
  }
  try {
    const res = await api('POST', `/reimbursements/${nid}/unmerge`);
    closeModal();
    const restored = Array.isArray(res?.restored) ? res.restored : [];
    const idsText = restored.map((x) => `#${x.new_id}`).join('、');
    showToast(res?.message || `已恢复 ${restored.length} 条（${idsText}）`, 'success');
    if (currentPage === 'reimbursement') await renderReimbursements();
    if (currentPage === 'material') await renderMaterialPurchases();
    if (currentPage === 'cost') await renderCost();
    void updateBadges();
  } catch (e) {
    showToast(e.message || '撤销合并失败', 'error');
  }
}

async function reimbursementDetailUnmerge() {
  const id = reimbursementDetailState.id;
  if (!Number.isFinite(id)) return;
  await reimbursementUnmergeRecord(id);
}

let _reimbListFilterT;
let _reimbListFilterComposing = false;

function reimbursementListFilterInput(el) {
  if (_reimbListFilterComposing || el?.isComposing) return;
  reimbursementListFilterDebounced();
}

function reimbursementListFilterCompositionStart() {
  _reimbListFilterComposing = true;
  clearTimeout(_reimbListFilterT);
}

function reimbursementListFilterCompositionEnd(el) {
  _reimbListFilterComposing = false;
  reimbursementPageState.filterInput = el?.value ?? document.getElementById('reimbListFilter')?.value ?? '';
  reimbursementListFilterDebounced();
}
