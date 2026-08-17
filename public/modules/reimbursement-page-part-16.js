function reimbursementListFilterDebounced() {
  if (_reimbListFilterComposing) return;
  clearTimeout(_reimbListFilterT);
  _reimbListFilterT = setTimeout(() => {
    if (_reimbListFilterComposing) return;
    const el = document.getElementById('reimbListFilter');
    if (el && !el.isComposing) reimbursementPageState.filterInput = el.value || '';
    if ((reimbursementPageState.view || '') === 'registrations') {
      reimbursementPruneSelectionToFiltered();
    }
    if ((reimbursementPageState.view || '') === 'cost_stats') {
      reimbursementPageState.statsCard = null;
      reimbursementClearStatsProjectExpansion();
    }
    reimbursementRenderListDom(true);
  }, 280);
}

function reimbursementRowClick(ev, id) {
  if (ev.target.closest('button') || ev.target.closest('input') || ev.target.closest('a')) return;
  const k = Number(id);
  if (!Number.isFinite(k)) return;
  reimbursementOpenDetailModal(k);
}

function reimbursementExpandDetailHtml(r) {
  const meta = reimbReadDetailMeta(r.remarks || '');
  const rows = Array.isArray(meta.rows) ? meta.rows : [];
  const adv = roundMoney2(meta.advance_amount);
  const lines = rows.length
    ? rows
        .map(
          (row, i) =>
            `${i + 1}. ${escapeHtml(row.description || '')}　小计 ${fmtMoney(row.subtotal || 0)}`
        )
        .join('<br/>')
    : '<span style="color:var(--text-muted)">无结构化明细（可能为旧数据）</span>';
  return `<div class="reimb-inline-detail" style="font-size:12px;line-height:1.5;color:var(--text-primary)">
    <div style="margin-bottom:6px"><strong>费用明细</strong></div>
    <div>${lines}</div>
    ${adv > 0 ? `<div style="margin-top:8px">备用金抵扣：<span class="amount">${fmtMoney(adv)}</span></div>` : ''}
    <div style="margin-top:8px;color:var(--text-secondary)">${escapeHtml(reimbVisibleRemarks(r.remarks || '') || '—')}</div>
  </div>`;
}

/** 成本登记多选辅助 */
function reimbursementFilterRegistrationRows(rows, kw) {
  const list = rows || [];
  const k = String(kw || '').trim().toLowerCase();
  if (!k) return list;
  return list.filter((r) => {
    const pc = String(r.related_project_code || '').toLowerCase();
    const brand = String(r.brand || '').toLowerCase();
    const city = String(r.city || '').toLowerCase();
    const payee = String(r.payee_name || '').toLowerCase();
    const rm = reimbVisibleRemarks(r.remarks || '').toLowerCase();
    const tp = reimbPayeePartyLabel(reimbPayeePartyFromPaymentType(r.payment_type)).toLowerCase();
    const mod = reimbRecordCostAttributionLabel(r).toLowerCase();
    const st = reimbClaimStatusLabel(r.claim_status || '').toLowerCase();
    return pc.includes(k) || brand.includes(k) || city.includes(k) || payee.includes(k) || rm.includes(k) || tp.includes(k) || mod.includes(k) || st.includes(k) || String(r.id).includes(k);
  });
}

function reimbursementPruneSelectionToFiltered() {
  if (!reimbursementPageState.selectedIds) reimbursementPageState.selectedIds = new Set();
  const kw = reimbursementReadListFilterKeyword();
  const filtered = reimbursementFilterRegistrationRows(reimbursementPageState.rows, kw);
  const visibleIds = new Set(
    filtered.filter(reimbursementSelectionEligible).map((r) => Number(r.id)),
  );
  reimbursementPageState.selectedIds = new Set(
    [...reimbursementPageState.selectedIds].filter((id) => visibleIds.has(Number(id))),
  );
}

function reimbursementSelectionEligible(r) {
  if (!r) return false;
  if (String(r.payment_status || 'unpaid').toLowerCase() === 'paid') return false;
  if (r.payment_order_id) return false;
  return true;
}

function reimbursementSelectionPrune() {
  if (!reimbursementPageState.selectedIds) reimbursementPageState.selectedIds = new Set();
  const valid = new Set(
    (reimbursementPageState.rows || [])
      .filter(reimbursementSelectionEligible)
      .map((r) => Number(r.id))
      .filter(Number.isFinite),
  );
  reimbursementPageState.selectedIds = new Set(
    [...reimbursementPageState.selectedIds].filter((id) => valid.has(Number(id))),
  );
}

function reimbursementToggleRowSelect(id, checked) {
  if (!reimbursementPageState.selectedIds) reimbursementPageState.selectedIds = new Set();
  const nid = Number(id);
  if (checked) reimbursementPageState.selectedIds.add(nid);
  else reimbursementPageState.selectedIds.delete(nid);
  reimbursementRenderListDom(true);
}

function reimbursementToggleSelectAll(checked) {
  if (!reimbursementPageState.selectedIds) reimbursementPageState.selectedIds = new Set();
  const view = reimbursementPageState.view || 'registrations';
  if (view !== 'registrations') return;
  const kw = reimbursementReadListFilterKeyword();
  const filtered = reimbursementFilterRegistrationRows(reimbursementPageState.rows, kw);
  const eligibleVisible = filtered.filter(reimbursementSelectionEligible);
  if (checked) {
    eligibleVisible.forEach((r) => reimbursementPageState.selectedIds.add(Number(r.id)));
  } else {
    eligibleVisible.forEach((r) => reimbursementPageState.selectedIds.delete(Number(r.id)));
  }
  reimbursementRenderListDom(true);
}

/**
 * 合并选中的成本登记：把多条报销单的明细行汇总到一条新记录中，并删除原记录。
 * 合并不涉及付款流程；付款仍由「付款申请」入口走付款单出单。
 *
 * 校验：
 *  - ≥2 条
 *  - 都未支付 / 未关联付款单（reimbursementSelectionEligible）
 *  - 收款方、申请类型（个人/对公）、成本板块一致
 */
async function reimbursementMergeSelected() {
  if (!canRegisterReimbursement()) {
    showToast('当前账号无权合并报销记录', 'warning');
    return;
  }
  if (!reimbursementPageState.selectedIds) reimbursementPageState.selectedIds = new Set();
  const ids = [...reimbursementPageState.selectedIds].map(Number).filter(Number.isFinite);
  if (ids.length < 2) {
    showToast('请至少勾选 2 条记录进行合并', 'warning');
    return;
  }
  const listRows = (reimbursementPageState.rows || []).filter((r) => ids.includes(Number(r.id)));
  if (listRows.length !== ids.length) {
    showToast('选中记录已发生变化，请刷新后重试', 'warning');
    return;
  }
  if (listRows.some((r) => !reimbursementSelectionEligible(r))) {
    showToast('选中记录中存在「已支付」或已关联付款单的项，请取消勾选后重试', 'warning');
    return;
  }
  const payees = [...new Set(listRows.map((r) => String(r.payee_name || '').trim()).filter(Boolean))];
  const emptyPayeeRows = listRows.filter((r) => !String(r.payee_name || '').trim());
  if (emptyPayeeRows.length) {
    showToast(`以下记录缺少收款方：${emptyPayeeRows.map((r) => `#${r.id}`).join('、')}，请先编辑补填`, 'warning');
    return;
  }
  if (payees.length !== 1) {
    showToast(`只能合并同一收款方的记录；当前含：${payees.join('、')}`, 'warning');
    return;
  }
  const paymentTypes = [...new Set(listRows.map((r) => r.payment_type || 'personal_reimbursement'))];
  if (paymentTypes.length > 1) {
    showToast('个人报销与对公付款不可混合合并', 'warning');
    return;
  }
  const costModules = [...new Set(listRows.map((r) => r.cost_module || 'activity'))];
  if (costModules.length > 1) {
    showToast('不同成本板块的记录不可合并；请仅勾选同一板块', 'warning');
    return;
  }

  const summary = listRows
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((r) => `#${r.id}`)
    .join('、');
  if (!confirm(`确认合并 ${listRows.length} 条记录（${summary}）为一条新成本登记？\n合并后可在详情中「撤销合并」恢复为多条原记录。`)) return;

  let merged;
  try {
    merged = await reimbursementMergeRecordsByIds(ids);
  } catch (e) {
    showToast(e.message || '合并失败', 'error');
    return;
  }

  reimbursementPageState.selectedIds = new Set();
  showToast(`已合并为 #${merged.newId}（删除原 ${merged.deleted} 条）`, 'success');
  if (currentPage === 'reimbursement') await renderReimbursements();
  if (currentPage === 'material') await renderMaterialPurchases();
  if (currentPage === 'cost') await renderCost();
  void updateBadges();
}

/**
 * 合并实现：拉取每条报销单完整记录 → 汇总 detail_rows / advance / 备注 → POST 创建 → 逐条 DELETE 原记录。
 * 若新建成功后删除失败，会上抛错误并提示用户清理，避免数据双份。
 */
