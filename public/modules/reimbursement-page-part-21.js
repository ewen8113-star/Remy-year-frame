function reimbursementRenderListDom(tableOnly = false) {
  if (tableOnly && reimbursementRenderListTableOnly()) return;
  const container = document.getElementById('pageContainer');
  if (!container) return;
  const vm = reimbursementBuildListVm();
  const fi = escapeHtml(reimbursementPageState.filterInput || '');
  const isStats = vm.view === 'cost_stats';
  container.innerHTML = `
    <div class="reimbursement-page">
      <div class="page-toolbar reimbursement-toolbar">
        <div class="reimb-tool-group" role="tablist" aria-label="付款申请视图切换">
          <button type="button" class="btn reimb-tool-btn reimb-tool-btn--tab" role="tab" aria-selected="${vm.view === 'registrations' ? 'true' : 'false'}" data-active="${vm.view === 'registrations' ? 'true' : 'false'}" onclick="reimbursementPageState.view='registrations';reimbursementRenderListDom()">成本登记</button>
          <button type="button" class="btn reimb-tool-btn reimb-tool-btn--tab" role="tab" aria-selected="${vm.view === 'payment_orders' ? 'true' : 'false'}" data-active="${vm.view === 'payment_orders' ? 'true' : 'false'}" onclick="reimbursementPageState.view='payment_orders';reimbursementRenderListDom()">付款单</button>
          <button type="button" class="btn reimb-tool-btn reimb-tool-btn--tab" role="tab" aria-selected="${isStats ? 'true' : 'false'}" data-active="${isStats ? 'true' : 'false'}" onclick="reimbursementPageState.view='cost_stats';reimbursementRenderListDom()">费用统计</button>
        </div>
        <span class="reimb-tool-divider" aria-hidden="true"></span>
        <div class="reimb-tool-group reimb-tool-group--actions">
          ${canRegisterReimbursement() ? `<button type="button" class="btn reimb-tool-btn reimb-tool-btn--action" onclick="showReimbursementForm(null)">
            <i data-lucide="plus" class="reimb-tool-btn-icon" aria-hidden="true"></i>报销登记
          </button>
          <button type="button" class="btn reimb-tool-btn reimb-tool-btn--action" onclick="triggerReimbursementImport()" title="从 Excel 报销单导入（盛融/个人报销表）">
            <i data-lucide="upload" class="reimb-tool-btn-icon" aria-hidden="true"></i>报销导入
          </button>
          <input type="file" id="reimbImportFile" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style="display:none" onchange="onReimbursementImportFileSelected(event)">` : ''}
          ${hasWriteAccess() ? `<button type="button" class="btn reimb-tool-btn reimb-tool-btn--action" onclick="showCorporatePaymentTodo()">
            <i data-lucide="file-text" class="reimb-tool-btn-icon" aria-hidden="true"></i>新建付款单
          </button>` : ''}
        </div>
        <input type="text" class="form-control" id="reimbListFilter" placeholder="${isStats ? '筛选：收款方 / 项目编号 / 备注' : '筛选：收款方 / 品牌 / 项目编号 / 城市 / 备注'}" style="max-width:360px;margin-left:auto;${vm.view === 'payment_orders' ? 'visibility:hidden' : ''}"
          value="${fi}"
          autocomplete="off"
          oninput="reimbursementListFilterInput(this)"
          oncompositionstart="reimbursementListFilterCompositionStart()"
          oncompositionend="reimbursementListFilterCompositionEnd(this)">
      </div>
      <div id="reimbInlineHost" class="reimbursement-inline-host" hidden></div>
      <div class="reimbursement-list-panel${isStats ? ' reimbursement-list-panel--stats' : ''}">
        <div id="reimbStatsBodyHost" class="reimb-stats-body-wrap"${isStats ? '' : ' hidden'}>${isStats ? reimbursementBuildCostStatsBodyHtml(vm) : ''}</div>
        <div id="reimbListTableWrap" class="table-wrapper reimbursement-list-wrap"${isStats ? ' hidden' : ''}>${isStats ? '' : vm.tableHtml}</div>
        <div id="reimbListEmptyHost"${isStats ? ' hidden' : ''}>${isStats ? '' : vm.emptyHtml}</div>
      </div>
    </div>
    `;
  reimbursementBindStatsCardDelegation();
  renderLucideIcons();
  const headerCb = document.getElementById('reimbSelectAll');
  if (headerCb) headerCb.indeterminate = !!vm.headerSelectIndeterminate;
}

function triggerReimbursementImport() {
  const inp = document.getElementById('reimbImportFile');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

let reimbImportPending = null;

function reimbursementImportPreviewCancel() {
  reimbImportPending = null;
  const btn = document.getElementById('reimbImportConfirmBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '确认导入';
  }
  closeModal();
}

function reimbImportStatusLabel(status) {
  if (status === 'error') return '<span class="reimb-import-status reimb-import-status--error">未匹配</span>';
  if (status === 'warn') return '<span class="reimb-import-status reimb-import-status--warn">注意</span>';
  return '<span class="reimb-import-status reimb-import-status--ok">正常</span>';
}

function reimbursementBuildImportPreviewHtml(preview) {
  const data = preview || {};
  const summary = data.summary || {};
  const planned = Array.isArray(data.plannedRecords) ? data.plannedRecords : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const syncChecked = reimbImportPending && reimbImportPending.syncActivity !== false;

  const plannedHtml = planned.map((p) => {
    const parts = [
      `<strong>${escapeHtml(p.costModuleLabel || '')}</strong>`,
      `${p.lineCount || 0} 行`,
      fmtMoney(p.amount || 0),
      p.brand ? `品牌 ${escapeHtml(p.brand)}` : '',
    ];
    if (p.costModule === 'activity') {
      if (p.relatedProjectCode) parts.push(`场次 ${escapeHtml(p.relatedProjectCode)}`);
      if (p.multiActivity) parts.push('含多个场次（不同步单场成本）');
      else if (p.syncToActivity) parts.push('将同步计入场次成本');
      else parts.push('仅登记，不同步场次成本');
    }
    return `<div class="reimb-import-planned-card">${parts.filter(Boolean).join(' · ')}</div>`;
  }).join('');

  const rowHtml = rows.map((r) => {
    const targetCls = r.targetType === 'activity' ? 'reimb-import-target--activity' : 'reimb-import-target--general';
    const rowCls = r.status === 'error' ? 'reimb-import-row--error' : (r.status === 'warn' ? 'reimb-import-row--warn' : '');
    const matched = r.matchedProjectCode
      ? escapeHtml(r.matchedProjectCode)
      : '<span style="color:var(--text-muted)">—</span>';
    const note = (r.messages || []).length
      ? `<div style="color:var(--text-muted);margin-top:4px">${r.messages.map((m) => escapeHtml(m)).join('<br>')}</div>`
      : '';
    return `<tr class="${rowCls}">
      <td>${r.excelRow || ''}</td>
      <td>${reimbImportStatusLabel(r.status)}</td>
      <td>${escapeHtml(r.projectRaw || '—')}</td>
      <td class="${targetCls}">${escapeHtml(r.targetTypeLabel || '')}</td>
      <td>${matched}</td>
      <td>${escapeHtml(r.categoryLabel || r.blockLabel || '')}</td>
      <td>${escapeHtml(r.description || '')}${note}</td>
      <td style="white-space:nowrap">${fmtMoney(r.amount || 0)}</td>
    </tr>`;
  }).join('');

  const warnBanner = summary.errorCount
    ? `<p style="color:var(--danger);margin:0">有 ${summary.errorCount} 行项目编号未能匹配到场次，请修正 Excel 或补全场次后再导入。</p>`
    : (summary.warnCount
      ? `<p style="color:var(--warning);margin:0">有 ${summary.warnCount} 行存在提示项，请核对后再导入。</p>`
      : '');

  return `
    <div class="reimb-import-preview-options">
      <div class="form-group">
        <label class="form-label">收款方</label>
        <input type="text" class="form-control" id="reimbImportPayeeInput" value="${escapeHtml(data.payeeName || '')}" placeholder="留空则用表格填报人" onchange="reimbursementImportPreviewRefresh()">
      </div>
      <div class="form-group">
        <label class="form-label">申请日期</label>
        <input type="text" class="form-control" value="${escapeHtml(data.applicationDate || '')}" readonly>
      </div>
      <label class="reimb-import-preview-sync">
        <input type="checkbox" id="reimbImportSyncActivity" ${syncChecked ? 'checked' : ''} onchange="reimbursementImportPreviewRefresh()">
        活动费用同步计入场次成本（仅全部属于同一场次时）
      </label>
    </div>
    <div class="reimb-import-preview-summary">
      <span>共 <strong>${summary.totalRows || 0}</strong> 行</span>
      <span>活动 <strong>${summary.activityLineCount || 0}</strong> 行</span>
      <span>统筹 <strong>${summary.generalLineCount || 0}</strong> 行</span>
      <span>合计 <strong>${fmtMoney(summary.totalAmount || 0)}</strong></span>
      <span>将生成 <strong>${summary.plannedRecordCount || 0}</strong> 条登记</span>
    </div>
    ${warnBanner}
    <div class="reimb-import-preview-planned">${plannedHtml || '<p class="reimb-import-preview-loading">无待导入数据</p>'}</div>
    <div class="reimb-import-preview-table-wrap">
      <table class="reimb-import-preview-table">
        <thead>
          <tr>
            <th>Excel行</th>
            <th>状态</th>
            <th>表格项目编号</th>
            <th>归入</th>
            <th>匹配项目/年框</th>
            <th>费用类别</th>
            <th>摘要</th>
            <th>金额</th>
          </tr>
        </thead>
        <tbody>${rowHtml}</tbody>
      </table>
    </div>
  `;
}

function reimbursementImportPreviewUpdateConfirmBtn(preview) {
  const btn = document.getElementById('reimbImportConfirmBtn');
  if (!btn) return;
  const canImport = preview && preview.summary && preview.summary.canImport;
  btn.disabled = !canImport;
  btn.textContent = canImport ? '确认导入' : '存在未匹配项，无法导入';
}

async function reimbursementImportPreviewRefresh() {
  if (!reimbImportPending || !reimbImportPending.file) return;
  const payeeEl = document.getElementById('reimbImportPayeeInput');
  const syncEl = document.getElementById('reimbImportSyncActivity');
  reimbImportPending.payeeName = payeeEl ? String(payeeEl.value || '').trim() : reimbImportPending.payeeName;
  reimbImportPending.syncActivity = syncEl ? !!syncEl.checked : true;

  const bodyEl = document.getElementById('modalReimbImportPreviewBody');
  if (bodyEl) bodyEl.style.opacity = '0.55';

  try {
    const fd = new FormData();
    fd.append('file', reimbImportPending.file);
    fd.append('yearFrameId', String(reimbImportPending.yearFrameId));
    if (reimbImportPending.payeeName) fd.append('payeeName', reimbImportPending.payeeName);
    fd.append('syncActivity', reimbImportPending.syncActivity ? '1' : '0');
    const res = await fetch('/api/reimbursements/import/preview', {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || res.statusText || '预览失败');
    reimbImportPending.preview = payload.data || {};
    if (bodyEl) {
      bodyEl.innerHTML = reimbursementBuildImportPreviewHtml(reimbImportPending.preview);
      bodyEl.style.opacity = '';
    }
    reimbursementImportPreviewUpdateConfirmBtn(reimbImportPending.preview);
  } catch (err) {
    if (bodyEl) bodyEl.style.opacity = '';
    showToast('预览刷新失败: ' + (err.message || err), 'error');
  }
}

async function reimbursementImportLoadPreview(file, yearFrameId) {
  reimbImportPending = {
    file,
    yearFrameId,
    payeeName: '',
    syncActivity: true,
    preview: null,
  };
  const bodyEl = document.getElementById('modalReimbImportPreviewBody');
  if (bodyEl) bodyEl.innerHTML = '<p class="reimb-import-preview-loading">正在解析 Excel…</p>';
  reimbursementImportPreviewUpdateConfirmBtn(null);
  openModal('modalReimbImportPreview');
  await reimbursementImportPreviewRefresh();
}

async function reimbursementImportConfirm() {
  if (!reimbImportPending || !reimbImportPending.file) return;
  const preview = reimbImportPending.preview;
  if (!preview || !preview.summary || !preview.summary.canImport) {
    showToast('存在未匹配的项目编号，请修正后再导入', 'warning');
    return;
  }
  const btn = document.getElementById('reimbImportConfirmBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '导入中…';
  }
  const fd = new FormData();
  fd.append('file', reimbImportPending.file);
  fd.append('yearFrameId', String(reimbImportPending.yearFrameId));
  if (reimbImportPending.payeeName) fd.append('payeeName', reimbImportPending.payeeName);
  fd.append('syncActivity', reimbImportPending.syncActivity ? '1' : '0');
  try {
    const res = await fetch('/api/reimbursements/import', {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || res.statusText || '导入失败');
    const data = payload.data || {};
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    showToast(payload.message || data.message || '导入完成', warnings.length ? 'warning' : 'success');
    reimbursementImportPreviewCancel();
    if (currentPage === 'reimbursement') await renderReimbursements();
    void updateBadges();
  } catch (err) {
    showToast('导入失败: ' + (err.message || err), 'error');
    reimbursementImportPreviewUpdateConfirmBtn(preview);
  }
}
