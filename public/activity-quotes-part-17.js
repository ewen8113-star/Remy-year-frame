async function aqSaveEditing() {
  const q = activityQuotesState.editing;
  if (!q || !q.id) return;
  aqReadQtHeaderFromDom();
  if (activityQuotesState.view === 'mergedEdit') {
    try {
      await api('PUT', `/quotations/${q.id}`, aqBuildSavePayload(q));
      aqPersistMergedEditActiveToCache();
      showToast(`已保存：${q.project_name || q.project_code || q.quotation_no}`, 'success');
      aqClearEditUndo();
      return;
    } catch (e) {
      showToast(e.message || '保存失败', 'error');
      return;
    }
  }
  if (aqIsMultiQuote(q)) {
    if (!String(q.project_name || '').trim()) {
      showToast('请填写报价名称', 'warning');
      return;
    }
    const filled = (q.linked_sessions || []).filter((s) => s && s.activity_id);
    if (!filled.length) {
      showToast('请至少关联一场活动（项目编号）', 'warning');
      return;
    }
  }
  try {
    await api('PUT', `/quotations/${q.id}`, aqBuildSavePayload(q));
    showToast('已保存', 'success');
    aqClearEditUndo();
    activityQuotesState.multiDraftPristine = false;
    activityQuotesState.editing = null;
    activityQuotesState.view = 'list';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

function aqRenderQtHeaderHtml(q, bilingual, opts = {}) {
  const bi = bilingual !== false;
  const editable = !!opts.editable;
  const brandL = bi ? 'Client / Brand 客户/品牌：' : 'Client / Brand：';
  const attendL = bi ? 'Attend to 客户方负责人：' : 'Attend to：';
  const projectL = bi ? 'Project Name 项目名称：' : 'Project Name：';
  const brandVal = escapeHtml(q.client_brand || '');
  const contactVal = escapeHtml(q.client_contact || '');
  const projectVal = escapeHtml(q.project_name || '');
  const brandField = editable
    ? `<input type="text" class="form-control form-control-sm aq-header-inp" id="aqQtHeaderBrand" value="${brandVal}"
        oninput="aqOnQtHeaderFieldChange('client_brand', this.value)">`
    : `<span class="info-value">${brandVal}</span>`;
  const contactField = editable
    ? `<input type="text" class="form-control form-control-sm aq-header-inp" id="aqQtHeaderContact" value="${contactVal}"
        oninput="aqOnQtHeaderFieldChange('client_contact', this.value)" placeholder="选填">`
    : `<span class="info-value">${contactVal}</span>`;
  const projectField = editable
    ? `<input type="text" class="form-control form-control-sm aq-header-inp" id="aqQtHeaderProjectName" value="${projectVal}"
        oninput="aqOnQtHeaderFieldChange('project_name', this.value)" placeholder="如 绵阳品鉴">`
    : `<span class="info-value" id="aqQtHeaderProjectName">${projectVal}</span>`;
  return `
    <div class="qt-header-info qt-header-info--with-logo${editable ? ' qt-header-info--editable' : ''}">
      <div class="qt-header-info-main">
        <div class="info-row info-row--field"><span class="info-label">${brandL}</span>${brandField}</div>
        <div class="info-row info-row--field"><span class="info-label">${attendL}</span>${contactField}</div>
        <div class="info-row info-row--field"><span class="info-label">${projectL}</span>${projectField}</div>
      </div>
      <img class="qt-company-logo" src="/logo.png?v=2" alt="公司 Logo" width="140" height="auto">
    </div>`;
}

function aqParseDownloadFilename(res, fallback) {
  const cd = res.headers.get('Content-Disposition') || '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  if (star) return decodeURIComponent(star[1]);
  if (plain) return plain[1];
  return fallback;
}

async function aqDownloadQuotationExport(kind, id) {
  const qid = id || activityQuotesState.editing?.id;
  if (!qid) {
    showToast('请先保存报价后再导出', 'warning');
    return;
  }
  const isExcel = kind === 'excel';
  let path = isExcel ? `/api/quotations/${qid}/excel` : `/api/quotations/${qid}/pdf`;
  if (isExcel) {
    const selected = (activityQuotesState.listSelectedIds || []).map(Number).filter(Number.isFinite);
    if (selected.length > 1) {
      const qs = new URLSearchParams();
      qs.set('ids', selected.join(','));
      path = `/api/quotations/bundle/export-excel?${qs.toString()}`;
    }
  }
  const fallback = isExcel ? `quotation-${qid}.xlsx` : `quotation-${qid}.pdf`;
  const label = isExcel ? 'Excel' : 'PDF';
  try {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) {
      let msg = `导出失败（${res.status}）`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) {
        if (res.status === 404) msg = `${label} 接口未找到，请重启 Node 服务后重试`;
      }
      showToast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    if (!blob.size) {
      showToast(`${label} 为空，请检查报价明细`, 'error');
      return;
    }
    const filename = aqParseDownloadFilename(res, fallback);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (isExcel && (activityQuotesState.listSelectedIds || []).length > 1) {
      showToast(`Excel 已下载（汇总 ${activityQuotesState.listSelectedIds.length} 场）`, 'success');
    } else {
      showToast(`${label} 已下载`, 'success');
    }
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
}

function aqToggleListSelect(id, checked) {
  const ids = new Set((activityQuotesState.listSelectedIds || []).map(Number));
  const n = Number(id);
  if (checked) ids.add(n);
  else ids.delete(n);
  activityQuotesState.listSelectedIds = [...ids];
  const all = document.getElementById('aqListSelectAll');
  if (all) {
    const visible = activityQuotesState.list.map((r) => Number(r.id));
    all.checked = visible.length > 0 && visible.every((vid) => ids.has(vid));
  }
}

function aqToggleListSelectAll(checked) {
  if (checked) {
    activityQuotesState.listSelectedIds = activityQuotesState.list.map((r) => Number(r.id));
  } else {
    activityQuotesState.listSelectedIds = [];
  }
  renderActivityQuotes();
}

function aqClearListSelection() {
  activityQuotesState.listSelectedIds = [];
  renderActivityQuotes();
}

async function aqExportPdf(id) {
  return aqDownloadQuotationExport('pdf', id);
}

async function aqExportExcel(id) {
  return aqDownloadQuotationExport('excel', id);
}

function aqPrintPreview() {
  document.body.classList.add('aq-print-mode');
  const done = () => document.body.classList.remove('aq-print-mode');
  window.addEventListener('afterprint', done, { once: true });
  window.print();
}

async function aqOpenEdit(id) {
  try {
    aqClearEditUndo();
    aqClearMergedEditState();
    await aqLoadQuotation(id);
    const q = activityQuotesState.editing;
    if (aqIsMergedExportQuote(q)) {
      await aqOpenMergedBundleEdit(q);
      return;
    }
    if (!aqIsMultiQuote(q)) {
      await aqLoadTemplateSections();
    }
    activityQuotesState.multiDraftPristine = false;
    if (aqIsMultiQuote(q)) {
      await aqLoadActivitiesForPicker();
      activityQuotesState.multiProjectName = String(q.project_name || '').trim();
    }
    aqPrepareEditingItems();
    activityQuotesState.view = 'edit';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
  }
}

async function aqOpenPreview(id) {
  try {
    await aqLoadQuotation(id);
    activityQuotesState.previewBundleQuotes = [];
    activityQuotesState.previewBundleActive = 'summary';
    if (!aqIsMultiQuote(activityQuotesState.editing)) {
      await aqLoadTemplateSections();
    } else if (aqIsMergedExportQuote(activityQuotesState.editing)) {
      activityQuotesState.previewBundleQuotes = aqSortQuotesByEventDateAsc(
        await aqLoadPreviewBundleQuotes(id)
      );
      if (activityQuotesState.previewBundleQuotes.length) {
        aqAlignMultiLinkedSessionsToSortedSingles(
          activityQuotesState.editing,
          activityQuotesState.previewBundleQuotes
        );
        aqInitMergedPreviewLayout(activityQuotesState.previewBundleQuotes);
      }
    } else {
      activityQuotesState.previewBundleQuotes = [];
    }
    aqPrepareEditingItems();
    activityQuotesState.view = 'preview';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
  }
}

async function aqSetPreviewBundleActive(key) {
  activityQuotesState.previewBundleActive = key;
  const multiId = activityQuotesState.editing && activityQuotesState.editing.id;
  if (key === 'summary' && multiId && aqIsMergedExportQuote(activityQuotesState.editing)) {
    try {
      const fresh = aqSortQuotesByEventDateAsc(await aqLoadPreviewBundleQuotes(multiId));
      if (fresh.length) {
        activityQuotesState.previewBundleQuotes = fresh;
        aqAlignMultiLinkedSessionsToSortedSingles(activityQuotesState.editing, fresh);
      }
    } catch (_) {
      /* 保留已有 bundle */
    }
  }
  aqRefreshPreviewLayoutPanes();
}
