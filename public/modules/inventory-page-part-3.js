function invRenderStockMasterCardsHtml(warehouses, selectedWarehouseId, stockMasterView) {
  const orderedWarehouses = invReorderWarehouseCards(warehouses);
  const smv =
    stockMasterView === 'wine'
      ? 'wine'
      : stockMasterView === 'empty'
        ? 'empty'
        : stockMasterView === 'item-catalog'
          ? 'item-catalog'
          : 'warehouse';
  const sid = selectedWarehouseId != null ? Number(selectedWarehouseId) : null;
  const whButtons =
    orderedWarehouses.length === 0
      ? ''
      : orderedWarehouses
          .map((w) => {
            const active = smv === 'warehouse' && sid != null && Number(w.id) === sid;
            const label = w.label ? `<div class="inv-wh-card-label">${escapeHtml(w.label)}</div>` : '';
            const city = w.city ? `<div class="inv-wh-card-city" title="所在城市">${escapeHtml(w.city)}</div>` : '';
            return `
        <div class="inv-wh-card-wrap">
          <button type="button" class="inv-wh-card ${active ? 'active' : ''}" data-wh-id="${w.id}" onclick="invSelectWarehouse(${w.id})" role="listitem">
            <div class="inv-wh-card-brand">${escapeHtml(invWarehouseBrandDisplay(w))}</div>
            <div class="inv-wh-card-region">${escapeHtml(w.region)}</div>
            ${city}
            ${label}
          </button>
          <button type="button" class="inv-wh-card-edit inv-admin-only" title="编辑仓库" aria-label="编辑仓库" onclick="event.stopPropagation();invOpenWarehouseModal(${w.id})"><i data-lucide="pencil" aria-hidden="true"></i></button>
        </div>`;
          })
          .join('');
  const wineActive = smv === 'wine';
  const wineCard = `
        <button type="button" class="inv-wh-card inv-wh-card-wine ${wineActive ? 'active' : ''}" onclick="invSelectStockMasterView('wine')" role="listitem" title="酒品目录（全局主数据）">
          <div class="inv-wh-card-brand">酒品目录</div>
          <div class="inv-wh-card-region">品牌 · 规格 · 图片</div>
          <div class="inv-wh-card-label" id="badge-wine-catalog">—</div>
        </button>`;
  const itemCatalogActive = smv === 'item-catalog';
  const itemCatalogCard = `
        <button type="button" class="inv-wh-card inv-wh-card-item-catalog ${itemCatalogActive ? 'active' : ''}" onclick="invSelectStockMasterView('item-catalog')" role="listitem" title="物品目录（全局主数据）">
          <div class="inv-wh-card-brand">物品目录</div>
          <div class="inv-wh-card-region">物料主数据</div>
          <div class="inv-wh-card-label" id="badge-item-catalog">—</div>
        </button>`;
  const emptyActive = smv === 'empty';
  const emptyCard = `
        <button type="button" class="inv-wh-card inv-wh-card-empty ${emptyActive ? 'active' : ''}" onclick="invSelectStockMasterView('empty')" role="listitem" title="各仓库空瓶回收库存">
          <div class="inv-wh-card-brand">空瓶回收</div>
          <div class="inv-wh-card-region">按仓查看 · 结算</div>
          <div class="inv-wh-card-label" aria-hidden="true">&nbsp;</div>
        </button>`;
  if (!orderedWarehouses.length) {
    return `
    <div class="inv-warehouse-cards" role="list" aria-label="选择酒品目录或空瓶回收">
      ${wineCard}
      ${itemCatalogCard}
      ${emptyCard}
    </div>`;
  }
  return `
    <div class="inv-warehouse-cards" role="list" aria-label="选择仓库、酒品目录或空瓶回收">
      ${whButtons}
      ${wineCard}
      ${itemCatalogCard}
      ${emptyCard}
    </div>`;
}

function invSelectStockMasterView(mode) {
  if (mode !== 'wine' && mode !== 'empty' && mode !== 'item-catalog') return;
  inventoryPageState.stockMasterView = mode;
  try {
    localStorage.setItem('remy_stockMasterView', mode);
  } catch (_) { /* ignore */ }
  renderInventory();
}

/** 新建/编辑仓库的弹窗状态（编辑模式时记录目标 id） */
let invWarehouseModalState = { id: null, brands: [] };

const INV_WAREHOUSE_REGION_OPTIONS = ['东区', '南区', '北区', '东南区'];

async function invOpenWarehouseModal(id) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可维护仓库', 'warning');
    return;
  }
  const targetId = Number.isFinite(parseInt(id, 10)) ? parseInt(id, 10) : null;
  invWarehouseModalState = { id: targetId, brands: [] };

  // 优先用前端 _brandCache，缺失则现拉
  let brands = Array.isArray(_brandCache) && _brandCache.length ? _brandCache : null;
  if (!brands) {
    try {
      brands = await api('GET', '/brand?active=true');
      _brandCache = Array.isArray(brands) ? brands : [];
    } catch (_) {
      brands = [];
    }
  }
  invWarehouseModalState.brands = Array.isArray(brands) ? brands : [];

  // 编辑模式：拉取当前仓库详情
  let current = null;
  if (targetId) {
    try {
      const all = await api('GET', '/inventory/warehouses');
      current = (Array.isArray(all) ? all : []).find((w) => Number(w.id) === targetId) || null;
    } catch (_) {
      current = null;
    }
    if (!current) {
      showToast('未找到该仓库', 'error');
      return;
    }
  }

  const titleEl = document.getElementById('invWhModalTitle');
  if (titleEl) titleEl.textContent = current ? `编辑仓库 #${current.id}` : '新建仓库';
  const submitBtn = document.getElementById('invWhModalSubmit');
  if (submitBtn) submitBtn.textContent = current ? '保存修改' : '创建仓库';

  const brandOptions = invWarehouseModalState.brands
    .map((b) => `<option value="${b.id}" ${current && Number(current.brand_id) === Number(b.id) ? 'selected' : ''}>${escapeHtml(b.brand_code || '')} ${escapeHtml(b.brand_name || '')}</option>`)
    .join('');
  const regionOptions = INV_WAREHOUSE_REGION_OPTIONS
    .map((r) => `<option value="${r}" ${current && current.region === r ? 'selected' : ''}>${r}</option>`)
    .join('');

  const body = document.getElementById('invWhModalBody');
  if (body) {
    body.innerHTML = `
      <div class="form-group">
        <label class="form-label" for="invWhLabel">仓库名称 <span class="form-hint" style="font-weight:normal">（显示在卡片底部，例如：布赫拉迪 全国总仓）</span></label>
        <input type="text" class="form-control" id="invWhLabel" maxlength="128" placeholder="可选；留空则只显示「品牌 区域」" value="${escapeHtml(current?.label || '')}">
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label" for="invWhBrand">品牌归属 <span class="required">*</span></label>
          <select class="form-control" id="invWhBrand">
            <option value="">请选择品牌</option>
            ${brandOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="invWhRegion">区域 <span class="required">*</span></label>
          <select class="form-control" id="invWhRegion">
            <option value="">请选择区域</option>
            ${regionOptions}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="invWhCity">仓库所在城市</label>
        <input type="text" class="form-control" id="invWhCity" maxlength="64" placeholder="例如：北京 / 上海 / 广州（用于后台检索）" value="${escapeHtml(current?.city || '')}">
      </div>
      <div class="form-group">
        <label class="form-label" for="invWhRemarks">备注 <span class="form-hint" style="font-weight:normal">（实际承载品牌、特殊用途等说明）</span></label>
        <textarea class="form-control" id="invWhRemarks" rows="3" maxlength="500" placeholder="例：南区仓库虽挂在 X.O 名下，实际大多承载 PHD 物料；物流计入品牌请在物流页面手动调整。">${escapeHtml(current?.remarks || '')}</textarea>
      </div>
      <p class="form-hint" style="margin:0;font-size:12px;line-height:1.5;color:var(--text-secondary)">
        ${current
          ? '编辑后会立即生效；同一品牌下区域 <strong>唯一</strong>，调整请避免与已有仓库冲突。'
          : '同一品牌下区域 <strong>唯一</strong>，不能与已有仓库重复。创建后可继续添加物料/酒品。'}
      </p>
    `;
  }
  openModal('modalInvWarehouse');
  renderLucideIcons();
}

async function invSubmitWarehouseModal() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可维护仓库', 'warning');
    return;
  }
  const brandIdRaw = document.getElementById('invWhBrand')?.value || '';
  const region = String(document.getElementById('invWhRegion')?.value || '').trim();
  const label = String(document.getElementById('invWhLabel')?.value || '').trim();
  const city = String(document.getElementById('invWhCity')?.value || '').trim();
  const remarks = String(document.getElementById('invWhRemarks')?.value || '').trim();
  const brandId = parseInt(brandIdRaw, 10);
  if (!Number.isFinite(brandId)) {
    showToast('请选择品牌', 'warning');
    return;
  }
  if (!region) {
    showToast('请选择区域', 'warning');
    return;
  }
  const payload = {
    brand_id: brandId,
    region,
    label: label || null,
    city: city || null,
    remarks: remarks || null,
  };
  const editId = invWarehouseModalState.id;
  try {
    if (editId) {
      await api('PUT', `/inventory/warehouses/${editId}`, payload);
      showToast('仓库已更新', 'success');
    } else {
      await api('POST', '/inventory/warehouses', payload);
      showToast('仓库已创建', 'success');
    }
    closeModal();
    invWarehouseModalState = { id: null, brands: [] };
    inventoryPageState.outboundWarehousesCache = [];
    await renderInventory();
  } catch (e) {
    showToast(e.message || (editId ? '更新失败' : '创建失败'), 'error');
  }
}

function invSelectWarehouse(warehouseId) {
  const id = parseInt(warehouseId, 10);
  if (!Number.isFinite(id)) return;
  inventoryPageState.stockMasterView = 'warehouse';
  try {
    localStorage.setItem('remy_stockMasterView', 'warehouse');
  } catch (_) { /* ignore */ }
  inventoryPageState.warehouseId = id;
  inventoryPageState.outboundLines = [];
  renderInventory();
}

function invItemActionsHtml(it) {
  const wineBtn = invItemIsWineTagged(it)
    ? `<button type="button" class="btn btn-xs btn-ghost inv-admin-only inv-btn-wine-on" onclick="event.stopPropagation();invToggleItemWine(${it.id}, 0)" title="取消参与用酒统计">取消酒标</button>`
    : `<button type="button" class="btn btn-xs btn-ghost inv-admin-only" onclick="event.stopPropagation();invToggleItemWine(${it.id}, 1)" title="标记为酒类并参与用酒统计">标为酒类</button>`;
  return `<span class="inv-item-actions">
    <button type="button" class="btn btn-xs btn-secondary inv-admin-only" onclick="event.stopPropagation();invOpenEditItem(${it.id})">编辑</button>
    ${wineBtn}
    <button type="button" class="btn btn-xs btn-ghost inv-admin-only" onclick="event.stopPropagation();invToggleItemCommon(${it.id}, ${invItemIsCommon(it) ? 0 : 1})" title="常用物料会在新建出库时优先列出">${invItemIsCommon(it) ? '取消常用' : '设为常用'}</button>
    <button type="button" class="btn btn-xs btn-ghost inv-admin-only" onclick="event.stopPropagation();invDeleteItem(${it.id})">删除</button>
  </span>`;
}
