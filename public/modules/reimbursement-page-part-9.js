function buildReimbursementCsvText(p) {
  const lines = [];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  lines.push(['报销日期', p.date, '金额合计', p.amount].join(','));
  const isNonActivity = p.cost_module === 'general' && !p.activity_id;
  lines.push(
    [
      '个人/公司',
      reimbPayeePartyLabel(reimbPayeePartyFromPaymentType(p.payment_type)),
      '成本归属',
      reimbCostAttributionLabel(isNonActivity),
      '状态',
      reimbClaimStatusLabel(p.claim_status),
    ].join(','),
  );
  lines.push(
    [
      '收款方信息',
      esc(p.payee_name),
      '品牌',
      esc(p.brand),
      '项目编号',
      esc(p.project_code),
      '关联场次ID',
      p.activity_id || '',
    ].join(','),
  );
  lines.push(['备注', esc(reimbVisibleRemarks(p.remarks))].join(','));
  lines.push(['有发票', p.has_invoice ? '是' : '否'].join(','));
  if (p.has_invoice && p.invoices.length) {
    lines.push('发票内容,发票号码,开票日期,专票/普票');
    p.invoices.forEach((iv) =>
      lines.push([esc(iv.invoice_content), esc(iv.invoice_no), iv.invoice_date, esc(iv.invoice_kind)].join(','))
    );
  }
  lines.push('');
  lines.push('编号,板块,类别,内容说明,数量,单价,小计,费用归属,发票,发票日期,发票号码,申请人,备注');
  const detailRows = Array.isArray(p.detail_rows) && p.detail_rows.length ? p.detail_rows : [];
  detailRows.forEach((row, idx) => {
    const blockLabel = REIMB_DETAIL_BLOCKS.find((x) => x.value === row.block)?.label || row.block || '';
    const catLabel = (REIMB_DETAIL_CATEGORY_OPTIONS[row.block] || []).find(([v]) => v === row.category)?.[1] || row.category || '';
    lines.push([
      idx + 1, esc(blockLabel), esc(catLabel), esc(row.description), row.quantity, row.unit_price, row.subtotal,
      esc(reimbFormatCostMonth(row.cost_month) || ''), esc(row.invoice), row.invoice_date, esc(row.invoice_no), esc(row.applicant), esc(row.remarks),
    ].join(','));
  });
  if (p.advance_amount) lines.push(['备用金抵扣', '', '', '', '', '', -roundMoney2(p.advance_amount)].join(','));
  return lines.join('\n');
}

function downloadReimbursementCsv(csvText, filename) {
  const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

let reimbursementPreviewState = {
  type: '',
  csvText: '',
  filename: '',
  recordId: null,
};

function openReimbursementPreviewModal({ title, bodyHtml, type = '', csvText = '', filename = '', recordId = null }) {
  const titleEl = document.getElementById('modalReimbPreviewTitle');
  const bodyEl = document.getElementById('modalReimbPreviewBody');
  const csvBtn = document.getElementById('reimbPreviewDownloadCsvBtn');
  const excelBtn = document.getElementById('reimbPreviewDownloadExcelBtn');
  const printBtn = document.getElementById('reimbPreviewPrintBtn');
  const pdfBtn = document.getElementById('reimbPreviewPrintPdfBtn');
  if (!titleEl || !bodyEl || !csvBtn || !printBtn || !pdfBtn) {
    showToast('预览弹窗未就绪，请刷新页面重试', 'warning');
    return;
  }
  reimbursementPreviewState = { type, csvText, filename, recordId: recordId != null ? Number(recordId) : null };
  titleEl.textContent = title || '预览';
  bodyEl.innerHTML = bodyHtml || '';
  csvBtn.style.display = type === 'csv' ? 'inline-flex' : 'none';
  if (excelBtn) {
    const showExcel = type === 'pdf' && Number.isFinite(reimbursementPreviewState.recordId);
    excelBtn.style.display = showExcel ? 'inline-flex' : 'none';
  }
  const showPdfActions = type === 'pdf';
  printBtn.style.display = showPdfActions ? 'inline-flex' : 'none';
  pdfBtn.style.display = showPdfActions ? 'inline-flex' : 'none';
  openModal('modalReimbPreview');
}

function reimbursementPreviewDownloadCsv() {
  if (reimbursementPreviewState.type !== 'csv' || !reimbursementPreviewState.csvText) return;
  downloadReimbursementCsv(
    reimbursementPreviewState.csvText,
    reimbursementPreviewState.filename || `付款申请_${todayDateInputValue()}.csv`
  );
}

function reimbursementPreviewPrintPdf() {
  const frame = document.getElementById('reimbPreviewPdfFrame');
  if (!frame || !frame.contentWindow) {
    showToast('PDF 预览内容未就绪', 'warning');
    return;
  }
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

/** 导出 PDF：调用系统打印对话框并选择「另存为 PDF」 */
function reimbursementPreviewExportPdf() {
  const frame = document.getElementById('reimbPreviewPdfFrame');
  if (!frame || !frame.contentWindow) {
    showToast('PDF 预览内容未就绪', 'warning');
    return;
  }
  showToast('请在打印窗口的目标打印机中选择「另存为 PDF」或「Save as PDF」', 'info');
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

async function reimbursementDownloadExcel(id) {
  const nid = Number(id);
  if (!Number.isFinite(nid)) {
    showToast('请先保存记录后再导出 Excel', 'warning');
    return;
  }
  try {
    const res = await fetch(`/api/reimbursements/${nid}/excel`, { credentials: 'include' });
    if (!res.ok) {
      let msg = `导出失败 (${res.status})`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = invFilenameFromDisposition(
      res.headers.get('content-disposition'),
      `盛融报销单_${nid}_${todayDateInputValue()}.xlsx`,
    );
    a.click();
    URL.revokeObjectURL(url);
    showToast('Excel 已下载', 'success');
  } catch (e) {
    showToast(e.message || 'Excel 导出失败', 'error');
  }
}

function reimbursementPreviewDownloadExcel() {
  const id = reimbursementPreviewState.recordId;
  if (!Number.isFinite(id)) {
    showToast('请先保存记录后再导出 Excel', 'warning');
    return;
  }
  reimbursementDownloadExcel(id);
}

/** 与列表 CSV / 打印共用结构（来源于 GET /reimbursements/:id） */
function reimbursementPayloadFromRecord(r) {
  const meta = reimbReadDetailMeta(r.remarks || '');
  const projectCode = String(r.related_project_code || '').trim();
  const brand = String(r.brand || '').trim();
  const enrichedRows = reimbResolveDetailRowsFromRecord(r, meta);
  const detailRows = enrichedRows.map((row) => {
    const rowBrand = String(row.brand || '').trim();
    const rowPc = String(row.project_code || row.line_project || '').trim();
    const lineProject =
      rowPc && !reimbIsPlaceholderProjectCode(rowPc)
        ? rowPc
        : projectCode
          || (rowBrand && rowBrand !== '内部' ? rowBrand : '')
          || reimbBrandYearFrameCodeForPdf(brand)
          || rowBrand
          || '—';
    return { ...row, line_project: lineProject };
  });
  const brandsLabel = reimbBrandsLabelFromRows(detailRows, brand);
  return {
    id: r.id,
    date: r.date,
    remarks: reimbVisibleRemarks(r.remarks || ''),
    activity_id: r.activity_id,
    brand: brandsLabel || brand || '按明细行归属',
    payee_name: String(r.payee_name || '').trim(),
    payment_method: r.payment_method || null,
    payee_bank_name: r.payee_bank_name || null,
    payee_bank_account: r.payee_bank_account || null,
    project_code: projectCode,
    payment_type: r.payment_type || 'personal_reimbursement',
    cost_module: r.cost_module || 'activity',
    claim_status: r.claim_status || 'draft',
    has_invoice: !!(r.has_invoice === 1 || r.has_invoice === true),
    invoices: Array.isArray(r.invoices) ? r.invoices : [],
    cost_details: parseActivityCostDetails({ cost_details: r.cost_details }),
    detail_rows: detailRows,
    advance_amount: roundMoney2(meta.advance_amount),
    amount: parseFloat(r.amount) || 0,
    merged_into_activity: !!(r.merged_into_activity === 1 || r.merged_into_activity === true),
    payment_status: String(r.payment_status || 'unpaid').toLowerCase() === 'paid' ? 'paid' : 'unpaid',
  };
}

function reimbClaimStatusSheetLabel(v) {
  if (v === 'paid') return '已支付';
  if (v === 'reimbursed') return '已报销';
  if (v === 'submitted') return '待支付';
  if (v === 'rejected') return '已驳回';
  return '草稿';
}

/**
 * 报销单 PDF 中无项目编号时按品牌填年框编号（用户指定字面格式，不修改数据库）
 */
function reimbBrandYearFrameCodeForPdf(brand) {
  const b = String(brand || '').trim().toUpperCase();
  if (b === 'PHD') return 'N220630-RC PHD';
  if (b === 'X.O' || b === 'XO') return 'N230901-RM XO';
  if (b === 'CLUB') return 'N230530-RM Club';
  return '';
}

/** @deprecated 报销单 PDF 已移除「项目归属一览」附件页；保留函数以兼容旧引用 */
function buildReimbursementRosterAttachmentHtml(activities) {
  const acts = (activities || []).filter((a) => a && String(a.project_code || '').trim());
  const byBrand = new Map();
  acts.forEach((a) => {
    const b = String(a.brand || '其他').trim() || '其他';
    const pc = String(a.project_code || '').trim();
    if (!byBrand.has(b)) byBrand.set(b, new Set());
    byBrand.get(b).add(pc);
  });
  const brandLines = [...byBrand.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
    .map(([brand, codes]) => `${escapeHtml(brand)}年框： ${[...codes].sort().join(' / ')}`)
    .join('<br/>');

  const byExec = new Map();
  acts.forEach((a) => {
    const ex = String(a.executor || '').trim();
    const pc = String(a.project_code || '').trim();
    if (!ex) return;
    if (!byExec.has(ex)) byExec.set(ex, new Set());
    byExec.get(ex).add(pc);
  });
  const execLines = [...byExec.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));

  let tbody = '';
  tbody += `<tr><td>盛融</td><td>—</td><td class="sr-pre">${brandLines || '—'}</td><td></td></tr>`;
  execLines.forEach(([name, codes]) => {
    tbody += `<tr><td></td><td>${escapeHtml(name)}</td><td class="sr-pre">${[...codes].sort().map(escapeHtml).join('<br/>')}</td><td></td></tr>`;
  });
  let pad = 1 + execLines.length;
  while (pad < 8) {
    tbody += `<tr><td>&#160;</td><td>&#160;</td><td>&#160;</td><td>&#160;</td></tr>`;
    pad += 1;
  }

  return `<section class="sr-roster">
    <p class="sr-roster-note">说明：以下为当前年度场次项目编号汇总，可作附件；空白栏位可打印后手写。</p>
    <table class="sr-table sr-roster-table" aria-label="项目归属一览">
      <thead><tr><th style="width:12%">公司</th><th style="width:14%">人员</th><th style="width:50%">项目名称</th><th style="width:24%">备注</th></tr></thead>
      <tbody>${tbody}</tbody>
    </table>
  </section>`;
}

/** A4 横版单页尽量容纳的行数；超出才分页 */
const REIMB_PRINT_MAX_ROWS_ONE_PAGE = 32;

/** 打印列元数据：表头可换行，数据列按内容自适应宽度 */
