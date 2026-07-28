async function loadItemCatalogPage() {
  const host = document.getElementById('itemCatalogListHost');
  const statsEl = document.getElementById('itemCatalogStats');
  if (!host) return;
  try {
    const rows = await api('GET', '/inventory/item-catalog');
    const safeRows = Array.isArray(rows) ? rows : [];
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-card" style="min-width:180px">
          <div class="stat-label">目录条数</div>
          <div class="stat-value">${safeRows.length}</div>
        </div>`;
    }
    if (!safeRows.length) {
      host.innerHTML =
        '<div class="empty-state">暂无物品目录。点击上方「同步目录（PHD/X.O/CLUB）」生成目录主数据。</div>';
      renderLucideIcons();
      return;
    }
    host.innerHTML = `
      <div class="table-wrapper act-table-scroll-wrap">
        <table class="data-table act-table-sticky-head">
          <thead>
            <tr>
              <th style="width:72px">图</th>
              <th>名称</th>
              <th>规格</th>
              <th>来源品牌</th>
              <th>来源区域</th>
              <th style="width:88px">常用</th>
            </tr>
          </thead>
          <tbody>
            ${safeRows
              .map((r) => {
                const img =
                  Array.isArray(r.image_urls) && r.image_urls[0]
                    ? `<img src="${escapeHtml(r.image_urls[0])}" alt="" style="width:56px;height:56px;object-fit:contain;border-radius:6px;background:var(--bg-primary)">`
                    : '<span style="color:var(--text-muted);font-size:12px">—</span>';
                return `<tr>
                  <td>${img}</td>
                  <td style="font-weight:600">${escapeHtml(r.name || '—')}</td>
                  <td>${escapeHtml(r.dimensions || '—')}</td>
                  <td>${escapeHtml(r.source_brands || '—')}</td>
                  <td>${escapeHtml(r.source_regions || '—')}</td>
                  <td>${r.is_common ? '<span class="badge badge-accent">常用</span>' : '<span class="badge badge-gray">—</span>'}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>`;
    renderLucideIcons();
  } catch (e) {
    const msg = String(e && e.message ? e.message : '');
    if (/\b404\b/.test(msg)) {
      host.innerHTML =
        '<div class="empty-state">当前后端进程未加载“物品目录”接口（404）。请重启后端后重试；重启前你也可以先在服务器执行脚本 <code>npm run script:sync-inv-item-catalog</code>。</div>';
      return;
    }
    host.innerHTML = `<div style="color:var(--danger);padding:16px">加载失败：${escapeHtml(msg || '')}</div>`;
  }
}

async function invSyncItemCatalogFromWarehouses() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可同步物品目录', 'warning');
    return;
  }
  try {
    const ret = await api('POST', '/inventory/item-catalog/sync-from-warehouses', {});
    showToast(`同步完成：新增 ${ret.inserted || 0}，更新 ${ret.updated || 0}`, 'success');
    await loadItemCatalogPage();
    updateBadges();
  } catch (e) {
    const msg = String(e && e.message ? e.message : '');
    if (/\b404\b/.test(msg)) {
      showToast('同步接口未生效（404）：请重启后端服务后再点同步', 'warning');
      return;
    }
    showToast(msg || '同步失败', 'error');
  }
}

async function invOpenAddItemCatalogModal() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可从目录添加物品', 'warning');
    return;
  }
  const whId = Number(inventoryPageState.warehouseId || 0);
  if (!whId) {
    showToast('请先点击仓库卡片', 'warning');
    return;
  }
  const body = document.getElementById('invAddItemCatalogModalBody');
  if (!body) return;
  body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">加载物品目录中...</div>';
  openModal('modalInvAddItemCatalog');
  try {
    const [catalog, warehouses] = await Promise.all([
      api('GET', '/inventory/item-catalog'),
      api('GET', '/inventory/warehouses'),
    ]);
    invAddItemCatalogModalState.catalog = Array.isArray(catalog) ? catalog : [];
    invAddItemCatalogModalState.warehouses = Array.isArray(warehouses) ? warehouses : [];
    invAddItemCatalogModalState.warehouseId = whId;
    invAddItemCatalogModalState.search = '';
    if (!invAddItemCatalogModalState.warehouses.some((w) => Number(w.id) === whId)) {
      invAddItemCatalogModalState.warehouseId = Number(invAddItemCatalogModalState.warehouses[0]?.id || 0) || null;
    }
    await invRenderAddItemCatalogModalContent();
  } catch (e) {
    body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

async function invRenderAddItemCatalogModalContent() {
  const body = document.getElementById('invAddItemCatalogModalBody');
  if (!body) return;
  const whId = Number(invAddItemCatalogModalState.warehouseId || 0);
  if (!whId) {
    body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">暂无可用仓库，请先创建仓库。</div>';
    return;
  }
  const wh = (invAddItemCatalogModalState.warehouses || []).find((w) => Number(w.id) === whId);
  const items = await api('GET', `/inventory/items?inv_warehouse_id=${whId}`);
  const exists = new Set((items || []).map((it) => invCatalogKey(it.name, it.dimensions)));
  const rows = (invAddItemCatalogModalState.catalog || []).map((c) => {
    const key = invCatalogKey(c.name, c.dimensions);
    const already = exists.has(key);
    const img =
      Array.isArray(c.image_urls) && c.image_urls[0]
        ? `<img src="${escapeHtml(c.image_urls[0])}" alt="" style="width:40px;height:40px;object-fit:contain;border-radius:6px;background:var(--bg-primary)">`
        : '<span style="color:var(--text-muted)">—</span>';
    const searchText = [c.name, c.dimensions, c.source_brands, c.source_regions]
      .map((x) => String(x || '').trim().toLowerCase())
      .filter(Boolean)
      .join(' ');
    return `
      <tr data-catalog-id="${c.id}" data-search="${escapeHtml(searchText)}">
        <td>${img}</td>
        <td style="font-weight:600">${escapeHtml(c.name || '—')}</td>
        <td>${escapeHtml(c.dimensions || '—')}</td>
        <td>${escapeHtml(c.source_brands || '—')}</td>
        <td style="text-align:center">
          ${already ? `<span style="font-size:12px;color:var(--text-muted)">已在仓库</span>` : `<input type="checkbox" class="inv-add-item-catalog-ck" data-catalog-id="${c.id}">`}
        </td>
        <td style="width:100px">
          ${already ? '<span style="color:var(--text-muted);font-size:12px">—</span>' : `<input type="number" class="form-control inv-add-item-catalog-qty" data-catalog-id="${c.id}" min="0" step="1" value="0" placeholder="0">`}
        </td>
      </tr>`;
  });
  const whOpts = (invAddItemCatalogModalState.warehouses || [])
    .map((w) => `<option value="${w.id}" ${Number(w.id) === whId ? 'selected' : ''}>${escapeHtml(`${invWarehouseFullLabel(w)}${w.label && w.label !== `${w.region}仓库` ? ` · ${w.label}` : ''}`)}</option>`)
    .join('');
  body.innerHTML = `
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">目标仓库</label>
      <select class="form-control" id="invAddItemCatalogWarehouse" onchange="invOnAddItemCatalogWarehouseChange(this.value)">
        ${whOpts}
      </select>
    </div>
    <div class="form-hint" style="margin:0 0 10px">
      当前仓库：<strong>${escapeHtml(wh ? invWarehouseFullLabel(wh) : `#${whId}`)}</strong>。从目录选择物料加入仓库；数量可填 0，后续再调整。
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <button type="button" class="btn btn-secondary btn-xs" onclick="invAddItemCatalogToggleAll(true)">全选可添加</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="invAddItemCatalogToggleAll(false)">全不选</button>
      <input
        type="text"
        class="form-control"
        id="invAddItemCatalogSearch"
        value="${escapeHtml(invAddItemCatalogModalState.search || '')}"
        placeholder="搜索名称/规格/来源品牌"
        style="margin-left:auto;max-width:280px"
        oninput="invFilterAddItemCatalogRows(this.value)"
      >
    </div>
    <div class="table-wrapper" style="max-height:52vh;overflow:auto">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:52px">图</th>
            <th>名称</th>
            <th>规格</th>
            <th>来源品牌</th>
            <th style="width:96px;text-align:center">加入</th>
            <th style="width:110px">初始数量</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
  invFilterAddItemCatalogRows(invAddItemCatalogModalState.search || '');
}

function invFilterAddItemCatalogRows(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  invAddItemCatalogModalState.search = kw;
  document.querySelectorAll('#invAddItemCatalogModalBody tbody tr[data-search]').forEach((tr) => {
    const hay = String(tr.getAttribute('data-search') || '').toLowerCase();
    tr.style.display = !kw || hay.includes(kw) ? '' : 'none';
  });
}

async function invOnAddItemCatalogWarehouseChange(warehouseId) {
  const id = parseInt(warehouseId, 10);
  if (!Number.isFinite(id)) return;
  invAddItemCatalogModalState.warehouseId = id;
  const body = document.getElementById('invAddItemCatalogModalBody');
  if (body) body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">切换仓库中...</div>';
  try {
    await invRenderAddItemCatalogModalContent();
  } catch (e) {
    if (body) body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

function invAddItemCatalogToggleAll(checked) {
  document.querySelectorAll('.inv-add-item-catalog-ck').forEach((el) => {
    el.checked = !!checked;
  });
}

async function invSubmitAddItemCatalogToWarehouse() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可从目录添加物品', 'warning');
    return;
  }
  const whId = Number(
    document.getElementById('invAddItemCatalogWarehouse')?.value || invAddItemCatalogModalState.warehouseId || inventoryPageState.warehouseId || 0,
  );
  if (!whId) {
    showToast('请先选择仓库', 'warning');
    return;
  }
  const picked = [];
  document.querySelectorAll('.inv-add-item-catalog-ck:checked').forEach((ck) => {
    const catalogId = parseInt(ck.dataset.catalogId, 10);
    if (!Number.isFinite(catalogId) || catalogId <= 0) return;
    const qtyEl = document.querySelector(`.inv-add-item-catalog-qty[data-catalog-id="${catalogId}"]`);
    const q = parseInt(qtyEl?.value, 10);
    picked.push({ catalog_id: catalogId, quantity: Number.isFinite(q) && q >= 0 ? q : 0 });
  });
  if (!picked.length) {
    showToast('请先勾选要添加的物料', 'warning');
    return;
  }
  try {
    const ret = await api('POST', '/inventory/items/from-item-catalog', {
      inv_warehouse_id: whId,
      items: picked,
    });
    inventoryPageState.warehouseId = whId;
    showToast(
      `已添加 ${ret.inserted || 0} 条；已存在 ${ret.skipped_existing || 0} 条`,
      'success',
    );
    closeModal();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '添加失败', 'error');
  }
}
