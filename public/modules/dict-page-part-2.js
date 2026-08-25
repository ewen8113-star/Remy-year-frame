async function renderDictManager() {
  if (!hasWriteAccess()) {
    document.getElementById('pageContainer').innerHTML =
      '<div class="empty-state">仅管理员可访问字典管理</div>';
    return;
  }
  try {
    const ccList = await api('GET', '/dict/custom-categories');
    dictPageState.customCategories = Array.isArray(ccList) ? ccList : [];
    dictApplyBuiltinOverrides();
  } catch (_) {
    dictPageState.customCategories = [];
  }
  const container = document.getElementById('pageContainer');
  container.innerHTML = `
    <div class="dict-page">
      <aside class="dict-sidebar" id="dictSidebar">${dictSidebarHtml()}</aside>
      <section class="dict-main">
        <div class="dict-main-toolbar" id="dictMainToolbar">${dictToolbarHtml()}</div>
        <div class="dict-main-list" id="dictMainList">
          <div class="empty-state">加载中...</div>
        </div>
      </section>
    </div>
  `;
  await dictLoadList();
}

function dictSidebarHtml() {
  const catStats = dictPageState.catStats || {};
  const dictItems = DICT_BUILTIN_CATEGORIES.map((c) => {
    const def = DICT_CATEGORY_DEFS[c];
    const active = dictPageState.group === 'dict' && dictPageState.category === c;
    const count = catStats[c] ? catStats[c].active : 0;
    return `
      <div class="dict-side-item-wrap ${active ? 'is-active' : ''}">
        <button type="button" class="dict-side-item ${active ? 'is-active' : ''}"
                onclick="dictSelectCategory('dict','${c}')"
                title="${escapeHtml(def.desc)}">
          <i data-lucide="${def.icon}" style="width:14px;height:14px"></i>
          <span class="dict-side-label">${escapeHtml(def.label)}</span>
          <span class="dict-side-count">${count}</span>
        </button>
        <button type="button" class="dict-side-edit-btn" title="编辑类别"
                onclick="event.stopPropagation();dictEditBuiltinCategory('${c}')">
          <i data-lucide="pencil" style="width:11px;height:11px"></i>
        </button>
      </div>`;
  }).join('');
  const lookupItems = DICT_LOOKUP_DEFS.map((d) => {
    const active = dictPageState.group === 'lookup' && dictPageState.category === d.category;
    return `
      <button type="button" class="dict-side-item ${active ? 'is-active' : ''}"
              onclick="dictSelectCategory('lookup','${d.category}')">
        <i data-lucide="${d.icon}" style="width:14px;height:14px"></i>
        <span class="dict-side-label">${escapeHtml(d.label)}</span>
      </button>`;
  }).join('');
  const customCats = (dictPageState.customCategories || []).filter((c) => c.is_active || dictPageState.includeInactive);
  const customItems = customCats.map((cc) => {
    const active = dictPageState.group === 'custom' && dictPageState.category === cc.code;
    const count = catStats[cc.code] ? catStats[cc.code].active : 0;
    return `
      <button type="button" class="dict-side-item ${active ? 'is-active' : ''}"
              onclick="dictSelectCategory('custom','${escapeHtml(cc.code)}')"
              title="${escapeHtml(cc.description || cc.label)}">
        <i data-lucide="${cc.icon || 'tag'}" style="width:14px;height:14px"></i>
        <span class="dict-side-label">${escapeHtml(cc.label)}</span>
        <span class="dict-side-count">${count}</span>
      </button>`;
  }).join('');
  return `
    <div class="dict-side-group">
      <div class="dict-side-group-title">
        <i data-lucide="contact" style="width:13px;height:13px"></i>
        <span>通讯录</span>
      </div>
      <div class="dict-side-group-items">${dictItems}</div>
    </div>
    <div class="dict-side-group">
      <div class="dict-side-group-title">
        <i data-lucide="folder-plus" style="width:13px;height:13px"></i>
        <span>自定义字段</span>
        <button type="button" class="dict-side-add-btn" onclick="dictOpenCategoryEditor(null)" title="新增字段类别">
          <i data-lucide="plus" style="width:12px;height:12px"></i>
        </button>
      </div>
      <div class="dict-side-group-items">
        ${customItems || '<div class="dict-side-empty-hint">暂无自定义字段</div>'}
      </div>
    </div>
    <div class="dict-side-group">
      <div class="dict-side-group-title">
        <i data-lucide="list" style="width:13px;height:13px"></i>
        <span>表单选项</span>
      </div>
      <div class="dict-side-group-items">${lookupItems}</div>
    </div>
    <div class="dict-side-hint">
      <i data-lucide="info" style="width:12px;height:12px"></i>
      <span>表单选项已在原表单旁支持「编辑选项」入口，此处提供集中管理视图</span>
    </div>
  `;
}

function dictToolbarHtml() {
  const isDict = dictPageState.group === 'dict';
  const isCustom = dictPageState.group === 'custom';
  const def = dictCurrentCategoryDef();
  const desc = (isDict || isCustom) && def ? def.desc : '';
  const searchValue = escapeHtml(dictPageState.q || '');
  const showSearch = isDict || isCustom;
  const customCatObj = isCustom ? (dictPageState.customCategories || []).find((c) => c.code === dictPageState.category) : null;
  return `
    <div class="dict-toolbar-left">
      <div class="dict-toolbar-title">
        ${def ? `<i data-lucide="${def.icon}" style="width:16px;height:16px"></i>` : ''}
        <span>${escapeHtml(dictCurrentCategoryLabel())}</span>
        <span class="dict-toolbar-count" id="dictToolbarCount"></span>
        ${isCustom && customCatObj ? `
          <button type="button" class="icon-btn" title="编辑此类别" onclick="dictOpenCategoryEditor('${escapeHtml(customCatObj.code)}')" style="margin-left:4px">
            <i data-lucide="settings" style="width:13px;height:13px"></i>
          </button>` : ''}
      </div>
      ${desc ? `<div class="dict-toolbar-desc">${escapeHtml(desc)}</div>` : ''}
    </div>
    <div class="dict-toolbar-right">
      ${showSearch ? `
        <div class="dict-search-wrap">
          <i data-lucide="search" style="width:14px;height:14px"></i>
          <input type="search" class="dict-search-input" id="dictSearchInput"
                 placeholder="关键词检索"
                 value="${searchValue}"
                 oninput="dictOnSearchInput(this.value)">
        </div>` : ''}
      <label class="dict-inactive-toggle">
        <input type="checkbox" id="dictIncludeInactive"
               ${dictPageState.includeInactive ? 'checked' : ''}
               onchange="dictOnIncludeInactiveChange(this.checked)">
        <span>显示停用</span>
      </label>
      <button type="button" class="btn btn-primary btn-sm" onclick="dictOpenEditor(null)">
        <i data-lucide="plus" style="width:14px;height:14px"></i> 新建
      </button>
    </div>
  `;
}

async function dictSelectCategory(group, category) {
  dictPageState.group = group;
  dictPageState.category = category;
  dictPageState.q = '';
  dictPageState.includeInactive = false;
  const sidebar = document.getElementById('dictSidebar');
  if (sidebar) sidebar.innerHTML = dictSidebarHtml();
  const toolbar = document.getElementById('dictMainToolbar');
  if (toolbar) toolbar.innerHTML = dictToolbarHtml();
  renderLucideIcons();
  await dictLoadList();
}

function dictOnSearchInput(v) {
  dictPageState.q = String(v || '').trim();
  if (dictPageState._searchTimer) clearTimeout(dictPageState._searchTimer);
  dictPageState._searchTimer = setTimeout(() => dictLoadList(), 200);
}

function dictOnIncludeInactiveChange(checked) {
  dictPageState.includeInactive = !!checked;
  dictLoadList();
}

async function dictLoadList() {
  const listEl = document.getElementById('dictMainList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty-state">加载中...</div>';
  try {
    if (dictPageState.group === 'dict' || dictPageState.group === 'custom') {
      try {
        const cats = await api('GET', '/dict/categories');
        const map = {};
        (cats || []).forEach((c) => { map[c.category] = c; });
        dictPageState.catStats = map;
        const sb = document.getElementById('dictSidebar');
        if (sb) { sb.innerHTML = dictSidebarHtml(); renderLucideIcons(); }
      } catch (e) { /* 统计失败不影响主列表 */ }
      const qs = new URLSearchParams();
      qs.set('category', dictPageState.category);
      if (dictPageState.q) qs.set('q', dictPageState.q);
      if (dictPageState.includeInactive) qs.set('includeInactive', '1');
      const rows = await api('GET', `/dict?${qs.toString()}`);
      dictPageState.rows = rows || [];
      dictRenderDictList();
    } else {
      const qs = new URLSearchParams();
      qs.set('category', dictPageState.category);
      qs.set('includeInactive', '1');
      const rows = await api('GET', `/lookups?${qs.toString()}`);
      dictPageState.rows = rows || [];
      dictRenderLookupList();
    }
    renderLucideIcons();
  } catch (e) {
    console.error('字典加载失败:', e);
    listEl.innerHTML = `<div class="empty-state">加载失败：${escapeHtml(e.message || '未知错误')}</div>`;
  }
}

/** 通讯录列表渲染 */
function dictRenderDictList() {
  const listEl = document.getElementById('dictMainList');
  const def = dictCurrentCategoryDef();
  const rows = dictPageState.rows || [];
  const countEl = document.getElementById('dictToolbarCount');
  if (countEl) {
    let activeCount = 0;
    let totalCount = rows.length;
    rows.forEach((r) => { if (r.is_active) activeCount++; });
    countEl.textContent = dictPageState.includeInactive
      ? `${activeCount} 启用 / ${totalCount - activeCount} 停用`
      : `${activeCount} 条`;
  }
  if (!rows.length) {
    listEl.innerHTML = `
      <div class="dict-empty">
        <i data-lucide="inbox" style="width:32px;height:32px"></i>
        <div class="dict-empty-title">暂无${escapeHtml(def ? def.label : '记录')}</div>
        <div class="dict-empty-hint">点击右上角「新建」开始添加</div>
      </div>`;
    return;
  }
  listEl.innerHTML = `
    <div class="dict-card-grid">
      ${rows.map((r) => dictCardHtml(r, def)).join('')}
    </div>
  `;
}

function dictCardHtml(row, def) {
  const c = row.content || {};
  // 摘要：除主名字段外的字段，串接前 3 个非空值
  const summaryFields = (def?.fields || []).filter((f) => f.key !== (def?.nameField || ''));
  const summaryParts = [];
  for (const f of summaryFields) {
    const v = c[f.key];
    if (v && String(v).trim()) {
      summaryParts.push(`${f.label}：${escapeHtml(String(v))}`);
      if (summaryParts.length >= 3) break;
    }
  }
  const tagsArr = (row.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
  const inactive = !row.is_active;
  return `
    <div class="dict-card ${inactive ? 'is-inactive' : ''} ${row.pinned ? 'is-pinned' : ''}">
      <div class="dict-card-head">
        <div class="dict-card-title">
          ${row.pinned ? '<i data-lucide="pin" style="width:12px;height:12px;color:var(--accent)"></i>' : ''}
          <span>${escapeHtml(row.name || '(未命名)')}</span>
          ${inactive ? '<span class="dict-card-badge dict-badge-inactive">已停用</span>' : ''}
        </div>
        <div class="dict-card-actions">
          <button type="button" class="icon-btn" title="${row.pinned ? '取消置顶' : '置顶'}"
                  onclick="dictTogglePin(${row.id}, ${row.pinned ? 0 : 1})">
            <i data-lucide="${row.pinned ? 'pin-off' : 'pin'}" style="width:13px;height:13px"></i>
          </button>
          <button type="button" class="icon-btn" title="编辑" onclick="dictOpenEditor(${row.id})">
            <i data-lucide="pencil" style="width:13px;height:13px"></i>
          </button>
          ${inactive
            ? `<button type="button" class="icon-btn" title="启用" onclick="dictToggleActive(${row.id}, true)">
                <i data-lucide="rotate-ccw" style="width:13px;height:13px"></i>
              </button>`
            : `<button type="button" class="icon-btn" title="停用" onclick="dictToggleActive(${row.id}, false)">
                <i data-lucide="archive" style="width:13px;height:13px"></i>
              </button>`}
          <button type="button" class="icon-btn icon-btn-danger" title="彻底删除"
                  onclick="dictHardDelete(${row.id})">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i>
          </button>
        </div>
      </div>
      ${row.short_label ? `<div class="dict-card-short">${escapeHtml(row.short_label)}</div>` : ''}
      ${summaryParts.length ? `<div class="dict-card-summary">${summaryParts.join(' · ')}</div>` : ''}
      ${tagsArr.length ? `<div class="dict-card-tags">${tagsArr.map((t) => `<span class="dict-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      ${row.remarks ? `<div class="dict-card-remarks">${escapeHtml(row.remarks)}</div>` : ''}
      <div class="dict-card-foot">
        <span>使用 ${Number(row.use_count || 0)} 次</span>
        ${row.last_used_at ? `<span>上次 ${escapeHtml(String(row.last_used_at).slice(0, 10))}</span>` : ''}
        ${row.created_by ? `<span>创建人 ${escapeHtml(row.created_by)}</span>` : ''}
      </div>
    </div>
  `;
}

/** 打开通讯录编辑/新建弹窗（modal） */
