function aqRefreshMultiSessionRow(sessionIdx) {
  const q = activityQuotesState.editing;
  if (!q || !q.linked_sessions || !q.linked_sessions[sessionIdx]) return;
  const s = q.linked_sessions[sessionIdx];
  const row = document.querySelector(`tr[data-session-idx="${sessionIdx}"]`);
  if (!row) {
    aqRefreshEditView();
    return;
  }
  const date = aqNormalizeEventDate(s.event_date) || '—';
  const setAuto = (field, text) => {
    const el = row.querySelector(`[data-aq-auto="${field}"]`);
    if (el) el.textContent = text || '—';
  };
  setAuto('event_date', date);
  setAuto('city', s.city || '—');
  setAuto('customer_name', s.customer_name || '—');
  setAuto('event_type', s.event_type || '—');
  const calc = aqCalcSessionRow(s);
  const subEl = row.querySelector('[data-aq-calc="subtotal"]');
  const svcEl = row.querySelector('[data-aq-calc="service"]');
  const taxEl = row.querySelector('[data-aq-calc="tax"]');
  const totEl = row.querySelector('[data-aq-calc="total"]');
  if (subEl) subEl.textContent = aqFmtNum(calc.subtotal_ex_tax);
  if (svcEl) svcEl.textContent = aqFmtNum(calc.service_charge);
  if (taxEl) taxEl.textContent = aqFmtNum(calc.tax_amount);
  if (totEl) totEl.textContent = aqFmtNum(calc.row_total);
}

function aqOnMultiFeeChange(sessionIdx, feeKey, value) {
  const q = activityQuotesState.editing;
  if (!q || !q.linked_sessions || !q.linked_sessions[sessionIdx]) return;
  q.linked_sessions[sessionIdx][feeKey] = parseFloat(value) || 0;
  aqMarkMultiDirty();
  aqRefreshMultiSessionRow(sessionIdx);
  aqRefreshEditTotalsOnly();
}

function aqRenderMultiGridRows(q) {
  return (q.linked_sessions || [])
    .map((s, si) => {
      const date = aqNormalizeEventDate(s.event_date);
      const calc = aqCalcSessionRow(s);
      const feeInputs = AQ_MULTI_FEE_COLS.map(
        (col) =>
          `<td class="aq-fee-cell"><input type="number" ${aqMultiFeeInputAttrs(`data-fee-key="${col.key}" oninput="aqOnMultiFeeInput(${si}, '${col.key}', this)" onchange="aqOnMultiFeeChange(${si}, '${col.key}', aqNumInpParse(this))"`)} value="${aqMultiFeeInputValue(aqParseFee(s, col.key))}"></td>`
      ).join('');
      const removeBtn =
        (q.linked_sessions || []).length > 1
          ? `<button type="button" class="btn btn-xs btn-ghost" onclick="aqRemoveMultiSession(${si})" title="移除">×</button>`
          : '';
      return `<tr data-session-idx="${si}" class="aq-multi-grid-row" data-project-code="${escapeHtml(s.project_code || '')}">
        <td class="aq-auto-val" data-aq-auto="event_date">${escapeHtml(date) || '—'}</td>
        <td class="aq-auto-val" data-aq-auto="city">${escapeHtml(s.city || '') || '—'}</td>
        <td class="aq-auto-val" data-aq-auto="customer_name">${escapeHtml(s.customer_name || '') || '—'}</td>
        <td class="aq-auto-val" data-aq-auto="event_type">${escapeHtml(s.event_type || '') || '—'}</td>
        ${feeInputs}
        <td class="numeric aq-calc-cell" data-aq-calc="subtotal">${aqFmtNum(calc.subtotal_ex_tax)}</td>
        <td class="numeric aq-calc-cell" data-aq-calc="service">${aqFmtNum(calc.service_charge)}</td>
        <td class="numeric aq-calc-cell" data-aq-calc="tax">${aqFmtNum(calc.tax_amount)}</td>
        <td class="numeric aq-calc-cell aq-row-total" data-aq-calc="total">${aqFmtNum(calc.row_total)}</td>
        <td>${removeBtn}</td>
      </tr>`;
    })
    .join('');
}

function aqRenderMultiSessionRows(q) {
  return aqRenderMultiGridRows(q);
}

function aqAddMultiSession() {
  const panel = document.getElementById('aqMultiAddPanelBody');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  showToast('请在上方面板勾选场次，再点击「添加所选到场次表」', 'info');
}

function aqRemoveMultiSession(idx) {
  const q = activityQuotesState.editing;
  if (!q || !Array.isArray(q.linked_sessions) || q.linked_sessions.length <= 1) return;
  q.linked_sessions.splice(idx, 1);
  aqMarkMultiDirty();
  aqRefreshEditView();
}

function aqMultiGridHeadHtml() {
  const feeTh = AQ_MULTI_FEE_COLS.map((c) => `<th class="aq-fee-th">${escapeHtml(c.label)}</th>`).join('');
  return `<tr>
    <th>日期</th><th>城市</th><th>客户名称</th><th>类型</th>
    ${feeTh}
    <th class="numeric aq-fee-th">小计</th><th class="numeric">服务费10%</th><th class="numeric">税费6%</th><th class="numeric">合计</th>
    <th></th>
  </tr>`;
}

/** 预览/打印：无项目编号列，末列为备注 */
function aqMultiPreviewColsBeforeTotals(sectionColCount) {
  return 4 + (sectionColCount != null ? sectionColCount : 0);
}

function aqMultiPreviewHeadHtml(layout) {
  const { sectionCols, totalCols } =
    layout || aqBuildSummaryPreviewLayout({ sessions: activityQuotesState.editing?.linked_sessions || [] });
  const sectionTh = sectionCols
    .map((c) => `<th class="aq-fee-th">${escapeHtml(c.section_name)}</th>`)
    .join('');
  const totalTh = totalCols
    .map((c) => `<th class="numeric">${escapeHtml(c.label)}</th>`)
    .join('');
  return `<tr>
    <th>日期</th><th>城市</th><th>客户名称</th><th>类型</th>
    ${sectionTh}
    ${totalTh}
    <th class="aq-remarks-th">备注</th>
  </tr>`;
}

/** 合并单场报价：Summary 按 bundle 中各场 items 汇总（与导出 Excel 一致） */
function aqRenderBundleSummaryPreviewTable(quotes, layout) {
  const rows = quotes || [];
  const colLayout = layout || aqBuildSummaryPreviewLayout({ quotes: rows });
  const spanBeforeTotals = aqMultiPreviewColsBeforeTotals(colLayout.sectionCols.length);
  let body = '';
  const sum = { subtotal_ex_tax: 0, service_charge: 0, tax_amount: 0, row_total: 0 };
  rows.forEach((q, i) => {
    sum.subtotal_ex_tax += Number(q.subtotal_ex_tax) || 0;
    sum.service_charge += Number(q.service_charge) || 0;
    sum.tax_amount += Number(q.tax_amount) || 0;
    sum.row_total += Number(q.total_amount) || 0;
    const secs = aqSectionTotalsFromQuote(q);
    const sectionTd = colLayout.sectionCols
      .map(
        (col) =>
          `<td class="numeric">${aqFmtNum(aqSectionAmount(secs, col.section_code, col.section_name))}</td>`
      )
      .join('');
    const totalTd = colLayout.totalCols
      .map((col) => {
        const v = Number(q[col.quoteKey]) || 0;
        return `<td class="numeric formula-field${col.key === 'row_total' ? ' aq-row-total' : ''}">${aqFmtNum(v)}</td>`;
      })
      .join('');
    body += `<tr class="${i % 2 ? 'qt-alt-row' : ''}">
      <td>${escapeHtml(aqNormalizeEventDate(q.event_date) || '—')}</td>
      <td>${escapeHtml(q.city || '—')}</td>
      <td>${escapeHtml(q.customer_name || '—')}</td>
      <td>${escapeHtml(q.event_type || '—')}</td>
      ${sectionTd}
      ${totalTd}
      <td class="remark left aq-remarks-cell">—</td>
    </tr>`;
  });
  const footTds = colLayout.totalCols
    .map((col) => `<td class="numeric formula-field">${aqFmtNum(sum[col.key])}</td>`)
    .join('');
  body += `<tr class="qt-footer-row qt-total-row">
    <td colspan="${spanBeforeTotals}" style="text-align:right">多场含税总计</td>
    ${footTds}
    <td class="aq-remarks-cell"></td>
  </tr>`;
  return body;
}

function aqRenderMultiPreviewTable(q, layout) {
  const sessions = aqSortLinkedSessionsByEventDateAsc(q.linked_sessions || []);
  const colLayout = layout || aqBuildSummaryPreviewLayout({ sessions });
  const spanBeforeTotals = aqMultiPreviewColsBeforeTotals(colLayout.sectionCols.length);
  let rows = '';
  sessions.forEach((s, i) => {
    const calc = aqCalcSessionRow(s);
    const secs = aqSectionTotalsFromSession(s);
    const sectionTd = colLayout.sectionCols
      .map(
        (col) =>
          `<td class="numeric">${aqFmtNum(aqSectionAmount(secs, col.section_code, col.section_name))}</td>`
      )
      .join('');
    const totalTd = colLayout.totalCols
      .map(
        (col) =>
          `<td class="numeric formula-field${col.key === 'row_total' ? ' aq-row-total' : ''}">${aqFmtNum(calc[col.key])}</td>`
      )
      .join('');
    let remarks = String(s.remarks || '').trim();
    if (/^来自报价/i.test(remarks)) remarks = '';
    rows += `<tr class="${i % 2 ? 'qt-alt-row' : ''}">
      <td>${escapeHtml(aqNormalizeEventDate(s.event_date) || '—')}</td>
      <td>${escapeHtml(s.city || '—')}</td>
      <td>${escapeHtml(s.customer_name || '—')}</td>
      <td>${escapeHtml(s.event_type || '—')}</td>
      ${sectionTd}
      ${totalTd}
      <td class="remark left aq-remarks-cell" title="${escapeHtml(remarks)}">${escapeHtml(remarks || '—')}</td>
    </tr>`;
  });
  const t = aqCalcMultiGrandTotals(sessions);
  const footByKey = {
    subtotal_ex_tax: t.subtotalExTax,
    service_charge: t.serviceCharge,
    tax_amount: t.taxAmount,
    row_total: t.totalAmount,
  };
  const footTds = colLayout.totalCols
    .map((col) => `<td class="numeric formula-field">${aqFmtNum(footByKey[col.key])}</td>`)
    .join('');
  rows += `<tr class="qt-footer-row qt-total-row">
    <td colspan="${spanBeforeTotals}" style="text-align:right">多场含税总计</td>
    ${footTds}
    <td class="aq-remarks-cell"></td>
  </tr>`;
  return rows;
}


function aqListQuery() {
  const p = new URLSearchParams();
  p.set('type', 'EVENT');
  if (currentYearFrameId) p.set('yearFrameId', String(currentYearFrameId));
  if (activityQuotesState.filterQ) p.set('q', activityQuotesState.filterQ);
  return `?${p.toString()}`;
}

async function aqLoadList() {
  const res = await api('GET', `/quotations${aqListQuery()}`);
  activityQuotesState.list = (Array.isArray(res.data) ? res.data : []).map((r) => ({
    ...r,
    event_date: aqResolveQuoteEventDate(r) || r.event_date,
  }));
  activityQuotesState.listSummary = res.summary || null;
  const visible = new Set(activityQuotesState.list.map((r) => Number(r.id)));
  activityQuotesState.listSelectedIds = (activityQuotesState.listSelectedIds || [])
    .map(Number)
    .filter((id) => visible.has(id));
}

async function aqLoadTemplateSections() {
  const res = await api('GET', '/quotations/template-sections?type=EVENT');
  activityQuotesState.templateSections = Array.isArray(res.data) ? res.data : [];
}

async function aqLoadQuotation(id) {
  const res = await api('GET', `/quotations/${id}`);
  const q = res.data || null;
  if (q) {
    q.event_date = aqResolveQuoteEventDate(q);
    if (q.linked_sessions != null && !Array.isArray(q.linked_sessions)) {
      q.linked_sessions = aqParseLinkedSessions(q.linked_sessions);
    }
    aqNormalizeMultiQuoteAfterLoad(q);
  }
  activityQuotesState.editing = q;
  return activityQuotesState.editing;
}

function aqReenterMultiEdit() {
  const q = activityQuotesState.editing;
  if (q && aqIsMergedExportQuote(q)) {
    let activeId = null;
    const active = activityQuotesState.previewBundleActive || 'summary';
    if (active !== 'summary') {
      activeId = parseInt(String(active).replace(/^q-/, ''), 10);
    }
    aqOpenMergedBundleEdit(q, activeId);
    return;
  }
  if (q) aqNormalizeMultiQuoteAfterLoad(q);
  activityQuotesState.view = 'edit';
  renderActivityQuotes();
}

function aqCloneQuoteForEdit(q) {
  if (!q) return null;
  return JSON.parse(JSON.stringify(q));
}
