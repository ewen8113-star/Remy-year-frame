/* 酒品目录页面模块：从 app.js 机械迁移，保持原有主数据维护逻辑。 */

/* =============================================
   页面：酒品目录（主数据，无库存数量）
   ============================================= */
let wineCatalogEditId = null;
/** 与 src/routes/wine.js 中 wineCatalogUploadDir、返回的 url 一致 */
const WINE_CATALOG_IMAGE_STORAGE_HINT = `<p class="form-hint" style="margin:0 0 8px;font-size:12px;line-height:1.45;color:var(--text-secondary)">上传文件写入项目目录 <code style="font-size:11px">public/uploads/wine-catalog/</code>（相对仓库根目录），对外 URL 形如 <code style="font-size:11px">/uploads/wine-catalog/文件名</code>；数据库表 <code style="font-size:11px">wine_catalog.image_urls</code>（JSON）存完整路径。请勿手动删除该目录内文件，否则目录列表会缺图。</p>`;

async function apiWineCatalogUpload(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API}/wine/catalog/upload`, { method: 'POST', credentials: 'include', body: fd });
  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    data = {};
  }
  if (!res.ok) throw new Error(data.error || data.message || '上传失败');
  return data.url;
}

function wcRefreshWineCatalogImagePreview() {
  const el = document.getElementById('wcImagePreview');
  const ta = document.getElementById('wcImages');
  if (!el || !ta) return;
  const urls = (ta.value || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!urls.length) {
    el.innerHTML = '<span style="color:var(--text-muted);font-size:12px">暂无预览</span>';
    return;
  }
  const shown = urls.slice(0, 12);
  const imgs = shown
    .map(
      (u) =>
        `<img src="${escapeHtml(u)}" alt="" style="width:48px;height:48px;object-fit:contain;border-radius:6px;background:var(--bg-primary);border:1px solid var(--border)">`
    )
    .join(' ');
  const more =
    urls.length > 12
      ? `<span style="font-size:12px;color:var(--text-muted);margin-left:6px">+${urls.length - 12}</span>`
      : '';
  el.innerHTML = imgs + more;
}

async function wcWineCatalogImageUpload() {
  const input = document.getElementById('wcImageFile');
  const f = input?.files?.[0];
  if (!f) {
    showToast('请选择图片', 'warning');
    return;
  }
  try {
    const url = await apiWineCatalogUpload(f);
    const ta = document.getElementById('wcImages');
    if (!ta) return;
    const lines = (ta.value || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    lines.push(url);
    ta.value = lines.join('\n');
    if (input) input.value = '';
    wcRefreshWineCatalogImagePreview();
    showToast('图片已追加到列表', 'success');
  } catch (e) {
    showToast(e.message || '上传失败', 'error');
  }
}

/** 兼容旧入口：酒品目录已并入「库存管理」与仓库同排卡片 */
async function renderWine() {
  navigate('wine');
}

async function loadWineCatalogPage() {
  const host = document.getElementById('wineCatalogListHost');
  const statsEl = document.getElementById('wineCatalogStats');
  if (!host) return;
  try {
    const rows = await api('GET', '/wine/catalog');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-card" style="min-width:180px">
          <div class="stat-label">目录条数</div>
          <div class="stat-value">${rows.length}</div>
        </div>`;
    }
    if (!rows.length) {
      host.innerHTML =
        '<div class="empty-state">暂无目录数据。点击「添加酒品」录入单条，或稍后导入完整数据。若需清空旧全局酒品库存表，可在服务器执行：<code>npm run migrate:wine-catalog</code></div>';
      renderLucideIcons();
      return;
    }
    host.innerHTML = `
      <div class="table-wrapper act-table-scroll-wrap">
        <table class="data-table act-table-sticky-head">
          <thead>
            <tr>
              <th style="width:72px">图</th>
              <th>品牌</th>
              <th>名称</th>
              <th>类别</th>
              <th>容量</th>
              <th style="width:130px">操作</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((r) => {
                const img =
                  Array.isArray(r.image_urls) && r.image_urls[0]
                    ? `<img src="${escapeHtml(r.image_urls[0])}" alt="" style="width:56px;height:56px;object-fit:contain;border-radius:6px;background:var(--bg-primary)">`
                    : '<span style="color:var(--text-muted);font-size:12px">—</span>';
                return `<tr>
                <td>${img}</td>
                <td>${escapeHtml(r.brand || '—')}</td>
                <td style="font-weight:600">${escapeHtml(r.name)}</td>
                <td>${escapeHtml(r.category || '—')}</td>
                <td>${escapeHtml(r.volume_label || '—')}</td>
                <td>
                  <button type="button" class="btn btn-secondary btn-xs" onclick="openWineCatalogModal(${r.id})">编辑</button>
                  <button type="button" class="btn btn-ghost btn-xs" style="color:var(--danger)" onclick="deleteWineCatalogItem(${r.id})">删除</button>
                </td>
              </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>`;
    renderLucideIcons();
  } catch (e) {
    const msg = String(e && e.message ? e.message : '');
    if (/\b404\b/.test(msg)) {
      host.innerHTML =
        '<div class="empty-state">暂无物品目录。点击上方「同步目录（PHD/X.O/CLUB）」即可生成首批目录数据。</div>';
      return;
    }
    host.innerHTML = `<div style="color:var(--danger);padding:16px">加载失败：${escapeHtml(msg || '')}</div>`;
  }
}

async function openWineCatalogModal(id) {
  const title = document.getElementById('wineCatalogModalTitle');
  const body = document.getElementById('wineCatalogModalBody');
  if (!body) return;
  wineCatalogEditId = id != null && Number.isFinite(Number(id)) ? Number(id) : null;
  if (title) title.textContent = wineCatalogEditId ? '编辑酒品' : '添加酒品';

  let data = {
    brand: '',
    name: '',
    category: '',
    volume_label: '',
    sort_order: 0,
    image_urls: [],
  };
  if (wineCatalogEditId) {
    try {
      data = await api('GET', `/wine/catalog/${wineCatalogEditId}`);
    } catch (e) {
      showToast(e.message || '加载失败', 'error');
      return;
    }
  }

  const imgText = Array.isArray(data.image_urls) ? data.image_urls.join('\n') : '';
  body.innerHTML = `
    <input type="hidden" id="wcId" value="${wineCatalogEditId || ''}">
    <div class="form-group">
      <label class="form-label">品牌</label>
      <input type="text" class="form-control" id="wcBrand" value="${escapeHtml(data.brand || '')}" placeholder="如 PHD、X.O">
    </div>
    <div class="form-group">
      <label class="form-label">名称 <span class="required">*</span></label>
      <input type="text" class="form-control" id="wcName" value="${escapeHtml(data.name || '')}" placeholder="酒品名称" required>
    </div>
    <div class="form-group">
      <label class="form-label">类别</label>
      <input type="text" class="form-control" id="wcCategory" value="${escapeHtml(data.category || '')}" placeholder="如 干邑、威士忌、金酒" list="wcCategoryList">
      <datalist id="wcCategoryList">
        <option value="干邑"></option>
        <option value="威士忌"></option>
        <option value="金酒"></option>
        <option value="葡萄酒"></option>
        <option value="其他"></option>
      </datalist>
    </div>
    <div class="form-group">
      <label class="form-label">容量</label>
      <input type="text" class="form-control" id="wcVolume" value="${escapeHtml(data.volume_label || '')}" placeholder="如 700ml、1L">
    </div>
    <div class="form-group">
      <label class="form-label">排序</label>
      <input type="number" class="form-control" id="wcSort" value="${Number(data.sort_order) || 0}" step="1">
    </div>
    <div class="form-group">
      <label class="form-label">图片</label>
      ${WINE_CATALOG_IMAGE_STORAGE_HINT}
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px">
        <input type="file" id="wcImageFile" accept="image/jpeg,image/png,image/gif,image/webp" style="max-width:100%">
        <button type="button" class="btn btn-secondary btn-sm" onclick="wcWineCatalogImageUpload()">上传并追加到列表</button>
      </div>
      <div id="wcImagePreview" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:24px;margin-bottom:8px"></div>
      <label class="form-label" style="font-size:12px;color:var(--text-secondary)">图片 URL（每行一个；可上传或手工填写）</label>
      <textarea class="form-control" id="wcImages" rows="3" placeholder="每行一个图片地址" oninput="wcRefreshWineCatalogImagePreview()">${escapeHtml(imgText)}</textarea>
    </div>
  `;
  openModal('modalWineCatalog');
  wcRefreshWineCatalogImagePreview();
  renderLucideIcons();
}

async function submitWineCatalogForm() {
  const name = document.getElementById('wcName')?.value?.trim();
  if (!name) {
    showToast('请填写名称', 'warning');
    return;
  }
  const imgLines = (document.getElementById('wcImages')?.value || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const payload = {
    brand: document.getElementById('wcBrand')?.value || '',
    name,
    category: document.getElementById('wcCategory')?.value || null,
    volume_label: document.getElementById('wcVolume')?.value || null,
    sort_order: parseInt(document.getElementById('wcSort')?.value, 10) || 0,
    image_urls: imgLines,
  };
  try {
    if (wineCatalogEditId) {
      await api('PUT', `/wine/catalog/${wineCatalogEditId}`, payload);
      showToast('已保存', 'success');
    } else {
      await api('POST', '/wine/catalog', payload);
      showToast('已添加', 'success');
    }
    closeModal();
    if (document.getElementById('wineCatalogListHost')) await loadWineCatalogPage();
    updateBadges();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

async function deleteWineCatalogItem(id) {
  if (!window.confirm('确定从目录中删除该条？')) return;
  try {
    await api('DELETE', `/wine/catalog/${id}`);
    showToast('已删除', 'success');
    await loadWineCatalogPage();
    updateBadges();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

function invCatalogKey(name, dimensions) {
  return `${String(name || '').trim()}@@${String(dimensions || '').trim()}`;
}
