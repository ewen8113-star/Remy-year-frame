async function invOpenOutboundEditModal(orderId) {
  try {
    const inlineEdit = currentPage === 'inv-outbound';
    const body = document.getElementById('invOutboundModalBody');
    if (!inlineEdit) {
      if (body) body.innerHTML = '<div class="empty-state">加载中...</div>';
      openModal('modalInvOutbound');
    } else {
      inventoryPageState.outboundInlineOpen = true;
      inventoryPageState.editOutboundOrderId = orderId;
    }
    let det;
    try {
      det = await api('GET', `/inventory/outbound/${orderId}`);
    } catch (e) {
      showToast(e.message || '加载失败', 'error');
      if (!inlineEdit) closeModal();
      return;
    }
    const o = det.order;
    let warehouses = [];
    try {
      warehouses = await api('GET', '/inventory/warehouses');
    } catch (e) {
      showToast(e.message || '加载仓库失败', 'error');
      if (!inlineEdit) closeModal();
      return;
    }
    if (!warehouses.length) {
      showToast('暂无仓库，请先在库存管理中新建仓库', 'warning');
      if (!inlineEdit) closeModal();
      return;
    }
    inventoryPageState.warehouseId = o.inv_warehouse_id;
    if (!warehouses.some((w) => w.id === inventoryPageState.warehouseId)) {
      showToast('该出库单关联的仓库不存在', 'error');
      if (!inlineEdit) closeModal();
      return;
    }
    let items = [];
    try {
      items = await api('GET', `/inventory/items?inv_warehouse_id=${inventoryPageState.warehouseId}`);
    } catch (_) {
      items = [];
    }
    const commonByWh = {};
    for (const ln of det.lines || []) {
      const qty = Number(ln.quantity) || 0;
      const note = (ln.line_note && String(ln.line_note).trim()) || '';
      const whKey = Number(ln.inv_warehouse_id || o.inv_warehouse_id);
      if (!Number.isFinite(whKey)) continue;
      if (!commonByWh[whKey]) commonByWh[whKey] = {};
      const preset = commonByWh[whKey];
      const prev = preset[ln.item_id];
      if (!prev) {
        preset[ln.item_id] = { checked: qty > 0, quantity: qty, line_note: note };
      } else {
        prev.quantity += qty;
        const merged = [prev.line_note, note].filter(Boolean).join('；');
        prev.line_note = merged;
        prev.checked = prev.quantity > 0;
      }
    }
    inventoryPageState.outboundLines = [];
    inventoryPageState.editOutboundOrderId = orderId;
    inventoryPageState.outboundEditLineMeta = invBuildOutboundLineMetaFromDetailLines(det.lines, o.inv_warehouse_id);
    inventoryPageState.outboundEditCommonPreset = commonByWh[Number(o.inv_warehouse_id)] || {};
    inventoryPageState.outboundLinesByWarehouse = {};
    inventoryPageState.outboundCommonByWarehouse = commonByWh;
    inventoryPageState.outboundWarehousesCache = warehouses.slice();
    inventoryPageState.outboundListFilter = 'common';
    inventoryPageState.outboundInlineOpen = inlineEdit;

    const of = inventoryPageState.outboundForm;
    of.linkMode = o.link_mode === 'standalone' ? 'standalone' : 'activity';
    of.project_code = o.project_code || '';
    of.purpose = o.purpose || '';
    of.activity_id = o.activity_id != null ? String(o.activity_id) : '';
    of.shipped_at = o.shipped_at ? toDateInputValue(o.shipped_at) : todayDateInputValue();
    // 编辑回填优先用单据上保存的 activity_date；
    // 若旧单没填则取关联活动日期 activity_date_link 作为默认值（保存后会固化到出库单上）。
    {
      const ownActDate = o.activity_date != null && String(o.activity_date).trim() ? String(o.activity_date).slice(0, 10) : '';
      const linkActDate = o.activity_date_link != null && String(o.activity_date_link).trim() ? String(o.activity_date_link).slice(0, 10) : '';
      of.activity_date = ownActDate || linkActDate || '';
    }
    of.recipient_city = o.recipient_city || '';
    of.recipient_address = o.recipient_address || '';
    of.contact_name = o.contact_name || '';
    of.contact_phone = o.contact_phone || '';
    of.logistics_supplier = o.logistics_supplier || '';
    of.logistics_method = o.logistics_method || INV_LOGISTICS_OPTS[0];
    of.tracking_number = o.tracking_number || '';
    of.remarks = o.remarks || '';
    of.hint_msg = '';
    inventoryPageState.linkMode = of.linkMode;

    if (inlineEdit) {
      await renderInventory();
    } else {
      if (!body) return;
      body.innerHTML = invBuildOutboundModalMarkup(warehouses, items, of, {
        editOrderId: orderId,
        commonPreset: inventoryPageState.outboundEditCommonPreset,
      });
      invSetOutboundModalTitle(true);
      await invFillInvProjectDatalist();
      await invLoadOutboundSupplierOptions(of.logistics_supplier);
      const lmEl = document.getElementById('invLinkMode');
      if (lmEl) {
        lmEl.value = of.linkMode !== 'standalone' ? 'activity' : 'standalone';
        inventoryPageState.linkMode = lmEl.value;
        of.linkMode = lmEl.value;
        invToggleLinkMode();
      }
    }
    renderLucideIcons();
  } catch (e) {
    console.error('invOpenOutboundEditModal failed:', e);
    showToast(e?.message || '打开编辑出库失败', 'error');
    if (currentPage !== 'inv-outbound') closeModal();
  }
}

async function invDeleteOutboundOrder(orderId) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除出库单', 'warning');
    return;
  }
  if (
    !window.confirm(
      `确定删除出库单 #${orderId}？\n\n将按原路冲销：先撤销归还登记带来的入库，再撤销出库扣减，并删除本单及全部归还记录（丢失/损坏统计也会随归还明细消失）。仅建议管理员用于测试数据清理。`,
    )
  ) {
    return;
  }
  try {
    const resp = await api('DELETE', `/inventory/outbound/${orderId}`);
    const cleaned = Number((resp && resp.cleaned_logistics) || 0);
    if (cleaned > 0) {
      showToast(`已删除出库单，并联动清理 ${cleaned} 条物流成本`, 'success');
    } else {
      showToast('已删除', 'success');
    }
    updateBadges();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}
