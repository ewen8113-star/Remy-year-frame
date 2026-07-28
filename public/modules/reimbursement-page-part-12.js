async function reimbursementSaveClaimStatus() {
  const id = reimbursementDetailState.id;
  if (!id) return;
  if (!hasWriteAccess()) {
    showToast('仅管理员可修改状态', 'warning');
    return;
  }
  const claim_status = document.getElementById('reimbDetailClaimStatus')?.value || 'draft';
  const payment_date = document.getElementById('reimbDetailPaymentDate')?.value || '';
  if (reimbClaimStatusNeedsPaymentDate(claim_status) && !payment_date) {
    showToast('状态为已支付或已报销时，请填写付款日期', 'warning');
    return;
  }
  try {
    const r = await api('PATCH', `/reimbursements/${id}/claim-status`, {
      claim_status,
      payment_date: payment_date || undefined,
    });
    reimbursementDetailState.record = r;
    const bodyEl = document.getElementById('modalReimbDetailBody');
    if (bodyEl) bodyEl.innerHTML = buildReimbursementDetailModalHtml(r);
    detailModalSyncFooter();
    showToast('状态已更新', 'success');
    if (currentPage === 'reimbursement') await renderReimbursements();
  } catch (e) {
    showToast(e.message || '更新失败', 'error');
  }
}

function buildReimbursementDetailModalHtml(record) {
  const r = record || {};
  const meta = reimbReadDetailMeta(r.remarks || '');
  const isMergedCost = Array.isArray(meta.merge_sources) && meta.merge_sources.length >= 2;
  const rows = reimbSortDetailRowsByProject(reimbResolveDetailRowsFromRecord(r, meta));
  const showProjectCol = isMergedCost || rows.some((row) => String(row.project_code || '').trim());
  const advance = roundMoney2(meta.advance_amount);
  const grossFromRows = roundMoney2(rows.reduce((s, row) => s + roundMoney2(row.subtotal), 0));
  const gross = roundMoney2(meta.gross_total) > 0 ? roundMoney2(meta.gross_total) : grossFromRows;
  const visibleRemarks = reimbVisibleRemarks(r.remarks || '');
  const amount = parseFloat(r.amount) || 0;
  const amountCls = amount > 0 ? 'amount-pos' : amount < 0 ? 'amount-neg' : '';
  const projectCode = String(r.related_project_code || '').trim();
  const brandsLabel = reimbBrandsLabelFromRows(rows, r.brand || '');
  const projectDisplay = projectCode || brandsLabel || '按明细行归属';
  const heroRows = [
    ['日期', escapeHtml(fmtDateShort(r.date) || '—')],
    ['个人/公司', escapeHtml(reimbPayeePartyLabel(reimbPayeePartyFromPaymentType(r.payment_type)))],
    ['成本归属', escapeHtml(reimbRecordCostAttributionLabel(r))],
    ['项目编号', escapeHtml(projectDisplay)],
    ['品牌', escapeHtml(brandsLabel || r.brand || '—')],
    [
      '费用合计（含税）',
      `<span class="reimb-detail-value amount-pos">${fmtMoney(gross || amount)}</span>`,
      true,
    ],
    ...(advance > 0
      ? [[
          '备用金抵扣',
          `<span class="reimb-detail-value amount-neg">- ${fmtMoney(advance)}</span>`,
          true,
        ]]
      : []),
    [
      advance > 0 ? '金额合计（应付）' : '金额（含税）',
      `<span class="reimb-detail-value ${amountCls}">${fmtMoney(amount)}</span>`,
      true,
    ],
    ['状态', buildReimbursementClaimStatusEditorHtml(r), true],
    ...(meta.payment_date
      ? [['付款日期', `<span class="reimb-detail-value">${escapeHtml(fmtDateShort(meta.payment_date))}</span>`, true]]
      : []),
    ['付款状态', paymentStatusHtml(r.payment_status, r.payment_order_id)],
    ['收款方信息', escapeHtml(r.payee_name || '—')],
    ...(r.payment_method
      ? [['付款方式', escapeHtml(reimbPaymentMethodLabel(r.payment_method))]]
      : []),
    ...(r.payment_method === 'bank_transfer' && (r.payee_bank_name || r.payee_bank_account)
      ? [
          ['开户行', escapeHtml(r.payee_bank_name || '—')],
          ['银行账号', escapeHtml(r.payee_bank_account || '—')],
        ]
      : []),
    ['合并场次', r.merged_into_activity ? '<span class="badge badge-success">已计入</span>' : '<span class="badge badge-gray">未计入</span>'],
  ];
  if (Array.isArray(meta.merged_from_ids) && meta.merged_from_ids.length) {
    heroRows.push([
      '合并来源',
      escapeHtml(meta.merged_from_ids.map((x) => `#${x}`).join('、')),
    ]);
  }
  if (reimbCanUnmerge(r)) {
    heroRows.push([
      '合并操作',
      `<span class="badge badge-gray">可撤销合并（${meta.merge_sources.length} 条）</span>`,
    ]);
  } else if (/^合并自\s+#/m.test(visibleRemarks)) {
    heroRows.push([
      '合并操作',
      '<span style="font-size:12px;color:var(--text-secondary)">旧版合并记录，无快照不可自动撤销</span>',
    ]);
  }
  const heroHtml = heroRows
    .map(([label, value, rawValue]) => {
      const v = rawValue ? value : `<span class="reimb-detail-value">${value}</span>`;
      return `<div class="reimb-detail-hero-row"><span class="reimb-detail-label">${escapeHtml(label)}</span>${v}</div>`;
    })
    .join('');

  const legacyBrandMappedDetail = reimbDetailBrandFromLegacyBrand(r.brand);
  const detailTbody = rows.length
    ? rows
        .map((row, idx) => {
          const blockLabel = REIMB_DETAIL_BLOCKS.find((x) => x.value === row.block)?.label || row.block || '';
          const catLabel = (REIMB_DETAIL_CATEGORY_OPTIONS[row.block] || []).find(([v]) => v === row.category)?.[1] || row.category || '';
          const subtotal = roundMoney2(row.subtotal);
          const rowPc = String(row.project_code || row.line_project || '').trim();
          const rowBrand =
            (typeof row.brand === 'string' && row.brand.trim() && row.brand.trim() !== '内部')
              ? row.brand.trim()
              : extractBrandFromProjectCode(rowPc)
                || legacyBrandMappedDetail
                || (r.brand ? String(r.brand) : '—');
          const projectCell = showProjectCol
            ? `<td class="reimb-ro-wrap reimb-ro-pc" title="${escapeHtml(rowPc)}">${escapeHtml(rowPc || '—')}</td>`
            : '';
          return `<tr>
            <td class="reimb-ro-c">${idx + 1}</td>
            ${projectCell}
            <td>${escapeHtml(rowBrand)}</td>
            <td>${escapeHtml(blockLabel)}</td>
            <td>${escapeHtml(catLabel)}</td>
            <td class="reimb-ro-wrap">${escapeHtml(row.description || '')}</td>
            <td class="reimb-ro-c">${row.quantity != null && row.quantity !== '' ? escapeHtml(row.quantity) : '—'}</td>
            <td class="reimb-ro-amount">${row.unit_price != null && row.unit_price !== '' ? fmtMoney(row.unit_price) : '—'}</td>
            <td class="reimb-ro-amount">${fmtMoney(subtotal)}</td>
            <td class="reimb-ro-c">${escapeHtml(reimbFormatCostMonth(row.cost_month) || '—')}</td>
            <td class="reimb-ro-c">${row.invoice === '无' ? '无' : '有'}</td>
            <td class="reimb-ro-mono">${escapeHtml(row.invoice_no || '')}</td>
            <td class="reimb-ro-wrap">${escapeHtml(row.remarks || '')}</td>
          </tr>`;
        })
        .join('')
    : '';

  const detailTable = rows.length
    ? `<div class="reimb-ro-scroll"><table class="reimb-ro-table">
        <thead>
          <tr><th>#</th>${showProjectCol ? '<th>项目编号</th>' : ''}<th>品牌</th><th>板块</th><th>类别</th><th>内容说明</th><th>数量</th><th>单价</th><th>小计</th><th>费用归属</th><th>发票</th><th>发票号码</th><th>备注</th></tr>
        </thead>
        <tbody>${detailTbody}</tbody>
      </table></div>`
    : '<div class="reimb-detail-empty">无结构化明细（可能为旧数据）</div>';

  const mergeHint = isMergedCost
    ? `<p class="reimb-detail-merge-hint">本单由 ${meta.merge_sources.length} 条成本登记合并；明细按<strong>项目编号</strong>逐条展示，未按类别汇总。</p>`
    : '';

  return `<div class="reimb-detail-body">
    <div class="reimb-detail-hero" aria-label="付款申请基本信息">${heroHtml}</div>
    <section class="reimb-detail-section">
      <h4 class="reimb-detail-section-title">费用明细</h4>
      ${mergeHint}
      ${detailTable}
      ${advance > 0 ? `<div style="margin-top:10px;font-size:12px;color:var(--text-secondary)">备用金抵扣：<span class="reimb-detail-value amount-neg">- ${fmtMoney(advance)}</span></div>` : ''}
    </section>
    <section class="reimb-detail-section">
      <h4 class="reimb-detail-section-title">备注</h4>
      <div style="white-space:pre-wrap;line-height:1.6;font-size:12px;color:var(--text-primary)">${escapeHtml(visibleRemarks || '—')}</div>
    </section>
  </div>`;
}

function detailModalSyncFooter() {
  const pdfBtn = document.getElementById('reimbDetailPdfBtn');
  const unmergeBtn = document.getElementById('reimbDetailUnmergeBtn');
  const showReimb = detailModalContext === 'reimbursement';
  if (pdfBtn) pdfBtn.style.display = showReimb ? 'inline-flex' : 'none';
  if (unmergeBtn) {
    const r = reimbursementDetailState.record;
    const canUnmerge = showReimb && hasWriteAccess() && reimbCanUnmerge(r);
    unmergeBtn.style.display = canUnmerge ? 'inline-flex' : 'none';
    unmergeBtn.disabled = !canUnmerge;
  }
}

async function reimbursementOpenDetailModal(id) {
  const nid = Number(id);
  if (!Number.isFinite(nid)) return;
  detailModalContext = 'reimbursement';
  reimbursementDetailState = { id: nid, record: null };
  const titleEl = document.getElementById('modalReimbDetailTitle');
  const bodyEl = document.getElementById('modalReimbDetailBody');
  if (!titleEl || !bodyEl) {
    showToast('详情弹窗未就绪，请刷新页面', 'warning');
    return;
  }
  titleEl.textContent = `付款申请详情 · #${nid}`;
  bodyEl.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-title">加载中…</div></div>';
  openModal('modalReimbDetail');
  detailModalSyncFooter();
  try {
    const r = await api('GET', `/reimbursements/${nid}`);
    reimbursementDetailState.record = r;
    bodyEl.innerHTML = buildReimbursementDetailModalHtml(r);
    detailModalSyncFooter();
  } catch (e) {
    bodyEl.innerHTML = `<div class="empty-state" style="padding:24px"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message || '')}</div></div>`;
  }
}

/**
 * 物料采购详情弹窗：复用付款申请详情容器（统一视觉），footer 按钮按上下文派发。
 * - 行 = `material_purchases` 表中的直接登记记录（不是报销派生）
 * - PDF 预览按钮在物料采购上下文下隐藏
 */
async function materialPurchaseOpenDetailModal(id) {
  const nid = Number(id);
  if (!Number.isFinite(nid)) return;
  detailModalContext = 'material';
  reimbursementDetailState = { id: nid, record: null };
  const titleEl = document.getElementById('modalReimbDetailTitle');
  const bodyEl = document.getElementById('modalReimbDetailBody');
  if (!titleEl || !bodyEl) {
    showToast('详情弹窗未就绪，请刷新页面', 'warning');
    return;
  }
  titleEl.textContent = `物料采购详情 · #${nid}`;
  bodyEl.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-title">加载中…</div></div>';
  openModal('modalReimbDetail');
  detailModalSyncFooter();
  try {
    const r = await api('GET', `/material-purchases/${nid}`);
    reimbursementDetailState.record = r;
    bodyEl.innerHTML = buildMaterialPurchaseDetailModalHtml(r);
  } catch (e) {
    bodyEl.innerHTML = `<div class="empty-state" style="padding:24px"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message || '')}</div></div>`;
  }
}

/**
 * 渲染物料采购详情正文（与付款申请详情保持视觉一致：hero 区 + 明细表 + 备注）
 */
