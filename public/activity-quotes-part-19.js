function aqRenderPreviewHtml() {
  const q = activityQuotesState.editing;
  if (!q) return '';
  const mergedLayout = aqIsMergedPreviewWithLayout();
  const isMulti = aqIsMultiQuote(q);
  const hasBundleSheets = (activityQuotesState.previewBundleQuotes || []).length > 0;
  let previewBody = '';
  if (mergedLayout) {
    previewBody = `<div class="aq-preview-workspace">
      <div id="aqPreviewLayoutPanel">${aqRenderExportLayoutPanel()}</div>
      <div id="aqPreviewBundleHost">${aqRenderMultiBundlePreviewBody()}</div>
    </div>`;
  } else if (isMulti) {
    previewBody = `<div id="aqPreviewBundleHost">${aqRenderMultiBundlePreviewBody()}</div>`;
  } else {
    previewBody = `<div class="table-wrapper qt-table-scroll">
      <table class="qt-detail-table">
        <thead><tr>
          <th>内容<br>Item</th><th>分类</th><th>说明<br>Summary</th>
          <th>数量<br>Quantity</th><th>单位<br>Unit</th><th>单价<br>Unit Price</th>
          <th>单项小计<br>Subtotal</th><th>备注<br>Remarks</th>
        </tr></thead>
        <tbody>${aqRenderPreviewTable(q)}</tbody>
      </table>
    </div>`;
  }
  const exportBtns = mergedLayout
    ? `<button type="button" class="btn btn-secondary btn-sm" onclick="aqExportPdfFromMergedPreview()">导出 PDF</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqExportExcelFromMergedPreview()">导出 Excel</button>`
    : `<button type="button" class="btn btn-secondary btn-sm" onclick="aqExportPdf(${q.id})">导出PDF</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqExportExcel(${q.id})">导出Excel</button>`;
  return `
    <div class="aq-edit-head">
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqBackToList()">← 返回列表</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqReenterMultiEdit()">编辑</button>
      ${exportBtns}
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqPrintPreview()">打印</button>
    </div>
    <div class="qt-sheet-wrap qt-print-area">
      ${mergedLayout || (isMulti && hasBundleSheets) ? '' : aqRenderQtHeaderHtml(q, true)}
      ${previewBody}
    </div>`;
}

function aqOnFilterQ(v) {
  clearTimeout(activityQuotesState._qTimer);
  activityQuotesState._qTimer = setTimeout(async () => {
    activityQuotesState.filterQ = v;
    await renderActivityQuotes();
  }, 350);
}

async function renderActivityQuotes() {
  const container = document.getElementById('pageContainer');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">加载中…</div>';
  try {
    if (activityQuotesState.view === 'list') {
      await aqLoadList();
      container.innerHTML = `<div class="aq-page"><h2 class="page-title">活动报价</h2>${aqRenderListHtml()}</div>`;
    } else if (activityQuotesState.view === 'multiPick') {
      await Promise.all([aqLoadActivitiesForPicker(), aqEnsureBelongingFilterOptions()]);
      container.innerHTML = `<div class="aq-page aq-page-multi-pick"><h2 class="page-title">活动报价</h2>${aqRenderMultiPickHtml()}</div>`;
    } else if (activityQuotesState.view === 'exportPick') {
      await Promise.all([aqLoadList(), aqLoadActivitiesForPicker(), aqEnsureBelongingFilterOptions()]);
      container.innerHTML = `<div class="aq-page aq-page-multi-pick"><h2 class="page-title">活动报价</h2>${aqRenderExportPickHtml()}</div>`;
    } else if (activityQuotesState.view === 'exportPreview') {
      container.innerHTML = `<div class="aq-page aq-page-preview"><h2 class="page-title">活动报价</h2>${aqRenderExportPreviewHtml()}</div>`;
    } else if (activityQuotesState.view === 'mergedEdit') {
      container.innerHTML = `<div class="aq-page aq-page-edit aq-page-merged-edit">${aqRenderMergedEditHtml()}</div>`;
      aqRefreshEditView();
    } else if (activityQuotesState.view === 'edit') {
      if (activityQuotesState.editing && aqIsMultiQuote(activityQuotesState.editing)) {
        await Promise.all([aqLoadActivitiesForPicker(), aqEnsureBelongingFilterOptions()]);
      }
      container.innerHTML = `<div class="aq-page aq-page-edit">${aqRenderEditHtml()}</div>`;
      aqRefreshEditView();
      if (activityQuotesState.editing && aqIsMultiQuote(activityQuotesState.editing)) {
        aqFillMultiProjectDatalist();
        aqUpdateMultiAddToggleAllBtn();
      }
    } else if (activityQuotesState.view === 'preview') {
      container.innerHTML = `<div class="aq-page aq-page-preview">${aqRenderPreviewHtml()}</div>`;
    }
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message || '')}</div></div>`;
  }
  renderLucideIcons();
  aqAfterPreviewPageRender();
  aqBindQuoteEditUndoKeys();
}
