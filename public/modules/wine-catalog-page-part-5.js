let _brandCache = [];
const FIXED_BRAND_CODES = ['RC', 'PHD', 'CLUB', 'X.O'];

// 初始化时加载品牌列表
async function initBrands() {
  try {
    _brandCache = await api('GET', '/brand');
    renderBrandOptions();
  } catch (err) {
    console.error('加载品牌列表失败:', err);
    // 降级使用默认选项
    _brandCache = [
      { brand_code: 'PHD', brand_name: 'PHD' },
      { brand_code: 'X.O', brand_name: 'X.O' },
      { brand_code: 'CLUB', brand_name: 'CLUB' },
      { brand_code: 'REMY', brand_name: 'REMY' },
    ];
    renderBrandOptions();
  }
}

function renderBrandOptions() {
  const activityBrandSelect = document.getElementById('actBrandField');
  if (activityBrandSelect) {
    const currentVal = activityBrandSelect.value || 'PHD';
    activityBrandSelect.innerHTML = FIXED_BRAND_CODES
      .map((b) => `<option value="${b}">${b}</option>`)
      .join('');
    activityBrandSelect.value = FIXED_BRAND_CODES.includes(currentVal) ? currentVal : 'PHD';
  }

  const otherSelects = [
    document.getElementById('actBrand'),
    document.getElementById('dashFilterBrand'),
    document.getElementById('reimbBrand'),
  ];
  otherSelects.forEach(sel => {
    if (!sel) return;
    const currentVal = sel.value;
    const emptyLabel = sel.id === 'dashFilterBrand' ? '品牌' : '全部品牌';
    sel.innerHTML = `<option value="">${emptyLabel}</option>` +
      FIXED_BRAND_CODES.map((code) => `<option value="${code}">${code}</option>`).join('');
    if (currentVal && FIXED_BRAND_CODES.includes(currentVal)) {
      sel.value = currentVal;
    }
  });
}

async function showBrandModal() {
  const content = document.getElementById('brandContent');
  content.innerHTML = `<div style="color:var(--text-muted);padding:20px;text-align:center">加载中...</div>`;
  openModal('modalBrand');

  try {
    const brands = await api('GET', '/brand');
    _brandCache = brands;

    const COLORS = ['gray', 'blue', 'green', 'orange', 'purple', 'pink', 'red', 'cyan'];
    content.innerHTML = `
      <div style="margin-bottom:16px">
        <button class="btn btn-primary btn-sm" onclick="showAddBrandForm()">+ 新增品牌</button>
      </div>
      <div id="addBrandForm" style="display:none;padding:12px;background:var(--bg-primary);border-radius:var(--radius-sm);margin-bottom:16px">
        <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <input type="text" id="newBrandCode" class="form-control" placeholder="品牌编码（如 PHD12年）" style="font-size:13px">
          <input type="text" id="newBrandName" class="form-control" placeholder="显示名称" style="font-size:13px">
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-size:12px;color:var(--text-muted)">颜色:</span>
          ${COLORS.map(c => `<span class="brand-color-dot ${c}" data-color="${c}" onclick="selectBrandColor('${c}')" style="width:18px;height:18px;border-radius:50%;background:var(--${c === 'gray' ? 'text-muted' : c});cursor:pointer;border:2px solid transparent;display:inline-block"></span>`).join('')}
          <input type="hidden" id="newBrandColor" value="gray">
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" onclick="confirmAddBrand()">保存</button>
          <button class="btn btn-secondary btn-sm" onclick="hideAddBrandForm()">取消</button>
        </div>
      </div>
      <div id="brandList">
        <table class="data-table" style="font-size:13px">
          <thead>
            <tr>
              <th>编码</th>
              <th>名称</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${brands.map(b => `
              <tr id="brand-row-${b.id}">
                <td><span class="badge badge-${b.brand_color || 'gray'}">${b.brand_code}</span></td>
                <td>${b.brand_name}</td>
                <td><span style="font-size:11px;color:${b.is_active ? 'var(--success)' : 'var(--text-muted)'}">${b.is_active ? '✓ 启用' : '✗ 停用'}</span></td>
                <td style="white-space:nowrap">
                  <button class="btn btn-xs btn-ghost" onclick="showEditBrand(${b.id})" title="编辑"><i data-lucide="pencil" style="width:12px;height:12px"></i></button>
                  ${b.is_active ? `<button class="btn btn-xs btn-ghost" onclick="toggleBrandActive(${b.id}, false)" title="停用"><i data-lucide="pause" style="width:12px;height:12px"></i></button>` : `<button class="btn btn-xs btn-ghost" onclick="toggleBrandActive(${b.id}, true)" title="启用"><i data-lucide="play" style="width:12px;height:12px"></i></button>`}
                </td>
              </tr>
              <tr id="brand-edit-${b.id}" style="display:none;background:var(--bg-primary)">
                <td colspan="4" style="padding:12px">
                  <div class="form-grid" style="grid-template-columns:1fr 1fr 80px;gap:8px;align-items:center">
                    <input type="text" id="editBrandCode-${b.id}" class="form-control" value="${b.brand_code}" style="font-size:13px">
                    <input type="text" id="editBrandName-${b.id}" class="form-control" value="${b.brand_name}" style="font-size:13px">
                    <button class="btn btn-primary btn-sm" onclick="confirmEditBrand(${b.id})">保存</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    renderBrandOptions();
    renderLucideIcons();
  } catch (err) {
    content.innerHTML = `<div style="color:var(--danger)">加载失败: ${err.message}</div>`;
  }
}

function showAddBrandForm() {
  document.getElementById('addBrandForm').style.display = 'block';
  document.getElementById('newBrandCode').value = '';
  document.getElementById('newBrandName').value = '';
  document.getElementById('newBrandColor').value = 'gray';
}

function hideAddBrandForm() {
  document.getElementById('addBrandForm').style.display = 'none';
}

function selectBrandColor(color) {
  document.querySelectorAll('.brand-color-dot').forEach(el => {
    el.style.border = '2px solid transparent';
  });
  document.querySelector(`[data-color="${color}"]`).style.border = '2px solid var(--text)';
  document.getElementById('newBrandColor').value = color;
}

async function confirmAddBrand() {
  const code = document.getElementById('newBrandCode').value.trim();
  const name = document.getElementById('newBrandName').value.trim();
  const color = document.getElementById('newBrandColor').value;

  if (!code || !name) {
    showToast('品牌编码和名称不能为空', 'error');
    return;
  }

  try {
    await api('POST', '/brand', { brand_code: code, brand_name: name, brand_color: color });
    showToast('品牌已添加', 'success');
    showBrandModal();
  } catch (err) {
    showToast(err.message || '添加失败', 'error');
  }
}

function showEditBrand(id) {
  const row = document.getElementById(`brand-edit-${id}`);
  if (row) {
    row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
  }
}

async function confirmEditBrand(id) {
  const code = document.getElementById(`editBrandCode-${id}`).value.trim();
  const name = document.getElementById(`editBrandName-${id}`).value.trim();

  if (!code || !name) {
    showToast('品牌编码和名称不能为空', 'error');
    return;
  }

  try {
    await api('PUT', `/brand/${id}`, { brand_code: code, brand_name: name });
    showToast('品牌已更新', 'success');
    showBrandModal();
  } catch (err) {
    showToast(err.message || '更新失败', 'error');
  }
}

async function toggleBrandActive(id, active) {
  try {
    await api('PUT', `/brand/${id}`, { is_active: active });
    showToast(active ? '品牌已启用' : '品牌已停用', 'success');
    showBrandModal();
  } catch (err) {
    showToast(err.message || '操作失败', 'error');
  }
}
