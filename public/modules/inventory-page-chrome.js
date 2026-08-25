function invRenderInventoryChrome({
  container,
  invPage,
  warehouses,
  masterIsWine,
  masterIsItemCatalog,
  masterIsEmpty,
  itemsFilterHtml,
  viewToggleHtml,
  panelHtml,
}) {
    const masterToolbarWh = `
      <div class="inv-master-warehouse-block">
        ${invRenderStockMasterCardsHtml(warehouses, inventoryPageState.warehouseId, inventoryPageState.stockMasterView)}
      </div>
      <div class="inv-toolbar inv-toolbar-master">
        <button type="button" class="btn btn-secondary btn-sm inv-admin-only" onclick="invOpenWarehouseModal()">+ 新建仓库</button>
        <button type="button" class="btn btn-primary btn-sm inv-admin-only" onclick="invOpenNewItemModal()" ${inventoryPageState.warehouseId ? '' : 'disabled'}>添加物料</button>
        <button type="button" class="btn btn-secondary btn-sm inv-admin-only" onclick="invOpenAddItemCatalogModal()" ${inventoryPageState.warehouseId ? '' : 'disabled'}>物品目录</button>
        <button type="button" class="btn btn-secondary btn-sm inv-admin-only" onclick="invOpenAddWineModal()" ${inventoryPageState.warehouseId ? '' : 'disabled'}>酒品目录</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="invOpenWineAuditModal()" title="各仓库疑似酒类 vs 酒品目录">酒品对照排查</button>
        <button type="button" class="btn btn-secondary btn-sm inv-admin-only" onclick="invOpenInboundModal()" ${inventoryPageState.warehouseId ? '' : 'disabled'}>物料入库</button>
        <span class="form-hint" style="flex:1;min-width:200px;margin:0">仓库与物料为 <strong>25/26 财年共用</strong>；点击「+ 新建仓库」可补建；点击仓库卡片右上「编辑」可改名称/品牌/区域/城市/备注。按项目编号匹配场次时请先选左侧年度。</span>
      </div>`;
    const masterToolbarWine = `
      <div class="inv-master-warehouse-block">
        ${invRenderStockMasterCardsHtml(warehouses, inventoryPageState.warehouseId, inventoryPageState.stockMasterView)}
      </div>
      <div class="inv-toolbar inv-toolbar-master">
        <button type="button" class="btn btn-primary btn-sm inv-admin-only" onclick="openWineCatalogModal(null)">添加酒品</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="invOpenWineAuditModal()" title="各仓库疑似酒类 vs 酒品目录">酒品对照排查</button>
        <span class="form-hint" style="flex:1;min-width:200px;margin:0">酒品<strong>目录</strong>为全局主数据（品牌、名称、规格、图片），<strong>不含分仓库存</strong>；向某仓库加酒请在对应仓库下使用「添加酒品」。</span>
      </div>`;
    const masterToolbarEmpty = `
      <div class="inv-master-warehouse-block">
        ${invRenderStockMasterCardsHtml(warehouses, inventoryPageState.warehouseId, inventoryPageState.stockMasterView)}
      </div>
      <div class="inv-toolbar inv-toolbar-master inv-toolbar-empty-ledger">
        <span class="form-hint" style="flex:1;min-width:200px;margin:0">空瓶回收仅作查看与追溯，列表为各仓当前库存。</span>
      </div>`;
    const masterToolbarItemCatalog = `
      <div class="inv-master-warehouse-block">
        ${invRenderStockMasterCardsHtml(warehouses, inventoryPageState.warehouseId, inventoryPageState.stockMasterView)}
      </div>
      <div class="inv-toolbar inv-toolbar-master">
        <button type="button" class="btn btn-primary btn-sm inv-admin-only" onclick="invSyncItemCatalogFromWarehouses()">同步目录（PHD/X.O/CLUB）</button>
        <span class="form-hint" style="flex:1;min-width:200px;margin:0">物品目录按名称+规格去重，用于后续新建北区/南区仓库时快速选品导入。</span>
      </div>`;
    const masterToolbar =
      invPage === 'master' && inventoryPageState.stockMasterView === 'wine'
        ? masterToolbarWine
        : invPage === 'master' && inventoryPageState.stockMasterView === 'item-catalog'
          ? masterToolbarItemCatalog
        : invPage === 'master' && inventoryPageState.stockMasterView === 'empty'
          ? masterToolbarEmpty
          : masterToolbarWh;

    const outboundSearchVal = String(inventoryPageState.outboundSearch || '');
    const outboundPageHeader = `
      <div class="inv-out-page-head">
        <div class="inv-out-page-head-main">
          <span class="form-hint" style="margin:0">按项目编号汇总已出库记录；<strong>出库日期</strong>按发货时间，无则按创建时间。主数据请在 <strong>库存管理</strong> 维护。</span>
        </div>
        <div class="inv-out-page-head-actions">
          <div class="inv-ob-search">
            <input type="search" id="invOutboundSearch" class="form-control form-control-sm inv-ob-search-input"
              placeholder="关键词检索"
              value="${escapeHtml(outboundSearchVal)}"
              oninput="invOnOutboundSearchInput(this.value)"
              aria-label="出库单内容搜索"
              title="可按物品名 / 项目编号 / 收件人 / 物流单号 / 用途 / 仓库 / 城市 模糊搜索；空格分隔多关键字（AND）">
            ${outboundSearchVal ? `<button type="button" class="inv-ob-search-clear" aria-label="清除搜索" onclick="invOnOutboundSearchInput('')"><i data-lucide="x" aria-hidden="true"></i></button>` : ''}
          </div>
          <button type="button" class="btn btn-primary btn-sm" onclick="invToggleOutboundInlineForm()">${inventoryPageState.outboundInlineOpen ? '收起新建' : '新建出库'}</button>
        </div>
      </div>`;

    const inboundOpsToolbar = `<div class="inv-toolbar"></div>`;

    const tabsMasterTools = [itemsFilterHtml, viewToggleHtml].filter(Boolean).join('');
    const tabsBarMaster = `
      <div class="inv-tabs-bar">
        <span class="inv-page-lead">${masterIsWine ? '酒品目录' : masterIsItemCatalog ? '物品目录' : masterIsEmpty ? '空瓶回收' : '物料清单'}</span>
        ${tabsMasterTools ? `<div class="inv-tabs-bar-tools">${tabsMasterTools}</div>` : ''}
      </div>`;

    const inboundLedgerMonthKeys =
      invPage === 'inbound'
        ? invMonthKeysFromRows(inventoryPageState._inboundLedgerCache, invInboundLedgerDateKey)
        : [];
    const tabsBarInbound = `
      <div class="inv-tabs-bar">
        <div class="inv-inbound-section-head inv-inbound-tabs-head">
          <span class="inv-page-lead">已入库</span>
          <div id="invInboundLedgerMonthBar">${invRenderInvMonthBar(inboundLedgerMonthKeys, inventoryPageState.inboundLedgerMonthFilter, 'invSetInboundLedgerMonth')}</div>
        </div>
        <div class="inv-tabs-bar-tools"></div>
      </div>`;

    const toolbarHtml =
      invPage === 'master' ? masterToolbar : invPage === 'outbound' ? outboundPageHeader : inboundOpsToolbar;
    const tabsBarHtml = invPage === 'master' ? tabsBarMaster : invPage === 'outbound' ? '' : tabsBarInbound;

    container.innerHTML =
      invPage === 'master'
        ? `
      <section class="inv-master-layout">
        <div class="inv-master-sticky-head">
          ${toolbarHtml}
          ${tabsBarHtml}
        </div>
        <div class="inv-master-scroll-body">
          ${panelHtml}
        </div>
      </section>
    `
        : `
      ${toolbarHtml}
      ${tabsBarHtml}
      ${panelHtml}
    `;
}
