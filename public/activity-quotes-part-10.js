function aqNextSubsectionCodeInSection(q, sectionCode) {
  const sec = String(sectionCode || '').trim().toUpperCase();
  const re = new RegExp(`^${sec}-(\\d+)$`, 'i');
  let max = 0;
  (q.items || []).forEach((it) => {
    if (String(it.section_code || '').trim().toUpperCase() !== sec) return;
    const m = String(it.subsection_code || '').trim().match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `${sec}-${max + 1}`;
}

function aqSortOrderFromSubsectionCode(subCode) {
  const m = String(subCode || '').trim().match(/^([A-Za-z]+)-(\d+)$/);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const num = parseInt(m[2], 10);
  if (!Number.isFinite(num)) return null;
  return (letter.charCodeAt(0) - 64) * 100 + num;
}

function aqSectionLetterAt(index) {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s || 'A';
}

/** 与 src/quotation/quotationCodes.js renumberEventQuotationSections 保持一致 */
function aqRenumberEventSectionCodes(items) {
  if (!Array.isArray(items) || !items.length) return items;
  const groups = [];
  const seen = new Map();
  items.forEach((it) => {
    const sk = String(it.section_code || '').trim().toUpperCase();
    if (!seen.has(sk)) {
      seen.set(sk, { section_code: it.section_code, section_name: it.section_name, items: [] });
      groups.push(seen.get(sk));
    }
    seen.get(sk).items.push(it);
  });
  groups.sort((a, b) => aqCompareQuotationCodes(a.section_code, b.section_code));
  const out = [];
  groups.forEach((g, secIdx) => {
    const newLetter = aqSectionLetterAt(secIdx);
    const subMap = new Map();
    const subOrder = [];
    g.items.forEach((it) => {
      const sub = String(it.subsection_code || '').trim();
      if (!subMap.has(sub)) {
        subMap.set(sub, []);
        subOrder.push(sub);
      }
      subMap.get(sub).push(it);
    });
    subOrder.sort((a, b) => aqCompareQuotationCodes(a, b));
    subOrder.forEach((oldSub, subIdx) => {
      const newSub = `${newLetter}-${subIdx + 1}`;
      const sortOrder = aqSortOrderFromSubsectionCode(newSub);
      subMap.get(oldSub).forEach((it) => {
        out.push({
          ...it,
          section_code: newLetter,
          section_name: g.section_name,
          subsection_code: newSub,
          sort_order: sortOrder != null ? sortOrder : it.sort_order,
        });
      });
    });
  });
  return out;
}

function aqSortGroupedSections(sections) {
  sections.sort((a, b) => aqCompareQuotationCodes(a.section_code, b.section_code));
  sections.forEach((sec) => {
    sec.subsections.sort((a, b) => aqCompareQuotationCodes(a.subsection_code, b.subsection_code));
    sec.subsections.forEach((sub) => {
      sub.items.sort(
        (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0)
      );
    });
  });
  return sections;
}

/** 在空子类下新增行时，sort_order 落在该子类/大区块区间，避免排到下一区块后面 */
function aqSortOrderForNewItem(q, ref) {
  const subCode = String(ref.subsection_code || '').trim();
  const sameSub = (q.items || []).filter((it) => String(it.subsection_code || '').trim() === subCode);
  if (sameSub.length) {
    return Math.max(0, ...sameSub.map((it) => it.sort_order || 0)) + 1;
  }
  const tpl = (activityQuotesState.templateSections || []).filter(
    (t) => String(t.subsection_code || '').trim() === subCode
  );
  if (tpl.length) {
    return Math.min(...tpl.map((t) => t.sort_order || 0));
  }
  const fromLetter = aqSortOrderFromSubsectionCode(subCode);
  if (fromLetter != null) return fromLetter;
  const sec = parseFloat(ref.section_code);
  const subPart = parseFloat(String(subCode).split('.')[1]);
  if (Number.isFinite(sec) && Number.isFinite(subPart)) return sec * 100 + subPart;
  return Math.max(0, ...(q.items || []).map((it) => it.sort_order || 0)) + 1;
}

function aqAutoResizeDescTextarea(el) {
  if (!el) return;
  if (el.closest('.aq-page-edit .qt-detail-table')) {
    el.style.height = '24px';
    return;
  }
  el.style.height = 'auto';
  el.style.height = `${Math.max(28, el.scrollHeight)}px`;
}

function aqRenderRowDragHandleCell() {
  return `<td class="aq-col-drag"><button type="button" class="aq-row-drag-handle" title="按住拖动调整行顺序" aria-label="拖动排序"><span class="aq-row-drag-grip" aria-hidden="true"></span></button></td>`;
}

function aqInitEditRowDragListeners() {
  if (activityQuotesState.editRowDragBound) return;
  activityQuotesState.editRowDragBound = true;
  document.addEventListener('mousedown', aqEditRowDragMouseDown);
  document.addEventListener('mousemove', aqEditRowDragMouseMove);
  document.addEventListener('mouseup', aqEditRowDragMouseUp);
}

function aqClearEditRowDragMarkers(tbody) {
  if (!tbody) return;
  tbody.querySelectorAll('tr[data-item-idx]').forEach((tr) => {
    tr.classList.remove('aq-row-dragging', 'aq-row-drop-before', 'aq-row-drop-after');
  });
}

function aqEditRowDragTargetFromY(tbody, clientY) {
  const rows = [...tbody.querySelectorAll('tr[data-item-idx]')];
  if (!rows.length) return { row: null, insertAfter: false };
  for (const tr of rows) {
    const rect = tr.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (clientY < mid) return { row: tr, insertAfter: false };
  }
  const last = rows[rows.length - 1];
  return { row: last, insertAfter: true };
}

/** 拖拽后按 items 顺序在各板块内重编 Item 编号（A-1、A-2…），避免 rowspan 错位 */
function aqRenumberSubsectionsAfterReorder(q) {
  const counters = new Map();
  (q.items || []).forEach((it) => {
    const sk = `${String(it.section_code || '').trim()}|${String(it.section_name || '').trim()}`;
    const letter = String(it.section_code || '').trim().toUpperCase();
    const n = (counters.get(sk) || 0) + 1;
    counters.set(sk, n);
    it.subsection_code = `${letter}-${n}`;
    const sortOrder = aqSortOrderFromSubsectionCode(it.subsection_code);
    if (sortOrder != null) it.sort_order = sortOrder;
  });
}

function aqReorderItemsByDrag(dragIdx, targetIdx, insertAfter) {
  const q = activityQuotesState.editing;
  if (!q || !Array.isArray(q.items) || aqIsMultiQuote(q)) return;
  const from = q.items.findIndex((it) => it._idx === dragIdx);
  let to = q.items.findIndex((it) => it._idx === targetIdx);
  if (from < 0 || to < 0 || from === to) return;
  const target = q.items[to];
  const [moved] = q.items.splice(from, 1);
  if (from < to) to -= 1;
  const insertAt = insertAfter ? to + 1 : to;
  q.items.splice(insertAt, 0, moved);
  moved.section_code = target.section_code;
  moved.section_name = target.section_name;
  aqRenumberSubsectionsAfterReorder(q);
  aqPrepareEditingItems({ skipRenumber: true });
  aqRefreshEditView();
}

function aqEditRowDragMouseDown(ev) {
  if (ev.button !== 0) return;
  const handle = ev.target.closest('.aq-row-drag-handle');
  if (!handle) return;
  const tbody = document.getElementById('aqEditTableBody');
  if (!tbody || !tbody.contains(handle)) return;
  const row = handle.closest('tr[data-item-idx]');
  if (!row) return;
  const dragIdx = parseInt(row.dataset.itemIdx, 10);
  if (!Number.isFinite(dragIdx)) return;
  ev.preventDefault();
  aqEditRowDragSession = {
    dragIdx,
    row,
    tbody,
    insertAfter: false,
    dropTargetIdx: dragIdx,
  };
  row.classList.add('aq-row-dragging');
  document.body.classList.add('aq-row-drag-active');
}

function aqEditRowDragMouseMove(ev) {
  const sess = aqEditRowDragSession;
  if (!sess?.tbody) return;
  ev.preventDefault();
  aqClearEditRowDragMarkers(sess.tbody);
  const hit = aqEditRowDragTargetFromY(sess.tbody, ev.clientY);
  if (!hit.row) return;
  const targetIdx = parseInt(hit.row.dataset.itemIdx, 10);
  if (!Number.isFinite(targetIdx)) return;
  sess.dropTargetIdx = targetIdx;
  sess.insertAfter = hit.insertAfter;
  hit.row.classList.add(hit.insertAfter ? 'aq-row-drop-after' : 'aq-row-drop-before');
}

function aqEditRowDragMouseUp() {
  const sess = aqEditRowDragSession;
  if (!sess) return;
  document.body.classList.remove('aq-row-drag-active');
  aqClearEditRowDragMarkers(sess.tbody);
  sess.row.classList.remove('aq-row-dragging');
  const { dragIdx, dropTargetIdx, insertAfter } = sess;
  aqEditRowDragSession = null;
  if (Number.isFinite(dragIdx) && Number.isFinite(dropTargetIdx) && dragIdx !== dropTargetIdx) {
    aqReorderItemsByDrag(dragIdx, dropTargetIdx, insertAfter);
  }
}

function aqAutoResizeAllDescTextareas(root) {
  const scope = root || document;
  scope.querySelectorAll('textarea.aq-inp-desc').forEach((el) => aqAutoResizeDescTextarea(el));
}

function aqOnDescInput(ev, idx) {
  aqOnItemFieldChange(idx, 'description', ev.target.value);
  aqAutoResizeDescTextarea(ev.target);
}

function aqRenderDescriptionInput(it) {
  const descPlain = String(it.description || '');
  return `<td class="left"><textarea class="form-control form-control-sm aq-inp-desc" rows="1"
    oninput="aqOnDescInput(event, ${it._idx})">${escapeHtml(descPlain)}</textarea></td>`;
}

function aqGroupItemsForTable(items) {
  const sections = [];
  const secMap = new Map();
  (items || []).forEach((it) => {
      const sk = `${it.section_code}|${it.section_name}`;
      if (!secMap.has(sk)) {
        const sec = {
          section_code: it.section_code,
          section_name: it.section_name,
          subsections: [],
          sectionSubtotal: 0,
        };
        secMap.set(sk, sec);
        sections.push(sec);
      }
      const sec = secMap.get(sk);
      let sub = sec.subsections.find((s) => s.subsection_code === it.subsection_code);
      if (!sub) {
        sub = { subsection_code: it.subsection_code, subsection_name: it.subsection_name, items: [] };
        sec.subsections.push(sub);
      }
      sub.items.push(it);
      sec.sectionSubtotal += aqItemSubtotal(it);
    });
  sections.forEach((s) => {
    s.sectionSubtotal = Math.round(s.sectionSubtotal * 100) / 100;
  });
  return aqSortGroupedSections(sections);
}
