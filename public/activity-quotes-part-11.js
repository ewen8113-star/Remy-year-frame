function aqRenderTemplatePicker() {
  const groups = aqGroupTemplateSections(activityQuotesState.templateSections);
  return groups
    .map((sec) => {
      const subs = sec.subsections
        .map((sub) => {
          const chips = sub.items
            .map((t) => {
              const checked = activityQuotesState.selectedTemplateIds.has(t.id);
              return `<label class="aq-tpl-chip${checked ? ' aq-tpl-chip-on' : ''}">
              <input type="checkbox" ${checked ? 'checked' : ''} onchange="aqToggleTemplateItem(${t.id}, this.checked)">
              <span>${escapeHtml(String(t.description).replace(/\n/g, ' '))}</span>
            </label>`;
            })
            .join('');
          return `<div class="aq-tpl-sub">
            <div class="aq-tpl-sub-head">
              <label class="aq-tpl-sub-all">
                <input type="checkbox" onchange="aqToggleSubsectionAll('${escapeHtml(sub.subsection_code)}', this.checked)">
                <strong>${escapeHtml(sub.subsection_code)} ${escapeHtml(sub.subsection_name)}</strong>
              </label>
            </div>
            <div class="aq-tpl-chips">${chips}</div>
          </div>`;
        })
        .join('');
      return `<div class="aq-tpl-section">
        <div class="aq-tpl-section-title">${escapeHtml(aqFormatSectionHeaderLabel(sec.section_code, sec.section_name))}</div>
        ${subs}
      </div>`;
    })
    .join('');
}

function aqToggleTemplateItem(id, on) {
  if (on) activityQuotesState.selectedTemplateIds.add(id);
  else activityQuotesState.selectedTemplateIds.delete(id);
  const el = document.getElementById('aqTemplatePickerHost');
  if (el) el.innerHTML = aqRenderTemplatePicker();
}

function aqToggleSubsectionAll(subCode, on) {
  activityQuotesState.templateSections.forEach((t) => {
    if (t.subsection_code === subCode) {
      if (on) activityQuotesState.selectedTemplateIds.add(t.id);
      else activityQuotesState.selectedTemplateIds.delete(t.id);
    }
  });
  const el = document.getElementById('aqTemplatePickerHost');
  if (el) el.innerHTML = aqRenderTemplatePicker();
}

function aqRenderEditTableRows(q) {
  const groups = aqGroupItemsForTable(q.items || []);
  let alt = false;
  const rows = [];
  groups.forEach((sec) => {
    rows.push(aqRenderSectionHeaderEditRow(sec));
    sec.subsections.forEach((sub) => {
      sub.items.forEach((it) => {
        const subCodeCell = `<td class="aq-col-item">${escapeHtml(String(it.subsection_code || sub.subsection_code || ''))}</td>`;
        const catCell = aqRenderCategorySelect(it);
        const descCell = aqRenderDescriptionInput(it);
        const qtyDisp = aqNumInputValue(parseFloat(it.quantity) || 0);
        const priceDisp = aqUnitPriceInputValue(it.unit_price);
        rows.push(`<tr class="${alt ? 'qt-alt-row' : ''}" data-item-idx="${it._idx}">
          ${subCodeCell}
          ${catCell}
          ${descCell}
          <td><input type="number" value="${escapeHtml(qtyDisp)}" ${aqNumInputAttrs(`class="aq-inp-qty" step="any" oninput="aqOnItemFieldChange(${it._idx}, &quot;quantity&quot;, aqNumInpParse(event.target))" onchange="aqOnItemFieldChange(${it._idx}, &quot;quantity&quot;, aqNumInpParse(event.target))"`)}></td>
          <td><input type="text" class="form-control form-control-sm"
            value="${escapeHtml(it.unit || '')}" onchange="aqOnItemFieldChange(${it._idx}, &quot;unit&quot;, event.target.value)"></td>
          <td><input type="number" value="${escapeHtml(priceDisp)}" ${aqUnitPriceInputAttrs(`class="aq-inp-price" oninput="aqOnItemFieldChange(${it._idx}, &quot;unit_price&quot;, aqNumInpParse(event.target))" onchange="aqOnItemFieldChange(${it._idx}, &quot;unit_price&quot;, aqNumInpParse(event.target))"`)}></td>
          <td class="right aq-line-sub">${aqFmtNum(aqItemSubtotal(it))}</td>
          <td><input type="text" class="form-control form-control-sm"
            value="${escapeHtml(it.remarks || '')}" onchange="aqOnItemFieldChange(${it._idx}, &quot;remarks&quot;, event.target.value)"></td>
          ${aqRenderRowDragHandleCell()}
          <td class="aq-col-actions"><button type="button" class="btn btn-xs btn-ghost aq-row-del-btn" onclick="aqRemoveItem(${it._idx})" title="删除行">×</button></td>
        </tr>`);
        alt = !alt;
      });
    });
    rows.push(`<tr class="aq-add-row-tr"><td colspan="10" class="left">
      <button type="button" class="btn btn-xs btn-secondary" onclick='aqAddSectionLine(${JSON.stringify(String(sec.section_code || ''))})'>+ 本板块添加行</button>
    </td></tr>`);
  });
  rows.push(`<tr class="aq-add-row-tr"><td colspan="10" class="left">
    <button type="button" class="btn btn-xs btn-primary" onclick="aqAddCustomSection()">+ 添加大板块</button>
  </td></tr>`);
  return rows.join('');
}

/** 预览/导出表 8 列：分类(2) + 明细(4) + 小计 + 备注；底栏与分区行按此分列，避免 colspan 与固定列宽错位 */
function aqPreviewSectionHeaderRow(sec) {
  return `<tr class="qt-section-header">
      <td colspan="7" class="left">${escapeHtml(aqFormatSectionHeaderLabel(sec.section_code, sec.section_name))}</td>
      <td class="right formula-field">${aqFmtNum(sec.sectionSubtotal)}</td>
      <td></td>
    </tr>`;
}

function aqPreviewFooterRowsHtml(q) {
  const t = aqCalcTotalsForQuote(q);
  const pct = Math.round(t.serviceRate * 100);
  const mk = (label, val, total) => {
    const trCls = total ? 'qt-footer-row qt-total-row' : 'qt-footer-row';
    return `<tr class="${trCls}">
      <td colspan="7" class="qt-footer-label">${label}</td>
      <td class="val-cell right">${aqFmtNum(val)}</td>
      <td></td>
    </tr>`;
  };
  return [
    mk('1. 不含税小计 Subtotal excluding Tax', t.subtotalExTax, false),
    mk(`2. 公司服务费 Service Charge(${pct}%)`, t.serviceCharge, false),
    mk('3. 国家及地方政府税收(6%) Government Tax', t.taxAmount, false),
    mk('4. 含税总计 TOTAL', t.totalAmount, true),
  ].join('');
}

function aqRenderPreviewTable(q) {
  const groups = aqGroupItemsForTable(q.items || []);
  let alt = false;
  const rows = [];
  groups.forEach((sec) => {
    rows.push(aqPreviewSectionHeaderRow(sec));
    sec.subsections.forEach((sub) => {
      const n = sub.items.length;
      sub.items.forEach((it, idx) => {
        const subCodeCell =
          idx === 0
            ? `<td rowspan="${n}">${escapeHtml(sub.subsection_code)}</td>`
            : '';
        rows.push(`<tr class="${alt ? 'qt-alt-row' : ''}">
          ${subCodeCell}
          <td>${escapeHtml(it.item_category || '')}</td>
          <td class="left">${escapeHtml(String(it.description || '').replace(/\n/g, '<br>'))}</td>
          <td>${aqFmtNum(it.quantity, 0)}</td>
          <td>${escapeHtml(it.unit || '')}</td>
          <td>${aqFmtNum(it.unit_price)}</td>
          <td class="formula-field right">${aqFmtNum(aqItemSubtotal(it))}</td>
          <td class="remark left">${escapeHtml(it.remarks || '')}</td>
        </tr>`);
        alt = !alt;
      });
    });
  });
  rows.push(aqPreviewFooterRowsHtml(q));
  return rows.join('');
}

const AQ_EXPORT_COL_LABELS = ['内容', '分类', '说明', '数量', '单位', '单价', '小计', '备注'];
const AQ_EXPORT_LAYOUT_STORAGE_KEY = 'remy_aq_export_layout_v1';

function aqDefaultExportLayout() {
  return { columnWidths: [5, 7, 42, 6, 6, 8, 9, 12], defaultRowHeight: 7 };
}

function aqCloneExportLayout(src) {
  const base = src && typeof src === 'object' ? src : aqDefaultExportLayout();
  const def = aqDefaultExportLayout();
  return {
    columnWidths: Array.isArray(base.columnWidths)
      ? base.columnWidths.map((w) => Number(w) || 1)
      : def.columnWidths.slice(),
    defaultRowHeight:
      Number.isFinite(Number(base.defaultRowHeight)) && Number(base.defaultRowHeight) > 0
        ? Number(base.defaultRowHeight)
        : def.defaultRowHeight,
  };
}

function aqLoadPersistedLayoutStore() {
  try {
    const raw = localStorage.getItem(AQ_EXPORT_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

function aqPersistExportLayout() {
  try {
    localStorage.setItem(
      AQ_EXPORT_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        pageOrientation: activityQuotesState.exportPdfSettings?.pageOrientation || 'landscape',
        byQuoteId: activityQuotesState.exportLayoutByQuoteId || {},
      })
    );
  } catch (_) {
    /* ignore quota */
  }
}

function aqApplyPersistedPdfOrientation() {
  const store = aqLoadPersistedLayoutStore();
  if (!store?.pageOrientation) return;
  activityQuotesState.exportPdfSettings = activityQuotesState.exportPdfSettings || {};
  activityQuotesState.exportPdfSettings.pageOrientation =
    store.pageOrientation === 'portrait' ? 'portrait' : 'landscape';
}

function aqGetPersistedLayoutForQuote(quoteId) {
  const store = aqLoadPersistedLayoutStore();
  const raw = store?.byQuoteId?.[String(quoteId)];
  return raw ? aqCloneExportLayout(raw) : null;
}

function aqGetLayoutForQuote(quoteId) {
  const key = String(quoteId);
  if (activityQuotesState.exportLayoutByQuoteId[key]) {
    return aqCloneExportLayout(activityQuotesState.exportLayoutByQuoteId[key]);
  }
  return aqGetPersistedLayoutForQuote(quoteId) || aqDefaultExportLayout();
}

function aqColumnWidthsHtml(cols) {
  const sum = cols.reduce((a, b) => a + Number(b), 0) || 1;
  return cols
    .map((w) => `<col style="width:${((Number(w) / sum) * 100).toFixed(2)}%">`)
    .join('');
}

function aqApplyColumnWidthsToTable(table, cols) {
  if (!table || !Array.isArray(cols)) return;
  const colEls = table.querySelectorAll('colgroup col');
  const sum = cols.reduce((a, b) => a + Number(b), 0) || 1;
  cols.forEach((w, i) => {
    if (colEls[i]) colEls[i].style.width = `${((Number(w) / sum) * 100).toFixed(2)}%`;
  });
}

function aqRenderQuotePreviewTableForExport(q) {
  const layout = aqGetLayoutForQuote(q.id);
  activityQuotesState.exportLayoutByQuoteId[String(q.id)] = aqCloneExportLayout(layout);
  const cols = layout.columnWidths;
  const heads = [
    ['内容', 'Item'],
    ['分类', 'Category'],
    ['说明', 'Summary'],
    ['数量', 'Quantity'],
    ['单位', 'Unit'],
    ['单价', 'Unit Price'],
    ['单项小计', 'Subtotal'],
    ['备注', 'Remarks'],
  ];
  const thHtml = heads
    .map(
      (pair, i) =>
        `<th class="aq-col-head aq-col-resizable" data-col="${i}">
          <span class="aq-col-head-text">${pair[0]}<br>${pair[1]}</span>
          ${i < heads.length - 1 ? `<span class="aq-col-resizer" data-col="${i}" role="separator" title="拖拽调整列宽"></span>` : ''}
        </th>`
    )
    .join('');
  return `<table class="qt-detail-table aq-export-preview-table" data-quote-id="${q.id}">
    <colgroup>${aqColumnWidthsHtml(cols)}</colgroup>
    <thead><tr>${thHtml}</tr></thead>
    <tbody>${aqRenderPreviewTable(q)}</tbody>
  </table>`;
}

function aqIsMergedPreviewWithLayout() {
  const q = activityQuotesState.editing;
  return (
    activityQuotesState.view === 'preview' &&
    aqIsMergedExportQuote(q) &&
    (activityQuotesState.previewBundleQuotes || []).length > 0
  );
}
