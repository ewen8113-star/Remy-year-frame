async function showReimbursementForm(record) {
  const host = reimbursementInlineHost();
  if (!host) {
    showToast('请先打开「付款申请」页面', 'warning');
    return;
  }
  if (!currentYearFrameId) {
    showToast('请先选择年度并确保已加载年框', 'warning');
    return;
  }
  try {
    if (!reimbursementPageState.activities.length) {
      reimbursementPageState.activities = await api(
        'GET',
        `/activities?yearFrameId=${currentYearFrameId}&sortBy=date&sortOrder=DESC&isVirtual=0`
      );
    }
  } catch (e) {
    showToast('加载场次失败: ' + e.message, 'error');
    return;
  }

  const rid = record && record.id ? String(record.id) : '';
  const merged = !!(record && (record.merged_into_activity === 1 || record.merged_into_activity === true));
  const actId = record && record.activity_id ? Number(record.activity_id) : 0;
  const dateVal =
    record && record.date
      ? toDateInputValue(record.date)
      : todayDateInputValue();
  const meta = reimbReadDetailMeta(record?.remarks || '');
  const mergeMetaJson = meta.merge_sources && meta.merge_sources.length >= 2
    ? escapeHtml(JSON.stringify({
        merge_sources: meta.merge_sources,
        merged_from_ids: meta.merged_from_ids,
        merged_at: meta.merged_at,
      }))
    : '';
  const remarksEsc = escapeHtml(reimbVisibleRemarks(record?.remarks || ''));
  const enrichedDetailRows = reimbResolveDetailRowsFromRecord(record, meta);
  const useAdvance = !!meta.use_advance;
  const advanceAmount = roundMoney2(meta.advance_amount);
  const paymentDateVal = meta.payment_date || '';
  const legacyBrandMapped = record && record.brand ? reimbDetailBrandFromLegacyBrand(record.brand) : '';
  reimbDetailDefaultBrand = legacyBrandMapped || '内部';
  const detailRows = enrichedDetailRows.map((row) => ({
    ...row,
    brand:
      typeof row?.brand === 'string' && row.brand.trim() && row.brand.trim() !== '内部'
        ? row.brand.trim()
        : extractBrandFromProjectCode(row?.project_code || row?.line_project || '')
          || legacyBrandMapped
          || reimbDetailDefaultBrand,
  }));
  const payeeVal = record && record.payee_name ? String(record.payee_name) : '';
  const paymentMethodVal = record && record.payment_method ? String(record.payment_method) : '';
  const payeeBankNameVal = record && record.payee_bank_name ? String(record.payee_bank_name) : '';
  const payeeBankAccountVal = record && record.payee_bank_account ? String(record.payee_bank_account) : '';
  const costModuleVal = record && record.cost_module ? String(record.cost_module) : 'activity';
  const claimStatusVal = record && record.claim_status ? String(record.claim_status) : 'draft';
  const paymentTypeVal = record && record.payment_type ? String(record.payment_type) : 'personal_reimbursement';
  const payeePartyVal = reimbPayeePartyFromPaymentType(paymentTypeVal);
  const payeePartyOptions = REIMB_PAYEE_PARTY_OPTIONS.map(
    (x) => `<option value="${x.value}" ${x.value === payeePartyVal ? 'selected' : ''}>${escapeHtml(x.label)}</option>`,
  ).join('');
  const claimStatusOptions = reimbClaimStatusOptionsForRecord({ payment_type: paymentTypeVal })
    .map((x) => `<option value="${x.value}" ${x.value === claimStatusVal ? 'selected' : ''}>${x.label}</option>`)
    .join('');

  let pickedMergedLabel = '—';
  if (merged && Array.isArray(meta.merge_sources) && meta.merge_sources.length > 1) {
    pickedMergedLabel = '多场次合并 · 项目编号见各行明细';
  } else if (merged && actId) {
    const ax = reimbursementPageState.activities.find((x) => Number(x.id) === actId);
    pickedMergedLabel = ax ? reimbActivityLine(ax) : `场次 #${actId}`;
  }

  const isNonActivityRecord =
    !!record && !merged && String(record.cost_module) === 'general' && !record.activity_id;
  const paymentStatusVal = record && String(record.payment_status).toLowerCase() === 'paid' ? 'paid' : 'unpaid';

  const titleText = rid ? `编辑报销登记 · #${rid}` : '报销登记';
  host.hidden = false;
  host.innerHTML = `
    <section class="reimb-inline-panel" aria-label="付款申请登记">
      <header class="reimb-inline-header">
        <span class="reimb-inline-title">${escapeHtml(titleText)}</span>
        <button type="button" class="modal-close" aria-label="收起" onclick="hideReimbursementInline()">✕</button>
      </header>
      <div class="reimb-form-body" id="reimbInlineBody">
        <input type="hidden" id="reimbRecordId" value="${rid}">
        <input type="hidden" id="reimbActivityId" value="${actId || ''}">
        <input type="hidden" id="reimbMergeMetaJson" value="${mergeMetaJson}">
        <div class="reimb-form-basic-zone">
        <div class="reimb-form-zone-label">基本信息</div>
        <div id="reimbMergedNote" style="display:${merged ? 'block' : 'none'};margin-bottom:10px;padding:10px;background:var(--accent-soft);border-radius:var(--radius-sm);font-size:12px;color:var(--text-primary)" data-merged="${merged ? '1' : '0'}">
          本单已同步项目成本；保存时将按费用明细再次合并。不可更换关联项目。
        </div>
        <div class="reimb-attr-row" id="reimbAttrWrap" style="display:${merged ? 'none' : 'flex'}">
          <span class="reimb-attr-label">成本归属</span>
          <div class="reimb-attr-options">
            <label class="reimb-attr-chip"><input type="radio" name="reimbCostAttribution" value="activity" ${!isNonActivityRecord ? 'checked' : ''} onchange="reimbOnCostAttributionChange()"><span>活动成本（可同步场次）</span></label>
            <label class="reimb-attr-chip"><input type="radio" name="reimbCostAttribution" value="non_activity" ${isNonActivityRecord ? 'checked' : ''} onchange="reimbOnCostAttributionChange()"><span>统筹成本（不同步场次）</span></label>
          </div>
          <p class="reimb-attr-hint">统筹成本：不计入场次项目编号；成本归属由费用明细「品牌」列决定（选品牌年框编号计入对应品牌，选「内部」计入内部成本）。净额 = 费用合计 − 备用金。</p>
        </div>
        <input type="hidden" id="reimbPaymentType" value="${escapeHtml(paymentTypeVal)}">
        <input type="hidden" id="reimbCostModule" value="${escapeHtml(costModuleVal)}">
        <input type="hidden" id="reimbPayeeName" value="${escapeHtml(payeeVal)}">
        <div class="form-grid reimb-top-grid reimb-top-grid--dense">
          <div class="form-group reimb-project-field reimb-span-3">
            <label class="form-label" id="reimbProjectCodeLabel">项目编号</label>
            ${
              merged
                ? `<div class="reimb-project-readonly">${pickedMergedLabel}</div>`
                : `<div class="reimb-project-combobox inv-project-combobox">
                     <input type="text" class="form-control" id="reimbProjectCode" autocomplete="off" placeholder="输入关键字并从下拉选择项目编号" onfocus="reimbOpenProjectSuggestionList()" onblur="reimbOnProjectInputBlur()" oninput="reimbOnProjectInput(this.value)" onkeydown="reimbHandleProjectInputKeydown(event)">
                     <div id="reimbProjectMenu" class="inv-project-menu aq-pc-menu" style="display:none"></div>
                   </div>`
            }
          </div>
          <div class="form-group">
            <label class="form-label">状态 <span class="required">*</span></label>
            <select class="form-control" id="reimbClaimStatus" onchange="reimbClaimStatusChanged()">${claimStatusOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">付款状态</label>
            <select class="form-control" id="reimbPaymentStatus">
              <option value="unpaid" ${paymentStatusVal !== 'paid' ? 'selected' : ''}>未支付</option>
              <option value="paid" ${paymentStatusVal === 'paid' ? 'selected' : ''}>已支付</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">申请日期 <span class="required">*</span></label>
            <input type="date" class="form-control" id="reimbDate" value="${dateVal}">
          </div>
          <div class="form-group reimb-payee-field">
            <label class="form-label">个人/公司</label>
            <select class="form-control" id="reimbPayeePartyType" onchange="reimbPayeePartyTypeChanged()">${payeePartyOptions}</select>
          </div>
          <div class="form-group reimb-payee-info-field">
            <label class="form-label">收款方信息</label>
            <select class="form-control" id="reimbPayeeInfo" onchange="reimbPayeeInfoChanged()">
              <option value="">请选择</option>
            </select>
          </div>
          <div class="form-group reimb-pay-method-field">
            <label class="form-label">付款方式</label>
            <select class="form-control" id="reimbPaymentMethod" onchange="reimbPaymentMethodChanged()">
              <option value="">请选择</option>
              ${reimbPaymentMethodOptionsHtml(paymentMethodVal)}
            </select>
          </div>
          <div class="form-group reimb-bank-field" id="reimbPayeeBankNameWrap" style="display:none">
            <label class="form-label">开户行</label>
            <input type="text" class="form-control" id="reimbPayeeBankName" placeholder="银行汇款时填写" value="${escapeHtml(payeeBankNameVal)}">
          </div>
          <div class="form-group reimb-bank-field" id="reimbPayeeBankAccountWrap" style="display:none">
            <label class="form-label">银行账号</label>
            <input type="text" class="form-control" id="reimbPayeeBankAccount" placeholder="银行汇款时填写" value="${escapeHtml(payeeBankAccountVal)}">
          </div>
          <div class="form-group reimb-span-3" id="reimbPayeeAccountPickerWrap" style="display:none">
            <label class="form-label">选择收款账号</label>
            <div id="reimbPayeeAccountPicker" class="reimb-payee-account-picker"></div>
          </div>
          <div class="form-group" id="reimbPaymentDateWrap" style="display:${reimbClaimStatusNeedsPaymentDate(claimStatusVal) ? 'block' : 'none'}">
            <label class="form-label">付款日期</label>
            <input type="date" class="form-control" id="reimbPaymentDate" value="${escapeHtml(paymentDateVal)}">
          </div>
          <div class="form-group reimb-sync-row reimb-span-3" style="display:${merged ? 'none' : 'block'}">
            <label class="form-label">条件选择</label>
            <label class="reimb-option-row reimb-option-row--compact">
              <input type="checkbox" id="reimbSyncToActivity" ${merged ? 'checked disabled' : ''} onchange="reimbOnSyncToActivityChange()">
              <span>同步项目成本（默认不勾选；勾选时必须填写项目编号，所有费用只统计一次）</span>
            </label>
          </div>
        </div>
        </div>
        <div class="reimb-form-detail-zone">
        <div class="form-group reimb-detail-section">
          <div class="reimb-detail-section-head">
            <span class="form-label" style="margin:0">费用明细</span>
            <span class="reimb-detail-hint">每行可独立选择品牌；空品牌按「内部」入账</span>
            <button type="button" class="btn btn-secondary btn-sm" onclick="reimbAppendDetailRow(null)">添加一行</button>
          </div>
          <div class="reimb-detail-table-wrap reimb-detail-table-wrap--compact">
            <table class="data-table reimb-detail-table reimb-detail-table--compact" id="reimbDetailTable">
              <thead>
                <tr>
                  <th>编号</th><th class="reimb-col-brand">品牌</th><th>板块</th><th>类别</th><th>内容说明</th><th>数量</th><th>单价</th><th>小计</th><th class="reimb-col-cost-month" title="费用归属（1-12月）">费用归属</th>
                  <th>发票</th><th>发票日期</th><th>发票号码</th><th>申请人</th><th>备注</th><th></th>
                </tr>
              </thead>
              <tbody id="reimbDetailRows"></tbody>
            </table>
          </div>
        </div>
        <div class="reimb-totals-row">
          <label class="reimb-advance-card">
            <input type="checkbox" id="reimbUseAdvance" ${useAdvance ? 'checked' : ''} onchange="reimbToggleAdvanceAmount()">
            <span class="reimb-advance-copy">
              <span class="reimb-advance-title">备用金</span>
              <span class="reimb-advance-sub">勾选后填写抵扣金额</span>
            </span>
          </label>
          <div class="form-group reimb-advance-amount" id="reimbAdvanceAmountWrap" style="display:${useAdvance ? 'block' : 'none'}">
            <label class="form-label">备用金金额</label>
            <input type="number" class="form-control" id="reimbAdvanceAmount" min="0" step="0.01" value="${advanceAmount > 0 ? advanceAmount.toFixed(2) : ''}" oninput="reimbUpdateDetailTotals()">
          </div>
          <div class="reimb-total-card">
            <span style="color:var(--text-secondary);font-size:13px">费用合计</span>
            <span class="amount" id="reimbGrossTotal">¥0.00</span>
          </div>
          <div class="reimb-total-card reimb-total-card-primary">
            <span style="color:var(--text-secondary);font-size:13px">金额合计</span>
            <span class="amount" style="font-weight:700;color:var(--accent)" id="reimbCostTotal">¥0.00</span>
          </div>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label class="form-label">备注</label>
          <textarea class="form-control" id="reimbRemarks" rows="2" placeholder="选填">${remarksEsc}</textarea>
        </div>
        </div>
      </div>
      <footer class="reimb-inline-footer">
        <button type="button" class="btn btn-secondary" onclick="hideReimbursementInline()">取消</button>
        <button type="button" class="btn btn-secondary" onclick="reimbursementPrintCurrentForm()">预览 / 打印</button>
        <button type="button" class="btn btn-secondary" onclick="reimbursementPreviewCsvFromForm()">CSV 预览</button>
        <button type="button" class="btn btn-primary" onclick="saveReimbursementForm()">保存</button>
      </footer>
    </section>
  `;

  if (detailRows.length) {
    detailRows.forEach((row) => reimbAppendDetailRow(row));
  } else if (record) {
    reimbDetailRowsFromCostDetails(record).forEach((row) => reimbAppendDetailRow(row));
    if (!document.querySelector('#reimbDetailRows tr')) {
      for (let i = 0; i < 3; i += 1) reimbAppendDetailRow(null);
    }
  } else {
    for (let i = 0; i < 3; i += 1) reimbAppendDetailRow(null);
  }
  if (!merged) {
    reimbRenderActivityPicker();
    if (actId) reimbSelectActivity(actId);
  } else if (document.getElementById('reimbActivityId') && actId) {
    document.getElementById('reimbActivityId').value = String(actId);
  }
  reimbClaimStatusChanged();
  reimbToggleAdvanceAmount();
  if (!merged) reimbOnCostAttributionChange();
  reimbOnSyncToActivityChange();
  reimbUpdateDetailTotals();
  reimbPaymentMethodChanged();
  await reimbPayeePartyTypeChanged(payeeVal);
  renderLucideIcons();
  try {
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (_) { /* ignore */ }
}
