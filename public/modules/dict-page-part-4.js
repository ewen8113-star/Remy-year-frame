function dictCatFieldRowHtml(f, idx) {
  const typeOptions = [
    { v: 'text', l: '文本' },
    { v: 'tel', l: '电话' },
    { v: 'email', l: '邮箱' },
    { v: 'number', l: '数字' },
    { v: 'textarea', l: '多行文本' },
    { v: 'date', l: '日期' },
    { v: 'url', l: '链接' },
  ].map((o) => `<option value="${o.v}" ${(f?.type || 'text') === o.v ? 'selected' : ''}>${o.l}</option>`).join('');
  return `
    <div class="dict-cat-field-row" data-idx="${idx}">
      <input type="text" class="form-control dict-cat-f-key" placeholder="字段标识 key"
             value="${escapeHtml(f?.key || '')}" data-field="key">
      <input type="text" class="form-control dict-cat-f-label" placeholder="显示名称"
             value="${escapeHtml(f?.label || '')}" data-field="label">
      <select class="form-control dict-cat-f-type" data-field="type">${typeOptions}</select>
      <label class="dict-cat-f-req"><input type="checkbox" data-field="required" ${f?.required ? 'checked' : ''}> 必填</label>
      <button type="button" class="icon-btn icon-btn-danger" title="删除字段"
              onclick="dictCatRemoveField(${idx})">
        <i data-lucide="x" style="width:13px;height:13px"></i>
      </button>
    </div>`;
}

function dictCatAddField() {
  const container = document.getElementById('dictCatFieldsList');
  if (!container) return;
  const emptyHint = container.querySelector('.dict-cat-fields-empty');
  if (emptyHint) emptyHint.remove();
  const rows = container.querySelectorAll('.dict-cat-field-row');
  const idx = rows.length;
  const div = document.createElement('div');
  div.innerHTML = dictCatFieldRowHtml({ key: '', label: '', type: 'text', required: false }, idx);
  container.appendChild(div.firstElementChild);
  renderLucideIcons();
}

function dictCatRemoveField(idx) {
  const container = document.getElementById('dictCatFieldsList');
  if (!container) return;
  const row = container.querySelector(`.dict-cat-field-row[data-idx="${idx}"]`);
  if (row) row.remove();
  container.querySelectorAll('.dict-cat-field-row').forEach((r, i) => r.dataset.idx = i);
  if (!container.querySelectorAll('.dict-cat-field-row').length) {
    container.innerHTML = '<div class="dict-cat-fields-empty">暂无字段，点击上方「添加字段」开始配置</div>';
  }
}

function dictCollectCatFields() {
  const container = document.getElementById('dictCatFieldsList');
  if (!container) return [];
  const result = [];
  container.querySelectorAll('.dict-cat-field-row').forEach((row) => {
    const key = row.querySelector('[data-field="key"]')?.value?.trim() || '';
    const label = row.querySelector('[data-field="label"]')?.value?.trim() || '';
    const type = row.querySelector('[data-field="type"]')?.value || 'text';
    const required = !!row.querySelector('[data-field="required"]')?.checked;
    if (key) result.push({ key, label: label || key, type, required });
  });
  return result;
}

function dictCloseCategoryEditor() {
  closeModal();
}

async function dictSaveCategoryEditor(id) {
  const code = String(document.getElementById('dictCatCode')?.value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  const label = String(document.getElementById('dictCatLabel')?.value || '').trim();
  const icon = String(document.getElementById('dictCatIcon')?.value || 'tag').trim();
  const description = String(document.getElementById('dictCatDesc')?.value || '').trim();
  if (!code) return showToast('类别标识不能为空（仅小写英文+数字+下划线）', 'warning');
  if (!label) return showToast('显示名称不能为空', 'warning');
  const fields_schema = dictCollectCatFields();
  const body = { code, label, icon, description, fields_schema };
  try {
    if (id && id !== 'null') {
      await api('PUT', `/dict/custom-categories/${id}`, body);
      showToast('类别已更新', 'success');
    } else {
      await api('POST', '/dict/custom-categories', body);
      showToast('类别已创建', 'success');
    }
    dictCloseCategoryEditor();
    const ccList = await api('GET', '/dict/custom-categories');
    dictPageState.customCategories = Array.isArray(ccList) ? ccList : [];
    if (!id || id === 'null') {
      dictPageState.group = 'custom';
      dictPageState.category = code;
    }
    const sidebar = document.getElementById('dictSidebar');
    if (sidebar) { sidebar.innerHTML = dictSidebarHtml(); renderLucideIcons(); }
    const toolbar = document.getElementById('dictMainToolbar');
    if (toolbar) { toolbar.innerHTML = dictToolbarHtml(); renderLucideIcons(); }
    await dictLoadList();
  } catch (e) {
    showToast(`保存失败：${e.message || '未知错误'}`, 'danger');
  }
}

async function dictDeleteCategory(id) {
  if (!confirm('确认删除此自定义类别？类别下的所有条目也将一并删除，此操作不可撤销。')) return;
  try {
    await api('DELETE', `/dict/custom-categories/${id}`);
    showToast('类别已删除', 'success');
    const ccList = await api('GET', '/dict/custom-categories');
    dictPageState.customCategories = Array.isArray(ccList) ? ccList : [];
    dictPageState.group = 'dict';
    dictPageState.category = 'recipient';
    const sidebar = document.getElementById('dictSidebar');
    if (sidebar) { sidebar.innerHTML = dictSidebarHtml(); renderLucideIcons(); }
    const toolbar = document.getElementById('dictMainToolbar');
    if (toolbar) { toolbar.innerHTML = dictToolbarHtml(); renderLucideIcons(); }
    await dictLoadList();
  } catch (e) {
    showToast(`删除失败：${e.message || '未知错误'}`, 'danger');
  }
}

/** 编辑内置类别（仅允许改 label/icon/desc/fields，不允许删除） */
function dictEditBuiltinCategory(code) {
  const def = DICT_CATEGORY_DEFS[code];
  if (!def) return;
  // 按 code 匹配：库中同一 code 仅一行；不要求 is_builtin（避免历史数据 is_builtin=0 时无法 PUT 而误走 POST）
  const existing = (dictPageState.customCategories || []).find((c) => c.code === code);
  const fields = def.fields || [];
  const overlay = document.getElementById('modalOverlay');
  let modal = document.getElementById('modalDictCatEditor');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalDictCatEditor';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }
  const iconOptions = DICT_ICON_OPTIONS.map((ic) =>
    `<option value="${ic}" ${(def.icon || 'tag') === ic ? 'selected' : ''}>${ic}</option>`
  ).join('');
  modal.innerHTML = `
    <div class="modal-header">
      <div class="modal-title">编辑内置类别 · ${escapeHtml(def.label)}</div>
      <button type="button" class="modal-close" onclick="dictCloseCategoryEditor()">×</button>
    </div>
    <div class="modal-body">
      <div class="form-grid form-grid-2col">
        <div class="form-group">
          <label class="form-label">类别标识 (code)</label>
          <input type="text" class="form-control" id="dictCatCode"
                 value="${escapeHtml(code)}"
                 readonly style="background:#f5f5f5">
        </div>
        <div class="form-group is-required">
          <label class="form-label">显示名称 <span class="required">*</span></label>
          <input type="text" class="form-control" id="dictCatLabel"
                 value="${escapeHtml(def.label || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">图标</label>
          <select class="form-control" id="dictCatIcon">${iconOptions}</select>
        </div>
        <div class="form-group">
          <label class="form-label">描述</label>
          <input type="text" class="form-control" id="dictCatDesc"
                 value="${escapeHtml(def.desc || '')}">
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
          ${fields.length ? fields.map((f, i) => dictCatFieldRowHtml(f, i)).join('') : '<div class="dict-cat-fields-empty">暂无字段</div>'}
        </div>
      </div>
      <div class="dict-builtin-hint">
        <i data-lucide="info" style="width:12px;height:12px"></i>
        <span>系统内置类别不可删除。修改将持久保存。</span>
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" onclick="dictCloseCategoryEditor()">取消</button>
      <button type="button" class="btn btn-primary" onclick="dictSaveBuiltinCategory('${escapeHtml(code)}', ${existing?.id || 'null'})">保存</button>
    </div>
  `;
  openModal('modalDictCatEditor');
  renderLucideIcons();
}

async function dictSaveBuiltinCategory(code, existingId) {
  const label = String(document.getElementById('dictCatLabel')?.value || '').trim();
  const icon = String(document.getElementById('dictCatIcon')?.value || 'tag').trim();
  const description = String(document.getElementById('dictCatDesc')?.value || '').trim();
  if (!label) return showToast('显示名称不能为空', 'warning');
  const fields_schema = dictCollectCatFields();
  const body = { code, label, icon, description, fields_schema, is_active: 1, is_builtin: 1 };
  try {
    if (existingId && existingId !== 'null' && existingId !== null) {
      await api('PUT', `/dict/custom-categories/${existingId}`, body);
    } else {
      await api('POST', '/dict/custom-categories', body);
    }
    showToast('类别设置已保存', 'success');
    dictCloseCategoryEditor();
    const ccList = await api('GET', '/dict/custom-categories');
    dictPageState.customCategories = Array.isArray(ccList) ? ccList : [];
    dictApplyBuiltinOverrides();
    const sidebar = document.getElementById('dictSidebar');
    if (sidebar) { sidebar.innerHTML = dictSidebarHtml(); renderLucideIcons(); }
    const toolbar = document.getElementById('dictMainToolbar');
    if (toolbar) { toolbar.innerHTML = dictToolbarHtml(); renderLucideIcons(); }
  } catch (e) {
    showToast(`保存失败：${e.message || '未知错误'}`, 'danger');
  }
}

/* ----- 表单选项（lookup_options）部分 ----- */
