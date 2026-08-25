function buildReimbursementPrintableHtml(p) {
  const detailRows = Array.isArray(p.detail_rows) ? p.detail_rows.filter(Boolean) : [];
  const rows =
    detailRows.length >= 3
      ? detailRows
      : [...detailRows, ...Array(Math.max(0, 3 - detailRows.length)).fill(null)];

  const gross = roundMoney2(detailRows.reduce((s, row) => s + roundMoney2(row && row.subtotal), 0));
  const totalShow = roundMoney2(gross > 0 ? gross : p.amount || 0);
  const advance = roundMoney2(p.advance_amount || 0);
  const payee = (p.payee_name || '').trim() || (detailRows[0] && detailRows[0].applicant) || '—';
  const projectBase = (p.project_code || '').trim();
  const dStr = p.date ? String(p.date).slice(0, 10) : '';
  const monthLabel = dStr.length >= 7 ? `${parseInt(dStr.slice(5, 7), 10)}月` : '—';
  const filer = getCurrentUserName() || (detailRows[0] && detailRows[0].applicant) || '—';
  const statusLabel = reimbClaimStatusSheetLabel(p.claim_status);
  const lineCtx = { payee, statusLabel, projectBase, brand: p.brand || '' };
  const colPlan = reimbPrintBuildColumnPlan(detailRows, lineCtx);
  const brandsLabel = reimbBrandsLabelFromRows(detailRows, p.brand || '') || p.brand || '按明细行归属';

  const pageChunks = [];
  if (rows.length <= REIMB_PRINT_MAX_ROWS_ONE_PAGE) {
    pageChunks.push(rows);
  } else {
    for (let i = 0; i < rows.length; i += REIMB_PRINT_MAX_ROWS_ONE_PAGE) {
      pageChunks.push(rows.slice(i, i + REIMB_PRINT_MAX_ROWS_ONE_PAGE));
    }
  }
  if (!pageChunks.length) pageChunks.push([null, null, null]);

  const payeeInfoHtml = reimbPrintPayeeInfoHtml(p);

  const footerHtml = `<div class="sr-footer">
      <div><strong>合计金额（含税）：</strong>${fmtMoney(totalShow)}</div>
      <div><strong>备用金抵扣：</strong>${advance > 0 ? fmtMoney(advance) : '—'}</div>
      ${payeeInfoHtml}
      <div class="sr-footer-row">
        <span><strong>抵扣后应付：</strong>${fmtMoney(p.amount || 0)}</span>
        <span><strong>填报人：</strong>${escapeHtml(filer)}</span>
      </div>
    </div>
    <p class="sr-note">已计入项目成本：${p.merged_into_activity ? '是' : '否'}　｜　纸张：A4 横向；行多时将自动分页。导出 PDF 请在打印窗口选择「另存为 PDF」。</p>`;

  const pagesWithFooterHtml = pageChunks
    .map((chunk, pageIdx) => {
      const pageNo = pageIdx + 1;
      const totalPages = pageChunks.length;
      const startIdx = pageChunks
        .slice(0, pageIdx)
        .reduce((n, c) => n + c.length, 0);
      const tbody = chunk
        .map((row, i) => buildReimbursementPrintLineRowHtml(row, startIdx + i, lineCtx, colPlan))
        .join('');
      const pageLabel =
        totalPages > 1
          ? `<p class="sr-page-no">第 ${pageNo} / ${totalPages} 页</p>`
          : '';
      const continueHint =
        pageIdx < totalPages - 1 ? '<p class="sr-page-continue">（接下页）</p>' : '';
      const footerOnLast = pageIdx === totalPages - 1 ? footerHtml : '';
      return `<section class="sr-page">
      ${pageIdx === 0 ? `<h1 class="sr-title">盛融报销单</h1>
    <div class="sr-meta">
      <span>提报月份：<strong>${escapeHtml(monthLabel)}</strong></span>
      <span>申请日期：${escapeHtml(dStr || '—')}</span>
      <span>品牌：${escapeHtml(brandsLabel)}</span>
    </div>` : `<div class="sr-meta sr-meta--sub">
      <span>盛融报销单（续）</span>
      <span>提报月份：${escapeHtml(monthLabel)}</span>
      <span>申请日期：${escapeHtml(dStr || '—')}</span>
    </div>`}
    ${pageLabel}
    <table class="sr-table sr-table-adaptive" aria-label="报销明细">
      ${buildReimbursementPrintTableHeadHtml(colPlan)}
      <tbody>${tbody}</tbody>
    </table>
    ${continueHint}
    ${footerOnLast}
  </section>`;
    })
    .join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>盛融报销单</title>
<style>
  @page { size: A4 landscape; margin: 8mm 10mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Songti SC","SimSun","Noto Serif SC",serif; font-size: 9.5px; color: #1a1a1a; margin: 0; padding: 8px 6px 16px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sr-sheet { width: 100%; max-width: 277mm; margin: 0 auto; }
  .sr-page { page-break-after: always; }
  .sr-page:last-of-type { page-break-after: auto; }
  .sr-title { text-align: center; font-size: 16px; font-weight: 700; letter-spacing: 0.35em; margin: 0 0 8px; }
  .sr-meta { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; font-size: 10.5px; }
  .sr-meta--sub { justify-content: flex-start; gap: 16px; font-size: 10px; color: #333; }
  .sr-meta span { white-space: nowrap; }
  .sr-page-no { margin: 0 0 4px; font-size: 10px; text-align: right; color: #444; }
  .sr-page-continue { margin: 4px 0 0; font-size: 10px; text-align: right; color: #666; }
  table.sr-table { width: 100%; border-collapse: collapse; table-layout: auto; }
  table.sr-table.sr-table-adaptive { table-layout: auto; }
  table.sr-table th, table.sr-table td {
    border: 1px solid #000;
    padding: 2px 4px;
    vertical-align: middle;
    font-size: 9.5px;
  }
  table.sr-table thead th {
    background: #ececec;
    font-weight: 600;
    font-size: 8.5px;
    text-align: center;
    line-height: 1.15;
    vertical-align: middle;
    padding: 3px 4px;
    white-space: nowrap;
  }
  table.sr-table thead { display: table-header-group; }
  table.sr-table tr { page-break-inside: avoid; break-inside: avoid; }
  /* 紧凑列：width:0.1% + nowrap 使列宽贴合内容，剩余空间留给说明/备注 */
  .sr-col-shrink { width: 0.1%; white-space: nowrap; }
  .sr-th-tight, .sr-td-tight { width: 0.1%; white-space: nowrap; }
  .sr-th-money, .sr-td-money { width: 0.1%; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sr-th-text, .sr-td-text { width: 0.1%; white-space: nowrap; }
  .sr-th-project, .sr-project-code {
    width: 0.1%;
    text-align: center;
    white-space: nowrap;
    word-break: keep-all;
    font-size: 9px;
    line-height: 1.3;
    vertical-align: middle;
    padding-left: 3px;
    padding-right: 3px;
  }
  .sr-th-project { white-space: nowrap; font-size: 8.5px; }
  .sr-th-desc, .sr-td-desc { word-break: break-word; white-space: normal; line-height: 1.35; }
  .sr-th-desc { white-space: nowrap; line-height: 1.15; }
  .sr-th-invno, .sr-invoice-no {
    width: 0.1%;
    white-space: nowrap;
    text-align: center;
    padding-left: 3px;
    padding-right: 3px;
  }
  .sr-th-invno { white-space: nowrap; font-size: 8.5px; line-height: 1.15; }
  .sr-c { text-align: center; vertical-align: middle; }
  .sr-wrap, .sr-td-text, .sr-td-desc { text-align: center; vertical-align: middle; }
  .sr-remarks { text-align: center; font-size: 9px; }
  .sr-invoice-no {
    font-size: 8.5px;
    letter-spacing: -0.1px;
    font-variant-numeric: tabular-nums;
    vertical-align: middle;
  }
  .sr-payee-info {
    grid-column: 1 / -1;
    font-size: 10px;
    line-height: 1.45;
    padding: 4px 0 2px;
    border-top: 1px dashed #999;
    margin-top: 2px;
  }
  .sr-footer { margin-top: 8px; font-size: 10.5px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; align-items: center; page-break-inside: avoid; break-inside: avoid; }
  .sr-footer-row { grid-column: 1 / -1; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; border-top: 1px solid #000; padding-top: 6px; margin-top: 4px; }
  .sr-note { margin-top: 6px; font-size: 9.5px; color: #333; }
  @media print {
    body { padding: 0; }
    .sr-page { page-break-after: always; }
    .sr-page:last-of-type { page-break-after: auto; }
    .sr-footer, .sr-note { break-inside: avoid; page-break-inside: avoid; }
  }
</style></head><body>
  <div class="sr-sheet">
    ${pagesWithFooterHtml}
  </div>
</body></html>`;
}

function reimbursementPreviewCsvFromForm() {
  const p = reimbExportPayloadFromForm();
  const csvText = buildReimbursementCsvText(p);
  const filename = `付款申请_${p.date || 'export'}.csv`;
  openReimbursementPreviewModal({
    title: 'CSV 预览',
    type: 'csv',
    csvText,
    filename,
    bodyHtml: `<pre style="white-space:pre-wrap;word-break:break-word;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;max-height:68vh;overflow:auto;margin:0">${escapeHtml(csvText)}</pre>`,
  });
}

async function reimbursementPrintCurrentForm() {
  const raw = reimbExportPayloadFromForm();
  const p = await reimbEnrichPayloadPayeeFromDict(raw);
  const html = buildReimbursementPrintableHtml(p);
  openReimbursementPreviewModal({
    title: '盛融报销单 · 预览',
    type: 'pdf',
    bodyHtml: `<iframe id="reimbPreviewPdfFrame" style="width:100%;height:70vh;border:1px solid #e5e7eb;border-radius:8px;background:#fff" srcdoc="${escapeHtml(html)}"></iframe>`,
  });
}

async function reimbursementPrintTemplateById(id) {
  try {
    const r = await api('GET', `/reimbursements/${id}`);
    let p = reimbursementPayloadFromRecord(r);
    p = await reimbEnrichPayloadPayeeFromDict(p);
    const html = buildReimbursementPrintableHtml(p);
    openReimbursementPreviewModal({
      title: `盛融报销单 · #${id}`,
      type: 'pdf',
      recordId: id,
      bodyHtml: `<iframe id="reimbPreviewPdfFrame" style="width:100%;height:70vh;border:1px solid #e5e7eb;border-radius:8px;background:#fff" srcdoc="${escapeHtml(html)}"></iframe>`,
    });
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
  }
}

/* =============================================
   付款申请 · 详情弹窗（行点击展开）
   也被「物料采购页」整行点击复用：通过 detailModalContext 区分来源。
   ============================================= */
let reimbursementDetailState = { id: null, record: null };
/** 'reimbursement' | 'material' —— 当前 detail modal 的来源；控制 footer 按钮行为 */
let detailModalContext = 'reimbursement';

function buildReimbursementClaimStatusEditorHtml(record) {
  const r = record || {};
  if (String(r.payment_type || 'personal_reimbursement') !== 'personal_reimbursement') {
    return `<span class="badge ${reimbClaimStatusBadgeClass(r.claim_status)}">${escapeHtml(reimbClaimStatusLabel(r.claim_status || ''))}</span>`;
  }
  const meta = reimbReadDetailMeta(r.remarks || '');
  const claimStatus = r.claim_status || 'draft';
  const paymentDate = meta.payment_date || '';
  const options = reimbClaimStatusOptionsForRecord(r)
    .map((x) => `<option value="${x.value}" ${x.value === claimStatus ? 'selected' : ''}>${escapeHtml(x.label)}</option>`)
    .join('');
  const showDate = reimbClaimStatusNeedsPaymentDate(claimStatus);
  return `<div class="reimb-claim-status-edit" onclick="event.stopPropagation()">
    <select class="form-control form-control-sm" id="reimbDetailClaimStatus" onchange="reimbDetailClaimStatusChanged()">${options}</select>
    <input type="date" class="form-control form-control-sm" id="reimbDetailPaymentDate" value="${escapeHtml(paymentDate)}" style="display:${showDate ? 'block' : 'none'}" />
    <button type="button" class="btn btn-primary btn-sm" onclick="reimbursementSaveClaimStatus()">保存状态</button>
  </div>`;
}

function reimbDetailClaimStatusChanged() {
  const status = document.getElementById('reimbDetailClaimStatus')?.value || 'draft';
  const dateEl = document.getElementById('reimbDetailPaymentDate');
  if (!dateEl) return;
  dateEl.style.display = reimbClaimStatusNeedsPaymentDate(status) ? 'block' : 'none';
  if (reimbClaimStatusNeedsPaymentDate(status) && !dateEl.value) {
    dateEl.value = todayDateInputValue();
  }
}
