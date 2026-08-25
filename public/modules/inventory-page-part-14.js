function invSwitchTab(t) {
  inventoryPageState.tab = t;
  if (t === 'outbound') inventoryPageState.outboundLines = Array.isArray(inventoryPageState.outboundLines) ? inventoryPageState.outboundLines : [];
  renderInventory();
}

function invToggleLinkMode() {
  const lm = document.getElementById('invLinkMode');
  const m = lm && lm.value === 'standalone';
  const pw = document.getElementById('invProjectWrap');
  const pr = document.getElementById('invPurposeWrap');
  if (pw) pw.style.display = m ? 'none' : 'block';
  if (pr) pr.style.display = m ? 'block' : 'none';
}

async function invApplyProjectHint() {
  const el = document.getElementById('invHintMsg');
  const pc = document.getElementById('invProjectCode')?.value?.trim();
  if (!pc) {
    if (el) el.textContent = '请输入项目编号';
    return;
  }
  if (!currentYearFrameId) {
    if (el) el.textContent = '请先在左侧选择年度，以便在对应年框下匹配场次';
    return;
  }
  try {
    const h = await api('GET', `/inventory/hints/project?year_frame_id=${currentYearFrameId}&project_code=${encodeURIComponent(pc)}`);
    if (h.activity_id) document.getElementById('invActivityId').value = h.activity_id;
    if (el) el.textContent = h.activity_id ? '已匹配到场次（仓库请手动选择）' : (h.message || '未匹配到场次');
    inventoryPageState.linkMode = 'activity';
    inventoryPageState.outboundForm.linkMode = 'activity';
    inventoryPageState.outboundForm.project_code = pc;
    inventoryPageState.outboundForm.hint_msg = h.activity_id ? '已匹配到场次（仓库请手动选择）' : (h.message || '未匹配到场次');
    const lm = document.getElementById('invLinkMode');
    if (lm) lm.value = 'activity';
    invToggleLinkMode();
    const pcEl = document.getElementById('invProjectCode');
    if (pcEl) pcEl.value = pc;
    const aiEl = document.getElementById('invActivityId');
    if (aiEl && h.activity_id) {
      aiEl.value = h.activity_id;
      inventoryPageState.outboundForm.activity_id = String(h.activity_id);
    }
  } catch (e) {
    if (el) el.textContent = e.message || '匹配失败';
  }
}

function invOnOutboundCommonCk(itemId) {
  const ck = document.getElementById(`invCommonCk_${itemId}`);
  const q = document.getElementById(`invCommonQty_${itemId}`);
  if (!ck || !q) return;
  if (ck.checked && (parseInt(q.value, 10) || 0) < 1) q.value = 1;
  if (!ck.checked) q.value = 0;
  invRefreshSelectedPreview();
}

function invOnOutboundCommonQty(itemId) {
  const ck = document.getElementById(`invCommonCk_${itemId}`);
  const q = document.getElementById(`invCommonQty_${itemId}`);
  if (!q) return;
  const n = Math.max(0, parseInt(q.value, 10) || 0);
  q.value = n;
  if (ck) ck.checked = n > 0;
  invRefreshSelectedPreview();
}

function invOnOutboundCommonNote(itemId) {
  if (!Number.isFinite(Number(itemId))) return;
  invRefreshSelectedPreview();
}

function invPatchOutboundLine(idx, key, val) {
  const lines = inventoryPageState.outboundLines || [];
  if (!lines[idx]) return;
  if (key === 'quantity') lines[idx].quantity = Math.max(1, parseInt(val, 10) || 1);
  else if (key === 'item_id') lines[idx].item_id = val ? parseInt(val, 10) : '';
  else lines[idx][key] = val;
  if (document.getElementById('invObExtraTbody')) {
    void invRefreshOutboundExtraTbodyOnly();
  }
}

function invPatchOutboundLineByDisplay(idx, displayVal) {
  const m = String(displayVal || '').match(/\[#(\d+)\]/);
  const itemId = m ? parseInt(m[1], 10) : '';
  invPatchOutboundLine(idx, 'item_id', itemId);
}

function invOnCommonSearchInput(val) {
  const whId = Number(inventoryPageState.warehouseId || 0);
  const key = String(whId || 'global');
  if (inventoryPageState.editOutboundOrderId && document.getElementById('invObCommonTbody')) {
    inventoryPageState.outboundEditCommonPreset = {
      ...(inventoryPageState.outboundEditCommonPreset || {}),
      ...invSnapshotCommonPresetFromDom(),
    };
  } else {
    invSaveCurrentWarehouseDraftFromModal();
  }
  inventoryPageState.outboundCommonSearchByWarehouse = inventoryPageState.outboundCommonSearchByWarehouse || {};
  inventoryPageState.outboundCommonSearchByWarehouse[key] = String(val || '');
  inventoryPageState.outboundCommonSearchSeq = (inventoryPageState.outboundCommonSearchSeq || 0) + 1;
  const seq = inventoryPageState.outboundCommonSearchSeq;
  const commonTbody = document.getElementById('invObCommonTbody');
  if (!commonTbody) return;
  const wh = inventoryPageState.warehouseId;
  if (!wh) return;
  api('GET', `/inventory/items?inv_warehouse_id=${wh}`)
    .then((items) => {
      if (seq !== inventoryPageState.outboundCommonSearchSeq) return;
      const arr = Array.isArray(items) ? items : [];
      invSeedOutboundItemMetaFromItems(wh, arr);
      const preset = inventoryPageState.editOutboundOrderId
        ? inventoryPageState.outboundEditCommonPreset
        : inventoryPageState.outboundCommonByWarehouse[Number(wh)] || null;
      commonTbody.innerHTML = invBuildCommonRowsHtml(arr, preset);
      invRefreshSelectedPreview();
    })
    .catch(() => {});
}

function invMoveCommonItem(itemId, step) {
  invSaveCurrentWarehouseDraftFromModal();
  const whId = Number(inventoryPageState.warehouseId || 0);
  const key = String(whId || 'global');
  inventoryPageState.outboundCommonOrderByWarehouse = inventoryPageState.outboundCommonOrderByWarehouse || {};
  const ids = [...new Set((inventoryPageState.outboundCommonOrderByWarehouse[key] || []).map((x) => Number(x)).filter((x) => Number.isFinite(x)))];
  if (!ids.includes(Number(itemId))) ids.push(Number(itemId));
  const i = ids.indexOf(Number(itemId));
  if (i < 0) return;
  if (step === 'top') {
    if (i === 0) return;
    ids.splice(i, 1);
    ids.unshift(Number(itemId));
  } else if (step === 'bottom') {
    if (i === ids.length - 1) return;
    ids.splice(i, 1);
    ids.push(Number(itemId));
  } else {
    const j = i + (step > 0 ? 1 : -1);
    if (j < 0 || j >= ids.length) return;
    const tmp = ids[i];
    ids[i] = ids[j];
    ids[j] = tmp;
  }
  inventoryPageState.outboundCommonOrderByWarehouse[key] = ids;
  invSaveCommonOrderStore();
  const commonTbody = document.getElementById('invObCommonTbody');
  if (!commonTbody) return;
  const wh = inventoryPageState.warehouseId;
  if (!wh) return;
  api('GET', `/inventory/items?inv_warehouse_id=${wh}`)
    .then((items) => {
      const arr = Array.isArray(items) ? items : [];
      invSeedOutboundItemMetaFromItems(wh, arr);
      const preset = inventoryPageState.editOutboundOrderId
        ? inventoryPageState.outboundEditCommonPreset
        : inventoryPageState.outboundCommonByWarehouse[Number(wh)] || null;
      commonTbody.innerHTML = invBuildCommonRowsHtml(arr, preset);
      invRefreshSelectedPreview();
    })
    .catch(() => {});
}

let invCommonDraggingItemId = null;

function invCommonDragStart(event, itemId) {
  invCommonDraggingItemId = Number(itemId);
  try {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(itemId));
  } catch (_) { /* ignore */ }
}

function invCommonDragOver(event) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function invCommonDrop(event, targetItemId) {
  event.preventDefault();
  invSaveCurrentWarehouseDraftFromModal();
  const targetId = Number(targetItemId);
  const sourceId = Number(invCommonDraggingItemId);
  if (!Number.isFinite(sourceId) || !Number.isFinite(targetId) || sourceId === targetId) return;
  const whId = Number(inventoryPageState.warehouseId || 0);
  const key = String(whId || 'global');
  const domOrder = Array.from(document.querySelectorAll('#invObCommonTbody [data-inv-common-row]'))
    .map((row) => Number(row.getAttribute('data-item-id')))
    .filter((id) => Number.isFinite(id));
  if (!domOrder.length) return;
  const ids = [...domOrder];
  const from = ids.indexOf(sourceId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return;
  ids.splice(from, 1);
  ids.splice(to, 0, sourceId);
  inventoryPageState.outboundCommonOrderByWarehouse[key] = ids;
  invSaveCommonOrderStore();
  const commonTbody = document.getElementById('invObCommonTbody');
  if (!commonTbody) return;
  const wh = inventoryPageState.warehouseId;
  if (!wh) return;
  api('GET', `/inventory/items?inv_warehouse_id=${wh}`)
    .then((items) => {
      const arr = Array.isArray(items) ? items : [];
      invSeedOutboundItemMetaFromItems(wh, arr);
      const preset = inventoryPageState.editOutboundOrderId
        ? inventoryPageState.outboundEditCommonPreset
        : inventoryPageState.outboundCommonByWarehouse[Number(wh)] || null;
      commonTbody.innerHTML = invBuildCommonRowsHtml(arr, preset);
      invRefreshSelectedPreview();
    })
    .catch(() => {});
}

function invCommonDragEnd() {
  invCommonDraggingItemId = null;
}

async function invToggleItemCommon(id, asCommon) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可修改常用物料', 'warning');
    return;
  }
  const pageScrollSnapshot = invCapturePageScrollPosition(id);
  try {
    await api('PUT', `/inventory/items/${id}`, { is_common: Boolean(asCommon) });
    showToast(asCommon ? '已设为常用物料' : '已取消常用', 'success');
    await renderInventory();
    invRestorePageScrollPosition(pageScrollSnapshot);
  } catch (e) {
    showToast(e.message || '更新失败', 'error');
  }
}

async function invToggleItemWine(id, asWine) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可修改酒类标签', 'warning');
    return;
  }
  const pageScrollSnapshot = invCapturePageScrollPosition(id);
  try {
    let wineLabel = null;
    if (asWine) {
      const it = await api('GET', `/inventory/items/${id}`);
      wineLabel = String(it.wine_label || '').trim() || String(it.name || '').trim() || null;
    }
    await api('PUT', `/inventory/items/${id}`, {
      is_wine: Boolean(asWine),
      wine_label: asWine ? wineLabel : null,
    });
    showToast(asWine ? '已标记为酒类（参与用酒统计）' : '已取消酒类标记', 'success');
    await renderInventory();
    invRestorePageScrollPosition(pageScrollSnapshot);
  } catch (e) {
    showToast(e.message || '更新失败', 'error');
  }
}

function invAddOutboundRow() {
  inventoryPageState.outboundLines = inventoryPageState.outboundLines || [];
  inventoryPageState.outboundLines.push({ item_id: '', quantity: 1, line_note: '' });
  if (document.getElementById('invObExtraTbody')) {
    void invRefreshOutboundExtraTbodyOnly();
  } else {
    renderInventory();
  }
}
