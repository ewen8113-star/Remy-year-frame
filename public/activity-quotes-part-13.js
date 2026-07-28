function aqRenderExportActiveSheetPane() {
  const activeId = activityQuotesState.exportPreviewActiveSheetId;
  if (activeId === 'summary') {
    const rows = activityQuotesState.exportPreviewQuotes || [];
    const colLayout = aqBuildSummaryPreviewLayout({ quotes: rows });
    const sum = { subtotal_ex_tax: 0, service_charge: 0, tax_amount: 0, row_total: 0 };
    const trs = rows
      .map((q) => {
        sum.subtotal_ex_tax += Number(q.subtotal_ex_tax) || 0;
        sum.service_charge += Number(q.service_charge) || 0;
        sum.tax_amount += Number(q.tax_amount) || 0;
        sum.row_total += Number(q.total_amount) || 0;
        const secs = aqSectionTotalsFromQuote(q);
        const sectionTds = colLayout.sectionCols
          .map(
            (col) =>
              `<td class="numeric">${aqFmtNum(aqSectionAmount(secs, col.section_code, col.section_name))}</td>`
          )
          .join('');
        const totalTds = colLayout.totalCols
          .map((col) => {
            const v = Number(q[col.quoteKey]) || 0;
            return `<td class="numeric formula-field">${aqFmtNum(v)}</td>`;
          })
          .join('');
        return `<tr>
          <td>${escapeHtml(aqNormalizeEventDate(q.event_date) || '—')}</td>
          <td>${escapeHtml(q.city || '—')}</td>
          <td>${escapeHtml(q.customer_name || '—')}</td>
          <td>${escapeHtml(q.event_type || '—')}</td>
          ${sectionTds}
          ${totalTds}
          <td class="remark left aq-remarks-cell">—</td>
        </tr>`;
      })
      .join('');
    const footTds = colLayout.totalCols
      .map((col) => `<td class="numeric formula-field">${aqFmtNum(sum[col.key])}</td>`)
      .join('');
    return `<div class="qt-sheet-wrap">
      ${aqRenderQtHeaderHtml(aqBuildMergedSummaryHeaderQ(), true)}
      <div class="info-row form-hint qt-header-extra">Summary 多场报价（一行一场）</div>
      <div class="table-wrapper qt-table-scroll">
        <table class="qt-detail-table">
          <thead>${aqMultiPreviewHeadHtml(colLayout)}</thead>
          <tbody>${trs}<tr class="qt-footer-row qt-total-row">
            <td colspan="${aqMultiPreviewColsBeforeTotals(colLayout.sectionCols.length)}" style="text-align:right">多场含税总计</td>
            ${footTds}
            <td class="aq-remarks-cell"></td>
          </tr></tbody>
        </table>
      </div>
    </div>`;
  }
  const q = (activityQuotesState.exportPreviewQuotes || []).find((x) => Number(x.id) === Number(activeId));
  if (!q) return '<div class="empty-state">请选择一个 Sheet</div>';
  return `<div class="qt-sheet-wrap">
      ${aqRenderQtHeaderHtml(q, true)}
      <div class="table-wrapper qt-table-scroll">${aqRenderQuotePreviewTableForExport(q)}</div>
    </div>`;
}

function aqRenderExportTabsHtml() {
  const quotes = activityQuotesState.exportPreviewQuotes || [];
  const active = activityQuotesState.exportPreviewActiveSheetId;
  const summaryBtn = `<button type="button" class="btn btn-xs ${active === 'summary' ? 'btn-primary' : 'btn-secondary'}" onclick="aqSetExportActiveSheet('summary')">Summary</button>`;
  const quoteBtns = quotes
    .map((q) => {
      const on = Number(active) === Number(q.id);
      return `<button type="button" class="btn btn-xs ${on ? 'btn-primary' : 'btn-secondary'}" onclick="aqSetExportActiveSheet(${q.id})" title="${escapeHtml(q.project_code || '')}">${escapeHtml(aqSheetLabelForQuote(q))}</button>`;
    })
    .join('');
  return `${summaryBtn}${quoteBtns}`;
}

async function aqExportPdfFromMergedPreview() {
  const q = activityQuotesState.editing;
  if (!q || !q.id) {
    showToast('请先打开合并报价预览', 'warning');
    return;
  }
  try {
    const res = await fetch(`/api/quotations/${q.id}/export-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        layoutByQuoteId: activityQuotesState.exportLayoutByQuoteId || {},
        pageOrientation: activityQuotesState.exportPdfSettings?.pageOrientation || 'landscape',
      }),
    });
    if (!res.ok) {
      let msg = `导出失败（${res.status}）`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    const filename = aqParseDownloadFilename(res, `quotation-${q.id}.pdf`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('报价 PDF 已导出', 'success');
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
}

async function aqExportExcelFromMergedPreview() {
  const q = activityQuotesState.editing;
  if (!q || !q.id) {
    showToast('请先打开合并报价预览', 'warning');
    return;
  }
  try {
    const res = await fetch(`/api/quotations/${q.id}/export-excel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        layoutByQuoteId: activityQuotesState.exportLayoutByQuoteId || {},
      }),
    });
    if (!res.ok) {
      let msg = `导出失败（${res.status}）`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    const filename = aqParseDownloadFilename(res, `quotation-${q.id}.xlsx`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('报价 Excel 已导出', 'success');
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
}

async function aqExportPdfFromPreview() {
  const ids = (activityQuotesState.exportPreviewQuotes || []).map((q) => Number(q.id)).filter(Number.isFinite);
  if (!ids.length) {
    showToast('请先选择报价', 'warning');
    return;
  }
  const projectName = String(activityQuotesState.exportMergeProjectName || '').trim();
  try {
    const res = await fetch('/api/quotations/bundle/export-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        ids,
        project_name: projectName,
        layoutByQuoteId: activityQuotesState.exportLayoutByQuoteId || {},
        pageOrientation: activityQuotesState.exportPdfSettings?.pageOrientation || 'landscape',
      }),
    });
    if (!res.ok) {
      let msg = `导出失败（${res.status}）`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    const filename = aqParseDownloadFilename(res, 'quotation-summary.pdf');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('报价 PDF 已导出', 'success');
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
}

async function aqExportFromPreview() {
  const ids = (activityQuotesState.exportPreviewQuotes || []).map((q) => Number(q.id)).filter(Number.isFinite);
  if (!ids.length) {
    showToast('请先选择报价', 'warning');
    return;
  }
  try {
    const res = await fetch('/api/quotations/bundle/export-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        ids,
        layoutByQuoteId: activityQuotesState.exportLayoutByQuoteId || {},
      }),
    });
    if (!res.ok) {
      let msg = `导出失败（${res.status}）`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    const filename = aqParseDownloadFilename(res, 'quotation-summary.xlsx');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('报价 Excel 已导出', 'success');
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
}
