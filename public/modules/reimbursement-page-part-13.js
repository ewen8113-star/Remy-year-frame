function buildMaterialPurchaseDetailModalHtml(record) {
  const r = record || {};
  const merged = isMergedFlag(r.merged_into_activity);
  const amount = roundMoney2(r.total_amount);
  const heroRows = [
    ['日期', escapeHtml(fmtDateShort(r.purchase_date) || '—')],
    ['品牌', `<span class="badge badge-${brandColor(r.brand_code || r.brand_name)}">${escapeHtml(r.brand_name || r.brand_code || '—')}</span>`, true],
    ['合计', `<span class="reimb-detail-value ${amount > 0 ? 'amount-pos' : ''}">${fmtMoney(amount)}</span>`, true],
    ['关联项目', escapeHtml(r.activity_project_code || r.related_project_code || '—')],
    ['计入状态', merged ? '<span class="badge badge-success">已计入</span>' : '<span class="badge badge-gray">未计入</span>', true],
    ['付款状态', paymentStatusHtml(r.payment_status, r.payment_order_id), true],
  ];
  const heroHtml = heroRows
    .map(([label, value, rawValue]) => {
      const v = rawValue ? value : `<span class="reimb-detail-value">${value}</span>`;
      return `<div class="reimb-detail-hero-row"><span class="reimb-detail-label">${escapeHtml(label)}</span>${v}</div>`;
    })
    .join('');
  const items = Array.isArray(r.items) ? r.items : [];
  const tbody = items.length
    ? items.map((it, idx) => `<tr>
        <td class="reimb-ro-c">${idx + 1}</td>
        <td class="reimb-ro-wrap">${escapeHtml(it.name || '')}</td>
        <td class="reimb-ro-amount">${fmtMoney(it.amount)}</td>
      </tr>`).join('')
    : '';
  const table = items.length
    ? `<div class="reimb-ro-scroll"><table class="reimb-ro-table">
        <thead>
          <tr><th style="width:48px">#</th><th>项目名称</th><th style="text-align:right">金额</th></tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table></div>`
    : '<div class="reimb-detail-empty">无明细</div>';
  return `<div class="reimb-detail-body">
    <div class="reimb-detail-hero" aria-label="物料采购基本信息">${heroHtml}</div>
    <section class="reimb-detail-section">
      <h4 class="reimb-detail-section-title">采购明细</h4>
      ${table}
    </section>
    <section class="reimb-detail-section">
      <h4 class="reimb-detail-section-title">备注</h4>
      <div style="white-space:pre-wrap;line-height:1.6;font-size:12px;color:var(--text-primary)">${escapeHtml(r.remarks || '—')}</div>
    </section>
  </div>`;
}

async function reimbursementDetailEdit() {
  const id = reimbursementDetailState.id;
  if (!Number.isFinite(id)) return;
  closeModal();
  if (detailModalContext === 'material') {
    await showMaterialPurchaseModal(id);
  } else {
    await reimbursementEditById(id);
  }
}

async function reimbursementDetailDelete() {
  const id = reimbursementDetailState.id;
  if (!Number.isFinite(id)) return;
  closeModal();
  if (detailModalContext === 'material') {
    await deleteMaterialPurchaseRecord(id);
  } else {
    await deleteReimbursementRecord(id);
  }
}

/** 成本登记详情：盛融报销单模板预览 / 打印 / 导出 PDF */
async function reimbursementDetailPdfPreview() {
  const id = reimbursementDetailState.id;
  if (!Number.isFinite(id)) return;
  await reimbursementPrintTemplateById(id);
}

async function reimbursementEditById(id) {
  try {
    const r = await api('GET', `/reimbursements/${id}`);
    await showReimbursementModal(r);
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
  }
}

function reimbursementInlineHost() {
  return document.getElementById('reimbInlineHost');
}

function hideReimbursementInline() {
  reimbCloseProjectSuggestionList();
  const host = reimbursementInlineHost();
  if (!host) return;
  host.hidden = true;
  host.innerHTML = '';
}

async function showReimbursementModal(record) {
  return showReimbursementForm(record);
}
