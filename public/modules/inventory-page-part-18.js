async function invOpenAddWineModal() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可添加酒品到仓库', 'warning');
    return;
  }
  const whId = Number(inventoryPageState.warehouseId || 0);
  if (!whId) {
    showToast('请先点击仓库卡片', 'warning');
    return;
  }
  const body = document.getElementById('invAddWineModalBody');
  if (!body) return;
  body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">加载酒品目录中...</div>';
  openModal('modalInvAddWine');
  try {
    const [catalog, warehouses] = await Promise.all([
      api('GET', '/wine/catalog'),
      api('GET', '/inventory/warehouses'),
    ]);
    invAddWineModalState.catalog = Array.isArray(catalog) ? catalog : [];
    invAddWineModalState.warehouses = Array.isArray(warehouses) ? warehouses : [];
    invAddWineModalState.warehouseId = whId;
    invAddWineModalState.search = '';
    if (!invAddWineModalState.warehouses.some((w) => Number(w.id) === whId)) {
      invAddWineModalState.warehouseId = Number(invAddWineModalState.warehouses[0]?.id || 0) || null;
    }
    await invRenderAddWineModalContent();
  } catch (e) {
    body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

async function invRenderAddWineModalContent() {
  const body = document.getElementById('invAddWineModalBody');
  if (!body) return;
  const whId = Number(invAddWineModalState.warehouseId || 0);
  if (!whId) {
    body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">暂无可用仓库，请先创建仓库。</div>';
    return;
  }
  const wh = (invAddWineModalState.warehouses || []).find((w) => Number(w.id) === whId);
  const items = await api('GET', `/inventory/items?inv_warehouse_id=${whId}`);
  const exists = new Set(
    (items || []).map((it) => `${String(it.name || '').trim()}@@${String(it.dimensions || '').trim()}`),
  );
  const rows = (invAddWineModalState.catalog || []).map((c) => {
    const spec = [c.category, c.volume_label].filter((x) => String(x || '').trim()).join(' · ');
    const key = `${String(c.name || '').trim()}@@${String(spec || '').trim()}`;
    const already = exists.has(key);
    const img =
      Array.isArray(c.image_urls) && c.image_urls[0]
        ? `<img src="${escapeHtml(c.image_urls[0])}" alt="" style="width:40px;height:40px;object-fit:contain;border-radius:6px;background:var(--bg-primary)">`
        : '<span style="color:var(--text-muted)">—</span>';
    const searchText = [c.brand, c.name, spec]
      .map((x) => String(x || '').trim().toLowerCase())
      .filter(Boolean)
      .join(' ');
    return `
      <tr data-catalog-id="${c.id}" data-search="${escapeHtml(searchText)}">
        <td>${img}</td>
        <td>${escapeHtml(c.brand || '—')}</td>
        <td style="font-weight:600">${escapeHtml(c.name || '—')}</td>
        <td>${escapeHtml(spec || '—')}</td>
        <td style="text-align:center">
          ${already ? `<span style="font-size:12px;color:var(--text-muted)">已在仓库</span>` : `<input type="checkbox" class="inv-add-wine-ck" data-catalog-id="${c.id}">`}
        </td>
        <td style="width:100px">
          ${already ? '<span style="color:var(--text-muted);font-size:12px">—</span>' : `<input type="number" class="form-control inv-add-wine-qty" data-catalog-id="${c.id}" min="0" step="1" value="0" placeholder="0">`}
        </td>
      </tr>`;
  });
  const whOpts = (invAddWineModalState.warehouses || [])
    .map((w) => `<option value="${w.id}" ${Number(w.id) === whId ? 'selected' : ''}>${escapeHtml(`${invWarehouseFullLabel(w)}${w.label && w.label !== `${w.region}仓库` ? ` · ${w.label}` : ''}`)}</option>`)
    .join('');
  body.innerHTML = `
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">目标仓库</label>
      <select class="form-control" id="invAddWineWarehouse" onchange="invOnAddWineWarehouseChange(this.value)">
        ${whOpts}
      </select>
    </div>
    <div class="form-hint" style="margin:0 0 10px">
      当前仓库：<strong>${escapeHtml(wh ? invWarehouseFullLabel(wh) : `#${whId}`)}</strong>。可手动勾选目录酒品加入该仓库；数量可填 0，后续再调整。
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <button type="button" class="btn btn-secondary btn-xs" onclick="invAddWineToggleAll(true)">全选可添加</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="invAddWineToggleAll(false)">全不选</button>
      <input
        type="text"
        class="form-control"
        id="invAddWineSearch"
        value="${escapeHtml(invAddWineModalState.search || '')}"
        placeholder="搜索品牌/名称/类别容量"
        style="margin-left:auto;max-width:280px"
        oninput="invFilterAddWineRows(this.value)"
      >
    </div>
    <div class="table-wrapper" style="max-height:52vh;overflow:auto">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:52px">图</th>
            <th>品牌</th>
            <th>名称</th>
            <th>类别·容量</th>
            <th style="width:96px;text-align:center">加入</th>
            <th style="width:110px">初始数量</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
  invFilterAddWineRows(invAddWineModalState.search || '');
}

function invFilterAddWineRows(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  invAddWineModalState.search = kw;
  document.querySelectorAll('#invAddWineModalBody tbody tr[data-search]').forEach((tr) => {
    const hay = String(tr.getAttribute('data-search') || '').toLowerCase();
    tr.style.display = !kw || hay.includes(kw) ? '' : 'none';
  });
}

async function invOnAddWineWarehouseChange(warehouseId) {
  const id = parseInt(warehouseId, 10);
  if (!Number.isFinite(id)) return;
  invAddWineModalState.warehouseId = id;
  const body = document.getElementById('invAddWineModalBody');
  if (body) body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">切换仓库中...</div>';
  try {
    await invRenderAddWineModalContent();
  } catch (e) {
    if (body) body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

function invAddWineToggleAll(checked) {
  document.querySelectorAll('.inv-add-wine-ck').forEach((el) => {
    el.checked = !!checked;
  });
}

async function invSubmitAddWineToWarehouse() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可添加酒品到仓库', 'warning');
    return;
  }
  const whId = Number(
    document.getElementById('invAddWineWarehouse')?.value || invAddWineModalState.warehouseId || inventoryPageState.warehouseId || 0,
  );
  if (!whId) {
    showToast('请先选择仓库', 'warning');
    return;
  }
  const picked = [];
  document.querySelectorAll('.inv-add-wine-ck:checked').forEach((ck) => {
    const catalogId = parseInt(ck.dataset.catalogId, 10);
    if (!Number.isFinite(catalogId) || catalogId <= 0) return;
    const qtyEl = document.querySelector(`.inv-add-wine-qty[data-catalog-id="${catalogId}"]`);
    const q = parseInt(qtyEl?.value, 10);
    picked.push({ catalog_id: catalogId, quantity: Number.isFinite(q) && q >= 0 ? q : 0 });
  });
  if (!picked.length) {
    showToast('请先勾选要添加的酒品', 'warning');
    return;
  }
  try {
    const ret = await api('POST', '/inventory/items/from-catalog', {
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

function invCapturePageScrollPosition(anchorItemId) {
  const container = document.getElementById('pageContainer');
  const scrollingEl = document.scrollingElement || document.documentElement;
  const masterScroll = container ? container.querySelector('.inv-master-scroll-body') : null;
  const listWrap = container ? container.querySelector('.inv-items-table-wrap') : null;
  const normalizedAnchorId = Number(anchorItemId);
  const anchorEl =
    container && Number.isFinite(normalizedAnchorId) && normalizedAnchorId > 0
      ? container.querySelector(`[data-item-id="${normalizedAnchorId}"]`)
      : null;
  let anchorOffsetInMaster = null;
  if (anchorEl && masterScroll) {
    const scrollRect = masterScroll.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    anchorOffsetInMaster = anchorRect.top - scrollRect.top + masterScroll.scrollTop;
  }
  return {
    containerTop: container ? container.scrollTop : null,
    pageTop: Math.max(0, window.scrollY || scrollingEl?.scrollTop || 0),
    masterScrollTop: masterScroll ? masterScroll.scrollTop : null,
    listWrapTop: listWrap ? listWrap.scrollTop : null,
    anchorItemId: Number.isFinite(normalizedAnchorId) && normalizedAnchorId > 0 ? normalizedAnchorId : null,
    anchorOffsetInMaster,
  };
}

function invRestorePageScrollPosition(snapshot) {
  if (!snapshot) return;
  const restoreOnce = () => {
    const container = document.getElementById('pageContainer');
    const masterScroll = container ? container.querySelector('.inv-master-scroll-body') : null;
    if (masterScroll && Number.isFinite(snapshot.masterScrollTop)) {
      masterScroll.scrollTop = Math.max(0, snapshot.masterScrollTop);
    }
    if (container && Number.isFinite(snapshot.containerTop)) {
      container.scrollTop = Math.max(0, snapshot.containerTop);
    }
    const listWrap = container ? container.querySelector('.inv-items-table-wrap') : null;
    if (listWrap && Number.isFinite(snapshot.listWrapTop)) {
      listWrap.scrollTop = Math.max(0, snapshot.listWrapTop);
    }
    if (Number.isFinite(snapshot.pageTop)) {
      window.scrollTo(0, Math.max(0, snapshot.pageTop));
    }
    if (container && snapshot.anchorItemId) {
      const anchorEl = container.querySelector(`[data-item-id="${snapshot.anchorItemId}"]`);
      if (anchorEl && masterScroll && Number.isFinite(snapshot.anchorOffsetInMaster)) {
        const scrollRect = masterScroll.getBoundingClientRect();
        const anchorRect = anchorEl.getBoundingClientRect();
        const currentOffset = anchorRect.top - scrollRect.top + masterScroll.scrollTop;
        const delta = currentOffset - snapshot.anchorOffsetInMaster;
        if (Math.abs(delta) > 1) masterScroll.scrollTop = Math.max(0, masterScroll.scrollTop - delta);
      } else if (anchorEl) {
        anchorEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  };
  requestAnimationFrame(() => {
    restoreOnce();
    requestAnimationFrame(() => {
      restoreOnce();
      setTimeout(restoreOnce, 0);
    });
  });
}
