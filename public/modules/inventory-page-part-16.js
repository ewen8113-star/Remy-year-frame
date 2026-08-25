function invQueueItemImageUpload(scope, action, index) {
  _invImgUpload = {
    scope,
    action: action === 'replace' ? 'replace' : 'append',
    index: index == null || index === '' ? null : Number(index),
  };
  const fid = scope === 'edit' ? 'invEditItemImageFile' : 'invItemImageFile';
  document.getElementById(fid)?.click();
}

function invRemoveItemImageAt(scope, index) {
  const urls = invItemImageUrlsRead(scope);
  const i = parseInt(index, 10);
  if (!Number.isFinite(i) || i < 0 || i >= urls.length) return;
  urls.splice(i, 1);
  invItemImageUrlsWrite(scope, urls);
  invRenderItemImagePreview(scope);
}

async function invHandleItemImageFile(e, scope) {
  const f = e.target?.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (_invImgUpload.scope !== scope) {
    _invImgUpload = { scope, action: 'append', index: null };
  }
  try {
    const url = await apiInventoryUpload(f);
    let urls = invItemImageUrlsRead(scope);
    const { action, index } = _invImgUpload;
    if (action === 'replace' && Number.isFinite(index) && index >= 0 && index < urls.length) {
      urls[index] = url;
    } else {
      urls.push(url);
    }
    invItemImageUrlsWrite(scope, urls);
    invRenderItemImagePreview(scope);
    showToast(action === 'replace' ? '已替换图片' : '图片已添加', 'success');
  } catch (err) {
    showToast(err.message || '上传失败', 'error');
  }
  _invImgUpload = { scope, action: 'append', index: null };
}

function invCancelEditItem() {
  inventoryPageState.itemModalMode = null;
  const body = document.getElementById('invItemEditModalBody');
  if (body) body.innerHTML = '';
  if (activeModal === 'modalInvItemEdit') {
    closeModal();
  }
}

/** 留空表示 null（沿用归还汇总或未设预警）；非法输入则抛错 */
function invOptionalNonNegIntOrNullInput(elId, label) {
  const el = document.getElementById(elId);
  if (!el) return null;
  const s = String(el.value ?? '').trim();
  if (s === '') return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label}须为非负整数或留空`);
  }
  return n;
}

/**
 * 与「归还登记汇总」相同则不写入覆盖列（NULL）；不同则写入（含 0）。
 * 留空（parsed=null）表示取消手工覆盖，仍按归还汇总。
 */
function invMergeStatOverride(parsed, aggFromReturns) {
  if (parsed === null) return null;
  const a = Number.isFinite(aggFromReturns) ? Math.trunc(aggFromReturns) : 0;
  if (parsed === a) return null;
  return parsed;
}

function invItemModalFormHtml(opts) {
  const { mode, it } = opts;
  const urls = it && Array.isArray(it.image_urls) ? it.image_urls.join('\n') : '';
  const common = it && invItemIsCommon(it);
  const aggDmg =
    it && it.aggregated_total_damaged != null ? invStatQty(it.aggregated_total_damaged) : it ? invStatQty(it.total_damaged) : 0;
  const aggLost =
    it && it.aggregated_total_lost != null ? invStatQty(it.aggregated_total_lost) : it ? invStatQty(it.total_lost) : 0;
  /** 与列表/详情一致：已合并覆盖后的展示值 */
  const effDmg = it ? invStatQty(it.total_damaged) : 0;
  const effLost = it ? invStatQty(it.total_lost) : 0;
  const dmgVal = mode === 'edit' ? String(effDmg) : '';
  const lostVal = mode === 'edit' ? String(effLost) : '';
  const statRow =
    mode === 'edit'
      ? `
      <div class="inv-item-edit-stat-row">
        <input type="hidden" id="invAggDamaged" value="${aggDmg}">
        <input type="hidden" id="invAggLost" value="${aggLost}">
        <div class="form-group">
          <label class="form-label">损坏（累计）</label>
          <input type="number" class="form-control" id="invEditItemDamagedOverride" min="0" step="1" value="${escapeHtml(
            dmgVal
          )}" placeholder="归还汇总 ${aggDmg}" title="与归还汇总一致可不存覆盖；填 0 表示强制为 0；整格清空表示仍按归还汇总">
        </div>
        <div class="form-group">
          <label class="form-label">丢失（累计）</label>
          <input type="number" class="form-control" id="invEditItemLostOverride" min="0" step="1" value="${escapeHtml(
            lostVal
          )}" placeholder="归还汇总 ${aggLost}" title="与归还汇总一致可不存覆盖；填 0 表示强制为 0；整格清空表示仍按归还汇总">
        </div>
      </div>`
      : '';
  const idVal = it && it.id != null ? String(it.id) : '';
  const nameVal = it && it.name != null ? escapeHtml(it.name) : '';
  const dimVal = it && it.dimensions != null ? escapeHtml(it.dimensions) : '';
  const qtyVal = it && it.quantity_on_hand != null ? Number(it.quantity_on_hand) || 0 : 0;
  const descVal = it && it.description != null ? escapeHtml(it.description) : '';
  const alertVal =
    it && it.alert_below != null && it.alert_below !== '' ? String(Math.max(0, parseInt(it.alert_below, 10) || 0)) : '';
  const isWine = it && invItemIsWineTagged(it);
  const wineLblVal = it && it.wine_label != null ? escapeHtml(String(it.wine_label)) : '';
  return `
    <div class="inv-item-modal-form">
      <input type="hidden" id="invEditItemId" value="${escapeHtml(idVal)}">
      <div class="form-group">
        <label class="form-label">物品名称 <span class="required">*</span></label>
        <input class="form-control" id="invEditItemName" value="${nameVal}">
      </div>
      <div class="form-group inv-item-edit-wine-row">
        <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0;font-weight:500">
          <input type="checkbox" id="invEditItemIsWine" ${isWine ? 'checked' : ''} onchange="invToggleWineLabelField()">
          <span>参与用酒统计（酒类标签）</span>
        </label>
        <input class="form-control" id="invEditItemWineLabel" value="${wineLblVal}" placeholder="统计归并名，如 人头马 CLUB 700ml" style="margin-top:8px;${isWine ? '' : 'display:none'}">
        <p class="form-hint" style="margin:6px 0 0">勾选后按此名称汇总到「用酒统计」，避免名称/规格写法不一致导致统计错误。</p>
      </div>
      ${statRow}
      <div class="inv-item-edit-core-row">
        <div class="form-group">
          <label class="form-label">规格</label>
          <input class="form-control" id="invEditItemDim" placeholder="如 100×50×30 cm" value="${dimVal}">
        </div>
        <div class="form-group">
          <label class="form-label">库存</label>
          <input type="number" class="form-control" id="invEditItemQty" min="0" step="1" value="${qtyVal}">
        </div>
        <div class="form-group">
          <label class="form-label">库存预警线</label>
          <input type="number" class="form-control" id="invEditItemAlertBelow" min="0" step="1" value="${escapeHtml(
            alertVal
          )}" placeholder="低于此数量时标黄提示，可留空">
        </div>
      </div>
      <div class="form-group inv-item-edit-common-row">
        <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0;font-weight:500">
          <input type="checkbox" id="invEditItemIsCommon" ${common ? 'checked' : ''}>
          <span>常用物料</span>
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">备注</label>
        <textarea class="form-control" id="invEditItemDesc" rows="2">${descVal}</textarea>
      </div>
      <div class="form-group inv-item-edit-images-block">
        <div id="invEditItemImagePreview" class="inv-item-images-preview"></div>
        <button type="button" class="btn btn-secondary inv-item-add-img-btn" onclick="invQueueItemImageUpload('edit','append')">添加图片</button>
        <input type="file" id="invEditItemImageFile" accept="image/*" style="display:none" onchange="invHandleItemImageFile(event,'edit')">
        <textarea id="invEditItemImages" style="display:none" aria-hidden="true">${escapeHtml(urls)}</textarea>
      </div>
      <div class="inv-item-edit-save-row">
        <button type="button" class="btn btn-primary inv-item-save-btn" id="invItemSaveBtn" onclick="invSaveEditItem()">${mode === 'new' ? '保存' : '保存修改'}</button>
        <button type="button" class="btn btn-secondary" onclick="invCancelEditItem()">取消</button>
      </div>
    </div>`;
}

function invToggleWineLabelField() {
  const ck = document.getElementById('invEditItemIsWine');
  const inp = document.getElementById('invEditItemWineLabel');
  if (!inp) return;
  inp.style.display = ck && ck.checked ? '' : 'none';
}

async function invOpenEditItem(itemId) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可编辑库存主数据', 'warning');
    return;
  }
  const body = document.getElementById('invItemEditModalBody');
  if (!body) return;
  let it;
  try {
    it = await api('GET', `/inventory/items/${itemId}`);
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
    return;
  }
  if (inventoryPageState.warehouseId && Number(it.inv_warehouse_id) !== Number(inventoryPageState.warehouseId)) {
    showToast('该物品不属于当前所选仓库', 'warning');
    return;
  }
  inventoryPageState.itemModalMode = 'edit';
  const mt = document.getElementById('invItemModalTitle');
  if (mt) mt.textContent = '编辑物品';
  body.innerHTML = invItemModalFormHtml({ mode: 'edit', it });
  invRenderItemImagePreview('edit');
  openModal('modalInvItemEdit');
  renderLucideIcons();
}

// 物料入库弹窗状态
let invInboundState = {
  warehouseId: null,
  warehouses: [],
  items: [],
  rows: [{ itemId: null, itemName: '', qty: 1 }],
};

async function invOpenInboundModal() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可操作物料入库', 'warning');
    return;
  }
  const submitBtn = document.getElementById('invInboundSubmitBtn');
  if (submitBtn) submitBtn.disabled = false;
  const whId = Number(inventoryPageState.warehouseId || 0);
  if (!whId) {
    showToast('请先点击仓库卡片', 'warning');
    return;
  }
  const body = document.getElementById('modalInvInboundBody');
  if (!body) return;
  invInboundState.rows = [{ itemId: null, itemName: '', qty: 1 }];
  body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">加载中...</div>';
  openModal('modalInvInbound');
  try {
    const [warehouses, items] = await Promise.all([
      api('GET', '/inventory/warehouses'),
      api('GET', `/inventory/items?inv_warehouse_id=${whId}`),
    ]);
    invInboundState.warehouseId = whId;
    invInboundState.warehouses = Array.isArray(warehouses) ? warehouses : [];
    invInboundState.items = Array.isArray(items) ? items : [];
    invRenderInboundModal();
  } catch (e) {
    body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}
