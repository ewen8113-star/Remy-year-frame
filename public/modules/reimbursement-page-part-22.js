async function onReimbursementImportFileSelected(ev) {
  const file = ev.target && ev.target.files && ev.target.files[0];
  if (!file) return;
  if (!canRegisterReimbursement()) {
    showToast('当前账号无权导入报销', 'warning');
    return;
  }
  if (!currentYearFrameId) {
    showToast('请先选择年度', 'warning');
    return;
  }
  const name = String(file.name || '').toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    showToast('请选择 Excel 文件（.xlsx 或 .xls）', 'warning');
    return;
  }
  try {
    await reimbursementImportLoadPreview(file, currentYearFrameId);
  } catch (err) {
    showToast('预览失败: ' + (err.message || err), 'error');
  }
}

async function renderReimbursements() {
  const container = document.getElementById('pageContainer');
  if (!container) return;
  if (!currentYearFrameId) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-title">请先选择年度</div></div>';
    return;
  }
  container.innerHTML = '<div class="empty-state"><div class="skeleton skeleton-title"></div></div>';
  try {
    const qs = `?yearFrameId=${currentYearFrameId}`;
    const [rows, acts, paymentOrders, logistics, warehouse, materialPurchases, propRepairs] = await Promise.all([
      api('GET', `/reimbursements${qs}`),
      api('GET', `/activities?yearFrameId=${currentYearFrameId}&sortBy=date&sortOrder=DESC&isVirtual=0`),
      api('GET', `/payment-orders${qs}`),
      api('GET', `/logistics${qs}`),
      api('GET', `/warehouse${qs}`),
      api('GET', `/material-purchases${qs}`),
      api('GET', `/prop-repairs${qs}`),
    ]);
    reimbursementPageState.rows = rows;
    reimbursementPageState.activities = acts;
    reimbursementPageState.paymentOrders = paymentOrders;
    reimbursementPageState.logistics = logistics || [];
    reimbursementPageState.warehouse = warehouse || [];
    reimbursementPageState.materialPurchases = materialPurchases || [];
    reimbursementPageState.propRepairs = propRepairs || [];
    if (reimbursementPageState.filterInput == null) reimbursementPageState.filterInput = '';
    const idSet = new Set((rows || []).map((r) => Number(r.id)).filter(Number.isFinite));
    reimbursementListExpanded = new Set([...reimbursementListExpanded].filter((id) => idSet.has(id)));
    reimbursementRenderListDom();
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message)}</div></div>`;
  }
}

async function reimbursementQuickExport(id) {
  try {
    const r = await api('GET', `/reimbursements/${id}`);
    const p = reimbursementPayloadFromRecord(r);
    const csvText = buildReimbursementCsvText(p);
    const filename = `付款申请_${p.id}_${(p.date || '').slice(0, 10)}.csv`;
    openReimbursementPreviewModal({
      title: `CSV 预览 #${p.id}`,
      type: 'csv',
      csvText,
      filename,
      bodyHtml: `<pre style="white-space:pre-wrap;word-break:break-word;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;max-height:68vh;overflow:auto;margin:0">${escapeHtml(csvText)}</pre>`,
    });
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
}
