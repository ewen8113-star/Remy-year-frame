function updateYearFrameHint(activityCount) {
  const el = document.getElementById('yearFrameHint');
  if (!el) return;
  const idText = currentYearFrameId ? `YF#${currentYearFrameId}` : 'YF#—';
  if (Number.isFinite(activityCount)) {
    el.textContent = `${idText} · 场次${activityCount}`;
    return;
  }
  el.textContent = `${idText} · 场次—`;
}

// ===== 导航 =====
function navigate(page) {
  if (page === 'dashboard' && !hasWriteAccess()) {
    page = 'activities';
  }
  if (page === 'users' && !canManageUsers()) {
    page = 'activities';
  }
  if (page === 'wine') {
    inventoryPageState.stockMasterView = 'wine';
    try {
      localStorage.setItem('remy_stockMasterView', 'wine');
    } catch (_) { /* ignore */ }
    page = 'inventory';
  }
  if (page === 'inv-empty') {
    inventoryPageState.stockMasterView = 'empty';
    try {
      localStorage.setItem('remy_stockMasterView', 'empty');
    } catch (_) { /* ignore */ }
    page = 'inventory';
  }
  if (page === 'inventory' && !hasWriteAccess()) {
    showToast('仅管理员可维护库存管理（仓库与物料主数据）', 'warning');
    page = 'inv-outbound';
  }
  if (page === 'dict' && !hasWriteAccess()) {
    showToast('仅管理员可访问字典管理', 'warning');
    page = 'activities';
  }
  currentPage = page;
  localStorage.setItem('remy_currentPage', page);

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  const titles = {
    dashboard: '数据看板',
    activities: '场次记录',
    'activity-quotes': '活动报价',
    'virtual-activities': '虚拟场次',
    calendar: '排期日历',
    cost: '活动成本',
    logistics: '物流成本',
    warehouse: '仓储成本',
    inventory: '库存管理',
    'inv-outbound': '物品出库',
    'inv-inbound': '物品入库',
    'inv-wine-stats': '用酒统计',
    material: '统筹成本',
    'prop-repair': '道具维修',
    reimbursement: '付款申请',
    reconcile: '临时对账',
    users: '用户管理',
    dict: '字典管理',
    backup: '数据备份',
  };
  document.getElementById('pageTitle').textContent = titles[page] || page;

  const container = document.getElementById('pageContainer');
  container.classList.remove('harmony-page-ready');
  container.classList.add('harmony-page-loading');
  container.innerHTML = '<div class="empty-state"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>';

  // 销毁旧图表
  Object.values(charts).forEach(c => c && c.destroy());
  charts = {};

  const renders = {
    dashboard: renderDashboard,
    activities: renderActivities,
    'activity-quotes': renderActivityQuotes,
    'virtual-activities': renderVirtualActivities,
    calendar: renderCalendar,
    cost: renderCost,
    logistics: renderLogistics,
    warehouse: renderWarehouse,
    inventory: renderInventory,
    'inv-outbound': renderInventory,
    'inv-inbound': renderInventory,
    'inv-wine-stats': renderWineUsageStats,
    material: renderMaterialPurchases,
    'prop-repair': renderPropRepairs,
    reimbursement: renderReimbursements,
    reconcile: renderReconcile,
    users: renderUsers,
    dict: renderDictManager,
    backup: renderBackup,
  };
  if (renders[page]) {
    Promise.resolve(renders[page]()).finally(() => {
      renderLucideIcons();
      applyRoleUiGuards();
      applyHarmonySurfaceAnimations(container);
      container.classList.remove('harmony-page-loading');
      container.classList.add('harmony-page-ready');
    });
  }
  expandSidebarGroupForPage(page);
}

/** 侧边栏：当前页所在分组自动展开 */
function expandSidebarGroupForPage(page) {
  const map = {
    dashboard: 'sys',
    activities: 'rec',
    'activity-quotes': 'rec',
    'virtual-activities': 'rec',
    calendar: 'rec',
    cost: 'cost',
    warehouse: 'cost',
    logistics: 'cost',
    material: 'cost',
    'prop-repair': 'cost',
    reimbursement: 'cost',
    reconcile: 'cost',
    inventory: 'stock',
    'inv-outbound': 'stock',
    'inv-inbound': 'stock',
    'inv-wine-stats': 'stock',
    users: 'sys',
    dict: 'sys',
    backup: 'sys',
  };
  const g = map[page];
  if (!g) return;
  const el = document.querySelector(`[data-nav-group="${g}"]`);
  if (!el) return;
  el.classList.remove('collapsed');
  const btn = el.querySelector('.nav-group-toggle');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  try {
    localStorage.removeItem(`remy_navGroup_${g}`);
  } catch (_) { /* ignore */ }
}

function toggleNavGroup(groupId) {
  const el = document.querySelector(`[data-nav-group="${groupId}"]`);
  if (!el) return;
  el.classList.toggle('collapsed');
  const collapsed = el.classList.contains('collapsed');
  const btn = el.querySelector('.nav-group-toggle');
  if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  try {
    if (collapsed) localStorage.setItem(`remy_navGroup_${groupId}`, '1');
    else localStorage.removeItem(`remy_navGroup_${groupId}`);
  } catch (_) { /* ignore */ }
  renderLucideIcons();
}

function initSidebarNavGroups() {
  document.querySelectorAll('.nav-group').forEach((el) => {
    const id = el.dataset.navGroup;
    if (!id) return;
    try {
      if (localStorage.getItem(`remy_navGroup_${id}`) === '1') {
        el.classList.add('collapsed');
        const btn = el.querySelector('.nav-group-toggle');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    } catch (_) { /* ignore */ }
  });
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
  document.getElementById('mainContent').classList.toggle('full-width');
}

function initHarmonyUiInteractions() {
  if (window.__harmonyUiInteractionBound) return;
  window.__harmonyUiInteractionBound = true;

  const pressSelector = '.btn, .nav-item, .year-btn, .page-btn, .inv-tab, .inv-view-opt, .theme-toggle-icon, .nav-group-toggle';
  const clearPressed = () => {
    document.querySelectorAll('.is-pressed').forEach((el) => el.classList.remove('is-pressed'));
  };

  document.addEventListener('pointerdown', (event) => {
    const target = event.target && typeof event.target.closest === 'function' ? event.target.closest(pressSelector) : null;
    if (!target) return;
    target.classList.add('is-pressed');
  });

  document.addEventListener('pointerup', clearPressed);
  document.addEventListener('pointercancel', clearPressed);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') clearPressed();
  });

  const inputSelector = '.form-control, .search-input, .filter-select';
  const syncFieldErrorState = (field) => {
    if (!field || !(field instanceof HTMLElement)) return;
    if (!field.matches(inputSelector)) return;
    const group = field.closest('.form-group');
    const required = field.required || field.getAttribute('aria-required') === 'true';
    const empty = String(field.value || '').trim() === '';
    const invalid = required && empty;
    field.classList.toggle('field-error', invalid);
    if (group) group.classList.toggle('is-invalid', invalid);
  };

  document.addEventListener('focusout', (event) => {
    const field = event.target;
    syncFieldErrorState(field);
  });

  document.addEventListener('input', (event) => {
    const field = event.target;
    if (!(field instanceof HTMLElement) || !field.matches(inputSelector)) return;
    if (field.classList.contains('field-error')) {
      syncFieldErrorState(field);
    }
  });
}
