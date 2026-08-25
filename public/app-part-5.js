function applyHarmonySurfaceAnimations(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const selectors = '.stats-grid .stat-card, .chart-grid .chart-card, .card, .table-wrapper, .filter-bar, .toolbar';
  const nodes = root.querySelectorAll(selectors);
  nodes.forEach((el, index) => {
    if (el.dataset.harmonyAnimated === '1') return;
    el.dataset.harmonyAnimated = '1';
    el.classList.add('harmony-enter');
    const delay = Math.min(index * 28, 240);
    el.style.setProperty('--h-delay', `${delay}ms`);
  });
}

// ===== 主题 =====
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

const THEME_ICON_MOON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const THEME_ICON_SUN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('remy_theme', theme);
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  if (theme === 'dark') {
    btn.innerHTML = THEME_ICON_MOON;
    btn.title = '切换到亮色模式';
    btn.setAttribute('aria-label', '当前为暗色主题，点击切换到亮色');
  } else {
    btn.innerHTML = THEME_ICON_SUN;
    btn.title = '切换到暗色模式';
    btn.setAttribute('aria-label', '当前为亮色主题，点击切换到暗色');
  }
}

async function loadAppVersion() {
  const el = document.getElementById('appVersion');
  if (!el) return;
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`);
    if (!r.ok) throw new Error('version fetch failed');
    const j = await r.json();
    if (j && typeof j.version === 'string' && j.version.trim()) el.textContent = j.version.trim();
  } catch (_) {
    /* 保留 index.html 中的默认文案 */
  }
}

// ===== 连接状态 =====
async function checkConnection() {
  try {
    await fetch(`${API}/health`);
    document.getElementById('connectionStatus').innerHTML = '<span class="status-dot"></span><span>已连接</span>';
  } catch {
    document.getElementById('connectionStatus').innerHTML = '<span class="status-dot" style="background:var(--danger)"></span><span>离线</span>';
  }
}

function isModalEscapeBlocked() {
  const reimbMenu = document.getElementById('reimbProjectMenu');
  if (reimbMenu && reimbMenu.style.display === 'block') return true;
  const invMenu = document.getElementById('invProjectMenu');
  if (invMenu && invMenu.style.display === 'block') return true;
  if (typeof dashboardDatePickerState !== 'undefined' && dashboardDatePickerState.open) return true;
  return !!document.querySelector('.aq-pc-menu-portal[style*="display: block"]');
}

function cleanupModalBeforeClose(modalId) {
  if (modalId === 'modalInvItemEdit') {
    const b = document.getElementById('invItemEditModalBody');
    if (b) b.innerHTML = '';
    if (typeof inventoryPageState !== 'undefined') inventoryPageState.itemModalMode = null;
  }
  if (modalId === 'modalInvOutboundPdf') {
    invResetOutboundPdfModal();
  }
  if (modalId === 'modalInvReturn') {
    const rb = document.getElementById('invReturnModalBody');
    if (rb) rb.innerHTML = '';
    if (typeof inventoryPageState !== 'undefined') {
      inventoryPageState.returnDetail = null;
      inventoryPageState.returnOrderId = null;
    }
  }
  if (modalId === 'modalActivity') {
    const m = document.getElementById('modalActivity');
    if (m) m.classList.remove('modal-activity--virtual');
    const vh = document.getElementById('actIsVirtual');
    if (vh) vh.value = '0';
    const cityEl = document.getElementById('actCity');
    if (cityEl) cityEl.setAttribute('required', 'required');
    const dateEl = document.getElementById('actDate');
    if (dateEl) dateEl.setAttribute('required', 'required');
  }
}

function normalizeCloudAlbumUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function openActivityCloudAlbum(rawUrl) {
  const url = normalizeCloudAlbumUrl(rawUrl);
  if (!url) {
    showToast('无相册', 'warning');
    return;
  }
  const popup = window.open(
    url,
    '_blank',
    'popup=yes,width=1000,height=800,resizable=yes,scrollbars=yes'
  );
  if (!popup) {
    showToast('弹窗被拦截，请允许浏览器弹窗后重试', 'warning');
  }
}

/** 有云相册链接：可点击；无链接：灰显禁用（列表与详情统一） */
function activityCloudAlbumButtonHtml(rawUrl, opts) {
  const o = opts || {};
  const hasLink = !!normalizeCloudAlbumUrl(rawUrl || '');
  const label = o.detailLabel && hasLink ? '查看云相册' : '云相册';
  if (hasLink) {
    return `<button type="button" class="btn btn-secondary btn-sm" onclick="openActivityCloudAlbum('${escapeJsSingleQuoted(rawUrl || '')}')">${label}</button>`;
  }
  return `<button type="button" class="btn btn-secondary btn-sm btn-cloud-album-muted" disabled title="未填写云相册地址">${label}</button>`;
}

// ===== 工具函数 =====
function parseWineDetails(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** 报价含税 6% 时，反算不含税金额 */
function quotedPriceExTax(quotedInclusive) {
  return roundMoney2((parseFloat(quotedInclusive) || 0) / 1.06);
}

/** 场次业务日历（北京时间），用于年月筛选 */
function activityBusinessYm(raw) {
  const p = beijingParts(raw);
  return p ? { year: p.year, month: p.month } : null;
}

/** 物资/入库台账：从 API 日期（含 UTC ISO）取北京时间 YYYY-MM-DD */
function invBusinessYmd(raw) {
  const p = beijingParts(raw);
  if (!p) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// ===== 更新 badge 数量 =====
async function updateBadges() {
  try {
    const qs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}&isVirtual=0` : '?isVirtual=0';
    const vqs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}&isVirtual=1` : '?isVirtual=1';
    const [acts, vacts, logs, wars, materials, propRepairs, reimbs, wines, itemCatalog] = await Promise.all([
      api('GET', `/activities${qs}`),
      api('GET', `/activities${vqs}`),
      api('GET', `/logistics${qs}`),
      api('GET', `/warehouse${qs}`),
      api('GET', `/material-purchases${qs}`),
      api('GET', `/prop-repairs${qs}`),
      api('GET', `/reimbursements${qs}`),
      api('GET', '/wine/catalog'),
      api('GET', '/inventory/item-catalog'),
    ]);
    let invOpen = 0;
    try {
      const ob = await api('GET', `/inventory/outbound${invOutboundListQuery({ status: 'open' })}`);
      invOpen = Array.isArray(ob) ? ob.length : 0;
    } catch (_) {
      invOpen = 0;
    }
    document.getElementById('badge-activities').textContent = acts.length || 0;
    const vb = document.getElementById('badge-virtual-activities');
    if (vb) vb.textContent = Array.isArray(vacts) ? vacts.length : 0;
    updateYearFrameHint(Array.isArray(acts) ? acts.length : 0);
    document.getElementById('badge-logistics').textContent = logs.length || 0;
    document.getElementById('badge-warehouse').textContent = wars.length || 0;
    const materialBadge = document.getElementById('badge-material');
    if (materialBadge) {
      // 额外成本列表 = 直接登记 material_purchases + 报销单中所有"不计入活动"的派生（cost_module ≠ activity）
      const reimbExtraCount = (Array.isArray(reimbs) ? reimbs : []).filter(
        (r) => String(r.cost_module || '') && String(r.cost_module || '') !== 'activity'
      ).length;
      materialBadge.textContent = (materials.length || 0) + reimbExtraCount;
    }
    const propRepairBadge = document.getElementById('badge-prop-repair');
    if (propRepairBadge) propRepairBadge.textContent = propRepairs.length || 0;
    const reimbBadge = document.getElementById('badge-reimbursement');
    if (reimbBadge) reimbBadge.textContent = reimbs.length || 0;
    const rows = Array.isArray(wines) ? wines : [];
    const n = rows.length;
    const wineBadgeCatalog = document.getElementById('badge-wine-catalog');
    if (wineBadgeCatalog) {
      wineBadgeCatalog.textContent = n ? `${n} 条` : '—';
      wineBadgeCatalog.style.color = n ? 'var(--text-secondary)' : 'var(--text-muted)';
      wineBadgeCatalog.title = n ? `酒品目录 ${n} 条（主数据，不含分仓库存）` : '暂无目录项';
    }
    const itemCatalogBadge = document.getElementById('badge-item-catalog');
    if (itemCatalogBadge) {
      const c = Array.isArray(itemCatalog) ? itemCatalog.length : 0;
      itemCatalogBadge.textContent = c ? `${c} 条` : '—';
      itemCatalogBadge.style.color = c ? 'var(--text-secondary)' : 'var(--text-muted)';
      itemCatalogBadge.title = c ? `物品目录 ${c} 条（全局主数据）` : '暂无目录项';
    }
    const invInBadge = document.getElementById('badge-inv-inbound');
    if (invInBadge) {
      if (invOpen > 0) {
        invInBadge.textContent = `${invOpen} 待归还`;
        invInBadge.style.color = 'var(--warning)';
      } else {
        invInBadge.textContent = '—';
        invInBadge.style.color = 'var(--text-muted)';
      }
    }
  } catch (e) {
    updateYearFrameHint(NaN);
  }
}
