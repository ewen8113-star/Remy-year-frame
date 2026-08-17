let invAddWineModalState = {
  catalog: [],
  warehouses: [],
  warehouseId: null,
};
let invAddItemCatalogModalState = {
  catalog: [],
  warehouses: [],
  warehouseId: null,
};
let charts = {};
let costPendingYMFilter = localStorage.getItem('remy_costPendingYMFilter') || localStorage.getItem('remy_costNoCostYMFilter') || 'all';
let costWithCostYMFilter = localStorage.getItem('remy_costWithCostYMFilter') || 'all';
let costMarkedNoCostYMFilter = localStorage.getItem('remy_costMarkedNoCostYMFilter') || 'all';
let costSectionCollapsed = {
  pending: localStorage.getItem('remy_costSectionCollapsed_pending') === '1',
  withCost: localStorage.getItem('remy_costSectionCollapsed_withCost') === '1',
  noCost: localStorage.getItem('remy_costSectionCollapsed_noCost') === '1',
};

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    showToast('请通过 node 启动项目后在浏览器访问 http://localhost:端口/（不要直接打开 html 文件）', 'warning');
  }
  applyTheme(localStorage.getItem('remy_theme') || 'dark');
  await ensureLoggedIn();
  renderAuthUser();
  loadAppVersion();
  await loadYearFrames();
  await initBrands();
  initSidebarNavGroups();
  navigate(currentPage);
  checkConnection();
  renderLucideIcons();
  initHarmonyUiInteractions();
  bindModalEscapeClose();
  applyHarmonySurfaceAnimations(document);
});

document.addEventListener('click', (event) => {
  if (!dashboardDatePickerState.open) return;
  if (event.target && typeof event.target.closest === 'function' && event.target.closest('.dashboard-date-range-wrap')) {
    return;
  }
  const host = document.getElementById('dashboardDateRangeHost');
  if (host) {
    dashboardDatePickerState.open = false;
    renderDashboardDatePicker();
  }
});

async function ensureLoggedIn() {
  try {
    const ret = await api('GET', '/auth/me');
    currentUser = ret.user || null;
    currentUserRole = currentUser?.role || 'operator';
  } catch (_) {
    if (typeof window !== 'undefined') window.location.href = '/login.html';
  }
}

function hasWriteAccess() {
  return currentUserRole === 'admin';
}

function canRegisterReimbursement() {
  const role = String(currentUserRole || '').trim().toLowerCase();
  return role === 'admin' || role === 'operator';
}

function canManageUsers() {
  return currentUserRole === 'admin';
}

function isReimbursementRegistrationControl(el) {
  const oc = String(el && el.getAttribute ? el.getAttribute('onclick') : '');
  return /showReimbursement(?:Modal|Form)|saveReimbursementForm|deleteReimbursementRecord|reimbAppend(?:Invoice|Detail)Row|reimbRemove(?:Invoice|Detail)Row|reimbursement(?:MergeSelected|UnmergeRecord|SaveClaimStatus|DetailEdit|DetailDelete|DetailUnmerge|EditById)|triggerReimbursementImport|onReimbursementImportFileSelected|reimbursementImportConfirm/.test(oc);
}

function renderAuthUser() {
  const el = document.getElementById('authUserBadge');
  if (!el) return;
  const name = currentUser?.username || '未登录';
  const role = currentUser?.role || '-';
  el.textContent = `${name} (${role})`;
}

function getCurrentUserName() {
  return (currentUser && currentUser.username ? String(currentUser.username).trim() : '') || 'system';
}

function applyRoleUiGuards() {
  if (!hasWriteAccess()) {
    const selectors = [
      '[onclick*="showActivityModal("]',
      '[onclick*="showLogisticsModal("]',
      '[onclick*="showWarehouseModal("]',
      '[onclick*="showWineStockInModal("]',
      '[onclick*="showWineUsageModal("]',
      '[onclick*="showBrandModal("]',
      '[onclick*="showLookupEditModal("]',
      '[onclick*="showMaterialPurchaseModal"]',
      '[onclick*="showPropRepairModal"]',
      '[onclick*="showReimbursementModal"]',
      '[onclick*="showReimbursementForm"]',
      '[onclick*="showCorporatePaymentTodo"]',
      '[onclick*="saveReimbursementForm"]',
      '[onclick*="deleteReimbursementRecord"]',
      '[onclick*="reimbAppendInvoiceRow"]',
      '[onclick*="reimbRemoveInvoiceRow"]',
      '[onclick*="reimbAppendDetailRow"]',
      '[onclick*="reimbRemoveDetailRow"]',
      '[onclick*="paymentOrderConfirmSave"]',
      '[onclick*="paymentOrderSubmitPay"]',
      '[onclick*="paymentOrderDelete"]',
      '[onclick*="materialAppendCustomRow"]',
      '[onclick*="propRepairAppendCustomRow"]',
      '[onclick*="delete"]',
      'button.activity-row-remove-btn',
      '[onclick*="save"]',
      '[onclick*="confirmAddLookupOption"]',
      '[onclick*="toggleBrandActive"]',
      '[onclick*="invDeleteItem"]',
      '[onclick*="invQueueItemImageUpload"]',
      '[onclick*="invRemoveItemImageAt"]',
      '[onclick*="invOpenNewItemModal"]',
      '[onclick*="invOpenEditItem"]',
      '[onclick*="invSaveEditItem"]',
      '[onclick*="invCancelEditItem"]',
    ];
    document.querySelectorAll(selectors.join(',')).forEach((el) => {
      if (canRegisterReimbursement() && isReimbursementRegistrationControl(el)) return;
      el.style.display = 'none';
    });
    document.querySelectorAll('.inv-admin-only').forEach((el) => {
      el.style.display = 'none';
    });
  }
  if (!canManageUsers()) {
    const navUsers = document.getElementById('navUsers');
    if (navUsers) navUsers.style.display = 'none';
  }
  if (!hasWriteAccess()) {
    const navDashboard = document.getElementById('navDashboard');
    if (navDashboard) navDashboard.style.display = 'none';
  }
  if (!hasWriteAccess()) {
    const navInvMaster = document.getElementById('navInventoryMaster');
    if (navInvMaster) navInvMaster.style.display = 'none';
  }
  // 字典管理仅 admin 可见（含 5 类通讯录 + 7 类表单选项，编辑都属写操作）
  if (!hasWriteAccess()) {
    const navDict = document.getElementById('navDict');
    if (navDict) navDict.style.display = 'none';
  }
}

async function logout() {
  try {
    await api('POST', '/auth/logout');
  } catch (_) {
    // ignore
  }
  if (typeof window !== 'undefined') window.location.href = '/login.html';
}

function openChangePasswordModal() {
  const cur = document.getElementById('cpCurrent');
  const nw = document.getElementById('cpNew');
  const cf = document.getElementById('cpConfirm');
  if (cur) cur.value = '';
  if (nw) nw.value = '';
  if (cf) cf.value = '';
  openModal('modalChangePassword');
}

async function submitChangePassword() {
  const current_password = document.getElementById('cpCurrent')?.value || '';
  const new_password = document.getElementById('cpNew')?.value || '';
  const confirm = document.getElementById('cpConfirm')?.value || '';
  if (!current_password || !new_password) {
    showToast('请填写当前密码与新密码', 'warning');
    return;
  }
  if (new_password.length < 8) {
    showToast('新密码至少 8 位', 'warning');
    return;
  }
  if (new_password !== confirm) {
    showToast('两次输入的新密码不一致', 'warning');
    return;
  }
  try {
    await api('POST', '/auth/change-password', { current_password, new_password });
    showToast('密码已更新', 'success');
    closeModal();
  } catch (err) {
    showToast(err.message || '修改失败', 'error');
  }
}

function openAdminResetPasswordModal(userId, username) {
  document.getElementById('arpUserId').value = String(userId);
  const el = document.getElementById('arpUsername');
  if (el) el.textContent = username || '';
  const nw = document.getElementById('arpNew');
  const cf = document.getElementById('arpConfirm');
  if (nw) nw.value = '';
  if (cf) cf.value = '';
  openModal('modalAdminResetPassword');
}

async function submitAdminResetPassword() {
  const id = parseInt(document.getElementById('arpUserId')?.value || '0', 10);
  const new_password = document.getElementById('arpNew')?.value || '';
  const confirm = document.getElementById('arpConfirm')?.value || '';
  if (!id) {
    showToast('无效用户', 'warning');
    return;
  }
  if (new_password.length < 8) {
    showToast('新密码至少 8 位', 'warning');
    return;
  }
  if (new_password !== confirm) {
    showToast('两次输入的新密码不一致', 'warning');
    return;
  }
  try {
    await api('PUT', `/users/${id}/password`, { new_password });
    showToast('已重置该用户密码', 'success');
    closeModal();
    if (currentPage === 'users') await renderUsers();
  } catch (err) {
    showToast(err.message || '重置失败', 'error');
  }
}

// ===== 年框管理 =====
async function loadYearFrames() {
  try {
    const frames = await api('GET', '/year-frames');
    const pickYear = String(currentYear || '').padStart(2, '0');
    // 仅按 year 字段精准匹配（避免 name 中出现“25-26”导致 26 命中到 25）
    let target = (frames || []).find((f) => {
      const y = String(f?.year || '').trim();
      return y === `${pickYear}年度` || y === pickYear || y.startsWith(pickYear);
    });
    if (!target && Array.isArray(frames) && frames.length) {
      const byNum = frames.find((f) => String(f?.id || '') === pickYear);
      // 勿默认 frames[0]（常为更早财年）；优先当前财年匹配，否则取最新一条
      const currentFy = getFiscalYearCodeForDate();
      const byCurrentFy = frames.find((f) => {
        const y = String(f?.year || '').trim();
        return y === `${currentFy}年度` || y === currentFy || y.startsWith(currentFy);
      });
      target = byNum || byCurrentFy || frames[frames.length - 1];
    }
    if (target) currentYearFrameId = target.id;

    // 页面刷新后回显用户上次选中的年度按钮
    document.querySelectorAll('.year-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.year === pickYear);
    });
    const badge = document.getElementById('yearBadge');
    if (badge) badge.textContent = `${pickYear}年度`;
    updateYearFrameHint(NaN);
    updateBadges();
  } catch (e) {
    console.error('加载年框失败', e);
  }
}

function switchYear(year) {
  currentYear = year;
  localStorage.setItem('remy_activeYear', year);
  document.querySelectorAll('.year-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.year === year);
  });
  document.getElementById('yearBadge').textContent = year + '年度';
  const defaultDashboardDateRange = getDashboardDefaultDateRange();
  dashboardState = {
    brand: '',
    region: '',
    activityType: '',
    executionFlag: '',
    pgFlag: '',
    period: '',
    dateStart: defaultDashboardDateRange.start,
    dateEnd: defaultDashboardDateRange.end,
    compareRegion: '',
  };
  dashboardDrillRegion = null;
  loadYearFrames().then(() => navigate(currentPage));
}
