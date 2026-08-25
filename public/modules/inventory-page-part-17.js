function invRenderInboundModal() {
  const body = document.getElementById('modalInvInboundBody');
  if (!body) return;
  const whOpts = invInboundState.warehouses
    .map((w) => `<option value="${w.id}" ${Number(w.id) === invInboundState.warehouseId ? 'selected' : ''}>${escapeHtml(`${invWarehouseFullLabel(w)}${w.label && w.label !== `${w.region}仓库` ? ` · ${w.label}` : ''}`)}</option>`)
    .join('');
  const today = todayDateInputValue();
  const rowHtml = invInboundState.rows
    .map((r, i) => `
      <div class="inv-inbound-row" style="display:flex;gap:8px;align-items:flex-end;margin-bottom:6px">
        <div style="position:relative;flex:1;min-width:0">
          <input type="text" class="form-control inv-inbound-row-search" data-idx="${i}" placeholder="搜索物品..." autocomplete="off"
            oninput="invFilterInboundItems(this.value,${i})" onfocus="invFilterInboundItems(this.value,${i})"
            onblur="setTimeout(()=>invCloseInboundDropdown(),180)"
            value="${escapeHtml(r.itemName)}">
          <div class="inv-inbound-dropdown" id="invInboundDropdown_${i}" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:180px;overflow-y:auto;background:var(--bg-primary);border:1px solid var(--border);border-radius:0 0 6px 6px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.1)"></div>
        </div>
        <input type="number" class="form-control inv-inbound-row-qty" data-idx="${i}" min="1" step="1" value="${r.qty}" style="width:80px;flex-shrink:0" placeholder="数量">
        <input type="hidden" class="inv-inbound-row-id" value="${r.itemId || ''}">
        ${invInboundState.rows.length > 1 ? `<button type="button" class="btn btn-xs btn-secondary" onclick="invRemoveInboundRow(${i})" style="flex-shrink:0" title="移除此行">✕</button>` : ''}
      </div>`)
    .join('');
  body.innerHTML = `
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">目标仓库</label>
      <select class="form-control" id="invInboundWarehouse" onchange="invOnInboundWarehouseChange(this.value)">
        ${whOpts}
      </select>
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">物品清单</label>
      <div id="invInboundRowsHost">${rowHtml}</div>
      <button type="button" class="btn btn-xs btn-secondary" onclick="invAddInboundRow()" style="margin-top:4px">+ 添加一行物品</button>
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">入库时间</label>
      <input type="date" class="form-control" id="invInboundDate" value="${today}">
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">入库来源</label>
      <input type="text" class="form-control" id="invInboundSource" placeholder="例如：采购入库、调拨入库、盘盈入库">
    </div>
    <div class="form-group" style="margin-bottom:0">
      <label class="form-label">备注</label>
      <input type="text" class="form-control" id="invInboundRemarks" placeholder="选填">
    </div>`;
}

function invAddInboundRow() {
  invSyncInboundRows();
  invInboundState.rows.push({ itemId: null, itemName: '', qty: 1 });
  invRenderInboundModal();
}

function invRemoveInboundRow(idx) {
  invSyncInboundRows();
  invInboundState.rows.splice(idx, 1);
  invRenderInboundModal();
}

function invSyncInboundRows() {
  const host = document.getElementById('invInboundRowsHost');
  if (!host) return;
  const searches = host.querySelectorAll('.inv-inbound-row-search');
  const qtys = host.querySelectorAll('.inv-inbound-row-qty');
  const ids = host.querySelectorAll('.inv-inbound-row-id');
  invInboundState.rows = [];
  for (let i = 0; i < searches.length; i++) {
    invInboundState.rows.push({
      itemId: parseInt(ids[i]?.value, 10) || null,
      itemName: searches[i]?.value || '',
      qty: parseInt(qtys[i]?.value, 10) || 1,
    });
  }
}

function invFilterInboundItems(query, rowIdx) {
  const dropdown = document.getElementById(`invInboundDropdown_${rowIdx}`);
  if (!dropdown) return;
  const q = (query || '').trim().toLowerCase();
  const filtered = q
    ? invInboundState.items.filter((it) => (it.name || '').toLowerCase().includes(q) || (it.dimensions || '').toLowerCase().includes(q))
    : invInboundState.items;
  if (filtered.length) {
    dropdown.style.display = 'block';
    dropdown.innerHTML = filtered
      .map((it) => `<div class="inv-inbound-dropdown-item" data-id="${it.id}" data-idx="${rowIdx}" onmousedown="invSelectInboundItem(${it.id},${rowIdx})" style="padding:7px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border-light,#eee);transition:background .12s">${escapeHtml(it.name || '')} — ${escapeHtml(it.dimensions || '')}（库存 ${it.quantity_on_hand || 0}）</div>`)
      .join('');
  } else {
    dropdown.style.display = 'block';
    dropdown.innerHTML = '<div style="padding:8px;color:var(--text-muted);font-size:12px">无匹配物品</div>';
  }
}

function invSelectInboundItem(id, rowIdx) {
  if (rowIdx == null) return;
  const search = document.querySelector(`.inv-inbound-row-search[data-idx="${rowIdx}"]`);
  const hidden = document.querySelector(`.inv-inbound-row-id[data-idx="${rowIdx}"]`) || document.querySelectorAll('.inv-inbound-row-id')[rowIdx];
  const dropdown = document.getElementById(`invInboundDropdown_${rowIdx}`);
  if (hidden) hidden.value = id;
  const item = invInboundState.items.find((it) => Number(it.id) === id);
  if (search && item) search.value = `${item.name || ''} — ${item.dimensions || ''}`;
  if (dropdown) dropdown.style.display = 'none';
}

function invCloseInboundDropdown() {
  const dropdown = document.getElementById('invInboundDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

async function invDeleteInboundRecord(id) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除入库记录', 'warning');
    return;
  }
  if (!confirm('确定删除该入库记录？仓库库存将自动回退。')) return;
  try {
    await api('DELETE', `/inventory/inbound/${id}`);
    showToast('已删除并回退库存', 'success');
    await renderInventory();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

function invOpenInboundEditModal(id) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可编辑入库记录', 'warning');
    return;
  }
  const row = (inventoryPageState.inboundDirectRows || []).find((r) => Number(r.batch_id) === Number(id));
  if (!row) {
    showToast('未找到该入库记录，请刷新后重试', 'warning');
    return;
  }
  inventoryPageState.inboundEditId = Number(id);
  const body = document.getElementById('modalInvInboundEditBody');
  if (!body) return;
  body.innerHTML = `
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">入库内容</label>
      <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);font-size:13px">
        <div style="font-weight:700">${escapeHtml(row.display_main || '—')}</div>
        <div style="margin-top:4px;color:var(--text-secondary)">数量：${escapeHtml(row._qty || 0)} ｜ 仓库：${escapeHtml(`${row.brand_code || ''} ${row.region || ''}`.trim() || '—')}</div>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">入库日期</label>
      <input type="date" class="form-control" id="invInboundEditDate" value="${escapeHtml(toDateInputValue(row.inbound_date || row.return_date))}">
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">入库来源</label>
      <input type="text" class="form-control" id="invInboundEditSource" placeholder="例如：采购入库、调拨入库、盘盈入库" value="${escapeHtml(row.source || '')}">
    </div>
    <div class="form-group" style="margin-bottom:0">
      <label class="form-label">备注</label>
      <input type="text" class="form-control" id="invInboundEditRemarks" placeholder="选填" value="${escapeHtml(row.batch_remarks || '')}">
    </div>
  `;
  openModal('modalInvInboundEdit');
}

async function invSubmitInboundEdit() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可编辑入库记录', 'warning');
    return;
  }
  const id = Number(inventoryPageState.inboundEditId || 0);
  if (!id) {
    showToast('未找到要编辑的入库记录', 'warning');
    return;
  }
  try {
    await api('PUT', `/inventory/inbound/${id}`, {
      inbound_date: document.getElementById('invInboundEditDate')?.value || null,
      source: document.getElementById('invInboundEditSource')?.value?.trim() || null,
      remarks: document.getElementById('invInboundEditRemarks')?.value?.trim() || null,
    });
    showToast('入库信息已更新', 'success');
    inventoryPageState.inboundEditId = null;
    closeModal();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '更新失败', 'error');
  }
}

async function invOnInboundWarehouseChange(val) {
  const wid = parseInt(val, 10);
  if (!Number.isFinite(wid)) return;
  invInboundState.warehouseId = wid;
  const body = document.getElementById('modalInvInboundBody');
  if (body) body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">加载物品...</div>';
  try {
    const items = await api('GET', `/inventory/items?inv_warehouse_id=${wid}`);
    invInboundState.items = Array.isArray(items) ? items : [];
    invRenderInboundModal();
  } catch (e) {
    if (body) body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

async function invSubmitInbound() {
  invSyncInboundRows();
  const srcEl = document.getElementById('invInboundSource');
  const rmkEl = document.getElementById('invInboundRemarks');
  const dateEl = document.getElementById('invInboundDate');
  const validRows = invInboundState.rows.filter((r) => Number.isFinite(r.itemId) && r.itemId > 0 && Number.isFinite(r.qty) && r.qty > 0);
  if (!validRows.length) {
    showToast('请至少选择一个物品并输入有效数量', 'warning');
    return;
  }
  const btn = document.getElementById('invInboundSubmitBtn');
  if (btn) btn.disabled = true;
  try {
    const items = validRows.map((r) => ({ inv_item_id: r.itemId, quantity: r.qty }));
    await api('POST', '/inventory/inbound', {
      inv_warehouse_id: invInboundState.warehouseId,
      items,
      source: srcEl?.value?.trim() || null,
      remarks: rmkEl?.value?.trim() || null,
      inbound_date: dateEl?.value || null,
    });
    showToast('入库成功', 'success');
    if (btn) btn.disabled = false;
    closeModal();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '入库失败', 'error');
    if (btn) btn.disabled = false;
  }
}

function invOpenNewItemModal() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可添加物料', 'warning');
    return;
  }
  if (!inventoryPageState.warehouseId) {
    showToast('请先点击仓库卡片', 'warning');
    return;
  }
  const body = document.getElementById('invItemEditModalBody');
  if (!body) return;
  inventoryPageState.itemModalMode = 'new';
  const mt = document.getElementById('invItemModalTitle');
  if (mt) mt.textContent = '添加物品';
  body.innerHTML = invItemModalFormHtml({ mode: 'new', it: null });
  invRenderItemImagePreview('edit');
  openModal('modalInvItemEdit');
  renderLucideIcons();
}
