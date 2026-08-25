function dictOpenEditor(id) {
  if (dictPageState.group === 'lookup') {
    dictOpenLookupEditor(id);
    return;
  }
  const def = dictCurrentCategoryDef();
  if (!def) return;
  const row = id ? (dictPageState.rows || []).find((r) => r.id === id) : null;
  const isEdit = !!row;
  const c = row ? (row.content || {}) : {};
  const overlay = document.getElementById('modalOverlay');
  let modal = document.getElementById('modalDictEditor');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalDictEditor';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-header">
      <div class="modal-title">
        <i data-lucide="${def.icon}" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>
        ${isEdit ? '编辑' : '新建'}${escapeHtml(def.label)}${isEdit && row ? ` · #${row.id}` : ''}
      </div>
      <button type="button" class="modal-close" onclick="dictCloseEditor()">×</button>
    </div>
    <div class="modal-body">
      ${def.fields && def.fields.length ? `
      <div class="form-grid form-grid-2col">
        ${def.fields.map((f) => `
          <div class="form-group ${f.required ? 'is-required' : ''}">
            <label class="form-label">${escapeHtml(f.label)}${f.required ? ' <span class="required">*</span>' : ''}</label>
            <input type="${f.type || 'text'}" class="form-control" id="dictF_${f.key}"
                   value="${escapeHtml(c[f.key] || '')}"
                   placeholder="${escapeHtml(f.placeholder || '')}">
          </div>`).join('')}
      </div>` : `
      <div class="dict-builtin-hint" style="margin-top:0">
        <i data-lucide="info" style="width:12px;height:12px"></i>
        <span>此类别尚未定义字段，请先在类别设置中添加字段。目前可直接填写下方通用信息。</span>
      </div>`}
      <hr class="dict-form-divider">
      <div class="form-grid form-grid-2col">
        <div class="form-group">
          <label class="form-label">简称 / 标签名</label>
          <input type="text" class="form-control" id="dictShortLabel"
                 value="${escapeHtml(row?.short_label || '')}"
                 placeholder="便于业务页面快速识别（可留空）">
        </div>
        <div class="form-group">
          <label class="form-label">标签（逗号分隔）</label>
          <input type="text" class="form-control" id="dictTags"
                 value="${escapeHtml(row?.tags || '')}"
                 placeholder="如：北京,常用,VIP">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">备注</label>
        <textarea class="form-control" id="dictRemarks" rows="2"
                  placeholder="可填写注意事项 / 说明">${escapeHtml(row?.remarks || '')}</textarea>
      </div>
      <label class="dict-pin-toggle">
        <input type="checkbox" id="dictPinned" ${row?.pinned ? 'checked' : ''}>
        <span>置顶（在列表与业务选择器中优先显示）</span>
      </label>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" onclick="dictCloseEditor()">取消</button>
      <button type="button" class="btn btn-primary" onclick="dictSaveEditor(${row?.id || 'null'})">
        ${isEdit ? '保存' : '新建'}
      </button>
    </div>
  `;
  openModal('modalDictEditor');
  renderLucideIcons();
  setTimeout(() => {
    const first = modal.querySelector('input.form-control');
    if (first) first.focus();
  }, 50);
}

function dictCloseEditor() {
  closeModal();
}

async function dictSaveEditor(id) {
  const def = dictCurrentCategoryDef();
  if (!def) return;
  const content = {};
  const fields = def.fields || [];
  for (const f of fields) {
    const el = document.getElementById(`dictF_${f.key}`);
    content[f.key] = el ? String(el.value || '').trim() : '';
    if (f.required && !content[f.key]) {
      showToast(`「${f.label}」不能为空`, 'warning');
      if (el) el.focus();
      return;
    }
  }
  const nameKey = def.nameField || (fields.length ? fields[0].key : '');
  const fallbackKey = def.nameFallback;
  let name = nameKey ? (content[nameKey] || '') : '';
  if (!name && fallbackKey) name = content[fallbackKey] || '';
  if (!name) name = String(document.getElementById('dictShortLabel')?.value || '').trim();
  if (!name.trim()) {
    showToast('主标识不能为空（请填写简称或字段）', 'warning');
    return;
  }
  const short_label = String(document.getElementById('dictShortLabel')?.value || '').trim();
  const tags = String(document.getElementById('dictTags')?.value || '').trim();
  const remarks = String(document.getElementById('dictRemarks')?.value || '').trim();
  const pinned = !!document.getElementById('dictPinned')?.checked;
  const body = {
    category: dictPageState.category,
    name,
    short_label,
    tags,
    remarks,
    pinned,
    content,
  };
  try {
    if (id && id !== 'null') {
      const saved = await api('PUT', `/dict/${id}`, body);
      const syncTotal = Number(saved?.name_sync?.total || 0);
      showToast(
        syncTotal > 0 ? `已保存，并同步更新了 ${syncTotal} 条业务记录` : '已保存',
        'success',
      );
    } else {
      await api('POST', '/dict', body);
      showToast('已新建', 'success');
    }
    dictCloseEditor();
    await dictLoadList();
  } catch (e) {
    showToast(`保存失败：${e.message || '未知错误'}`, 'danger');
  }
}

async function dictTogglePin(id, pinned) {
  try {
    await api('PUT', `/dict/${id}`, { pinned: !!pinned });
    await dictLoadList();
  } catch (e) {
    showToast(`操作失败：${e.message}`, 'danger');
  }
}

async function dictToggleActive(id, active) {
  try {
    await api('PUT', `/dict/${id}`, { is_active: !!active });
    showToast(active ? '已启用' : '已停用', 'success');
    await dictLoadList();
  } catch (e) {
    showToast(`操作失败：${e.message}`, 'danger');
  }
}

async function dictHardDelete(id) {
  if (!confirm('确认彻底删除这条记录？此操作不可撤销。停用记录建议使用「停用」而非删除。')) return;
  try {
    await api('DELETE', `/dict/${id}?hard=1`);
    showToast('已删除', 'success');
    await dictLoadList();
  } catch (e) {
    showToast(`删除失败：${e.message}`, 'danger');
  }
}

/* ----- 自定义类别管理弹窗 ----- */

const DICT_ICON_OPTIONS = [
  'tag', 'user', 'building', 'briefcase', 'truck', 'package', 'box',
  'credit-card', 'wallet', 'landmark', 'globe', 'phone', 'mail',
  'map-pin', 'file-text', 'clipboard', 'database', 'layers', 'grid',
  'settings', 'shield', 'star', 'heart', 'flag', 'bookmark', 'archive',
  'folder', 'key', 'lock', 'bell', 'calendar', 'clock', 'link',
];

function dictOpenCategoryEditor(code) {
  const existing = code ? (dictPageState.customCategories || []).find((c) => c.code === code) : null;
  const isEdit = !!existing;
  const fields = existing && Array.isArray(existing.fields_schema) ? existing.fields_schema : [];
  const overlay = document.getElementById('modalOverlay');
  let modal = document.getElementById('modalDictCatEditor');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalDictCatEditor';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }
  const iconOptions = DICT_ICON_OPTIONS.map((ic) =>
    `<option value="${ic}" ${(existing?.icon || 'tag') === ic ? 'selected' : ''}>${ic}</option>`
  ).join('');
  modal.innerHTML = `
    <div class="modal-header">
      <div class="modal-title">${isEdit ? '编辑' : '新增'}字段类别</div>
      <button type="button" class="modal-close" onclick="dictCloseCategoryEditor()">×</button>
    </div>
    <div class="modal-body">
      <div class="form-grid form-grid-2col">
        <div class="form-group is-required">
          <label class="form-label">类别标识 (code) <span class="required">*</span></label>
          <input type="text" class="form-control" id="dictCatCode"
                 value="${escapeHtml(existing?.code || '')}"
                 placeholder="英文+数字+下划线，如 contact_addr"
                 ${isEdit ? 'readonly style="background:#f5f5f5"' : ''}>
        </div>
        <div class="form-group is-required">
          <label class="form-label">显示名称 <span class="required">*</span></label>
          <input type="text" class="form-control" id="dictCatLabel"
                 value="${escapeHtml(existing?.label || '')}"
                 placeholder="如：联系地址">
        </div>
        <div class="form-group">
          <label class="form-label">图标</label>
          <select class="form-control" id="dictCatIcon">${iconOptions}</select>
        </div>
        <div class="form-group">
          <label class="form-label">描述</label>
          <input type="text" class="form-control" id="dictCatDesc"
                 value="${escapeHtml(existing?.description || '')}"
                 placeholder="用途说明（可选）">
        </div>
      </div>
      <hr class="dict-form-divider">
      <div class="dict-cat-fields-section">
        <div class="dict-cat-fields-header">
          <span class="dict-cat-fields-title">字段定义</span>
          <button type="button" class="btn btn-secondary btn-xs" onclick="dictCatAddField()">
            <i data-lucide="plus" style="width:12px;height:12px"></i> 添加字段
          </button>
        </div>
        <div id="dictCatFieldsList" class="dict-cat-fields-list">
          ${fields.length ? fields.map((f, i) => dictCatFieldRowHtml(f, i)).join('') : '<div class="dict-cat-fields-empty">暂无字段，点击上方「添加字段」开始配置</div>'}
        </div>
      </div>
    </div>
    <div class="modal-footer">
      ${isEdit ? `<button type="button" class="btn btn-danger btn-sm" onclick="dictDeleteCategory(${existing.id})" style="margin-right:auto">删除类别</button>` : ''}
      <button type="button" class="btn btn-secondary" onclick="dictCloseCategoryEditor()">取消</button>
      <button type="button" class="btn btn-primary" onclick="dictSaveCategoryEditor(${existing?.id || 'null'})">${isEdit ? '保存' : '新增'}</button>
    </div>
  `;
  openModal('modalDictCatEditor');
  renderLucideIcons();
}
