async function showWarehouseQuoteModal() {
  await showWarehouseModal(null, { quote: true });
}

function updateWarQuotedPrice() {
  if (warehouseFormMode !== 'period_quote') return;
  const elQ = document.getElementById('warQty');
  const elU = document.getElementById('warUnitPrice');
  const elP = document.getElementById('warQuotedPrice');
  if (!elQ || !elU || !elP) return;
  const qn = Math.max(0, parseInt(elQ.value, 10) || 0);
  const un = Math.max(0, roundMoney2(elU.value));
  const total = roundMoney2(qn * un);
  elP.value = total.toFixed(2);
}

function toggleWarNoActualCost() {
  const cb = document.getElementById('warNoActualCost');
  const input = document.getElementById('warActualCost');
  if (!cb || !input) return;
  const checked = !!cb.checked;
  input.disabled = checked;
  input.placeholder = checked ? '无成本' : '0.00';
  if (checked) input.value = '';
}

async function fillWarehouseYearFrameSelect(preferredFrameId) {
  const sel = document.getElementById('warYearFrameId');
  if (!sel) return;
  const frames = await api('GET', '/year-frames');
  sel.innerHTML = frames.map(f => {
    const label = yearFrameDisplayLabel(f);
    return `<option value="${f.id}">${escapeHtml(label || String(f.id))}</option>`;
  }).join('');
  const want = preferredFrameId || currentYearFrameId;
  if (want && frames.some(f => String(f.id) === String(want))) {
    sel.value = String(want);
  } else if (frames[0]) {
    sel.value = String(frames[0].id);
  }
}

async function showWarehouseModal(id = null, opts = {}) {
  const wid = id != null && id !== '' ? Number(id) : NaN;
  const editing = Number.isFinite(wid);
  const quoteNew = !editing && opts.quote === true;

  document.getElementById('warModalTitle').textContent = quoteNew
    ? '新建仓储报价'
    : editing
      ? '编辑仓储记录'
      : '新建仓储记录';
  document.getElementById('warId').value = editing ? String(wid) : '';
  ['warMonth', 'warQty', 'warUnitPrice', 'warQuotedPrice', 'warActualCost', 'warRemarks', 'warProject', 'warAllocationNote', 'warPeriodStart', 'warPeriodEnd'].forEach((fid) => {
    const el = document.getElementById(fid);
    if (el) el.value = '';
  });
  const reg = document.getElementById('warRegion');
  if (reg) reg.value = '';
  const brandEl = document.getElementById('warBrand');
  if (brandEl) brandEl.value = 'PHD';
  const noCostCb = document.getElementById('warNoActualCost');
  const warMergedCb = document.getElementById('warMergedIntoActivity');
  if (noCostCb) noCostCb.checked = false;
  if (warMergedCb) warMergedCb.checked = false;
  const yfWrap = document.getElementById('warYearFrameWrap');
  const yfHint = document.getElementById('warYearFrameHint');
  if (yfWrap) yfWrap.style.display = '';
  if (yfHint) yfHint.style.display = 'none';

  let preferredYf = currentYearFrameId;
  let item = null;
  if (editing) {
    try {
      item = await api('GET', `/warehouse/${wid}`);
    } catch (e) {
      item = warehouseState.data.find((w) => Number(w.id) === wid) || null;
      if (!item) showToast('加载记录失败: ' + (e.message || ''), 'error');
    }
  }

  const periodParsed = item && item.month ? parseWarehouseMonthRangeToDates(item.month) : null;
  const usePeriod = quoteNew || !!periodParsed;

  if (quoteNew) {
    applyWarehouseFormMode('period_quote');
    if (yfWrap) yfWrap.style.display = 'none';
    if (noCostCb) {
      noCostCb.checked = true;
      toggleWarNoActualCost();
    }
    const remarks = document.getElementById('warRemarks');
    if (remarks && !remarks.value) remarks.value = '仓储报价记录';
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const ps = document.getElementById('warPeriodStart');
    const pe = document.getElementById('warPeriodEnd');
    if (ps) ps.value = `${y}-${m}-01`;
    if (pe) pe.value = todayDateInputValue();
    onWarehousePeriodChange();
  } else {
    applyWarehouseFormMode(usePeriod ? 'period_quote' : 'legacy');
    toggleWarNoActualCost();
  }

  await loadLogProjectDatalist();

  if (item) {
    preferredYf = item.year_frame_id;
    const b = item.brand != null && String(item.brand).trim() !== '' ? String(item.brand).trim() : 'PHD';
    if (brandEl) brandEl.value = WAREHOUSE_BRAND_OPTIONS.includes(b) ? b : 'PHD';
    const rSel = normalizeWarehouseRegion(item.region);
    if (reg) reg.value = WAREHOUSE_REGION_OPTIONS.includes(rSel) ? rSel : '';
    if (periodParsed) {
      const ps = document.getElementById('warPeriodStart');
      const pe = document.getElementById('warPeriodEnd');
      if (ps) ps.value = periodParsed.start;
      if (pe) pe.value = periodParsed.end;
      document.getElementById('warMonth').value = '';
      onWarehousePeriodChange();
    } else {
      document.getElementById('warMonth').value = item.month || '';
    }
    document.getElementById('warQty').value = item.quantity != null && item.quantity !== '' ? item.quantity : '';
    document.getElementById('warUnitPrice').value =
      item.unit_price != null && item.unit_price !== '' ? roundMoney2(item.unit_price).toFixed(2) : '';
    document.getElementById('warQuotedPrice').value =
      item.quoted_price != null && item.quoted_price !== '' ? roundMoney2(item.quoted_price).toFixed(2) : '';
    document.getElementById('warActualCost').value =
      item.actual_cost != null && item.actual_cost !== '' ? roundMoney2(item.actual_cost).toFixed(2) : '';
    const noActual = item.no_actual_cost === true || item.no_actual_cost === 1 || String(item.no_actual_cost) === '1';
    if (noCostCb) noCostCb.checked = noActual;
    if (noActual) document.getElementById('warActualCost').value = '';
    toggleWarNoActualCost();
    document.getElementById('warRemarks').value = item.remarks || '';
    if (warMergedCb) {
      const merged = item.merged_into_activity === true || item.merged_into_activity === 1 || String(item.merged_into_activity) === '1';
      warMergedCb.checked = merged;
    }
    document.getElementById('warAllocationNote').value = item.allocation_note || '';
    const rpc =
      item.related_project_code != null && String(item.related_project_code).trim() !== ''
        ? String(item.related_project_code).trim()
        : item.activity_project_code != null && String(item.activity_project_code).trim() !== ''
          ? String(item.activity_project_code).trim()
          : item.project_code != null && String(item.project_code).trim() !== ''
            ? String(item.project_code).trim()
            : '';
    const warProjectEl = document.getElementById('warProject');
    if (warProjectEl) warProjectEl.value = rpc;
    if (periodParsed) {
      const merged =
        item.merged_into_activity === true || item.merged_into_activity === 1 || String(item.merged_into_activity) === '1';
      if (merged || (rpc && rpc.trim())) {
        const proj = document.getElementById('warProjectBlock');
        const merge = document.getElementById('warMergeBlock');
        if (proj) proj.style.display = '';
        if (merge) merge.style.display = '';
      }
    }
  }

  try {
    await fillWarehouseYearFrameSelect(preferredYf);
  } catch (e) {
    showToast('加载年框失败: ' + (e.message || ''), 'error');
  }

  if (quoteNew) {
    if (yfWrap) yfWrap.style.display = 'none';
    const sel = document.getElementById('warYearFrameId');
    if (sel && currentYearFrameId) sel.value = String(currentYearFrameId);
  }

  if (item) {
    const rSel2 = normalizeWarehouseRegion(item.region);
    if (reg) reg.value = WAREHOUSE_REGION_OPTIONS.includes(rSel2) ? rSel2 : '';
  }
  if (warehouseFormMode === 'period_quote') updateWarQuotedPrice();
  syncWarQuantityLabel();
  await loadSupplierPayeeSelect('warPayeeName', item?.payee_name || '');
  openModal('modalWarehouse');
}

async function saveWarehouse() {
  const id = document.getElementById('warId').value;
  let yearFrameId = parseInt(document.getElementById('warYearFrameId').value, 10);
  if (!yearFrameId && currentYearFrameId) yearFrameId = currentYearFrameId;
  const region = readWarRegionSelect();
  const brand = readWarBrandSelect();
  if (!yearFrameId) {
    showToast('请选择年份', 'error');
    return;
  }
  if (!brand) {
    showToast('请选择品牌：PHD / X.O / CLUB / REMY', 'error');
    return;
  }
  if (!region || !WAREHOUSE_REGION_OPTIONS.includes(region)) {
    showToast('请选择区域：东区 / 北区 / 南区', 'error');
    return;
  }
  if (warehouseFormMode === 'period_quote') updateWarQuotedPrice();
  let monthVal = null;
  let qty = 0;
  if (warehouseFormMode === 'period_quote') {
    const ps = document.getElementById('warPeriodStart')?.value || '';
    const pe = document.getElementById('warPeriodEnd')?.value || '';
    monthVal = warehouseMonthLabelFromPeriodDates(ps, pe) || null;
    qty = warehousePeriodMonthCount(ps, pe);
    if (!ps || !pe) {
      showToast('请选择账期起止日期', 'warning');
      return;
    }
    if (qty <= 0) {
      showToast('账期无效：结束日期应不早于起始日期', 'warning');
      return;
    }
  } else {
    monthVal = document.getElementById('warMonth')?.value?.trim() || null;
    qty = parseInt(document.getElementById('warQty').value, 10) || 0;
    const qtyUnit = warehouseQuantityUnit(region);
    if (qty <= 0) {
      showToast(`数量（${qtyUnit}）须大于 0`, 'error');
      return;
    }
  }
  const unitPrice = roundMoney2(document.getElementById('warUnitPrice').value);
  if (unitPrice <= 0) {
    showToast('单价须大于 0', 'error');
    return;
  }
  const projBlock = document.getElementById('warProjectBlock');
  const projHidden = projBlock && projBlock.style.display === 'none';
  const warProjectRaw = projHidden ? '' : (document.getElementById('warProject')?.value || '').replace(/^\uFEFF/, '').trim();
  if (warProjectRaw && !logisticsProjectIndex.codes.has(warProjectRaw)) {
    showToast('关联项目编号必须从活动项目编号中选择（请从下拉建议中选中）', 'error');
    return;
  }
  const mergedIntoActivity = projHidden ? false : !!document.getElementById('warMergedIntoActivity')?.checked;
  if (mergedIntoActivity && !warProjectRaw) {
    showToast('勾选计入活动成本时，必须选择关联项目编号', 'error');
    return;
  }
  const activityId = warProjectRaw ? logisticsProjectIndex.codeToId.get(warProjectRaw) : null;
  if (mergedIntoActivity && !activityId) {
    showToast('关联项目编号无效，请从下拉建议中选择', 'error');
    return;
  }
  const body = {
    year_frame_id: yearFrameId,
    month: monthVal,
    brand,
    region,
    wine_name: '',
    specifications: '',
    quantity: qty,
    unit_price: unitPrice,
    quoted_price:
      warehouseFormMode === 'period_quote'
        ? roundMoney2(document.getElementById('warQuotedPrice').value)
        : 0,
    actual_cost: document.getElementById('warNoActualCost')?.checked ? 0 : roundMoney2(document.getElementById('warActualCost').value),
    payee_name: document.getElementById('warPayeeName')?.value?.trim() || null,
    no_actual_cost: document.getElementById('warNoActualCost')?.checked ? 1 : 0,
    activity_id: activityId || null,
    merged_into_activity: mergedIntoActivity ? 1 : 0,
    allocation_note: document.getElementById('warAllocationNote')?.value?.trim() || null,
    remarks: document.getElementById('warRemarks').value,
  };
  try {
    if (id) {
      await api('PUT', `/warehouse/${id}`, body);
      showToast('已更新', 'success');
    } else {
      await api('POST', '/warehouse', body);
      showToast('已创建', 'success');
    }
    closeModal();
    await loadWarehouse();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

async function deleteWarehouse(id) {
  if (!confirm('确认删除此仓储记录？')) return;
  try {
    await api('DELETE', `/warehouse/${id}`);
    showToast('已删除', 'success');
    await loadWarehouse();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}
