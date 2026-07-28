function invDefaultOutboundForm() {
  return {
    linkMode: 'activity',
    project_code: '',
    purpose: '',
    activity_id: '',
    shipped_at: '',
    activity_date: '',
    recipient_city: '',
    recipient_address: '',
    contact_name: '',
    contact_phone: '',
    logistics_supplier: '',
    logistics_method: INV_LOGISTICS_OPTS[0],
    tracking_number: '',
    remarks: '',
    hint_msg: '',
  };
}

/** 从活动详情/日历场次一键打开出库弹窗，预填项目编号与场次 */
async function invOpenOutboundModalForActivity(activity) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可新建出库', 'warning');
    return;
  }
  const a = activity || {};
  const form = invDefaultOutboundForm();
  form.linkMode = 'activity';
  form.project_code = String(a.project_code || '').trim();
  form.activity_id = a.id != null ? String(a.id) : '';
  form.activity_date = toDateInputValue(a.date || a.activity_date) || '';
  form.shipped_at = todayDateInputValue();
  form.hint_msg = form.project_code ? '已关联当前场次' : '请输入项目编号';
  let suggestedWh = null;
  if (currentYearFrameId && form.project_code) {
    try {
      const h = await api(
        'GET',
        `/inventory/hints/project?year_frame_id=${currentYearFrameId}&project_code=${encodeURIComponent(form.project_code)}`,
      );
      if (h.activity_id) form.activity_id = String(h.activity_id);
      if (h.suggested_warehouse_id) suggestedWh = Number(h.suggested_warehouse_id);
      form.hint_msg = h.activity_id ? '已匹配当前场次' : h.message || form.hint_msg;
    } catch (_) {
      /* ignore */
    }
  }
  await invOpenOutboundModal(form, suggestedWh);
}

async function invOpenOutboundModal(prefillForm, suggestedWarehouseId) {
  try {
    const body = document.getElementById('invOutboundModalBody');
    if (body) body.innerHTML = '<div class="empty-state">加载中...</div>';
    openModal('modalInvOutbound');
    inventoryPageState.editOutboundOrderId = null;
    inventoryPageState.outboundEditCommonPreset = null;
    inventoryPageState.outboundLines = [];
    inventoryPageState.outboundLinesByWarehouse = {};
    inventoryPageState.outboundCommonByWarehouse = {};
    inventoryPageState.outboundCommonSearchByWarehouse = {};
    inventoryPageState.outboundItemMetaByWarehouse = {};
    inventoryPageState.outboundEditLineMeta = {};
    inventoryPageState.outboundListFilter = 'common';
    inventoryPageState.outboundForm = prefillForm
      ? { ...invDefaultOutboundForm(), ...prefillForm }
      : invDefaultOutboundForm();
    invSetOutboundModalTitle(false);
    let warehouses = [];
    try {
      warehouses = await api('GET', '/inventory/warehouses');
    } catch (e) {
      showToast(e.message || '加载仓库失败', 'error');
      closeModal();
      return;
    }
    if (!warehouses.length) {
      showToast('暂无仓库，请先在库存管理中新建仓库', 'warning');
      closeModal();
      return;
    }
    const whHint = Number(suggestedWarehouseId);
    if (Number.isFinite(whHint) && warehouses.some((w) => Number(w.id) === whHint)) {
      inventoryPageState.warehouseId = whHint;
    } else if (!inventoryPageState.warehouseId || !warehouses.some((w) => w.id === inventoryPageState.warehouseId)) {
      inventoryPageState.warehouseId = warehouses[0].id;
    }
    inventoryPageState.outboundWarehousesCache = warehouses.slice();
    let items = [];
    try {
      items = await api('GET', `/inventory/items?inv_warehouse_id=${inventoryPageState.warehouseId}`);
    } catch (_) {
      items = [];
    }
    const of = inventoryPageState.outboundForm;
    const curWh = Number(inventoryPageState.warehouseId || 0);
    inventoryPageState.outboundLinesByWarehouse[curWh] = [];
    inventoryPageState.outboundCommonByWarehouse[curWh] = {};
    inventoryPageState.outboundItemMetaByWarehouse[curWh] = {};
    (Array.isArray(items) ? items : []).forEach((it) => {
      inventoryPageState.outboundItemMetaByWarehouse[curWh][String(it.id)] = {
        name: it.name || '',
        dimensions: it.dimensions || '',
      };
    });
    if (!body) return;
    body.innerHTML = invBuildOutboundModalMarkup(warehouses, items, of);
    await invFillInvProjectDatalist();
    await invLoadOutboundSupplierOptions(of.logistics_supplier, { autoPickForWarehouse: !of.logistics_supplier });
    const lmEl = document.getElementById('invLinkMode');
    if (lmEl) {
      lmEl.value = of.linkMode !== 'standalone' ? 'activity' : 'standalone';
      inventoryPageState.linkMode = lmEl.value;
      of.linkMode = lmEl.value;
      invToggleLinkMode();
    }
    renderLucideIcons();
  } catch (e) {
    console.error('invOpenOutboundModal failed:', e);
    showToast(e?.message || '打开新建出库失败', 'error');
    closeModal();
  }
}

async function invToggleOutboundInlineForm(forceOpen) {
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !inventoryPageState.outboundInlineOpen;
  if (!nextOpen) {
    inventoryPageState.outboundInlineOpen = false;
    inventoryPageState.editOutboundOrderId = null;
    inventoryPageState.outboundEditCommonPreset = null;
    await renderInventory();
    return;
  }
  try {
    inventoryPageState.editOutboundOrderId = null;
    inventoryPageState.outboundEditCommonPreset = null;
    inventoryPageState.outboundLines = [];
    inventoryPageState.outboundLinesByWarehouse = {};
    inventoryPageState.outboundCommonByWarehouse = {};
    inventoryPageState.outboundCommonSearchByWarehouse = {};
    inventoryPageState.outboundItemMetaByWarehouse = {};
    inventoryPageState.outboundEditLineMeta = {};
    inventoryPageState.outboundListFilter = 'common';
    inventoryPageState.outboundForm = {
      linkMode: 'activity',
      project_code: '',
      purpose: '',
      activity_id: '',
      shipped_at: '',
      activity_date: '',
      recipient_city: '',
      recipient_address: '',
      contact_name: '',
      contact_phone: '',
      logistics_supplier: '',
      logistics_method: INV_LOGISTICS_OPTS[0],
      tracking_number: '',
      remarks: '',
      hint_msg: '',
    };
    let warehouses = [];
    try {
      warehouses = await api('GET', '/inventory/warehouses');
    } catch (e) {
      showToast(e.message || '加载仓库失败', 'error');
      return;
    }
    if (!warehouses.length) {
      showToast('暂无仓库，请先在库存管理中新建仓库', 'warning');
      return;
    }
    if (!inventoryPageState.warehouseId || !warehouses.some((w) => w.id === inventoryPageState.warehouseId)) {
      inventoryPageState.warehouseId = warehouses[0].id;
    }
    inventoryPageState.outboundWarehousesCache = warehouses.slice();
    const curWh = Number(inventoryPageState.warehouseId || 0);
    inventoryPageState.outboundLinesByWarehouse[curWh] = [];
    inventoryPageState.outboundCommonByWarehouse[curWh] = {};
    inventoryPageState.outboundInlineOpen = true;
    await renderInventory();
  } catch (e) {
    console.error('invToggleOutboundInlineForm failed:', e);
    showToast(e?.message || '打开页内新建出库失败', 'error');
  }
}

function invSetInboundLedgerMonth(key) {
  inventoryPageState.inboundLedgerMonthFilter = key || 'all';
  inventoryPageState.inboundLedgerPage = 1;
  invRefreshInboundLedgerSection();
}

function invGoInboundLedgerPage(page) {
  inventoryPageState.inboundLedgerPage = page;
  invRefreshInboundLedgerSection();
}

function invSetInboundPendingMonth(key) {
  inventoryPageState.inboundPendingMonthFilter = key || 'all';
  inventoryPageState.inboundPendingPage = 1;
  invRefreshInboundPendingSection();
}

function invGoInboundPendingPage(page) {
  inventoryPageState.inboundPendingPage = page;
  invRefreshInboundPendingSection();
}

function invSetOutboundMonth(key) {
  inventoryPageState.outboundMonthFilter = key || 'all';
  invRefreshOutboundTable();
}

function invRefreshInboundLedgerSection() {
  const host = document.getElementById('invInboundLedgerHost');
  if (host) host.innerHTML = invRenderInboundLedgerHostContent();
  const bar = document.getElementById('invInboundLedgerMonthBar');
  if (bar) {
    const keys = invMonthKeysFromRows(inventoryPageState._inboundLedgerCache, invInboundLedgerDateKey);
    if (
      inventoryPageState.inboundLedgerMonthFilter !== 'all' &&
      !keys.includes(inventoryPageState.inboundLedgerMonthFilter)
    ) {
      inventoryPageState.inboundLedgerMonthFilter = 'all';
    }
    bar.innerHTML = invRenderInvMonthBar(keys, inventoryPageState.inboundLedgerMonthFilter, 'invSetInboundLedgerMonth');
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function invRefreshInboundPendingSection() {
  const host = document.getElementById('invInboundPendingHost');
  if (host) host.innerHTML = invRenderInboundPendingHostContent();
  const bar = document.getElementById('invInboundPendingMonthBar');
  if (bar) {
    const keys = invMonthKeysFromRows(inventoryPageState._inboundPendingCache, invInboundPendingDateKey);
    if (
      inventoryPageState.inboundPendingMonthFilter !== 'all' &&
      !keys.includes(inventoryPageState.inboundPendingMonthFilter)
    ) {
      inventoryPageState.inboundPendingMonthFilter = 'all';
    }
    bar.innerHTML = invRenderInvMonthBar(keys, inventoryPageState.inboundPendingMonthFilter, 'invSetInboundPendingMonth');
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function invRefreshOutboundTable() {
  const host = document.getElementById('invObTableHost');
  if (!host) return;
  const cache = Array.isArray(inventoryPageState._outboundListCache) ? inventoryPageState._outboundListCache : [];
  const byMonth = invFilterOutboundByMonth(cache, inventoryPageState.outboundMonthFilter);
  const filtered = invFilterOutboundOrders(byMonth, inventoryPageState.outboundSearch);
  host.innerHTML = invRenderOutboundOrderTable(filtered, {
    total: cache.length,
    filtered: filtered.length,
    search: inventoryPageState.outboundSearch,
  });
  const bar = document.getElementById('invObMonthBar');
  if (bar) {
    const keys = invOutboundMonthKeys(cache);
    if (
      inventoryPageState.outboundMonthFilter !== 'all' &&
      !keys.includes(inventoryPageState.outboundMonthFilter)
    ) {
      inventoryPageState.outboundMonthFilter = 'all';
    }
    bar.innerHTML = invRenderOutboundMonthButtons(keys, inventoryPageState.outboundMonthFilter);
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
