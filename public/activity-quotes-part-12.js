function aqGetPreviewLayoutActiveKey() {
  if (activityQuotesState.view === 'exportPreview') {
    return activityQuotesState.exportPreviewActiveSheetId;
  }
  if (activityQuotesState.view === 'preview') {
    const active = activityQuotesState.previewBundleActive || 'summary';
    if (active === 'summary') return 'summary';
    const sid = parseInt(String(active).replace(/^q-/, ''), 10);
    return Number.isFinite(sid) ? sid : 'summary';
  }
  return null;
}

function aqInitMergedPreviewLayout(bundleQuotes) {
  aqApplyPersistedPdfOrientation();
  const layout = {};
  (bundleQuotes || []).forEach((s) => {
    layout[String(s.id)] = aqGetLayoutForQuote(s.id);
  });
  activityQuotesState.exportLayoutByQuoteId = layout;
  if (!activityQuotesState.exportPdfSettings) {
    activityQuotesState.exportPdfSettings = { pageOrientation: 'landscape' };
  }
}

function aqInitExportPreviewLayout(quotes) {
  aqApplyPersistedPdfOrientation();
  const layout = {};
  (quotes || []).forEach((q) => {
    layout[String(q.id)] = aqGetLayoutForQuote(q.id);
  });
  activityQuotesState.exportLayoutByQuoteId = layout;
  if (!activityQuotesState.exportPdfSettings) {
    activityQuotesState.exportPdfSettings = { pageOrientation: 'landscape' };
  }
}

function aqRefreshPreviewLayoutPanes() {
  if (activityQuotesState.view === 'exportPreview') {
    const layoutPanel = document.getElementById('aqExportLayoutPanel');
    if (layoutPanel) layoutPanel.innerHTML = aqRenderExportLayoutPanel();
    const pane = document.getElementById('aqExportSheetPane');
    if (pane) pane.innerHTML = aqRenderExportActiveSheetPane();
    aqInitPreviewColumnResizeBindings();
    return;
  }
  if (activityQuotesState.view === 'preview' && aqIsMergedPreviewWithLayout()) {
    const layoutPanel = document.getElementById('aqPreviewLayoutPanel');
    if (layoutPanel) layoutPanel.innerHTML = aqRenderExportLayoutPanel();
    const host = document.getElementById('aqPreviewBundleHost');
    if (host) host.innerHTML = aqRenderMultiBundlePreviewBody();
    aqInitPreviewColumnResizeBindings();
  }
}

function aqAfterPreviewPageRender() {
  if (activityQuotesState.view === 'exportPreview' || activityQuotesState.view === 'preview') {
    aqInitPreviewColumnResizeBindings();
  }
}

function aqRenderExportLayoutPanel() {
  const activeId = aqGetPreviewLayoutActiveKey();
  const orient = activityQuotesState.exportPdfSettings?.pageOrientation || 'landscape';
  const orientOpts = [
    ['landscape', '横向 A4'],
    ['portrait', '纵向 A4'],
  ]
    .map(
      ([v, label]) =>
        `<option value="${v}"${orient === v ? ' selected' : ''}>${label}</option>`
    )
    .join('');
  const canEditCols = activeId !== 'summary' && activeId != null;
  let sheetTools = '';
  if (canEditCols) {
    const qid = String(activeId);
    if (!activityQuotesState.exportLayoutByQuoteId[qid]) {
      activityQuotesState.exportLayoutByQuoteId[qid] = aqGetLayoutForQuote(activeId);
    }
    const layout = activityQuotesState.exportLayoutByQuoteId[qid];
    const rh = layout.defaultRowHeight || 7;
    sheetTools = `
      <span class="aq-preview-toolbar-hint">在下方表格表头<strong>拖拽竖线</strong>调整列宽（与 Excel 类似），设置会自动保存</span>
      <label class="aq-preview-toolbar-field">行高(pt)
        <input type="number" class="form-control form-control-sm" min="4" step="0.5" value="${rh}"
          onchange="aqOnExportLayoutChange(${activeId}, 'defaultRowHeight', 0, this.value)">
      </label>
      <button type="button" class="btn btn-ghost btn-sm" onclick="aqResetExportLayoutForActiveSheet()">重置本 Sheet 列宽</button>`;
  } else {
    sheetTools =
      '<span class="aq-preview-toolbar-hint">Summary 页为汇总表；切换到单场 Sheet 后可拖拽表头调整列宽。</span>';
  }
  return `<div class="aq-preview-toolbar">
    <label class="aq-preview-toolbar-field">PDF 纸张方向
      <select class="form-control form-control-sm" onchange="aqOnExportPdfOrientationChange(this.value)">${orientOpts}</select>
    </label>
    ${sheetTools}
  </div>`;
}

function aqOnExportPdfOrientationChange(value) {
  activityQuotesState.exportPdfSettings = activityQuotesState.exportPdfSettings || {};
  activityQuotesState.exportPdfSettings.pageOrientation =
    value === 'portrait' ? 'portrait' : 'landscape';
  aqPersistExportLayout();
}

function aqResetExportLayoutForActiveSheet() {
  const activeId = aqGetPreviewLayoutActiveKey();
  if (activeId === 'summary' || activeId == null) return;
  activityQuotesState.exportLayoutByQuoteId[String(activeId)] = aqDefaultExportLayout();
  aqPersistExportLayout();
  aqRefreshPreviewLayoutPanes();
}

async function aqSetExportActiveSheet(id) {
  activityQuotesState.exportPreviewActiveSheetId = id;
  if (id === 'summary') {
    const ids = (activityQuotesState.exportPreviewQuotes || [])
      .map((q) => Number(q.id))
      .filter(Number.isFinite);
    if (ids.length >= 2) {
      try {
        const res = await api('POST', '/quotations/bundle/preview', { ids });
        const fresh = Array.isArray(res.data) ? res.data : [];
        if (fresh.length) {
          activityQuotesState.exportPreviewQuotes = aqSortQuotesByEventDateAsc(fresh);
        }
      } catch (_) {
        /* 保留当前预览数据 */
      }
    }
  }
  const tabs = document.getElementById('aqExportTabs');
  if (tabs) tabs.innerHTML = aqRenderExportTabsHtml();
  aqRefreshPreviewLayoutPanes();
}

function aqOnExportLayoutChange(quoteId, key, index, value) {
  const qid = String(quoteId);
  if (!activityQuotesState.exportLayoutByQuoteId[qid]) {
    activityQuotesState.exportLayoutByQuoteId[qid] = aqGetLayoutForQuote(quoteId);
  }
  const layout = activityQuotesState.exportLayoutByQuoteId[qid];
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return;
  if (key === 'columnWidths') {
    if (!Array.isArray(layout.columnWidths)) layout.columnWidths = aqDefaultExportLayout().columnWidths.slice();
    layout.columnWidths[index] = Math.round(n * 100) / 100;
  } else if (key === 'defaultRowHeight') {
    layout.defaultRowHeight = Math.round(n * 100) / 100;
  }
  aqPersistExportLayout();
  if (key === 'columnWidths') {
    const host =
      document.getElementById('aqExportSheetPane') || document.getElementById('aqPreviewBundleHost');
    const table = host?.querySelector?.(`.aq-export-preview-table[data-quote-id="${qid}"]`);
    if (table) aqApplyColumnWidthsToTable(table, layout.columnWidths);
    return;
  }
  aqRefreshPreviewLayoutPanes();
}

function aqBindPreviewColumnResize(container, quoteId) {
  if (!container || quoteId == null) return;
  const table = container.querySelector(`.aq-export-preview-table[data-quote-id="${quoteId}"]`);
  if (!table || table.dataset.resizeBound === '1') return;
  table.dataset.resizeBound = '1';
  const qid = String(quoteId);
  table.querySelectorAll('.aq-col-resizer').forEach((handle) => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const col = parseInt(handle.getAttribute('data-col'), 10);
      if (!Number.isFinite(col)) return;
      if (!activityQuotesState.exportLayoutByQuoteId[qid]) {
        activityQuotesState.exportLayoutByQuoteId[qid] = aqGetLayoutForQuote(quoteId);
      }
      const layout = activityQuotesState.exportLayoutByQuoteId[qid];
      const startWidths = (layout.columnWidths || aqDefaultExportLayout().columnWidths).map((w) => Number(w) || 1);
      const totalUnits = startWidths.reduce((a, b) => a + b, 0) || 1;
      const neighbor = col < startWidths.length - 1 ? col + 1 : col - 1;
      if (neighbor < 0) return;
      const startX = e.clientX;
      const tableW = table.getBoundingClientRect().width || 1;
      const minW = 1;
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const deltaUnits = (dx / tableW) * totalUnits;
        const widths = startWidths.slice();
        let nextCol = widths[col] + deltaUnits;
        let nextNeighbor = widths[neighbor] - deltaUnits;
        if (nextCol < minW) {
          nextNeighbor -= minW - nextCol;
          nextCol = minW;
        }
        if (nextNeighbor < minW) {
          nextCol -= minW - nextNeighbor;
          nextNeighbor = minW;
        }
        widths[col] = Math.round(nextCol * 100) / 100;
        widths[neighbor] = Math.round(nextNeighbor * 100) / 100;
        layout.columnWidths = widths;
        aqApplyColumnWidthsToTable(table, widths);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('aq-col-resizing');
        aqPersistExportLayout();
      };
      document.body.classList.add('aq-col-resizing');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function aqInitPreviewColumnResizeBindings() {
  const activeId = aqGetPreviewLayoutActiveKey();
  if (activeId === 'summary' || activeId == null) return;
  const host = document.getElementById('aqExportSheetPane') || document.getElementById('aqPreviewBundleHost');
  if (!host) return;
  host.querySelectorAll('.aq-export-preview-table').forEach((t) => {
    t.dataset.resizeBound = '';
  });
  aqBindPreviewColumnResize(host, activeId);
}
