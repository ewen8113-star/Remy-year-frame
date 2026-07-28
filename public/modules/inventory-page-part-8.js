function invBuildOutboundModalMarkup(warehouses, items, of, modalOpts) {
  modalOpts = modalOpts || {};
  invSeedOutboundItemMetaFromItems(inventoryPageState.warehouseId, items);
  invApplyOutboundEditLineMeta();
  const commonPreset =
    modalOpts.commonPreset != null ? modalOpts.commonPreset : inventoryPageState.outboundEditCommonPreset;
  const commonRows = invBuildCommonRowsHtml(items, commonPreset);
  const editOrderId = modalOpts.editOrderId;
  const submitLabel = editOrderId ? '保存修改' : '确认出库';
  const whButtons = `
    <div class="inv-ob-warehouse-buttons">
      ${warehouses
        .map(
          (w) => `<button type="button" class="btn btn-sm inv-ob-wh-btn ${w.id === inventoryPageState.warehouseId ? 'btn-primary' : 'btn-secondary'}" data-wh-id="${w.id}" title="brand_id=${w.brand_id || ''} ${escapeHtml(w.brand_code || '')} / ${escapeHtml(w.region || '')}" onclick="invOnModalWarehouseChange(${w.id})">${escapeHtml(invWarehouseFullLabel(w))}</button>`,
        )
        .join('')}
    </div>`;
  const linkMode = of.linkMode === 'standalone' ? 'standalone' : 'activity';
  const whKey = String(Number(inventoryPageState.warehouseId || 0) || 'global');
  const commonSearch = String((inventoryPageState.outboundCommonSearchByWarehouse || {})[whKey] || '');
  const listFlt = inventoryPageState.outboundListFilter || 'common';
  const hintMsg = String(of.hint_msg || '').trim();
  const shipDateOut = String(of.shipped_at || '').trim() || todayDateInputValue();
  const activityDateOut = String(of.activity_date || '').trim();
  const selectedPreview = invBuildSelectedOutboundPreviewHtml();
  return `
    <div class="inv-ob-modal-form">
      <input type="hidden" id="invOutboundEditOrderId" value="${editOrderId ? String(editOrderId) : ''}">
      <input type="hidden" id="invWarehouseSelect" value="${inventoryPageState.warehouseId || ''}">
      <div class="inv-ob-layout">
        <section class="inv-ob-pane inv-ob-pane-left">
          <div class="inv-ob-pane-card">
            <div class="inv-ob-wh-row">
              <h4 class="inv-ob-pane-title inv-ob-wh-title">仓库</h4>
              ${whButtons}
            </div>
            <div class="inv-ob-items-toolbar">
              <div class="inv-ob-filter-btns" role="group" aria-label="常用筛选">
                <button type="button" id="invObFilterCommon" class="btn btn-xs ${listFlt === 'common' ? 'btn-primary' : 'btn-secondary'}" onclick="invSetOutboundListFilter('common')">常用</button>
                <button type="button" id="invObFilterUncommon" class="btn btn-xs ${listFlt === 'uncommon' ? 'btn-primary' : 'btn-secondary'}" onclick="invSetOutboundListFilter('uncommon')">非常用</button>
              </div>
              <input type="text" class="form-control form-control-sm inv-ob-search-inline" id="invCommonSearch" placeholder="搜索名称/规格" value="${escapeHtml(commonSearch)}" oninput="invOnCommonSearchInput(this.value)">
            </div>
            <div class="table-wrapper inv-outbound-table-wrap inv-ob-items-table-wrap">
              <table class="data-table inv-outbound-table">
                <thead><tr><th class="inv-ob-col-select">选</th><th class="inv-ob-col-material">物料</th><th class="inv-ob-col-stock">库存</th><th class="inv-ob-col-qty">数量</th><th class="inv-ob-col-note">备注</th><th class="inv-ob-col-sort">序</th></tr></thead>
                <tbody id="invObCommonTbody">${commonRows}</tbody>
              </table>
            </div>
          </div>
        </section>

        <section class="inv-ob-pane inv-ob-pane-right">
          <div class="inv-ob-pane-card inv-ob-pane-top">
            <h4 class="inv-ob-pane-title">出库单基本信息</h4>
            <div class="inv-ob-modal-row">
              <div class="form-group inv-ob-field-short inv-ob-field-purpose">
                <label class="form-label">用途</label>
                <select class="form-control" id="invLinkMode" onchange="inventoryPageState.linkMode=this.value;inventoryPageState.outboundForm.linkMode=this.value;invToggleLinkMode()">
                  <option value="activity" ${linkMode !== 'standalone' ? 'selected' : ''}>活动用</option>
                  <option value="standalone" ${linkMode === 'standalone' ? 'selected' : ''}>非活动用</option>
                </select>
              </div>
              <div class="form-group inv-ob-field-mid inv-ob-field-project" id="invProjectWrap">
                <label class="form-label">项目编号（活动用）</label>
                <div class="inv-project-combobox">
                  <input type="text" class="form-control" id="invProjectCode" placeholder="与场次一致" autocomplete="off" value="${escapeHtml(of.project_code || '')}" onfocus="invOpenProjectSuggestionList()" onblur="invOnProjectInputBlur()" oninput="invOnProjectInput(this.value)" onkeydown="invHandleProjectInputKeydown(event)">
                  <button type="button" class="inv-project-trigger" onclick="invToggleProjectSuggestionList()" aria-label="展开项目编号建议"></button>
                  <div class="inv-project-menu" id="invProjectMenu" style="display:none"></div>
                </div>
                <span class="form-hint" id="invHintMsg" style="${hintMsg ? 'display:block;margin-top:4px' : 'display:none;margin-top:0'}">${escapeHtml(hintMsg)}</span>
              </div>
              <div class="form-group inv-ob-field-mid inv-ob-field-purpose-detail" id="invPurposeWrap" style="display:none">
                <label class="form-label">发货说明 <span class="required">*</span></label>
                <input type="text" class="form-control" id="invPurpose" placeholder="如：内部调拨/赞助寄样/办公使用" value="${escapeHtml(of.purpose || '')}">
              </div>
              <div class="form-group inv-ob-field-mid inv-ob-field-supplier">
                <label class="form-label">公司名称 <span class="required">*</span></label>
                <select class="form-control" id="invLogisticsSupplier" required onchange="invOutboundSupplierChanged()">
                  <option value="">请选择供应商</option>
                </select>
              </div>
              <div class="form-group inv-ob-field-short inv-ob-field-logistics">
                <label class="form-label">物流方式</label>
                <select class="form-control" id="invLogistics">${INV_LOGISTICS_OPTS.map((x) => `<option value="${x}" ${(of.logistics_method || INV_LOGISTICS_OPTS[0]) === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
              </div>
              <div class="form-group inv-ob-field-mid inv-ob-field-tracking">
                <label class="form-label">物流单号</label>
                <input type="text" class="form-control" id="invTrackingNo" placeholder="物流单号可后续补填" value="${escapeHtml(of.tracking_number || '')}">
              </div>
            </div>
            <div class="inv-ob-modal-row inv-ob-row-recv">
              <div class="form-group inv-ob-field-short">
                <label class="form-label">出库日期</label>
                <input type="date" class="form-control" id="invObShipDate" value="${escapeHtml(shipDateOut)}">
              </div>
              <div class="form-group inv-ob-field-short">
                <label class="form-label" title="关联活动的真实活动日期；非活动出库可留空">活动日期</label>
                <input type="date" class="form-control" id="invObActivityDate" value="${escapeHtml(activityDateOut)}" placeholder="可留空">
              </div>
              <div class="form-group inv-ob-field-short">
                <label class="form-label">收件城市</label>
                <input type="text" class="form-control" id="invRecvCity" value="${escapeHtml(of.recipient_city || '')}">
              </div>
            </div>
            <div class="inv-ob-modal-row inv-ob-row-addr">
              <div class="form-group inv-ob-field-short">
                <label class="form-label">联系人</label>
                <input type="text" class="form-control" id="invContactName" value="${escapeHtml(of.contact_name || '')}">
              </div>
              <div class="form-group inv-ob-field-short">
                <label class="form-label">联系电话</label>
                <input type="text" class="form-control" id="invContactPhone" value="${escapeHtml(of.contact_phone || '')}">
              </div>
              <div class="form-group inv-ob-field-full inv-ob-field-addr-grow">
                <label class="form-label">收件地址</label>
                <input type="text" class="form-control" id="invRecvAddr" value="${escapeHtml(of.recipient_address || '')}">
              </div>
              <div class="form-group inv-ob-smartfill-btn-wrap">
                <label class="form-label">智能填写</label>
                <button type="button" class="btn btn-secondary btn-sm" onclick="invOpenOutboundSmartFill()">智能填写</button>
              </div>
            </div>
            <div class="inv-ob-modal-row inv-ob-modal-row-full">
              <div class="form-group inv-ob-field-full">
                <label class="form-label">备注</label>
                <input type="text" class="form-control" id="invObRemarks" value="${escapeHtml(of.remarks || '')}">
              </div>
            </div>
            <div class="inv-outbound-actions inv-outbound-actions-inline">
              <button type="button" class="btn btn-primary" onclick="invSubmitOutbound()">${submitLabel}</button>
            </div>
          </div>

          <div class="inv-ob-pane-card inv-ob-pane-bottom">
            <div class="inv-ob-selected-head">
              <h4 class="inv-ob-pane-title">已选物品（只读）</h4>
              <span class="form-hint">左侧勾选并填写数量后，此处自动汇总展示</span>
            </div>
            <div id="invObSelectedPreview">${selectedPreview}</div>
          </div>
        </section>
      </div>
      <input type="hidden" id="invActivityId" value="${escapeHtml(String(of.activity_id || ''))}">
    </div>`;
}

function invRefreshSelectedPreview() {
  const el = document.getElementById('invObSelectedPreview');
  if (!el) return;
  invSaveCurrentWarehouseDraftFromModal();
  el.innerHTML = invBuildSelectedOutboundPreviewHtml();
}

function invSnapshotCommonPresetFromDom() {
  const preset = {};
  document.querySelectorAll('[data-inv-common-row]').forEach((row) => {
    const id = parseInt(row.getAttribute('data-item-id'), 10);
    if (!Number.isFinite(id)) return;
    const ck = document.getElementById(`invCommonCk_${id}`);
    const qtyEl = document.getElementById(`invCommonQty_${id}`);
    const noteEl = document.getElementById(`invCommonNote_${id}`);
    const qty = Math.max(0, parseInt(qtyEl && qtyEl.value, 10) || 0);
    preset[id] = {
      checked: !!(ck && ck.checked),
      quantity: qty,
      line_note: noteEl ? String(noteEl.value || '') : '',
    };
  });
  return preset;
}

function invSaveCurrentWarehouseDraftFromModal() {
  const whId = Number(inventoryPageState.warehouseId || 0);
  if (!whId) return;
  // NOTE:
  // 常用/非常用切换时，DOM 里只包含当前筛选下可见的行。
  // 这里必须与既有草稿合并，避免“切换筛选后之前已勾选物料被清空”。
  const prevPreset = inventoryPageState.outboundCommonByWarehouse[whId] || {};
  const domSnapshot = invSnapshotCommonPresetFromDom();
  inventoryPageState.outboundCommonByWarehouse[whId] = {
    ...prevPreset,
    ...domSnapshot,
  };
  inventoryPageState.outboundLinesByWarehouse[whId] = Array.isArray(inventoryPageState.outboundLines)
    ? inventoryPageState.outboundLines.map((x) => ({ ...x }))
    : [];
}

function invLoadWarehouseDraftToModal(warehouseId) {
  const whId = Number(warehouseId || 0);
  if (!whId) return;
  const lines = inventoryPageState.outboundLinesByWarehouse[whId];
  inventoryPageState.outboundLines = Array.isArray(lines) ? lines.map((x) => ({ ...x })) : [];
  inventoryPageState.outboundEditCommonPreset = inventoryPageState.outboundCommonByWarehouse[whId] || null;
}

async function invRefreshOutboundModalLineTables() {
  const whId = inventoryPageState.warehouseId;
  let items = [];
  if (whId) {
    try {
      items = await api('GET', `/inventory/items?inv_warehouse_id=${whId}`);
    } catch (_) {
      items = [];
    }
  }
  const whNum = Number(whId || 0);
  if (whNum > 0) {
    invSeedOutboundItemMetaFromItems(whNum, items);
    invApplyOutboundEditLineMeta();
  }
  const commonTbody = document.getElementById('invObCommonTbody');
  if (commonTbody) {
    if (inventoryPageState.editOutboundOrderId) {
      const snap = invSnapshotCommonPresetFromDom();
      inventoryPageState.outboundEditCommonPreset = {
        ...(inventoryPageState.outboundEditCommonPreset || {}),
        ...snap,
      };
    }
    const preset = inventoryPageState.editOutboundOrderId
      ? inventoryPageState.outboundEditCommonPreset
      : inventoryPageState.outboundCommonByWarehouse[Number(inventoryPageState.warehouseId)] || null;
    commonTbody.innerHTML = invBuildCommonRowsHtml(items, preset);
  }
  invRefreshSelectedPreview();
}

/** 仅重绘「其他物料」表格，避免刷新常用物料行导致勾选丢失 */
async function invRefreshOutboundExtraTbodyOnly() {
  const whId = inventoryPageState.warehouseId;
  let items = [];
  if (whId) {
    try {
      items = await api('GET', `/inventory/items?inv_warehouse_id=${whId}`);
    } catch (_) {
      items = [];
    }
  }
  const extraTbody = document.getElementById('invObExtraTbody');
  if (!extraTbody) return;
  const lines = inventoryPageState.outboundLines || [];
  extraTbody.innerHTML =
    invBuildExtraLineRowsHtml(items, lines) || '<tr><td colspan="4" style="color:var(--text-muted);font-size:13px">点击下方添加一行</td></tr>';
}

async function invOnModalWarehouseChange(warehouseId) {
  const id = parseInt(warehouseId, 10);
  if (!Number.isFinite(id)) return;
  invSaveCurrentWarehouseDraftFromModal();
  if (inventoryPageState.editOutboundOrderId && document.getElementById('invObCommonTbody')) {
    inventoryPageState.outboundEditCommonPreset = {
      ...(inventoryPageState.outboundEditCommonPreset || {}),
      ...invSnapshotCommonPresetFromDom(),
    };
  }
  inventoryPageState.warehouseId = id;
  invLoadWarehouseDraftToModal(id);
  document.querySelectorAll('.inv-ob-wh-btn').forEach((btn) => {
    const bid = parseInt(btn.getAttribute('data-wh-id') || '', 10);
    const active = Number.isFinite(bid) && bid === id;
    btn.classList.toggle('btn-primary', active);
    btn.classList.toggle('btn-secondary', !active);
  });
  await invRefreshOutboundModalLineTables();
  const hd = document.getElementById('invWarehouseSelect');
  if (hd) hd.value = String(id);
  const curSupplier = document.getElementById('invLogisticsSupplier')?.value?.trim() || '';
  if (!curSupplier) {
    await invLoadOutboundSupplierOptions('', { autoPickForWarehouse: true });
  }
}

function invSetOutboundModalTitle(isEdit) {
  const el = document.querySelector('#modalInvOutbound .modal-title');
  if (el) el.textContent = isEdit ? '编辑物品出库' : '新建物品出库';
}
