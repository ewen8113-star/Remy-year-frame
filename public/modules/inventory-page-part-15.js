function invRemoveOutboundRow(idx) {
  inventoryPageState.outboundLines.splice(idx, 1);
  if (document.getElementById('invObExtraTbody')) {
    void invRefreshOutboundExtraTbodyOnly();
  } else {
    renderInventory();
  }
}

async function invSubmitOutbound() {
  const isInlineMode = !!document.querySelector('.inv-ob-inline-shell');
  const ws = document.getElementById('invWarehouseSelect');
  const whId = ws ? parseInt(ws.value, 10) || null : inventoryPageState.warehouseId;
  if (ws && Number.isFinite(whId)) inventoryPageState.warehouseId = whId;
  invSaveCurrentWarehouseDraftFromModal();
  const lm = document.getElementById('invLinkMode')?.value === 'standalone' ? 'standalone' : 'activity';
  const shipDateRaw = (document.getElementById('invObShipDate')?.value || '').trim();
  if (!shipDateRaw) {
    showToast('请选择出库日期', 'warning');
    return;
  }
  const activityDateRaw = (document.getElementById('invObActivityDate')?.value || '').trim();
  const baseBody = {
    link_mode: lm,
    project_code: lm === 'activity' ? (document.getElementById('invProjectCode')?.value || '').trim() : null,
    purpose: lm === 'standalone' ? (document.getElementById('invPurpose')?.value || '').trim() : null,
    year_frame_id: currentYearFrameId || null,
    activity_id: document.getElementById('invActivityId')?.value || null,
    shipped_at: shipDateRaw,
    activity_date: activityDateRaw || null,
    recipient_city: document.getElementById('invRecvCity')?.value || null,
    recipient_address: document.getElementById('invRecvAddr')?.value || null,
    contact_name: document.getElementById('invContactName')?.value || null,
    contact_phone: document.getElementById('invContactPhone')?.value || null,
    logistics_supplier: document.getElementById('invLogisticsSupplier')?.value?.trim() || null,
    logistics_method: document.getElementById('invLogistics')?.value || null,
    tracking_number: (document.getElementById('invTrackingNo')?.value || '').trim() || null,
    remarks: document.getElementById('invObRemarks')?.value || null,
  };
  if (lm === 'activity' && !baseBody.project_code) {
    showToast('请填写项目编号', 'warning');
    return;
  }
  if (lm === 'standalone' && !baseBody.purpose) {
    showToast('请填写非活动信息', 'warning');
    return;
  }
  if (!String(baseBody.logistics_supplier || '').trim()) {
    showToast('请选择物流公司（供应商）', 'warning');
    return;
  }
  const editHidden = document.getElementById('invOutboundEditOrderId');
  const editIdRaw = editHidden && editHidden.value ? editHidden.value : inventoryPageState.editOutboundOrderId;
  const editId = parseInt(editIdRaw, 10);
  const whIds = new Set();
  Object.keys(inventoryPageState.outboundCommonByWarehouse || {}).forEach((k) => {
    const id = parseInt(k, 10);
    if (Number.isFinite(id)) whIds.add(id);
  });
  Object.keys(inventoryPageState.outboundLinesByWarehouse || {}).forEach((k) => {
    const id = parseInt(k, 10);
    if (Number.isFinite(id)) whIds.add(id);
  });
  if (Number.isFinite(whId)) whIds.add(whId);
  const mergedAllLines = [];
  for (const wid of whIds) {
    const commonPreset = inventoryPageState.outboundCommonByWarehouse[wid] || {};
    const fromCommon = Object.entries(commonPreset)
      .map(([itemId, p]) => ({
        item_id: parseInt(itemId, 10),
        quantity: p && p.checked ? Math.max(0, parseInt(p.quantity, 10) || 0) : 0,
        line_note: p && p.line_note ? String(p.line_note) : null,
      }))
      .filter((x) => Number.isFinite(x.item_id) && x.quantity > 0);
    const extra = (inventoryPageState.outboundLinesByWarehouse[wid] || [])
      .filter((l) => l.item_id && l.quantity > 0)
      .map((l) => ({
        item_id: parseInt(l.item_id, 10),
        quantity: parseInt(l.quantity, 10),
        line_note: l.line_note || null,
      }));
    mergedAllLines.push(...fromCommon, ...extra);
  }
  const combinedLines = invMergeOutboundLines(mergedAllLines);
  if (Number.isFinite(editId)) {
    const lines = combinedLines;
    if (!whId || !lines.length) {
      showToast('请至少在当前仓库填写出库明细', 'warning');
      return;
    }
    const one = { ...baseBody, inv_warehouse_id: whId, lines };
    try {
      await api('PUT', `/inventory/outbound/${editId}`, one);
      showToast('已保存', 'success');
      inventoryPageState.editOutboundOrderId = null;
      inventoryPageState.outboundEditCommonPreset = null;
      inventoryPageState.outboundLines = [];
      inventoryPageState.outboundLinesByWarehouse = {};
      inventoryPageState.outboundCommonByWarehouse = {};
      inventoryPageState.outboundItemMetaByWarehouse = {};
      inventoryPageState.outboundEditLineMeta = {};
      inventoryPageState.outboundForm = {
        linkMode: 'activity',
        project_code: '',
        purpose: '',
        activity_id: '',
        shipped_at: '',
        activity_date: '',
        recipient_city: '',
        recipient_address: '',
        contact_name: '',
        contact_phone: '',
        logistics_supplier: '',
        logistics_method: INV_LOGISTICS_OPTS[0],
        tracking_number: '',
        remarks: '',
        hint_msg: '',
      };
      inventoryPageState.linkMode = 'activity';
      inventoryPageState.tab = 'outbound';
      if (!isInlineMode) closeModal();
      inventoryPageState.outboundInlineOpen = false;
      invSetOutboundModalTitle(false);
      document.getElementById('invOutboundModalBody') && (document.getElementById('invOutboundModalBody').innerHTML = '');
      updateBadges();
      await renderInventory();
    } catch (e) {
      showToast(e.message || '出库失败', 'error');
    }
    return;
  }
  if (!combinedLines.length) {
    showToast('请至少在一个仓库勾选/填写出库明细', 'warning');
    return;
  }
  try {
    const primaryWhId =
      Number.isFinite(whId) && whId > 0 ? whId : Number.parseInt([...whIds][0], 10) || null;
    const created = await api('POST', '/inventory/outbound', {
      ...baseBody,
      inv_warehouse_id: primaryWhId,
      lines: combinedLines,
    });
    if (lm === 'standalone') {
      const ord = created && created.order ? created.order : null;
      if (ord) {
        const whMap = new Map((inventoryPageState.outboundWarehousesCache || []).map((w) => [Number(w.id), w]));
        const { unit, express } = invOutboundMethodToLogisticsUnitExpress(baseBody.logistics_method);
        let sampleWh = null;
        for (const line of created.lines || []) {
          const c = whMap.get(Number(line.inv_warehouse_id));
          if (c) {
            sampleWh = c;
            break;
          }
        }
        const cn = String(baseBody.contact_name || '').trim();
        const cp = String(baseBody.contact_phone || '').trim();
        const address = [baseBody.recipient_city, baseBody.recipient_address].filter(Boolean).join(' ').trim();
        const senderHint = sampleWh ? `${String(sampleWh.region || '').trim() || '仓库'}`.replace(/仓$/, '') + '仓发运' : '';
        const purposeLine = [baseBody.purpose, baseBody.remarks].filter(Boolean).join('；').trim();
        const addrLine = buildLogisticsAddrMetaV2('', '', senderHint, cn, cp, address, purposeLine).replace(/\n$/, '');
        const remarkPieces = [];
        if (addrLine) remarkPieces.push(addrLine);
        remarkPieces.push(`[INV-OB:${ord.id}]`);
        try {
          await api('POST', '/logistics', {
            year_frame_id: currentYearFrameId || null,
            activity_id: null,
            merged_into_activity: 0,
            allocation_note: null,
            logistics_company: unit,
            brand: sampleWh?.brand_code || 'PHD',
            express_company: express,
            tracking_number: baseBody.tracking_number || null,
            origin_city: senderHint || null,
            destination_city: baseBody.recipient_city || null,
            shipping_date: (baseBody.shipped_at || '').trim() || todayDateInputValue(),
            shipping_fee: 0,
            handling_fee: 0,
            fee: 0,
            payee_name: String(baseBody.logistics_supplier || '').trim() || express || '物流公司',
            payment_status: 'unpaid',
            related_project_code: null,
            remarks: remarkPieces.join('\n'),
            special_car: 0,
            monthly_settlement: 0,
          });
        } catch (_) {
          showToast('出库已完成，但物流成本记录创建失败，请在物流模块手动补录', 'warning');
        }
      }
    }
    showToast('出库成功', 'success');
    inventoryPageState.editOutboundOrderId = null;
    inventoryPageState.outboundEditCommonPreset = null;
    inventoryPageState.outboundLines = [];
    inventoryPageState.outboundLinesByWarehouse = {};
    inventoryPageState.outboundCommonByWarehouse = {};
    inventoryPageState.outboundItemMetaByWarehouse = {};
    inventoryPageState.outboundEditLineMeta = {};
    inventoryPageState.outboundForm = {
      linkMode: 'activity',
      project_code: '',
      purpose: '',
      activity_id: '',
      shipped_at: '',
      activity_date: '',
      recipient_city: '',
      recipient_address: '',
      contact_name: '',
      contact_phone: '',
      logistics_supplier: '',
      logistics_method: INV_LOGISTICS_OPTS[0],
      tracking_number: '',
      remarks: '',
      hint_msg: '',
    };
    inventoryPageState.linkMode = 'activity';
    inventoryPageState.tab = 'outbound';
    if (!isInlineMode) closeModal();
    inventoryPageState.outboundInlineOpen = false;
    invSetOutboundModalTitle(false);
    document.getElementById('invOutboundModalBody') && (document.getElementById('invOutboundModalBody').innerHTML = '');
    updateBadges();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '出库失败', 'error');
  }
}

/** 物资物料图片：仅上传，URL 存隐藏 textarea；支持追加 / 替换 */
let _invImgUpload = { scope: 'new', action: 'append', index: null };

function invItemImageUrlsRead(scope) {
  const id = scope === 'edit' ? 'invEditItemImages' : 'invItemImages';
  const el = document.getElementById(id);
  return (el && el.value ? el.value : '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function invItemImageUrlsWrite(scope, urls) {
  const id = scope === 'edit' ? 'invEditItemImages' : 'invItemImages';
  const el = document.getElementById(id);
  if (el) el.value = urls.join('\n');
}

function invRenderItemImagePreview(scope) {
  const wrapId = scope === 'edit' ? 'invEditItemImagePreview' : 'invItemImagePreview';
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const urls = invItemImageUrlsRead(scope);
  if (!urls.length) {
    wrap.innerHTML =
      scope === 'edit'
        ? '<span class="form-hint" style="font-size:12px;color:var(--text-muted)">暂无图片</span>'
        : '<span class="form-hint" style="font-size:12px">暂无图片，可添加多张</span>';
    return;
  }
  wrap.innerHTML = urls
    .map((url, i) => {
      const safe = escapeHtml(url);
      return `<div class="inv-img-tile">
        <div class="inv-img-tile-inner">
          <img src="${safe}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div class="inv-img-tile-actions">
            <button type="button" class="btn btn-xs btn-secondary" onclick="invQueueItemImageUpload('${scope}','replace',${i})">替换</button>
            <button type="button" class="btn btn-xs btn-ghost" style="color:var(--danger)" onclick="invRemoveItemImageAt('${scope}',${i})">删除</button>
          </div>
        </div>
      </div>`;
    })
    .join('');
}
