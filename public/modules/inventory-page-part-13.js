async function renderInventory() {
  invCaptureOutboundDraft();
  const container = document.getElementById('pageContainer');
  const yfId = currentYearFrameId;
  const invPage =
    currentPage === 'inventory' ? 'master' : currentPage === 'inv-outbound' ? 'outbound' : currentPage === 'inv-inbound' ? 'inbound' : null;
  if (!invPage) return;

  let warehouses = [];
  try {
    warehouses = await api('GET', '/inventory/warehouses');
  } catch (e) {
    const msg = escapeHtml(e.message || '');
    let extra = '若仍失败，请在本机执行 <code>npm run migrate:inventory</code> 并<strong>重启</strong> Node 进程。';
    if (String(e.message || '').includes('404')) {
      extra = '接口返回 404：当前运行的 node 进程<strong>未加载物资库存路由</strong>，请结束旧进程后重新执行 <code>npm run start</code>。';
    } else if (String(e.message || '').toLowerCase().includes("doesn't exist") || String(e.message || '').includes('不存在')) {
      extra = '数据库表可能未创建：执行 <code>npm run migrate:inventory</code> 后重启服务；或刷新页面重试（服务会在首次访问时尝试自动建表）。';
    } else if (String(e.message || '').includes('year_frame_id')) {
      extra = '库结构需升级：请执行 <code>npm run migrate:inventory-global-fiscal</code> 后重启服务。';
    }
    container.innerHTML = `<div class="empty-state" style="color:var(--danger)">加载失败：${msg}<p style="margin-top:12px;font-size:13px;color:var(--text-secondary)">${extra}</p></div>`;
    return;
  }
  if (!inventoryPageState.warehouseId && warehouses.length) {
    inventoryPageState.warehouseId = warehouses[0].id;
  }
  if (inventoryPageState.warehouseId && !warehouses.some((w) => w.id === inventoryPageState.warehouseId)) {
    inventoryPageState.warehouseId = warehouses.length ? warehouses[0].id : null;
  }
  let items = [];
  if (
    invPage === 'master' &&
    inventoryPageState.stockMasterView !== 'wine' &&
    inventoryPageState.stockMasterView !== 'empty' &&
    inventoryPageState.warehouseId
  ) {
    try {
      items = await api('GET', `/inventory/items?inv_warehouse_id=${inventoryPageState.warehouseId}`);
    } catch (_) {
      items = [];
    }
  }
  invEnsureTabForPage(invPage);

  let itemsViewMode = inventoryPageState.itemsViewMode || 'cards';
  if (!INV_ITEMS_VIEW_MODES.some((m) => m.id === itemsViewMode)) itemsViewMode = 'cards';
  inventoryPageState.itemsViewMode = itemsViewMode;

  const listActive = itemsViewMode === 'list';
  const gridActive = itemsViewMode === 'cards' || itemsViewMode === 'thumbnails';
  const gridToggleTitle = invGridViewToggleTitle(itemsViewMode);
  const masterIsWine = invPage === 'master' && inventoryPageState.stockMasterView === 'wine';
  const masterIsEmpty = invPage === 'master' && inventoryPageState.stockMasterView === 'empty';
  const masterIsItemCatalog = invPage === 'master' && inventoryPageState.stockMasterView === 'item-catalog';
  const masterIsWarehouse = invPage === 'master' && !masterIsWine && !masterIsEmpty && !masterIsItemCatalog;

  let displayItems = items;
  if (masterIsWarehouse) {
    const f = inventoryPageState.itemsListFilter || 'all';
    if (f === 'common') {
      displayItems = items.filter((it) => invItemIsCommon(it));
    } else if (f === 'uncommon') {
      displayItems = items.filter((it) => !invItemIsCommon(it));
    } else if (f === 'wine') {
      let cat = [];
      try {
        cat = await api('GET', '/wine/catalog');
      } catch (_) {
        cat = [];
      }
      const set = new Set((Array.isArray(cat) ? cat : []).map((c) => invCatalogRowWineKey(c)));
      displayItems = items.filter((it) => invItemIsWineTagged(it) || set.has(invItemWineCatalogKey(it)));
    }
  }

  const viewToggleHtml =
    invPage === 'master' && !masterIsWine && !masterIsEmpty
      ? `<div class="inv-view-toggle" role="toolbar" aria-label="物料展示方式">
      <div class="inv-view-toggle-inner">
        <button type="button" class="inv-view-opt ${listActive ? 'active' : ''}" onclick="invSetItemsViewMode('list')" title="列表" aria-label="列表">${INV_VIEW_LIST_ICON}</button>
        <button type="button" class="inv-view-opt ${gridActive ? 'active' : ''}" onclick="invCycleGridItemsView()" title="${escapeHtml(gridToggleTitle)}" aria-label="${escapeHtml(gridToggleTitle)}">${INV_VIEW_GRID_ICON}</button>
      </div>
    </div>`
      : '';

  const itemsFilterHtml = masterIsWarehouse
    ? invRenderItemsListFilterBar(inventoryPageState.itemsListFilter || 'all')
    : '';

  let panelHtml = '';
  if (invPage === 'master') {
    if (masterIsWine) {
      panelHtml = `
      <div class="stats-row" id="wineCatalogStats" style="margin-bottom:16px"></div>
      <div class="card">
        <div class="card-header">
          <h3><i data-lucide="book-open" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>目录列表</h3>
        </div>
        <div class="card-body" id="wineCatalogListHost">
          <div style="color:var(--text-muted);padding:20px;text-align:center">加载中...</div>
        </div>
      </div>`;
    } else if (masterIsItemCatalog) {
      panelHtml = `
      <div class="stats-row" id="itemCatalogStats" style="margin-bottom:16px"></div>
      <div class="card">
        <div class="card-header">
          <h3><i data-lucide="library" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>目录列表</h3>
        </div>
        <div class="card-body" id="itemCatalogListHost">
          <div style="color:var(--text-muted);padding:20px;text-align:center">加载中...</div>
        </div>
      </div>`;
    } else if (masterIsEmpty) {
      let emptyGroups = [];
      try {
        emptyGroups = await api('GET', '/inventory/empty-bottles/summary');
      } catch (_) {
        emptyGroups = [];
      }
      panelHtml = invRenderEmptyBottleWarehouseSections(emptyGroups);
    } else {
      panelHtml = invRenderItemsPanel(displayItems, itemsViewMode);
    }
  } else if (invPage === 'outbound') {
    try {
      await api('POST', '/inventory/outbound/repair-project-codes', {
        yearFrameId: currentYearFrameId || undefined,
      });
    } catch (e) {
      console.warn('出库单项目编号同步失败（忽略）', e);
    }
    let allOrders = [];
    try {
      allOrders = await api('GET', `/inventory/outbound${invOutboundListQuery()}`);
    } catch (_) {
      allOrders = [];
    }
    let inlineFormHtml = '';
    if (inventoryPageState.outboundInlineOpen) {
      const inlineEditId = parseInt(inventoryPageState.editOutboundOrderId, 10);
      const isEditingInline = Number.isFinite(inlineEditId);
      let currentItems = [];
      try {
        currentItems = await api('GET', `/inventory/items?inv_warehouse_id=${inventoryPageState.warehouseId}`);
      } catch (_) {
        currentItems = [];
      }
      inlineFormHtml = `
        <div class="card inv-ob-inline-shell">
          <div class="card-header inv-ob-inline-shell-head">
            <h3>${isEditingInline ? `编辑物品出库 #${inlineEditId}` : '新建物品出库'}</h3>
            <button type="button" class="btn btn-secondary btn-sm" onclick="invToggleOutboundInlineForm(false)">收起</button>
          </div>
          <div class="card-body">
            ${invBuildOutboundModalMarkup(warehouses, Array.isArray(currentItems) ? currentItems : [], inventoryPageState.outboundForm || {}, isEditingInline ? {
              editOrderId: inlineEditId,
              commonPreset: inventoryPageState.outboundCommonByWarehouse[Number(inventoryPageState.warehouseId)] || inventoryPageState.outboundEditCommonPreset || null,
            } : {})}
          </div>
        </div>`;
    }
    inventoryPageState._outboundListCache = Array.isArray(allOrders) ? allOrders : [];
    const obMonthKeys = invOutboundMonthKeys(inventoryPageState._outboundListCache);
    if (inventoryPageState.outboundMonthFilter !== 'all' && !obMonthKeys.includes(inventoryPageState.outboundMonthFilter)) {
      inventoryPageState.outboundMonthFilter = 'all';
    }
    const byMonth = invFilterOutboundByMonth(inventoryPageState._outboundListCache, inventoryPageState.outboundMonthFilter);
    const filteredOrders = invFilterOutboundOrders(byMonth, inventoryPageState.outboundSearch);
    panelHtml = `${inlineFormHtml}<div id="invObMonthBar">${invRenderOutboundMonthButtons(obMonthKeys, inventoryPageState.outboundMonthFilter)}</div><div id="invObTableHost">${invRenderOutboundOrderTable(filteredOrders, {
      total: inventoryPageState._outboundListCache.length,
      filtered: filteredOrders.length,
      search: inventoryPageState.outboundSearch,
    })}</div>`;
  } else if (invPage === 'inbound') {
    let openOrders = [];
    try {
      openOrders = await api('GET', `/inventory/outbound${invOutboundListQuery({ status: 'open' })}`);
    } catch (_) {
      openOrders = [];
    }
    let inboundLedger = [];
    try {
      inboundLedger = await api('GET', `/inventory/inbound-receipts${invInboundReceiptListQuery()}`);
    } catch (_) {
      inboundLedger = [];
    }
    let directInbound = [];
    try {
      const direct = await api('GET', '/inventory/inbound');
      const arr = Array.isArray(direct?.data) ? direct.data : (Array.isArray(direct) ? direct : []);
      directInbound = arr.map((r) => {
        const nm = String(r.item_name || '—');
        const dim = String(r.item_dimensions || '').trim();
        const qty = Number(r.quantity || 0);
        const summary = dim ? `${nm} ×${qty} ${dim}` : `${nm} ×${qty}`;
        return {
          batch_id: r.id,
          _kind: 'direct',
          _qty: qty,
          return_date: r.inbound_date || r.created_at,
          inbound_date: r.inbound_date || '',
          display_main: dim ? `${nm} — ${dim}` : nm,
          items_summary: summary,
          brand_code: r.brand_code || '—',
          region: r.region || '—',
          operator: r.operator || '—',
          batch_remarks: r.remarks || '',
          source: r.source || null,
        };
      });
      inventoryPageState.inboundDirectRows = directInbound;
    } catch (_) {
      directInbound = [];
      inventoryPageState.inboundDirectRows = [];
    }
    const ledgerArr = [
      ...(Array.isArray(inboundLedger) ? inboundLedger : []),
      ...directInbound,
    ].sort((a, b) => {
      const da = invBusinessYmd(a.return_date || a.inbound_date || a.created_at);
      const db = invBusinessYmd(b.return_date || b.inbound_date || b.created_at);
      return db.localeCompare(da);
    });
    inventoryPageState._inboundLedgerCache = ledgerArr;
    inventoryPageState._inboundPendingCache = Array.isArray(openOrders) ? openOrders : [];
    const ledgerMonthKeys = invMonthKeysFromRows(inventoryPageState._inboundLedgerCache, invInboundLedgerDateKey);
    const pendingMonthKeys = invMonthKeysFromRows(inventoryPageState._inboundPendingCache, invInboundPendingDateKey);
    if (
      inventoryPageState.inboundLedgerMonthFilter !== 'all' &&
      !ledgerMonthKeys.includes(inventoryPageState.inboundLedgerMonthFilter)
    ) {
      inventoryPageState.inboundLedgerMonthFilter = 'all';
    }
    if (
      inventoryPageState.inboundPendingMonthFilter !== 'all' &&
      !pendingMonthKeys.includes(inventoryPageState.inboundPendingMonthFilter)
    ) {
      inventoryPageState.inboundPendingMonthFilter = 'all';
    }
    panelHtml = `
      <div class="inv-inbound-section">
        <div id="invInboundLedgerHost">${invRenderInboundLedgerHostContent()}</div>
      </div>
      <div class="inv-inbound-divider" role="separator" aria-hidden="true"></div>
      <div class="inv-inbound-section">
        <div class="inv-inbound-section-head">
          <h4 class="inv-inbound-section-title">待入库</h4>
          <div id="invInboundPendingMonthBar">${invRenderInvMonthBar(pendingMonthKeys, inventoryPageState.inboundPendingMonthFilter, 'invSetInboundPendingMonth')}</div>
        </div>
        <div id="invInboundPendingHost">${invRenderInboundPendingHostContent()}</div>
      </div>`;
  }

  invRenderInventoryChrome({
    container,
    invPage,
    warehouses,
    masterIsWine,
    masterIsItemCatalog,
    masterIsEmpty,
    itemsFilterHtml,
    viewToggleHtml,
    panelHtml,
  });

  if (invPage === 'master' && inventoryPageState.stockMasterView === 'wine') {
    try {
      await loadWineCatalogPage();
      updateBadges();
    } catch (_) { /* ignore */ }
  }
  if (invPage === 'master' && inventoryPageState.stockMasterView === 'item-catalog') {
    try {
      await loadItemCatalogPage();
      updateBadges();
    } catch (_) { /* ignore */ }
  }

    try {
      if (yfId) {
        const actList = await api('GET', `/activities?yearFrameId=${yfId}&isVirtual=0`);
        invSetOutboundProjectOptions(actList);
      }
    } catch (_) { /* ignore */ }

  const lmEl = document.getElementById('invLinkMode');
  if (lmEl) {
    lmEl.value = inventoryPageState.outboundForm.linkMode || inventoryPageState.linkMode || 'activity';
    inventoryPageState.linkMode = lmEl.value;
    inventoryPageState.outboundForm.linkMode = lmEl.value;
    invToggleLinkMode();
  }
  if (document.getElementById('invLogisticsSupplier')) {
    const of = inventoryPageState.outboundForm || {};
    void invLoadOutboundSupplierOptions(of.logistics_supplier, { autoPickForWarehouse: !of.logistics_supplier });
  }
}
