async function showPropRepairModal(id) {
  const title = document.getElementById('modalPropRepairTitle');
  const body = document.getElementById('modalPropRepairBody');
  if (!body) return;
  let record = null;
  if (id) {
    try {
      record = await api('GET', `/prop-repairs/${id}`);
      if (title) title.textContent = '编辑道具维修';
    } catch (e) {
      showToast(e.message || '加载失败', 'error');
      return;
    }
  } else if (title) {
    title.textContent = '新建道具维修';
  }

  let brands = [];
  try {
    brands = await api('GET', '/brand?active=true');
  } catch {
    brands = [];
  }
  const brandOpts = brands
    .map((b) => `<option value="${b.id}">${escapeHtml(b.brand_name || b.brand_code)}</option>`)
    .join('');

  const defaultBrand = record ? String(record.brand_id) : brands[0] ? String(brands[0].id) : '';
  const dateVal = record && record.repair_date
    ? toDateInputValue(record.repair_date)
    : todayDateInputValue();

  const customFromRecord = (record && Array.isArray(record.items) ? record.items : []).filter(
    (it) => it && it.name
  );
  const noCost = record && (record.no_cost === true || record.no_cost === 1 || String(record.no_cost) === '1');
  const quotedPrice = record && record.quoted_price != null ? roundMoney2(record.quoted_price).toFixed(2) : '';
  const prPaid = record && (String(record.payment_status || '').toLowerCase() === 'paid');

  body.innerHTML = `
    <input type="hidden" id="prRecordId" value="${record ? record.id : ''}">
    <div class="form-grid" style="grid-template-columns:1fr 1fr">
      <div class="form-group">
        <label class="form-label">品牌 <span class="required">*</span></label>
        <select class="form-control" id="prBrandId" required>${brandOpts}</select>
      </div>
      <div class="form-group">
        <label class="form-label">维修日期 <span class="required">*</span></label>
        <input type="date" class="form-control" id="prRepairDate" required value="${dateVal}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">区域 <span class="required">*</span></label>
      <select class="form-control" id="prRegion" required>
        <option value="东区">东区</option>
        <option value="北区">北区</option>
        <option value="南区">南区</option>
        <option value="东南区">东南区</option>
        <option value="西南区">西南区</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">报价 (¥)</label>
      <input type="number" class="form-control" id="prQuotedPrice" placeholder="0.00" step="0.01" min="0" value="${quotedPrice}">
    </div>
    <div class="form-group">
      <label class="form-label">收款方</label>
      <input type="text" class="form-control" id="prPayeeName" placeholder="用于对公付款合并" value="${escapeHtml((record && record.payee_name) || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">付款状态</label>
      <select class="form-control" id="prPaymentStatus">
        <option value="unpaid" ${!prPaid ? 'selected' : ''}>未支付</option>
        <option value="paid" ${prPaid ? 'selected' : ''}>已支付</option>
      </select>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin:0 0 10px;color:var(--text-secondary);cursor:pointer">
      <input type="checkbox" id="prNoCost" ${noCost ? 'checked' : ''} onchange="updatePrTotal()">
      <span>无成本（勾选后本条金额记 0）</span>
    </label>
    <div class="form-group">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span class="form-label" style="margin:0">维修项目（自定义）</span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="propRepairAppendCustomRow()">+ 添加一行</button>
      </div>
      <div id="prCustomRows"></div>
    </div>
    <div style="margin-top:12px;padding:12px;background:var(--accent-soft);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">
      <span style="color:var(--text-secondary)">成本（明细合计）</span>
      <span class="amount" id="prTotalDisplay" style="font-size:18px;font-weight:700">${fmtMoney(0)}</span>
    </div>
  `;

  const bs = document.getElementById('prBrandId');
  if (bs && defaultBrand) bs.value = defaultBrand;
  const rs = document.getElementById('prRegion');
  if (rs) rs.value = record && record.region ? String(record.region) : '东区';
  (customFromRecord || []).forEach((it) => {
    propRepairAppendCustomRow(it.name, roundMoney2(it.amount).toFixed(2));
  });
  if (!customFromRecord.length) propRepairAppendCustomRow();
  openModal('modalPropRepair');
  updatePrTotal();
  renderLucideIcons();
}

async function savePropRepairForm() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可保存', 'warning');
    return;
  }
  const id = document.getElementById('prRecordId')?.value?.trim();
  const brand_id = parseInt(document.getElementById('prBrandId')?.value, 10);
  const repair_date = document.getElementById('prRepairDate')?.value;
  const region = document.getElementById('prRegion')?.value;
  const quoted_price = roundMoney2(document.getElementById('prQuotedPrice')?.value);
  const no_cost = !!document.getElementById('prNoCost')?.checked;
  const payment_status = document.getElementById('prPaymentStatus')?.value === 'paid' ? 'paid' : 'unpaid';
  const items = no_cost ? [] : collectPropRepairItemsFromForm();
  const total = no_cost ? 0 : roundMoney2(items.reduce((s, x) => s + x.amount, 0));
  if (!brand_id) {
    showToast('请选择品牌', 'warning');
    return;
  }
  if (!repair_date) {
    showToast('请选择维修日期', 'warning');
    return;
  }
  if (!region) {
    showToast('请选择区域', 'warning');
    return;
  }
  if (!no_cost && (!items.length || total <= 0)) {
    showToast('请至少填写一项大于 0 的金额，或勾选无成本', 'warning');
    return;
  }
  const body = {
    year_frame_id: currentYearFrameId,
    brand_id,
    repair_date,
    region,
    quoted_price,
    payee_name: document.getElementById('prPayeeName')?.value?.trim() || null,
    payment_status,
    items,
    no_cost: no_cost ? 1 : 0,
    activity_id: null,
    merged_into_activity: 0,
    allocation_note: null,
    remarks: null,
  };
  try {
    if (id) {
      await api('PUT', `/prop-repairs/${id}`, body);
      showToast('已更新', 'success');
    } else {
      await api('POST', '/prop-repairs', body);
      showToast('已保存', 'success');
    }
    closeModal();
    if (currentPage === 'prop-repair') await renderPropRepairs();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

async function deletePropRepairRecord(rid) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除', 'warning');
    return;
  }
  if (!confirm('确定删除该条道具维修记录？')) return;
  try {
    await api('DELETE', `/prop-repairs/${rid}`);
    showToast('已删除', 'success');
    await renderPropRepairs();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}
