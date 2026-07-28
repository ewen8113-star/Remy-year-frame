async function aqGenerateMergedQuoteFromPreview() {
  const quotes = activityQuotesState.exportPreviewQuotes || [];
  if (!quotes.length) {
    showToast('请先选择报价', 'warning');
    return;
  }
  const projectName = String(activityQuotesState.exportMergeProjectName || '').trim();
  if (!projectName) {
    showToast('请填写合并报价名称', 'warning');
    return;
  }
  const fallbackSessions = quotes
    .filter((q) => Number.isFinite(Number(q.activity_id)))
    .map((q, i) => ({
      activity_id: Number(q.activity_id),
      project_code: q.project_code || '',
      event_date: aqResolveQuoteEventDate(q) || null,
      city: q.city || '',
      customer_name: q.customer_name || '',
      event_type: q.event_type || '',
      remarks: '',
      sort_order: i,
      fee_comm: Number(q.subtotal_ex_tax) || 0,
      fee_executor: 0,
      fee_design: 0,
      fee_freight: 0,
      fee_print: 0,
      fee_photo: 0,
    }));
  try {
    await api('POST', '/quotations/bundle/create-merged', {
      ids: quotes.map((q) => Number(q.id)).filter(Number.isFinite),
      project_name: projectName,
    });
    showToast('合并报价已生成，已加入活动报价列表', 'success');
    activityQuotesState.view = 'list';
    activityQuotesState.exportPickSelectedIds = [];
    activityQuotesState.exportPreviewQuotes = [];
    await renderActivityQuotes();
  } catch (e) {
    const msg = String(e.message || '');
    // 兼容未重启后端的场景：新接口 404 时回退旧创建逻辑，避免阻塞用户
    if (msg.includes('404') && msg.includes('/quotations/bundle/create-merged')) {
      if (!fallbackSessions.length) {
        showToast('后端接口未生效且所选报价缺少关联场次，请重启服务后重试', 'error');
        return;
      }
      try {
        await api('POST', '/quotations', {
          type: 'EVENT',
          quote_mode: 'multi',
          year_frame_id: currentYearFrameId,
          project_name: projectName,
          merged_from_quote_ids: quotes.map((q) => Number(q.id)).filter(Number.isFinite),
          linked_sessions: fallbackSessions,
        });
        showToast('已用兼容模式生成合并报价（建议重启服务启用新接口）', 'success');
        activityQuotesState.view = 'list';
        activityQuotesState.exportPickSelectedIds = [];
        activityQuotesState.exportPreviewQuotes = [];
        await renderActivityQuotes();
        return;
      } catch (e2) {
        showToast(e2.message || '合并生成失败，请重启服务后重试', 'error');
        return;
      }
    }
    showToast(msg || '合并生成失败', 'error');
  }
}

function aqRenderExportPreviewHtml() {
  return `<div class="aq-edit-head">
      <button type="button" class="btn btn-secondary btn-sm" onclick="activityQuotesState.view='exportPick';renderActivityQuotes()">← 上一步</button>
      <span class="aq-multi-pick-step-title">合并导出报价 · 第 2 步：预览与版式调整</span>
      <input type="text" class="form-control form-control-sm" style="max-width:320px" value="${escapeHtml(activityQuotesState.exportMergeProjectName || '')}" placeholder="合并报价名称" oninput="activityQuotesState.exportMergeProjectName=this.value">
      <button type="button" class="btn btn-primary btn-sm" onclick="aqGenerateMergedQuoteFromPreview()">合并生成</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqExportPdfFromPreview()">导出 PDF</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="aqExportFromPreview()">导出 Excel</button>
    </div>
    <div class="aq-preview-workspace">
      <div id="aqExportLayoutPanel">${aqRenderExportLayoutPanel()}</div>
      <div class="aq-export-tabs" id="aqExportTabs">${aqRenderExportTabsHtml()}</div>
      <div id="aqExportSheetPane" class="aq-preview-table-stage">${aqRenderExportActiveSheetPane()}</div>
    </div>`;
}

const AQ_ITEM_CATEGORIES = [
  '专业服务费',
  '纯设计',
  '印刷/快印',
  '写真/喷绘',
  '结构搭建',
  '道具/物料制作',
  '采购',
  '运输',
  '操作',
  '人员',
  '执行差旅',
  '摄影摄像',
];

const AQ_SUBSECTION_LEGACY_MAP = {
  'E-5': 'F-1',
  'E-6': 'F-2',
  'E-7': 'F-3',
  'E-8': 'G-1',
  'E-9': 'G-2',
};

function aqApplyTemplateStructureOnItems(q) {
  if (!q?.items?.length) return;
  const bySub = new Map();
  (activityQuotesState.templateSections || []).forEach((t) => {
    bySub.set(String(t.subsection_code || '').trim(), t);
  });
  q.items.forEach((it) => {
    if (Number(it.is_custom) === 1) return;
    const legacy = String(it.subsection_code || '').trim();
    const mapped = AQ_SUBSECTION_LEGACY_MAP[legacy];
    if (mapped && bySub.has(mapped)) {
      const t = bySub.get(mapped);
      it.section_code = t.section_code;
      it.section_name = t.section_name;
      it.subsection_code = t.subsection_code;
      it.item_category = t.item_category || it.item_category;
      it.sort_order = t.sort_order;
    }
    if (it.subsection_code === 'D-1' && String(it.remarks || '').trim() === '广州-深圳往返') {
      it.remarks = '';
    }
    const tpl = bySub.get(String(it.subsection_code || '').trim());
    if (tpl?.item_category && !String(it.item_category || '').trim()) {
      it.item_category = tpl.item_category;
    }
  });
}

function aqRenderCategorySelect(it) {
  const cur = String(it.item_category || '').trim();
  const opts = AQ_ITEM_CATEGORIES.map(
    (c) => `<option value="${escapeHtml(c)}"${cur === c ? ' selected' : ''}>${escapeHtml(c)}</option>`
  ).join('');
  return `<td><select class="form-control form-control-sm aq-inp-category"
    onchange="aqOnItemFieldChange(${it._idx}, &quot;item_category&quot;, event.target.value)">
    <option value="">—</option>${opts}</select></td>`;
}

function aqPrepareEditingItems(opts = {}) {
  const q = activityQuotesState.editing;
  if (!q || !Array.isArray(q.items)) return;
  aqEnsureMultiSessions(q);
  aqApplyTemplateStructureOnItems(q);
  aqEnrichItemsFromTemplateDefaults(q);
  q.items.forEach((it, i) => {
    it._idx = i;
    it.subtotal = aqItemSubtotal(it);
  });
}

function aqRefreshSectionSubtotals() {
  const q = activityQuotesState.editing;
  const tbody = document.getElementById('aqEditTableBody');
  if (!q || !tbody) return;
  const groups = aqGroupItemsForTable(q.items || []);
  const headers = tbody.querySelectorAll('tr.qt-section-header');
  groups.forEach((sec, i) => {
    const tr = headers[i];
    if (!tr) return;
    const cell = tr.querySelector('td.aq-sec-subtotal') || tr.querySelector('td.right');
    if (cell) cell.textContent = aqFmtNum(sec.sectionSubtotal);
  });
}

function aqRefreshEditTotalsOnly() {
  const foot = document.getElementById('aqEditTotals');
  const q = activityQuotesState.editing;
  if (!foot || !q) return;
  const t = aqCalcTotalsForQuote(q);
  foot.innerHTML = `
      <div class="aq-totals-grid">
        <span>不含税小计</span><strong>${aqFmtNum(t.subtotalExTax)}</strong>
        <span>服务费 (${Math.round(t.serviceRate * 100)}%)</span><strong>${aqFmtNum(t.serviceCharge)}</strong>
        <span>税费 (6%)</span><strong>${aqFmtNum(t.taxAmount)}</strong>
        <span>含税总计</span><strong class="aq-total-amt">${aqFmtNum(t.totalAmount)}</strong>
      </div>`;
}

function aqOnItemFieldChange(idx, field, value) {
  const q = activityQuotesState.editing;
  if (!q || !q.items || !q.items[idx]) return;
  const it = q.items[idx];
  if (field === 'quantity' || field === 'unit_price') {
    it[field] = parseFloat(value) || 0;
    it.subtotal = aqItemSubtotal(it);
    const row = document.querySelector(`tr[data-item-idx="${idx}"]`);
    const sub = row?.querySelector('.aq-line-sub');
    if (sub) sub.textContent = aqFmtNum(it.subtotal);
    aqRefreshSectionSubtotals();
    aqRefreshEditTotalsOnly();
    return;
  }
  it[field] = value;
}

function aqRemoveItem(idx) {
  const q = activityQuotesState.editing;
  if (!q || !q.items || aqIsMultiQuote(q)) return;
  const i = parseInt(idx, 10);
  if (!Number.isFinite(i) || i < 0 || i >= q.items.length) return;
  aqPushEditUndo({ type: 'remove', itemsBefore: aqSnapshotItemsForUndo(q.items) });
  q.items.splice(i, 1);
  if (q.type !== 'REPAIR' && q.type !== 'WAREHOUSE') {
    q.items = aqRenumberEventSectionCodes(q.items);
  }
  aqPrepareEditingItems({ skipRenumber: true });
  aqRefreshEditView();
}

function aqAddCustomItem(subsectionCode) {
  aqAddSectionLine(
    (activityQuotesState.editing?.items || []).find((it) => it.subsection_code === subsectionCode)
      ?.section_code
  );
}

function aqAddSectionLine(sectionCode) {
  const q = activityQuotesState.editing;
  if (!q || aqIsMultiQuote(q)) return;
  const secCode = String(sectionCode || '').trim();
  const ref = (q.items || []).find(
    (it) => String(it.section_code || '').trim() === secCode
  );
  if (!ref) {
    showToast('未找到对应大板块', 'warning');
    return;
  }
  const subCode = aqNextSubsectionCodeInSection(q, secCode);
  const row = {
    section_code: ref.section_code,
    section_name: ref.section_name,
    subsection_code: subCode,
    subsection_name: '',
    item_category: ref.item_category || '',
    description: '',
    quantity: 0,
    unit: '项',
    unit_price: 0,
    subtotal: 0,
    remarks: '',
    sort_order: aqSortOrderFromSubsectionCode(subCode) || aqSortOrderForNewItem(q, ref),
    is_custom: 1,
    is_template: 0,
  };
  q.items.push(row);
  aqPrepareEditingItems({ skipRenumber: true });
  aqRefreshEditView();
}
