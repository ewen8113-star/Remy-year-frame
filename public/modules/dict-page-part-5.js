function dictRenderLookupList() {
  const listEl = document.getElementById('dictMainList');
  const rows = dictPageState.rows || [];
  const countEl = document.getElementById('dictToolbarCount');
  if (countEl) {
    let activeCount = 0;
    rows.forEach((r) => { if (r.is_active) activeCount++; });
    countEl.textContent = `${activeCount} 启用 / ${rows.length - activeCount} 停用`;
  }
  if (!rows.length) {
    listEl.innerHTML = `
      <div class="dict-empty">
        <i data-lucide="inbox" style="width:32px;height:32px"></i>
        <div class="dict-empty-title">暂无选项</div>
        <div class="dict-empty-hint">点击右上角「新建」添加</div>
      </div>`;
    return;
  }
  listEl.innerHTML = `
    <table class="dict-lookup-table">
      <thead>
        <tr>
          <th style="width:60px">排序</th>
          <th>显示名 (label)</th>
          <th>值 (value)</th>
          <th style="width:90px">状态</th>
          <th style="width:160px;text-align:right">操作</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr class="${!r.is_active ? 'is-inactive' : ''}">
            <td>${Number(r.sort_order || 0)}</td>
            <td>${escapeHtml(r.label || '')}</td>
            <td><code class="dict-lookup-code">${escapeHtml(r.value || '')}</code></td>
            <td>${r.is_active
                ? '<span class="dict-status dict-status-active">启用</span>'
                : '<span class="dict-status dict-status-inactive">停用</span>'}</td>
            <td style="text-align:right">
              <button type="button" class="icon-btn" title="编辑" onclick="dictOpenLookupEditor(${r.id})">
                <i data-lucide="pencil" style="width:13px;height:13px"></i>
              </button>
              ${r.is_active
                ? `<button type="button" class="icon-btn" title="停用" onclick="dictLookupSetActive(${r.id}, false)">
                    <i data-lucide="archive" style="width:13px;height:13px"></i>
                  </button>`
                : `<button type="button" class="icon-btn" title="启用" onclick="dictLookupSetActive(${r.id}, true)">
                    <i data-lucide="rotate-ccw" style="width:13px;height:13px"></i>
                  </button>`}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function dictOpenLookupEditor(id) {
  const cat = dictPageState.category;
  const def = DICT_LOOKUP_DEFS.find((d) => d.category === cat);
  const row = id ? (dictPageState.rows || []).find((r) => r.id === id) : null;
  const isEdit = !!row;
  let modal = document.getElementById('modalDictLookupEditor');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalDictLookupEditor';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-header">
      <div class="modal-title">${isEdit ? '编辑' : '新建'}：${escapeHtml(def?.label || cat)}${isEdit && row ? ` · #${row.id}` : ''}</div>
      <button type="button" class="modal-close" onclick="dictCloseLookupEditor()">×</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">显示名 (label) <span class="required">*</span></label>
        <input type="text" class="form-control" id="dictLkLabel"
               value="${escapeHtml(row?.label || '')}"
               placeholder="表单下拉显示的中文">
      </div>
      <div class="form-group">
        <label class="form-label">值 (value) <span class="required">*</span></label>
        <input type="text" class="form-control" id="dictLkValue"
               value="${escapeHtml(row?.value || '')}"
               ${isEdit ? 'readonly' : ''}
               placeholder="存数据库的真实值，一般等于 label">
        ${isEdit ? '<div class="form-hint">编辑时不可修改 value（避免已引用的数据失效）</div>' : ''}
      </div>
      <div class="form-group">
        <label class="form-label">排序 (越小越靠前)</label>
        <input type="number" class="form-control" id="dictLkSort"
               value="${Number(row?.sort_order || 0)}">
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" onclick="dictCloseLookupEditor()">取消</button>
      <button type="button" class="btn btn-primary" onclick="dictSaveLookup(${row?.id || 'null'})">
        ${isEdit ? '保存' : '新建'}
      </button>
    </div>
  `;
  openModal('modalDictLookupEditor');
  renderLucideIcons();
}

function dictCloseLookupEditor() {
  closeModal();
}

async function dictSaveLookup(id) {
  const label = String(document.getElementById('dictLkLabel')?.value || '').trim();
  const value = String(document.getElementById('dictLkValue')?.value || '').trim();
  const sort_order = parseInt(document.getElementById('dictLkSort')?.value, 10) || 0;
  if (!label) { showToast('显示名不能为空', 'warning'); return; }
  if (!id || id === 'null') {
    if (!value) { showToast('值不能为空', 'warning'); return; }
  }
  try {
    if (id && id !== 'null') {
      await api('PUT', `/lookups/${id}`, { label, sort_order });
    } else {
      await api('POST', '/lookups', { category: dictPageState.category, label, value, sort_order });
    }
    showToast('已保存', 'success');
    dictCloseLookupEditor();
    await dictLoadList();
  } catch (e) {
    showToast(`保存失败：${e.message}`, 'danger');
  }
}

async function dictLookupSetActive(id, active) {
  try {
    await api('PUT', `/lookups/${id}`, { is_active: active ? 1 : 0 });
    showToast(active ? '已启用' : '已停用', 'success');
    await dictLoadList();
  } catch (e) {
    showToast(`操作失败：${e.message}`, 'danger');
  }
}
