async function invSaveEditItem() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可保存库存主数据', 'warning');
    return;
  }
  const mode = inventoryPageState.itemModalMode;
  const idRaw = document.getElementById('invEditItemId')?.value;
  const id = parseInt(idRaw, 10);
  const name = document.getElementById('invEditItemName')?.value?.trim();
  const qty = parseInt(document.getElementById('invEditItemQty')?.value, 10);
  const urls = (document.getElementById('invEditItemImages')?.value || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!name) {
    showToast('请填写物品名称', 'warning');
    return;
  }
  if (!Number.isFinite(qty) || qty < 0) {
    showToast('库存须为非负整数', 'warning');
    return;
  }
  let alertBelow;
  let statsDamagedOverride;
  let statsLostOverride;
  try {
    alertBelow = invOptionalNonNegIntOrNullInput('invEditItemAlertBelow', '库存预警线');
    statsDamagedOverride = invOptionalNonNegIntOrNullInput('invEditItemDamagedOverride', '损坏（累计）');
    statsLostOverride = invOptionalNonNegIntOrNullInput('invEditItemLostOverride', '丢失（累计）');
  } catch (err) {
    showToast(err.message || '输入无效', 'warning');
    return;
  }
  if (mode !== 'new' && Number.isFinite(id) && id > 0) {
    const aggDEl = document.getElementById('invAggDamaged');
    const aggLEl = document.getElementById('invAggLost');
    if (aggDEl && aggLEl) {
      const aggD = parseInt(String(aggDEl.value ?? '0'), 10);
      const aggL = parseInt(String(aggLEl.value ?? '0'), 10);
      statsDamagedOverride = invMergeStatOverride(statsDamagedOverride, Number.isFinite(aggD) ? aggD : 0);
      statsLostOverride = invMergeStatOverride(statsLostOverride, Number.isFinite(aggL) ? aggL : 0);
    }
  }
  const pageScrollSnapshot = invCapturePageScrollPosition(Number.isFinite(id) && id > 0 ? id : null);
  try {
    if (mode === 'new' || !Number.isFinite(id) || id <= 0) {
      if (!inventoryPageState.warehouseId) {
        showToast('请先点击仓库卡片', 'warning');
        return;
      }
      const isWineNew = document.getElementById('invEditItemIsWine')?.checked === true;
      const wineLblNew = document.getElementById('invEditItemWineLabel')?.value?.trim() || null;
      await api('POST', '/inventory/items', {
        inv_warehouse_id: inventoryPageState.warehouseId,
        name,
        initial_quantity: qty,
        dimensions: document.getElementById('invEditItemDim')?.value || null,
        description: document.getElementById('invEditItemDesc')?.value || null,
        alert_below: alertBelow,
        image_urls: urls,
        is_common: document.getElementById('invEditItemIsCommon')?.checked === true,
        is_wine: isWineNew,
        wine_label: isWineNew ? wineLblNew || name : null,
      });
      showToast('已添加', 'success');
    } else {
      const isWineEdit = document.getElementById('invEditItemIsWine')?.checked === true;
      const wineLblEdit = document.getElementById('invEditItemWineLabel')?.value?.trim() || null;
      await api('PUT', `/inventory/items/${id}`, {
        name,
        quantity_on_hand: qty,
        dimensions: document.getElementById('invEditItemDim')?.value || null,
        description: document.getElementById('invEditItemDesc')?.value || null,
        alert_below: alertBelow,
        image_urls: urls,
        is_common: document.getElementById('invEditItemIsCommon')?.checked === true,
        is_wine: isWineEdit,
        wine_label: isWineEdit ? wineLblEdit || name : null,
        stats_damaged_override: statsDamagedOverride,
        stats_lost_override: statsLostOverride,
      });
      showToast('已保存', 'success');
    }
    invCancelEditItem();
    await renderInventory();
    invRestorePageScrollPosition(pageScrollSnapshot);
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

async function invDeleteItem(id) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除物料', 'warning');
    return;
  }
  if (!window.confirm('删除该物料？')) return;
  const pageScrollSnapshot = invCapturePageScrollPosition(id);
  try {
    await api('DELETE', `/inventory/items/${id}`);
    showToast('已删除', 'success');
    await renderInventory();
    invRestorePageScrollPosition(pageScrollSnapshot);
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

async function invOpenReturn(orderId) {
  const body = document.getElementById('invReturnModalBody');
  const title = document.getElementById('invReturnModalTitle');
  if (!body) return;
  body.innerHTML = '<div class="empty-state">加载中…</div>';
  if (title) title.textContent = `归还登记`;
  try {
    inventoryPageState.returnDetail = await api('GET', `/inventory/outbound/${orderId}`);
    inventoryPageState.returnOrderId = orderId;
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
    return;
  }
  const rd = inventoryPageState.returnDetail;
  const lines = Array.isArray(rd?.lines) ? rd.lines : [];
  const doneByLine = new Map();
  (rd?.batches || []).forEach((b) => {
    (b?.lines || []).forEach((rl) => {
      const lid = Number(rl.outbound_line_id);
      if (!Number.isFinite(lid)) return;
      const done =
        (parseInt(rl.qty_return, 10) || 0) +
        (parseInt(rl.qty_lost, 10) || 0) +
        (parseInt(rl.qty_damaged, 10) || 0) +
        (parseInt(rl.qty_consumed, 10) || 0) +
        (parseInt(rl.qty_empty_recovered, 10) || 0) +
        (parseInt(rl.qty_customer_keep, 10) || 0);
      doneByLine.set(lid, (doneByLine.get(lid) || 0) + Math.max(0, done));
    });
  });
  const rows = lines
    .map((ln) => {
      const shipped = Number(ln.quantity) || 0;
      const done = doneByLine.get(Number(ln.id)) || 0;
      const remain = Math.max(0, shipped - done);
      const whLabel = [ln.line_brand_code, ln.line_region].filter(Boolean).join(' ') || '—';
      return `
      <tr>
        <td>${escapeHtml(ln.item_name)}<input type="hidden" id="ret_max_${ln.id}" value="${remain}"></td>
        <td style="font-size:12px;color:var(--text-secondary)">${escapeHtml(whLabel)}</td>
        <td>${shipped}</td>
        <td>${done}</td>
        <td>${remain}</td>
        <td><input type="number" class="form-control" min="0" id="ret_ok_${ln.id}" value="0"></td>
        <td><input type="number" class="form-control" min="0" id="ret_lost_${ln.id}" value="0"></td>
        <td><input type="number" class="form-control" min="0" id="ret_dmg_${ln.id}" value="0"></td>
        <td><input type="number" class="form-control" min="0" id="ret_consume_${ln.id}" value="0"></td>
        <td><input type="number" class="form-control" min="0" id="ret_empty_${ln.id}" value="0"></td>
        <td><input type="number" class="form-control" min="0" id="ret_keep_${ln.id}" value="0"></td>
      </tr>`;
    })
    .join('');
  const order = rd?.order || {};
  const warehouseSet = new Set();
  lines.forEach((ln) => {
    const label = [ln.line_brand_code, ln.line_region].filter(Boolean).join(' ');
    if (label) warehouseSet.add(label);
  });
  const returnWhHint =
    warehouseSet.size <= 1
      ? [...warehouseSet][0] || '原出库仓库'
      : `${warehouseSet.size} 个出库仓库（各行按所属仓分别入库）`;
  const projLine =
    order.link_mode === 'standalone'
      ? escapeHtml(order.purpose || '—')
      : escapeHtml(order.project_code || '—');
  body.innerHTML = `
    <div class="modal-activity-form">
      <p class="modal-activity-lead">归还数量将<strong>按各行物料的原出库仓库</strong>分别加回库存（本单涉及：${escapeHtml(returnWhHint)}）。若目标仓尚无该物料，系统会自动建档。请填写归还、丢失、损坏、消耗、空瓶回收、留给客户数量，六项合计不能超过该物料出库数量。一次性耗材（如杯盖、纸垫）请计入「消耗」。</p>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">出库单</label>
          <input class="form-control" value="#${inventoryPageState.returnOrderId}" readonly>
        </div>
        <div class="form-group">
          <label class="form-label">项目/用途</label>
          <input class="form-control" value="${projLine}" readonly>
        </div>
        <div class="form-group">
          <label class="form-label">归还入库</label>
          <input class="form-control" value="${escapeHtml(returnWhHint)}" readonly title="各行按所属出库仓库入库">
        </div>
        <div class="form-group">
          <label class="form-label">归还日期</label>
          <input type="date" class="form-control" id="invReturnDate" value="${todayDateInputValue()}">
        </div>
        <div class="form-group">
          <label class="form-label">备注</label>
          <input type="text" class="form-control" id="invReturnRemarks" placeholder="可选">
        </div>
      </div>
      <div class="table-wrapper" style="margin-top:14px;overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>物料</th><th>出库仓库</th><th>出库数</th><th>已登记</th><th>剩余可登记</th><th>归还</th><th>丢失</th><th>损坏</th><th>消耗</th><th>空瓶回收</th><th>留给客户</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="11" style="color:var(--text-muted)">无可归还明细</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
  openModal('modalInvReturn');
}

function invCancelReturnForm() {
  inventoryPageState.returnDetail = null;
  inventoryPageState.returnOrderId = null;
  closeModal();
}

async function invSubmitReturn() {
  const oid = inventoryPageState.returnOrderId;
  if (!oid) return;
  const detail = inventoryPageState.returnDetail;
  if (!detail || !Array.isArray(detail.lines)) {
    showToast('数据已过期，请重新打开归还', 'warning');
    return;
  }
  const lines = (detail.lines || []).map((ln) => {
    const qty_return = parseInt(document.getElementById(`ret_ok_${ln.id}`)?.value, 10) || 0;
    const qty_lost = parseInt(document.getElementById(`ret_lost_${ln.id}`)?.value, 10) || 0;
    const qty_damaged = parseInt(document.getElementById(`ret_dmg_${ln.id}`)?.value, 10) || 0;
    const qty_consumed = parseInt(document.getElementById(`ret_consume_${ln.id}`)?.value, 10) || 0;
    const qty_empty_recovered = parseInt(document.getElementById(`ret_empty_${ln.id}`)?.value, 10) || 0;
    const qty_customer_keep = parseInt(document.getElementById(`ret_keep_${ln.id}`)?.value, 10) || 0;
    const max = parseInt(document.getElementById(`ret_max_${ln.id}`)?.value, 10) || 0;
    const entered = qty_return + qty_lost + qty_damaged + qty_consumed + qty_empty_recovered + qty_customer_keep;
    if (entered > max) {
      throw new Error(`「${ln.item_name || `明细#${ln.id}`}」本次登记 ${entered}，超过剩余可登记 ${max}`);
    }
    return {
      outbound_line_id: ln.id,
      qty_return,
      qty_lost,
      qty_damaged,
      qty_consumed,
      qty_empty_recovered,
      qty_customer_keep,
    };
  });
  const body = {
    return_date: document.getElementById('invReturnDate')?.value || todayDateInputValue(),
    remarks: document.getElementById('invReturnRemarks')?.value || null,
    lines,
  };
  try {
    const detail = await api('POST', `/inventory/outbound/${oid}/returns`, body);
    const rem = Number(detail?.order?.qty_unaccounted) || 0;
    const pending = Array.isArray(detail?.order?.pending_return_lines) ? detail.order.pending_return_lines : [];
    if (detail?.order?.status === 'closed') {
      showToast('归还已登记，该出库单已全部结清', 'success');
    } else if (rem > 0) {
      const lineHint =
        pending.length === 1
          ? `「${pending[0].item_name}」尚有 ${pending[0].remaining} 件未登记`
          : `尚有 ${rem} 件未登记（${pending.length} 个物料行）`;
      showToast(`归还已登记。${lineHint}，#${oid} 仍保留在待入库`, 'warning');
    } else {
      showToast('归还已登记', 'success');
    }
    inventoryPageState.returnOrderId = null;
    inventoryPageState.returnDetail = null;
    closeModal();
    updateBadges();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '失败', 'error');
  }
}

/** 出库单 PDF 接口地址；?download=1 时服务端返回 attachment（仅用于按需下载，预览用 fetch+blob，避免误触发下载） */
