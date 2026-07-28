async function aqConfirmMultiPickStep() {
  const ids = activityQuotesState.multiPickSelectedIds || [];
  if (!ids.length) {
    showToast('请至少勾选一场活动', 'warning');
    return;
  }
  const sessions = [];
  ids.forEach((id, i) => {
    const act = activityQuotesState.createActivities.find((a) => Number(a.id) === Number(id));
    if (act) sessions.push(aqSessionFromActivity(act, i));
  });
  if (!sessions.length) {
    showToast('所选场次无效，请重新勾选', 'warning');
    return;
  }
  const projectName = (document.getElementById('aqMultiPickProjectName')?.value || activityQuotesState.multiProjectName || '').trim();
  if (!projectName) {
    showToast('请填写报价名称', 'warning');
    return;
  }
  activityQuotesState.multiProjectName = projectName;
  try {
    const res = await api('POST', '/quotations', {
      type: 'EVENT',
      quote_mode: 'multi',
      year_frame_id: currentYearFrameId,
      project_name: projectName,
      linked_sessions: sessions,
    });
    const q = res.data;
    if (!q) throw new Error('创建失败');
    q.event_date = aqNormalizeEventDate(q.event_date);
    activityQuotesState.editing = q;
    activityQuotesState.multiDraftPristine = false;
    aqEnsureMultiSessions(q);
    aqPrepareEditingItems();
    activityQuotesState.view = 'edit';
    activityQuotesState.multiPickSelectedIds = [];
    activityQuotesState.multiAddSelectedIds = [];
    await renderActivityQuotes();
    showToast(`已载入 ${sessions.length} 场，请填写各行费用`, 'success');
  } catch (e) {
    showToast(e.message || '创建失败', 'error');
  }
}

function aqGetMultiAddAvailableActivities() {
  const q = activityQuotesState.editing;
  if (!q || !aqIsMultiQuote(q)) return [];
  const linked = aqLinkedActivityIdSet(q);
  return aqGetFilteredActivitiesForPicker().filter((a) => !linked.has(Number(a.id)));
}

function aqIsMultiAddAllSelected() {
  const available = aqGetMultiAddAvailableActivities();
  if (!available.length) return false;
  const selected = new Set((activityQuotesState.multiAddSelectedIds || []).map(Number));
  return available.every((a) => selected.has(Number(a.id)));
}

function aqUpdateMultiAddToggleAllBtn() {
  const btn = document.getElementById('aqMultiAddToggleAllBtn');
  if (!btn) return;
  const available = aqGetMultiAddAvailableActivities();
  if (!available.length) {
    btn.disabled = true;
    btn.textContent = '全选';
    return;
  }
  btn.disabled = false;
  btn.textContent = aqIsMultiAddAllSelected() ? '取消全选' : '全选';
}

function aqRefreshMultiAddPanel() {
  const addPanel = document.getElementById('aqMultiAddPanelBody');
  if (addPanel) addPanel.innerHTML = aqRenderMultiAddPanelRows();
  aqUpdateMultiAddToggleAllBtn();
}

/** 点一下全选当前可添加场次，再点一下取消全选，可循环 */
function aqToggleMultiAddSelectAll() {
  const available = aqGetMultiAddAvailableActivities();
  if (!available.length) {
    showToast('当前没有可勾选的场次', 'warning');
    return;
  }
  if (aqIsMultiAddAllSelected()) {
    activityQuotesState.multiAddSelectedIds = [];
  } else {
    activityQuotesState.multiAddSelectedIds = available.map((a) => Number(a.id));
  }
  aqRefreshMultiAddPanel();
}

function aqToggleMultiAddId(id, checked) {
  const ids = new Set((activityQuotesState.multiAddSelectedIds || []).map(Number));
  const n = Number(id);
  if (checked) ids.add(n);
  else ids.delete(n);
  activityQuotesState.multiAddSelectedIds = [...ids];
  aqUpdateMultiAddToggleAllBtn();
}

function aqRenderMultiAddPanelRows() {
  const q = activityQuotesState.editing;
  if (!q || !aqIsMultiQuote(q)) return '';
  const linked = aqLinkedActivityIdSet(q);
  const available = aqGetFilteredActivitiesForPicker().filter((a) => !linked.has(Number(a.id)));
  const selected = new Set((activityQuotesState.multiAddSelectedIds || []).map(Number));
  if (!available.length) {
    return '<p class="form-hint" style="margin:0">当前筛选下没有可添加的场次（或已全部加入表格）</p>';
  }
  return available
    .map((a) => {
      const id = Number(a.id);
      const checked = selected.has(id) ? ' checked' : '';
      const date = aqFormatActivityDate(a) || '—';
      return `<label class="aq-multi-add-row">
      <input type="checkbox" value="${id}"${checked} onchange="aqToggleMultiAddId(${id}, this.checked)">
      <span><code>${escapeHtml(a.project_code || '')}</code> · ${escapeHtml(date)} · ${escapeHtml(a.city || '—')}</span>
    </label>`;
    })
    .join('');
}

function aqAddSelectedSessionsFromPanel() {
  const q = activityQuotesState.editing;
  if (!q) return;
  const ids = activityQuotesState.multiAddSelectedIds || [];
  if (!ids.length) {
    showToast('请先勾选要添加的场次', 'warning');
    return;
  }
  const linked = aqLinkedActivityIdSet(q);
  let added = 0;
  ids.forEach((id) => {
    if (linked.has(Number(id))) return;
    const act = activityQuotesState.createActivities.find((a) => Number(a.id) === Number(id));
    if (!act) return;
    if (!Array.isArray(q.linked_sessions)) q.linked_sessions = [];
    q.linked_sessions.push(aqSessionFromActivity(act, q.linked_sessions.length));
    linked.add(Number(id));
    added += 1;
  });
  activityQuotesState.multiAddSelectedIds = [];
  if (!added) {
    showToast('所选场次已在表格中', 'warning');
    return;
  }
  aqMarkMultiDirty();
  aqRefreshEditView();
  aqRefreshMultiAddPanel();
  showToast(`已添加 ${added} 场`, 'success');
}

function aqOnMultiFeeInput(sessionIdx, feeKey, el) {
  aqOnMultiFeeChange(sessionIdx, feeKey, aqNumInpParse(el));
}

function aqFormatActivityDate(a) {
  const d = a.date || a.activity_date;
  return aqNormalizeEventDate(d);
}

/** 统一为 YYYY-MM-DD，避免 ISO 字符串写入 MySQL DATE 报错 */
/** 去掉报价名称开头 MMDD，避免 Tab 出现两个日期 */
function aqStripLeadingMmddFromTitle(title) {
  return String(title || '')
    .trim()
    .replace(/^(\d{4})(?=\D)/, '')
    .trim();
}

/** 合并导出 / 预览各场次 Tab：活动日 MMDD + 去重后的报价名称 */
function aqSheetLabelForQuote(q, fallbackIdx) {
  const date = aqNormalizeEventDate(q?.event_date);
  let mmdd = '';
  if (date) {
    const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) mmdd = `${m[2]}${m[3]}`;
  }
  const rawTitle =
    String(q?.project_name || q?.project_code || '').trim() ||
    (fallbackIdx != null ? `Sheet-${q.id || fallbackIdx + 1}` : `Sheet-${q?.id || ''}`);
  const baseTitle = aqStripLeadingMmddFromTitle(rawTitle) || rawTitle;
  if (mmdd) return baseTitle ? `${mmdd}${baseTitle}` : mmdd;
  return rawTitle;
}

/** Summary 页表头：合并报价名称；各场次 sheet 仍用各自单场 q */
function aqBuildMergedSummaryHeaderQ() {
  const multi = activityQuotesState.editing;
  const first =
    (activityQuotesState.previewBundleQuotes || [])[0] ||
    (activityQuotesState.exportPreviewQuotes || [])[0] ||
    null;
  const mergeName =
    String(activityQuotesState.exportMergeProjectName || multi?.project_name || '').trim() ||
    '合并报价';
  return {
    client_brand: multi?.client_brand || first?.client_brand || 'REMY COINTREAU',
    client_contact: multi?.client_contact || first?.client_contact || '',
    project_name: mergeName,
  };
}

function aqClearEditUndo() {
  activityQuotesState.editUndoStack = [];
}

function aqCloneQuoteItemForUndo(it) {
  const copy = JSON.parse(JSON.stringify(it || {}));
  delete copy._idx;
  return copy;
}

function aqSnapshotItemsForUndo(items) {
  return (items || []).map((it) => aqCloneQuoteItemForUndo(it));
}

function aqPushEditUndo(entry) {
  activityQuotesState.editUndoStack.push(entry);
  if (activityQuotesState.editUndoStack.length > AQ_EDIT_UNDO_MAX) {
    activityQuotesState.editUndoStack.shift();
  }
}

function aqCanUndoQuoteRowDelete() {
  const q = activityQuotesState.editing;
  return (
    activityQuotesState.view === 'edit' &&
    q &&
    !aqIsMultiQuote(q) &&
    Array.isArray(q.items) &&
    activityQuotesState.editUndoStack.length > 0
  );
}

function aqUndoLastQuoteRowDelete() {
  if (!aqCanUndoQuoteRowDelete()) return false;
  const q = activityQuotesState.editing;
  const entry = activityQuotesState.editUndoStack.pop();
  if (!entry || entry.type !== 'remove') return false;
  if (Array.isArray(entry.itemsBefore)) {
    q.items = entry.itemsBefore.map((it) => ({ ...it }));
    aqPrepareEditingItems({ skipRenumber: true });
    aqRefreshEditView();
    showToast('已撤销删除', 'success');
    return true;
  }
  if (!entry.item) return false;
  const idx = Math.min(Math.max(0, Number(entry.index) || 0), q.items.length);
  q.items.splice(idx, 0, entry.item);
  aqPrepareEditingItems({ skipRenumber: true });
  aqRefreshEditView();
  showToast('已撤销删除', 'success');
  return true;
}

function aqBindQuoteEditUndoKeys() {
  if (activityQuotesState.editUndoKeyBound) return;
  activityQuotesState.editUndoKeyBound = true;
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || String(e.key || '').toLowerCase() !== 'z' || e.shiftKey) return;
    if (!aqCanUndoQuoteRowDelete()) return;
    const tag = document.activeElement?.tagName?.toLowerCase?.() || '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    e.preventDefault();
    aqUndoLastQuoteRowDelete();
  });
}

/** 合并预览/导出：各场次按活动日期升序（与后端一致） */
