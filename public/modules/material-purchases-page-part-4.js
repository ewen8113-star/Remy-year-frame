function collectMaterialPurchaseItemsFromForm() {
  const out = [];
  document.querySelectorAll('.mp-amt-fixed').forEach((inp) => {
    const name = inp.getAttribute('data-name');
    if (!name) return;
    const amt = roundMoney2(inp.value);
    if (amt > 0) out.push({ name, amount: amt });
  });
  document.querySelectorAll('.mp-custom-row').forEach((row) => {
    const nm = row.querySelector('.mp-custom-name')?.value?.trim();
    const am = roundMoney2(row.querySelector('.mp-custom-amt')?.value);
    if (nm && am > 0) out.push({ name: nm, amount: am });
  });
  return out;
}

function updateMpTotal() {
  const items = collectMaterialPurchaseItemsFromForm();
  const t = roundMoney2(items.reduce((s, x) => s + roundMoney2(x.amount), 0));
  const el = document.getElementById('mpTotalDisplay');
  if (el) el.textContent = fmtMoney(t);
}

function materialAppendCustomRow() {
  const wrap = document.getElementById('mpCustomRows');
  if (!wrap) return;
  const div = document.createElement('div');
  div.className = 'form-group mp-custom-row';
  div.style.cssText =
    'display:grid;grid-template-columns:1fr 120px 52px;gap:8px;align-items:center;margin-bottom:8px';
  div.innerHTML = `
    <input type="text" class="form-control mp-custom-name" placeholder="项目名称">
    <input type="number" class="form-control mp-custom-amt" step="0.01" min="0" placeholder="0.00" oninput="updateMpTotal()">
    <button type="button" class="btn btn-secondary btn-sm" onclick="this.closest('.mp-custom-row').remove();updateMpTotal()">删</button>
  `;
  wrap.appendChild(div);
}

async function showMaterialPurchaseModal(id) {
  const title = document.getElementById('modalMaterialPurchaseTitle');
  const body = document.getElementById('modalMaterialPurchaseBody');
  if (!body) return;
  let record = null;
  if (id) {
    try {
      record = await api('GET', `/material-purchases/${id}`);
      if (title) title.textContent = '编辑物料采购';
    } catch (e) {
      showToast(e.message || '加载失败', 'error');
      return;
    }
  } else if (title) {
    title.textContent = '新建物料采购';
  }

  let brands = [];
  try {
    brands = await api('GET', '/brand?active=true');
  } catch {
    brands = [];
  }
  let projectOptions = '';
  try {
    const codes = await ensureActivityProjectIndex();
    projectOptions = codes.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
  } catch {
    projectOptions = '';
  }
  const brandOpts = brands
    .map((b) => `<option value="${b.id}">${escapeHtml(b.brand_name || b.brand_code)}</option>`)
    .join('');

  const defaultBrand = record ? String(record.brand_id) : brands[0] ? String(brands[0].id) : '';
  const dateVal = record && record.purchase_date
    ? toDateInputValue(record.purchase_date)
    : todayDateInputValue();

  const itemsMap = {};
  (record && Array.isArray(record.items) ? record.items : []).forEach((it) => {
    if (it && it.name) itemsMap[it.name] = roundMoney2(it.amount);
  });

  const fixedRows = MATERIAL_FIXED_ITEM_NAMES.map(
    (name) => `
    <div class="form-group" style="display:grid;grid-template-columns:1fr 120px;gap:10px;align-items:center;margin-bottom:8px">
      <label class="form-label" style="margin:0">${escapeHtml(name)}</label>
      <input type="number" class="form-control mp-amt-fixed" step="0.01" min="0" placeholder="0.00" data-name="${escapeHtml(name)}"
        value="${itemsMap[name] != null && itemsMap[name] !== 0 ? roundMoney2(itemsMap[name]).toFixed(2) : ''}" oninput="updateMpTotal()">
    </div>`
  ).join('');

  const customFromRecord = (record && Array.isArray(record.items) ? record.items : []).filter(
    (it) => it && it.name && !MATERIAL_FIXED_ITEM_NAMES.includes(it.name)
  );

  const customRowsHtml = customFromRecord
    .map(
      (it) => `
    <div class="form-group mp-custom-row" style="display:grid;grid-template-columns:1fr 120px 52px;gap:8px;align-items:center;margin-bottom:8px">
      <input type="text" class="form-control mp-custom-name" placeholder="项目名称" value="${escapeHtml(it.name)}">
      <input type="number" class="form-control mp-custom-amt" step="0.01" min="0" placeholder="0.00" value="${roundMoney2(it.amount).toFixed(2)}" oninput="updateMpTotal()">
      <button type="button" class="btn btn-secondary btn-sm" onclick="this.closest('.mp-custom-row').remove();updateMpTotal()">删</button>
    </div>`
    )
    .join('');

  const remarksAttr = record && record.remarks ? escapeHtml(record.remarks) : '';
  const mergedMp = record && (record.merged_into_activity === true || record.merged_into_activity === 1 || String(record.merged_into_activity) === '1');
  const mpProject = record && record.activity_id ? (Array.from(logisticsProjectIndex.codeToId.entries()).find(([, id]) => Number(id) === Number(record.activity_id)) || [record.related_project_code || '', 0])[0] : '';

  body.innerHTML = `
    <input type="hidden" id="mpRecordId" value="${record ? record.id : ''}">
    <div class="form-grid" style="grid-template-columns:1fr 1fr">
      <div class="form-group">
        <label class="form-label">品牌 <span class="required">*</span></label>
        <select class="form-control" id="mpBrandId" required>${brandOpts}</select>
      </div>
      <div class="form-group">
        <label class="form-label">报销日期 <span class="required">*</span></label>
        <input type="date" class="form-control" id="mpPurchaseDate" required value="${dateVal}">
      </div>
      <div class="form-group">
        <label class="form-label">收款方</label>
        <input type="text" class="form-control" id="mpPayeeName" placeholder="用于付款合并" value="${escapeHtml((record && record.payee_name) || '')}">
      </div>
    </div>
    <div class="form-group">
      <div class="form-label">固定费用项目（¥）</div>
      <div style="margin-top:8px">${fixedRows}</div>
    </div>
    <div class="form-group">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span class="form-label" style="margin:0">自定义项目</span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="materialAppendCustomRow()">+ 添加一行</button>
      </div>
      <div id="mpCustomRows">${customRowsHtml}</div>
    </div>
    <div class="form-group">
      <label class="form-label">备注</label>
      <input type="text" class="form-control" id="mpRemarks" placeholder="选填" value="${remarksAttr}">
    </div>
    <div class="form-group">
      <label class="form-label">关联项目编号（可选）</label>
      <input type="text" class="form-control" id="mpProjectCode" list="mpProjectList" autocomplete="off" placeholder="输入并从下拉选择（仅允许活动项目编号）" value="${escapeHtml(mpProject)}">
      <datalist id="mpProjectList">${projectOptions}</datalist>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin:0 0 10px;color:var(--text-secondary);cursor:pointer">
      <input type="checkbox" id="mpMergedIntoActivity" ${mergedMp ? 'checked' : ''}>
      <span>计入活动成本（勾选时需选择关联项目编号）</span>
    </label>
    <div class="form-group">
      <label class="form-label">计入说明</label>
      <input type="text" class="form-control" id="mpAllocationNote" placeholder="选填" value="${escapeHtml((record && record.allocation_note) || '')}">
    </div>
    <div style="margin-top:12px;padding:12px;background:var(--accent-soft);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">
      <span style="color:var(--text-secondary)">合计</span>
      <span class="amount" id="mpTotalDisplay" style="font-size:18px;font-weight:700">${fmtMoney(0)}</span>
    </div>
  `;
  const bs = document.getElementById('mpBrandId');
  if (bs && defaultBrand) bs.value = defaultBrand;
  openModal('modalMaterialPurchase');
  updateMpTotal();
  renderLucideIcons();
}

async function saveMaterialPurchaseForm() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可保存', 'warning');
    return;
  }
  const id = document.getElementById('mpRecordId')?.value?.trim();
  const brand_id = parseInt(document.getElementById('mpBrandId')?.value, 10);
  const purchase_date = document.getElementById('mpPurchaseDate')?.value;
  const remarks = document.getElementById('mpRemarks')?.value?.trim() || '';
  const projectCode = (document.getElementById('mpProjectCode')?.value || '').replace(/^\uFEFF/, '').trim();
  const mergedIntoActivity = !!document.getElementById('mpMergedIntoActivity')?.checked;
  if (projectCode && !logisticsProjectIndex.codes.has(projectCode)) {
    showToast('关联项目编号必须从活动项目编号中选择', 'warning');
    return;
  }
  if (mergedIntoActivity && !projectCode) {
    showToast('勾选计入活动成本时，必须选择关联项目编号', 'warning');
    return;
  }
  const activityId = projectCode ? logisticsProjectIndex.codeToId.get(projectCode) : null;
  if (mergedIntoActivity && !activityId) {
    showToast('关联项目编号无效，请从下拉建议中选择', 'warning');
    return;
  }
  const items = collectMaterialPurchaseItemsFromForm();
  const total = roundMoney2(items.reduce((s, x) => s + x.amount, 0));
  if (!brand_id) {
    showToast('请选择品牌', 'warning');
    return;
  }
  if (!purchase_date) {
    showToast('请选择报销日期', 'warning');
    return;
  }
  if (!items.length || total <= 0) {
    showToast('请至少填写一项大于 0 的金额', 'warning');
    return;
  }
  const body = {
    year_frame_id: currentYearFrameId,
    brand_id,
    purchase_date,
    payee_name: document.getElementById('mpPayeeName')?.value?.trim() || null,
    items,
    remarks,
    activity_id: activityId || null,
    merged_into_activity: mergedIntoActivity ? 1 : 0,
    allocation_note: document.getElementById('mpAllocationNote')?.value?.trim() || null,
  };
  try {
    if (id) {
      await api('PUT', `/material-purchases/${id}`, body);
      showToast('已更新', 'success');
    } else {
      await api('POST', '/material-purchases', body);
      showToast('已保存', 'success');
    }
    closeModal();
    if (currentPage === 'material') await renderMaterialPurchases();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

async function deleteMaterialPurchaseRecord(rid) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除', 'warning');
    return;
  }
  if (!confirm('确定删除该条物料采购记录？')) return;
  try {
    await api('DELETE', `/material-purchases/${rid}`);
    showToast('已删除', 'success');
    await renderMaterialPurchases();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}
