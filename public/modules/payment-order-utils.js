/* 付款单筛选、选择和说明展示辅助函数。 */

function poReadFilterValues() {
  const out = {};
  ['payee', 'brand', 'sourceType', 'projectCode', 'expenseYm', 'dateFrom', 'dateTo'].forEach((id) => {
    const element = document.getElementById(`poFilter_${id}`);
    out[id] = element ? (element.value?.trim() || '') : (paymentOrderState.filters?.[id] || '');
  });
  paymentOrderState.filters = out;
  return out;
}

function poFilterEnter(event) {
  if (event && event.key === 'Enter') {
    event.preventDefault();
    paymentOrderLoadCandidates();
  }
}

function poQuickFilter(sourceType) {
  paymentOrderState.filters = paymentOrderState.filters || {};
  paymentOrderState.filters.sourceType = sourceType || '';
  const element = document.getElementById('poFilter_sourceType');
  if (element) element.value = sourceType || '';
  paymentOrderLoadCandidates();
}

function poClearFilters() {
  paymentOrderState.filters = {};
  paymentOrderState.selectedKeys = new Set();
  paymentOrderState.previewRows = [];
  paymentOrderLoadCandidates();
}

function paymentOrderKey(row) {
  if (row?.candidate_key) return String(row.candidate_key);
  if (row?.source_type === 'reimbursement' && Number.isFinite(Number(row.line_index))) {
    return `reimbursement:${row.source_id}:line:${row.line_index}`;
  }
  return `${row.source_type}:${row.source_id}`;
}

function paymentOrderSelectedRows() {
  return (paymentOrderState.candidates || []).filter(
    (row) => paymentOrderState.selectedKeys.has(paymentOrderKey(row))
  );
}

function paymentOrderDescriptionText(row) {
  if (row?.source_type) return paymentOrderItemDescriptionText(row);
  const text = String(row?.description || '').trim();
  const markerIndex = text.indexOf(REIMB_DETAIL_META_MARKER);
  return markerIndex >= 0 ? text.slice(0, markerIndex).trim() || '成本登记' : text;
}

/** 付款单明细「说明」列：物流去掉 [LOG_ADDR] 等技术标记，成本登记去掉板块前缀。 */
function paymentOrderLogisticsDescriptionText(raw) {
  const text = String(raw || '').trim();
  if (!text) return '—';
  const addressIndex = text.indexOf('[LOG_ADDR]');
  const parsed = parseLogisticsAddrMeta(addressIndex >= 0 ? text.slice(addressIndex) : '');
  const purpose = String(parsed.purpose || '').trim().replace(/^用途[:：]\s*/, '');
  if (purpose) return purpose;

  const receiverLabel = [parsed.recvName, parsed.recvAddr].filter(Boolean).join(' ');
  const senderLabel = String(parsed.shipAddr || parsed.shipName || '').trim();
  if (senderLabel && receiverLabel) return `${senderLabel} → ${receiverLabel}`;
  if (receiverLabel) return receiverLabel;
  if (senderLabel) return senderLabel;

  const head = (addressIndex >= 0 ? text.slice(0, addressIndex) : text).trim();
  const trackingNumber = head.match(/([A-Z]{2}\d{10,}|JD[A-Z0-9]{10,}|SF\d{10,})/i);
  if (trackingNumber) return `运单 ${trackingNumber[1]}`;
  const cleaned = head.replace(/^(快递|物流|专车)\s+/i, '').trim();
  return cleaned || '物流';
}

function paymentOrderItemDescriptionText(item) {
  const sourceType = String(item?.source_type || '').trim();
  const raw = String(item?.description || '').trim();
  if (!raw) return '—';

  if (sourceType === 'logistics') return paymentOrderLogisticsDescriptionText(raw);

  let text = paymentOrderDescriptionText({ description: raw });
  text = text
    .replace(/^\[LOG_ADDR\][^\n]*/g, '')
    .replace(/\s*\[INV-OB:\d+\][^\n]*/g, '')
    .replace(/^成本登记\s*/i, '')
    .replace(/^(活动成本|物流成本|仓储成本|统筹成本|道具维修成本|内部成本)(\s*\([^)]*\))?\s*/i, '')
    .trim();
  if (sourceType === 'warehouse') text = text.replace(/^仓储\s*/i, '').trim();
  if (sourceType === 'material_purchase') text = text.replace(/^物料采购\s*/i, '').trim();
  if (sourceType === 'prop_repair') text = text.replace(/^道具维修\s*/i, '').trim();
  return text || '—';
}

function paymentOrderValidateSelection(rows) {
  if (!rows.length) {
    showToast('请先选择待付款记录', 'warning');
    return false;
  }
  const payees = [...new Set(rows.map((row) => String(row.payee_name || '').trim()).filter(Boolean))];
  if (payees.length !== 1 || rows.some((row) => !String(row.payee_name || '').trim())) {
    showToast('只能合并同一收款方的记录；空收款方请先回来源记录补填', 'warning');
    return false;
  }
  return true;
}
