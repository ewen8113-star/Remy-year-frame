function aqRenderMultiBundlePreviewBody() {
  const q = activityQuotesState.editing;
  if (!q) return '';
  const list = activityQuotesState.previewBundleQuotes || [];
  const active = activityQuotesState.previewBundleActive || 'summary';
  const useBundleSummary = list.length > 0 && aqIsMergedExportQuote(q);
  const summaryLayout = useBundleSummary
    ? aqBuildSummaryPreviewLayout({ quotes: list })
    : aqBuildSummaryPreviewLayout({ sessions: q.linked_sessions || [] });
  const summaryTbody = useBundleSummary
    ? aqRenderBundleSummaryPreviewTable(list, summaryLayout)
    : aqRenderMultiPreviewTable(q, summaryLayout);
  if (!list.length) {
    return `<div class="table-wrapper qt-table-scroll aq-multi-preview-scroll">
      <table class="qt-detail-table aq-multi-preview-table">
        <thead>${aqMultiPreviewHeadHtml(summaryLayout)}</thead>
        <tbody>${summaryTbody}</tbody>
      </table>
    </div>`;
  }
  const tabs = [
    `<button type="button" class="btn btn-xs ${active === 'summary' ? 'btn-primary' : 'btn-secondary'}" onclick="aqSetPreviewBundleActive('summary')">Summary</button>`,
    ...list.map(
      (s, i) =>
        `<button type="button" class="btn btn-xs ${active === `q-${s.id}` ? 'btn-primary' : 'btn-secondary'}" onclick="aqSetPreviewBundleActive('q-${s.id}')" title="${escapeHtml(s.project_code || '')}">${escapeHtml(aqSheetLabelForQuote(s, i))}</button>`
    ),
  ].join('');
  let body = '';
  if (active === 'summary') {
    body = `<div class="qt-sheet-wrap">
      ${aqRenderQtHeaderHtml(aqBuildMergedSummaryHeaderQ(), true)}
      <div class="info-row form-hint qt-header-extra">Summary 多场报价（一行一场）</div>
      <div class="table-wrapper qt-table-scroll aq-multi-preview-scroll">
        <table class="qt-detail-table aq-multi-preview-table">
          <thead>${aqMultiPreviewHeadHtml(summaryLayout)}</thead>
          <tbody>${summaryTbody}</tbody>
        </table>
      </div>
    </div>`;
  } else {
    const sid = parseInt(String(active).replace(/^q-/, ''), 10);
    const single = list.find((x) => Number(x.id) === sid);
    body = single
      ? `<div class="table-wrapper qt-table-scroll">${aqRenderQuotePreviewTableForExport(single)}</div>`
      : '<div class="empty-state">该场次报价不存在</div>';
  }
  return `<div class="aq-export-tabs">${tabs}</div><div class="aq-preview-table-stage">${body}</div>`;
}

async function aqDelete(id) {
  if (!confirm('确定删除该报价？')) return;
  try {
    await api('DELETE', `/quotations/${id}`);
    showToast('已删除', 'success');
    if (activityQuotesState.editing && activityQuotesState.editing.id === id) {
      activityQuotesState.editing = null;
      activityQuotesState.view = 'list';
    }
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

async function aqCancelMultiEdit() {
  const q = activityQuotesState.editing;
  if (!q || !aqIsMultiQuote(q)) {
    activityQuotesState.view = 'list';
    activityQuotesState.editing = null;
    await renderActivityQuotes();
    return;
  }
  const wasPristine = aqIsMultiPristine();
  if (!(await aqTryLeaveMultiEdit(true))) return;
  activityQuotesState.view = 'list';
  activityQuotesState.editing = null;
  activityQuotesState.multiDraftPristine = false;
  await renderActivityQuotes();
  if (wasPristine) showToast('已取消，未保存的空报价已删除', 'success');
}

async function aqBackToList() {
  if (
    activityQuotesState.view === 'multiPick' ||
    activityQuotesState.view === 'exportPick' ||
    activityQuotesState.view === 'exportPreview'
  ) {
    activityQuotesState.view = 'list';
    activityQuotesState.multiPickSelectedIds = [];
    activityQuotesState.exportPickSelectedIds = [];
    activityQuotesState.exportPreviewQuotes = [];
    activityQuotesState.exportMergeProjectName = '';
    activityQuotesState.editing = null;
    await renderActivityQuotes();
    return;
  }
  const q = activityQuotesState.editing;
  if (activityQuotesState.view === 'edit' && q && aqIsMultiQuote(q)) {
    const wasPristine = aqIsMultiPristine();
    if (!(await aqTryLeaveMultiEdit(false))) return;
    if (wasPristine) showToast('未编辑的空报价已自动删除', 'success');
  }
  activityQuotesState.view = 'list';
  activityQuotesState.editing = null;
  activityQuotesState.multiDraftPristine = false;
  aqClearMergedEditState();
  await renderActivityQuotes();
}

function aqRenderListSummaryHtml() {
  const s = activityQuotesState.listSummary;
  if (!s) return '';
  const quoted = Number(s.quotedActivityCount) || 0;
  const total = Number(s.activityCount) || 0;
  return `
    <div class="aq-list-summary">
      <div class="aq-list-summary-main">
        <span class="aq-list-summary-label">当前年框有效报价合计（去重）</span>
        <span class="aq-list-summary-value amount amount-revenue">${fmtMoney(s.effectiveTotal)}</span>
      </div>
      <div class="aq-list-summary-sub">按场次统计，已排除被合并报价取代的单场单据 · ${quoted} 场有报价 / ${total} 场</div>
    </div>`;
}

function aqRenderListHtml() {
  const rows = activityQuotesState.list;
  const canWrite = currentUserRole === 'admin';
  const tbody = rows.length
    ? rows
        .map((r) => {
          const date = aqResolveQuoteEventDate(r) || '—';
          return `<tr>
            <td class="aq-list-pc-cell">${aqRenderListProjectCodeCell(r)}</td>
            <td>${escapeHtml(r.project_name || '—')}</td>
            <td>${escapeHtml(r.city || '—')}</td>
            <td>${escapeHtml(r.customer_name || '—')}</td>
            <td>${date}</td>
            <td>${escapeHtml(r.event_type || '—')}</td>
            <td class="numeric">${fmtMoney(r.total_amount)}</td>
            <td class="aq-list-actions">
              <button type="button" class="btn btn-xs btn-secondary" onclick="aqOpenPreview(${r.id})">预览</button>
              <button type="button" class="btn btn-xs btn-primary" onclick="aqOpenEdit(${r.id})">编辑</button>
              ${canWrite ? `<button type="button" class="btn btn-xs btn-ghost" style="color:var(--danger)" onclick="aqDelete(${r.id})">删除</button>` : ''}
            </td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="8" style="color:var(--text-muted);text-align:center">暂无报价，点击「新建单场报价」或「新建多场报价」开始</td></tr>';

  return `
    <div class="page-toolbar aq-toolbar">
      <div class="aq-toolbar-filters">
        <input type="search" class="form-control form-control-sm" placeholder="搜索项目/客户/城市"
          value="${escapeHtml(activityQuotesState.filterQ)}"
          oninput="aqOnFilterQ(this.value)" style="max-width:280px">
      </div>
      ${canWrite ? `<div class="aq-toolbar-actions"><button type="button" class="btn btn-primary btn-sm" onclick="aqOpenCreate()">+ 新建单场报价</button><button type="button" class="btn btn-secondary btn-sm" onclick="aqOpenMultiCreate()">+ 新建多场报价</button><button type="button" class="btn btn-secondary btn-sm" onclick="aqOpenExportQuote()">合并导出报价</button></div>` : ''}
    </div>
    <div class="table-wrapper">
      <table class="data-table aq-list-table">
        <thead><tr>
          <th class="aq-list-pc-col">项目编号</th><th>报价单名称</th><th>城市</th><th>客户</th><th>活动日期</th>
          <th>类型</th><th class="numeric">含税总计</th><th class="aq-list-actions-col">操作</th>
        </tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
    ${aqRenderListSummaryHtml()}`;
}

function aqRenderEditHtml() {
  const q = activityQuotesState.editing;
  if (!q) return '';
  const isMulti = aqIsMultiQuote(q);
  const pct = isMulti ? 10 : Math.round((parseFloat(q.service_rate) || aqDefaultServiceRate()) * 100);
  const multiGridBlock = isMulti
    ? `<div class="aq-multi-grid-wrap">
        <datalist id="aqMultiProjectList"></datalist>
        <div class="aq-multi-sessions-head">
          <div class="aq-multi-sessions-head-main">
            <h3 class="aq-multi-title">Summary 多场报价（一行一场）</h3>
            ${aqRenderMultiFilterSelectsHtml()}
          </div>
          <button type="button" class="btn btn-xs btn-secondary" onclick="aqAddMultiSession()">从筛选添加场次</button>
        </div>
        <div class="aq-multi-add-panel">
          <div class="aq-multi-add-panel-head">
            <strong>从筛选结果批量添加</strong>
            <div class="aq-multi-add-panel-actions">
              <button type="button" class="btn btn-xs btn-secondary" id="aqMultiAddToggleAllBtn" onclick="aqToggleMultiAddSelectAll()">全选</button>
              <button type="button" class="btn btn-xs btn-primary" onclick="aqAddSelectedSessionsFromPanel()">添加所选到场次表</button>
            </div>
          </div>
          <div id="aqMultiAddPanelBody" class="aq-multi-add-panel-body">${aqRenderMultiAddPanelRows()}</div>
        </div>
        <div class="table-wrapper aq-multi-grid-scroll">
          <table class="data-table aq-multi-grid-table">
            <thead>${aqMultiGridHeadHtml()}</thead>
            <tbody id="aqMultiGridBody">${aqRenderMultiGridRows(q)}</tbody>
          </table>
        </div>
        <p class="form-hint aq-multi-hint">在表格中填写各行费用；项目编号请在上方「从筛选结果批量添加」中勾选场次。筛选后「全选」/「取消全选」可循环切换。</p>
      </div>`
    : '';
  const feeTableHead = isMulti
    ? ''
    : `<thead><tr>
            <th>Item</th><th>分类</th><th>说明</th><th>数量</th><th>单位</th><th>单价</th><th>单项小计</th><th>备注</th>
            <th class="aq-col-drag" title="拖动排序"></th><th class="aq-col-actions"></th>
          </tr></thead>`;
  const feeTableClass = isMulti ? '' : 'qt-detail-table aq-edit-table-sticky-head';
  const linkedLabel = isMulti
    ? '<span class="aq-badge-multi">多场报价</span>'
    : `<code class="aq-linked-pc">${escapeHtml(q.project_code || q.activity_project_code || '—')}</code>`;
  const singleTableBlock = isMulti
    ? ''
    : `<div class="table-wrapper qt-table-scroll aq-edit-table-scroll">
        <table class="${feeTableClass}">
          ${feeTableHead}
          <tbody id="aqEditTableBody">${aqRenderEditTableRows(q)}</tbody>
        </table>
      </div>`;
  return `
    <div class="aq-edit-head">
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqBackToList()">← 返回列表</button>
      <div class="aq-edit-head-meta">
        ${linkedLabel}
        ${
          isMulti
            ? `<label class="aq-multi-project-name-field">
            <span class="aq-multi-project-name-label">报价名称</span>
            <input type="text" class="form-control form-control-sm" id="aqMultiProjectName"
              value="${escapeHtml(q.project_name || activityQuotesState.multiProjectName || '')}"
              placeholder="请输入报价名称" oninput="aqOnMultiProjectNameInput(this.value)">
          </label>`
            : `<span class="form-hint">${escapeHtml(q.city || '')} · ${escapeHtml(q.customer_name || '')}</span>`
        }
      </div>
      <div class="aq-edit-head-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="aqOpenPreview(${q.id})">预览版式</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="aqExportPdf(${q.id})">导出PDF</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="aqExportExcel(${q.id})">导出Excel</button>
        ${isMulti ? '<button type="button" class="btn btn-secondary btn-sm" onclick="aqCancelMultiEdit()">取消</button>' : ''}
        <button type="button" class="btn btn-primary btn-sm" onclick="aqSaveEditing()">保存</button>
      </div>
    </div>
    <div class="qt-sheet-wrap">
      ${aqRenderQtHeaderHtml(q, false, { editable: true })}
      <div class="info-row form-hint qt-header-extra">服务费率 ${pct}% · ${isMulti ? 'Summary 模版 · 每场独立报价' : `活动类型 ${escapeHtml(q.event_type || '—')}`}</div>
      ${multiGridBlock}
      ${singleTableBlock}
      <div id="aqEditTotals" class="aq-totals-bar"></div>
      <p class="form-hint aq-edit-undo-hint">删除明细行后可用 <kbd>Ctrl</kbd>+<kbd>Z</kbd>（Mac：<kbd>⌘</kbd>+<kbd>Z</kbd>）撤销；行尾 <span class="aq-hint-grip" aria-hidden="true"></span> 可按住拖动排序。米色表头行可编辑板块编号与名称。</p>
    </div>`;
}
