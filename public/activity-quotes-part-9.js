async function aqLoadMergedBundleForEdit(multiId) {
  try {
    const res = await api('GET', `/quotations/${multiId}/bundle-edit`);
    const data = res.data || null;
    if (data && Array.isArray(data.singles) && data.singles.length) return data;
  } catch (_) {
    /* 回退 bundle-preview */
  }
  const singles = aqSortQuotesByEventDateAsc(await aqLoadPreviewBundleQuotes(multiId));
  if (!singles.length) return null;
  const parent = activityQuotesState.editing;
  return {
    parent: parent
      ? { id: parent.id, quotation_no: parent.quotation_no, project_name: parent.project_name }
      : { id: multiId },
    singles,
  };
}

function aqPersistMergedEditActiveToCache() {
  const activeId = activityQuotesState.mergedEditActiveId;
  const q = activityQuotesState.editing;
  if (!activeId || !q || aqIsMultiQuote(q)) return;
  aqReadQtHeaderFromDom();
  const idx = (activityQuotesState.mergedEditQuotes || []).findIndex(
    (x) => Number(x.id) === Number(activeId)
  );
  if (idx >= 0) activityQuotesState.mergedEditQuotes[idx] = aqCloneQuoteForEdit(q);
}

function aqSetMergedEditActive(quoteId) {
  aqPersistMergedEditActiveToCache();
  const id = Number(quoteId);
  const hit = (activityQuotesState.mergedEditQuotes || []).find((x) => Number(x.id) === id);
  if (!hit) return;
  activityQuotesState.mergedEditActiveId = id;
  activityQuotesState.editing = aqCloneQuoteForEdit(hit);
  aqClearEditUndo();
  aqPrepareEditingItems({ skipRenumber: true });
  activityQuotesState.view = 'mergedEdit';
  renderActivityQuotes();
}

async function aqOpenMergedBundleEdit(multiQ, preferredActiveId) {
  if (!multiQ || !multiQ.id) return;
  try {
    await aqLoadTemplateSections();
    const bundle = await aqLoadMergedBundleForEdit(multiQ.id);
    if (!bundle || !bundle.singles.length) {
      showToast('无法加载合并来源的单场报价，请确认 merged_from_quote_ids 或场次备注', 'error');
      return;
    }
    activityQuotesState.mergedEditParent = bundle.parent || {
      id: multiQ.id,
      project_name: multiQ.project_name,
      quotation_no: multiQ.quotation_no,
    };
    activityQuotesState.mergedEditQuotes = bundle.singles.map((s) => aqCloneQuoteForEdit(s));
    const prefer = Number(preferredActiveId);
    const first = activityQuotesState.mergedEditQuotes[0];
    const active =
      Number.isFinite(prefer) &&
      activityQuotesState.mergedEditQuotes.some((x) => Number(x.id) === prefer)
        ? prefer
        : Number(first && first.id);
    activityQuotesState.mergedEditActiveId = active;
    activityQuotesState.editing = aqCloneQuoteForEdit(
      activityQuotesState.mergedEditQuotes.find((x) => Number(x.id) === active) || first
    );
    aqClearEditUndo();
    aqPrepareEditingItems({ skipRenumber: true });
    activityQuotesState.view = 'mergedEdit';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '加载合并编辑失败', 'error');
  }
}

function aqClearMergedEditState() {
  activityQuotesState.mergedEditParent = null;
  activityQuotesState.mergedEditQuotes = [];
  activityQuotesState.mergedEditActiveId = null;
}

function aqRenderMergedEditTabsHtml() {
  const quotes = activityQuotesState.mergedEditQuotes || [];
  const active = Number(activityQuotesState.mergedEditActiveId);
  return quotes
    .map((q, i) => {
      const on = Number(q.id) === active;
      return `<button type="button" class="btn btn-xs ${on ? 'btn-primary' : 'btn-secondary'}" onclick="aqSetMergedEditActive(${q.id})" title="${escapeHtml(q.project_code || '')}">${escapeHtml(aqSheetLabelForQuote(q, i))}</button>`;
    })
    .join('');
}

function aqRenderMergedEditHtml() {
  const q = activityQuotesState.editing;
  const parent = activityQuotesState.mergedEditParent;
  if (!q || !parent) return '';
  const pct = Math.round((parseFloat(q.service_rate) || aqDefaultServiceRate()) * 100);
  return `
    <div class="aq-edit-head">
      <button type="button" class="btn btn-secondary btn-sm" onclick="aqBackToList()">← 返回列表</button>
      <div class="aq-edit-head-meta">
        <span class="aq-badge-multi">合并报价</span>
        <span class="form-hint">${escapeHtml(parent.project_name || '—')}</span>
        <code class="aq-linked-pc">${escapeHtml(q.project_code || q.activity_project_code || '—')}</code>
      </div>
      <div class="aq-edit-head-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="aqOpenPreview(${parent.id})">预览合并版式</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="aqSaveEditing()">保存当前场次</button>
      </div>
    </div>
    <div class="aq-export-tabs aq-merged-edit-tabs" id="aqMergedEditTabs">${aqRenderMergedEditTabsHtml()}</div>
    <p class="form-hint aq-merged-edit-hint">合并报价由多场<strong>单场报价</strong>组成；请切换上方 Tab 分别编辑各场次明细（非 Summary 手填表）。</p>
    <div class="qt-sheet-wrap">
      ${aqRenderQtHeaderHtml(q, false, { editable: true })}
      <div class="info-row form-hint qt-header-extra">服务费率 ${pct}% · 活动类型 ${escapeHtml(q.event_type || '—')}</div>
      <div class="table-wrapper qt-table-scroll aq-edit-table-scroll">
        <table class="qt-detail-table aq-edit-table-sticky-head">
          <thead><tr>
            <th>Item</th><th>分类</th><th>说明</th><th>数量</th><th>单位</th><th>单价</th><th>单项小计</th><th>备注</th>
            <th class="aq-col-drag" title="拖动排序"></th><th class="aq-col-actions"></th>
          </tr></thead>
          <tbody id="aqEditTableBody">${aqRenderEditTableRows(q)}</tbody>
        </table>
      </div>
      <div id="aqEditTotals" class="aq-totals-bar"></div>
      <p class="form-hint aq-edit-undo-hint">删除明细行后可用 <kbd>Ctrl</kbd>+<kbd>Z</kbd>（Mac：<kbd>⌘</kbd>+<kbd>Z</kbd>）撤销；行尾可拖动排序。</p>
    </div>`;
}

function aqGroupTemplateSections(rows) {
  const sections = [];
  const map = new Map();
  (rows || []).forEach((r) => {
    const sk = `${r.section_code}|${r.section_name}`;
    if (!map.has(sk)) {
      const sec = { section_code: r.section_code, section_name: r.section_name, subsections: [] };
      map.set(sk, sec);
      sections.push(sec);
    }
    const sec = map.get(sk);
    let sub = sec.subsections.find((s) => s.subsection_code === r.subsection_code);
    if (!sub) {
      sub = { subsection_code: r.subsection_code, subsection_name: r.subsection_name, items: [] };
      sec.subsections.push(sub);
    }
    sub.items.push(r);
  });
  return sections;
}

function aqCompareQuotationCodes(a, b) {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  const letterNum = /^([A-Za-z]+)-(\d+)$/;
  const ma = sa.match(letterNum);
  const mb = sb.match(letterNum);
  if (ma && mb) {
    const lc = ma[1].toUpperCase().localeCompare(mb[1].toUpperCase());
    if (lc !== 0) return lc;
    return parseInt(ma[2], 10) - parseInt(mb[2], 10);
  }
  if (/^[A-Za-z]+$/.test(sa) && /^[A-Za-z]+$/.test(sb)) {
    return sa.toUpperCase().localeCompare(sb.toUpperCase());
  }
  const pa = sa.split('.').map((x) => parseFloat(x));
  const pb = sb.split('.').map((x) => parseFloat(x));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = Number.isFinite(pa[i]) ? pa[i] : 0;
    const db = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (da !== db) return da - db;
  }
  return sa.localeCompare(sb, 'zh');
}

function aqFormatSectionHeaderLabel(sectionCode, sectionName) {
  const code = String(sectionCode || '').trim();
  const name = String(sectionName || '').trim();
  if (!code) return name || '—';
  if (!name) return code;
  return `${code}-${name}`;
}

function aqSectionHeaderMatchesItem(it, sectionCode, sectionName) {
  return (
    String(it.section_code || '').trim() === String(sectionCode || '').trim() &&
    String(it.section_name || '').trim() === String(sectionName || '').trim()
  );
}

/** 更新大板块编号/名称，并同步该板块下所有明细行 */
function aqApplySectionHeaderUpdate(q, oldCode, oldName, newCode, newName) {
  const prevCode = String(oldCode || '').trim();
  const prevName = String(oldName || '').trim();
  const nextCode = String(newCode || '').trim().toUpperCase();
  const nextName = String(newName || '').trim();
  const codeChanged = prevCode.toUpperCase() !== nextCode;
  const subRe = codeChanged
    ? new RegExp(`^${prevCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i')
    : null;
  (q.items || []).forEach((it) => {
    if (!aqSectionHeaderMatchesItem(it, prevCode, prevName)) return;
    it.section_code = nextCode;
    it.section_name = nextName;
    if (codeChanged && subRe) {
      const sub = String(it.subsection_code || '').trim();
      const m = sub.match(subRe);
      if (m) {
        it.subsection_code = `${nextCode}-${m[1]}`;
        const sortOrder = aqSortOrderFromSubsectionCode(it.subsection_code);
        if (sortOrder != null) it.sort_order = sortOrder;
      }
    }
  });
}

function aqOnSectionHeaderFieldChange(el, field) {
  const tr = el?.closest?.('tr.qt-section-header');
  const q = activityQuotesState.editing;
  if (!tr || !q || aqIsMultiQuote(q)) return;
  const oldCode = String(tr.dataset.sectionCode || '').trim();
  const oldName = String(tr.dataset.sectionName || '').trim();
  const codeInp = tr.querySelector('.aq-sec-code');
  const nameInp = tr.querySelector('.aq-sec-name');
  let newCode = String(codeInp?.value || '').trim().toUpperCase();
  let newName = String(nameInp?.value || '').trim();
  if (field === 'code' && codeInp) codeInp.value = newCode;
  if (!newCode || !newName) {
    showToast('板块编号和名称不能为空', 'warning');
    if (codeInp) codeInp.value = oldCode;
    if (nameInp) nameInp.value = oldName;
    return;
  }
  if (newCode === oldCode && newName === oldName) return;
  const duplicate = (q.items || []).some((it) => {
    if (aqSectionHeaderMatchesItem(it, oldCode, oldName)) return false;
    return (
      String(it.section_code || '').trim().toUpperCase() === newCode &&
      String(it.section_name || '').trim() === newName
    );
  });
  if (duplicate) {
    showToast('已存在相同编号与名称的板块', 'warning');
    if (codeInp) codeInp.value = oldCode;
    if (nameInp) nameInp.value = oldName;
    return;
  }
  aqApplySectionHeaderUpdate(q, oldCode, oldName, newCode, newName);
  tr.dataset.sectionCode = newCode;
  tr.dataset.sectionName = newName;
  if (newCode !== oldCode) {
    aqPrepareEditingItems({ skipRenumber: true });
    aqRefreshEditView();
    return;
  }
  aqRefreshSectionSubtotals();
}

function aqRenderSectionHeaderEditRow(sec) {
  const code = String(sec.section_code || '').trim();
  const name = String(sec.section_name || '').trim();
  return `<tr class="qt-section-header" data-section-code="${escapeHtml(code)}" data-section-name="${escapeHtml(name)}">
      <td colspan="7" class="left aq-sec-header-cell">
        <div class="aq-sec-header-edit">
          <input type="text" class="form-control form-control-sm aq-sec-code" maxlength="8" value="${escapeHtml(code)}"
            title="板块编号（如 A、B）" onchange="aqOnSectionHeaderFieldChange(this, 'code')" />
          <span class="aq-sec-sep" aria-hidden="true">-</span>
          <input type="text" class="form-control form-control-sm aq-sec-name" maxlength="120" value="${escapeHtml(name)}"
            title="板块名称" onchange="aqOnSectionHeaderFieldChange(this, 'name')" />
        </div>
      </td>
      <td class="right aq-sec-subtotal">${aqFmtNum(sec.sectionSubtotal)}</td>
      <td class="aq-col-drag"></td>
      <td class="aq-col-actions"></td>
    </tr>`;
}
