async function showLogisticsModal(id = null) {
  document.getElementById('logModalTitle').textContent = id ? '编辑物流记录' : '新建物流记录';
  document.getElementById('logId').value = id || '';
  [
    'logTrack',
    'logBrand',
    'logDate',
    'logShippingFee',
    'logHandlingFee',
    'logReturnDate',
    'logReturnShippingFee',
    'logReturnHandlingFee',
    'logPurpose',
    'logShipName',
    'logShipPhone',
    'logShipAddr',
    'logRecvName',
    'logRecvPhone',
    'logRecvAddr',
  ].forEach((f) => {
    const el = document.getElementById(f);
    if (el) el.value = '';
  });
  const payeeSel = document.getElementById('logPayeeSelect');
  if (payeeSel) payeeSel.innerHTML = '<option value="">请选择供应商</option>';
  logisticsFeePartsChanged();
  fillLogisticsUnitSelect('快递');
  onLogisticsUnitChange();
  document.getElementById('logBrand').value = 'PHD';
  document.getElementById('logDate').value = todayDateInputValue();
  await loadLogPayeeSupplierSelect('');

  const nid = id != null && id !== '' ? Number(id) : NaN;
  if (Number.isFinite(nid)) {
    let item = null;
    try {
      item = await api('GET', `/logistics/${nid}`);
    } catch (e) {
      item = logisticsState.data.find((l) => Number(l.id) === nid) || null;
    }
    if (item) {
      const unit = normalizeLogisticsUnitFromRow(item);
      fillLogisticsUnitSelect(unit);
      onLogisticsUnitChange();
      const method = normalizeLogisticsMethodFromRow(item, unit);
      const mSel = document.getElementById('logMethod');
      if (mSel && [...mSel.options].some((o) => o.value === method)) mSel.value = method;
      document.getElementById('logTrack').value = item.tracking_number || '';
      document.getElementById('logBrand').value = ['PHD', 'X.O', 'CLUB', 'REMY'].includes(item.brand) ? item.brand : 'PHD';
      if (item.shipping_date) document.getElementById('logDate').value = toDateInputValue(item.shipping_date);
      const feeParts = logisticsFeeFieldsFromRow(item);
      document.getElementById('logShippingFee').value =
        feeParts.shipping > 0 ? feeParts.shipping.toFixed(2) : '';
      document.getElementById('logHandlingFee').value =
        feeParts.handling > 0 ? feeParts.handling.toFixed(2) : '';
      document.getElementById('logReturnDate').value = item.return_date ? toDateInputValue(item.return_date) : '';
      document.getElementById('logReturnShippingFee').value =
        feeParts.returnShipping > 0 ? feeParts.returnShipping.toFixed(2) : '';
      document.getElementById('logReturnHandlingFee').value =
        feeParts.returnHandling > 0 ? feeParts.returnHandling.toFixed(2) : '';
      logisticsFeePartsChanged();
      await loadLogPayeeSupplierSelect(item.payee_name || '');
      const addr = parseLogisticsAddrMeta(item.remarks || '');
      document.getElementById('logPurpose').value = addr.purpose || '';
      const hasDetail =
        addr.shipName ||
        addr.shipPhone ||
        addr.shipAddr ||
        addr.recvName ||
        addr.recvPhone ||
        addr.recvAddr;
      if (hasDetail) {
        document.getElementById('logShipName').value = addr.shipName || '';
        document.getElementById('logShipPhone').value = addr.shipPhone || '';
        document.getElementById('logShipAddr').value = addr.shipAddr || '';
        document.getElementById('logRecvName').value = addr.recvName || '';
        document.getElementById('logRecvPhone').value = addr.recvPhone || '';
        document.getElementById('logRecvAddr').value = addr.recvAddr || '';
      } else if (addr.sender || addr.recipient || addr.address) {
        document.getElementById('logShipName').value = addr.sender || '';
        document.getElementById('logRecvName').value = addr.recipient || '';
        document.getElementById('logRecvAddr').value = addr.address || '';
      } else {
        document.getElementById('logShipName').value = item.origin_city || '';
        document.getElementById('logRecvName').value = item.destination_city || '';
      }
    }
  }
  openModal('modalLogistics');
}

/** 兼容旧 HTML 引用；新表单已移除专车/月结 */
function toggleLogSpecialCar() {}

async function saveLogistics() {
  const id = document.getElementById('logId').value;
  const unit = document.getElementById('logUnit')?.value || '';
  const method = document.getElementById('logMethod')?.value || '';
  if (!LOGISTICS_UNITS.includes(unit)) {
    showToast('请选择物流单位', 'warning');
    return;
  }
  if (!method) {
    showToast('请选择物流方式', 'warning');
    return;
  }
  const logisticsBrand = document.getElementById('logBrand').value;
  const shipDate = document.getElementById('logDate').value || '';
  if (!shipDate) {
    showToast('请选择发货日期', 'warning');
    return;
  }
  const shippingFee = parseLogisticsFeePartInput('logShippingFee');
  const handlingFee = parseLogisticsFeePartInput('logHandlingFee');
  const returnShippingFee = parseLogisticsFeePartInput('logReturnShippingFee');
  const returnHandlingFee = parseLogisticsFeePartInput('logReturnHandlingFee');
  const returnDate = document.getElementById('logReturnDate')?.value?.trim() || null;
  const fee = roundMoney2(shippingFee + handlingFee + returnShippingFee + returnHandlingFee);
  if (shippingFee < 0 || handlingFee < 0 || returnShippingFee < 0 || returnHandlingFee < 0) {
    showToast('运费与操作费不能为负数', 'warning');
    return;
  }
  const payee = document.getElementById('logPayeeSelect')?.value?.trim() || '';
  if (!payee) {
    showToast('请选择收款方（供应商）', 'warning');
    return;
  }
  const shipName = document.getElementById('logShipName')?.value?.trim() || '';
  const shipPhone = document.getElementById('logShipPhone')?.value?.trim() || '';
  const shipAddr = document.getElementById('logShipAddr')?.value?.trim() || '';
  const recvName = document.getElementById('logRecvName')?.value?.trim() || '';
  const recvPhone = document.getElementById('logRecvPhone')?.value?.trim() || '';
  const recvAddr = document.getElementById('logRecvAddr')?.value?.trim() || '';
  const purpose = document.getElementById('logPurpose')?.value?.trim() || '';
  const originLine = [shipName, shipPhone].filter(Boolean).join(' ');
  const destLine = [recvName, recvPhone].filter(Boolean).join(' ');
  let invSuffix = '';
  let existingTail = '';
  if (id) {
    let prev = null;
    try {
      prev = await api('GET', `/logistics/${id}`);
    } catch (_) {
      prev = logisticsState.data.find((l) => String(l.id) === String(id)) || null;
    }
    if (prev && prev.remarks) {
      invSuffix = preserveInvObSuffix(prev.remarks);
      existingTail = String(prev.remarks || '')
        .replace(/^\[LOG_ADDR\][^\n]*\n?/, '')
        .replace(/\s*\[INV-OB:\d+\][^\n]*\s*$/g, '')
        .trim();
    }
  }
  const addrLine = buildLogisticsAddrMetaV2(shipName, shipPhone, shipAddr, recvName, recvPhone, recvAddr, purpose).replace(
    /\n$/,
    '',
  );
  const pieces = [];
  if (addrLine) pieces.push(addrLine);
  if (existingTail) pieces.push(existingTail);
  if (invSuffix) pieces.push(invSuffix);
  const remarksFinal = pieces.length ? pieces.join('\n') : null;

  const trackingNumber = document.getElementById('logTrack').value?.trim() || null;
  const body = {
    year_frame_id: currentYearFrameId,
    logistics_company: unit,
    brand: logisticsBrand,
    express_company: method,
    tracking_number: trackingNumber,
    special_car: 0,
    monthly_settlement: 0,
    settlement_month: null,
    origin_city: originLine || null,
    destination_city: destLine || null,
    shipping_date: shipDate || null,
    shipping_fee: shippingFee,
    handling_fee: handlingFee,
    return_date: returnDate,
    return_shipping_fee: returnShippingFee,
    return_handling_fee: returnHandlingFee,
    fee,
    payee_name: payee,
    related_project_code: null,
    activity_id: null,
    merged_into_activity: 0,
    allocation_note: null,
    remarks: remarksFinal,
  };
  try {
    if (id) {
      await api('PUT', `/logistics/${id}`, body);
      showToast('已更新', 'success');
    } else {
      await api('POST', '/logistics', body);
      showToast('已创建', 'success');
    }
    closeModal();
    await loadLogistics();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

async function deleteLogistics(id) {
  if (!confirm('确认删除此物流记录？')) return;
  try {
    await api('DELETE', `/logistics/${id}`);
    showToast('已删除', 'success');
    loadLogistics();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}
