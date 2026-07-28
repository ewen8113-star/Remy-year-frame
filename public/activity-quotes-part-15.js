function aqAddCustomSection() {
  const q = activityQuotesState.editing;
  if (!q || aqIsMultiQuote(q)) return;
  const codeRaw = window.prompt('大板块编号（如 F、G）', 'F');
  if (codeRaw == null) return;
  const nameRaw = window.prompt('大板块名称（如 其他费用）', '');
  if (nameRaw == null) return;
  const sectionCode = String(codeRaw).trim().toUpperCase();
  const sectionName = String(nameRaw).trim();
  if (!sectionCode || !sectionName) {
    showToast('请填写板块编号和名称', 'warning');
    return;
  }
  const exists = (q.items || []).some(
    (it) => String(it.section_code || '').trim().toUpperCase() === sectionCode
  );
  if (exists) {
    showToast('该大板块编号已存在，请在本板块下添加行', 'warning');
    return;
  }
  const subCode = `${sectionCode}-1`;
  q.items.push({
    section_code: sectionCode,
    section_name: sectionName,
    subsection_code: subCode,
    subsection_name: '',
    item_category: '',
    description: '',
    quantity: 0,
    unit: '项',
    unit_price: 0,
    subtotal: 0,
    remarks: '',
    sort_order: aqSortOrderFromSubsectionCode(subCode) || 9000,
    is_custom: 1,
    is_template: 0,
  });
  aqPrepareEditingItems({ skipRenumber: true });
  aqRefreshEditView();
  showToast(`已添加大板块 ${aqFormatSectionHeaderLabel(sectionCode, sectionName)}`, 'success');
}

function aqRefreshEditView() {
  const host = document.getElementById('aqEditTableBody');
  const multiHost = document.getElementById('aqMultiGridBody');
  const foot = document.getElementById('aqEditTotals');
  const q = activityQuotesState.editing;
  if (!q) return;
  if (aqIsMultiQuote(q)) {
    if (multiHost) {
      multiHost.innerHTML = aqRenderMultiGridRows(q);
      requestAnimationFrame(() => aqSyncMultiFeeInputsFromState());
    }
  } else if (host) {
    host.innerHTML = aqRenderEditTableRows(q);
    aqRefreshSectionSubtotals();
    aqAutoResizeAllDescTextareas(host);
    aqInitEditRowDragListeners();
  }
  if (foot) {
    const t = aqCalcTotalsForQuote(q);
    foot.innerHTML = `
      <div class="aq-totals-grid">
        <span>不含税小计</span><strong>${aqFmtNum(t.subtotalExTax)}</strong>
        <span>服务费 (${Math.round(t.serviceRate * 100)}%)</span><strong>${aqFmtNum(t.serviceCharge)}</strong>
        <span>税费 (6%)</span><strong>${aqFmtNum(t.taxAmount)}</strong>
        <span>含税总计</span><strong class="aq-total-amt">${aqFmtNum(t.totalAmount)}</strong>
      </div>`;
  }
}

async function aqOpenCreate() {
  if (!currentYearFrameId) {
    showToast('请先在左侧选择财年，再新建单场报价', 'warning');
    return;
  }
  activityQuotesState.createForm = {
    activity_id: null,
    project_code: '',
    client_brand: 'REMY COINTREAU',
    client_contact: '',
    project_name: '',
    event_date: '',
    city: '',
    event_type: '',
    service_rate: aqDefaultServiceRate(),
  };
  try {
    await Promise.all([aqLoadTemplateSections(), aqLoadActivitiesForPicker()]);
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
    return;
  }
  if (!activityQuotesState.createActivities.length) {
    showToast('当前财年暂无已填写项目编号的场次，请先在场次记录中创建', 'warning');
    return;
  }
  aqRenderCreateModal();
  openModal('modalActivityQuote');
}

async function aqOpenMultiCreate() {
  if (!currentYearFrameId) {
    showToast('请先在左侧选择财年，再新建多场报价', 'warning');
    return;
  }
  activityQuotesState.multiFilterRegion = '';
  activityQuotesState.multiFilterBelonging = '';
  activityQuotesState.multiFilterDateFrom = '';
  activityQuotesState.multiFilterDateTo = '';
  activityQuotesState.multiPickSelectedIds = [];
  activityQuotesState.multiAddSelectedIds = [];
  activityQuotesState.multiProjectName = '';
  activityQuotesState.editing = null;
  try {
    await Promise.all([aqLoadActivitiesForPicker(), aqEnsureBelongingFilterOptions()]);
    if (!activityQuotesState.createActivities.length) {
      showToast('当前财年暂无已填写项目编号的场次，请先在场次记录中创建', 'warning');
      return;
    }
    activityQuotesState.view = 'multiPick';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
  }
}

async function aqOpenExportQuote() {
  if (!currentYearFrameId) {
    showToast('请先在左侧选择财年，再合并导出报价', 'warning');
    return;
  }
  activityQuotesState.multiFilterRegion = '';
  activityQuotesState.multiFilterBelonging = '';
  activityQuotesState.multiFilterDateFrom = '';
  activityQuotesState.multiFilterDateTo = '';
  activityQuotesState.exportPickSelectedIds = [];
  activityQuotesState.exportPreviewQuotes = [];
  activityQuotesState.exportPreviewActiveSheetId = null;
  activityQuotesState.exportLayoutByQuoteId = {};
  activityQuotesState.exportMergeProjectName = '';
  activityQuotesState.editing = null;
  activityQuotesState.view = 'exportPick';
  await renderActivityQuotes();
}

function aqGetFilteredExportPickQuotes() {
  return (activityQuotesState.list || []).filter((q) => {
    if (!q || String(q.quote_mode || 'single') !== 'single') return false;
    const date = aqNormalizeEventDate(q.event_date);
    const region = activityQuotesState.multiFilterRegion || '';
    const belonging = activityQuotesState.multiFilterBelonging || '';
    const df = activityQuotesState.multiFilterDateFrom || '';
    const dt = activityQuotesState.multiFilterDateTo || '';
    if (df && (!date || date < df)) return false;
    if (dt && (!date || date > dt)) return false;
    if (region || belonging) {
      const act = (activityQuotesState.createActivities || []).find(
        (a) => String(a.project_code || '').trim() === String(q.project_code || '').trim()
      );
      if (region && String(act?.region || '').trim() !== region) return false;
      if (belonging && aqActivityBelongingValue(act) !== belonging) return false;
    }
    return true;
  });
}

function aqIsExportPickAllSelected() {
  const rows = aqGetFilteredExportPickQuotes();
  if (!rows.length) return false;
  const selected = new Set((activityQuotesState.exportPickSelectedIds || []).map(Number));
  return rows.every((r) => selected.has(Number(r.id)));
}

async function aqToggleExportPickAll(checked) {
  if (checked) {
    activityQuotesState.exportPickSelectedIds = aqGetFilteredExportPickQuotes()
      .map((r) => Number(r.id))
      .filter(Number.isFinite);
  } else {
    activityQuotesState.exportPickSelectedIds = [];
  }
  await renderActivityQuotes();
}

function aqRenderExportPickRows() {
  const selected = new Set((activityQuotesState.exportPickSelectedIds || []).map(Number));
  const rows = aqGetFilteredExportPickQuotes();
  if (!rows.length) return '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">无符合条件的单场报价</td></tr>';
  return rows
    .map((r) => `<tr>
      <td><input type="checkbox"${selected.has(Number(r.id)) ? ' checked' : ''} onchange="aqToggleExportPickId(${r.id}, this.checked)"></td>
      <td><code>${escapeHtml(r.project_code || '—')}</code></td>
      <td>${escapeHtml(r.project_name || '—')}</td>
      <td>${escapeHtml(r.city || '—')}</td>
      <td>${escapeHtml(r.customer_name || '—')}</td>
      <td>${escapeHtml(aqResolveQuoteEventDate(r) || '—')}</td>
      <td>${escapeHtml(r.event_type || '—')}</td>
      <td class="numeric">${fmtMoney(r.total_amount)}</td>
    </tr>`)
    .join('');
}

function aqToggleExportPickId(id, checked) {
  const ids = new Set((activityQuotesState.exportPickSelectedIds || []).map(Number));
  if (checked) ids.add(Number(id));
  else ids.delete(Number(id));
  activityQuotesState.exportPickSelectedIds = [...ids];
  const btn = document.getElementById('aqExportPickNextBtn');
  if (btn) btn.textContent = `下一步（已选 ${ids.size} 条报价）`;
}

async function aqConfirmExportPickStep() {
  const ids = (activityQuotesState.exportPickSelectedIds || []).map(Number).filter(Number.isFinite);
  if (!ids.length) {
    showToast('请至少选择 1 条报价', 'warning');
    return;
  }
  const projectName = String(
    document.getElementById('aqExportPickProjectName')?.value || activityQuotesState.exportMergeProjectName || ''
  ).trim();
  if (!projectName) {
    showToast('请填写报价单名称', 'warning');
    return;
  }
  activityQuotesState.exportMergeProjectName = projectName;
  try {
    const res = await api('POST', '/quotations/bundle/preview', { ids });
    const quotes = Array.isArray(res.data) ? res.data : [];
    if (!quotes.length) {
      showToast('未加载到可预览的报价', 'warning');
      return;
    }
    const sortedQuotes = aqSortQuotesByEventDateAsc(quotes);
    activityQuotesState.exportPreviewQuotes = sortedQuotes;
    activityQuotesState.exportPreviewActiveSheetId = 'summary';
    aqInitExportPreviewLayout(sortedQuotes);
    activityQuotesState.view = 'exportPreview';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '加载预览失败', 'error');
  }
}

function aqRenderExportPickHtml() {
  const selected = (activityQuotesState.exportPickSelectedIds || []).length;
  const nameVal = activityQuotesState.exportMergeProjectName || '';
  const pickAllChecked = aqIsExportPickAllSelected() ? ' checked' : '';
  return `<div class="aq-edit-head">
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqBackToList()">← 返回列表</button>
      <span class="aq-multi-pick-step-title">合并导出报价 · 第 1 步：筛选并选择报价</span>
    </div>
    <div class="aq-multi-pick-wrap">
      <div class="aq-multi-sessions-head aq-multi-pick-head">
        <div class="aq-multi-sessions-head-main">
          <h3 class="aq-multi-title">筛选条件</h3>
          ${aqRenderMultiFilterSelectsHtml()}
        </div>
      </div>
      <div class="aq-multi-pick-name-row form-group">
        <label class="form-label" for="aqExportPickProjectName">报价单名称 *</label>
        <input type="text" class="form-control" id="aqExportPickProjectName" value="${escapeHtml(nameVal)}"
          placeholder="如 深圳晚宴等2场合并报价" oninput="activityQuotesState.exportMergeProjectName=this.value">
      </div>
      <div class="table-wrapper aq-multi-pick-table-scroll">
        <table class="data-table aq-multi-pick-table">
          <thead><tr><th style="width:40px"><input type="checkbox" title="全选/取消全选当前筛选结果"${pickAllChecked} onchange="aqToggleExportPickAll(this.checked)"></th><th>项目编号</th><th>报价名称</th><th>城市</th><th>客户</th><th>活动日期</th><th>类型</th><th class="numeric">含税总计</th></tr></thead>
          <tbody>${aqRenderExportPickRows()}</tbody>
        </table>
      </div>
      <div class="aq-multi-pick-actions">
        <button type="button" class="btn btn-secondary" onclick="aqBackToList()">取消</button>
        <button type="button" class="btn btn-primary" id="aqExportPickNextBtn" onclick="aqConfirmExportPickStep()">下一步（已选 ${selected} 条报价）</button>
      </div>
    </div>`;
}
