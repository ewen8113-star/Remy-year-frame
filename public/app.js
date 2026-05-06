/* ===================================================
   人头马年框项目管理 - 前端主程序
   对接后端 API：
   - 正常：与页面同源 /api（用 node 启动后访问 http://localhost:端口/）
   - 若误用 file:// 打开本页：读 localStorage.remy_apiBase，否则默认 http://127.0.0.1:3088/api
   =================================================== */

function resolveApiBase() {
  try {
    if (typeof window === 'undefined' || !window.location) return '/api';
    const { protocol } = window.location;
    if (protocol === 'file:') {
      const custom = localStorage.getItem('remy_apiBase');
      if (custom) return String(custom).replace(/\/$/, '');
      return 'http://127.0.0.1:3088/api';
    }
  } catch (e) { /* ignore */ }
  return '/api';
}

const API = resolveApiBase();
// 25年度：2025-04-01 → 2026-03-31，所有历史数据均属于25年度
const savedActiveYearRaw = localStorage.getItem('remy_activeYear') || '25';
let currentYear = (String(savedActiveYearRaw).match(/\d{2}/) || ['25'])[0];
let currentYearFrameId = null;
/** 物品出库列表 query：按当前财年筛选（关联场次的 year_frame_id） */
function invOutboundListQuery(opts = {}) {
  const p = new URLSearchParams();
  if (opts.status) p.set('status', opts.status);
  if (currentYearFrameId) p.set('yearFrameId', String(currentYearFrameId));
  const q = p.toString();
  return q ? `?${q}` : '';
}

/** 入库单台账列表 query：仅按当前财年 */
function invInboundReceiptListQuery() {
  return invOutboundListQuery();
}
let currentPage = localStorage.getItem('remy_currentPage') || 'dashboard';
let currentUser = null;
let currentUserRole = 'operator';
let activitiesState = { page: 1, search: '', type: '', period: '', region: '', belonging: '', brand: '', year: '', month: '', sortOrder: 'DESC', data: [], total: 0 };
/** 虚拟场次（东南区预估报价 / 预存口径）；列表与场次记录同源 is_virtual=1 */
let virtualActivitiesState = {
  page: 1,
  search: '',
  brand: '',
  region: '东南区',
  sortOrder: 'DESC',
  data: [],
  total: 0,
};
/** activity_belonging：存储值 → 显示名（与场次页筛选项同源） */
let actBelongingLabelByValue = {};
let materialPageState = { filterBrandId: '', mergeFilter: 'all' };
let propRepairPageState = { filterBrandId: '', mergeFilter: 'all' };
let reimbursementPageState = { rows: [], activities: [], filterInput: '' };
const reimbursementActivityIndex = {
  codes: new Set(),
  codeToId: new Map(),
  idToCode: new Map(),
};
const REIMB_PAYMENT_TYPE_OPTIONS = [
  { value: 'personal_reimbursement', label: '个人报销' },
  { value: 'corporate_payment', label: '对公付款' },
];
const REIMB_COST_MODULE_OPTIONS = [
  { value: 'activity', label: '活动成本' },
  { value: 'warehouse', label: '仓储成本（月结）' },
  { value: 'logistics', label: '物流成本' },
  { value: 'prop_repair', label: '道具维修' },
  { value: 'general', label: '公共成本池' },
];
const REIMB_CLAIM_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'submitted', label: '待支付' },
  { value: 'paid', label: '已支付' },
  { value: 'rejected', label: '已驳回' },
];

function reimbPaymentTypeLabel(v) {
  return REIMB_PAYMENT_TYPE_OPTIONS.find((x) => x.value === v)?.label || '个人报销';
}
function reimbCostModuleLabel(v) {
  return REIMB_COST_MODULE_OPTIONS.find((x) => x.value === v)?.label || '活动成本';
}
function reimbClaimStatusLabel(v) {
  return REIMB_CLAIM_STATUS_OPTIONS.find((x) => x.value === v)?.label || '草稿';
}
function reimbClaimStatusBadgeClass(v) {
  if (v === 'paid') return 'badge-success';
  if (v === 'submitted') return 'badge-accent';
  if (v === 'rejected') return 'badge-danger';
  return 'badge-gray';
}
let logisticsState = { data: [], selectedIds: new Set() };
let warehouseState = { data: [], selectedIds: new Set() };
let logisticsMergeFilter = 'all';
let logisticsSortState = { key: 'shipping_date', dir: 'desc' };
let warehouseMergeFilter = 'all';
  /** 物资模块：库存管理=主数据；出库页为逐单列表；入库页 tab=returns */
let inventoryPageState = {
  tab: 'items',
  warehouseId: null,
  outboundLines: [],
  returnDraft: [],
  returnOrderId: null,
  returnDetail: null,
  linkMode: 'activity',
  /** 物品弹窗：new=添加，edit=编辑 */
  itemModalMode: null,
  /** 新建出库页头表单项（重绘前从 DOM 捕获，避免添加物料行时丢失已填项目编号等） */
  outboundForm: {
    linkMode: 'activity',
    project_code: '',
    purpose: '',
    activity_id: '',
    recipient_city: '',
    recipient_address: '',
    contact_name: '',
    contact_phone: '',
    logistics_method: '顺丰',
    tracking_number: '',
    remarks: '',
    hint_msg: '',
  },
  itemsViewMode: (() => {
    try {
      const v = localStorage.getItem('remy_inventoryItemsViewMode');
      if (v === 'cards' || v === 'list' || v === 'thumbnails') return v;
    } catch (_) { /* ignore */ }
    return 'cards';
  })(),
  /** 库存管理页：仓库物料 / 酒品目录 / 空瓶回收 / 物品目录（与仓库卡片同排） */
  stockMasterView: (() => {
    try {
      const v = localStorage.getItem('remy_stockMasterView');
      if (v === 'wine' || v === 'warehouse' || v === 'empty' || v === 'item-catalog') return v;
    } catch (_) { /* ignore */ }
    return 'warehouse';
  })(),
  /** 库存管理·各仓库物料清单筛选（酒品目录 / 空瓶回收不使用） */
  itemsListFilter: (() => {
    try {
      const v = localStorage.getItem('remy_invItemsListFilter');
      if (v === 'all' || v === 'common' || v === 'uncommon' || v === 'wine') return v;
    } catch (_) { /* ignore */ }
    return 'all';
  })(),
  /** 物品出/入库台账、空瓶追溯共用：YYYY-MM 或 ''=全部 */
  invLedgerMonth: (() => {
    try {
      const v = String(localStorage.getItem('remy_invLedgerMonth') || '').trim();
      if (!v || v === 'all') return '';
      return /^\d{4}-\d{2}$/.test(v) ? v : '';
    } catch (_) {
      return '';
    }
  })(),
  /** 编辑出库：单 ID；常用行预填（换仓刷新表格时与 DOM 快照合并） */
  editOutboundOrderId: null,
  outboundEditCommonPreset: null,
  /** 新建出库：支持跨仓加入物料（按仓暂存） */
  outboundLinesByWarehouse: {},
  outboundCommonByWarehouse: {},
  outboundWarehousesCache: [],
  outboundCommonOrderByWarehouse: {},
  outboundCommonSearchByWarehouse: {},
  outboundItemMetaByWarehouse: {},
  outboundInlineOpen: false,
  /** 新建出库左侧列表：common=仅常用 | uncommon=仅非常用 */
  outboundListFilter: 'common',
};

function invLoadCommonOrderStore() {
  try {
    const raw = localStorage.getItem('remy_invCommonOrderByWarehouse');
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) { /* ignore */ }
  return {};
}

function invSaveCommonOrderStore() {
  try {
    localStorage.setItem(
      'remy_invCommonOrderByWarehouse',
      JSON.stringify(inventoryPageState.outboundCommonOrderByWarehouse || {})
    );
  } catch (_) { /* ignore */ }
}

inventoryPageState.outboundCommonOrderByWarehouse = invLoadCommonOrderStore();

function invSetInvLedgerMonth(val) {
  const raw = val == null ? '' : String(val).trim();
  const next = raw === '' || raw === 'all' ? '' : raw;
  inventoryPageState.invLedgerMonth = /^\d{4}-\d{2}$/.test(next) ? next : '';
  try {
    localStorage.setItem('remy_invLedgerMonth', inventoryPageState.invLedgerMonth || 'all');
  } catch (_) { /* ignore */ }
  renderInventory();
}

/** minYm/maxYm 为 YYYY-MM，返回自新到旧排列的月份列表 */
function invEnumerateMonthsDesc(minYm, maxYm) {
  if (!minYm || !maxYm || !/^\d{4}-\d{2}$/.test(minYm) || !/^\d{4}-\d{2}$/.test(maxYm)) return [];
  let y = parseInt(minYm.slice(0, 4), 10);
  let m = parseInt(minYm.slice(5, 7), 10);
  const endY = parseInt(maxYm.slice(0, 4), 10);
  const endM = parseInt(maxYm.slice(5, 7), 10);
  const asc = [];
  while (y < endY || (y === endY && m <= endM)) {
    asc.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return asc.slice().reverse();
}

/** range: GET /inventory/ledger-month-range 的 { min_month, max_month }；无数据时前端回退为近 24 个月 */
function invRenderLedgerMonthSelectHtml(selectedYm, range) {
  const cur = String(selectedYm || '').trim();
  const r = range && typeof range === 'object' ? range : {};
  const rmin = r.min_month;
  const rmax = r.max_month;
  let months = [];
  if (rmin && rmax && /^\d{4}-\d{2}$/.test(String(rmin)) && /^\d{4}-\d{2}$/.test(String(rmax))) {
    months = invEnumerateMonthsDesc(String(rmin), String(rmax));
  } else {
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
  }
  if (cur && /^\d{4}-\d{2}$/.test(cur) && !months.includes(cur)) {
    months = [cur, ...months].sort((a, b) => b.localeCompare(a));
  }
  const opts = ['<option value="">全部月份</option>'];
  for (const v of months) {
    opts.push(`<option value="${v}"${v === cur ? ' selected' : ''}>${v}</option>`);
  }
  return `<select class="form-control inv-ledger-month-select" title="按月份筛选台账" aria-label="按月份筛选" onchange="invSetInvLedgerMonth(this.value)">${opts.join('')}</select>`;
}

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

// ===== API 请求封装 =====
async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  };
  if (body != null) opts.body = JSON.stringify(body);
  try {
    const url = `${API}${path}`;
    const res = await fetch(url, opts);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(
        res.ok ? '响应不是合法 JSON' : `请求失败 (${res.status})，URL：${url}`
      );
    }
    if (!res.ok) {
      const auth401NoRedirect = new Set(['/auth/me', '/auth/login', '/auth/register', '/auth/logout']);
      if (res.status === 401 && !auth401NoRedirect.has(String(path))) {
        if (typeof window !== 'undefined' && !window.location.pathname.endsWith('/login.html')) {
          window.location.href = '/login.html';
        }
      }
      throw new Error(data.error || data.message || `请求失败 (${res.status})，URL：${url}`);
    }
    return data;
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (err instanceof TypeError && (msg.includes('fetch') || msg.includes('Load failed') || msg.includes('Failed to fetch'))) {
      throw new Error(
        '连不上接口：请确认已运行 node src/server.js，并用浏览器打开 http://localhost 上的地址（不要 file:// 打开）。当前 API：' + API
      );
    }
    throw err;
  }
}

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

function canManageUsers() {
  return currentUserRole === 'admin';
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
      '[onclick*="saveReimbursementForm"]',
      '[onclick*="deleteReimbursementRecord"]',
      '[onclick*="reimbAppendInvoiceRow"]',
      '[onclick*="reimbRemoveInvoiceRow"]',
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
      target = byNum || frames[0];
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
    period: '',
    dateStart: defaultDashboardDateRange.start,
    dateEnd: defaultDashboardDateRange.end,
    compareRegion: '',
  };
  dashboardDrillRegion = null;
  loadYearFrames().then(() => navigate(currentPage));
}

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
    showToast('仅管理员可查看数据看板', 'warning');
    page = 'activities';
  }
  if (page === 'users' && !canManageUsers()) {
    showToast('仅管理员可访问用户管理', 'warning');
    return;
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
  currentPage = page;
  localStorage.setItem('remy_currentPage', page);

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  const titles = {
    dashboard: '数据看板',
    activities: '场次记录',
    'virtual-activities': '虚拟场次',
    calendar: '排期日历',
    cost: '活动成本',
    logistics: '物流成本',
    warehouse: '仓储成本',
    inventory: '库存管理',
    'inv-outbound': '物品出库',
    'inv-inbound': '物品入库',
    material: '物料采购',
    'prop-repair': '道具维修',
    reimbursement: '付款申请',
    users: '用户管理',
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
    'virtual-activities': renderVirtualActivities,
    calendar: renderCalendar,
    cost: renderCost,
    logistics: renderLogistics,
    warehouse: renderWarehouse,
    inventory: renderInventory,
    'inv-outbound': renderInventory,
    'inv-inbound': renderInventory,
    material: renderMaterialPurchases,
    'prop-repair': renderPropRepairs,
    reimbursement: renderReimbursements,
    users: renderUsers,
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
    'virtual-activities': 'rec',
    calendar: 'rec',
    cost: 'cost',
    warehouse: 'cost',
    logistics: 'cost',
    material: 'cost',
    'prop-repair': 'cost',
    reimbursement: 'cost',
    inventory: 'stock',
    'inv-outbound': 'stock',
    'inv-inbound': 'stock',
    users: 'sys',
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

// ===== Toast =====
function showToast(msg, type = 'info') {
  const icons = {
    success: '<i data-lucide="circle-check-big" style="width:14px;height:14px"></i>',
    error: '<i data-lucide="circle-x" style="width:14px;height:14px"></i>',
    warning: '<i data-lucide="triangle-alert" style="width:14px;height:14px"></i>',
    info: '<i data-lucide="info" style="width:14px;height:14px"></i>',
  };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  const toastContainer = document.getElementById('toastContainer');
  toastContainer.appendChild(el);
  applyHarmonySurfaceAnimations(toastContainer);
  renderLucideIcons();
  setTimeout(() => {
    el.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ===== 弹窗（栈：子弹窗关闭后父弹窗仍保留，如 新建活动 → 编辑品牌）=====
let activeModal = null;
const modalStack = [];

function openModal(id) {
  const overlay = document.getElementById('modalOverlay');
  overlay.classList.add('active');
  document.body.classList.add('modal-open');
  if (activeModal && activeModal !== id) {
    modalStack.push(activeModal);
  }
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('active');
    applyHarmonySurfaceAnimations(modal);
    activeModal = id;
  }
}

function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  if (!activeModal) {
    overlay.classList.remove('active');
    document.body.classList.remove('modal-open');
    return;
  }
  if (activeModal === 'modalInvItemEdit') {
    const b = document.getElementById('invItemEditModalBody');
    if (b) b.innerHTML = '';
    if (typeof inventoryPageState !== 'undefined') inventoryPageState.itemModalMode = null;
  }
  if (activeModal === 'modalInvOutboundPdf') {
    invResetOutboundPdfModal();
  }
  if (activeModal === 'modalInvReturn') {
    const rb = document.getElementById('invReturnModalBody');
    if (rb) rb.innerHTML = '';
    if (typeof inventoryPageState !== 'undefined') {
      inventoryPageState.returnDetail = null;
      inventoryPageState.returnOrderId = null;
    }
  }
  if (activeModal === 'modalActivity') {
    const m = document.getElementById('modalActivity');
    if (m) m.classList.remove('modal-activity--virtual');
    const vh = document.getElementById('actIsVirtual');
    if (vh) vh.value = '0';
    const cityEl = document.getElementById('actCity');
    if (cityEl) cityEl.setAttribute('required', 'required');
  }
  const cur = document.getElementById(activeModal);
  if (cur) cur.classList.remove('active');
  const prev = modalStack.length ? modalStack.pop() : null;
  if (prev) {
    activeModal = prev;
  } else {
    activeModal = null;
    overlay.classList.remove('active');
    document.body.classList.remove('modal-open');
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

function roundMoney2(v) {
  return Math.round((parseFloat(v) || 0) * 100) / 100;
}

function fmtMoney(v) {
  const n = roundMoney2(v);
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJsSingleQuoted(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ');
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  // 加8小时修正时区
  const local = new Date(dt.getTime() + 8*3600*1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth()+1).padStart(2,'0')}-${String(local.getUTCDate()).padStart(2,'0')}`;
}

function fmtDateShort(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  const local = new Date(dt.getTime() + 8*3600*1000);
  return `${local.getUTCMonth()+1}/${local.getUTCDate()}`;
}

/**
 * 填入 <input type="date">：与列表 fmtDate（+8）一致的业务日历日。
 * 仅当整段为 YYYY-MM-DD 时直接采用；若含 T/时区（如 …15T16:00:00.000Z 表示东八区 16 日 0 点），
 * 不能截取前缀，须用本地年月日，否则会少一天（如 260316 场次被存成 3/15）。
 */
function toDateInputValue(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function todayDateInputValue() {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function statusBadge(s) {
  if (s === 'cancelled') return '<span class="badge badge-danger">已取消</span>';
  if (s === 'deferred') {
    return '<span class="badge badge-warning">延期</span>';
  }
  if (s === 'pending' || s == null || s === '') {
    return '<span class="badge badge-gray">待执行</span>';
  }
  if (s === 'completed' || s === 'done') {
    return '<span class="badge badge-success">已完成</span>';
  }
  return '<span class="badge badge-gray">待执行</span>';
}

function brandColor(brand) {
  const map = { 'XO': 'warning', 'PHD': 'accent', 'CLUB': 'blue', 'REMY': 'success' };
  return map[brand] || 'gray';
}

function typeColor(type) {
  const map = { '晚宴': 'accent', '品鉴': 'blue', '培训': 'success', '婚宴': 'warning', '宴会': 'danger' };
  return map[type] || 'gray';
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
    if (materialBadge) materialBadge.textContent = materials.length || 0;
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

/* =============================================
   页面：数据看板
   ============================================= */
function getDashboardDefaultDateRange() {
  const yy = parseInt(String(currentYear || '').replace(/\D/g, ''), 10);
  const fiscalStartYear = Number.isFinite(yy) ? (yy >= 100 ? yy : 2000 + yy) : new Date().getFullYear();
  const start = `${fiscalStartYear}-04-01`;
  const end = `${fiscalStartYear + 1}-03-31`;
  return { start, end };
}

let dashboardState = {
  brand: '',
  region: '',
  activityType: '',
  executionFlag: '',
  period: '',
  dateStart: getDashboardDefaultDateRange().start,
  dateEnd: getDashboardDefaultDateRange().end,
  /** 右侧对比：空=不对比；「全国」或其它区域 value */
  compareRegion: '',
};
let dashboardDatePickerState = {
  open: false,
  leftMonth: '',
  draftStart: '',
  draftEnd: '',
  hoverDate: '',
};
/** 区域环形图下钻：选中的区域名，与数据详情筛选独立 */
let dashboardDrillRegion = null;
let dashboardChartMetric = localStorage.getItem('remy_dashboardChartMetric') === 'revenue' ? 'revenue' : 'count';
let dashboardLastPayload = null;
let dashboardLastQuery = '';
let dashboardAnalysisTab = 'trend';
let dashboardDetailFilters = { region: '', city: '', costType: '' };

/** 与后端 ALLOWED_TYPES 一致，用于区域对比时类别柱图类目顺序 */
const DASHBOARD_ACTIVITY_TYPES = ['晚宴', '品鉴', '培训', '纯设计'];

/** 左侧主口径序列（深色）与右侧对比口径序列（浅色） */
const DASHBOARD_COMPARE_COLOR_REGION = '#5b21b6';
const DASHBOARD_COMPARE_COLOR_NATIONAL = '#94a3b8';

function dashboardMetricText() {
  return dashboardChartMetric === 'revenue' ? '金额' : '场次';
}

function dashboardMetricValue(row) {
  if (!row) return 0;
  return dashboardChartMetric === 'revenue'
    ? parseFloat(row.revenue) || 0
    : parseInt(row.count, 10) || 0;
}

function formatDashboardDateRangeLabel() {
  const s = dashboardState.dateStart || '';
  const e = dashboardState.dateEnd || '';
  const fiscalYear = getDashboardDefaultDateRange();
  if (s === fiscalYear.start && e === fiscalYear.end) return '全年（财年）';
  if (s && e) return `${s} 至 ${e}`;
  if (s) return `${s} 起`;
  if (e) return `至 ${e}`;
  return '选择日期区间';
}

function formatDashboardMonthTitle(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map((x) => parseInt(x, 10));
  if (!y || !m) return '';
  return `${y}年${m}月`;
}

function addMonthsToMonthKey(monthKey, delta) {
  const [y, m] = String(monthKey || '').split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y || new Date().getFullYear(), (m || 1) - 1 + delta, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

function buildDashboardCalendarMonth(monthKey, side) {
  const [y, m] = String(monthKey || '').split('-').map((x) => parseInt(x, 10));
  const base = new Date(y, (m || 1) - 1, 1);
  const firstWeekday = base.getDay();
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const today = todayDateInputValue();
  const start = dashboardDatePickerState.draftStart || '';
  const end = dashboardDatePickerState.draftEnd || '';
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push('<div class="dashboard-date-cell empty"></div>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isStart = start === dateStr;
    const isEnd = end === dateStr;
    const inRange = start && end && dateStr > start && dateStr < end;
    const isToday = today === dateStr;
    const cls = ['dashboard-date-cell', isStart ? 'is-start' : '', isEnd ? 'is-end' : '', inRange ? 'in-range' : '', isToday ? 'is-today' : '']
      .filter(Boolean)
      .join(' ');
    cells.push(`<button type="button" class="${cls}" data-date="${dateStr}" onmouseenter="setDashboardDateHover('${dateStr}')" onclick="pickDashboardDate('${dateStr}')">${day}</button>`);
  }
  return `
    <div class="dashboard-date-month">
      <div class="dashboard-date-month-head">
        ${side === 'left' ? `<button type="button" class="btn btn-secondary btn-xs" onclick="shiftDashboardDatePicker(-1)">‹</button>` : '<span></span>'}
        <strong>${formatDashboardMonthTitle(monthKey)}</strong>
        ${side === 'right' ? `<button type="button" class="btn btn-secondary btn-xs" onclick="shiftDashboardDatePicker(1)">›</button>` : '<span></span>'}
      </div>
      <div class="dashboard-date-weekdays">
        <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
      </div>
      <div class="dashboard-date-grid" onmouseleave="clearDashboardDateHover()">${cells.join('')}</div>
    </div>
  `;
}

function renderDashboardDatePicker() {
  const host = document.getElementById('dashboardDateRangeHost');
  if (!host) return;
  const left = dashboardDatePickerState.leftMonth || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const right = addMonthsToMonthKey(left, 1);
  host.innerHTML = `
    <div class="dashboard-date-range-wrap">
      <button type="button" class="dash-control dashboard-date-trigger" onclick="toggleDashboardDatePicker(event)">
        <span>${escapeHtml(formatDashboardDateRangeLabel())}</span>
        <span class="dash-date-trigger__hint">日期区间</span>
      </button>
      ${dashboardDatePickerState.open ? `
        <div class="dashboard-date-popover">
          <div class="dashboard-date-popover-head">
            <div class="card-sub" style="margin:0">左侧开始日期，右侧结束日期</div>
            <button type="button" class="btn btn-secondary btn-xs" onclick="toggleDashboardDatePicker(false)">关闭</button>
          </div>
          <div class="dashboard-date-months">
            ${buildDashboardCalendarMonth(left, 'left')}
            ${buildDashboardCalendarMonth(right, 'right')}
          </div>
          <div class="dashboard-date-popover-foot">
            <div class="card-sub" style="margin:0">${escapeHtml(dashboardDatePickerState.draftStart || '未选开始')} ${dashboardDatePickerState.draftEnd ? `至 ${escapeHtml(dashboardDatePickerState.draftEnd)}` : ''}</div>
            <div style="display:flex;gap:8px">
              <button type="button" class="btn btn-secondary btn-sm" onclick="clearDashboardDatePicker()">清空</button>
              <button type="button" class="btn btn-primary btn-sm" onclick="applyDashboardDatePicker()">确定</button>
            </div>
          </div>
        </div>` : ''}
    </div>
  `;
}

function toggleDashboardDatePicker(eventOrForceOpen, maybeForceOpen) {
  if (eventOrForceOpen && typeof eventOrForceOpen.stopPropagation === 'function') {
    eventOrForceOpen.stopPropagation();
  }
  const forceOpen = typeof eventOrForceOpen === 'boolean' ? eventOrForceOpen : maybeForceOpen;
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !dashboardDatePickerState.open;
  if (nextOpen) {
    const base = dashboardState.dateStart || todayDateInputValue();
    dashboardDatePickerState.leftMonth = String(base).slice(0, 7);
    dashboardDatePickerState.draftStart = dashboardState.dateStart || '';
    dashboardDatePickerState.draftEnd = dashboardState.dateEnd || '';
    dashboardDatePickerState.hoverDate = '';
  }
  dashboardDatePickerState.open = nextOpen;
  renderDashboardDatePicker();
}

function shiftDashboardDatePicker(delta) {
  dashboardDatePickerState.leftMonth = addMonthsToMonthKey(dashboardDatePickerState.leftMonth, delta);
  renderDashboardDatePicker();
}

function updateDashboardDateHoverPreview() {
  const buttons = Array.from(document.querySelectorAll('.dashboard-date-cell[data-date]'));
  if (!buttons.length) return;
  const start = dashboardDatePickerState.draftStart || '';
  const end = dashboardDatePickerState.draftEnd || '';
  const hover = dashboardDatePickerState.hoverDate || '';
  const previewStart = start && !end && hover ? (hover < start ? hover : start) : '';
  const previewEnd = start && !end && hover ? (hover < start ? start : hover) : '';
  buttons.forEach((btn) => {
    const dateStr = btn.getAttribute('data-date') || '';
    const inPreview = previewStart && previewEnd && dateStr >= previewStart && dateStr <= previewEnd && dateStr !== start;
    btn.classList.toggle('in-preview-range', !!inPreview);
  });
}

function setDashboardDateHover(dateStr) {
  if (!dashboardDatePickerState.draftStart || dashboardDatePickerState.draftEnd) return;
  dashboardDatePickerState.hoverDate = dateStr || '';
  updateDashboardDateHoverPreview();
}

function clearDashboardDateHover() {
  if (!dashboardDatePickerState.hoverDate) return;
  dashboardDatePickerState.hoverDate = '';
  updateDashboardDateHoverPreview();
}

function pickDashboardDate(dateStr) {
  const start = dashboardDatePickerState.draftStart || '';
  const end = dashboardDatePickerState.draftEnd || '';
  let shouldAutoApply = false;
  if (!start || (start && end)) {
    dashboardDatePickerState.draftStart = dateStr;
    dashboardDatePickerState.draftEnd = '';
    dashboardDatePickerState.hoverDate = '';
  } else if (dateStr < start) {
    dashboardDatePickerState.draftEnd = start;
    dashboardDatePickerState.draftStart = dateStr;
    dashboardDatePickerState.hoverDate = '';
    shouldAutoApply = true;
  } else {
    dashboardDatePickerState.draftEnd = dateStr;
    dashboardDatePickerState.hoverDate = '';
    shouldAutoApply = true;
  }
  renderDashboardDatePicker();
  if (shouldAutoApply) {
    applyDashboardDatePicker();
  }
}

function clearDashboardDatePicker() {
  dashboardDatePickerState.draftStart = '';
  dashboardDatePickerState.draftEnd = '';
  dashboardDatePickerState.hoverDate = '';
  dashboardState.dateStart = '';
  dashboardState.dateEnd = '';
  dashboardDatePickerState.open = false;
  dashboardDatePickerState.hoverDate = '';
  renderDashboardDatePicker();
  renderDashboard();
}

function applyDashboardDatePicker() {
  dashboardState.dateStart = dashboardDatePickerState.draftStart || '';
  dashboardState.dateEnd = dashboardDatePickerState.draftEnd || '';
  if (dashboardState.dateStart && dashboardState.dateEnd && dashboardState.dateStart > dashboardState.dateEnd) {
    showToast('结束日期不能早于开始日期', 'warning');
    return;
  }
  dashboardDatePickerState.open = false;
  renderDashboardDatePicker();
  renderDashboard();
}

function dashboardMetricTick(v) {
  if (dashboardChartMetric === 'revenue') return '¥' + (Number(v) / 10000).toFixed(0) + 'w';
  return String(v);
}

function dashboardMetricTooltipValue(v) {
  if (dashboardChartMetric === 'revenue') return fmtMoney(v || 0);
  return `${parseInt(v, 10) || 0} 场`;
}

function setDashboardChartMetric(metric) {
  const m = metric === 'revenue' ? 'revenue' : 'count';
  dashboardChartMetric = m;
  localStorage.setItem('remy_dashboardChartMetric', m);
  renderDashboard();
}

/**
 * 单选区域时用于双系列图表；优先顶层 regionNationalCompare，
 * 否则从 summary.regionShare 内嵌的对比序列读取（避免代理/缓存丢字段）。
 */
function resolveDashboardChartCompare(dash) {
  if (!dash) return null;
  const top = dash.regionNationalCompare;
  if (top && Array.isArray(top.nationalActivityByMonth) && top.nationalActivityByMonth.length > 0) {
    return top;
  }
  const rs = dash.summary && dash.summary.regionShare;
  if (rs && Array.isArray(rs.nationalActivityByMonth) && rs.nationalActivityByMonth.length > 0) {
    return {
      region: rs.region || rs.primaryLabel,
      compareLabel: rs.compareLabel,
      compareMode: 'national',
      primaryTotalCount: rs.regionCount,
      compareTotalCount: rs.compareCount,
      nationalActivityByMonth: rs.nationalActivityByMonth,
      nationalActivityByType: rs.nationalActivityByType,
      nationalActivityByBrand: rs.nationalActivityByBrand,
      nationalActivityByRegion: rs.nationalActivityByRegion,
    };
  }
  if (top && (top.nationalActivityByBrand || top.nationalActivityByType)) return top;
  return null;
}

function renderLucideIcons() {
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function filterDashboard() {
  dashboardState.activityType = document.getElementById('dashFilterType')?.value || '';
  dashboardState.period = document.getElementById('dashFilterPeriod')?.value || '';
  dashboardState.region = document.getElementById('dashFilterRegion')?.value || '';
  dashboardState.brand = document.getElementById('dashFilterBrand')?.value || '';
  dashboardState.executionFlag = document.getElementById('dashFilterExecution')?.value || '';
  dashboardState.compareRegion = document.getElementById('dashCompareRegion')?.value || '';
  if (dashboardState.dateStart && dashboardState.dateEnd && dashboardState.dateStart > dashboardState.dateEnd) {
    showToast('结束日期不能早于开始日期', 'warning');
    return;
  }
  renderDashboard();
}

async function populateDashboardFilterSelects() {
  renderDashboardDatePicker();

  try {
    const types = await api('GET', '/lookups?category=activity_type');
    const typeSel = document.getElementById('dashFilterType');
    if (typeSel) {
      const keep = dashboardState.activityType;
      typeSel.innerHTML =
        '<option value="">类型</option>' +
        types
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...typeSel.options].some((o) => o.value === keep)) typeSel.value = keep;
    }
  } catch (e) {
    console.warn('数据看板活动类型筛选项加载失败', e);
  }
  try {
    const periods = await api('GET', '/lookups?category=activity_period');
    const periodSel = document.getElementById('dashFilterPeriod');
    if (periodSel) {
      const keep = dashboardState.period;
      periodSel.innerHTML =
        '<option value="">时段</option>' +
        periods
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...periodSel.options].some((o) => o.value === keep)) periodSel.value = keep;
    }
  } catch (e) {
    console.warn('数据看板时段筛选项加载失败', e);
  }
  try {
    const regions = await api('GET', '/lookups?category=activity_region');
    const regionSel = document.getElementById('dashFilterRegion');
    if (regionSel) {
      const keep = dashboardState.region;
      regionSel.innerHTML =
        '<option value="">区域</option>' +
        regions
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...regionSel.options].some((o) => o.value === keep)) regionSel.value = keep;
    }
    const cmpSel = document.getElementById('dashCompareRegion');
    if (cmpSel) {
      const keepCmp = dashboardState.compareRegion;
      cmpSel.innerHTML =
        '<option value="">不对比</option>' +
        '<option value="全国">全国</option>' +
        regions
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keepCmp && [...cmpSel.options].some((o) => o.value === keepCmp)) cmpSel.value = keepCmp;
      else cmpSel.value = '';
      dashboardState.compareRegion = cmpSel.value || '';
    }
  } catch (e) {
    console.warn('数据看板区域/对比区域筛选项加载失败', e);
  }

  renderBrandOptions();
  const bsel = document.getElementById('dashFilterBrand');
  const bk = dashboardState.brand;
  if (bsel && bk && [...bsel.options].some((o) => o.value === bk)) bsel.value = bk;

  const exSel = document.getElementById('dashFilterExecution');
  if (exSel) exSel.value = dashboardState.executionFlag || '';
}

function resetDashboardFilters() {
  const defaultDashboardDateRange = getDashboardDefaultDateRange();
  dashboardState = {
    brand: '',
    region: '',
    activityType: '',
    executionFlag: '',
    period: '',
    dateStart: defaultDashboardDateRange.start,
    dateEnd: defaultDashboardDateRange.end,
    compareRegion: '',
  };
  dashboardDatePickerState = {
    open: false,
    leftMonth: '',
    draftStart: '',
    draftEnd: '',
    hoverDate: '',
  };
  dashboardDrillRegion = null;
  renderDashboard();
}

function clearDashboardRegionDrill() {
  dashboardDrillRegion = null;
  renderDashboard();
}

function toggleDashboardDrillForFilteredRegion() {
  const r = dashboardState.region;
  if (!r) return;
  dashboardDrillRegion = dashboardDrillRegion === r ? null : r;
  renderDashboard();
}

function renderDashboardRegionDrillPanel(region, cityBreakdown, hasRegionCompare) {
  if (!region) {
    const hint = hasRegionCompare
      ? '在区域对比图中点击左侧主区域（深紫）条形，或使用下方按钮，展开城市排行'
      : '点击环形图扇区查看该区域内城市场次排行';
    return `<div class="card-sub dashboard-region-drill-hint" style="margin-top:10px">${hint}</div>`;
  }
  const rows = (cityBreakdown || [])
    .filter((r) => (r.region || '') === region)
    .map((r) => ({
      city: r.city || '未知',
      count: parseInt(r.count, 10) || 0,
      revenue: parseFloat(r.revenue) || 0,
    }))
    .sort((a, b) => b.count - a.count);
  const total = rows.reduce((s, r) => s + r.count, 0);
  const head = `
    <div class="dashboard-region-drill">
      <div class="dashboard-region-drill-head">
        <div class="card-sub" style="margin:0"><strong>${escapeHtml(region)}</strong> · 城市分布（共 ${total} 场）</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="clearDashboardRegionDrill()">关闭下钻</button>
      </div>`;
  if (!rows.length) {
    return `${head}<div class="card-sub">暂无城市明细</div></div>`;
  }
  const body = rows
    .map((r) => {
      const pct = total > 0 ? ((r.count / total) * 100).toFixed(1) : '0.0';
      return `<tr><td>${escapeHtml(r.city)}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${r.count}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${pct}%</td><td style="text-align:right;font-variant-numeric:tabular-nums">${fmtMoney(r.revenue)}</td></tr>`;
    })
    .join('');
  return `${head}
      <div class="table-wrapper" style="margin-top:8px">
        <table>
          <thead><tr><th>城市</th><th style="text-align:right">场次</th><th style="text-align:right">区内占比</th><th style="text-align:right">报价</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
}

function dashboardQueryString() {
  const sp = new URLSearchParams();
  if (currentYearFrameId) sp.set('yearFrameId', String(currentYearFrameId));
  if (dashboardState.brand) sp.set('brands', dashboardState.brand);
  if (dashboardState.region) sp.set('regions', dashboardState.region);
  if (dashboardState.activityType) sp.set('activityTypes', dashboardState.activityType);
  if (dashboardState.executionFlag) sp.set('executionFlags', dashboardState.executionFlag);
  if (dashboardState.period) sp.set('periods', dashboardState.period);
  if (dashboardState.dateStart) sp.set('dateStart', dashboardState.dateStart);
  if (dashboardState.dateEnd) sp.set('dateEnd', dashboardState.dateEnd);
  if (dashboardState.compareRegion) sp.set('compareRegion', dashboardState.compareRegion);
  const q = sp.toString();
  return q ? `?${q}` : '';
}

function toCsvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportDashboardJson() {
  if (!dashboardLastPayload) {
    showToast('暂无可导出的看板数据', 'warning');
    return;
  }
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const payload = {
    exportedAt: new Date().toISOString(),
    query: dashboardLastQuery,
    state: { ...dashboardState },
    data: dashboardLastPayload,
  };
  downloadTextFile(`dashboard-export-${now}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  showToast('看板 JSON 已导出', 'success');
}

function exportDashboardCityDrillCsv() {
  if (!dashboardLastPayload || !Array.isArray(dashboardLastPayload.cityBreakdown)) {
    showToast('暂无可导出的城市明细', 'warning');
    return;
  }
  const selectedRegion = dashboardDrillRegion || dashboardState.region || '';
  const rows = dashboardLastPayload.cityBreakdown
    .filter((r) => !selectedRegion || String(r.region || '') === String(selectedRegion))
    .map((r) => ({
      region: r.region || '',
      city: r.city || '',
      count: parseInt(r.count, 10) || 0,
      revenue: parseFloat(r.revenue) || 0,
    }))
    .sort((a, b) => b.count - a.count || b.revenue - a.revenue);
  if (!rows.length) {
    showToast('当前口径下没有城市明细可导出', 'warning');
    return;
  }
  const head = ['区域', '城市', '场次', '报价'];
  const lines = [head.map(toCsvCell).join(',')];
  rows.forEach((r) => {
    lines.push([r.region, r.city, r.count, roundMoney2(r.revenue).toFixed(2)].map(toCsvCell).join(','));
  });
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const regionTag = selectedRegion ? selectedRegion : 'all-regions';
  downloadTextFile(`dashboard-city-drill-${regionTag}-${now}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
  showToast('城市下钻 CSV 已导出', 'success');
}

function formatPercent(v) {
  return `${(Number(v || 0) * 100).toFixed(1)}%`;
}

function setDashboardAnalysisTab(tab) {
  const next = ['trend', 'structure', 'drill'].includes(tab) ? tab : 'trend';
  if (dashboardAnalysisTab === next) return;
  dashboardAnalysisTab = next;
  renderDashboard();
}

function dashboardDetailFilterRows(rows) {
  return (rows || []).filter((r) => {
    if (dashboardDetailFilters.region && String(r.region || '') !== dashboardDetailFilters.region) return false;
    if (dashboardDetailFilters.city && String(r.city || '') !== dashboardDetailFilters.city) return false;
    if (!dashboardDetailFilters.costType) return true;
    const keyMap = {
      logistics: 'logisticsCost',
      personnel: 'personnelCost',
      procurement: 'procurementCost',
      other: 'otherCost',
    };
    const k = keyMap[dashboardDetailFilters.costType];
    if (!k) return true;
    return Number(r[k] || 0) > 0;
  });
}

function onDashboardDetailFiltersChange() {
  dashboardDetailFilters.region = document.getElementById('dashDetailRegion')?.value || '';
  dashboardDetailFilters.city = document.getElementById('dashDetailCity')?.value || '';
  dashboardDetailFilters.costType = document.getElementById('dashDetailCostType')?.value || '';
  renderDashboard();
}

function exportDashboardDetailCsv() {
  if (!dashboardLastPayload || !Array.isArray(dashboardLastPayload.detailRows)) {
    showToast('暂无可导出的明细数据', 'warning');
    return;
  }
  const rows = dashboardDetailFilterRows(dashboardLastPayload.detailRows);
  if (!rows.length) {
    showToast('当前筛选下无明细可导出', 'warning');
    return;
  }
  const head = ['场次编号', '活动名称', '大区', '城市', '报价', '物流', '人员', '采购', '其他', '总成本', '毛利', '毛利率'];
  const lines = [head.map(toCsvCell).join(',')];
  rows.forEach((r) => {
    lines.push([
      r.projectCode || '',
      r.activityName || '',
      r.region || '',
      r.city || '',
      roundMoney2(r.quotedPrice || 0).toFixed(2),
      roundMoney2(r.logisticsCost || 0).toFixed(2),
      roundMoney2(r.personnelCost || 0).toFixed(2),
      roundMoney2(r.procurementCost || 0).toFixed(2),
      roundMoney2(r.otherCost || 0).toFixed(2),
      roundMoney2(r.totalCost || 0).toFixed(2),
      roundMoney2(r.grossProfit || 0).toFixed(2),
      formatPercent(r.grossMarginRate || 0),
    ].map(toCsvCell).join(','));
  });
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadTextFile(`dashboard-detail-${now}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
  showToast('明细 CSV 已导出', 'success');
}

async function renderDashboard() {
  const container = document.getElementById('pageContainer');
  try {
    Object.values(charts).forEach((c) => c && c.destroy());
    charts = {};

    const query = dashboardQueryString();
    const dash = await api('GET', `/dashboard${query}${query ? '&' : '?'}_ts=${Date.now()}`);
    dashboardLastPayload = dash;
    dashboardLastQuery = query;

    const { overview = {}, regionSummary = [], trendByMonth = [], costComposition = [], regionCityBreakdown = [], detailRows = [], metricDefinition = {} } = dash;

    const regionOptions = [...new Set((detailRows || []).map((r) => String(r.region || '').trim()).filter(Boolean))];
    const cityOptions = [...new Set((detailRows || []).map((r) => String(r.city || '').trim()).filter(Boolean))];
    if (dashboardDetailFilters.region && !regionOptions.includes(dashboardDetailFilters.region)) dashboardDetailFilters.region = '';
    if (dashboardDetailFilters.city && !cityOptions.includes(dashboardDetailFilters.city)) dashboardDetailFilters.city = '';
    const filteredDetailRows = dashboardDetailFilterRows(detailRows);
    const selectedRegionForDrill = dashboardDetailFilters.region || dashboardState.region || '';
    const drillRows = regionCityBreakdown.filter((r) => !selectedRegionForDrill || String(r.region || '') === String(selectedRegionForDrill));

    const regionSummaryRows = (regionSummary || []).map((r) => `
      <tr>
        <td>${escapeHtml(r.region || '未分区')}</td>
        <td class="dash-num">${r.sessions || 0}</td>
        <td class="dash-num">${fmtMoney(r.revenue || 0)}</td>
        <td class="dash-num">${fmtMoney(r.cost || 0)}</td>
        <td class="dash-num">${formatPercent(r.grossMarginRate || 0)}</td>
      </tr>
    `).join('');
    const regionSummaryTotal = {
      sessions: regionSummary.reduce((s, r) => s + (Number(r.sessions) || 0), 0),
      revenue: regionSummary.reduce((s, r) => s + (Number(r.revenue) || 0), 0),
      cost: regionSummary.reduce((s, r) => s + (Number(r.cost) || 0), 0),
    };
    const totalMargin = regionSummaryTotal.revenue > 0 ? (regionSummaryTotal.revenue - regionSummaryTotal.cost) / regionSummaryTotal.revenue : 0;

    const drillRowsHtml = drillRows.map((r) => `
      <tr>
        <td>${escapeHtml(r.region || '')}</td>
        <td>${escapeHtml(r.city || '')}</td>
        <td class="dash-num">${r.sessions || 0}</td>
        <td class="dash-num">${fmtMoney(r.revenue || 0)}</td>
        <td class="dash-num">${fmtMoney(r.cost || 0)}</td>
        <td class="dash-num">${formatPercent(r.grossMarginRate || 0)}</td>
      </tr>
    `).join('');

    const detailRowsHtml = filteredDetailRows.map((r) => `
      <tr>
        <td>${escapeHtml(r.projectCode || '')}</td>
        <td>${escapeHtml(r.activityName || '')}</td>
        <td>${escapeHtml(r.region || '')}</td>
        <td>${escapeHtml(r.city || '')}</td>
        <td class="dash-num">${fmtMoney(r.quotedPrice || 0)}</td>
        <td class="dash-num">${fmtMoney(r.logisticsCost || 0)}</td>
        <td class="dash-num">${fmtMoney(r.personnelCost || 0)}</td>
        <td class="dash-num">${fmtMoney(r.procurementCost || 0)}</td>
        <td class="dash-num">${fmtMoney(r.otherCost || 0)}</td>
        <td class="dash-num">${fmtMoney(r.totalCost || 0)}</td>
        <td class="dash-num">${formatPercent(r.grossMarginRate || 0)}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="page-dashboard">
      <div class="dash-card dash-filter-card">
        <div class="dash-filter-card__header">
          <h2 class="dash-page-title">数据详情</h2>
          <div class="dash-filter-actions">
            <button type="button" class="dash-btn dash-btn--secondary" onclick="resetDashboardFilters()">重置筛选</button>
            <button type="button" class="dash-btn dash-btn--primary" onclick="exportDashboardJson()">导出看板JSON</button>
            <button type="button" class="dash-btn dash-btn--primary" onclick="exportDashboardCityDrillCsv()">导出城市明细CSV</button>
            <button type="button" class="dash-btn dash-btn--primary" onclick="exportDashboardDetailCsv()">导出明细CSV</button>
          </div>
        </div>
        <div class="dash-filter-fields">
          <div class="dash-grid dash-grid--3col">
            <div class="dash-field">
              <span class="dash-label">日期区间</span>
              <div id="dashboardDateRangeHost" class="dash-field__control"></div>
            </div>
            <div class="dash-field">
              <label class="dash-label" for="dashFilterType">类型</label>
              <select class="dash-control" id="dashFilterType" onchange="filterDashboard()"><option value="">类型</option></select>
            </div>
            <div class="dash-field">
              <label class="dash-label" for="dashFilterPeriod">时段</label>
              <select class="dash-control" id="dashFilterPeriod" onchange="filterDashboard()"><option value="">时段</option></select>
            </div>
            <div class="dash-field">
              <label class="dash-label" for="dashFilterRegion">区域</label>
              <select class="dash-control" id="dashFilterRegion" onchange="filterDashboard()"><option value="">区域</option></select>
            </div>
            <div class="dash-field">
              <label class="dash-label" for="dashFilterBrand">品牌</label>
              <select class="dash-control" id="dashFilterBrand" onchange="filterDashboard()"><option value="">品牌</option></select>
            </div>
            <div class="dash-field">
              <label class="dash-label" for="dashFilterExecution">执行</label>
              <select class="dash-control" id="dashFilterExecution" onchange="filterDashboard()">
                <option value="">执行</option>
                <option value="有">有</option>
                <option value="无">无</option>
              </select>
            </div>
          </div>
          <div class="dash-filter-compare-slot">
            <div class="dash-field dash-field--compare">
              <label class="dash-label" for="dashCompareRegion">对比区域</label>
              <select class="dash-control" id="dashCompareRegion" onchange="filterDashboard()"><option value="">不对比</option><option value="全国">全国</option></select>
            </div>
          </div>
        </div>
      </div>

      <div class="stats-grid page-dashboard__stats">
        <div class="stat-card accent"><div class="stat-label">本期场次总数</div><div class="stat-value">${overview.totalSessions || 0}</div><div class="stat-sub">当前筛选条件</div></div>
        <div class="stat-card success"><div class="stat-label">本期项目总收入</div><div class="stat-value sm">${fmtMoney(overview.totalRevenue || 0)}</div><div class="stat-sub">${escapeHtml(metricDefinition.revenue || '')}</div></div>
        <div class="stat-card warning"><div class="stat-label">本期总成本</div><div class="stat-value sm">${fmtMoney(overview.totalCost || 0)}</div><div class="stat-sub">${escapeHtml(metricDefinition.cost || '')}</div></div>
        <div class="stat-card blue"><div class="stat-label">本期项目毛利率</div><div class="stat-value">${formatPercent(overview.grossMarginRate || 0)}</div><div class="stat-sub">${escapeHtml(metricDefinition.grossMarginRate || '')}</div></div>
      </div>

      <div class="dash-card dash-summary-card">
        <div class="card-header">
          <div><div class="card-title">全国汇总（大区）</div><div class="card-sub">按大区对比场次、收入、成本、毛利率</div></div>
        </div>
        <div class="table-wrapper">
          <table class="dash-table">
            <thead><tr><th>大区</th><th class="dash-num">场次</th><th class="dash-num">收入</th><th class="dash-num">成本</th><th class="dash-num">毛利率</th></tr></thead>
            <tbody>
              ${regionSummaryRows || '<tr><td colspan="5" class="dash-empty">暂无数据</td></tr>'}
            </tbody>
            <tfoot><tr><th>合计</th><th class="dash-num">${regionSummaryTotal.sessions}</th><th class="dash-num">${fmtMoney(regionSummaryTotal.revenue)}</th><th class="dash-num">${fmtMoney(regionSummaryTotal.cost)}</th><th class="dash-num">${formatPercent(totalMargin)}</th></tr></tfoot>
          </table>
        </div>
      </div>

      <div class="dash-card dash-analysis-card">
        <div class="dash-tabs">
          <button type="button" class="dash-tab ${dashboardAnalysisTab === 'trend' ? 'is-active' : ''}" onclick="setDashboardAnalysisTab('trend')">月度趋势</button>
          <button type="button" class="dash-tab ${dashboardAnalysisTab === 'structure' ? 'is-active' : ''}" onclick="setDashboardAnalysisTab('structure')">成本结构占比</button>
          <button type="button" class="dash-tab ${dashboardAnalysisTab === 'drill' ? 'is-active' : ''}" onclick="setDashboardAnalysisTab('drill')">大区详情下钻</button>
        </div>
        <div class="dash-tab-panel ${dashboardAnalysisTab === 'trend' ? 'is-active' : ''}">
          <div class="card-header"><div><div class="card-title">月度趋势（收入/成本/毛利率）</div><div class="card-sub">双Y轴：柱状=收入/成本，折线=毛利率</div></div></div>
          <canvas id="chartFinanceTrend"></canvas>
        </div>
        <div class="dash-tab-panel ${dashboardAnalysisTab === 'structure' ? 'is-active' : ''}">
          <div class="card-header"><div><div class="card-title">成本结构占比</div><div class="card-sub">物流 / 人员 / 采购 / 其他</div></div></div>
          <canvas id="chartCostComposition"></canvas>
        </div>
        <div class="dash-tab-panel ${dashboardAnalysisTab === 'drill' ? 'is-active' : ''}">
          <div class="card-header">
            <div><div class="card-title">大区城市下钻明细</div><div class="card-sub">${selectedRegionForDrill ? `当前区域：${escapeHtml(selectedRegionForDrill)}` : '显示全部区域'}</div></div>
          </div>
          <div class="table-wrapper">
            <table class="dash-table">
              <thead><tr><th>大区</th><th>城市</th><th class="dash-num">场次</th><th class="dash-num">收入</th><th class="dash-num">成本</th><th class="dash-num">毛利率</th></tr></thead>
              <tbody>${drillRowsHtml || '<tr><td colspan="6" class="dash-empty">暂无城市明细</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="dash-card dash-detail-card">
        <div class="card-header">
          <div><div class="card-title">场次级明细</div><div class="card-sub">支持大区 / 城市 / 成本类型筛选</div></div>
        </div>
        <div class="dash-detail-filters">
          <select class="dash-control" id="dashDetailRegion" onchange="onDashboardDetailFiltersChange()">
            <option value="">全部大区</option>
            ${regionOptions.map((r) => `<option value="${escapeHtml(r)}" ${dashboardDetailFilters.region === r ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
          </select>
          <select class="dash-control" id="dashDetailCity" onchange="onDashboardDetailFiltersChange()">
            <option value="">全部城市</option>
            ${cityOptions.map((c) => `<option value="${escapeHtml(c)}" ${dashboardDetailFilters.city === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
          <select class="dash-control" id="dashDetailCostType" onchange="onDashboardDetailFiltersChange()">
            <option value="">全部成本类型</option>
            <option value="logistics" ${dashboardDetailFilters.costType === 'logistics' ? 'selected' : ''}>物流成本</option>
            <option value="personnel" ${dashboardDetailFilters.costType === 'personnel' ? 'selected' : ''}>人员成本</option>
            <option value="procurement" ${dashboardDetailFilters.costType === 'procurement' ? 'selected' : ''}>采购成本</option>
            <option value="other" ${dashboardDetailFilters.costType === 'other' ? 'selected' : ''}>其他成本</option>
          </select>
        </div>
        <div class="table-wrapper">
          <table class="dash-table dash-table--detail">
            <thead><tr><th>场次编号</th><th>活动名称</th><th>大区</th><th>城市</th><th class="dash-num">报价</th><th class="dash-num">物流</th><th class="dash-num">人员</th><th class="dash-num">采购</th><th class="dash-num">其他</th><th class="dash-num">总成本</th><th class="dash-num">毛利率</th></tr></thead>
            <tbody>${detailRowsHtml || '<tr><td colspan="11" class="dash-empty">暂无明细数据</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      </div>

    `;

    drawDashboardFinanceTrend(trendByMonth);
    drawDashboardCostComposition(costComposition);
    await populateDashboardFilterSelects();
    renderLucideIcons();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${err.message}</div></div>`;
    renderLucideIcons();
  }
}

function drawDashboardFinanceTrend(rows) {
  const ctx = document.getElementById('chartFinanceTrend');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');
  const labels = (rows || []).map((r) => String(r.month || '').slice(5));
  const revenueData = (rows || []).map((r) => Number(r.revenue) || 0);
  const costData = (rows || []).map((r) => Number(r.cost) || 0);
  const marginData = (rows || []).map((r) => Number(r.grossMarginRate || 0) * 100);
  charts.financeTrend = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: '收入', data: revenueData, backgroundColor: '#3b82f6', yAxisID: 'yAmount', borderRadius: 6 },
        { type: 'bar', label: '成本', data: costData, backgroundColor: '#f59e0b', yAxisID: 'yAmount', borderRadius: 6 },
        { type: 'line', label: '毛利率', data: marginData, yAxisID: 'yMargin', borderColor: '#10b981', backgroundColor: '#10b981', tension: 0.25, pointRadius: 3 },
      ],
    },
    options: {
      plugins: { legend: { labels: { color: sec } } },
      scales: {
        x: { ticks: { color: sec }, grid: { display: false } },
        yAmount: { beginAtZero: true, position: 'left', ticks: { color: sec, callback: (v) => fmtMoney(v || 0) } },
        yMargin: { beginAtZero: true, position: 'right', ticks: { color: sec, callback: (v) => `${v}%` }, grid: { display: false } },
      },
    },
  });
}

function drawDashboardCostComposition(rows) {
  const ctx = document.getElementById('chartCostComposition');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');
  const labels = (rows || []).map((r) => `${r.costType} ${formatPercent(r.ratio || 0)}`);
  const values = (rows || []).map((r) => Number(r.amount) || 0);
  charts.costComposition = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#a78bfa'], borderWidth: 0, hoverOffset: 6 }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { color: sec, padding: 12, font: { size: 12 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label} · ${fmtMoney(ctx.raw || 0)}` } },
      },
      cutout: '58%',
    },
  });
}

function dashboardChartCssHost() {
  return document.querySelector('.page-dashboard');
}

/** 白底看板内图表：优先读 `.page-dashboard` 上的 CSS 变量，避免全局暗色主题下图例/坐标过浅 */
function dashboardChartCssVar(name, fallback) {
  const host = dashboardChartCssHost();
  const fromHost = host ? getComputedStyle(host).getPropertyValue(name).trim() : '';
  if (fromHost) return fromHost;
  const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return fromRoot || fallback;
}

function drawMonthTrendChart(data, compare) {
  const ctx = document.getElementById('chartMonthTrend');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');
  const labels = data.map((d) => d.monthLabel);
  if (compare && compare.nationalActivityByMonth) {
    const nat = compare.nationalActivityByMonth;
    charts.monthTrend = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: compare.region || '主口径',
            data: data.map((d) => dashboardMetricValue(d)),
            backgroundColor: DASHBOARD_COMPARE_COLOR_REGION,
            borderRadius: 6,
          },
          {
            label: compare.compareLabel || '对比',
            data: nat.map((d) => dashboardMetricValue(d)),
            backgroundColor: DASHBOARD_COMPARE_COLOR_NATIONAL,
            borderRadius: 6,
          },
        ],
      },
      options: {
        datasets: { bar: { categoryPercentage: 0.72, barPercentage: 0.85 } },
        plugins: {
          legend: { display: true, labels: { color: sec, padding: 12, font: { size: 11 } } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: sec } },
          y: { beginAtZero: true, ticks: { color: sec, callback: (v) => dashboardMetricTick(v) } },
        },
      },
    });
    return;
  }
  charts.monthTrend = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: dashboardMetricText(),
        data: data.map((d) => dashboardMetricValue(d)),
        backgroundColor: '#7c6af7',
        borderRadius: 6,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: sec } },
        y: { beginAtZero: true, ticks: { color: sec, callback: (v) => dashboardMetricTick(v) } },
      },
    },
  });
}

function drawTypeChart(data, compare) {
  const ctx = document.getElementById('chartType');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');

  if (compare && compare.nationalActivityByType) {
    const regMap = new Map((data || []).map((r) => [r.activity_type, dashboardMetricValue(r)]));
    const natMap = new Map((compare.nationalActivityByType || []).map((r) => [r.activity_type, dashboardMetricValue(r)]));
    const labels = DASHBOARD_ACTIVITY_TYPES;
    charts.type = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: compare.region || '主口径',
            data: labels.map((t) => regMap.get(t) || 0),
            backgroundColor: DASHBOARD_COMPARE_COLOR_REGION,
            borderRadius: 6,
          },
          {
            label: compare.compareLabel || '对比',
            data: labels.map((t) => natMap.get(t) || 0),
            backgroundColor: DASHBOARD_COMPARE_COLOR_NATIONAL,
            borderRadius: 6,
          },
        ],
      },
      options: {
        datasets: { bar: { categoryPercentage: 0.72, barPercentage: 0.85 } },
        plugins: {
          legend: { display: true, labels: { color: sec, padding: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${dashboardMetricTooltipValue(c.raw)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: sec, font: { size: 11 } } },
          y: { beginAtZero: true, ticks: { color: sec, callback: (v) => dashboardMetricTick(v) } },
        },
      },
    });
    return;
  }

  const total = data.reduce((s, d) => s + dashboardMetricValue(d), 0);
  const labels = data.map((d) => {
    const c = dashboardMetricValue(d);
    const p = total > 0 ? ((c / total) * 100).toFixed(1) : '0.0';
    return `${d.activity_type} (${dashboardMetricTooltipValue(c)} / ${p}%)`;
  });
  charts.type = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: data.map((d) => dashboardMetricValue(d)),
        backgroundColor: ['#7c6af7','#60a5fa','#34d399','#fbbf24','#f87171'],
        borderWidth: 0,
        hoverOffset: 6,
      }]
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { color: sec, padding: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: { label: (ctx) => ` ${ctx.label}: ${dashboardMetricTooltipValue(ctx.raw)}` }
        }
      },
      cutout: '60%',
    }
  });
}

function buildBrandCompareRows(regional, national) {
  const m = new Map();
  (regional || []).forEach((r) => {
    const b = r.brand || '未知';
    m.set(b, { brand: b, reg: dashboardMetricValue(r), nat: 0 });
  });
  (national || []).forEach((r) => {
    const b = r.brand || '未知';
    const row = m.get(b) || { brand: b, reg: 0, nat: 0 };
    row.nat = dashboardMetricValue(r);
    m.set(b, row);
  });
  const arr = [...m.values()];
  arr.sort((a, b) => Math.max(b.reg, b.nat) - Math.max(a.reg, a.nat));
  return arr.slice(0, 15);
}

function drawBrandChart(data, compare) {
  const ctx = document.getElementById('chartBrand');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');
  const borderCol = dashboardChartCssVar('--border', '#e2e8f0');

  if (compare && compare.nationalActivityByBrand) {
    const rows = buildBrandCompareRows(data, compare.nationalActivityByBrand);
    const labels = rows.map((r) => r.brand);
    charts.brand = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: compare.region || '主口径',
            data: rows.map((r) => r.reg),
            backgroundColor: DASHBOARD_COMPARE_COLOR_REGION,
            borderRadius: 6,
          },
          {
            label: compare.compareLabel || '对比',
            data: rows.map((r) => r.nat),
            backgroundColor: DASHBOARD_COMPARE_COLOR_NATIONAL,
            borderRadius: 6,
          },
        ],
      },
      options: {
        datasets: { bar: { categoryPercentage: 0.72, barPercentage: 0.85 } },
        plugins: { legend: { display: true, labels: { color: sec, padding: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: sec, font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: sec, font: { size: 11 }, callback: (v) => dashboardMetricTick(v) }, grid: { color: borderCol } },
        },
      },
    });
    return;
  }

  const colors = { 'X.O': '#fbbf24', 'PHD': '#7c6af7', 'CLUB': '#60a5fa', 'REMY': '#34d399' };
  charts.brand = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.brand),
      datasets: [{
        label: dashboardMetricText(),
        data: data.map((d) => dashboardMetricValue(d)),
        backgroundColor: data.map(d => colors[d.brand] || '#9ea3b8'),
        borderRadius: 6,
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: sec, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: sec, font: { size: 11 }, callback: (v) => dashboardMetricTick(v) }, grid: { color: borderCol } }
      }
    }
  });
}

function drawRegionChart(data, compare, regionShare) {
  const ctx = document.getElementById('chartRegion');
  if (!ctx) return;
  const sec = dashboardChartCssVar('--text-secondary', '#64748b');

  if (compare && regionShare) {
    const natReg = compare.nationalActivityByRegion;
    const isNational = compare.compareMode === 'national';
    const primaryMark = String(dashboardState.region || '').trim();
    const highlightName = primaryMark || String(compare.region || regionShare.region || '').trim();
    const useMultiBar = isNational && Array.isArray(natReg) && natReg.length > 1;

    if (useMultiBar) {
      const natRows = [...natReg].sort((a, b) => (parseInt(b.count, 10) || 0) - (parseInt(a.count, 10) || 0));
      natRows.sort((a, b) => dashboardMetricValue(b) - dashboardMetricValue(a));
      const labels = natRows.map((r) => r.region || '未知');
      const metricVals = natRows.map((r) => dashboardMetricValue(r));
      const bg = natRows.map((r) => {
        const name = String(r.region || '').trim();
        return highlightName && name === highlightName ? DASHBOARD_COMPARE_COLOR_REGION : DASHBOARD_COMPARE_COLOR_NATIONAL;
      });
      charts.region = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: dashboardMetricText(),
              data: metricVals,
              backgroundColor: bg,
              borderRadius: 4,
            },
          ],
        },
        options: {
          indexAxis: 'y',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const i = ctx.dataIndex;
                  const row = natRows[i];
                  const n = dashboardMetricValue(row);
                  const rev = Number(row?.revenue || 0);
                  const isSel = highlightName && String(row?.region || '').trim() === highlightName;
                  return ` ${dashboardMetricTooltipValue(n)} · 报价 ${fmtMoney(rev)}${isSel ? ' · 左侧主区域' : ''}`;
                },
                footer: () => '对比=全国时展示各区域；深紫=左侧所选区域 · 点击深紫条：城市下钻',
              },
            },
          },
          scales: {
            x: { beginAtZero: true, ticks: { color: sec, callback: (v) => dashboardMetricTick(v) } },
            y: { ticks: { color: sec, font: { size: 11 } }, grid: { display: false } },
          },
          onClick: (evt, elements) => {
            if (!elements || !elements.length) return;
            const idx = elements[0].index;
            const row = natRows[idx];
            const name = String(row?.region || '').trim();
            if (highlightName && name === highlightName) {
              dashboardDrillRegion = dashboardDrillRegion === name ? null : name;
              renderDashboard();
            }
          },
        },
      });
      return;
    }

    const pl = compare.region || regionShare.region || '主口径';
    const cl = compare.compareLabel || '对比';
    const rc = dashboardChartMetric === 'revenue'
      ? (data || []).reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0)
      : Number(compare.primaryTotalCount ?? regionShare.regionCount ?? 0);
    const cc = dashboardChartMetric === 'revenue'
      ? ((compare.nationalActivityByRegion || []).reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0))
      : Number(compare.compareTotalCount ?? regionShare.compareCount ?? 0);
    charts.region = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [pl, cl],
        datasets: [
          {
            label: dashboardMetricText(),
            data: [rc, cc],
            backgroundColor: [DASHBOARD_COMPARE_COLOR_REGION, DASHBOARD_COMPARE_COLOR_NATIONAL],
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              footer: () => '点击左侧（深紫）条形：城市下钻（需左侧已选单一区域）',
            },
          },
        },
        scales: {
          x: { beginAtZero: true, ticks: { color: sec, callback: (v) => dashboardMetricTick(v) } },
          y: { ticks: { color: sec, font: { size: 11 } }, grid: { display: false } },
        },
        onClick: (evt, elements) => {
          if (!elements || !elements.length) return;
          const idx = elements[0].index;
          if (idx !== 0) return;
          const r = dashboardState.region;
          if (!r) return;
          dashboardDrillRegion = dashboardDrillRegion === r ? null : r;
          renderDashboard();
        },
      },
    });
    return;
  }

  const total = data.reduce((s, d) => s + dashboardMetricValue(d), 0);
  const labels = data.map((d) => {
    const c = dashboardMetricValue(d);
    const p = total > 0 ? ((c / total) * 100).toFixed(1) : '0.0';
    return `${d.region || '未知'} (${dashboardMetricTooltipValue(c)} / ${p}%)`;
  });
  const bg = ['#7c6af7', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee'];
  const drill = dashboardDrillRegion;
  const backgroundColor = data.map((d, i) => {
    const r = d.region || '';
    if (drill && r === drill) return bg[i % bg.length];
    if (drill) return withAlphaHex(bg[i % bg.length], 0.35);
    return bg[i % bg.length];
  });
  charts.region = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: data.map((d) => dashboardMetricValue(d)),
        backgroundColor,
        borderWidth: 0,
        hoverOffset: 6,
      }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { color: sec, padding: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            footer: () => '点击扇区：城市下钻 / 再点同一扇区关闭',
          },
        },
      },
      cutout: '60%',
      onClick: (evt, elements) => {
        if (!elements || !elements.length) return;
        const i = elements[0].index;
        const row = data[i];
        if (!row) return;
        const r = row.region || '';
        dashboardDrillRegion = dashboardDrillRegion === r ? null : r;
        renderDashboard();
      },
    },
  });
}

function withAlphaHex(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `#${h}${a.toString(16).padStart(2, '0')}`;
}

/* =============================================
   页面：场次记录（原活动记录）
   ============================================= */
async function renderActivities() {
  const container = document.getElementById('pageContainer');

  // 初始化筛选状态
  activitiesState.page = 1;

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <input type="text" class="search-input" id="actSearch" placeholder="搜索城市/客户/项目编号..." oninput="debounceSearch()" value="${activitiesState.search}">
        <select class="filter-select" id="actYear" onchange="filterActivities()">
          <option value="">全部年份</option>
          <option value="2025">2025年</option>
          <option value="2026">2026年</option>
        </select>
        <select class="filter-select" id="actMonth" onchange="filterActivities()">
          <option value="">全部月份</option>
          <option value="1">1月</option>
          <option value="2">2月</option>
          <option value="3">3月</option>
          <option value="4">4月</option>
          <option value="5">5月</option>
          <option value="6">6月</option>
          <option value="7">7月</option>
          <option value="8">8月</option>
          <option value="9">9月</option>
          <option value="10">10月</option>
          <option value="11">11月</option>
          <option value="12">12月</option>
        </select>
        <select class="filter-select" id="actType" onchange="filterActivities()">
          <option value="">全部类型</option>
        </select>
        <select class="filter-select" id="actFilterPeriod" onchange="filterActivities()">
          <option value="">全部时段</option>
        </select>
        <select class="filter-select" id="actFilterRegion" onchange="filterActivities()">
          <option value="">全部区域</option>
        </select>
        <select class="filter-select" id="actBrand" onchange="filterActivities()">
          <option value="">全部品牌</option>
        </select>
        <select class="filter-select" id="actFilterBelonging" onchange="filterActivities()">
          <option value="">全部归属</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm" onclick="resetActivityFilters()">重置筛选</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleSortOrder()">
          日期 <span id="sortIcon">${activitiesState.sortOrder === 'DESC' ? '↓' : '↑'}</span>
        </button>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-primary btn-sm" onclick="showActivityModal()">+ 新建活动</button>
      </div>
    </div>

    <div id="actTable"></div>
    <div id="actPagination"></div>
  `;

  try {
    const types = await api('GET', '/lookups?category=activity_type');
    const typeSel = document.getElementById('actType');
    if (typeSel) {
      const keep = activitiesState.type;
      typeSel.innerHTML =
        '<option value="">全部类型</option>' +
        types
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...typeSel.options].some((o) => o.value === keep)) typeSel.value = keep;
    }
  } catch (e) {
    console.warn('活动类型筛选项加载失败', e);
  }
  try {
    const periods = await api('GET', '/lookups?category=activity_period');
    const periodSel = document.getElementById('actFilterPeriod');
    if (periodSel) {
      const keep = activitiesState.period;
      periodSel.innerHTML =
        '<option value="">全部时段</option>' +
        periods
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...periodSel.options].some((o) => o.value === keep)) periodSel.value = keep;
    }
  } catch (e) {
    console.warn('活动时段筛选项加载失败', e);
  }
  try {
    const regions = await api('GET', '/lookups?category=activity_region');
    const regionSel = document.getElementById('actFilterRegion');
    if (regionSel) {
      const keep = activitiesState.region;
      regionSel.innerHTML =
        '<option value="">全部区域</option>' +
        regions
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...regionSel.options].some((o) => o.value === keep)) regionSel.value = keep;
    }
  } catch (e) {
    console.warn('活动区域筛选项加载失败', e);
  }
  try {
    const belongs = await api('GET', '/lookups?category=activity_belonging');
    actBelongingLabelByValue = Object.fromEntries(
      (belongs || []).map((r) => [String(r.value), String(r.label || r.value)])
    );
    const belongSel = document.getElementById('actFilterBelonging');
    if (belongSel) {
      const keep = activitiesState.belonging;
      belongSel.innerHTML =
        '<option value="">全部归属</option>' +
        belongs
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...belongSel.options].some((o) => o.value === keep)) belongSel.value = keep;
    }
  } catch (e) {
    actBelongingLabelByValue = {};
    console.warn('活动归属筛选项加载失败', e);
  }
  renderBrandOptions();
  const bsel = document.getElementById('actBrand');
  const bk = activitiesState.brand;
  if (bsel && bk && [...bsel.options].some((o) => o.value === bk)) bsel.value = bk;

  await loadActivities();
}

let searchTimer = null;
function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    activitiesState.search = document.getElementById('actSearch')?.value || '';
    activitiesState.page = 1;
    loadActivities();
  }, 400);
}

function filterActivities() {
  activitiesState.type = document.getElementById('actType')?.value || '';
  activitiesState.period = document.getElementById('actFilterPeriod')?.value || '';
  activitiesState.region = document.getElementById('actFilterRegion')?.value || '';
  activitiesState.belonging = document.getElementById('actFilterBelonging')?.value || '';
  activitiesState.brand = document.getElementById('actBrand')?.value || '';
  activitiesState.year = document.getElementById('actYear')?.value || '';
  activitiesState.month = document.getElementById('actMonth')?.value || '';
  activitiesState.page = 1;
  loadActivities();
}

function resetActivityFilters() {
  activitiesState.type = '';
  activitiesState.period = '';
  activitiesState.region = '';
  activitiesState.belonging = '';
  activitiesState.brand = '';
  activitiesState.year = '';
  activitiesState.month = '';
  activitiesState.search = '';
  activitiesState.page = 1;
  const s = document.getElementById('actSearch');
  if (s) s.value = '';
  ['actYear', 'actMonth', 'actType', 'actFilterPeriod', 'actFilterRegion', 'actBrand', 'actFilterBelonging'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  loadActivities();
}

function toggleSortOrder() {
  activitiesState.sortOrder = activitiesState.sortOrder === 'DESC' ? 'ASC' : 'DESC';
  const icon = document.getElementById('sortIcon');
  if (icon) icon.textContent = activitiesState.sortOrder === 'DESC' ? '↓' : '↑';
  loadActivities();
}

async function loadActivities() {
  const container = document.getElementById('actTable');
  if (!container) return;

  container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">加载中...</div>';

  try {
    // 每次进入场次记录时，自动把“活动日期早于今天且状态=待执行”的记录置为已完成
    try {
      await api('POST', '/activities/auto-complete-overdue', {
        yearFrameId: currentYearFrameId || undefined,
      });
    } catch (e) {
      console.warn('自动完结过期场次失败（忽略，不阻断列表加载）', e);
    }

    let qs = `?sortBy=activity_date&sortOrder=${activitiesState.sortOrder}&isVirtual=0`;
    if (currentYearFrameId) qs += `&yearFrameId=${currentYearFrameId}`;
    if (activitiesState.type) qs += `&activityType=${activitiesState.type}`;
    if (activitiesState.brand) qs += `&brand=${encodeURIComponent(activitiesState.brand)}`;

    const data = await api('GET', `/activities${qs}`);

    // 前端搜索过滤
    let filtered = data;
    if (activitiesState.search) {
      const kw = activitiesState.search.toLowerCase();
      filtered = filtered.filter(a =>
        (a.city || '').toLowerCase().includes(kw) ||
        (a.client || '').toLowerCase().includes(kw) ||
        (a.client_name || '').toLowerCase().includes(kw) ||
        (a.project_code || '').toLowerCase().includes(kw) ||
        (a.venue || '').toLowerCase().includes(kw)
      );
    }

    // 年份筛选
    if (activitiesState.year) {
      filtered = filtered.filter(a => {
        const d = new Date(a.date || a.activity_date);
        return d.getFullYear().toString() === activitiesState.year;
      });
    }

    // 月份筛选
    if (activitiesState.month) {
      filtered = filtered.filter(a => {
        const d = new Date(a.date || a.activity_date);
        return (d.getMonth() + 1).toString() === activitiesState.month;
      });
    }
    // 时段筛选
    if (activitiesState.period) {
      filtered = filtered.filter(a => (a.period || '日常') === activitiesState.period);
    }
    // 区域筛选
    if (activitiesState.region) {
      filtered = filtered.filter(a => (a.region || '') === activitiesState.region);
    }
    if (activitiesState.belonging) {
      filtered = filtered.filter((a) => displayActivityBelongingValue(a) === activitiesState.belonging);
    }

    activitiesState.data = filtered;

    // 分页
    const pageSize = 50;
    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (activitiesState.page - 1) * pageSize;
    const pageData = filtered.slice(start, start + pageSize);

    // 按月分组
    const grouped = {};
    pageData.forEach(a => {
      const d = new Date(a.date || a.activity_date);
      const key = isNaN(d) ? '未知日期' : `${d.getFullYear()}年${d.getMonth()+1}月`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(a);
    });

    // 列表列顺序：日期、项目编号、时段、品牌、区域、归属、城市、客户、类型、执行、状态、操作（不展示报价/成本）
    let html = `<div class="table-wrapper act-table-scroll-wrap"><table class="data-table act-table-sticky-head">
      <thead><tr>
        <th>日期</th><th>项目编号</th><th>时段</th><th>品牌</th><th>区域</th><th>归属</th><th>城市</th><th>客户</th>
        <th>类型</th><th>执行</th><th>状态</th><th>操作</th>
      </tr></thead><tbody>`;

    Object.entries(grouped).forEach(([month, acts]) => {
      html += `<tr><td colspan="12" class="group-title">${month}（${acts.length}场）</td></tr>`;
      acts.forEach(a => {
        const rowDeferred = a.status === 'deferred';
        html += `
          <tr class="${rowDeferred ? 'activity-row-deferred' : ''}" onclick="showActivityDetail(${a.id})" style="cursor:pointer">
            <td>${fmtDateShort(a.date || a.activity_date)}</td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.project_code||''}">${a.project_code||'—'}</td>
            <td><span class="badge badge-gray">${a.period || '日常'}</span></td>
            <td><span class="badge badge-${brandColor(a.brand)}">${a.brand||'—'}</span></td>
            <td><span style="font-size:11px;color:var(--text-secondary)">${a.region||'—'}</span></td>
            <td><span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(formatActivityBelongingForTable(a))}</span></td>
            <td><strong>${a.city||'—'}</strong></td>
            <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${a.client||a.client_name||'—'}</td>
            <td><span class="badge badge-${typeColor(a.activity_type)}">${a.activity_type||'—'}</span></td>
            <td><span class="badge badge-${a.executor==='有'?'success':'gray'}">${a.executor||'无'}</span></td>
            <td style="white-space:nowrap" onclick="event.stopPropagation()">
              <select class="status-pill-select status-pill-${a.status || 'pending'}" onchange="quickUpdateActivityStatus(${a.id}, this.value); this.className='status-pill-select status-pill-' + this.value;">
                <option value="pending" ${(a.status || 'pending') === 'pending' ? 'selected' : ''}>待执行</option>
                <option value="deferred" ${a.status === 'deferred' ? 'selected' : ''}>延期</option>
                <option value="completed" ${a.status === 'completed' || a.status === 'done' ? 'selected' : ''}>已完成</option>
              </select>
            </td>
            <td onclick="event.stopPropagation()">
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                <button type="button" class="btn btn-secondary btn-sm" onclick="openActivityCloudAlbum('${escapeJsSingleQuoted(a.cloud_album_url || '')}')">云相册</button>
                <button class="btn btn-secondary btn-sm" onclick="showActivityModal(${a.id})">编辑</button>
                <button type="button" class="btn btn-danger btn-sm activity-row-remove-btn" onclick="openRemoveActivityDialog(${a.id})">删除</button>
              </div>
            </td>
          </tr>`;
      });
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
    renderLucideIcons();

    // 分页
    const pgEl = document.getElementById('actPagination');
    if (pgEl) {
      pgEl.innerHTML = renderPagination(activitiesState.page, totalPages, total, 'goActPage');
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${err.message}</div></div>`;
    renderLucideIcons();
  }
}

function openRemoveActivityDialog(activityId) {
  const id = Number(activityId);
  const hid = document.getElementById('removeActivityTargetId');
  if (hid) hid.value = Number.isFinite(id) && id > 0 ? String(id) : '';
  const hint = document.getElementById('removeActivityConfirmHint');
  if (hint) {
    const row = (activitiesState.data || []).find((x) => Number(x.id) === id);
    if (row) {
      const parts = [
        row.project_code && String(row.project_code).trim(),
        row.city && String(row.city).trim(),
        row.date || row.activity_date ? fmtDateShort(row.date || row.activity_date) : '',
      ].filter(Boolean);
      hint.textContent = parts.length ? parts.join(' · ') : `场次 ID：${id}`;
    } else {
      hint.textContent = Number.isFinite(id) && id > 0 ? `场次 ID：${id}` : '（未找到场次信息）';
    }
  }
  openModal('modalActivityDeleteConfirm');
  renderLucideIcons();
}

async function confirmRemoveActivityExecute() {
  const raw = document.getElementById('removeActivityTargetId')?.value;
  const id = parseInt(raw, 10);
  if (!raw || !Number.isFinite(id) || id <= 0) {
    closeModal();
    return;
  }
  await deleteActivity(id);
}

async function deleteActivity(id) {
  try {
    await api('DELETE', `/activities/${id}`);
    showToast('活动已删除', 'success');
    closeModal();
    if (currentPage === 'activities') loadActivities();
    else if (currentPage === 'virtual-activities') loadVirtualActivities();
    else if (currentPage === 'calendar' && typeof window._calYear === 'number') drawCalendar(window._calYear, window._calMonth);
    else if (currentPage === 'cost') renderCost();
    else loadActivities();
    void updateBadges();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

function goActPage(p) {
  activitiesState.page = p;
  loadActivities();
}

/* -------- 虚拟场次（is_virtual=1，默认东南区、分品牌预存统计）-------- */
const VIRTUAL_BRAND_STAT_ORDER = ['PHD', 'X.O', 'CLUB', 'REMY', 'RC'];

function aggregateVirtualQuotedByBrand(rows) {
  const byBrand = {};
  let total = 0;
  (rows || []).forEach((r) => {
    const q = Number(r.quoted_price) || 0;
    total += q;
    const b = String(r.brand || '').trim() || '未填';
    byBrand[b] = (byBrand[b] || 0) + q;
  });
  return { byBrand, total };
}

function formatVirtualBrandStatCards(agg) {
  const { byBrand, total } = agg;
  const seen = new Set();
  const parts = [];
  VIRTUAL_BRAND_STAT_ORDER.forEach((b) => {
    if (byBrand[b] == null) return;
    seen.add(b);
    const v = byBrand[b];
    parts.push(
      `<div class="virtual-prepaid-card">
        <div class="vpc-label">${escapeHtml(b)}</div>
        <div class="vpc-value">¥${roundMoney2(v).toFixed(2)}</div>
      </div>`
    );
  });
  Object.keys(byBrand)
    .filter((b) => !seen.has(b))
    .sort()
    .forEach((b) => {
      const v = byBrand[b];
      parts.push(
        `<div class="virtual-prepaid-card">
          <div class="vpc-label">${escapeHtml(b)}</div>
          <div class="vpc-value">¥${roundMoney2(v).toFixed(2)}</div>
        </div>`
      );
    });
  parts.push(
    `<div class="virtual-prepaid-card virtual-prepaid-total">
      <div class="vpc-label">预存报价合计</div>
      <div class="vpc-value">¥${roundMoney2(total).toFixed(2)}</div>
    </div>`
  );
  return `<div class="virtual-prepaid-strip">${parts.join('')}</div>`;
}

let virtualSearchTimer = null;
function debounceVirtualSearch() {
  clearTimeout(virtualSearchTimer);
  virtualSearchTimer = setTimeout(() => {
    virtualActivitiesState.search = document.getElementById('virtActSearch')?.value || '';
    virtualActivitiesState.page = 1;
    loadVirtualActivities();
  }, 400);
}

function filterVirtualActivities() {
  virtualActivitiesState.brand = document.getElementById('virtActBrand')?.value || '';
  virtualActivitiesState.region = document.getElementById('virtActRegion')?.value ?? '';
  virtualActivitiesState.page = 1;
  loadVirtualActivities();
}

function resetVirtualFilters() {
  virtualActivitiesState.brand = '';
  virtualActivitiesState.region = '东南区';
  virtualActivitiesState.search = '';
  virtualActivitiesState.page = 1;
  const s = document.getElementById('virtActSearch');
  if (s) s.value = '';
  const b = document.getElementById('virtActBrand');
  if (b) b.value = '';
  const r = document.getElementById('virtActRegion');
  if (r) r.value = '东南区';
  loadVirtualActivities();
}

function toggleVirtualSortOrder() {
  virtualActivitiesState.sortOrder = virtualActivitiesState.sortOrder === 'DESC' ? 'ASC' : 'DESC';
  const icon = document.getElementById('virtSortIcon');
  if (icon) icon.textContent = virtualActivitiesState.sortOrder === 'DESC' ? '↓' : '↑';
  loadVirtualActivities();
}

function goVirtPage(p) {
  virtualActivitiesState.page = p;
  loadVirtualActivities();
}

async function renderVirtualActivities() {
  const container = document.getElementById('pageContainer');
  virtualActivitiesState.page = 1;

  container.innerHTML = `
    <div class="virtual-page-hint">
      虚拟场次用于<strong>报价预估</strong>，不计入<strong>排期日历</strong>与数据看板活动统计。
      下方<strong>预存报价合计</strong>为当前筛选条件下各品牌报价之和（年框编号对应品牌条线，可覆盖多个品牌）。
    </div>
    <div class="toolbar">
      <div class="toolbar-left">
        <input type="text" class="search-input" id="virtActSearch" placeholder="搜索客户/项目编号..." oninput="debounceVirtualSearch()" value="${escapeHtml(virtualActivitiesState.search)}">
        <select class="filter-select" id="virtActRegion" onchange="filterVirtualActivities()">
          <option value="">全部区域</option>
        </select>
        <select class="filter-select" id="virtActBrand" onchange="filterVirtualActivities()">
          <option value="">全部品牌</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm" onclick="resetVirtualFilters()">重置筛选</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleVirtualSortOrder()">
          日期 <span id="virtSortIcon">${virtualActivitiesState.sortOrder === 'DESC' ? '↓' : '↑'}</span>
        </button>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-primary btn-sm" onclick="showVirtualActivityModal()">+ 新建虚拟场次</button>
      </div>
    </div>
    <div id="virtualPrepaidStats"></div>
    <div id="virtActTable"></div>
    <div id="virtActPagination"></div>
  `;

  try {
    const regions = await api('GET', '/lookups?category=activity_region');
    const regionSel = document.getElementById('virtActRegion');
    if (regionSel) {
      const keep = virtualActivitiesState.region;
      regionSel.innerHTML =
        '<option value="">全部区域</option>' +
        (regions || [])
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep !== '' && [...regionSel.options].some((o) => o.value === keep)) regionSel.value = keep;
      else if (keep === '') regionSel.value = '';
      else regionSel.value = '东南区';
      virtualActivitiesState.region = regionSel.value;
    }
  } catch (e) {
    console.warn('虚拟场次区域筛选项加载失败', e);
  }
  const virtBrandSel = document.getElementById('virtActBrand');
  if (virtBrandSel) {
    const keep = virtualActivitiesState.brand;
    virtBrandSel.innerHTML =
      '<option value="">全部品牌</option>' +
      FIXED_BRAND_CODES.map((code) => `<option value="${code}">${code}</option>`).join('');
    if (keep && FIXED_BRAND_CODES.includes(keep)) virtBrandSel.value = keep;
  }
  await loadVirtualActivities();
}

async function loadVirtualActivities() {
  const container = document.getElementById('virtActTable');
  const statsEl = document.getElementById('virtualPrepaidStats');
  if (!container) return;

  container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">加载中...</div>';

  try {
    let qs = `?sortBy=activity_date&sortOrder=${virtualActivitiesState.sortOrder}&isVirtual=1`;
    if (currentYearFrameId) qs += `&yearFrameId=${currentYearFrameId}`;
    const regionVal = document.getElementById('virtActRegion')?.value ?? virtualActivitiesState.region;
    if (regionVal) qs += `&region=${encodeURIComponent(regionVal)}`;
    if (virtualActivitiesState.brand) qs += `&brand=${encodeURIComponent(virtualActivitiesState.brand)}`;

    const data = await api('GET', `/activities${qs}`);

    let filtered = data || [];
    if (virtualActivitiesState.search) {
      const kw = virtualActivitiesState.search.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          (a.city || '').toLowerCase().includes(kw) ||
          (a.client || '').toLowerCase().includes(kw) ||
          (a.client_name || '').toLowerCase().includes(kw) ||
          (a.project_code || '').toLowerCase().includes(kw)
      );
    }

    virtualActivitiesState.data = filtered;

    const agg = aggregateVirtualQuotedByBrand(filtered);
    if (statsEl) statsEl.innerHTML = formatVirtualBrandStatCards(agg);

    const pageSize = 50;
    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (virtualActivitiesState.page - 1) * pageSize;
    const pageData = filtered.slice(start, start + pageSize);

    const grouped = {};
    pageData.forEach((a) => {
      const d = new Date(a.date || a.activity_date);
      const key = Number.isNaN(d.getTime()) ? '未定日期' : `${d.getFullYear()}年${d.getMonth() + 1}月`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(a);
    });

    const vth = 'position:sticky;top:0;z-index:20;background:var(--bg-input);box-shadow:0 1px 0 var(--border);';
    let html = `<div class="table-wrapper" style="max-height:min(60vh,calc(100vh - 260px));overflow:auto;position:relative;"><table class="data-table act-table-sticky-head virtual-activities-table">
      <thead><tr>
        <th style="${vth}">日期</th><th style="${vth}">项目编号</th><th style="${vth}">品牌</th><th style="${vth}">区域</th><th style="${vth}">客户</th>
        <th style="${vth}">类型</th><th class="numeric" style="${vth}">报价</th><th style="${vth}">备注</th><th style="${vth}">操作</th>
      </tr></thead><tbody>`;

    Object.entries(grouped).forEach(([month, acts]) => {
      html += `<tr><td colspan="9" class="group-title">${month}（${acts.length}条）</td></tr>`;
      acts.forEach((a) => {
        html += `
          <tr onclick="showVirtualActivityDetail(${a.id})" style="cursor:pointer">
            <td>${fmtDateShort(a.date || a.activity_date)}</td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${escapeHtml(String(a.project_code || ''))}">${escapeHtml(String(a.project_code || '—'))}</td>
            <td><span class="badge badge-${brandColor(a.brand)}">${escapeHtml(String(a.brand || '—'))}</span></td>
            <td style="font-size:11px;color:var(--text-secondary)">${escapeHtml(String(a.region || '—'))}</td>
            <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${escapeHtml(String(a.client || a.client_name || '—'))}</td>
            <td><span class="badge badge-${typeColor(a.activity_type)}">${escapeHtml(String(a.activity_type || '—'))}</span></td>
            <td class="numeric"><span class="amount amount-revenue">${fmtMoney(a.quoted_price)}</span></td>
            <td style="max-width:160px;font-size:11px;color:var(--text-secondary)">${escapeHtml(String(a.remarks || '').slice(0, 80))}${String(a.remarks || '').length > 80 ? '…' : ''}</td>
            <td onclick="event.stopPropagation()">
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                <button class="btn btn-secondary btn-sm" onclick="showVirtualActivityModal(${a.id})">编辑</button>
                <button type="button" class="btn btn-danger btn-sm activity-row-remove-btn" onclick="openRemoveVirtualActivityDialog(${a.id})">删除</button>
              </div>
            </td>
          </tr>`;
      });
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
    renderLucideIcons();

    const pgEl = document.getElementById('virtActPagination');
    if (pgEl) {
      pgEl.innerHTML = renderPagination(
        virtualActivitiesState.page,
        totalPages,
        total,
        'goVirtPage'
      );
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(err.message)}</div></div>`;
    renderLucideIcons();
  }
}

function openRemoveVirtualActivityDialog(activityId) {
  const hid = document.getElementById('removeActivityTargetId');
  if (hid) hid.value = String(activityId);
  const hint = document.getElementById('removeActivityConfirmHint');
  if (hint) {
    const row = (virtualActivitiesState.data || []).find((x) => Number(x.id) === Number(activityId));
    if (row) {
      const parts = [
        row.project_code && String(row.project_code).trim(),
        row.client || row.client_name,
        row.date || row.activity_date ? fmtDateShort(row.date || row.activity_date) : '',
      ].filter(Boolean);
      hint.textContent = parts.length ? `虚拟场次 · ${parts.join(' · ')}` : `虚拟场次 ID：${activityId}`;
    } else {
      hint.textContent = `虚拟场次 ID：${activityId}`;
    }
  }
  openModal('modalActivityDeleteConfirm');
  renderLucideIcons();
}

function showVirtualActivityDetail(id) {
  showActivityDetail(id, { virtualContext: true });
}

function renderPagination(current, total, count, fn) {
  if (total <= 1) return `<div class="pagination"><span>共 ${count} 条</span></div>`;
  let btns = '';
  btns += `<button class="page-btn" onclick="${fn}(${current-1})" ${current===1?'disabled':''}>‹</button>`;
  // 显示10页
  let start = Math.max(1, current - 4);
  let end = Math.min(total, current + 5);
  if (end - start < 9) {
    start = Math.max(1, end - 9);
  }
  for (let i = start; i <= end; i++) {
    btns += `<button class="page-btn ${i===current?'active':''}" onclick="${fn}(${i})">${i}</button>`;
  }
  btns += `<button class="page-btn" onclick="${fn}(${current+1})" ${current===total?'disabled':''}>›</button>`;
  return `<div class="pagination"><span>共 ${count} 条，第 ${current}/${total} 页</span><div class="page-btns">${btns}</div></div>`;
}

// 生成项目编号
function normalizeProjectCodeCity(raw) {
  // 城市仅保留中文，避免输入过程中的拼音/符号混入项目编号
  return String(raw || '')
    .replace(/\s+/g, '')
    .replace(/[^\u4e00-\u9fa5]/g, '')
    .trim();
}

function normalizeProjectCodeToken(raw) {
  // 统一去除空白，仅保留中英文、数字与常见分隔符
  return String(raw || '')
    .replace(/\s+/g, '')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9&.\-]/g, '')
    .trim();
}

function genProjectCode() {
  const code = document.getElementById('actYearFrameCode')?.value || '';
  const date = document.getElementById('actDate')?.value || '';
  const city = normalizeProjectCodeCity(document.getElementById('actCity')?.value || '');
  syncActivityBrandFromYearFrameCode();
  const brand = normalizeProjectCodeToken(document.getElementById('actBrandField')?.value || '');
  const type = normalizeProjectCodeToken(document.getElementById('actActivityType')?.value || '');
  const client = normalizeProjectCodeToken(document.getElementById('actClient')?.value || '');

  let dateStr = '';
  if (date) {
    const d = new Date(date);
    dateStr = `${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  }

  const pc = `${code} ${dateStr}${city}${client}${brand}${type}`.trim();
  const el = document.getElementById('actProjectCode');
  if (el) el.value = pc;
}

function detectActivityBrandByYearFrameCode(rawCode) {
  const normalized = String(rawCode || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!normalized) return '';
  if (normalized.includes('CLUB')) return 'CLUB';
  if (normalized.includes('PHD')) return 'PHD';
  if (normalized.includes('RC')) return 'RC';
  if (normalized.includes('XO')) return 'X.O';
  return '';
}

function syncActivityBrandFromYearFrameCode() {
  const yearFrameCode = document.getElementById('actYearFrameCode')?.value || '';
  const brandEl = document.getElementById('actBrandField');
  if (!brandEl) return;
  const detected = detectActivityBrandByYearFrameCode(yearFrameCode);
  if (detected && brandEl.value !== detected) {
    brandEl.value = detected;
  }
}

// ----- 活动表单下拉（lookup_options /api/lookups）-----
const ACTIVITY_LOOKUP_DEFS = [
  { category: 'activity_year_frame_code', selectId: 'actYearFrameCode', allowEmpty: false },
  { category: 'activity_type', selectId: 'actActivityType', allowEmpty: false },
  { category: 'activity_period', selectId: 'actPeriod', allowEmpty: false },
  { category: 'activity_region', selectId: 'actRegion', allowEmpty: true, emptyLabel: '请选择' },
  { category: 'activity_belonging', selectId: 'actBelonging', allowEmpty: true, emptyLabel: '请选择' },
  { category: 'activity_executor', selectId: 'actExecutor', allowEmpty: false },
  { category: 'activity_status', selectId: 'actStatus', allowEmpty: false },
];

const LOOKUP_EDITOR_LABELS = {
  activity_year_frame_code: '编辑：年框编号',
  activity_type: '编辑：活动类型',
  activity_period: '编辑：时段',
  activity_region: '编辑：区域',
  activity_belonging: '编辑：归属',
  activity_executor: '编辑：执行人员',
  activity_status: '编辑：状态',
};

let _lookupEditCategory = '';

function populateLookupSelect(el, rows, def, rawDesired) {
  el.innerHTML = '';
  if (def.allowEmpty) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = def.emptyLabel || '请选择';
    el.appendChild(o);
  }
  const seen = new Set();
  (rows || []).forEach((r) => {
    if (!r || r.value == null) return;
    seen.add(String(r.value));
    const o = document.createElement('option');
    o.value = r.value;
    o.textContent = r.label || r.value;
    el.appendChild(o);
  });

  let desired;
  if (rawDesired !== undefined && rawDesired !== null && String(rawDesired) !== '') {
    desired = String(rawDesired);
  } else if (def.allowEmpty) {
    desired = '';
  } else if (rows && rows.length) {
    desired = String(rows[0].value);
  } else {
    desired = '';
  }

  if (desired !== '' && !seen.has(desired)) {
    const o = document.createElement('option');
    o.value = desired;
    o.textContent = `${desired}（未在列表中）`;
    el.appendChild(o);
  }

  el.value = desired;
  if (el.value !== desired && el.options.length) {
    el.selectedIndex = 0;
  }
}

async function fillActivityLookupSelects(valueMap = {}) {
  const pairs = await Promise.all(
    ACTIVITY_LOOKUP_DEFS.map(async (def) => {
      const rows = await api('GET', `/lookups?category=${encodeURIComponent(def.category)}`);
      return [def, rows];
    })
  );
  for (const [def, rows] of pairs) {
    const el = document.getElementById(def.selectId);
    if (!el) continue;
    const hasKey = Object.prototype.hasOwnProperty.call(valueMap, def.selectId);
    const raw = hasKey ? valueMap[def.selectId] : undefined;
    const nextRows = def.selectId === 'actStatus'
      ? (rows || []).filter((r) => String(r.value || '').trim() !== 'cancelled')
      : rows;
    populateLookupSelect(el, nextRows, def, raw);
  }
}

async function quickUpdateActivityStatus(id, status) {
  const next = String(status || '').trim();
  if (!['pending', 'deferred', 'completed'].includes(next)) return;
  try {
    await api('PUT', `/activities/${id}`, { status: next });
    const row = (activitiesState.data || []).find((x) => Number(x.id) === Number(id));
    if (row) row.status = next;
    showToast('状态已更新', 'success');
  } catch (err) {
    showToast('状态更新失败: ' + err.message, 'error');
    if (currentPage === 'virtual-activities') loadVirtualActivities();
    else loadActivities();
  }
}

function applyNewActivityLookupDefaults() {
  const p = document.getElementById('actPeriod');
  if (p && [...p.options].some((o) => o.value === '日常')) p.value = '日常';
  const ex = document.getElementById('actExecutor');
  if (ex && [...ex.options].some((o) => o.value === '无')) ex.value = '无';
  const st = document.getElementById('actStatus');
  if (st && [...st.options].some((o) => o.value === 'pending')) st.value = 'pending';
}

function getActivityLookupFormSnapshot() {
  return {
    actYearFrameCode: document.getElementById('actYearFrameCode')?.value,
    actActivityType: document.getElementById('actActivityType')?.value,
    actPeriod: document.getElementById('actPeriod')?.value,
    actRegion: document.getElementById('actRegion')?.value,
    actBelonging: document.getElementById('actBelonging')?.value,
    actExecutor: document.getElementById('actExecutor')?.value,
    actBrandAmbassador: document.getElementById('actBrandAmbassador')?.value,
    actStatus: document.getElementById('actStatus')?.value,
  };
}

async function refreshActivityLookupsBehindLookupModal() {
  try {
    await fillActivityLookupSelects(getActivityLookupFormSnapshot());
  } catch (e) {
    console.error(e);
  }
}

function lookupEditorRowHtml(r) {
  const active = r.is_active ? '启用' : '停用';
  return `<tr>
    <td><code style="font-size:12px">${escapeHtml(String(r.value))}</code></td>
    <td><input type="text" class="form-control lookup-edit-label" data-id="${r.id}" value="${escapeHtml(String(r.label || ''))}" style="font-size:13px;padding:4px 8px"></td>
    <td><input type="number" class="form-control lookup-edit-sort" data-id="${r.id}" value="${Number(r.sort_order) || 0}" style="font-size:13px;padding:4px 8px;width:64px"></td>
    <td style="font-size:12px;color:${r.is_active ? 'var(--success)' : 'var(--text-muted)'}">${active}</td>
    <td style="white-space:nowrap">
      <button type="button" class="btn btn-xs btn-ghost" onclick="saveLookupOptionRow(${r.id})">保存</button>
      ${r.is_active ? `<button type="button" class="btn btn-xs btn-ghost" onclick="deactivateLookupOption(${r.id})">停用</button>` : `<button type="button" class="btn btn-xs btn-ghost" onclick="reactivateLookupOption(${r.id})">启用</button>`}
    </td>
  </tr>`;
}

async function showLookupEditModal(category) {
  _lookupEditCategory = category;
  const title = document.getElementById('modalLookupTitle');
  if (title) title.textContent = LOOKUP_EDITOR_LABELS[category] || '编辑选项';
  const body = document.getElementById('lookupEditorContent');
  if (body) body.innerHTML = '<div style="padding:16px;color:var(--text-muted)">加载中...</div>';
  openModal('modalLookup');
  await renderLookupEditor(category);
}

async function renderLookupEditor(category) {
  const body = document.getElementById('lookupEditorContent');
  if (!body) return;
  try {
    const rows = await api('GET', `/lookups?category=${encodeURIComponent(category)}&includeInactive=1`);
    body.innerHTML = `
      <div style="margin-bottom:12px">
        <button type="button" class="btn btn-primary btn-sm" onclick="toggleLookupAddForm()">+ 新增选项</button>
      </div>
      <div id="lookupAddForm" style="display:none;margin-bottom:12px;padding:12px;background:var(--bg-primary);border-radius:var(--radius-sm)">
        <div class="form-grid" style="grid-template-columns:1fr 1fr 80px;gap:8px;margin-bottom:8px">
          <input type="text" id="lookupNewValue" class="form-control" placeholder="存储值（写入数据库）" style="font-size:13px">
          <input type="text" id="lookupNewLabel" class="form-control" placeholder="显示名称" style="font-size:13px">
          <input type="number" id="lookupNewSort" class="form-control" placeholder="排序" value="0" style="font-size:13px">
        </div>
        <button type="button" class="btn btn-primary btn-sm" onclick="confirmAddLookupOption()">保存</button>
      </div>
      <table class="data-table" style="font-size:13px">
        <thead><tr><th>值</th><th>显示</th><th>排序</th><th>状态</th><th></th></tr></thead>
        <tbody id="lookupEditorTbody">${rows.map((r) => lookupEditorRowHtml(r)).join('')}</tbody>
      </table>
    `;
  } catch (err) {
    body.innerHTML = `<div style="color:var(--danger);padding:12px">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

function toggleLookupAddForm() {
  const f = document.getElementById('lookupAddForm');
  if (!f) return;
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function confirmAddLookupOption() {
  const category = _lookupEditCategory;
  const value = document.getElementById('lookupNewValue')?.value?.trim();
  const label = document.getElementById('lookupNewLabel')?.value?.trim();
  const sort_order = parseInt(document.getElementById('lookupNewSort')?.value, 10) || 0;
  if (!value || !label) {
    showToast('请填写存储值与显示名称', 'warning');
    return;
  }
  try {
    await api('POST', '/lookups', { category, value, label, sort_order });
    showToast('已新增', 'success');
    const form = document.getElementById('lookupAddForm');
    if (form) form.style.display = 'none';
    await renderLookupEditor(category);
    await refreshActivityLookupsBehindLookupModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveLookupOptionRow(id) {
  const category = _lookupEditCategory;
  const labelInp = document.querySelector(`.lookup-edit-label[data-id="${id}"]`);
  const sortInp = document.querySelector(`.lookup-edit-sort[data-id="${id}"]`);
  try {
    await api('PUT', `/lookups/${id}`, {
      label: labelInp?.value?.trim(),
      sort_order: parseInt(sortInp?.value, 10) || 0,
    });
    showToast('已保存', 'success');
    await renderLookupEditor(category);
    await refreshActivityLookupsBehindLookupModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deactivateLookupOption(id) {
  try {
    await api('DELETE', `/lookups/${id}`);
    showToast('已停用', 'success');
    await renderLookupEditor(_lookupEditCategory);
    await refreshActivityLookupsBehindLookupModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function reactivateLookupOption(id) {
  try {
    await api('PUT', `/lookups/${id}`, { is_active: 1 });
    await renderLookupEditor(_lookupEditCategory);
    await refreshActivityLookupsBehindLookupModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 打开新建/编辑弹窗；opts.virtual 为 true 时为虚拟场次（精简字段、默认东南区）
async function showActivityModal(id = null, opts = {}) {
  const modEl = document.getElementById('modalActivity');
  const leadEl = document.getElementById('modalActivityLead');
  const virtHidden = document.getElementById('actIsVirtual');
  if (virtHidden) virtHidden.value = '0';
  if (modEl) modEl.classList.remove('modal-activity--virtual');

  document.getElementById('modalActivityTitle').textContent = id ? '编辑活动' : '新建活动';
  if (leadEl && !id) {
    leadEl.innerHTML =
      '请填写场次信息；标注 <span class="required">*</span> 为必填。保存后可在场次记录中查看与筛选。';
  }

  document.getElementById('actId').value = id || '';

  let a = null;
  if (id) {
    try {
      a = await api('GET', `/activities/${id}`);
    } catch (err) {
      showToast('加载活动数据失败', 'error');
      return;
    }
  }

  let isVirtualModal = !!(opts && opts.virtual);
  if (a && (Number(a.is_virtual) === 1 || a.is_virtual === true)) {
    isVirtualModal = true;
  }

  const lookupSnap = a
    ? {
        actYearFrameCode: a.year_frame_code || '',
        actActivityType: a.activity_type || '',
        actPeriod: a.period || '日常',
        actRegion: a.region != null && a.region !== undefined ? a.region : '',
        actBelonging: displayActivityBelongingValue(a),
        actExecutor: a.executor != null && String(a.executor).trim() !== '' ? a.executor : '无',
        actBrandAmbassador: a.brand_ambassador || '',
        actStatus: a.status || 'pending',
      }
    : {};

  try {
    await fillActivityLookupSelects(lookupSnap);
  } catch (err) {
    const detail = err && err.message ? String(err.message) : String(err);
    showToast(
      `加载下拉选项失败：${detail}。若已执行迁移，请重启后端（结束旧 node 进程后重新 npm start），再硬刷新页面。`,
      'error'
    );
    console.error(err);
  }

  ['actCity', 'actBrandField', 'actDate', 'actClient', 'actVenue', 'actQuotedPrice', 'actGuestCount', 'actProjectCode', 'actRemarks', 'actCloudAlbumUrl', 'actBrandAmbassador'].forEach((fid) => {
    const el = document.getElementById(fid);
    if (el) el.value = '';
  });

  if (a) {
    document.getElementById('actCity').value = a.city || '';
    document.getElementById('actBrandField').value = a.brand || 'PHD';
    if (a.date || a.activity_date) {
      document.getElementById('actDate').value = toDateInputValue(a.date || a.activity_date);
    }
    document.getElementById('actClient').value = a.client || a.client_name || '';
    document.getElementById('actVenue').value = a.venue || '';
    document.getElementById('actQuotedPrice').value =
      a.quoted_price != null && a.quoted_price !== '' ? roundMoney2(a.quoted_price).toFixed(2) : '';
    document.getElementById('actGuestCount').value = a.guest_count || '';
    document.getElementById('actProjectCode').value = a.project_code || '';
    document.getElementById('actRemarks').value = a.remarks || '';
    document.getElementById('actCloudAlbumUrl').value = a.cloud_album_url || '';
    document.getElementById('actBrandAmbassador').value = a.brand_ambassador || '';
  } else {
    applyNewActivityLookupDefaults();
    document.getElementById('actBrandField').value = 'PHD';
    document.getElementById('actBrandAmbassador').value = '';
    genProjectCode();
  }

  syncActivityBrandFromYearFrameCode();

  if (isVirtualModal) {
    if (virtHidden) virtHidden.value = '1';
    if (modEl) modEl.classList.add('modal-activity--virtual');
    document.getElementById('modalActivityTitle').textContent = id ? '编辑虚拟场次' : '新建虚拟场次';
    if (leadEl) {
      leadEl.innerHTML =
        '<strong>虚拟场次</strong>用于报价预估与<strong>预存费用</strong>统计，<strong>不会出现在排期日历</strong>。当前业务为<strong>东南区</strong>客户；通过不同<strong>年框编号</strong>区分品牌条线（可多品牌）。';
    }
    const regEl = document.getElementById('actRegion');
    if (!id && regEl && [...regEl.options].some((o) => o.value === '东南区')) {
      regEl.value = '东南区';
    }
    const cityEl = document.getElementById('actCity');
    if (cityEl) cityEl.removeAttribute('required');
  } else {
    const cityEl = document.getElementById('actCity');
    if (cityEl) cityEl.setAttribute('required', 'required');
  }

  openModal('modalActivity');
}

function showVirtualActivityModal(editId = null) {
  return showActivityModal(editId, { virtual: true });
}

function toggleWineSection() {
  const area = document.getElementById('wineSelectionArea');
  const icon = document.getElementById('wineToggleIcon');
  if (area.style.display === 'none') {
    area.style.display = 'block';
    icon.textContent = '▲';
  } else {
    area.style.display = 'none';
    icon.textContent = '▼';
  }
}

function wineCatalogSpecLine(c) {
  const parts = [c.category, c.volume_label].filter((x) => String(x || '').trim());
  return parts.length ? parts.join(' · ') : '—';
}

async function loadWineInventoryForForm() {
  try {
    const catalog = await api('GET', '/wine/catalog');
    const tbody = document.getElementById('wineSelectBody');
    if (!tbody) return;

    const specLine = (c) => wineCatalogSpecLine(c);
    tbody.innerHTML = catalog
      .map((c) => {
        const code = `cat_${c.id}`;
        const spec = specLine(c);
        return `
      <tr>
        <td>${escapeHtml(c.brand || '—')}</td>
        <td style="font-weight:500">${escapeHtml(c.name)}</td>
        <td style="color:var(--text-secondary)">${escapeHtml(spec)}</td>
        <td><input type="number" class="wine-qty-input" data-wine-code="${code}" data-wine-name="${escapeHtml(c.name)}" data-spec="${escapeHtml(spec)}" value="0" min="0" placeholder="0" style="width:70px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;text-align:right"></td>
      </tr>`;
      })
      .join('');
    
    document.getElementById('wineInventoryLoading').style.display = 'none';
    document.getElementById('wineSelectTable').style.display = 'table';
    
    // 如果是编辑模式，加载已有用酒数据
    const actId = document.getElementById('actId').value;
    if (actId) {
      const act = await api('GET', `/activities/${actId}`);
      const wineDetails = parseWineDetails(act.wine_details);
      Object.entries(wineDetails).forEach(([key, val]) => {
        if (val && val.qty > 0) {
          const input = tbody.querySelector(`[data-wine-code="${key}"]`);
          if (input) input.value = val.qty;
        }
      });
    }
  } catch (err) {
    document.getElementById('wineInventoryLoading').textContent = '加载失败，请重试';
    console.error('加载酒品库存失败:', err);
  }
}

// 收集表单中的用酒数据
function collectWineDetails() {
  const details = {};
  document.querySelectorAll('.wine-qty-input').forEach(input => {
    const qty = parseInt(input.value) || 0;
    if (qty > 0) {
      details[input.dataset.wineCode] = {
        wine_name: input.dataset.wineName,
        spec: input.dataset.spec,
        qty: qty
      };
    }
  });
  return details;
}

async function syncActivityWineUsageRecords(activityId, activityBody) {
  if (!activityId) return;
  const yearFrameId = Number(activityBody?.year_frame_id || currentYearFrameId || 1);
  const usageDate = activityBody?.date || todayDateInputValue();
  const clientName = activityBody?.client_name || activityBody?.client || '';
  const desiredMap = parseWineDetails(activityBody?.wine_details);

  const usageRows = await api('GET', `/wine/usage?year_frame_id=${yearFrameId}`);
  const existing = (usageRows || []).filter((r) => Number(r.activity_id) === Number(activityId));
  const existingByCode = new Map(existing.map((r) => [String(r.wine_code || ''), r]));

  for (const [wineCode, detail] of Object.entries(desiredMap)) {
    const qty = parseInt(detail?.qty, 10) || 0;
    if (qty <= 0) continue;
    const payload = {
      year_frame_id: yearFrameId,
      activity_id: Number(activityId),
      wine_code: wineCode,
      wine_name: detail?.wine_name || wineCode,
      spec: detail?.spec || '',
      quantity: qty,
      usage_date: usageDate,
      client_name: clientName,
      remarks: '来自活动用酒明细同步',
    };
    const old = existingByCode.get(wineCode);
    if (old) {
      if ((parseInt(old.quantity, 10) || 0) !== qty || old.usage_date !== usageDate || (old.client_name || '') !== clientName) {
        await api('PUT', `/wine/usage/${old.id}`, payload);
      }
      existingByCode.delete(wineCode);
    } else {
      await api('POST', '/wine/usage', payload);
    }
  }

  // 活动表单删除了某酒品时，删除对应使用记录并回补库存
  for (const stale of existingByCode.values()) {
    await api('DELETE', `/wine/usage/${stale.id}`);
  }
}

async function saveActivity() {
  const id = document.getElementById('actId').value;
  const isVirt = document.getElementById('actIsVirtual')?.value === '1';
  const brandAmbassadorEl = document.getElementById('actBrandAmbassador');
  const brandAmbassadorVal = brandAmbassadorEl ? String(brandAmbassadorEl.value || '').trim() : '';
  const body = {
    year_frame_id: currentYearFrameId || 1,
    year_frame_code: document.getElementById('actYearFrameCode').value,
    project_code: document.getElementById('actProjectCode').value,
    activity_type: document.getElementById('actActivityType').value,
    city: document.getElementById('actCity').value,
    brand: document.getElementById('actBrandField').value,
    date: document.getElementById('actDate').value || null,
    client: document.getElementById('actClient').value,
    client_name: document.getElementById('actClient').value,
    region: document.getElementById('actRegion').value,
    belonging: (document.getElementById('actBelonging')?.value || '').trim() || null,
    period: document.getElementById('actPeriod').value,
    venue: document.getElementById('actVenue').value,
    quoted_price: roundMoney2(document.getElementById('actQuotedPrice').value),
    guest_count: parseInt(document.getElementById('actGuestCount').value) || null,
    executor: document.getElementById('actExecutor').value,
    brand_ambassador: brandAmbassadorVal || null,
    status: document.getElementById('actStatus').value,
    remarks: document.getElementById('actRemarks').value,
    cloud_album_url: normalizeCloudAlbumUrl(document.getElementById('actCloudAlbumUrl').value) || null,
    is_virtual: isVirt ? 1 : 0,
  };

  try {
    let activityId = id ? Number(id) : 0;
    let successMsg = '';
    if (id) {
      await api('PUT', `/activities/${id}`, body);
      successMsg = isVirt ? '虚拟场次已更新' : '活动已更新';
    } else {
      const created = await api('POST', '/activities', body);
      activityId = Number(created?.id || created?.data?.id || 0);
      // Defensive fallback: some environments may return message-only payload.
      if (!activityId && body.project_code) {
        const vq = body.is_virtual ? '&isVirtual=1' : '&isVirtual=0';
        const rows = await api(
          'GET',
          `/activities?yearFrameId=${encodeURIComponent(body.year_frame_id)}${vq}`
        );
        const matched = (rows || [])
          .filter((r) => String(r.project_code || '').trim() === String(body.project_code || '').trim())
          .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
        activityId = Number(matched?.id || 0);
      }
      successMsg = isVirt ? '虚拟场次已创建' : '活动已创建';
    }
    if (isVirt) {
      showToast(successMsg, 'success');
    } else {
      let ambassadorSavedLabel = '未填写';
      if (activityId > 0) {
        try {
          const latest = await api('GET', `/activities/${activityId}`);
          ambassadorSavedLabel = String(latest?.brand_ambassador || '').trim() || '未填写';
        } catch (_) {
          ambassadorSavedLabel = brandAmbassadorVal || '未填写';
        }
      }
      showToast(`${successMsg} · 品牌大使：${ambassadorSavedLabel}`, 'success');
    }
    closeModal();
    if (currentPage === 'virtual-activities') loadVirtualActivities();
    else loadActivities();
    void updateBadges();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

function pickActivityBelonging(a) {
  if (!a || typeof a !== 'object') return '';
  const v =
    a.belonging != null
      ? a.belonging
      : a.Belonging != null
        ? a.Belonging
        : a.activity_belonging != null
          ? a.activity_belonging
          : null;
  if (v == null) return '';
  return String(v).trim();
}

/**
 * 项目编号中常带 RC / RM 渠道段，历史导入未写 belonging 时用于展示与筛选（与回填脚本规则一致）
 */
function inferBelongingFromProjectCode(projectCode) {
  const s = projectCode == null ? '' : String(projectCode);
  if (!s) return '';
  if (s.includes('RM-CLUB') || s.includes('RM_CLUB')) return 'RM-CLUB婚宴';
  if (s.includes('RM-X.O')) return 'RM-X.O婚宴';
  if (s.includes('-RC-') || s.includes(' RC ')) return 'RC-On';
  return '';
}

/** 库内归属优先，否则按项目编号推断（与 lookup value 一致） */
function displayActivityBelongingValue(a) {
  const stored = pickActivityBelonging(a);
  if (stored) return stored;
  return inferBelongingFromProjectCode(a && a.project_code);
}

function belongingLabelForValue(raw) {
  const key = raw == null ? '' : String(raw).trim();
  if (!key) return '';
  return actBelongingLabelByValue[key] || key;
}

function formatActivityBelongingForTable(a) {
  const v = displayActivityBelongingValue(a);
  if (!v) return '—';
  return belongingLabelForValue(v);
}

async function ensureBelongingLabelMap() {
  if (Object.keys(actBelongingLabelByValue).length) return;
  try {
    const rows = await api('GET', '/lookups?category=activity_belonging');
    actBelongingLabelByValue = Object.fromEntries(
      (rows || []).map((r) => [String(r.value), String(r.label || r.value)])
    );
  } catch (_) {
    actBelongingLabelByValue = {};
  }
}

function activityDetailRow(label, valueText) {
  const t = valueText == null || valueText === '' ? '—' : String(valueText);
  return `<div class="activity-detail-row"><div class="activity-detail-k">${escapeHtml(label)}</div><div class="activity-detail-v">${escapeHtml(t)}</div></div>`;
}

function activityDetailRowHtml(label, innerHtml) {
  return `<div class="activity-detail-row"><div class="activity-detail-k">${escapeHtml(label)}</div><div class="activity-detail-v">${innerHtml}</div></div>`;
}

function mergeActivityBelongingFromListRow(detail, id) {
  if (pickActivityBelonging(detail)) return detail;
  const fromList =
    (activitiesState.data || []).find((x) => String(x.id) === String(id)) ||
    (virtualActivitiesState.data || []).find((x) => String(x.id) === String(id));
  if (!fromList) return detail;
  const listBel = displayActivityBelongingValue(fromList);
  if (!listBel) return detail;
  return { ...detail, belonging: listBel };
}

async function showActivityDetail(id, opts = {}) {
  try {
    const raw = await api('GET', `/activities/${encodeURIComponent(id)}?cb=${Date.now()}`);
    const a = mergeActivityBelongingFromListRow(raw, id);
    const isVirt =
      !!(opts && opts.virtualContext) ||
      Number(a.is_virtual) === 1 ||
      a.is_virtual === true;
    await ensureBelongingLabelMap();
    const belRaw = displayActivityBelongingValue(a);
    const belLabel = belRaw ? belongingLabelForValue(belRaw) : '';
    const content = document.getElementById('activityDetailContent');
    if (!content) {
      showToast('找不到活动详情弹窗，请强制刷新页面 (Cmd+Shift+R)', 'error');
      return;
    }
    const guestLine =
      a.guest_count != null && Number(a.guest_count) > 0
        ? activityDetailRow('宾客人数', String(a.guest_count))
        : '';
    const costHtml =
      parseFloat(a.total_cost) > 0
        ? `<span class="amount amount-cost">${fmtMoney(a.total_cost)}</span>`
        : '<span class="amount amount-neutral">未填写</span>';

    const titleEl = document.getElementById('activityDetailModalTitle');
    if (titleEl) {
      const pc = a.project_code ? String(a.project_code).trim() : '';
      titleEl.textContent = isVirt
        ? pc
          ? `虚拟场次 · ${pc}`
          : '虚拟场次详情'
        : pc
          ? `活动详情 · ${pc}`
          : '活动详情';
    }

    content.innerHTML = `
      <div class="activity-detail">
        <div class="activity-detail-hero">
          <div class="activity-detail-hero-top">
            <div class="activity-detail-hero-code">${escapeHtml(a.project_code || '—')}</div>
            <div class="activity-detail-hero-date">${escapeHtml(fmtDate(a.date || a.activity_date))}</div>
          </div>
          <div class="activity-detail-hero-meta">
            ${isVirt ? `<span class="badge badge-blue">虚拟场次</span>` : ''}
            <span><strong style="color:var(--text-primary)">${escapeHtml(a.city || '—')}</strong></span>
            <span class="badge badge-${brandColor(a.brand)}">${escapeHtml(a.brand || '—')}</span>
            <span class="badge badge-${typeColor(a.activity_type)}">${escapeHtml(a.activity_type || '—')}</span>
            ${
              belRaw
                ? `<span class="badge badge-gray" title="归属">${escapeHtml(belLabel)}</span>`
                : '<span style="font-size:12px;color:var(--text-muted)">归属：—</span>'
            }
          </div>
        </div>

        <div class="activity-detail-grid">
          <section class="activity-detail-card">
            <h4>场次与场地</h4>
            ${activityDetailRow('时段', a.period || '日常')}
            ${activityDetailRow('区域', a.region)}
            ${activityDetailRow('归属', belRaw ? belLabel : '')}
            ${activityDetailRow('场地', a.venue)}
            ${activityDetailRow('客户', a.client || a.client_name)}
            ${activityDetailRowHtml('云相册', a.cloud_album_url ? `<button type="button" class="btn btn-secondary btn-sm" onclick="openActivityCloudAlbum('${escapeJsSingleQuoted(a.cloud_album_url || '')}')">查看云相册</button>` : '<span style="color:var(--text-muted)">无相册</span>')}
            ${guestLine}
          </section>
          <section class="activity-detail-card">
            <h4>费用与执行</h4>
            ${activityDetailRowHtml('报价', `<span class="amount amount-revenue">${fmtMoney(a.quoted_price)}</span>`)}
            ${activityDetailRowHtml('成本', costHtml)}
            ${activityDetailRow('执行', a.executor || '无')}
            ${activityDetailRow('品牌大使', a.brand_ambassador || '')}
            ${activityDetailRowHtml('状态', statusBadge(a.status))}
          </section>
        </div>

        ${
          a.remarks
            ? `<div class="activity-detail-remarks activity-detail-block"><h4>备注</h4><p>${escapeHtml(a.remarks)}</p></div>`
            : ''
        }
        ${
          !isVirt
            ? `<div class="activity-detail-actions">
          <button type="button" class="btn btn-success btn-sm" onclick="closeModal();setTimeout(()=>showCostFill(${id}),100)"><i data-lucide="wallet" style="width:13px;height:13px"></i>填写成本</button>
        </div>`
            : `<div class="activity-detail-block" style="margin-top:12px;font-size:12px;color:var(--text-secondary)">此为虚拟预估场次，不参与排期日历；报价计入上方「虚拟场次」页预存统计。</div>`
        }
      </div>
    `;

    const editBtn = document.getElementById('detailEditBtn');
    if (editBtn) {
      editBtn.onclick = () => {
        closeModal();
        setTimeout(() => (isVirt ? showVirtualActivityModal(id) : showActivityModal(id)), 100);
      };
    }

    openModal('modalActivityDetail');
    renderLucideIcons();
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

// 成本填写弹窗
async function showCostFill(actId) {
  try {
    const a = await api('GET', `/activities/${actId}`);
    const details = parseActivityCostDetails(a);
    const cost = calcCostDetailsTotal(details);
    const markedNoCost = a && (a.no_cost === true || a.no_cost === 1 || String(a.no_cost) === '1');

    const content = document.getElementById('costFillContent');
    if (!content) {
      showToast('找不到成本弹窗，请强制刷新页面 (Cmd+Shift+R)', 'error');
      return;
    }
    content.innerHTML = `
      <input type="hidden" id="costActId" value="${actId}">
      <div style="margin-bottom:12px;padding:10px;background:var(--bg-input);border-radius:var(--radius-sm)">
        <div style="font-size:12px;color:var(--text-secondary)">${a.project_code||a.city+a.activity_type}</div>
        <div style="font-size:13px;color:var(--text-primary);margin-top:2px">当前成本：<span class="amount amount-cost">${cost>0?fmtMoney(cost):'未填写'}</span></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:10px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer">
        <input type="checkbox" id="costNoCostFlag" ${markedNoCost ? 'checked' : ''} onchange="toggleCostNoCostMode('1')">
        <span style="font-size:13px;color:var(--text-primary)">该场次无成本（勾选后不计入待填写成本）</span>
      </label>
      ${renderCostDetailSections('cost-field', details, 'updateCostTotal()')}
      <div style="margin-top:14px;padding:12px;background:var(--accent-soft);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--text-secondary);font-size:13px">成本合计</span>
        <span class="amount" style="font-size:18px;font-weight:700;color:var(--accent)" id="costTotal">${fmtMoney(cost)}</span>
      </div>
    `;

    toggleCostNoCostMode('1');
    openModal('modalCostFill');
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

function toggleCostNoCostMode(mode) {
  const checkboxId = mode === '2' ? 'costNoCostFlag2' : 'costNoCostFlag';
  const fieldClass = mode === '2' ? 'cost-field2' : 'cost-field';
  const checked = !!document.getElementById(checkboxId)?.checked;
  document.querySelectorAll(`.${fieldClass}`).forEach((el) => {
    el.disabled = checked;
    if (checked) el.value = '';
  });
  if (mode === '2') updateCostTotal2();
  else updateCostTotal();
}

function updateCostTotal() {
  let total = 0;
  document.querySelectorAll('.cost-field').forEach(el => {
    total += roundMoney2(el.value);
  });
  total = roundMoney2(total);
  const el = document.getElementById('costTotal');
  if (el) el.textContent = fmtMoney(total);
}

async function saveCostFromModal() {
  const actId = document.getElementById('costActId').value;
  const noCost = !!document.getElementById('costNoCostFlag')?.checked;
  const details = noCost ? {} : collectCostDetails('cost-field');
  const total = noCost ? 0 : roundMoney2(calcCostDetailsTotal(details));

  try {
    await api('PUT', `/activities/${actId}`, { total_cost: total, cost_details: details, no_cost: noCost ? 1 : 0 });
    showToast('成本已保存', 'success');
    closeModal();
    if (currentPage === 'activities') loadActivities();
    else if (currentPage === 'calendar' && typeof window._calYear === 'number') drawCalendar(window._calYear, window._calMonth);
    else if (currentPage === 'cost') renderCost();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

/* =============================================
   页面：排期日历
   ============================================= */
async function renderCalendar() {
  const container = document.getElementById('pageContainer');
  const now = new Date();
  let calYear = now.getFullYear();
  let calMonth = now.getMonth(); // 0-indexed

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-secondary" onclick="prevCalMonth()">‹ 上月</button>
        <h2 id="calTitle" style="font-size:18px;font-weight:700;min-width:120px;text-align:center"></h2>
        <button class="btn btn-secondary" onclick="nextCalMonth()">下月 ›</button>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="goCalToday()">今天</button>
    </div>
    <div class="calendar-grid" id="calHeader"></div>
    <div id="calGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:4px"></div>
  `;

  window._calYear = calYear;
  window._calMonth = calMonth;
  drawCalendar(calYear, calMonth);
}

async function drawCalendar(year, month) {
  const title = document.getElementById('calTitle');
  if (title) title.textContent = `${year}年 ${month+1}月`;

  // 星期头
  const header = document.getElementById('calHeader');
  if (header) {
    header.innerHTML = ['一','二','三','四','五','六','日'].map(d => `<div class="cal-header-cell">${d}</div>`).join('');
  }

  const grid = document.getElementById('calGrid');
  if (!grid) return;
  grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1/-1">加载中...</div>';

  try {
    const qs = `?year=${year}&month=${month+1}${currentYearFrameId?'&yearFrameId='+currentYearFrameId:''}`;
    const calResp = await api('GET', `/calendar${qs}`);
    const activities = Array.isArray(calResp) ? calResp : (calResp.data || []);

    // 按日期索引
    const actMap = {};
    activities.forEach(a => {
      const d = new Date(a.activity_date || a.date);
      if (!isNaN(d)) {
        // 日期是UTC存储，需要+1天修正时区（UTC+8）
        const local = new Date(d.getTime() + 8*3600*1000);
        const key = `${local.getUTCFullYear()}-${local.getUTCMonth()+1}-${local.getUTCDate()}`;
        if (!actMap[key]) actMap[key] = [];
        actMap[key].push(a);
      }
    });

    const firstDay = new Date(year, month, 1);
    let startWeekDay = firstDay.getDay(); // 0=Sun
    startWeekDay = startWeekDay === 0 ? 6 : startWeekDay - 1; // Mon=0

    const daysInMonth = new Date(year, month+1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const today = new Date();
    let html = '';

    // 上月填充
    for (let i = startWeekDay - 1; i >= 0; i--) {
      html += `<div class="cal-cell other-month"><div class="cal-date">${daysInPrevMonth-i}</div></div>`;
    }

    // 当月
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = today.getFullYear()===year && today.getMonth()===month && today.getDate()===d;
      const key = `${year}-${month+1}-${d}`;
      const acts = actMap[key] || [];

      html += `<div class="cal-cell ${isToday?'today':''}">
        <div class="cal-date">${d}</div>
        ${acts.slice(0,3).map(a => `
          <div class="cal-event brand-${(a.brand||'').toLowerCase().replace('.','')}${a.status === 'deferred' ? ' cal-event-deferred' : ''}" title="${a.city}｜${a.client||a.client_name||''}｜${a.activity_type}${a.status === 'deferred' ? '｜延期' : ''}"
            onclick="showActivityDetail(${a.id})">
            ${a.city||''} ${a.brand||''} ${a.activity_type||''}
          </div>
        `).join('')}
        ${acts.length > 3 ? `<div class="cal-event" style="background:var(--bg-input);color:var(--text-muted)">+${acts.length-3}场</div>` : ''}
      </div>`;
    }

    // 下月填充
    const totalCells = startWeekDay + daysInMonth;
    const remaining = (7 - totalCells % 7) % 7;
    for (let d = 1; d <= remaining; d++) {
      html += `<div class="cal-cell other-month"><div class="cal-date">${d}</div></div>`;
    }

    grid.innerHTML = html;
  } catch (err) {
    grid.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger);grid-column:1/-1">加载失败: ${err.message}</div>`;
  }
}

function prevCalMonth() {
  window._calMonth--;
  if (window._calMonth < 0) { window._calMonth = 11; window._calYear--; }
  drawCalendar(window._calYear, window._calMonth);
}

function nextCalMonth() {
  window._calMonth++;
  if (window._calMonth > 11) { window._calMonth = 0; window._calYear++; }
  drawCalendar(window._calYear, window._calMonth);
}

function goCalToday() {
  const n = new Date();
  window._calYear = n.getFullYear();
  window._calMonth = n.getMonth();
  drawCalendar(window._calYear, window._calMonth);
}

/* =============================================
   页面：活动成本（原成本管理）
   ============================================= */
function ymKeyForCostActivity(a) {
  const dt = new Date(a.date || a.activity_date);
  if (isNaN(dt)) return 'unknown';
  const local = new Date(dt.getTime() + 8 * 3600 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function uniqueCostYmKeys(rows) {
  return Array.from(new Set((rows || []).map(ymKeyForCostActivity)))
    .filter((k) => k !== 'unknown')
    .sort((a, b) => b.localeCompare(a));
}

function applyCostYmFilter(rows, key) {
  if (key === 'all') return rows || [];
  return (rows || []).filter((a) => ymKeyForCostActivity(a) === key);
}

function renderCostYmFilterButtons(section, keys, selected) {
  const allBtn = `<button class="btn btn-secondary btn-sm" style="${selected === 'all' ? 'background:var(--accent);color:white' : ''}" onclick="setCostYmFilter('${section}','all')">全部</button>`;
  const monthBtns = (keys || []).map((k) => {
    const [y, m] = k.split('-');
    return `<button class="btn btn-secondary btn-sm" style="${selected === k ? 'background:var(--accent);color:white' : ''}" onclick="setCostYmFilter('${section}','${k}')">${y}年${parseInt(m, 10)}月</button>`;
  }).join('');
  return `${allBtn}${monthBtns}`;
}

function setCostYmFilter(section, key) {
  if (section === 'pending') {
    costPendingYMFilter = key;
    localStorage.setItem('remy_costPendingYMFilter', key);
    // 兼容历史 key
    localStorage.setItem('remy_costNoCostYMFilter', key);
  } else if (section === 'withCost') {
    costWithCostYMFilter = key;
    localStorage.setItem('remy_costWithCostYMFilter', key);
  } else if (section === 'noCost') {
    costMarkedNoCostYMFilter = key;
    localStorage.setItem('remy_costMarkedNoCostYMFilter', key);
  }
  renderCost();
}

function toggleCostSection(section) {
  const idMap = {
    pending: 'pendingCostTable',
    withCost: 'withCostTable',
    noCost: 'noCostTable',
  };
  const panelId = idMap[section];
  if (!panelId) return;
  const el = document.getElementById(panelId);
  if (!el) return;
  const willCollapse = el.style.display !== 'none';
  el.style.display = willCollapse ? 'none' : '';
  costSectionCollapsed[section] = willCollapse;
  localStorage.setItem(`remy_costSectionCollapsed_${section}`, willCollapse ? '1' : '0');
}

const COST_STATS_CARD_ORDER_KEY = 'remy_costStatsCardOrder';
const COST_STATS_CARD_KEYS = ['totalRev', 'totalCost', 'allocatedCost', 'pooledCost', 'grossProfit', 'filledCount', 'propRepairCost', 'logisticsCost', 'materialCost', 'reimbursementCost'];

function normalizeCostStatsCardOrder(input) {
  const arr = Array.isArray(input) ? input.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const seen = new Set();
  const out = [];
  arr.forEach((k) => {
    if (COST_STATS_CARD_KEYS.includes(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  });
  COST_STATS_CARD_KEYS.forEach((k) => {
    if (!seen.has(k)) out.push(k);
  });
  return out;
}

function readCostStatsCardOrder() {
  try {
    const raw = localStorage.getItem(COST_STATS_CARD_ORDER_KEY);
    if (!raw) return [...COST_STATS_CARD_KEYS];
    return normalizeCostStatsCardOrder(JSON.parse(raw));
  } catch {
    return [...COST_STATS_CARD_KEYS];
  }
}

function writeCostStatsCardOrder(order) {
  try {
    localStorage.setItem(COST_STATS_CARD_ORDER_KEY, JSON.stringify(normalizeCostStatsCardOrder(order)));
  } catch {}
}

function applySavedCostStatsCardOrder(grid) {
  if (!grid) return;
  const order = readCostStatsCardOrder();
  order.forEach((key) => {
    const card = grid.querySelector(`[data-cost-card-key="${key}"]`);
    if (card) grid.appendChild(card);
  });
}

function bindCostStatsCardDrag(grid) {
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll('[data-cost-card-key]'));
  cards.forEach((card) => {
    card.draggable = true;
    card.style.cursor = 'grab';
    card.addEventListener('dragstart', (e) => {
      const key = card.getAttribute('data-cost-card-key') || '';
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key);
      }
      card.classList.add('dragging');
      card.style.opacity = '0.6';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.style.opacity = '';
      const orderedKeys = Array.from(grid.querySelectorAll('[data-cost-card-key]')).map((el) => el.getAttribute('data-cost-card-key'));
      writeCostStatsCardOrder(orderedKeys);
    });
  });

  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = grid.querySelector('[data-cost-card-key].dragging');
    if (!dragging) return;
    const target = e.target.closest('[data-cost-card-key]');
    if (!target || target === dragging || !grid.contains(target)) return;
    const rect = target.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    if (after) grid.insertBefore(dragging, target.nextSibling);
    else grid.insertBefore(dragging, target);
  });
}

function buildReimbByActivityMap(reimbursements) {
  const reimbByAct = {};
  let mergedTotal = 0;
  (reimbursements || []).forEach((r) => {
    const aid = r.activity_id;
    if (aid == null || aid === '') return;
    const idKey = Number(aid);
    if (!Number.isFinite(idKey) || idKey <= 0) return;
    const amt = parseFloat(r.amount) || 0;
    const merged = r.merged_into_activity === 1 || r.merged_into_activity === true;
    if (merged) mergedTotal += amt;
    if (!reimbByAct[idKey]) reimbByAct[idKey] = { standalone: 0, merged: 0 };
    if (merged) reimbByAct[idKey].merged += amt;
    else reimbByAct[idKey].standalone += amt;
  });
  return { reimbByAct, mergedTotal };
}

function activityReimbCellHtml(reimbByAct, actId) {
  const o = reimbByAct[Number(actId)];
  if (!o || (o.standalone <= 0 && o.merged <= 0)) return '<span class="amount amount-neutral">—</span>';
  const bits = [];
  if (o.standalone > 0) bits.push(`<span class="amount amount-cost">${fmtMoney(o.standalone)}</span>`);
  if (o.merged > 0) {
    bits.push(`<span style="font-size:11px;color:var(--text-muted)">已合 ${fmtMoney(o.merged)}</span>`);
  }
  return bits.join('<br>');
}

async function renderCost() {
  const container = document.getElementById('pageContainer');

  try {
    await ensureBelongingLabelMap();
    let qsAct = '?isVirtual=0';
    if (currentYearFrameId) qsAct += `&yearFrameId=${currentYearFrameId}`;
    const qs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : '';
    const [activities, reimbursements] = await Promise.all([
      api('GET', `/activities${qsAct}`),
      api('GET', `/reimbursements${qs}`),
    ]);
    const { reimbByAct } = buildReimbByActivityMap(reimbursements);

    const isMarkedNoCost = (a) => {
      const v = a && a.no_cost;
      return v === true || v === 1 || String(v) === '1';
    };

    const actsWithCost = activities.filter((a) => !isMarkedNoCost(a) && parseFloat(a.total_cost) > 0);
    const actsPendingCost = activities.filter((a) => !isMarkedNoCost(a) && !(parseFloat(a.total_cost) > 0));
    const actsMarkedNoCost = activities.filter((a) => isMarkedNoCost(a));

    const pendingKeys = uniqueCostYmKeys(actsPendingCost);
    const withCostKeys = uniqueCostYmKeys(actsWithCost);
    const noCostKeys = uniqueCostYmKeys(actsMarkedNoCost);

    if (costPendingYMFilter !== 'all' && !pendingKeys.includes(costPendingYMFilter)) {
      costPendingYMFilter = 'all';
      localStorage.setItem('remy_costPendingYMFilter', 'all');
      localStorage.setItem('remy_costNoCostYMFilter', 'all');
    }
    if (costWithCostYMFilter !== 'all' && !withCostKeys.includes(costWithCostYMFilter)) {
      costWithCostYMFilter = 'all';
      localStorage.setItem('remy_costWithCostYMFilter', 'all');
    }
    if (costMarkedNoCostYMFilter !== 'all' && !noCostKeys.includes(costMarkedNoCostYMFilter)) {
      costMarkedNoCostYMFilter = 'all';
      localStorage.setItem('remy_costMarkedNoCostYMFilter', 'all');
    }

    const filteredActsPending = applyCostYmFilter(actsPendingCost, costPendingYMFilter);
    const filteredActsWithCost = applyCostYmFilter(actsWithCost, costWithCostYMFilter);
    const filteredActsMarkedNoCost = applyCostYmFilter(actsMarkedNoCost, costMarkedNoCostYMFilter);

    container.innerHTML = `
      <!-- 待填写成本 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div style="flex:1">
            <div class="card-title"><i data-lucide="hourglass" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>待填写成本（${filteredActsPending.length}场）</div>
            <div class="card-sub">
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                ${renderCostYmFilterButtons('pending', pendingKeys, costPendingYMFilter)}
              </div>
              <div style="margin-top:8px">点击"填写"按钮添加成本明细</div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="toggleCostSection('pending')">展开/收起</button>
        </div>
        <div id="pendingCostTable" style="${costSectionCollapsed.pending ? 'display:none' : ''}">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>项目编号</th>
                  <th>区域</th>
                  <th>归属</th>
                  <th>品牌</th>
                  <th>类型</th>
                  <th>报价</th>
                  <th>成本</th>
                  <th>关联报销</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${filteredActsPending.slice(0,30).map(a => `
                  <tr onclick="showCostDetailFromCost(${a.id})" style="cursor:pointer">
                    <td>${fmtDateShort(a.date||a.activity_date)}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.project_code||''}">${a.project_code||'—'}</td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${a.region||'—'}</span></td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(formatActivityBelongingForTable(a))}</span></td>
                    <td><span class="badge badge-${brandColor(a.brand)}">${a.brand||'—'}</span></td>
                    <td><span class="badge badge-${typeColor(a.activity_type)}">${a.activity_type||'—'}</span></td>
                    <td class="amount amount-revenue">${fmtMoney(a.quoted_price)}</td>
                    <td class="amount amount-neutral">—</td>
                    <td style="font-size:11px;line-height:1.35">${activityReimbCellHtml(reimbByAct, a.id)}</td>
                    <td onclick="event.stopPropagation()"><button class="btn btn-success btn-sm" onclick="showCostFillFromCost(${a.id})">+ 填写</button></td>
                  </tr>
                `).join('')}
                ${filteredActsPending.length > 30 ? `<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:10px">还有 ${filteredActsPending.length-30} 条，请在场次记录中查看</td></tr>` : ''}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 无成本活动 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div style="flex:1">
            <div class="card-title"><i data-lucide="circle-minus" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>无成本场次（${filteredActsMarkedNoCost.length}场）</div>
            <div class="card-sub">
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                ${renderCostYmFilterButtons('noCost', noCostKeys, costMarkedNoCostYMFilter)}
              </div>
              <div style="margin-top:8px">此类场次不计入“待填写成本”</div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="toggleCostSection('noCost')">展开/收起</button>
        </div>
        <div id="noCostTable" style="${costSectionCollapsed.noCost ? 'display:none' : ''}">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>项目编号</th>
                  <th>区域</th>
                  <th>归属</th>
                  <th>品牌</th>
                  <th>类型</th>
                  <th>报价</th>
                  <th>成本</th>
                  <th>关联报销</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${filteredActsMarkedNoCost.map(a => `
                  <tr onclick="showCostDetailFromCost(${a.id})" style="cursor:pointer">
                    <td>${fmtDateShort(a.date||a.activity_date)}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.project_code||''}">${a.project_code||'—'}</td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${a.region||'—'}</span></td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(formatActivityBelongingForTable(a))}</span></td>
                    <td><span class="badge badge-${brandColor(a.brand)}">${a.brand||'—'}</span></td>
                    <td><span class="badge badge-${typeColor(a.activity_type)}">${a.activity_type||'—'}</span></td>
                    <td class="amount amount-revenue">${fmtMoney(a.quoted_price)}</td>
                    <td class="amount amount-neutral">无成本</td>
                    <td style="font-size:11px;line-height:1.35">${activityReimbCellHtml(reimbByAct, a.id)}</td>
                    <td onclick="event.stopPropagation()"><button class="btn btn-secondary btn-sm" onclick="showCostFillFromCost(${a.id})">修改</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 已填成本活动 -->
      <div class="card">
        <div class="card-header">
          <div style="flex:1">
            <div class="card-title"><i data-lucide="circle-check-big" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>已填成本（${filteredActsWithCost.length}场）</div>
            <div class="card-sub">
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                ${renderCostYmFilterButtons('withCost', withCostKeys, costWithCostYMFilter)}
              </div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="toggleCostSection('withCost')">展开/收起</button>
        </div>
        <div id="withCostTable" style="${costSectionCollapsed.withCost ? 'display:none' : ''}">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>项目编号</th>
                <th>区域</th>
                <th>归属</th>
                <th>品牌</th>
                <th>类型</th>
                <th>报价</th>
                <th>成本</th>
                <th>关联报销</th>
                <th>利润</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${filteredActsWithCost.map(a => {
                const profit = (parseFloat(a.quoted_price)||0) - (parseFloat(a.total_cost)||0);
                return `
                  <tr onclick="showCostDetailFromCost(${a.id})" style="cursor:pointer">
                    <td>${fmtDateShort(a.date||a.activity_date)}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.project_code||''}">${a.project_code||'—'}</td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${a.region||'—'}</span></td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(formatActivityBelongingForTable(a))}</span></td>
                    <td><span class="badge badge-${brandColor(a.brand)}">${a.brand||'—'}</span></td>
                    <td><span class="badge badge-${typeColor(a.activity_type)}">${a.activity_type||'—'}</span></td>
                    <td class="amount amount-revenue">${fmtMoney(a.quoted_price)}</td>
                    <td class="amount amount-cost">${fmtMoney(a.total_cost)}</td>
                    <td style="font-size:11px;line-height:1.35">${activityReimbCellHtml(reimbByAct, a.id)}</td>
                    <td class="amount ${profit>=0?'amount-revenue':'amount-cost'}">${fmtMoney(profit)}</td>
                    <td onclick="event.stopPropagation()"><button class="btn btn-secondary btn-sm" onclick="showCostFillFromCost(${a.id})">修改</button></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        </div>
      </div>
    `;
    renderLucideIcons();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${err.message}</div></div>`;
    renderLucideIcons();
  }
}

const COST_DETAIL_GROUPS = [
  {
    title: '一、人员',
    items: [
      { key: 'supervisor', label: '督导' },
      { key: 'pg', label: 'PG礼仪' },
      { key: 'parttime', label: '兼职' },
      { key: 'bartender', label: '调酒师' },
      { key: 'photo', label: '摄影师' },
      { key: 'cloud_album_edit', label: '云相册修图' },
      { key: 'performance', label: '演职人员' },
    ],
  },
  {
    title: '二、差旅',
    items: [
      { key: 'travel_supervisor', label: '督导差旅（交通及食宿）' },
      { key: 'travel_company', label: '盛融差旅（交通及食宿）' },
    ],
  },
  {
    title: '三、舞美制作',
    items: [
      { key: 'structure', label: '结构搭建' },
      { key: 'print', label: '印刷' },
      { key: 'spray', label: '写真喷绘' },
    ],
  },
  {
    title: '四、采购',
    items: [
      { key: 'floral', label: '场地方（场地/餐饮）' },
      { key: 'floral_design', label: '花艺' },
      { key: 'payment', label: '活动物料' },
      { key: 'tasting', label: '闻香物料' },
    ],
  },
  {
    title: '五、物流仓储',
    items: [
      { key: 'warehouse', label: '仓储' },
      { key: 'express', label: '快递（闪送）' },
      { key: 'logistics', label: '物流' },
    ],
  },
];

function parseActivityCostDetails(activity) {
  const out = {};
  let raw = activity && activity.cost_details;
  if (raw && typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { raw = null; }
  }
  if (!raw || typeof raw !== 'object') raw = {};
  COST_DETAIL_GROUPS.forEach((g) => {
    g.items.forEach((it) => {
      const v = raw[it.key] != null ? raw[it.key] : (activity ? activity[it.key] : null);
      out[it.key] = Number.isFinite(parseFloat(v)) ? roundMoney2(v) : 0;
    });
  });
  return out;
}

function renderCostDetailSections(fieldClass, details, onInputExpr) {
  return COST_DETAIL_GROUPS.map((g) => `
    <div class="card" style="margin-bottom:12px;border:1px dashed var(--border)">
      <div class="card-header" style="padding:10px 12px">
        <div class="card-title" style="font-size:14px">${g.title}</div>
      </div>
      <div class="card-body" style="padding:10px 12px">
        <div class="cost-grid">
          ${g.items.map((f) => `
            <div class="form-group">
              <label class="form-label">${f.label}</label>
              <input type="number" class="form-control ${fieldClass}" data-key="${f.key}" value="${roundMoney2(details[f.key]) > 0 ? roundMoney2(details[f.key]).toFixed(2) : ''}" step="0.01" oninput="${onInputExpr}">
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

function collectCostDetails(fieldClass) {
  const details = {};
  document.querySelectorAll(`.${fieldClass}`).forEach((el) => {
    const key = el.getAttribute('data-key');
    if (!key) return;
    details[key] = roundMoney2(el.value);
  });
  return details;
}

function calcCostDetailsTotal(details) {
  if (!details || typeof details !== 'object') return 0;
  return roundMoney2(Object.values(details).reduce((s, v) => s + roundMoney2(v), 0));
}

async function showCostDetailFromCost(actId) {
  try {
    const a = await api('GET', `/activities/${actId}`);
    const details = parseActivityCostDetails(a);
    const total = calcCostDetailsTotal(details);
    const noCost = a && (a.no_cost === true || a.no_cost === 1 || String(a.no_cost) === '1');
    const content = document.getElementById('costDetailContent');
    if (!content) {
      showToast('找不到成本详情弹窗，请强制刷新页面 (Cmd+Shift+R)', 'error');
      return;
    }

    const titleEl = document.getElementById('costDetailModalTitle');
    if (titleEl) {
      const pc = a.project_code ? String(a.project_code).trim() : '';
      titleEl.textContent = pc ? `成本详情 · ${pc}` : '成本详情';
    }

    const detailCards = COST_DETAIL_GROUPS.map((g) => {
      const rows = g.items
        .map((it) => {
          const v = roundMoney2(details[it.key] || 0);
          return `<div class="activity-detail-row"><div class="activity-detail-k">${escapeHtml(it.label)}</div><div class="activity-detail-v"><span class="${v > 0 ? 'amount amount-cost' : 'amount amount-neutral'}">${v > 0 ? fmtMoney(v) : '—'}</span></div></div>`;
        })
        .join('');
      return `<section class="activity-detail-card"><h4>${escapeHtml(g.title)}</h4>${rows}</section>`;
    }).join('');

    content.innerHTML = `
      <div class="activity-detail">
        <div class="activity-detail-hero">
          <div class="activity-detail-hero-top">
            <div class="activity-detail-hero-code">${escapeHtml(a.project_code || '—')}</div>
            <div class="activity-detail-hero-date">${escapeHtml(fmtDate(a.date || a.activity_date))}</div>
          </div>
          <div class="activity-detail-hero-meta">
            <span><strong style="color:var(--text-primary)">${escapeHtml(a.city || '—')}</strong></span>
            <span class="badge badge-${brandColor(a.brand)}">${escapeHtml(a.brand || '—')}</span>
            <span class="badge badge-${typeColor(a.activity_type)}">${escapeHtml(a.activity_type || '—')}</span>
          </div>
        </div>
        <div class="activity-detail-grid">
          <section class="activity-detail-card">
            <h4>场次信息</h4>
            <div class="activity-detail-row"><div class="activity-detail-k">状态</div><div class="activity-detail-v">${statusBadge(a.status)}</div></div>
            <div class="activity-detail-row"><div class="activity-detail-k">报价</div><div class="activity-detail-v"><span class="amount amount-revenue">${fmtMoney(a.quoted_price || 0)}</span></div></div>
            <div class="activity-detail-row"><div class="activity-detail-k">成本</div><div class="activity-detail-v"><span class="${noCost ? 'amount amount-neutral' : 'amount amount-cost'}">${noCost ? '无成本' : fmtMoney(total)}</span></div></div>
            <div class="activity-detail-row"><div class="activity-detail-k">利润</div><div class="activity-detail-v"><span class="amount ${(Number(a.quoted_price || 0) - total) >= 0 ? 'amount-revenue' : 'amount-cost'}">${fmtMoney((Number(a.quoted_price || 0) - total))}</span></div></div>
          </section>
        </div>
        <div class="activity-detail-grid">
          ${detailCards}
        </div>
      </div>
    `;

    const editBtn = document.getElementById('costDetailEditBtn');
    if (editBtn) {
      editBtn.onclick = () => {
        closeModal();
        setTimeout(() => showCostFillFromCost(actId), 100);
      };
    }
    openModal('modalCostDetail');
    renderLucideIcons();
  } catch (err) {
    showToast('加载成本详情失败: ' + err.message, 'error');
  }
}

async function showCostFillFromCost(actId) {
  try {
    const a = await api('GET', `/activities/${actId}`);
    const details = parseActivityCostDetails(a);
    const content = document.getElementById('costFillContent2');
    if (!content) {
      showToast('找不到成本弹窗，请强制刷新页面 (Cmd+Shift+R)', 'error');
      return;
    }
    const total = calcCostDetailsTotal(details);
    const markedNoCost = a && (a.no_cost === true || a.no_cost === 1 || String(a.no_cost) === '1');
    content.innerHTML = `
      <input type="hidden" id="costActId2" value="${actId}">
      <div style="margin-bottom:12px;padding:10px;background:var(--bg-input);border-radius:var(--radius-sm)">
        <div style="font-size:12px;color:var(--text-secondary)">${a.project_code||a.city+(a.activity_type||'')}</div>
        <div style="font-size:13px;color:var(--text-primary);margin-top:2px">报价：<span class="amount amount-revenue">${fmtMoney(a.quoted_price)}</span></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:10px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer">
        <input type="checkbox" id="costNoCostFlag2" ${markedNoCost ? 'checked' : ''} onchange="toggleCostNoCostMode('2')">
        <span style="font-size:13px;color:var(--text-primary)">该场次无成本（勾选后不计入待填写成本）</span>
      </label>
      ${renderCostDetailSections('cost-field2', details, 'updateCostTotal2()')}
      <div style="margin-top:14px;padding:12px;background:var(--accent-soft);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--text-secondary);font-size:13px">成本合计</span>
        <span class="amount" style="font-size:18px;font-weight:700;color:var(--accent)" id="costTotal2">${fmtMoney(total)}</span>
      </div>
    `;
    toggleCostNoCostMode('2');
    openModal('modalCostFill2');
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

function updateCostTotal2() {
  let total = 0;
  document.querySelectorAll('.cost-field2').forEach((el) => {
    total += roundMoney2(el.value);
  });
  total = roundMoney2(total);
  const el = document.getElementById('costTotal2');
  if (el) el.textContent = fmtMoney(total);
}

async function saveCostFromModal2() {
  const actId = document.getElementById('costActId2').value;
  const noCost = !!document.getElementById('costNoCostFlag2')?.checked;
  const details = noCost ? {} : collectCostDetails('cost-field2');
  const total = noCost ? 0 : roundMoney2(calcCostDetailsTotal(details));
  try {
    await api('PUT', `/activities/${actId}`, { total_cost: total, cost_details: details, no_cost: noCost ? 1 : 0 });
    showToast('成本已保存', 'success');
    closeModal();
    renderCost();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

/* =============================================
   页面：物流成本（原物流记录）
   ============================================= */
async function renderLogistics() {
  const container = document.getElementById('pageContainer');

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <input type="text" class="search-input" id="logSearch" placeholder="搜索单号/城市/项目编号..." oninput="filterLogistics()">
        <select class="filter-select" id="logMergeFilter" onchange="setLogisticsMergeFilter(this.value)">
          <option value="all">计入：全部</option>
          <option value="unmerged">计入：未计入</option>
          <option value="merged">计入：已计入</option>
        </select>
      </div>
      <div class="toolbar-right" style="display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-danger btn-sm" id="logBatchDeleteBtn" disabled onclick="deleteSelectedLogistics()">一键删除</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="showLogisticsModal()">+ 新建物流</button>
      </div>
    </div>
    <div id="logTable"></div>
  `;

  await loadLogistics();
  const mf = document.getElementById('logMergeFilter');
  if (mf) mf.value = logisticsMergeFilter;
}

/** 与物流表格一致：当前已加载数据 + 搜索框过滤后的可见行 */
function getLogisticsVisibleRows() {
  const search = (document.getElementById('logSearch')?.value || '').toLowerCase();
  let data = logisticsState.data || [];
  if (logisticsMergeFilter === 'merged') data = data.filter((l) => isMergedFlag(l.merged_into_activity));
  if (logisticsMergeFilter === 'unmerged') data = data.filter((l) => !isMergedFlag(l.merged_into_activity));
  if (search) {
    data = data.filter((l) =>
    (l.tracking_number || '').toLowerCase().includes(search) ||
    (l.logistics_company || '').toLowerCase().includes(search) ||
    (l.express_company || '').toLowerCase().includes(search) ||
    (l.origin_city || '').toLowerCase().includes(search) ||
    (l.destination_city || '').toLowerCase().includes(search) ||
    (l.related_project_code || '').toLowerCase().includes(search) ||
    (l.project_code || '').toLowerCase().includes(search)
    );
  }
  return sortLogisticsRows(data);
}

function logisticsSortDateValue(row) {
  const settlement = parseSettlementMonthValue(row && row.settlement_month);
  const hasSettlementMonth = !!(settlement.year && settlement.month);
  const isMonthly = isTruthyFlag(row && row.monthly_settlement);
  if (hasSettlementMonth && (isMonthly || !(row && row.shipping_date))) {
    return Date.UTC(parseInt(settlement.year, 10), parseInt(settlement.month, 10) - 1, 1);
  }
  const dt = new Date(row && row.shipping_date ? row.shipping_date : 0).getTime();
  return Number.isFinite(dt) ? dt : 0;
}

function sortLogisticsRows(rows) {
  const key = logisticsSortState.key;
  const dir = logisticsSortState.dir === 'asc' ? 1 : -1;
  const arr = Array.isArray(rows) ? rows.slice() : [];
  const cmpText = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN');
  arr.sort((a, b) => {
    let c = 0;
    if (key === 'shipping_date') {
      c = logisticsSortDateValue(a) - logisticsSortDateValue(b);
    } else if (key === 'brand') {
      c = cmpText(a.brand, b.brand);
      if (c === 0) c = cmpText(a.logistics_company, b.logistics_company);
    } else if (key === 'logistics_company') {
      c = cmpText(a.logistics_company, b.logistics_company);
      if (c === 0) c = cmpText(a.brand, b.brand);
    }
    if (c === 0) c = Number(a.id || 0) - Number(b.id || 0);
    return c * dir;
  });
  return arr;
}

function logisticsSortIndicator(key) {
  if (logisticsSortState.key !== key) return '';
  return logisticsSortState.dir === 'asc' ? ' ↑' : ' ↓';
}

function toggleLogisticsSort(key) {
  if (!['shipping_date', 'brand', 'logistics_company'].includes(key)) return;
  if (logisticsSortState.key === key) {
    logisticsSortState.dir = logisticsSortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    logisticsSortState.key = key;
    logisticsSortState.dir = 'asc';
  }
  loadLogistics();
}

function setLogisticsMergeFilter(v) {
  logisticsMergeFilter = v || 'all';
  loadLogistics();
}

function settlementYearOptions() {
  return ['2025', '2026', '2027'];
}

function settlementMonthOptions() {
  const options = [];
  for (let m = 1; m <= 12; m += 1) options.push(String(m));
  return options;
}

function parseSettlementMonthValue(v) {
  if (!v) return { year: '', month: '' };
  const text = String(v).trim();
  const m = text.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return { year: '', month: '' };
  return { year: m[1], month: String(Number(m[2])) };
}

function isTruthyFlag(v) {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

function logisticsDisplayDate(row) {
  if (!row) return '—';
  const settlement = parseSettlementMonthValue(row.settlement_month);
  const hasSettlementMonth = !!(settlement.year && settlement.month);
  const isMonthly = isTruthyFlag(row.monthly_settlement);
  if (hasSettlementMonth && (isMonthly || !row.shipping_date)) return `${settlement.year}-${settlement.month}`;
  return fmtDateShort(row.shipping_date);
}

function initLogisticsSettlementMonthSelect() {
  const yearSel = document.getElementById('logSettlementYear');
  const monthSel = document.getElementById('logSettlementMonth');
  if (!yearSel || !monthSel) return;
  const years = settlementYearOptions();
  const months = settlementMonthOptions();
  yearSel.innerHTML = [
    '<option value="">请选择年份</option>',
    ...years.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`),
  ].join('');
  monthSel.innerHTML = [
    '<option value="">请选择月份</option>',
    ...months.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}月</option>`),
  ].join('');
}

async function loadLogistics() {
  const container = document.getElementById('logTable');
  if (!container) return;
  try {
    const qs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : '';
    const data = await api('GET', `/logistics${qs}`);
    const logisticsBrands = new Set(['PHD', 'X.O', 'CLUB', 'REMY']);
    const logisticsCompanies = new Set(['东区仓库（叶老板）', '南区仓库（天空）', '北区仓库（叶老板）']);
    const expressCompanies = new Set(['顺丰', '京东', '中通', '圆通', '其他']);
    logisticsState.data = (data || []).map((l) => {
      const row = { ...l };
      const lc = String(row.logistics_company || '').trim();
      const ec = String(row.express_company || '').trim();
      const brand = String(row.brand || '').trim();
      if (!logisticsCompanies.has(lc) && expressCompanies.has(lc) && !ec) {
        // 兼容旧数据：历史上快递公司写在 logistics_company 字段里
        row.express_company = lc;
      }
      row.brand = logisticsBrands.has(brand) ? brand : 'PHD';
      return row;
    });

    const filtered = getLogisticsVisibleRows();

    const idSetVisible = new Set(filtered.map((l) => Number(l.id)));
    const nextSel = new Set();
    logisticsState.selectedIds.forEach((id) => {
      if (idSetVisible.has(id)) nextSel.add(id);
    });
    logisticsState.selectedIds = nextSel;

    const totalFee = filtered.reduce((s,l) => s+(parseFloat(l.fee)||0), 0);

    container.innerHTML = `
      <div style="margin-bottom:12px;display:flex;gap:12px">
        <div class="stat-card blue" style="flex:0 0 160px;padding:14px">
          <div class="stat-label">共 ${filtered.length} 条</div>
          <div class="stat-value sm">${fmtMoney(totalFee)}</div>
          <div class="stat-sub">物流费用合计</div>
        </div>
      </div>
      <div class="table-wrapper log-table-scroll-wrap">
        <table class="log-table-sticky-head">
          <thead><tr>
              <th style="width:44px;text-align:center" title="多选">
                <input type="checkbox" id="logSelectAll" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)" onchange="toggleLogisticsSelectAll(this.checked)" aria-label="全选当前列表">
              </th>
              <th style="cursor:pointer;user-select:none" onclick="toggleLogisticsSort('shipping_date')" title="点击排序">日期${logisticsSortIndicator('shipping_date')}</th>
              <th style="cursor:pointer;user-select:none" onclick="toggleLogisticsSort('brand')" title="点击排序">品牌${logisticsSortIndicator('brand')}</th>
              <th style="cursor:pointer;user-select:none" onclick="toggleLogisticsSort('logistics_company')" title="点击排序">物流公司${logisticsSortIndicator('logistics_company')}</th>
              <th>单号</th><th>路线</th><th>费用</th><th>关联项目</th><th>计入说明</th><th>计入状态</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${filtered.length ? filtered.map(l => {
              const lid = Number(l.id);
              const isSel = logisticsState.selectedIds.has(lid);
              return `
              <tr>
                <td style="text-align:center;vertical-align:middle">
                  <input type="checkbox" class="log-row-cb" data-log-id="${lid}" ${isSel ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)" onchange="toggleLogisticsRowSelect(${lid}, this.checked)" aria-label="选择该条物流记录">
                </td>
                <td>${logisticsDisplayDate(l)}</td>
                <td><span class="badge badge-purple">${escapeHtml(l.brand || 'PHD')}</span></td>
                <td>
                  <span class="badge badge-blue">${l.logistics_company||'—'}</span>
                  ${l.special_car ? '' : (l.express_company ? `<span style="margin-left:6px;color:var(--text-secondary);font-size:12px">${l.express_company}</span>` : '')}
                </td>
                <td>
                  ${isTruthyFlag(l.monthly_settlement)
                    ? `<span class="badge badge-green">月结${l.settlement_month ? ` ${escapeHtml(l.settlement_month)}` : ''}</span>`
                    : l.special_car
                    ? '<span class="badge badge-accent">专车</span>'
                    : l.tracking_number
                      ? `<a href="https://www.sf-express.com/cn/sc/dynamic_function/waybill/#search/bill-number/${l.tracking_number}" target="_blank" style="color:var(--accent);font-family:monospace;font-size:12px">${l.tracking_number}</a>`
                      : '—'}
                </td>
                <td style="font-size:12px">${l.origin_city||''}→${l.destination_city||''}</td>
                <td class="amount ${parseFloat(l.fee)>0?'amount-cost':'amount-neutral'}">${parseFloat(l.fee)>0?fmtMoney(l.fee):'—'}</td>
                <td class="project-code">${formatLogisticsRelatedProject(l)}</td>
                <td>${listAllocationNoteHtml(l.allocation_note)}</td>
                <td>${isMergedFlag(l.merged_into_activity) ? '<span class="badge badge-success">已计入</span>' : '<span class="badge badge-gray">未计入</span>'}</td>
                <td>
                  <div style="display:flex;gap:4px">
                    <button class="btn btn-secondary btn-sm" onclick="showLogisticsModal(${l.id})">编辑</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteLogistics(${l.id})">删</button>
                  </div>
                </td>
              </tr>
            `;
            }).join('') : '<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:30px">暂无数据</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    updateLogisticsSelectUi();
    void updateBadges();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${err.message}</div></div>`;
    renderLucideIcons();
  }
}

function toggleLogisticsRowSelect(id, checked) {
  const n = Number(id);
  if (!Number.isFinite(n)) return;
  if (checked) logisticsState.selectedIds.add(n);
  else logisticsState.selectedIds.delete(n);
  updateLogisticsSelectUi();
}

function toggleLogisticsSelectAll(checked) {
  const filtered = getLogisticsVisibleRows();
  const ids = filtered.map((l) => Number(l.id)).filter(Number.isFinite);
  if (checked) ids.forEach((id) => logisticsState.selectedIds.add(id));
  else ids.forEach((id) => logisticsState.selectedIds.delete(id));
  document.querySelectorAll('.log-row-cb').forEach((cb) => {
    const id = Number(cb.getAttribute('data-log-id'));
    cb.checked = logisticsState.selectedIds.has(id);
  });
  updateLogisticsSelectUi();
}

function updateLogisticsSelectUi() {
  const allCb = document.getElementById('logSelectAll');
  const filtered = getLogisticsVisibleRows();
  if (allCb) {
    if (!filtered.length) {
      allCb.checked = false;
      allCb.indeterminate = false;
    } else {
      const ids = filtered.map((l) => Number(l.id));
      const selCount = ids.filter((id) => logisticsState.selectedIds.has(id)).length;
      allCb.checked = selCount === ids.length;
      allCb.indeterminate = selCount > 0 && selCount < ids.length;
    }
  }
  const btn = document.getElementById('logBatchDeleteBtn');
  if (btn) {
    const n = logisticsState.selectedIds.size;
    btn.disabled = n === 0;
    btn.textContent = n > 0 ? `一键删除（已选 ${n} 条）` : '一键删除';
  }
}

async function deleteSelectedLogistics() {
  const ids = Array.from(logisticsState.selectedIds).filter(Number.isFinite);
  if (!ids.length) {
    showToast('请先勾选要删除的记录', 'warning');
    return;
  }
  if (!confirm(`确定删除选中的 ${ids.length} 条物流记录？`)) return;
  if (!confirm('再次确认：删除后不可恢复，是否继续？')) return;
  try {
    for (const id of ids) {
      await api('DELETE', `/logistics/${id}`);
    }
    logisticsState.selectedIds = new Set();
    showToast(`已删除 ${ids.length} 条记录`, 'success');
    await loadLogistics();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
    await loadLogistics();
  }
}

function filterLogistics() {
  loadLogistics();
}

function isMergedFlag(v) {
  return v === true || v === 1 || String(v) === '1';
}

/** 列表列：关联场次项目编号（activity JOIN 或物流冗余字段） */
function listActivityProjectHtml(r) {
  const pc =
    (r.activity_project_code != null && String(r.activity_project_code).trim()) ||
    (r.related_project_code != null && String(r.related_project_code).trim()) ||
    (r.project_code != null && String(r.project_code).trim()) ||
    '';
  if (!pc) return '<span style="color:var(--text-muted)">—</span>';
  return `<span class="project-code" style="font-size:12px">${escapeHtml(pc)}</span>`;
}

function listAllocationNoteHtml(note) {
  const t = String(note || '').trim();
  if (!t) return '<span style="color:var(--text-muted)">—</span>';
  const full = escapeHtml(t);
  const max = 28;
  const short = t.length > max ? `${escapeHtml(t.slice(0, max))}…` : full;
  return `<span style="font-size:12px;max-width:200px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle" title="${full}">${short}</span>`;
}

/** 列表/弹窗展示用：关联项目编号（兼容接口字段） */
function formatLogisticsRelatedProject(l) {
  const a =
    l.related_project_code != null && String(l.related_project_code).trim() !== ''
      ? String(l.related_project_code).trim()
      : l.project_code != null && String(l.project_code).trim() !== ''
        ? String(l.project_code).trim()
        : '';
  if (!a) return '—';
  return escapeHtml(a);
}

// 物流：关联项目编号索引（当前年度活动 project_code → activity.id）
const logisticsProjectIndex = {
  codes: new Set(),
  codeToId: new Map(),
};

async function ensureActivityProjectIndex() {
  let qs = '?sortBy=date&sortOrder=DESC&isVirtual=0';
  if (currentYearFrameId) qs += `&yearFrameId=${currentYearFrameId}`;
  const acts = await api('GET', `/activities${qs}`);
  const codes = (acts || [])
    .map((x) => ({ id: Number(x.id), code: (x.project_code || '').replace(/^\uFEFF/, '').trim() }))
    .filter((x) => x.code);
  logisticsProjectIndex.codes = new Set(codes.map((x) => x.code));
  logisticsProjectIndex.codeToId = new Map(codes.map((x) => [x.code, x.id]).filter(([, id]) => Number.isFinite(id)));
  return [...new Set(codes.map((x) => x.code))].sort();
}

/** 打开物流弹窗时填充「关联项目编号」下拉建议（当前年度活动 project_code） */
async function loadLogProjectDatalist() {
  const dl = document.getElementById('logProjectList');
  const warDl = document.getElementById('warProjectList');
  if (!dl && !warDl) return;
  try {
    const uniqSorted = await ensureActivityProjectIndex();
    const opts = uniqSorted.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
    if (dl) dl.innerHTML = opts;
    if (warDl) warDl.innerHTML = opts;
  } catch (_) {
    if (dl) dl.innerHTML = '';
    if (warDl) warDl.innerHTML = '';
    logisticsProjectIndex.codes = new Set();
    logisticsProjectIndex.codeToId = new Map();
  }
}

async function showLogisticsModal(id = null) {
  document.getElementById('logModalTitle').textContent = id ? '编辑物流记录' : '新建物流记录';
  document.getElementById('logId').value = id || '';
  ['logCompany', 'logExpress', 'logTrack', 'logSettlementYear', 'logSettlementMonth', 'logBrand', 'logOrigin', 'logDest', 'logDate', 'logFee', 'logProject', 'logAllocationNote', 'logRemarks'].forEach((f) => {
    const el = document.getElementById(f);
    if (el) el.value = '';
  });
  initLogisticsSettlementMonthSelect();
  const logSpecialCarCb = document.getElementById('logSpecialCar');
  const logMonthlySettlementCb = document.getElementById('logMonthlySettlement');
  if (logSpecialCarCb) logSpecialCarCb.checked = false;
  if (logMonthlySettlementCb) logMonthlySettlementCb.checked = false;
  const logMergedCb = document.getElementById('logMergedIntoActivity');
  if (logMergedCb) logMergedCb.checked = false;
  document.getElementById('logCompany').value = '东区仓库（叶老板）';
  document.getElementById('logExpress').value = '顺丰';
  document.getElementById('logBrand').value = 'PHD';
  toggleLogSpecialCar();

  await loadLogProjectDatalist();

  const nid = id != null && id !== '' ? Number(id) : NaN;
  if (Number.isFinite(nid)) {
    let item = null;
    try {
      item = await api('GET', `/logistics/${nid}`);
    } catch (e) {
      item = logisticsState.data.find((l) => Number(l.id) === nid) || null;
    }
    if (item) {
      const logisticsCompanies = ['东区仓库（叶老板）', '南区仓库（天空）', '北区仓库（叶老板）'];
      const expressCompanies = ['顺丰', '京东', '中通', '圆通', '其他'];
      const rawLogistics = item.logistics_company || '';
      const rawExpress = item.express_company || '';
      document.getElementById('logCompany').value = logisticsCompanies.includes(rawLogistics) ? rawLogistics : '东区仓库（叶老板）';
      document.getElementById('logExpress').value =
        expressCompanies.includes(rawExpress)
          ? rawExpress
          : (expressCompanies.includes(rawLogistics) ? rawLogistics : '顺丰');
      document.getElementById('logTrack').value = item.tracking_number || '';
      document.getElementById('logBrand').value = ['PHD', 'X.O', 'CLUB', 'REMY'].includes(item.brand) ? item.brand : 'PHD';
      const settlement = parseSettlementMonthValue(item.settlement_month);
      document.getElementById('logSettlementYear').value = settlement.year;
      document.getElementById('logSettlementMonth').value = settlement.month;
      if (logSpecialCarCb) {
        const special = item.special_car === true || item.special_car === 1 || String(item.special_car) === '1';
        logSpecialCarCb.checked = special;
      }
      if (logMonthlySettlementCb) {
        const monthly = isTruthyFlag(item.monthly_settlement) || !!String(item.settlement_month || '').trim();
        logMonthlySettlementCb.checked = monthly;
      }
      toggleLogSpecialCar();
      document.getElementById('logOrigin').value = item.origin_city || '';
      document.getElementById('logDest').value = item.destination_city || '';
      if (item.shipping_date) document.getElementById('logDate').value = toDateInputValue(item.shipping_date);
      document.getElementById('logFee').value =
        item.fee != null && item.fee !== '' ? roundMoney2(item.fee).toFixed(2) : '';
      const rpc =
        item.related_project_code != null && String(item.related_project_code).trim() !== ''
          ? String(item.related_project_code).trim()
          : item.project_code != null && String(item.project_code).trim() !== ''
            ? String(item.project_code).trim()
            : '';
      document.getElementById('logProject').value = rpc;
      if (logMergedCb) {
        const merged = item.merged_into_activity === true || item.merged_into_activity === 1 || String(item.merged_into_activity) === '1';
        logMergedCb.checked = merged;
      }
      document.getElementById('logAllocationNote').value = item.allocation_note || '';
      document.getElementById('logRemarks').value = item.remarks || '';
    }
  }
  openModal('modalLogistics');
}

function toggleLogSpecialCar() {
  const cb = document.getElementById('logSpecialCar');
  const monthlyCb = document.getElementById('logMonthlySettlement');
  const track = document.getElementById('logTrack');
  const express = document.getElementById('logExpress');
  const settlementYear = document.getElementById('logSettlementYear');
  const settlementMonth = document.getElementById('logSettlementMonth');
  if (!cb || !monthlyCb || !track || !express || !settlementYear || !settlementMonth) return;
  const special = !!cb.checked;
  const monthly = !!monthlyCb.checked;
  if (monthly) {
    cb.checked = false;
    track.value = '';
    track.disabled = true;
    express.disabled = true;
    cb.disabled = true;
    settlementYear.disabled = false;
    settlementMonth.disabled = false;
    track.placeholder = '月结无需专车和单号';
    return;
  }
  cb.disabled = false;
  settlementYear.value = '';
  settlementYear.disabled = true;
  settlementMonth.value = '';
  settlementMonth.disabled = true;
  if (special) {
    track.value = '';
    track.disabled = true;
    express.disabled = true;
    track.placeholder = '专车无需单号';
  } else {
    track.disabled = false;
    express.disabled = false;
    track.placeholder = '顺丰单号可后续补填';
  }
}

async function saveLogistics() {
  const id = document.getElementById('logId').value;
  const rpcRaw = (document.getElementById('logProject')?.value || '').replace(/^\uFEFF/, '').trim();
  if (rpcRaw) {
    // 强制：必须来自活动项目编号，防止手误输入
    if (!logisticsProjectIndex.codes.has(rpcRaw)) {
      showToast('关联项目编号必须从活动项目编号中选择（请从下拉建议中选中）', 'error');
      return;
    }
  }
  const mergedIntoActivity = !!document.getElementById('logMergedIntoActivity')?.checked;
  if (mergedIntoActivity && !rpcRaw) {
    showToast('勾选计入活动成本时，必须选择关联项目编号', 'error');
    return;
  }
  const activityId = rpcRaw ? logisticsProjectIndex.codeToId.get(rpcRaw) : null;
  if (mergedIntoActivity && !activityId) {
    showToast('关联项目编号无效，请从下拉建议中选择', 'error');
    return;
  }
  const isSpecialCar = !!document.getElementById('logSpecialCar')?.checked;
  const isMonthlySettlement = !!document.getElementById('logMonthlySettlement')?.checked;
  const settlementYear = document.getElementById('logSettlementYear')?.value || '';
  const settlementMonth = document.getElementById('logSettlementMonth')?.value || '';
  const hasSettlementInput = !!(settlementYear && settlementMonth);
  const monthlySettlementFinal = isMonthlySettlement || hasSettlementInput;
  const logisticsCompany = document.getElementById('logCompany').value;
  const logisticsBrand = document.getElementById('logBrand').value;
  const expressCompany = document.getElementById('logExpress').value;
  const trackingNumber = document.getElementById('logTrack').value;
  if (isMonthlySettlement && !hasSettlementInput) {
    showToast('勾选月结后请填写月份', 'error');
    return;
  }
  // 顺丰单号允许后补：先创建记录，后续再到物流模块补录
  const body = {
    year_frame_id: currentYearFrameId || 1,
    logistics_company: logisticsCompany,
    brand: logisticsBrand,
    express_company: (isSpecialCar || monthlySettlementFinal) ? null : expressCompany,
    tracking_number: (isSpecialCar || monthlySettlementFinal) ? null : trackingNumber,
    special_car: monthlySettlementFinal ? 0 : (isSpecialCar ? 1 : 0),
    monthly_settlement: monthlySettlementFinal ? 1 : 0,
    settlement_month: monthlySettlementFinal ? `${settlementYear}-${settlementMonth}` : null,
    origin_city: document.getElementById('logOrigin').value,
    destination_city: document.getElementById('logDest').value,
    shipping_date: document.getElementById('logDate').value || null,
    fee: roundMoney2(document.getElementById('logFee').value),
    related_project_code: rpcRaw || null,
    activity_id: activityId || null,
    merged_into_activity: mergedIntoActivity ? 1 : 0,
    allocation_note: document.getElementById('logAllocationNote')?.value?.trim() || null,
    remarks: document.getElementById('logRemarks').value,
  };
  try {
    if (id) {
      await api('PUT', `/logistics/${id}`, body);
      showToast('已更新', 'success');
    } else {
      await api('POST', '/logistics', body);
      showToast('已创建', 'success');
    }
    closeModal();
    loadLogistics();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

async function deleteLogistics(id) {
  if (!confirm('确认删除此物流记录？')) return;
  try {
    await api('DELETE', `/logistics/${id}`);
    showToast('已删除', 'success');
    loadLogistics();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

/* =============================================
   页面：仓储成本（原仓储记录）
   ============================================= */
async function renderWarehouse() {
  const container = document.getElementById('pageContainer');

  container.innerHTML = `
    <div class="toolbar" style="justify-content:space-between">
      <div class="toolbar-left">
        <select class="filter-select" id="warMergeFilter" onchange="setWarehouseMergeFilter(this.value)">
          <option value="all">计入：全部</option>
          <option value="unmerged">计入：未计入</option>
          <option value="merged">计入：已计入</option>
        </select>
      </div>
      <div class="toolbar-right" style="display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-danger btn-sm" id="warBatchDeleteBtn" disabled onclick="deleteSelectedWarehouse()">一键删除</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="showWarehouseModal()">+ 新建仓储</button>
      </div>
    </div>
    <div id="warSummary"></div>
    <div id="warTable"></div>
  `;

  await loadWarehouse();
  const mf = document.getElementById('warMergeFilter');
  if (mf) mf.value = warehouseMergeFilter;
}

const WAREHOUSE_REGION_OPTIONS = ['东区', '北区', '南区'];
const WAREHOUSE_BRAND_OPTIONS = ['PHD', 'X.O', 'CLUB', 'REMY'];
const WAREHOUSE_TRAD_TO_SIMP = { '東區': '东区', '北區': '北区', '南區': '南区' };

/** 与后端一致：去 BOM、NFKC、繁体「東區」等映射为简体选项值 */
function normalizeWarehouseRegion(v) {
  if (v == null || v === '') return '';
  let s = (typeof v === 'string' ? v : String(v)).replace(/^\uFEFF/, '').trim().normalize('NFKC');
  if (WAREHOUSE_TRAD_TO_SIMP[s]) s = WAREHOUSE_TRAD_TO_SIMP[s];
  return s;
}

/** 从下拉框读取区域（按选中项 value，避免部分浏览器只显示文字未改 value） */
function readWarRegionSelect() {
  const sel = document.getElementById('warRegion');
  if (!sel || sel.selectedIndex < 0) return '';
  const raw = sel.options[sel.selectedIndex].value;
  return normalizeWarehouseRegion(raw);
}

function readWarBrandSelect() {
  const sel = document.getElementById('warBrand');
  if (!sel || sel.selectedIndex < 0) return '';
  const v = String(sel.options[sel.selectedIndex].value || '').trim();
  return WAREHOUSE_BRAND_OPTIONS.includes(v) ? v : '';
}

async function loadWarehouse() {
  try {
    let qs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : '?';

    const data = await api('GET', `/warehouse${qs}`);
    warehouseState.data = data;
    const filteredData = (warehouseMergeFilter === 'merged')
      ? data.filter((w) => isMergedFlag(w.merged_into_activity))
      : (warehouseMergeFilter === 'unmerged')
        ? data.filter((w) => !isMergedFlag(w.merged_into_activity))
        : data;
    const idSetOnPage = new Set(filteredData.map((w) => Number(w.id)));
    const nextSel = new Set();
    warehouseState.selectedIds.forEach((id) => {
      if (idSetOnPage.has(id)) nextSel.add(id);
    });
    warehouseState.selectedIds = nextSel;

    const sumEl = document.getElementById('warSummary');
    if (sumEl) {
      const REGION_META = [
        { key: '东区', label: '东区（上海）', tone: 'accent' },
        { key: '北区', label: '北区（天津）', tone: 'blue' },
        { key: '南区', label: '南区（广州）', tone: 'warning' },
      ];

      const TAX_RATE = 0.06; // 报价含税 6%
      const taxDiv = 1 + TAX_RATE;
      const totalQuotedAll = filteredData.reduce((s, w) => s + (parseFloat(w.quoted_price) || 0), 0);
      const totalCostAll = filteredData.reduce((s, w) => s + (parseFloat(w.actual_cost) || 0), 0);
      const rowsByRegion = new Map(REGION_META.map((r) => [r.key, []]));
      filteredData.forEach((w) => {
        const r = normalizeWarehouseRegion(w.region);
        if (rowsByRegion.has(r)) rowsByRegion.get(r).push(w);
      });

      const calc = (rows) => {
        const quoted = rows.reduce((s, w) => s + (parseFloat(w.quoted_price) || 0), 0);
        const cost = rows.reduce((s, w) => s + (parseFloat(w.actual_cost) || 0), 0);
        const profit = quoted / taxDiv - cost;
        return { quoted, cost, profit };
      };

      sumEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(2,minmax(200px,1fr));gap:16px;margin-bottom:16px">
          <div class="stat-card success">
            <div class="stat-icon"><i data-lucide="receipt" style="width:16px;height:16px"></i></div>
            <div class="stat-label">仓储总报价（含税）</div>
            <div class="stat-value" style="margin-top:8px;font-variant-numeric:tabular-nums">${fmtMoney(totalQuotedAll)}</div>
            <div class="stat-sub">当前年框下列表全部记录合计</div>
          </div>
          <div class="stat-card warning">
            <div class="stat-icon"><i data-lucide="coins" style="width:16px;height:16px"></i></div>
            <div class="stat-label">仓储总成本</div>
            <div class="stat-value" style="margin-top:8px;font-variant-numeric:tabular-nums">${fmtMoney(totalCostAll)}</div>
            <div class="stat-sub">实际成本字段合计</div>
          </div>
        </div>
        <div class="stats-grid three" style="margin-bottom:16px">
          ${REGION_META.map((r) => {
            const rows = rowsByRegion.get(r.key) || [];
            const { quoted, cost, profit } = calc(rows);
            return `
              <div class="stat-card ${r.tone}">
                <div class="stat-icon"><i data-lucide="warehouse" style="width:16px;height:16px"></i></div>
                <div class="stat-label">${r.label}</div>
                <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
                  <div style="display:flex;justify-content:space-between;gap:10px">
                    <span style="font-size:12px;color:var(--text-secondary)">报价（含税）</span>
                    <span class="amount amount-revenue" style="font-weight:700">${fmtMoney(quoted)}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;gap:10px">
                    <span style="font-size:12px;color:var(--text-secondary)">成本</span>
                    <span class="amount ${cost > 0 ? 'amount-cost' : 'amount-neutral'}" style="font-weight:700">${fmtMoney(cost)}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;gap:10px">
                    <span style="font-size:12px;color:var(--text-secondary)">利润（不含税）</span>
                    <span class="amount ${profit >= 0 ? 'amount-revenue' : 'amount-cost'}" style="font-weight:800">${fmtMoney(profit)}</span>
                  </div>
                </div>
                <div class="stat-sub">利润 = 报价 ÷ 1.06 − 成本</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const tableEl = document.getElementById('warTable');
    if (tableEl) {
      tableEl.innerHTML = `
        <div class="table-wrapper">
          <table>
            <thead><tr>
              <th style="width:44px;text-align:center" title="多选">
                <input type="checkbox" id="warSelectAll" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)" onchange="toggleWarehouseSelectAll(this.checked)" aria-label="全选当前列表">
              </th>
              <th>年份</th>
              <th>品牌</th>
              <th>区域</th>
              <th>数量<br><span style="font-size:10px;font-weight:500;color:var(--text-muted);text-transform:none;letter-spacing:0">（月）</span></th>
              <th>单价</th>
              <th>报价<br><span style="font-size:10px;font-weight:500;color:var(--text-muted);text-transform:none;letter-spacing:0">（数量×单价）</span></th>
              <th>实际成本</th>
              <th>备注</th>
              <th>关联项目</th>
              <th>计入说明</th>
              <th>计入状态</th>
              <th>操作</th>
            </tr></thead>
            <tbody>
              ${filteredData.length ? filteredData.map(w => {
                const qty = parseFloat(w.quantity);
                const qtySafe = Number.isFinite(qty) ? qty : 0;
                const upNum = parseFloat(w.unit_price);
                const hasUnitPrice = w.unit_price != null && w.unit_price !== '' && Number.isFinite(upNum);
                const quoteSub = hasUnitPrice
                  ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${qtySafe}月×${fmtMoney(upNum)}</div>`
                  : '';
                const wid = Number(w.id);
                const isSel = warehouseState.selectedIds.has(wid);
                return `
                <tr>
                  <td style="text-align:center;vertical-align:middle">
                    <input type="checkbox" class="war-row-cb" data-war-id="${wid}" ${isSel ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)" onchange="toggleWarehouseRowSelect(${wid}, this.checked)" aria-label="选择该条仓储记录">
                  </td>
                  <td><span class="badge badge-gray" style="font-weight:600">${w.year_frame_name != null && String(w.year_frame_name).trim() !== '' ? escapeHtml(String(w.year_frame_name)) : '—'}</span></td>
                  <td><span class="badge badge-gray">${escapeHtml((w.brand != null && String(w.brand).trim() !== '' ? String(w.brand).trim() : 'PHD'))}</span></td>
                  <td><span class="badge badge-accent">${(() => { const r = normalizeWarehouseRegion(w.region); return r ? escapeHtml(r) : '—'; })()}</span></td>
                  <td>${qtySafe}<span style="font-size:11px;color:var(--text-muted);margin-left:3px">月</span></td>
                  <td>${hasUnitPrice ? fmtMoney(upNum) : '—'}</td>
                  <td class="amount amount-revenue" style="vertical-align:top">
                    <div>${fmtMoney(w.quoted_price)}</div>
                    ${quoteSub}
                  </td>
                  <td class="amount ${w.no_actual_cost ? 'amount-neutral' : (parseFloat(w.actual_cost)>0?'amount-cost':'amount-neutral')}">${w.no_actual_cost ? '无' : (parseFloat(w.actual_cost)>0?fmtMoney(w.actual_cost):'—')}</td>
                  <td style="font-size:12px;color:var(--text-muted)">${escapeHtml(w.remarks||'')}</td>
                  <td>${listActivityProjectHtml(w)}</td>
                  <td>${listAllocationNoteHtml(w.allocation_note)}</td>
                  <td>${isMergedFlag(w.merged_into_activity) ? '<span class="badge badge-success">已计入</span>' : '<span class="badge badge-gray">未计入</span>'}</td>
                  <td>
                    <div style="display:flex;gap:4px">
                      <button class="btn btn-secondary btn-sm" onclick="showWarehouseModal(${w.id})">编辑</button>
                      <button class="btn btn-danger btn-sm" onclick="deleteWarehouse(${w.id})">删</button>
                    </div>
                  </td>
                </tr>
              `;
              }).join('') : '<tr><td colspan="13" style="text-align:center;color:var(--text-muted);padding:30px">暂无数据</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
      updateWarehouseSelectUi();
    }
    void updateBadges();
    renderLucideIcons();
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

function toggleWarehouseRowSelect(id, checked) {
  const n = Number(id);
  if (!Number.isFinite(n)) return;
  if (checked) warehouseState.selectedIds.add(n);
  else warehouseState.selectedIds.delete(n);
  updateWarehouseSelectUi();
}

function toggleWarehouseSelectAll(checked) {
  const ids = (warehouseState.data || []).map((w) => Number(w.id)).filter(Number.isFinite);
  if (checked) ids.forEach((id) => warehouseState.selectedIds.add(id));
  else ids.forEach((id) => warehouseState.selectedIds.delete(id));
  document.querySelectorAll('.war-row-cb').forEach((cb) => {
    const id = Number(cb.getAttribute('data-war-id'));
    cb.checked = warehouseState.selectedIds.has(id);
  });
  updateWarehouseSelectUi();
}

function updateWarehouseSelectUi() {
  const allCb = document.getElementById('warSelectAll');
  const data = warehouseState.data || [];
  if (allCb) {
    if (!data.length) {
      allCb.checked = false;
      allCb.indeterminate = false;
    } else {
      const ids = data.map((w) => Number(w.id));
      const selCount = ids.filter((id) => warehouseState.selectedIds.has(id)).length;
      allCb.checked = selCount === ids.length;
      allCb.indeterminate = selCount > 0 && selCount < ids.length;
    }
  }
  const btn = document.getElementById('warBatchDeleteBtn');
  if (btn) {
    const n = warehouseState.selectedIds.size;
    btn.disabled = n === 0;
    btn.textContent = n > 0 ? `一键删除（已选 ${n} 条）` : '一键删除';
  }
}

function setWarehouseMergeFilter(v) {
  warehouseMergeFilter = v || 'all';
  loadWarehouse();
}

async function deleteSelectedWarehouse() {
  const ids = Array.from(warehouseState.selectedIds).filter(Number.isFinite);
  if (!ids.length) {
    showToast('请先勾选要删除的记录', 'warning');
    return;
  }
  if (!confirm(`确定删除选中的 ${ids.length} 条仓储记录？`)) return;
  if (!confirm('再次确认：删除后不可恢复，是否继续？')) return;
  try {
    for (const id of ids) {
      await api('DELETE', `/warehouse/${id}`);
    }
    warehouseState.selectedIds = new Set();
    showToast(`已删除 ${ids.length} 条记录`, 'success');
    await loadWarehouse();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
    await loadWarehouse();
  }
}

function updateWarQuotedPrice() {
  const elQ = document.getElementById('warQty');
  const elU = document.getElementById('warUnitPrice');
  const elP = document.getElementById('warQuotedPrice');
  if (!elQ || !elU || !elP) return;
  const qn = Math.max(0, parseInt(elQ.value, 10) || 0);
  const un = Math.max(0, roundMoney2(elU.value));
  const total = roundMoney2(qn * un);
  elP.value = total.toFixed(2);
}

function toggleWarNoActualCost() {
  const cb = document.getElementById('warNoActualCost');
  const input = document.getElementById('warActualCost');
  if (!cb || !input) return;
  const checked = !!cb.checked;
  input.disabled = checked;
  input.placeholder = checked ? '无成本' : '0.00';
  if (checked) input.value = '';
}

async function fillWarehouseYearFrameSelect(preferredFrameId) {
  const sel = document.getElementById('warYearFrameId');
  if (!sel) return;
  const frames = await api('GET', '/year-frames');
  sel.innerHTML = frames.map(f => {
    const label = [f.year, f.name].filter(Boolean).join(' · ');
    return `<option value="${f.id}">${escapeHtml(label || String(f.id))}</option>`;
  }).join('');
  const want = preferredFrameId || currentYearFrameId;
  if (want && frames.some(f => String(f.id) === String(want))) {
    sel.value = String(want);
  } else if (frames[0]) {
    sel.value = String(frames[0].id);
  }
}

async function showWarehouseModal(id = null) {
  const wid = id != null && id !== '' ? Number(id) : NaN;
  const editing = Number.isFinite(wid);

  document.getElementById('warModalTitle').textContent = editing ? '编辑仓储记录' : '新建仓储记录';
  document.getElementById('warId').value = editing ? String(wid) : '';
  ['warQty', 'warUnitPrice', 'warQuotedPrice', 'warActualCost', 'warRemarks', 'warProject', 'warAllocationNote'].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.value = '';
  });
  const reg = document.getElementById('warRegion');
  if (reg) reg.value = '';
  const brandEl = document.getElementById('warBrand');
  if (brandEl) brandEl.value = 'PHD';
  const noCostCb = document.getElementById('warNoActualCost');
  const warMergedCb = document.getElementById('warMergedIntoActivity');
  if (noCostCb) noCostCb.checked = false;
  if (warMergedCb) warMergedCb.checked = false;
  toggleWarNoActualCost();
  await loadLogProjectDatalist();

  let preferredYf = currentYearFrameId;
  let item = null;
  if (editing) {
    try {
      item = await api('GET', `/warehouse/${wid}`);
    } catch (e) {
      item = warehouseState.data.find(w => Number(w.id) === wid) || null;
      if (!item) {
        showToast('加载记录失败: ' + (e.message || ''), 'error');
      }
    }
  }

  if (item) {
    preferredYf = item.year_frame_id;
    const b = item.brand != null && String(item.brand).trim() !== '' ? String(item.brand).trim() : 'PHD';
    if (brandEl) brandEl.value = WAREHOUSE_BRAND_OPTIONS.includes(b) ? b : 'PHD';
    const rSel = normalizeWarehouseRegion(item.region);
    if (reg) reg.value = WAREHOUSE_REGION_OPTIONS.includes(rSel) ? rSel : '';
    document.getElementById('warQty').value = item.quantity != null && item.quantity !== '' ? item.quantity : '';
    document.getElementById('warUnitPrice').value =
      item.unit_price != null && item.unit_price !== '' ? roundMoney2(item.unit_price).toFixed(2) : '';
    document.getElementById('warQuotedPrice').value =
      item.quoted_price != null && item.quoted_price !== '' ? roundMoney2(item.quoted_price).toFixed(2) : '';
    document.getElementById('warActualCost').value =
      item.actual_cost != null && item.actual_cost !== '' ? roundMoney2(item.actual_cost).toFixed(2) : '';
    const noActual = item.no_actual_cost === true || item.no_actual_cost === 1 || String(item.no_actual_cost) === '1';
    if (noCostCb) noCostCb.checked = noActual;
    if (noActual) document.getElementById('warActualCost').value = '';
    toggleWarNoActualCost();
    document.getElementById('warRemarks').value = item.remarks || '';
    if (warMergedCb) {
      const merged = item.merged_into_activity === true || item.merged_into_activity === 1 || String(item.merged_into_activity) === '1';
      warMergedCb.checked = merged;
    }
    document.getElementById('warAllocationNote').value = item.allocation_note || '';
    const rpc = item.related_project_code != null && String(item.related_project_code).trim() !== ''
      ? String(item.related_project_code).trim()
      : item.project_code != null && String(item.project_code).trim() !== ''
        ? String(item.project_code).trim()
        : '';
    const warProjectEl = document.getElementById('warProject');
    if (warProjectEl) warProjectEl.value = rpc;
  }

  try {
    await fillWarehouseYearFrameSelect(preferredYf);
  } catch (e) {
    showToast('加载年框失败: ' + (e.message || ''), 'error');
  }
  if (item) {
    const rSel = normalizeWarehouseRegion(item.region);
    if (reg) reg.value = WAREHOUSE_REGION_OPTIONS.includes(rSel) ? rSel : '';
  }
  updateWarQuotedPrice();
  openModal('modalWarehouse');
}

async function saveWarehouse() {
  const id = document.getElementById('warId').value;
  const yearFrameId = parseInt(document.getElementById('warYearFrameId').value, 10);
  const region = readWarRegionSelect();
  const brand = readWarBrandSelect();
  if (!yearFrameId) {
    showToast('请选择年份', 'error');
    return;
  }
  if (!brand) {
    showToast('请选择品牌：PHD / X.O / CLUB / REMY', 'error');
    return;
  }
  if (!region || !WAREHOUSE_REGION_OPTIONS.includes(region)) {
    showToast('请选择区域：东区 / 北区 / 南区', 'error');
    return;
  }
  updateWarQuotedPrice();
  const qty = parseInt(document.getElementById('warQty').value, 10) || 0;
  const unitPrice = roundMoney2(document.getElementById('warUnitPrice').value);
  if (qty <= 0) {
    showToast('数量（月）须大于 0', 'error');
    return;
  }
  if (unitPrice <= 0) {
    showToast('单价须大于 0', 'error');
    return;
  }
  const warProjectRaw = (document.getElementById('warProject')?.value || '').replace(/^\uFEFF/, '').trim();
  if (warProjectRaw && !logisticsProjectIndex.codes.has(warProjectRaw)) {
    showToast('关联项目编号必须从活动项目编号中选择（请从下拉建议中选中）', 'error');
    return;
  }
  const mergedIntoActivity = !!document.getElementById('warMergedIntoActivity')?.checked;
  if (mergedIntoActivity && !warProjectRaw) {
    showToast('勾选计入活动成本时，必须选择关联项目编号', 'error');
    return;
  }
  const activityId = warProjectRaw ? logisticsProjectIndex.codeToId.get(warProjectRaw) : null;
  if (mergedIntoActivity && !activityId) {
    showToast('关联项目编号无效，请从下拉建议中选择', 'error');
    return;
  }
  const body = {
    year_frame_id: yearFrameId,
    month: null,
    brand,
    region,
    wine_name: '',
    specifications: '',
    quantity: qty,
    unit_price: unitPrice,
    quoted_price: roundMoney2(document.getElementById('warQuotedPrice').value),
    actual_cost: document.getElementById('warNoActualCost')?.checked ? 0 : roundMoney2(document.getElementById('warActualCost').value),
    no_actual_cost: document.getElementById('warNoActualCost')?.checked ? 1 : 0,
    activity_id: activityId || null,
    merged_into_activity: mergedIntoActivity ? 1 : 0,
    allocation_note: document.getElementById('warAllocationNote')?.value?.trim() || null,
    remarks: document.getElementById('warRemarks').value,
  };
  try {
    if (id) {
      await api('PUT', `/warehouse/${id}`, body);
      showToast('已更新', 'success');
    } else {
      await api('POST', '/warehouse', body);
      showToast('已创建', 'success');
    }
    closeModal();
    await loadWarehouse();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

async function deleteWarehouse(id) {
  if (!confirm('确认删除此仓储记录？')) return;
  try {
    await api('DELETE', `/warehouse/${id}`);
    showToast('已删除', 'success');
    await loadWarehouse();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

/* =============================================
   页面：数据备份
   ============================================= */
async function renderBackup() {
  const container = document.getElementById('pageContainer');
  container.innerHTML = `
    <div class="card" style="max-width:600px;margin:0 auto">
      <div class="card-header">
        <div class="card-title"><i data-lucide="database-backup" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>数据备份与导出</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div style="padding:16px;background:var(--bg-input);border-radius:var(--radius-sm)">
          <div style="font-weight:600;margin-bottom:6px">导出当前数据</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">导出所有活动、物流、仓储、报销数据为 JSON 格式</div>
          <button class="btn btn-primary" onclick="exportData()"><i data-lucide="download" style="width:14px;height:14px"></i>导出 JSON 备份</button>
        </div>

        <div style="padding:16px;background:var(--bg-input);border-radius:var(--radius-sm)">
          <div style="font-weight:600;margin-bottom:6px">全局数据备份（推荐）</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">备份全库所有表 + 上传图片目录（inventory、wine-catalog），写入服务器 backups 目录，并尝试打包为 tar.gz。</div>
          <button class="btn btn-primary" onclick="fullExportData()"><i data-lucide="shield-check" style="width:14px;height:14px"></i>执行全局备份</button>
          <div id="fullBackupResult" style="margin-top:10px;font-size:12px;color:var(--text-secondary)"></div>
        </div>

        <div style="padding:16px;background:var(--bg-input);border-radius:var(--radius-sm)">
          <div style="font-weight:600;margin-bottom:6px">服务器状态</div>
          <div id="serverStatus" style="font-size:13px;color:var(--text-secondary)">检查中...</div>
        </div>
      </div>
    </div>
  `;

  try {
    const health = await api('GET', '/health');
    document.getElementById('serverStatus').innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;color:var(--success)">
        <span class="status-dot"></span>
        <span>MySQL 已连接，API 服务正常（${window.location.host}）</span>
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">上次检查: ${new Date().toLocaleTimeString()}</div>
    `;
  } catch (err) {
    document.getElementById('serverStatus').innerHTML = `<span style="color:var(--danger)"><i data-lucide="triangle-alert" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px"></i>服务异常: ${err.message}</span>`;
    renderLucideIcons();
  }
}

async function exportData() {
  try {
    const qs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : '';
    let qsReal = '?isVirtual=0';
    let qsVirt = '?isVirtual=1';
    if (currentYearFrameId) {
      qsReal += `&yearFrameId=${currentYearFrameId}`;
      qsVirt += `&yearFrameId=${currentYearFrameId}`;
    }
    const [activitiesReal, activitiesVirtual, logistics, warehouse, reimbursements] = await Promise.all([
      api('GET', `/activities${qsReal}`),
      api('GET', `/activities${qsVirt}`),
      api('GET', `/logistics${qs}`),
      api('GET', `/warehouse${qs}`),
      api('GET', `/reimbursements${qs}`),
    ]);
    const activities = [...(activitiesReal || []), ...(activitiesVirtual || [])];
    const data = { exportTime: new Date().toISOString(), year: currentYear, activities, logistics, warehouse, reimbursements };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `remy-backup-${currentYear}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('备份导出成功', 'success');
  } catch (err) {
    showToast('导出失败: ' + err.message, 'error');
  }
}

async function fullExportData() {
  const host = document.getElementById('fullBackupResult');
  if (host) host.textContent = '全局备份执行中，请稍候...';
  try {
    const ret = await api('POST', '/backup/full-export', {});
    const archive = ret.archivePath ? `压缩包：${ret.archivePath}` : '压缩包：未生成（目录备份仍可用）';
    if (host) {
      host.innerHTML = `
        <div style="color:var(--success)">备份完成：${escapeHtml(String(ret.totalRows || 0))} 行 / ${escapeHtml(String(ret.tableCount || 0))} 张表</div>
        <div>目录：<code>${escapeHtml(ret.backupDir || '')}</code></div>
        <div>${escapeHtml(archive)}</div>
      `;
    }
    showToast('全局备份完成', 'success');
  } catch (err) {
    if (host) host.innerHTML = `<span style="color:var(--danger)">执行失败：${escapeHtml(err.message || '')}</span>`;
    showToast('全局备份失败: ' + err.message, 'error');
  }
}

function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

async function renderUsers() {
  const container = document.getElementById('pageContainer');
  if (!container) return;
  if (!canManageUsers()) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">无权限</div><div class="empty-sub">仅管理员可访问用户管理</div></div>`;
    return;
  }
  container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">加载中...</div>';
  try {
    const rows = await api('GET', '/users');
    const meId = Number(currentUser?.id || 0);
    const html = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">用户管理</div>
          <div class="card-sub">注册用户默认 operator；管理员可提升/降级与启停用</div>
        </div>
        <div class="card-body">
          <div class="table-wrapper"><table>
            <thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
            <tbody>
              ${(rows || []).map((u) => {
                const isMe = Number(u.id) === meId;
                const roleBtn = u.role === 'admin'
                  ? `<button class="btn btn-secondary btn-sm" ${isMe ? 'disabled title="当前账号不可自降级"' : ''} onclick="setUserRole(${u.id}, 'operator')">降级为 operator</button>`
                  : `<button class="btn btn-primary btn-sm" onclick="setUserRole(${u.id}, 'admin')">提升为 admin</button>`;
                const statusBtn = Number(u.is_active) === 1
                  ? `<button class="btn btn-danger btn-sm" ${isMe ? 'disabled title="当前账号不可自停用"' : ''} onclick="setUserStatus(${u.id}, 0)">停用</button>`
                  : `<button class="btn btn-secondary btn-sm" onclick="setUserStatus(${u.id}, 1)">启用</button>`;
                const resetPwdBtn = `<button type="button" class="btn btn-secondary btn-sm" onclick="openAdminResetPasswordModal(${u.id}, ${JSON.stringify(String(u.username || ''))})">重置密码</button>`;
                return `<tr>
                  <td>${u.id}</td>
                  <td>${escapeHtml(u.username || '')}${isMe ? ' <span class="badge badge-blue">我</span>' : ''}</td>
                  <td><span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}">${u.role}</span></td>
                  <td>${Number(u.is_active) === 1 ? '<span class="badge badge-success">启用</span>' : '<span class="badge badge-gray">停用</span>'}</td>
                  <td>${fmtDateTime(u.last_login_at)}</td>
                  <td style="white-space:nowrap;display:flex;flex-wrap:wrap;gap:6px;">${roleBtn}${statusBtn}${resetPwdBtn}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>
        </div>
      </div>
    `;
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(err.message || '')}</div></div>`;
  }
}

async function setUserRole(id, role) {
  try {
    await api('PUT', `/users/${id}/role`, { role });
    showToast('角色更新成功', 'success');
    await renderUsers();
  } catch (err) {
    showToast(err.message || '角色更新失败', 'error');
  }
}

async function setUserStatus(id, is_active) {
  try {
    await api('PUT', `/users/${id}/status`, { is_active });
    showToast('状态更新成功', 'success');
    await renderUsers();
  } catch (err) {
    showToast(err.message || '状态更新失败', 'error');
  }
}

/* =============================================
   页面：物料采购（20260414 规格：固定项 + 自定义项）
   ============================================= */
/** 物料采购页四卡片：按品牌编码/名称归入 RC / PHD / X.O / CLUB（其余并入 RC） */
function materialPurchaseBrandBucket(brandCode, brandName) {
  const c = String(brandCode || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  const n = String(brandName || '').trim().toUpperCase();
  if (c === 'PHD' || c.indexOf('PHD') === 0) return 'PHD';
  if (c === 'X.O' || c === 'XO' || c.indexOf('X.O') === 0 || /^XO/.test(c)) return 'X.O';
  if (c === 'CLUB' || c.indexOf('CLUB') === 0) return 'CLUB';
  if (c.includes('RC') || n.includes('RC')) return 'RC';
  return 'RC';
}

function materialPurchaseAggFourBuckets(rowsAllYear) {
  const totals = { RC: 0, PHD: 0, 'X.O': 0, CLUB: 0 };
  const counts = { RC: 0, PHD: 0, 'X.O': 0, CLUB: 0 };
  (rowsAllYear || []).forEach((r) => {
    const k = materialPurchaseBrandBucket(r.brand_code, r.brand_name);
    const amt = roundMoney2(r.total_amount);
    totals[k] = roundMoney2(totals[k] + amt);
    counts[k] += 1;
  });
  return { totals, counts };
}

const MATERIAL_FIXED_ITEM_NAMES = [
  '奶酪',
  '巧克力',
  '糖渍橙皮丁',
  '芒果',
  '桂皮',
  '茉莉花',
  '西梅',
  '杏脯',
  '巴达木',
  '腰果',
  '九制陈皮',
  '香草荚',
];

function materialPurchaseRowHtml(r) {
  const rem = r.remarks ? String(r.remarks).slice(0, 48) + (String(r.remarks).length > 48 ? '…' : '') : '—';
  const merged = isMergedFlag(r.merged_into_activity);
  return `<tr>
    <td>${r.id}</td>
    <td>${escapeHtml(fmtDate(r.purchase_date))}</td>
    <td><span class="badge badge-${brandColor(r.brand_code || r.brand_name)}">${escapeHtml(r.brand_name || r.brand_code || '—')}</span></td>
    <td class="amount" style="text-align:right">${fmtMoney(r.total_amount)}</td>
    <td>${listActivityProjectHtml(r)}</td>
    <td>${listAllocationNoteHtml(r.allocation_note)}</td>
    <td>${merged ? '<span class="badge badge-success">已计入</span>' : '<span class="badge badge-gray">未计入</span>'}</td>
    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--text-secondary)" title="${escapeHtml(r.remarks || '')}">${escapeHtml(rem)}</td>
    <td onclick="event.stopPropagation()" style="white-space:nowrap">
      <button type="button" class="btn btn-secondary btn-sm" onclick="showMaterialPurchaseModal(${r.id})">编辑</button>
      <button type="button" class="btn btn-danger btn-sm" onclick="deleteMaterialPurchaseRecord(${r.id})">删除</button>
    </td>
  </tr>`;
}

function materialSetBrandFilter(v) {
  materialPageState.filterBrandId = v || '';
  renderMaterialPurchases();
}

function materialSetMergeFilter(v) {
  materialPageState.mergeFilter = v || 'all';
  renderMaterialPurchases();
}

async function renderMaterialPurchases() {
  const container = document.getElementById('pageContainer');
  container.innerHTML =
    '<div style="text-align:center;padding:36px;color:var(--text-muted)">加载中...</div>';
  try {
    const yf = currentYearFrameId || '';
    const qs = new URLSearchParams();
    if (yf) qs.set('yearFrameId', String(yf));
    if (materialPageState.filterBrandId) qs.set('brandId', materialPageState.filterBrandId);
    const qStr = qs.toString();
    const yfOnlyQs = new URLSearchParams();
    if (yf) yfOnlyQs.set('yearFrameId', String(yf));
    const yfOnlyStr = yfOnlyQs.toString();

    const [rows, rowsAllYear, brands] = await Promise.all([
      api('GET', `/material-purchases${qStr ? `?${qStr}` : ''}`),
      api('GET', `/material-purchases${yfOnlyStr ? `?${yfOnlyStr}` : ''}`),
      api('GET', '/brand?active=true'),
    ]);

    const brandOpts = (brands || [])
      .map(
        (b) =>
          `<option value="${b.id}" ${String(materialPageState.filterBrandId) === String(b.id) ? 'selected' : ''}>${escapeHtml(b.brand_name || b.brand_code)}</option>`
      )
      .join('');

    const { totals: bt, counts: bc } = materialPurchaseAggFourBuckets(rowsAllYear);
    const grandTotal = roundMoney2(Object.values(bt).reduce((s, v) => s + roundMoney2(v), 0));

    const bucketDefs = [
      { key: 'RC', title: 'RC', sub: 'RC 系及未归入 PHD / X.O / CLUB 的登记', icon: 'orbit', card: 'stat-card success' },
      { key: 'PHD', title: 'PHD', sub: '品牌编码 PHD*', icon: 'flask-conical', card: 'stat-card accent' },
      { key: 'X.O', title: 'X.O', sub: '品牌 X.O / XO*', icon: 'wine', card: 'stat-card warning' },
      { key: 'CLUB', title: 'CLUB', sub: '品牌 CLUB*', icon: 'sparkles', card: 'stat-card blue' },
    ];
    const bucketCardsHtml = bucketDefs
      .map(
        (d) => `
      <div class="${d.card}" style="min-height:120px">
        <div class="stat-icon"><i data-lucide="${d.icon}" style="width:16px;height:16px"></i></div>
        <div class="stat-label">${d.title}</div>
        <div class="stat-value sm">${fmtMoney(bt[d.key] || 0)}</div>
        <div class="stat-sub">${bc[d.key] || 0} 笔 · ${escapeHtml(d.sub)}</div>
      </div>`
      )
      .join('');

    const listRows = (materialPageState.mergeFilter === 'merged')
      ? (rows || []).filter((r) => isMergedFlag(r.merged_into_activity))
      : (materialPageState.mergeFilter === 'unmerged')
        ? (rows || []).filter((r) => !isMergedFlag(r.merged_into_activity))
        : (rows || []);
    const listBody = listRows.length
      ? listRows.map((r) => materialPurchaseRowHtml(r)).join('')
      : '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px">暂无记录</td></tr>';

    container.innerHTML = `
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card accent">
          <div class="stat-label">物料采购合计（当前年框）</div>
          <div class="stat-value sm">${fmtMoney(grandTotal)}</div>
          <div class="stat-sub">四卡片之和 · 与下方列表筛选无关</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-bottom:16px">
        ${bucketCardsHtml}
      </div>
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div class="card-title">登记记录</div>
            <div class="card-sub">固定费用项目 + 自定义项目；金额保留两位小数</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select class="filter-select" id="mpListBrandFilter" onchange="materialSetBrandFilter(this.value)">
              <option value="">全部品牌</option>${brandOpts}
            </select>
            <select class="filter-select" id="mpListMergeFilter" onchange="materialSetMergeFilter(this.value)">
              <option value="all" ${materialPageState.mergeFilter === 'all' ? 'selected' : ''}>计入：全部</option>
              <option value="unmerged" ${materialPageState.mergeFilter === 'unmerged' ? 'selected' : ''}>计入：未计入</option>
              <option value="merged" ${materialPageState.mergeFilter === 'merged' ? 'selected' : ''}>计入：已计入</option>
            </select>
            <button type="button" class="btn btn-primary btn-sm" onclick="showMaterialPurchaseModal(null)">+ 新建登记</button>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>ID</th><th>日期</th><th>品牌</th><th style="text-align:right">合计</th><th>关联项目</th><th>计入说明</th><th>计入状态</th><th>备注</th><th>操作</th></tr></thead>
              <tbody>${listBody}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    renderLucideIcons();
    applyRoleUiGuards();
  } catch (e) {
    const msg = String(e.message || '');
    const is404 = msg.includes('404');
    const hint404 =
      '<p style="margin-top:14px;font-size:13px;color:var(--text-muted)"><strong>接口 404</strong>：当前响应的 Node 进程<strong>没有注册</strong> <code>/api/material-purchases</code>，几乎都是因为<strong>仍在跑旧进程</strong>。请先 <code>lsof -i :3088</code>（或你的端口）找到旧 node 并结束进程，再在项目目录执行 <code>npm run start</code>。可打开 <code>/api/health</code> 查看 JSON 里 <code>features.materialPurchasesApi</code> 是否为 <code>true</code>。</p>';
    const hintDb =
      '<p style="margin-top:10px;font-size:13px;color:var(--text-muted)">若错误为数据库表不存在，请执行：<code style="font-size:12px">npm run migrate:material-purchases</code> 后再重启服务。</p>';
    container.innerHTML = `<div class="card"><div class="card-body empty-state">
      <div class="empty-title">加载失败</div>
      <div class="empty-sub">${escapeHtml(msg)}</div>
      ${is404 ? hint404 : hintDb}
    </div></div>`;
    renderLucideIcons();
  }
}

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
    year_frame_id: currentYearFrameId || 1,
    brand_id,
    purchase_date,
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

/* =============================================
  页面：付款申请（场次 + 费用明细 + 发票 + 同步到场次成本）
   ============================================= */
function reimbActivityLine(a) {
  if (!a) return '—';
  const pc = (a.project_code || '').trim() || '—';
  const d = fmtDateShort(a.date || a.activity_date);
  return `${d} · ${escapeHtml(pc)} · ${escapeHtml(a.city || '—')} · ${escapeHtml(a.activity_type || '')}`;
}

function reimbRenderActivityPicker() {
  const dl = document.getElementById('reimbProjectList');
  if (!dl) return;
  const acts = reimbursementPageState.activities || [];
  const rows = acts
    .map((a) => ({ id: Number(a.id), code: String(a.project_code || '').replace(/^\uFEFF/, '').trim() }))
    .filter((x) => Number.isFinite(x.id) && x.id > 0 && x.code);
  reimbursementActivityIndex.codes = new Set(rows.map((x) => x.code));
  reimbursementActivityIndex.idToCode = new Map(rows.map((x) => [x.id, x.code]));
  reimbursementActivityIndex.codeToId = new Map();
  rows.forEach((x) => {
    if (!reimbursementActivityIndex.codeToId.has(x.code)) reimbursementActivityIndex.codeToId.set(x.code, x.id);
  });
  const uniqSorted = [...new Set(rows.map((x) => x.code))].sort();
  dl.innerHTML = uniqSorted.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
}

function reimbSelectActivity(id) {
  const idNum = Number(id);
  const a = (reimbursementPageState.activities || []).find((x) => Number(x.id) === idNum);
  const hid = document.getElementById('reimbActivityId');
  const input = document.getElementById('reimbProjectCode');
  const lbl = document.getElementById('reimbActivityPicked');
  if (hid) hid.value = a ? String(a.id) : '';
  if (input) input.value = a ? (a.project_code || '') : '';
  if (lbl) {
    if (a) {
      lbl.innerHTML = reimbActivityLine(a);
      lbl.style.display = 'block';
    } else {
      lbl.textContent = '';
      lbl.style.display = 'none';
    }
  }
  const brandEl = document.getElementById('reimbBrand');
  if (brandEl && a && !brandEl.value) {
    brandEl.value = a.brand || '';
  }
}

function reimbProjectInputChanged() {
  const input = document.getElementById('reimbProjectCode');
  const hid = document.getElementById('reimbActivityId');
  const lbl = document.getElementById('reimbActivityPicked');
  const code = (input?.value || '').replace(/^\uFEFF/, '').trim();
  const id = code ? reimbursementActivityIndex.codeToId.get(code) : null;
  if (hid) hid.value = id ? String(id) : '';
  if (lbl) {
    if (!id) {
      lbl.style.display = 'none';
      lbl.textContent = '';
    } else {
      const a = (reimbursementPageState.activities || []).find((x) => Number(x.id) === Number(id));
      lbl.innerHTML = a ? reimbActivityLine(a) : code;
      lbl.style.display = 'block';
    }
  }
}

function reimbToggleInvoiceSection() {
  const yes = document.getElementById('reimbHasInvY')?.checked;
  const sec = document.getElementById('reimbInvoiceSection');
  if (!sec) return;
  sec.style.display = yes ? 'block' : 'none';
  if (yes) {
    const wrap = document.getElementById('reimbInvoiceRows');
    if (wrap && !wrap.querySelector('.reimb-inv-row')) reimbAppendInvoiceRow(null);
  }
}

function reimbAppendInvoiceRow(row) {
  const wrap = document.getElementById('reimbInvoiceRows');
  if (!wrap) return;
  const ct = row && row.invoice_content != null ? escapeHtml(String(row.invoice_content)) : '';
  const no = row && row.invoice_no != null ? escapeHtml(String(row.invoice_no)) : '';
  const dt = row && row.invoice_date ? String(row.invoice_date).slice(0, 10) : '';
  const k = row && row.invoice_kind === '普票' ? '普票' : '专票';
  const div = document.createElement('div');
  div.className = 'reimb-inv-row';
  div.style.cssText =
    'display:grid;grid-template-columns:1.2fr 1fr 130px 88px 44px;gap:8px;margin-bottom:8px;align-items:center';
  div.innerHTML = `
    <input type="text" class="form-control reimb-inv-content" placeholder="发票内容" value="${ct}">
    <input type="text" class="form-control reimb-inv-no" placeholder="发票号码" value="${no}">
    <input type="date" class="form-control reimb-inv-date" value="${dt}">
    <select class="form-control reimb-inv-kind">
      <option value="专票" ${k === '专票' ? 'selected' : ''}>专票</option>
      <option value="普票" ${k === '普票' ? 'selected' : ''}>普票</option>
    </select>
    <button type="button" class="btn btn-secondary btn-sm" onclick="reimbRemoveInvoiceRow(this)">删</button>`;
  wrap.appendChild(div);
}

function reimbRemoveInvoiceRow(btn) {
  const row = btn && btn.closest && btn.closest('.reimb-inv-row');
  if (!row) return;
  row.remove();
  const wrap = document.getElementById('reimbInvoiceRows');
  if (wrap && !wrap.querySelector('.reimb-inv-row') && document.getElementById('reimbHasInvY')?.checked) {
    reimbAppendInvoiceRow(null);
  }
}

function updateReimbCostTotal() {
  const d = collectCostDetails('reimb-cost-field');
  const t = calcCostDetailsTotal(d);
  const el = document.getElementById('reimbCostTotal');
  if (el) el.textContent = fmtMoney(t);
}

function reimbCollectInvoicesFromForm() {
  const out = [];
  document.querySelectorAll('.reimb-inv-row').forEach((row) => {
    const invoice_content = row.querySelector('.reimb-inv-content')?.value?.trim() || '';
    const invoice_no = row.querySelector('.reimb-inv-no')?.value?.trim() || '';
    const invoice_date = row.querySelector('.reimb-inv-date')?.value?.trim() || '';
    const invoice_kind = row.querySelector('.reimb-inv-kind')?.value || '';
    if (invoice_content || invoice_no || invoice_date || invoice_kind) out.push({ invoice_content, invoice_no, invoice_date, invoice_kind });
  });
  return out;
}

function reimbExportPayloadFromForm() {
  const id = document.getElementById('reimbRecordId')?.value?.trim();
  const date = document.getElementById('reimbDate')?.value || '';
  const remarks = document.getElementById('reimbRemarks')?.value?.trim() || '';
  const actId = parseInt(document.getElementById('reimbActivityId')?.value, 10);
  const act = (reimbursementPageState.activities || []).find((x) => Number(x.id) === actId);
  const brand = document.getElementById('reimbBrand')?.value?.trim() || '';
  const payment_type = document.getElementById('reimbPaymentType')?.value || 'personal_reimbursement';
  const cost_module = document.getElementById('reimbCostModule')?.value || 'activity';
  const claim_status = document.getElementById('reimbClaimStatus')?.value || 'draft';
  const has_invoice = !!document.getElementById('reimbHasInvY')?.checked;
  const invoices = has_invoice ? reimbCollectInvoicesFromForm() : [];
  const cost_details = collectCostDetails('reimb-cost-field');
  const amount = roundMoney2(calcCostDetailsTotal(cost_details));
  const merged = document.getElementById('reimbMergedNote')?.dataset?.merged === '1';
  return {
    id,
    date,
    remarks,
    activity_id: actId,
    brand,
    payment_type,
    cost_module,
    claim_status,
    project_code: act?.project_code || '',
    has_invoice,
    invoices,
    cost_details,
    amount,
    merged_into_activity: merged,
  };
}

function buildReimbursementCsvText(p) {
  const lines = [];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  lines.push(['报销日期', p.date, '金额合计', p.amount].join(','));
  lines.push(['申请类型', reimbPaymentTypeLabel(p.payment_type), '成本板块', reimbCostModuleLabel(p.cost_module), '状态', reimbClaimStatusLabel(p.claim_status)].join(','));
  lines.push(['品牌', esc(p.brand), '项目编号', esc(p.project_code), '关联场次ID', p.activity_id || ''].join(','));
  lines.push(['备注', esc(p.remarks)].join(','));
  lines.push(['有发票', p.has_invoice ? '是' : '否'].join(','));
  if (p.has_invoice && p.invoices.length) {
    lines.push('发票内容,发票号码,开票日期,专票/普票');
    p.invoices.forEach((iv) =>
      lines.push([esc(iv.invoice_content), esc(iv.invoice_no), iv.invoice_date, esc(iv.invoice_kind)].join(','))
    );
  }
  lines.push('');
  lines.push('费用明细项,金额');
  COST_DETAIL_GROUPS.forEach((g) => {
    g.items.forEach((it) => {
      const v = p.cost_details[it.key];
      if (v && roundMoney2(v) !== 0) lines.push([esc(it.label), roundMoney2(v)].join(','));
    });
  });
  return lines.join('\n');
}

function downloadReimbursementCsv(csvText, filename) {
  const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

let reimbursementPreviewState = {
  type: '',
  csvText: '',
  filename: '',
};

function openReimbursementPreviewModal({ title, bodyHtml, type = '', csvText = '', filename = '' }) {
  const titleEl = document.getElementById('modalReimbPreviewTitle');
  const bodyEl = document.getElementById('modalReimbPreviewBody');
  const csvBtn = document.getElementById('reimbPreviewDownloadCsvBtn');
  const pdfBtn = document.getElementById('reimbPreviewPrintPdfBtn');
  if (!titleEl || !bodyEl || !csvBtn || !pdfBtn) {
    showToast('预览弹窗未就绪，请刷新页面重试', 'warning');
    return;
  }
  reimbursementPreviewState = { type, csvText, filename };
  titleEl.textContent = title || '预览';
  bodyEl.innerHTML = bodyHtml || '';
  csvBtn.style.display = type === 'csv' ? 'inline-flex' : 'none';
  pdfBtn.style.display = type === 'pdf' ? 'inline-flex' : 'none';
  openModal('modalReimbPreview');
}

function reimbursementPreviewDownloadCsv() {
  if (reimbursementPreviewState.type !== 'csv' || !reimbursementPreviewState.csvText) return;
  downloadReimbursementCsv(
    reimbursementPreviewState.csvText,
    reimbursementPreviewState.filename || `付款申请_${todayDateInputValue()}.csv`
  );
}

function reimbursementPreviewPrintPdf() {
  const frame = document.getElementById('reimbPreviewPdfFrame');
  if (!frame || !frame.contentWindow) {
    showToast('PDF 预览内容未就绪', 'warning');
    return;
  }
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

function buildReimbursementPrintableHtml(p) {
  let invHtml = '';
  if (p.has_invoice && p.invoices.length) {
    invHtml = `<h3>发票明细</h3><table border="1" cellpadding="6" cellspacing="0" style="max-width:720px"><tr><th>发票内容</th><th>发票号码</th><th>开票日期</th><th>类型</th></tr>
      ${p.invoices
        .map(
          (iv) =>
            `<tr><td>${escapeHtml(iv.invoice_content || '')}</td><td>${escapeHtml(iv.invoice_no)}</td><td>${escapeHtml(iv.invoice_date)}</td><td>${escapeHtml(iv.invoice_kind)}</td></tr>`
        )
        .join('')}
    </table>`;
  }
  let detailRows = '';
  COST_DETAIL_GROUPS.forEach((g) => {
    g.items.forEach((it) => {
      const v = roundMoney2(p.cost_details[it.key]);
      if (v) detailRows += `<tr><td>${escapeHtml(it.label)}</td><td style="text-align:right">${v.toFixed(2)}</td></tr>`;
    });
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>付款申请打印</title>
    <style>body{font-family:sans-serif;padding:24px;color:#111} table{border-collapse:collapse;width:100%;max-width:720px} h2{margin-top:0}</style>
  </head><body>
  <h2>付款申请单（预览）</h2>
  <p>日期：${escapeHtml(p.date)}　品牌：${escapeHtml(p.brand || '—')}　项目编号：${escapeHtml(p.project_code || '—')}　金额合计：<strong>${p.amount.toFixed(2)}</strong> 元</p>
  <p>备注：${escapeHtml(p.remarks || '—')}</p>
  ${invHtml}
  <h3>费用明细</h3>
  <table border="1" cellpadding="6" cellspacing="0"><tr><th>项目</th><th>金额（元）</th></tr>${detailRows}<tr><th>合计</th><th style="text-align:right">${p.amount.toFixed(2)}</th></tr></table>
  <p style="margin-top:24px;font-size:12px;color:#666">已计入活动成本（场次）：${p.merged_into_activity ? '是' : '否'}</p>
  </body></html>`;
}

function reimbursementPreviewCsvFromForm() {
  const p = reimbExportPayloadFromForm();
  const csvText = buildReimbursementCsvText(p);
  const filename = `付款申请_${p.date || 'export'}.csv`;
  openReimbursementPreviewModal({
    title: 'CSV 预览',
    type: 'csv',
    csvText,
    filename,
    bodyHtml: `<pre style="white-space:pre-wrap;word-break:break-word;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;max-height:68vh;overflow:auto;margin:0">${escapeHtml(csvText)}</pre>`,
  });
}

function reimbursementPrintCurrentForm() {
  const p = reimbExportPayloadFromForm();
  const html = buildReimbursementPrintableHtml(p);
  openReimbursementPreviewModal({
    title: 'PDF 预览',
    type: 'pdf',
    bodyHtml: `<iframe id="reimbPreviewPdfFrame" style="width:100%;height:70vh;border:1px solid #e5e7eb;border-radius:8px;background:#fff" srcdoc="${escapeHtml(html)}"></iframe>`,
  });
}

async function reimbursementEditById(id) {
  try {
    const r = await api('GET', `/reimbursements/${id}`);
    await showReimbursementModal(r);
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
  }
}

async function showReimbursementModal(record) {
  const body = document.getElementById('modalReimbursementBody');
  const title = document.getElementById('modalReimbursementTitle');
  if (!body || !title) return;
  if (!currentYearFrameId) {
    showToast('请先选择年度并确保已加载年框', 'warning');
    return;
  }
  try {
    if (!reimbursementPageState.activities.length) {
      reimbursementPageState.activities = await api(
        'GET',
        `/activities?yearFrameId=${currentYearFrameId}&sortBy=date&sortOrder=DESC&isVirtual=0`
      );
    }
  } catch (e) {
    showToast('加载场次失败: ' + e.message, 'error');
    return;
  }

  const rid = record && record.id ? String(record.id) : '';
  const merged = !!(record && (record.merged_into_activity === 1 || record.merged_into_activity === true));
  const actId = record && record.activity_id ? Number(record.activity_id) : 0;
  const dateVal =
    record && record.date
      ? toDateInputValue(record.date)
      : todayDateInputValue();
  const remarksEsc = record && record.remarks ? escapeHtml(String(record.remarks)) : '';
  const details = record
    ? parseActivityCostDetails({ cost_details: record.cost_details })
    : parseActivityCostDetails({});
  const hi =
    record &&
    (record.has_invoice === 1 || record.has_invoice === true || String(record.has_invoice) === '1');
  const invList =
    record && Array.isArray(record.invoices) && record.invoices.length ? record.invoices : [];
  const brandVal = record && record.brand ? String(record.brand) : '';
  const paymentTypeVal = record && record.payment_type ? String(record.payment_type) : 'personal_reimbursement';
  const costModuleVal = record && record.cost_module ? String(record.cost_module) : 'activity';
  const claimStatusVal = record && record.claim_status ? String(record.claim_status) : 'draft';
  const brandOpts = FIXED_BRAND_CODES
    .map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`)
    .join('');
  const paymentTypeOptions = REIMB_PAYMENT_TYPE_OPTIONS
    .map((x) => `<option value="${x.value}" ${x.value === paymentTypeVal ? 'selected' : ''}>${x.label}</option>`)
    .join('');
  const costModuleOptions = REIMB_COST_MODULE_OPTIONS
    .map((x) => `<option value="${x.value}" ${x.value === costModuleVal ? 'selected' : ''}>${x.label}</option>`)
    .join('');
  const claimStatusOptions = REIMB_CLAIM_STATUS_OPTIONS
    .map((x) => `<option value="${x.value}" ${x.value === claimStatusVal ? 'selected' : ''}>${x.label}</option>`)
    .join('');

  let pickedMergedLabel = '—';
  if (merged && actId) {
    const ax = reimbursementPageState.activities.find((x) => Number(x.id) === actId);
    pickedMergedLabel = ax ? reimbActivityLine(ax) : `场次 #${actId}`;
  }

  title.textContent = rid ? `编辑付款申请 #${rid}` : '新建付款申请';
  body.innerHTML = `
    <input type="hidden" id="reimbRecordId" value="${rid}">
    <input type="hidden" id="reimbActivityId" value="${actId || ''}">
    <div id="reimbMergedNote" style="display:${merged ? 'block' : 'none'};margin-bottom:10px;padding:10px;background:var(--accent-soft);border-radius:var(--radius-sm);font-size:12px;color:var(--text-primary)" data-merged="${merged ? '1' : '0'}">
      本单已同步到场次成本；保存时将按「报销金额 &gt; 0 的项覆盖场次对应字段」再次合并。不可更换关联场次。
    </div>
    <div class="form-group">
      <label class="form-label">关联场次（可选）</label>
      ${
        merged
          ? `<div style="font-size:13px;padding:10px;background:var(--bg-input);border-radius:var(--radius-sm)">${pickedMergedLabel}</div>`
          : `<input type="text" class="form-control" id="reimbProjectCode" list="reimbProjectList" autocomplete="off" placeholder="输入关键字并从下拉选择项目编号（可留空）" oninput="reimbProjectInputChanged()">
             <datalist id="reimbProjectList"></datalist>
             <div id="reimbActivityPicked" style="display:none;margin-top:8px;font-size:12px;color:var(--text-secondary)"></div>`
      }
    </div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr">
      <div class="form-group">
        <label class="form-label">申请类型 <span class="required">*</span></label>
        <select class="form-control" id="reimbPaymentType">${paymentTypeOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">成本板块 <span class="required">*</span></label>
        <select class="form-control" id="reimbCostModule">${costModuleOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">申请状态 <span class="required">*</span></label>
        <select class="form-control" id="reimbClaimStatus">${claimStatusOptions}</select>
      </div>
    </div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr">
      <div class="form-group">
        <label class="form-label">报销日期 <span class="required">*</span></label>
        <input type="date" class="form-control" id="reimbDate" value="${dateVal}">
      </div>
      <div class="form-group">
        <label class="form-label">品牌 <span class="required">*</span></label>
        <select class="form-control" id="reimbBrand">
          <option value="">请选择品牌</option>
          ${brandOpts}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">是否有发票</label>
        <div style="display:flex;gap:16px;align-items:center;height:38px">
          <label style="display:flex;gap:6px;cursor:pointer;font-size:13px"><input type="radio" name="reimbHasInv" id="reimbHasInvY" value="1" ${hi ? 'checked' : ''} onchange="reimbToggleInvoiceSection()"> 有发票</label>
          <label style="display:flex;gap:6px;cursor:pointer;font-size:13px"><input type="radio" name="reimbHasInv" id="reimbHasInvN" value="0" ${!hi ? 'checked' : ''} onchange="reimbToggleInvoiceSection()"> 无发票</label>
        </div>
      </div>
    </div>
    <div class="form-group" id="reimbInvoiceSection" style="display:${hi ? 'block' : 'none'}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span class="form-label" style="margin:0">发票明细</span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="reimbAppendInvoiceRow(null)">+ 添加发票行</button>
      </div>
      <div id="reimbInvoiceRows"></div>
    </div>
    <label class="form-group" style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;margin-bottom:12px;background:var(--bg-input)">
      <input type="checkbox" id="reimbSyncToActivity" ${merged ? 'checked disabled' : ''} style="margin-top:3px">
      <span style="font-size:13px;color:var(--text-primary)">同步到场次成本（默认不勾选；勾选时必须选择关联场次。保存时将报销明细中金额<strong>大于 0</strong>的项写入该场次成本）</span>
    </label>
    <div class="form-label" style="margin-bottom:8px">费用明细（¥）</div>
    ${renderCostDetailSections('reimb-cost-field', details, 'updateReimbCostTotal()')}
    <div style="margin-top:14px;padding:12px;background:var(--accent-soft);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">
      <span style="color:var(--text-secondary);font-size:13px">成本合计</span>
      <span class="amount" style="font-size:18px;font-weight:700;color:var(--accent)" id="reimbCostTotal">${fmtMoney(calcCostDetailsTotal(details))}</span>
    </div>
    <div class="form-group" style="margin-top:12px">
      <label class="form-label">备注</label>
      <textarea class="form-control" id="reimbRemarks" rows="2" placeholder="选填">${remarksEsc}</textarea>
    </div>
  `;

  const wrap = document.getElementById('reimbInvoiceRows');
  if (wrap) {
    if (hi && invList.length) invList.forEach((iv) => reimbAppendInvoiceRow(iv));
    else if (hi) reimbAppendInvoiceRow(null);
  }
  if (!merged) {
    reimbRenderActivityPicker();
    if (actId) reimbSelectActivity(actId);
  } else if (document.getElementById('reimbActivityId') && actId) {
    document.getElementById('reimbActivityId').value = String(actId);
  }
  const brandEl = document.getElementById('reimbBrand');
  if (brandEl) {
    if (brandVal) brandEl.value = brandVal;
    if (!brandEl.value) brandEl.value = FIXED_BRAND_CODES[0] || 'PHD';
  }
  reimbToggleInvoiceSection();
  openModal('modalReimbursement');
  updateReimbCostTotal();
  renderLucideIcons();
}

async function saveReimbursementForm() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可保存', 'warning');
    return;
  }
  const rid = document.getElementById('reimbRecordId')?.value?.trim();
  const actId = parseInt(document.getElementById('reimbActivityId')?.value, 10);
  const hasAct = Number.isFinite(actId) && actId > 0;
  const projectCodeInput = (document.getElementById('reimbProjectCode')?.value || '').replace(/^\uFEFF/, '').trim();
  const brand = document.getElementById('reimbBrand')?.value?.trim() || '';
  const date = document.getElementById('reimbDate')?.value;
  const remarks = document.getElementById('reimbRemarks')?.value?.trim() || '';
  const payment_type = document.getElementById('reimbPaymentType')?.value || 'personal_reimbursement';
  const cost_module = document.getElementById('reimbCostModule')?.value || 'activity';
  const claim_status = document.getElementById('reimbClaimStatus')?.value || 'draft';
  const has_invoice = !!document.getElementById('reimbHasInvY')?.checked;
  const invoices = has_invoice ? reimbCollectInvoicesFromForm() : [];
  const cost_details = collectCostDetails('reimb-cost-field');
  const total = roundMoney2(calcCostDetailsTotal(cost_details));
  const syncEl = document.getElementById('reimbSyncToActivity');
  const mergedNote = document.getElementById('reimbMergedNote');
  const alreadyMerged = mergedNote && mergedNote.dataset.merged === '1';
  const sync_to_activity = alreadyMerged ? true : !!syncEl?.checked;

  if (!currentYearFrameId) {
    showToast('年框未就绪', 'warning');
    return;
  }
  if (!brand) {
    showToast('请选择品牌', 'warning');
    return;
  }
  if (!date) {
    showToast('请选择报销日期', 'warning');
    return;
  }
  if (projectCodeInput && !hasAct) {
    showToast('关联场次请从下拉候选中选中；若不关联请清空输入', 'warning');
    return;
  }
  if (total <= 0) {
    showToast('费用明细合计须大于 0', 'warning');
    return;
  }
  if (has_invoice) {
    const ok = invoices.some(
      (x) =>
        x.invoice_no &&
        x.invoice_date &&
        (x.invoice_kind === '专票' || x.invoice_kind === '普票')
    );
    if (!ok) {
      showToast('有发票时至少一行需填写：发票号码、开票日期、专票/普票', 'warning');
      return;
    }
  }
  if (sync_to_activity && !hasAct) {
    showToast('勾选同步到场次成本时，必须选择关联场次', 'warning');
    return;
  }

  const body = {
    year_frame_id: currentYearFrameId,
    activity_id: hasAct ? actId : null,
    brand,
    date,
    remarks,
    payment_type,
    cost_module,
    claim_status,
    has_invoice,
    invoices,
    cost_details,
    sync_to_activity,
  };
  const a = hasAct ? reimbursementPageState.activities.find((x) => Number(x.id) === actId) : null;
  if (a) {
    body.city = a.city || null;
    body.related_project_code = a.project_code || null;
    if (!body.brand) body.brand = a.brand || '';
  }

  try {
    if (rid) {
      await api('PUT', `/reimbursements/${rid}`, body);
      showToast('已更新', 'success');
    } else {
      await api('POST', '/reimbursements', body);
      showToast('付款申请已保存', 'success');
    }
    closeModal();
    if (currentPage === 'reimbursement') await renderReimbursements();
    if (currentPage === 'cost') await renderCost();
    void updateBadges();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

async function deleteReimbursementRecord(id) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除', 'warning');
    return;
  }
  if (!confirm('确定删除该条报销？')) return;
  try {
    await api('DELETE', `/reimbursements/${id}`);
    showToast('已删除', 'success');
    if (currentPage === 'reimbursement') await renderReimbursements();
    void updateBadges();
    if (currentPage === 'cost') await renderCost();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

let _reimbListFilterT;
function reimbursementListFilterDebounced() {
  clearTimeout(_reimbListFilterT);
  _reimbListFilterT = setTimeout(() => {
    reimbursementPageState.filterInput = document.getElementById('reimbListFilter')?.value || '';
    reimbursementRenderListDom();
  }, 220);
}

function reimbursementRenderListDom() {
  const container = document.getElementById('pageContainer');
  if (!container) return;
  const rows = reimbursementPageState.rows || [];
  const kw = (reimbursementPageState.filterInput || '').trim().toLowerCase();
  const filtered = !kw
    ? rows
    : rows.filter((r) => {
        const pc = String(r.related_project_code || '').toLowerCase();
        const brand = String(r.brand || '').toLowerCase();
        const city = String(r.city || '').toLowerCase();
        const rm = String(r.remarks || '').toLowerCase();
        const tp = reimbPaymentTypeLabel(r.payment_type || '').toLowerCase();
        const mod = reimbCostModuleLabel(r.cost_module || '').toLowerCase();
        const st = reimbClaimStatusLabel(r.claim_status || '').toLowerCase();
        return pc.includes(kw) || brand.includes(kw) || city.includes(kw) || rm.includes(kw) || tp.includes(kw) || mod.includes(kw) || st.includes(kw) || String(r.id).includes(kw);
      });
  const fi = escapeHtml(reimbursementPageState.filterInput || '');
  container.innerHTML = `
      <div class="page-toolbar" style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        <button type="button" class="btn btn-primary" onclick="showReimbursementModal(null)">新建付款申请</button>
        <input type="search" class="form-control" id="reimbListFilter" placeholder="筛选：品牌 / 项目编号 / 城市 / 备注 / 类型" style="max-width:360px"
          value="${fi}"
          oninput="reimbursementPageState.filterInput=this.value;reimbursementListFilterDebounced()">
      </div>
      <div class="card">
        <div class="card-body" style="padding:0">
          <div style="overflow-x:auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="min-width:88px">日期</th>
                  <th style="min-width:96px">申请类型</th>
                  <th style="min-width:120px">成本板块</th>
                  <th style="min-width:72px">品牌</th>
                  <th style="min-width:120px;text-align:left">金额</th>
                  <th style="min-width:140px">项目编号</th>
                  <th style="min-width:88px">状态</th>
                  <th style="min-width:88px">合并场次</th>
                  <th style="min-width:72px">发票</th>
                  <th style="min-width:180px">备注</th>
                  <th style="min-width:120px">操作</th>
                </tr>
              </thead>
              <tbody>
                ${filtered
                  .map((r) => {
                    const m = r.merged_into_activity === 1 || r.merged_into_activity === true;
                    const hi = r.has_invoice === 1 || r.has_invoice === true;
                    const paymentType = r.payment_type || 'personal_reimbursement';
                    const costModule = r.cost_module || 'activity';
                    const claimStatus = r.claim_status || 'draft';
                    return `<tr>
                    <td style="white-space:nowrap">${escapeHtml(fmtDateShort(r.date))}</td>
                    <td style="white-space:nowrap">${escapeHtml(reimbPaymentTypeLabel(paymentType))}</td>
                    <td style="white-space:nowrap">${escapeHtml(reimbCostModuleLabel(costModule))}</td>
                    <td style="white-space:nowrap">${escapeHtml(r.brand || '—')}</td>
                    <td class="amount" style="text-align:left;white-space:nowrap">${fmtMoney(r.amount)}</td>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(r.related_project_code || '')}">${escapeHtml(r.related_project_code || '—')}</td>
                    <td style="white-space:nowrap"><span class="badge ${reimbClaimStatusBadgeClass(claimStatus)}">${escapeHtml(reimbClaimStatusLabel(claimStatus))}</span></td>
                    <td style="white-space:nowrap">${m ? '<span class="badge badge-success">已计入</span>' : '—'}</td>
                    <td style="white-space:nowrap">${hi ? '有' : '无'}</td>
                    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(r.remarks || '')}">${escapeHtml(r.remarks || '—')}</td>
                    <td onclick="event.stopPropagation()" style="white-space:nowrap">
                      <button type="button" class="btn btn-secondary btn-sm" onclick="reimbursementEditById(${r.id})">编辑</button>
                      <button type="button" class="btn btn-secondary btn-sm" onclick="reimbursementQuickExport(${r.id})">CSV预览</button>
                      <button type="button" class="btn btn-danger btn-sm" onclick="deleteReimbursementRecord(${r.id})">删除</button>
                    </td>
                  </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
          ${
            !filtered.length
              ? '<div class="empty-state" style="padding:24px"><div class="empty-title">暂无付款申请记录</div></div>'
              : ''
          }
        </div>
      </div>
    `;
  renderLucideIcons();
}

async function renderReimbursements() {
  const container = document.getElementById('pageContainer');
  if (!container) return;
  if (!currentYearFrameId) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-title">请先选择年度</div></div>';
    return;
  }
  container.innerHTML = '<div class="empty-state"><div class="skeleton skeleton-title"></div></div>';
  try {
    const qs = `?yearFrameId=${currentYearFrameId}`;
    const [rows, acts] = await Promise.all([
      api('GET', `/reimbursements${qs}`),
      api('GET', `/activities?yearFrameId=${currentYearFrameId}&sortBy=date&sortOrder=DESC&isVirtual=0`),
    ]);
    reimbursementPageState.rows = rows;
    reimbursementPageState.activities = acts;
    if (reimbursementPageState.filterInput == null) reimbursementPageState.filterInput = '';
    reimbursementRenderListDom();
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message)}</div></div>`;
  }
}

async function reimbursementQuickExport(id) {
  try {
    const r = await api('GET', `/reimbursements/${id}`);
    const p = {
      id: r.id,
      date: r.date,
      remarks: r.remarks || '',
      activity_id: r.activity_id,
      brand: r.brand || '',
      project_code: r.related_project_code || '',
      payment_type: r.payment_type || 'personal_reimbursement',
      cost_module: r.cost_module || 'activity',
      claim_status: r.claim_status || 'draft',
      has_invoice: !!(r.has_invoice === 1 || r.has_invoice === true),
      invoices: Array.isArray(r.invoices) ? r.invoices : [],
      cost_details: parseActivityCostDetails({ cost_details: r.cost_details }),
      amount: parseFloat(r.amount) || 0,
      merged_into_activity: !!(r.merged_into_activity === 1 || r.merged_into_activity === true),
    };
    const csvText = buildReimbursementCsvText(p);
    const filename = `付款申请_${p.id}_${(p.date || '').slice(0, 10)}.csv`;
    openReimbursementPreviewModal({
      title: `CSV 预览 #${p.id}`,
      type: 'csv',
      csvText,
      filename,
      bodyHtml: `<pre style="white-space:pre-wrap;word-break:break-word;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;max-height:68vh;overflow:auto;margin:0">${escapeHtml(csvText)}</pre>`,
    });
  } catch (e) {
    showToast(e.message || '导出失败', 'error');
  }
}

/* =============================================
   页面：道具维修（品牌 + 自定义项目 + 无成本）
   ============================================= */
function propRepairRowHtml(r) {
  const rem = r.remarks ? String(r.remarks).slice(0, 48) + (String(r.remarks).length > 48 ? '…' : '') : '—';
  const noCost = r.no_cost === true || r.no_cost === 1 || String(r.no_cost) === '1';
  const merged = isMergedFlag(r.merged_into_activity);
  return `<tr>
    <td>${r.id}</td>
    <td>${escapeHtml(fmtDate(r.repair_date))}</td>
    <td><span class="badge badge-accent">${escapeHtml(String(r.region || '—'))}</span></td>
    <td><span class="badge badge-${brandColor(r.brand_code || r.brand_name)}">${escapeHtml(r.brand_name || r.brand_code || '—')}</span></td>
    <td class="amount amount-revenue" style="text-align:right">${fmtMoney(r.quoted_price || 0)}</td>
    <td class="amount" style="text-align:right">${noCost ? '无成本' : fmtMoney(r.total_amount)}</td>
    <td>${listActivityProjectHtml(r)}</td>
    <td>${listAllocationNoteHtml(r.allocation_note)}</td>
    <td>${merged ? '<span class="badge badge-success">已计入</span>' : '<span class="badge badge-gray">未计入</span>'}</td>
    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--text-secondary)" title="${escapeHtml(r.remarks || '')}">${escapeHtml(rem)}</td>
    <td onclick="event.stopPropagation()" style="white-space:nowrap">
      <button type="button" class="btn btn-secondary btn-sm" onclick="showPropRepairModal(${r.id})">编辑</button>
      <button type="button" class="btn btn-danger btn-sm" onclick="deletePropRepairRecord(${r.id})">删除</button>
    </td>
  </tr>`;
}

function propRepairSetBrandFilter(v) {
  propRepairPageState.filterBrandId = v || '';
  renderPropRepairs();
}

function propRepairSetMergeFilter(v) {
  propRepairPageState.mergeFilter = v || 'all';
  renderPropRepairs();
}

function collectPropRepairItemsFromForm() {
  const out = [];
  document.querySelectorAll('.pr-custom-row').forEach((row) => {
    const nm = row.querySelector('.pr-custom-name')?.value?.trim();
    const am = roundMoney2(row.querySelector('.pr-custom-amt')?.value);
    if (nm && am > 0) out.push({ name: nm, amount: am });
  });
  return out;
}

function updatePrTotal() {
  const noCost = !!document.getElementById('prNoCost')?.checked;
  const rows = document.querySelectorAll('.pr-custom-row .pr-custom-amt');
  rows.forEach((el) => {
    el.disabled = noCost;
    if (noCost) el.value = '';
  });
  const t = noCost
    ? 0
    : roundMoney2(collectPropRepairItemsFromForm().reduce((s, x) => s + roundMoney2(x.amount), 0));
  const el = document.getElementById('prTotalDisplay');
  if (el) el.textContent = noCost ? '无成本' : fmtMoney(t);
}

function propRepairAppendCustomRow(name = '', amount = '') {
  const wrap = document.getElementById('prCustomRows');
  if (!wrap) return;
  const div = document.createElement('div');
  div.className = 'form-group pr-custom-row';
  div.style.cssText = 'display:grid;grid-template-columns:1fr 120px 52px;gap:8px;align-items:center;margin-bottom:8px';
  div.innerHTML = `
    <input type="text" class="form-control pr-custom-name" placeholder="项目名称" value="${escapeHtml(name)}">
    <input type="number" class="form-control pr-custom-amt" step="0.01" min="0" placeholder="0.00" value="${amount}" oninput="updatePrTotal()">
    <button type="button" class="btn btn-secondary btn-sm" onclick="this.closest('.pr-custom-row').remove();updatePrTotal()">删</button>
  `;
  wrap.appendChild(div);
}

async function renderPropRepairs() {
  const container = document.getElementById('pageContainer');
  container.innerHTML = '<div style="text-align:center;padding:36px;color:var(--text-muted)">加载中...</div>';
  try {
    const yf = currentYearFrameId || '';
    const qs = new URLSearchParams();
    if (yf) qs.set('yearFrameId', String(yf));
    if (propRepairPageState.filterBrandId) qs.set('brandId', propRepairPageState.filterBrandId);
    const qStr = qs.toString();
    const yfOnlyQs = new URLSearchParams();
    if (yf) yfOnlyQs.set('yearFrameId', String(yf));
    const yfOnlyStr = yfOnlyQs.toString();

    const [rows, rowsAllYear, brands] = await Promise.all([
      api('GET', `/prop-repairs${qStr ? `?${qStr}` : ''}`),
      api('GET', `/prop-repairs${yfOnlyStr ? `?${yfOnlyStr}` : ''}`),
      api('GET', '/brand?active=true'),
    ]);

    const brandOpts = (brands || [])
      .map(
        (b) =>
          `<option value="${b.id}" ${String(propRepairPageState.filterBrandId) === String(b.id) ? 'selected' : ''}>${escapeHtml(b.brand_name || b.brand_code)}</option>`
      )
      .join('');

    const quotedTotals = {};
    const costTotals = {};
    const counts = {};
    (rowsAllYear || []).forEach((r) => {
      const key = String(r.brand_name || r.brand_code || '未知品牌');
      const noCost = r.no_cost === true || r.no_cost === 1 || String(r.no_cost) === '1';
      const quoted = roundMoney2(r.quoted_price);
      const cost = noCost ? 0 : roundMoney2(r.total_amount);
      quotedTotals[key] = roundMoney2((quotedTotals[key] || 0) + quoted);
      costTotals[key] = roundMoney2((costTotals[key] || 0) + cost);
      counts[key] = (counts[key] || 0) + 1;
    });
    const grandQuoted = roundMoney2(Object.values(quotedTotals).reduce((s, v) => s + roundMoney2(v), 0));
    const grandCost = roundMoney2(Object.values(costTotals).reduce((s, v) => s + roundMoney2(v), 0));

    const brandCardsHtml = Object.keys(quotedTotals)
      .sort((a, b) => quotedTotals[b] - quotedTotals[a])
      .map(
        (name) => `
      <div class="stat-card blue" style="min-height:120px">
        <div class="stat-icon"><i data-lucide="wrench" style="width:16px;height:16px"></i></div>
        <div class="stat-label">${escapeHtml(name)}</div>
        <div class="stat-value sm">${fmtMoney(quotedTotals[name] || 0)}</div>
        <div class="stat-sub">${counts[name] || 0} 笔 · 维修费 ${fmtMoney(costTotals[name] || 0)}</div>
      </div>`
      )
      .join('');

    const listRows = (propRepairPageState.mergeFilter === 'merged')
      ? (rows || []).filter((r) => isMergedFlag(r.merged_into_activity))
      : (propRepairPageState.mergeFilter === 'unmerged')
        ? (rows || []).filter((r) => !isMergedFlag(r.merged_into_activity))
        : (rows || []);
    const listBody = listRows.length
      ? listRows.map((r) => propRepairRowHtml(r)).join('')
      : '<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:20px">暂无记录</td></tr>';

    container.innerHTML = `
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card accent">
          <div class="stat-label">道具维修报价合计（当前年框）</div>
          <div class="stat-value sm">${fmtMoney(grandQuoted)}</div>
          <div class="stat-sub">维修费合计 ${fmtMoney(grandCost)} · 与下方筛选无关</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-bottom:16px">
        ${brandCardsHtml || '<div class="card"><div class="card-body" style="color:var(--text-muted)">暂无品牌分布数据</div></div>'}
      </div>
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div class="card-title">维修登记记录</div>
            <div class="card-sub">全部为自定义项目；支持“无成本”登记</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select class="filter-select" id="prListBrandFilter" onchange="propRepairSetBrandFilter(this.value)">
              <option value="">全部品牌</option>${brandOpts}
            </select>
            <select class="filter-select" id="prListMergeFilter" onchange="propRepairSetMergeFilter(this.value)">
              <option value="all" ${propRepairPageState.mergeFilter === 'all' ? 'selected' : ''}>计入：全部</option>
              <option value="unmerged" ${propRepairPageState.mergeFilter === 'unmerged' ? 'selected' : ''}>计入：未计入</option>
              <option value="merged" ${propRepairPageState.mergeFilter === 'merged' ? 'selected' : ''}>计入：已计入</option>
            </select>
            <button type="button" class="btn btn-primary btn-sm" onclick="showPropRepairModal(null)">+ 新建登记</button>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>ID</th><th>日期</th><th>区域</th><th>品牌</th><th style="text-align:right">报价</th><th style="text-align:right">维修费</th><th>关联项目</th><th>计入说明</th><th>计入状态</th><th>备注</th><th>操作</th></tr></thead>
              <tbody>${listBody}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    renderLucideIcons();
    applyRoleUiGuards();
  } catch (e) {
    const msg = String(e.message || '');
    container.innerHTML = `<div class="card"><div class="card-body empty-state">
      <div class="empty-title">加载失败</div>
      <div class="empty-sub">${escapeHtml(msg)}</div>
      <p style="margin-top:10px;font-size:13px;color:var(--text-muted)">若为数据库表不存在，请执行：<code style="font-size:12px">npm run migrate:prop-repairs</code> 后重启服务。</p>
    </div></div>`;
    renderLucideIcons();
  }
}

async function showPropRepairModal(id) {
  const title = document.getElementById('modalPropRepairTitle');
  const body = document.getElementById('modalPropRepairBody');
  if (!body) return;
  let record = null;
  if (id) {
    try {
      record = await api('GET', `/prop-repairs/${id}`);
      if (title) title.textContent = '编辑道具维修';
    } catch (e) {
      showToast(e.message || '加载失败', 'error');
      return;
    }
  } else if (title) {
    title.textContent = '新建道具维修';
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
  const dateVal = record && record.repair_date
    ? toDateInputValue(record.repair_date)
    : todayDateInputValue();

  const customFromRecord = (record && Array.isArray(record.items) ? record.items : []).filter(
    (it) => it && it.name
  );
  const remarksAttr = record && record.remarks ? escapeHtml(record.remarks) : '';
  const noCost = record && (record.no_cost === true || record.no_cost === 1 || String(record.no_cost) === '1');
  const quotedPrice = record && record.quoted_price != null ? roundMoney2(record.quoted_price).toFixed(2) : '';
  const mergedPr = record && (record.merged_into_activity === true || record.merged_into_activity === 1 || String(record.merged_into_activity) === '1');
  const prProject = record && record.activity_id ? (Array.from(logisticsProjectIndex.codeToId.entries()).find(([, idv]) => Number(idv) === Number(record.activity_id)) || [record.related_project_code || '', 0])[0] : '';

  body.innerHTML = `
    <input type="hidden" id="prRecordId" value="${record ? record.id : ''}">
    <div class="form-grid" style="grid-template-columns:1fr 1fr">
      <div class="form-group">
        <label class="form-label">品牌 <span class="required">*</span></label>
        <select class="form-control" id="prBrandId" required>${brandOpts}</select>
      </div>
      <div class="form-group">
        <label class="form-label">维修日期 <span class="required">*</span></label>
        <input type="date" class="form-control" id="prRepairDate" required value="${dateVal}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">区域 <span class="required">*</span></label>
      <select class="form-control" id="prRegion" required>
        <option value="东区">东区</option>
        <option value="北区">北区</option>
        <option value="南区">南区</option>
        <option value="东南区">东南区</option>
        <option value="西南区">西南区</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">报价 (¥)</label>
      <input type="number" class="form-control" id="prQuotedPrice" placeholder="0.00" step="0.01" min="0" value="${quotedPrice}">
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin:0 0 10px;color:var(--text-secondary);cursor:pointer">
      <input type="checkbox" id="prNoCost" ${noCost ? 'checked' : ''} onchange="updatePrTotal()">
      <span>无成本（勾选后本条金额记 0）</span>
    </label>
    <div class="form-group">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span class="form-label" style="margin:0">维修项目（自定义）</span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="propRepairAppendCustomRow()">+ 添加一行</button>
      </div>
      <div id="prCustomRows"></div>
    </div>
    <div class="form-group">
      <label class="form-label">备注</label>
      <input type="text" class="form-control" id="prRemarks" placeholder="选填" value="${remarksAttr}">
    </div>
    <div class="form-group">
      <label class="form-label">关联项目编号（可选）</label>
      <input type="text" class="form-control" id="prProjectCode" list="prProjectList" autocomplete="off" placeholder="输入并从下拉选择（仅允许活动项目编号）" value="${escapeHtml(prProject)}">
      <datalist id="prProjectList">${projectOptions}</datalist>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin:0 0 10px;color:var(--text-secondary);cursor:pointer">
      <input type="checkbox" id="prMergedIntoActivity" ${mergedPr ? 'checked' : ''}>
      <span>计入活动成本（勾选时需选择关联项目编号）</span>
    </label>
    <div class="form-group">
      <label class="form-label">计入说明</label>
      <input type="text" class="form-control" id="prAllocationNote" placeholder="选填" value="${escapeHtml((record && record.allocation_note) || '')}">
    </div>
    <div style="margin-top:12px;padding:12px;background:var(--accent-soft);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">
      <span style="color:var(--text-secondary)">合计</span>
      <span class="amount" id="prTotalDisplay" style="font-size:18px;font-weight:700">${fmtMoney(0)}</span>
    </div>
  `;

  const bs = document.getElementById('prBrandId');
  if (bs && defaultBrand) bs.value = defaultBrand;
  const rs = document.getElementById('prRegion');
  if (rs) rs.value = record && record.region ? String(record.region) : '东区';
  (customFromRecord || []).forEach((it) => {
    propRepairAppendCustomRow(it.name, roundMoney2(it.amount).toFixed(2));
  });
  if (!customFromRecord.length) propRepairAppendCustomRow();
  openModal('modalPropRepair');
  updatePrTotal();
  renderLucideIcons();
}

async function savePropRepairForm() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可保存', 'warning');
    return;
  }
  const id = document.getElementById('prRecordId')?.value?.trim();
  const brand_id = parseInt(document.getElementById('prBrandId')?.value, 10);
  const repair_date = document.getElementById('prRepairDate')?.value;
  const region = document.getElementById('prRegion')?.value;
  const quoted_price = roundMoney2(document.getElementById('prQuotedPrice')?.value);
  const remarks = document.getElementById('prRemarks')?.value?.trim() || '';
  const no_cost = !!document.getElementById('prNoCost')?.checked;
  const projectCode = (document.getElementById('prProjectCode')?.value || '').replace(/^\uFEFF/, '').trim();
  const mergedIntoActivity = !!document.getElementById('prMergedIntoActivity')?.checked;
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
  const items = no_cost ? [] : collectPropRepairItemsFromForm();
  const total = no_cost ? 0 : roundMoney2(items.reduce((s, x) => s + x.amount, 0));
  if (!brand_id) {
    showToast('请选择品牌', 'warning');
    return;
  }
  if (!repair_date) {
    showToast('请选择维修日期', 'warning');
    return;
  }
  if (!region) {
    showToast('请选择区域', 'warning');
    return;
  }
  if (!no_cost && (!items.length || total <= 0)) {
    showToast('请至少填写一项大于 0 的金额，或勾选无成本', 'warning');
    return;
  }
  const body = {
    year_frame_id: currentYearFrameId || 1,
    brand_id,
    repair_date,
    region,
    quoted_price,
    items,
    no_cost: no_cost ? 1 : 0,
    activity_id: activityId || null,
    merged_into_activity: mergedIntoActivity ? 1 : 0,
    allocation_note: document.getElementById('prAllocationNote')?.value?.trim() || null,
    remarks,
  };
  try {
    if (id) {
      await api('PUT', `/prop-repairs/${id}`, body);
      showToast('已更新', 'success');
    } else {
      await api('POST', '/prop-repairs', body);
      showToast('已保存', 'success');
    }
    closeModal();
    if (currentPage === 'prop-repair') await renderPropRepairs();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

async function deletePropRepairRecord(rid) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除', 'warning');
    return;
  }
  if (!confirm('确定删除该条道具维修记录？')) return;
  try {
    await api('DELETE', `/prop-repairs/${rid}`);
    showToast('已删除', 'success');
    await renderPropRepairs();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

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

async function loadItemCatalogPage() {
  const host = document.getElementById('itemCatalogListHost');
  const statsEl = document.getElementById('itemCatalogStats');
  if (!host) return;
  try {
    const rows = await api('GET', '/inventory/item-catalog');
    const safeRows = Array.isArray(rows) ? rows : [];
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-card" style="min-width:180px">
          <div class="stat-label">目录条数</div>
          <div class="stat-value">${safeRows.length}</div>
        </div>`;
    }
    if (!safeRows.length) {
      host.innerHTML =
        '<div class="empty-state">暂无物品目录。点击上方「同步目录（PHD/X.O/CLUB）」生成目录主数据。</div>';
      renderLucideIcons();
      return;
    }
    host.innerHTML = `
      <div class="table-wrapper act-table-scroll-wrap">
        <table class="data-table act-table-sticky-head">
          <thead>
            <tr>
              <th style="width:72px">图</th>
              <th>名称</th>
              <th>规格</th>
              <th>来源品牌</th>
              <th>来源区域</th>
              <th style="width:88px">常用</th>
            </tr>
          </thead>
          <tbody>
            ${safeRows
              .map((r) => {
                const img =
                  Array.isArray(r.image_urls) && r.image_urls[0]
                    ? `<img src="${escapeHtml(r.image_urls[0])}" alt="" style="width:56px;height:56px;object-fit:contain;border-radius:6px;background:var(--bg-primary)">`
                    : '<span style="color:var(--text-muted);font-size:12px">—</span>';
                return `<tr>
                  <td>${img}</td>
                  <td style="font-weight:600">${escapeHtml(r.name || '—')}</td>
                  <td>${escapeHtml(r.dimensions || '—')}</td>
                  <td>${escapeHtml(r.source_brands || '—')}</td>
                  <td>${escapeHtml(r.source_regions || '—')}</td>
                  <td>${r.is_common ? '<span class="badge badge-accent">常用</span>' : '<span class="badge badge-gray">—</span>'}</td>
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
        '<div class="empty-state">当前后端进程未加载“物品目录”接口（404）。请重启后端后重试；重启前你也可以先在服务器执行脚本 <code>npm run script:sync-inv-item-catalog</code>。</div>';
      return;
    }
    host.innerHTML = `<div style="color:var(--danger);padding:16px">加载失败：${escapeHtml(msg || '')}</div>`;
  }
}

async function invSyncItemCatalogFromWarehouses() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可同步物品目录', 'warning');
    return;
  }
  try {
    const ret = await api('POST', '/inventory/item-catalog/sync-from-warehouses', {});
    showToast(`同步完成：新增 ${ret.inserted || 0}，更新 ${ret.updated || 0}`, 'success');
    await loadItemCatalogPage();
    updateBadges();
  } catch (e) {
    const msg = String(e && e.message ? e.message : '');
    if (/\b404\b/.test(msg)) {
      showToast('同步接口未生效（404）：请重启后端服务后再点同步', 'warning');
      return;
    }
    showToast(msg || '同步失败', 'error');
  }
}

async function invOpenAddItemCatalogModal() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可从目录添加物品', 'warning');
    return;
  }
  const whId = Number(inventoryPageState.warehouseId || 0);
  if (!whId) {
    showToast('请先点击仓库卡片', 'warning');
    return;
  }
  const body = document.getElementById('invAddItemCatalogModalBody');
  if (!body) return;
  body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">加载物品目录中...</div>';
  openModal('modalInvAddItemCatalog');
  try {
    const [catalog, warehouses] = await Promise.all([
      api('GET', '/inventory/item-catalog'),
      api('GET', '/inventory/warehouses'),
    ]);
    invAddItemCatalogModalState.catalog = Array.isArray(catalog) ? catalog : [];
    invAddItemCatalogModalState.warehouses = Array.isArray(warehouses) ? warehouses : [];
    invAddItemCatalogModalState.warehouseId = whId;
    invAddItemCatalogModalState.search = '';
    if (!invAddItemCatalogModalState.warehouses.some((w) => Number(w.id) === whId)) {
      invAddItemCatalogModalState.warehouseId = Number(invAddItemCatalogModalState.warehouses[0]?.id || 0) || null;
    }
    await invRenderAddItemCatalogModalContent();
  } catch (e) {
    body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

async function invRenderAddItemCatalogModalContent() {
  const body = document.getElementById('invAddItemCatalogModalBody');
  if (!body) return;
  const whId = Number(invAddItemCatalogModalState.warehouseId || 0);
  if (!whId) {
    body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">暂无可用仓库，请先创建仓库。</div>';
    return;
  }
  const wh = (invAddItemCatalogModalState.warehouses || []).find((w) => Number(w.id) === whId);
  const items = await api('GET', `/inventory/items?inv_warehouse_id=${whId}`);
  const exists = new Set((items || []).map((it) => invCatalogKey(it.name, it.dimensions)));
  const rows = (invAddItemCatalogModalState.catalog || []).map((c) => {
    const key = invCatalogKey(c.name, c.dimensions);
    const already = exists.has(key);
    const img =
      Array.isArray(c.image_urls) && c.image_urls[0]
        ? `<img src="${escapeHtml(c.image_urls[0])}" alt="" style="width:40px;height:40px;object-fit:contain;border-radius:6px;background:var(--bg-primary)">`
        : '<span style="color:var(--text-muted)">—</span>';
    const searchText = [c.name, c.dimensions, c.source_brands, c.source_regions]
      .map((x) => String(x || '').trim().toLowerCase())
      .filter(Boolean)
      .join(' ');
    return `
      <tr data-catalog-id="${c.id}" data-search="${escapeHtml(searchText)}">
        <td>${img}</td>
        <td style="font-weight:600">${escapeHtml(c.name || '—')}</td>
        <td>${escapeHtml(c.dimensions || '—')}</td>
        <td>${escapeHtml(c.source_brands || '—')}</td>
        <td style="text-align:center">
          ${already ? `<span style="font-size:12px;color:var(--text-muted)">已在仓库</span>` : `<input type="checkbox" class="inv-add-item-catalog-ck" data-catalog-id="${c.id}">`}
        </td>
        <td style="width:100px">
          ${already ? '<span style="color:var(--text-muted);font-size:12px">—</span>' : `<input type="number" class="form-control inv-add-item-catalog-qty" data-catalog-id="${c.id}" min="0" step="1" value="0" placeholder="0">`}
        </td>
      </tr>`;
  });
  const whOpts = (invAddItemCatalogModalState.warehouses || [])
    .map((w) => `<option value="${w.id}" ${Number(w.id) === whId ? 'selected' : ''}>${escapeHtml(`${invWarehouseBrandDisplay(w) || ''} · ${w.region || ''}${w.label ? ` · ${w.label}` : ''}`)}</option>`)
    .join('');
  body.innerHTML = `
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">目标仓库</label>
      <select class="form-control" id="invAddItemCatalogWarehouse" onchange="invOnAddItemCatalogWarehouseChange(this.value)">
        ${whOpts}
      </select>
    </div>
    <div class="form-hint" style="margin:0 0 10px">
      当前仓库：<strong>${escapeHtml(wh ? `${invWarehouseBrandDisplay(wh)} · ${wh.region}` : `#${whId}`)}</strong>。从目录选择物料加入仓库；数量可填 0，后续再调整。
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <button type="button" class="btn btn-secondary btn-xs" onclick="invAddItemCatalogToggleAll(true)">全选可添加</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="invAddItemCatalogToggleAll(false)">全不选</button>
      <input
        type="text"
        class="form-control"
        id="invAddItemCatalogSearch"
        value="${escapeHtml(invAddItemCatalogModalState.search || '')}"
        placeholder="搜索名称/规格/来源品牌"
        style="margin-left:auto;max-width:280px"
        oninput="invFilterAddItemCatalogRows(this.value)"
      >
    </div>
    <div class="table-wrapper" style="max-height:52vh;overflow:auto">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:52px">图</th>
            <th>名称</th>
            <th>规格</th>
            <th>来源品牌</th>
            <th style="width:96px;text-align:center">加入</th>
            <th style="width:110px">初始数量</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
  invFilterAddItemCatalogRows(invAddItemCatalogModalState.search || '');
}

function invFilterAddItemCatalogRows(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  invAddItemCatalogModalState.search = kw;
  document.querySelectorAll('#invAddItemCatalogModalBody tbody tr[data-search]').forEach((tr) => {
    const hay = String(tr.getAttribute('data-search') || '').toLowerCase();
    tr.style.display = !kw || hay.includes(kw) ? '' : 'none';
  });
}

async function invOnAddItemCatalogWarehouseChange(warehouseId) {
  const id = parseInt(warehouseId, 10);
  if (!Number.isFinite(id)) return;
  invAddItemCatalogModalState.warehouseId = id;
  const body = document.getElementById('invAddItemCatalogModalBody');
  if (body) body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">切换仓库中...</div>';
  try {
    await invRenderAddItemCatalogModalContent();
  } catch (e) {
    if (body) body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

function invAddItemCatalogToggleAll(checked) {
  document.querySelectorAll('.inv-add-item-catalog-ck').forEach((el) => {
    el.checked = !!checked;
  });
}

async function invSubmitAddItemCatalogToWarehouse() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可从目录添加物品', 'warning');
    return;
  }
  const whId = Number(
    document.getElementById('invAddItemCatalogWarehouse')?.value || invAddItemCatalogModalState.warehouseId || inventoryPageState.warehouseId || 0,
  );
  if (!whId) {
    showToast('请先选择仓库', 'warning');
    return;
  }
  const picked = [];
  document.querySelectorAll('.inv-add-item-catalog-ck:checked').forEach((ck) => {
    const catalogId = parseInt(ck.dataset.catalogId, 10);
    if (!Number.isFinite(catalogId) || catalogId <= 0) return;
    const qtyEl = document.querySelector(`.inv-add-item-catalog-qty[data-catalog-id="${catalogId}"]`);
    const q = parseInt(qtyEl?.value, 10);
    picked.push({ catalog_id: catalogId, quantity: Number.isFinite(q) && q >= 0 ? q : 0 });
  });
  if (!picked.length) {
    showToast('请先勾选要添加的物料', 'warning');
    return;
  }
  try {
    const ret = await api('POST', '/inventory/items/from-item-catalog', {
      inv_warehouse_id: whId,
      items: picked,
    });
    inventoryPageState.warehouseId = whId;
    showToast(
      `已添加 ${ret.inserted || 0} 条；已存在 ${ret.skipped_existing || 0} 条`,
      'success',
    );
    closeModal();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '添加失败', 'error');
  }
}

function renderWineRecordTabs(activeTab = 'stockIn') {
  const host = document.getElementById('wineRecordTabs');
  if (!host) return;
  const cls = (tab) => (tab === activeTab ? 'btn btn-primary btn-xs' : 'btn btn-secondary btn-xs');
  host.innerHTML = `
    <button class="${cls('stockIn')}" onclick="loadWineRecords('stockIn')">入库记录</button>
    <button class="${cls('usage')}" onclick="loadWineRecords('usage')">用酒记录</button>
    <button class="${cls('returns')}" onclick="loadWineRecords('returns')">归还记录</button>
  `;
}

async function loadWineRecords(tab) {
  renderWineRecordTabs(tab || 'stockIn');
  const content = document.getElementById('wineRecordsContent');
  content.innerHTML = `<div style="color:var(--text-muted);padding:20px;text-align:center">加载中...</div>`;
  
  try {
    const qs = currentYearFrameId ? `?year_frame_id=${currentYearFrameId}` : '';
    const activityRows = await api('GET', `/activities${currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : ''}`);
    const activityCodeMap = new Map((activityRows || []).map((a) => [Number(a.id), String(a.project_code || '').trim()]));
    const activityRefHtml = (activityId) => {
      const idNum = Number(activityId || 0);
      if (!idNum) return '—';
      const code = activityCodeMap.get(idNum) || `#${idNum}`;
      return `<a href="#" onclick="event.preventDefault();showActivityDetail(${idNum})">${escapeHtml(code)}</a>`;
    };
    const records =
      tab === 'stockIn'
        ? await api('GET', `/wine/stock-in${qs}`)
        : tab === 'returns'
          ? await api('GET', `/wine/returns${qs}`)
          : await api('GET', `/wine/usage${qs}`);
    
    if (records.length === 0) {
      const typeLabel = tab === 'stockIn' ? '入库' : tab === 'returns' ? '归还' : '使用';
      content.innerHTML = `<div style="color:var(--text-muted);padding:30px;text-align:center">暂无${typeLabel}记录</div>`;
      return;
    }

    if (tab === 'stockIn') {
      content.innerHTML = `
        <table class="data-table">
          <thead><tr><th>日期</th><th>酒品</th><th>规格</th><th>数量</th><th>金额</th><th>供应商</th><th>操作</th></tr></thead>
          <tbody>
            ${records.slice(0, 50).map(r => `
              <tr>
                <td>${fmtDate(r.stock_in_date)}</td>
                <td>${r.wine_name}</td>
                <td>${r.spec}</td>
                <td style="color:var(--success);font-weight:600">+${r.quantity}</td>
                <td>${fmtMoney(r.total_amount)}</td>
                <td style="color:var(--text-muted)">${r.supplier || '—'}</td>
                <td><button class="btn btn-danger btn-sm" onclick="deleteWineStockIn(${r.id})" title="删除入库记录"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      renderLucideIcons();
    } else if (tab === 'usage') {
      content.innerHTML = `
        <table class="data-table">
          <thead><tr><th>日期</th><th>酒品</th><th>规格</th><th>数量</th><th>客户</th><th>关联活动</th><th>操作</th></tr></thead>
          <tbody>
            ${records.slice(0, 50).map(r => `
              <tr>
                <td>${fmtDate(r.usage_date)}</td>
                <td>${r.wine_name}</td>
                <td>${r.spec}</td>
                <td style="color:var(--danger);font-weight:600">-${r.quantity}</td>
                <td>${r.client_name || '—'}</td>
                <td>${activityRefHtml(r.activity_id)}</td>
                <td>
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-primary btn-sm" onclick="showWineUsageModal(${r.id})" title="归还入库">归还</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteWineUsage(${r.id})" title="删除"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      renderLucideIcons();
    } else {
      content.innerHTML = `
        <table class="data-table">
          <thead><tr><th>日期</th><th>酒品</th><th>规格</th><th>归还数量</th><th>关联活动</th><th>备注</th><th>操作</th></tr></thead>
          <tbody>
            ${records.slice(0, 50).map(r => `
              <tr>
                <td>${fmtDate(r.return_date)}</td>
                <td>${r.wine_name}</td>
                <td>${r.spec || '—'}</td>
                <td style="color:var(--success);font-weight:600">+${r.quantity}</td>
                <td>${activityRefHtml(r.activity_id)}</td>
                <td style="color:var(--text-muted)">${escapeHtml(r.remarks || '—')}</td>
                <td><button class="btn btn-danger btn-sm" onclick="deleteWineReturnLog(${r.id})" title="删除归还记录"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      renderLucideIcons();
    }
  } catch (err) {
    if (tab === 'returns' && String(err?.message || '').includes('404')) {
      content.innerHTML = `<div style="color:var(--warning);padding:20px">归还记录接口未生效（404）。请重启后端服务后重试。</div>`;
      return;
    }
    content.innerHTML = `<div style="color:var(--danger);padding:20px">加载失败: ${err.message}</div>`;
  }
}

// 显示酒品入库弹窗
async function showWineStockInModal() {
  const content = document.getElementById('wineStockInContent');
  content.innerHTML = `<div style="color:var(--text-muted);padding:10px">加载中...</div>`;
  openModal('modalWineStockIn');
  
  try {
    const wines = await api('GET', '/wine/catalog');
    content.innerHTML = `
      <form id="wineStockInForm" style="display:flex;flex-direction:column;gap:12px">
        <div class="form-hint" style="margin:0 0 8px">以下入库仍写入<strong>旧全局库存表</strong>（wine_inventory），与「目录」并行；分仓库存上线后将切换为按仓入库。</div>
        <div class="form-group">
          <label class="form-label">酒品（目录）<span class="required">*</span></label>
          <select class="form-control" id="wineSel" required>
            <option value="">请选择酒品</option>
            ${wines
              .map((w) => {
                const code = `cat_${w.id}`;
                const spec = wineCatalogSpecLine(w);
                const label = `${w.brand ? `${w.brand} · ` : ''}${w.name}（${spec}）`;
                return `<option value="${code}" data-name="${escapeHtml(w.name)}" data-spec="${escapeHtml(spec)}">${escapeHtml(label)}</option>`;
              })
              .join('')}
          </select>
        </div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="form-group">
            <label class="form-label">入库数量（瓶）<span class="required">*</span></label>
            <input type="number" class="form-control" id="wineQty" min="1" value="1" required>
          </div>
          <div class="form-group">
            <label class="form-label">入库日期 <span class="required">*</span></label>
            <input type="date" class="form-control" id="wineDate" value="${todayDateInputValue()}" required>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">供应商</label>
          <select class="form-control" id="wineSupplier">
            <option value="">请选择</option>
            <option value="东区">东区</option>
            <option value="南区">南区</option>
            <option value="东南区">东南区</option>
            <option value="总部培训">总部培训</option>
            <option value="其他">其他</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">备注</label>
          <input type="text" class="form-control" id="wineRemarks" placeholder="批次号/备注...">
        </div>
        <div style="padding:10px;background:var(--bg-primary);border-radius:var(--radius-sm);font-size:13px;color:var(--text-muted)">
          <i data-lucide="lightbulb" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"></i>入库后将自动更新酒品库存
        </div>
      </form>
    `;
    renderLucideIcons();
  } catch (err) {
    content.innerHTML = `<div style="color:var(--danger)">加载失败: ${err.message}</div>`;
  }
}

async function confirmWineStockIn() {
  const sel = document.getElementById('wineSel');
  const opt = sel.options[sel.selectedIndex];
  if (!sel.value) { showToast('请选择酒品', 'error'); return; }
  
  const body = {
    year_frame_id: currentYearFrameId || 1,
    wine_code: sel.value,
    wine_name: opt.dataset.name,
    spec: opt.dataset.spec,
    quantity: parseInt(document.getElementById('wineQty').value) || 0,
    stock_in_date: document.getElementById('wineDate').value,
    supplier: document.getElementById('wineSupplier').value,
    remarks: document.getElementById('wineRemarks').value,
  };
  
  if (!body.stock_in_date || !body.quantity) { showToast('请填写必填项', 'error'); return; }
  
  try {
    await api('POST', '/wine/stock-in', body);
    closeModal();
    showToast('入库成功', 'success');
    if (document.getElementById('wineCatalogListHost')) await loadWineCatalogPage();
    updateBadges();
  } catch (err) {
    showToast('入库失败: ' + err.message, 'error');
  }
}

let wineReturnDialogState = {
  usageRows: [],
  projectRows: [],
  projectToUsages: new Map(),
  projectCodeToActivityId: new Map(),
};

function renderWineReturnProjectOptions() {
  const dl = document.getElementById('wineReturnProjectList');
  if (!dl) return;
  const rows = (wineReturnDialogState.projectRows || []);
  dl.innerHTML = rows
    .map((p) => `<option value="${escapeHtml(p.project_code || `#${p.activity_id}`)}"></option>`)
    .join('');
}

function renderWineReturnUsageOptions() {
  const projectInput = document.getElementById('wineReturnProject');
  const usageSel = document.getElementById('wineUseSel');
  const maxText = document.getElementById('wineUseWarning');
  if (!projectInput || !usageSel || !maxText) return;
  const projectCode = String(projectInput.value || '').trim();
  const actId = Number(wineReturnDialogState.projectCodeToActivityId.get(projectCode) || 0);
  const rows = actId ? (wineReturnDialogState.projectToUsages.get(actId) || []) : [];
  usageSel.innerHTML = `<option value="">请选择酒品</option>` + rows
    .map((r) => `<option value="${r.id}" data-max="${r.quantity || 0}" data-wine="${escapeHtml(r.wine_name || '')}">${escapeHtml(r.wine_name || '—')} ${escapeHtml(r.spec || '')}（可归还: ${r.quantity || 0} 瓶）</option>`)
    .join('');
  if (projectCode && !actId) {
    maxText.style.display = 'block';
    maxText.textContent = '项目编号无效，请从下拉建议中选择';
    return;
  }
  maxText.style.display = 'none';
}

function updateWineReturnLimit() {
  const usageSel = document.getElementById('wineUseSel');
  const qtyInput = document.getElementById('wineUseQty');
  const maxText = document.getElementById('wineUseWarning');
  if (!usageSel || !qtyInput || !maxText) return;
  const opt = usageSel.options[usageSel.selectedIndex];
  if (!opt || !opt.value) {
    maxText.style.display = 'none';
    return;
  }
  const max = parseInt(opt.dataset.max || '0', 10) || 0;
  qtyInput.max = String(max || 1);
  if (!qtyInput.value || Number(qtyInput.value) > max) qtyInput.value = String(max || 1);
  maxText.style.display = 'block';
  maxText.textContent = `当前酒品最多可归还 ${max} 瓶`;
}

// 显示酒品归还弹窗（项目编号输入 + datalist 建议）
async function showWineUsageModal(prefillUsageId = null) {
  const content = document.getElementById('wineUsageContent');
  if (!content) {
    showToast('找不到酒品归还弹窗，请刷新页面', 'error');
    return;
  }
  content.innerHTML = `<div style="color:var(--text-muted);padding:10px">加载中...</div>`;
  openModal('modalWineUsage');
  
  try {
    const qs = currentYearFrameId ? `?year_frame_id=${currentYearFrameId}` : '';
    const [usageRows, activityRows] = await Promise.all([
      api('GET', `/wine/usage${qs}`),
      api('GET', `/activities${currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : ''}`),
    ]);
    const validUsages = (usageRows || []).filter((r) => Number(r.quantity) > 0 && Number(r.activity_id) > 0);
    const actMap = new Map((activityRows || []).map((a) => [Number(a.id), a]));
    const projectRows = [];
    const seen = new Set();
    const projectToUsages = new Map();
    const projectCodeToActivityId = new Map();
    validUsages.forEach((r) => {
      const actId = Number(r.activity_id);
      if (!projectToUsages.has(actId)) projectToUsages.set(actId, []);
      projectToUsages.get(actId).push(r);
      if (!seen.has(actId)) {
        const act = actMap.get(actId) || {};
        const code = String(act.project_code || `#${actId}`);
        projectRows.push({
          activity_id: actId,
          project_code: code,
          city: act.city || '',
          activity_type: act.activity_type || '',
        });
        projectCodeToActivityId.set(code, actId);
        seen.add(actId);
      }
    });
    wineReturnDialogState = { usageRows: validUsages, projectRows, projectToUsages, projectCodeToActivityId };

    content.innerHTML = `
      <form id="wineUsageForm" style="display:flex;flex-direction:column;gap:12px">
        <input type="hidden" id="wineUsageId" value="">
        <div class="form-group">
          <label class="form-label">项目编号 <span class="required">*</span></label>
          <input type="text" class="form-control" id="wineReturnProject" list="wineReturnProjectList" placeholder="输入关键词并从下拉建议中选择项目编号" required>
          <datalist id="wineReturnProjectList"></datalist>
        </div>
        <div class="form-group">
          <label class="form-label">酒品 <span class="required">*</span></label>
          <select class="form-control" id="wineUseSel" required>
            <option value="">请先选择项目编号</option>
          </select>
        </div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="form-group">
            <label class="form-label">归还数量（瓶）<span class="required">*</span></label>
            <input type="number" class="form-control" id="wineUseQty" min="1" value="1" required>
          </div>
          <div class="form-group">
            <label class="form-label">归还说明</label>
            <input type="text" class="form-control" id="wineUseRemarks" placeholder="如：活动剩余未开封">
          </div>
        </div>
        <div id="wineUseWarning" style="display:none;padding:10px;background:#FEF3C7;border-radius:var(--radius-sm);font-size:13px;color:#92400E">
          请先选择项目和酒品
        </div>
      </form>
    `;

    const titleEl = document.querySelector('#modalWineUsage .modal-title');
    if (titleEl) titleEl.innerHTML = '<i data-lucide="rotate-ccw" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>酒品归还';

    const projectInput = document.getElementById('wineReturnProject');
    const usageSel = document.getElementById('wineUseSel');
    const qtyInput = document.getElementById('wineUseQty');
    if (projectInput) projectInput.oninput = () => renderWineReturnUsageOptions();
    if (usageSel) usageSel.onchange = () => updateWineReturnLimit();
    if (qtyInput) qtyInput.oninput = () => updateWineReturnLimit();

    renderWineReturnProjectOptions();
    if (prefillUsageId) {
      const target = validUsages.find((r) => Number(r.id) === Number(prefillUsageId));
      if (target && projectInput && usageSel) {
        const p = projectRows.find((x) => Number(x.activity_id) === Number(target.activity_id));
        projectInput.value = p ? p.project_code : '';
        renderWineReturnUsageOptions();
        usageSel.value = String(target.id);
        updateWineReturnLimit();
      }
    }
    renderLucideIcons();
  } catch (err) {
    content.innerHTML = `<div style="color:var(--danger)">加载失败: ${err.message}</div>`;
  }
}

async function confirmWineUsage() {
  const usageId = parseInt(document.getElementById('wineUseSel')?.value || '', 10);
  const qty = parseInt(document.getElementById('wineUseQty')?.value || '', 10) || 0;
  const max = parseInt(document.getElementById('wineUseSel')?.selectedOptions?.[0]?.dataset?.max || '0', 10) || 0;
  const remarks = document.getElementById('wineUseRemarks')?.value || '';
  if (!usageId) { showToast('请选择项目下的酒品', 'error'); return; }
  if (!qty || qty < 1 || qty > max) { showToast(`归还数量需在 1-${max} 之间`, 'error'); return; }

  try {
    await api('POST', `/wine/usage/${usageId}/return`, {
      quantity: qty,
      remarks,
      operator: getCurrentUserName(),
    });
    closeModal();
    showToast('酒品归还成功', 'success');
    await loadWineInventory();
    await loadWineRecords('returns');
  } catch (err) {
    showToast(err.message || '归还失败', 'error');
  }
}

async function deleteWineStockIn(id) {
  if (!confirm('确定删除这条入库记录？删除后会回滚库存。')) return;
  try {
    try {
      await api('DELETE', `/wine/stock-in/${id}`);
    } catch (err) {
      if (!String(err?.message || '').includes('(404)')) throw err;
      // 兼容某些环境不支持 DELETE 路由
      await api('POST', `/wine/stock-in/${id}/delete`, {});
    }
    showToast('入库记录已删除并回滚库存', 'success');
    await loadWineInventory();
    await loadWineRecords('stockIn');
  } catch (err) {
    showToast(err.message || '删除入库记录失败', 'error');
  }
}

async function deleteWineReturnLog(id) {
  if (!confirm('确定删除这条归还记录？删除后会回滚库存并恢复用酒数量。')) return;
  try {
    try {
      await api('DELETE', `/wine/returns/${id}`);
    } catch (err) {
      if (!String(err?.message || '').includes('(404)')) throw err;
      await api('POST', `/wine/returns/${id}/delete`, {});
    }
    showToast('归还记录已删除并完成回滚', 'success');
    await loadWineInventory();
    await loadWineRecords('returns');
  } catch (err) {
    showToast(err.message || '删除归还记录失败', 'error');
  }
}

async function deleteWineUsage(id) {
  if (!confirm('确定删除此使用记录？库存将自动回补。')) return;
  try {
    await api('DELETE', `/wine/usage/${id}`);
    showToast('已删除，库存已回补', 'success');
    loadWineRecords('usage');
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

/* =============================================
   品牌管理
   ============================================= */
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

/* =============================================
   页面：物资模块（档案 + 出入库）
   ============================================= */
const INV_REGION_OPTS = ['东区', '南区', '北区', '东南区'];
const INV_LOGISTICS_OPTS = ['顺丰', '京东', '中通', '圆通', '物流', '其他'];
/** 与 src/routes/inventory.js 中 uploadDir、返回的 url 一致；勿删物理目录 */
const INV_ITEM_IMAGE_STORAGE_HINT = `<p class="form-hint" style="margin:0 0 8px;font-size:12px;line-height:1.45;color:var(--text-secondary)">上传文件写入项目目录 <code style="font-size:11px">public/uploads/inventory/</code>（相对仓库根目录），对外 URL 形如 <code style="font-size:11px">/uploads/inventory/文件名</code>；数据库表 <code style="font-size:11px">inv_items.image_urls</code>（JSON）存完整路径。请勿手动删除该目录内文件，否则物料卡片与 PDF 会缺图。</p>`;

async function apiInventoryUpload(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API}/inventory/upload`, { method: 'POST', credentials: 'include', body: fd });
  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    data = {};
  }
  if (!res.ok) throw new Error(data.error || data.message || '上传失败');
  return data.url;
}

function invStockClass(item) {
  const q = Number(item.quantity_on_hand || 0);
  const a = item.alert_below != null ? Number(item.alert_below) : null;
  if (q <= 0) return 'inv-stock-out';
  if (a != null && Number.isFinite(a) && q <= a) return 'inv-stock-low';
  return 'inv-stock-ok';
}

function invStockLabel(item) {
  const q = Number(item.quantity_on_hand || 0);
  const a = item.alert_below != null ? Number(item.alert_below) : null;
  if (q <= 0) return '缺货';
  if (a != null && Number.isFinite(a) && q <= a) return '低于预警';
  return '正常';
}

function invItemIsCommon(it) {
  return Number(it.is_common) === 1;
}

/** 与目录、入库行一致：名称 + 规格行，用于判断「酒」类库存行 */
function invItemWineCatalogKey(it) {
  const n = String(it.name || '').trim();
  const d = it.dimensions;
  const ds = d == null ? '' : String(d).trim();
  return `${n}\0${ds}`;
}

function invCatalogRowWineKey(c) {
  const spec = wineCatalogSpecLine(c);
  const n = String(c.name || '').trim();
  const ds = spec == null ? '' : String(spec).trim();
  return `${n}\0${ds}`;
}

function invSetItemsListFilter(mode) {
  if (mode !== 'all' && mode !== 'common' && mode !== 'uncommon' && mode !== 'wine') return;
  inventoryPageState.itemsListFilter = mode;
  try {
    localStorage.setItem('remy_invItemsListFilter', mode);
  } catch (_) { /* ignore */ }
  renderInventory();
}

function invRenderItemsListFilterBar(current) {
  const cur = current || 'all';
  const mk = (id, label) =>
    `<button type="button" class="btn btn-xs inv-items-filter-btn ${cur === id ? 'btn-primary' : 'btn-secondary'}" onclick="invSetItemsListFilter('${id}')" aria-pressed="${cur === id ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
  return `<div class="inv-items-filter-bar" role="group" aria-label="物料范围">
    ${mk('all', '全部')}
    ${mk('common', '常用')}
    ${mk('uncommon', '非常用')}
    ${mk('wine', '酒')}
  </div>`;
}

const INV_ITEMS_VIEW_MODES = [
  { id: 'cards', label: '卡片' },
  { id: 'list', label: '列表' },
  { id: 'thumbnails', label: '缩略图' },
];

/** 列表图标；卡片与缩略图共用四宫格图标 */
const INV_VIEW_LIST_ICON =
  '<svg class="inv-view-icon-svg" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="6" r="1.75"/><circle cx="5" cy="12" r="1.75"/><circle cx="5" cy="18" r="1.75"/><rect x="9" y="5" width="12" height="2" rx="0.5"/><rect x="9" y="11" width="12" height="2" rx="0.5"/><rect x="9" y="17" width="12" height="2" rx="0.5"/></svg>';
const INV_VIEW_GRID_ICON =
  '<svg class="inv-view-icon-svg" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';

function invSetItemsViewMode(mode) {
  if (!INV_ITEMS_VIEW_MODES.some((m) => m.id === mode)) return;
  inventoryPageState.itemsViewMode = mode;
  try {
    localStorage.setItem('remy_inventoryItemsViewMode', mode);
  } catch (_) { /* ignore */ }
  renderInventory();
}

/** 四宫格：在「卡片 ↔ 缩略图」间切换；当前为列表时先进入卡片 */
function invCycleGridItemsView() {
  const m = inventoryPageState.itemsViewMode || 'cards';
  if (m === 'list') {
    invSetItemsViewMode('cards');
    return;
  }
  if (m === 'cards') {
    invSetItemsViewMode('thumbnails');
    return;
  }
  if (m === 'thumbnails') {
    invSetItemsViewMode('cards');
    return;
  }
  invSetItemsViewMode('cards');
}

function invGridViewToggleTitle(mode) {
  if (mode === 'list') return '卡片视图（再点此图标可切换为缩略图）';
  if (mode === 'cards') return '当前：卡片 — 点击切换为缩略图';
  return '当前：缩略图 — 点击切换为卡片';
}

function invItemImageInnerHtml(it) {
  const u = it.image_urls && it.image_urls[0];
  if (u) return `<img src="${escapeHtml(u)}" alt="">`;
  return '<span class="inv-no-img">无图</span>';
}

function invStatQty(n) {
  if (n == null || n === '') return 0;
  if (typeof n === 'bigint') return Number(n);
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function invWarehouseBrandDisplay(w) {
  const code = String(w?.brand_code || '').trim().toUpperCase();
  const region = String(w?.region || '').trim();
  if (code === 'X.O' && (region === '北区' || region === '南区')) {
    return region;
  }
  return String(w?.brand_code || '').trim();
}

function invReorderWarehouseCards(warehouses) {
  const arr = Array.isArray(warehouses) ? warehouses.slice() : [];
  const northIdx = arr.findIndex((w) => String(w?.region || '') === '北区');
  const clubEastIdx = arr.findIndex(
    (w) => String(w?.brand_code || '').toUpperCase() === 'CLUB' && String(w?.region || '') === '东区',
  );
  if (northIdx >= 0 && clubEastIdx >= 0 && northIdx !== clubEastIdx) {
    const tmp = arr[northIdx];
    arr[northIdx] = arr[clubEastIdx];
    arr[clubEastIdx] = tmp;
  }
  return arr;
}

function invRenderWarehouseCardsHtml(warehouses, selectedId) {
  if (!warehouses.length) {
    return '<div class="empty-state inv-wh-cards-empty">暂无仓库。请由管理员在数据库或迁移脚本中维护仓库。</div>';
  }
  const orderedWarehouses = invReorderWarehouseCards(warehouses);
  const sid = selectedId != null ? Number(selectedId) : null;
  return `
    <div class="inv-warehouse-cards" role="list" aria-label="选择仓库">
      ${orderedWarehouses
        .map((w) => {
          const active = sid != null && Number(w.id) === sid;
          const label = w.label ? `<div class="inv-wh-card-label">${escapeHtml(w.label)}</div>` : '';
          return `
        <button type="button" class="inv-wh-card ${active ? 'active' : ''}" data-wh-id="${w.id}" onclick="invSelectWarehouse(${w.id})" role="listitem">
          <div class="inv-wh-card-brand">${escapeHtml(invWarehouseBrandDisplay(w))}</div>
          <div class="inv-wh-card-region">${escapeHtml(w.region)}</div>
          ${label}
        </button>`;
        })
        .join('')}
    </div>`;
}

/** 库存管理页：四仓 + 酒品目录 + 物品目录 + 空瓶回收（与仓库同排） */
function invRenderStockMasterCardsHtml(warehouses, selectedWarehouseId, stockMasterView) {
  const orderedWarehouses = invReorderWarehouseCards(warehouses);
  const smv =
    stockMasterView === 'wine'
      ? 'wine'
      : stockMasterView === 'empty'
        ? 'empty'
        : stockMasterView === 'item-catalog'
          ? 'item-catalog'
          : 'warehouse';
  const sid = selectedWarehouseId != null ? Number(selectedWarehouseId) : null;
  const whButtons =
    orderedWarehouses.length === 0
      ? ''
      : orderedWarehouses
          .map((w) => {
            const active = smv === 'warehouse' && sid != null && Number(w.id) === sid;
            const label = w.label ? `<div class="inv-wh-card-label">${escapeHtml(w.label)}</div>` : '';
            return `
        <button type="button" class="inv-wh-card ${active ? 'active' : ''}" data-wh-id="${w.id}" onclick="invSelectWarehouse(${w.id})" role="listitem">
          <div class="inv-wh-card-brand">${escapeHtml(invWarehouseBrandDisplay(w))}</div>
          <div class="inv-wh-card-region">${escapeHtml(w.region)}</div>
          ${label}
        </button>`;
          })
          .join('');
  const wineActive = smv === 'wine';
  const wineCard = `
        <button type="button" class="inv-wh-card inv-wh-card-wine ${wineActive ? 'active' : ''}" onclick="invSelectStockMasterView('wine')" role="listitem" title="酒品目录（全局主数据）">
          <div class="inv-wh-card-brand">酒品目录</div>
          <div class="inv-wh-card-region">品牌 · 规格 · 图片</div>
          <div class="inv-wh-card-label" id="badge-wine-catalog">—</div>
        </button>`;
  const itemCatalogActive = smv === 'item-catalog';
  const itemCatalogCard = `
        <button type="button" class="inv-wh-card inv-wh-card-item-catalog ${itemCatalogActive ? 'active' : ''}" onclick="invSelectStockMasterView('item-catalog')" role="listitem" title="物品目录（全局主数据）">
          <div class="inv-wh-card-brand">物品目录</div>
          <div class="inv-wh-card-region">物料主数据</div>
          <div class="inv-wh-card-label" id="badge-item-catalog">—</div>
        </button>`;
  const emptyActive = smv === 'empty';
  const emptyCard = `
        <button type="button" class="inv-wh-card inv-wh-card-empty ${emptyActive ? 'active' : ''}" onclick="invSelectStockMasterView('empty')" role="listitem" title="各仓库空瓶回收库存">
          <div class="inv-wh-card-brand">空瓶回收</div>
          <div class="inv-wh-card-region">按仓查看 · 结算</div>
          <div class="inv-wh-card-label" aria-hidden="true">&nbsp;</div>
        </button>`;
  if (!orderedWarehouses.length) {
    return `
    <div class="inv-warehouse-cards" role="list" aria-label="选择酒品目录或空瓶回收">
      ${wineCard}
      ${itemCatalogCard}
      ${emptyCard}
    </div>`;
  }
  return `
    <div class="inv-warehouse-cards" role="list" aria-label="选择仓库、酒品目录或空瓶回收">
      ${whButtons}
      ${wineCard}
      ${itemCatalogCard}
      ${emptyCard}
    </div>`;
}

function invSelectStockMasterView(mode) {
  if (mode !== 'wine' && mode !== 'empty' && mode !== 'item-catalog') return;
  inventoryPageState.stockMasterView = mode;
  try {
    localStorage.setItem('remy_stockMasterView', mode);
  } catch (_) { /* ignore */ }
  renderInventory();
}

function invSelectWarehouse(warehouseId) {
  const id = parseInt(warehouseId, 10);
  if (!Number.isFinite(id)) return;
  inventoryPageState.stockMasterView = 'warehouse';
  try {
    localStorage.setItem('remy_stockMasterView', 'warehouse');
  } catch (_) { /* ignore */ }
  inventoryPageState.warehouseId = id;
  inventoryPageState.outboundLines = [];
  renderInventory();
}

function invItemActionsHtml(it) {
  return `<span class="inv-item-actions">
    <button type="button" class="btn btn-xs btn-secondary inv-admin-only" onclick="event.stopPropagation();invOpenEditItem(${it.id})">编辑</button>
    <button type="button" class="btn btn-xs btn-ghost inv-admin-only" onclick="event.stopPropagation();invToggleItemCommon(${it.id}, ${invItemIsCommon(it) ? 0 : 1})" title="常用物料会在新建出库时优先列出">${invItemIsCommon(it) ? '取消常用' : '设为常用'}</button>
    <button type="button" class="btn btn-xs btn-ghost inv-admin-only" onclick="event.stopPropagation();invDeleteItem(${it.id})">删除</button>
  </span>`;
}

function invRenderItemsPanel(items, viewMode) {
  const mode = viewMode || inventoryPageState.itemsViewMode || 'cards';
  if (!items.length) {
    return '<div class="empty-state inv-items-empty">暂无物料，请先添加或切换仓库</div>';
  }

  if (mode === 'list') {
    const rows = items
      .map((it) => {
        const commonBadge = invItemIsCommon(it) ? '<span class="inv-badge-common">常用</span>' : '';
        const to = invStatQty(it.total_outbound);
        const tdmg = invStatQty(it.total_damaged);
        const tlost = invStatQty(it.total_lost);
        return `<tr class="inv-item-clickable-row" data-item-id="${it.id}" onclick="invOpenItemDetail(${it.id})">
          <td class="inv-items-col-thumb"><div class="inv-list-thumb">${invItemImageInnerHtml(it)}</div></td>
          <td class="inv-items-col-name">
            <div class="inv-list-name">${escapeHtml(it.name)} ${commonBadge}</div>
          </td>
          <td class="inv-items-col-spec">${escapeHtml(it.dimensions || '—')}</td>
          <td class="inv-items-col-stat" title="归还登记中损坏合计">${tdmg}</td>
          <td class="inv-items-col-stat" title="归还登记中丢失合计">${tlost}</td>
          <td class="inv-items-col-stat" title="该物品在本仓库累计出库数量">${to}</td>
          <td class="inv-items-col-qty"><span class="${invStockClass(it)}">${it.quantity_on_hand} <span class="inv-stock-hint">(${invStockLabel(it)})</span></span></td>
          <td class="inv-items-col-actions">${invItemActionsHtml(it)}</td>
        </tr>`;
      })
      .join('');
    return `
      <div class="table-wrapper inv-items-table-wrap">
        <table class="data-table inv-items-list-table">
          <thead>
            <tr>
              <th class="inv-items-col-thumb">图片</th>
              <th class="inv-items-col-name">物品名称</th>
              <th class="inv-items-col-spec">规格</th>
              <th class="inv-items-col-stat" title="归还登记中损坏数量合计">损坏</th>
              <th class="inv-items-col-stat" title="归还登记中丢失数量合计">丢失</th>
              <th class="inv-items-col-stat" title="各出库单中该物料数量之和，与当前库存、丢失覆盖无关">累计出库</th>
              <th class="inv-items-col-qty">库存</th>
              <th class="inv-items-col-actions">操作</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  if (mode === 'thumbnails') {
    const tiles = items
      .map((it) => {
        const commonBadge = invItemIsCommon(it) ? '<span class="inv-badge-common">常用</span>' : '';
        return `
        <div class="inv-thumb-tile inv-item-clickable-card" data-item-id="${it.id}" onclick="invOpenItemDetail(${it.id})">
          <div class="inv-thumb-tile-img">${invItemImageInnerHtml(it)}</div>
          <div class="inv-thumb-tile-body">
            <div class="inv-thumb-tile-title">${escapeHtml(it.name)} ${commonBadge}</div>
            <div class="inv-thumb-tile-meta">
              <span class="${invStockClass(it)}">库存 ${it.quantity_on_hand}</span>
              ${invItemActionsHtml(it)}
            </div>
          </div>
        </div>`;
      })
      .join('');
    return `<div class="inv-thumb-grid">${tiles}</div>`;
  }

  /* cards (default) */
  return `
    <div class="inv-card-grid">
      ${items
        .map((it) => {
          const img = (it.image_urls && it.image_urls[0]) ? `<img src="${escapeHtml(it.image_urls[0])}" alt="">` : '<span style="color:var(--text-muted);font-size:12px">无图</span>';
          const commonBadge = invItemIsCommon(it) ? '<span class="inv-badge-common">常用</span>' : '';
          return `
          <div class="inv-item-card inv-item-clickable-card" data-item-id="${it.id}" onclick="invOpenItemDetail(${it.id})">
            <div class="inv-item-card-img">${img}</div>
            <div style="padding:12px">
              <div style="font-weight:700;font-size:14px;margin-bottom:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">${escapeHtml(it.name)} ${commonBadge}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${escapeHtml(it.dimensions || '—')} ｜ ${escapeHtml((it.description || '').slice(0, 80))}${(it.description || '').length > 80 ? '…' : ''}</div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                <span class="${invStockClass(it)}">库存 ${it.quantity_on_hand} <span style="font-size:11px;font-weight:500">(${invStockLabel(it)})</span></span>
                ${invItemActionsHtml(it)}
              </div>
            </div>
          </div>`;
        })
        .join('')}
    </div>`;
}

/** 空瓶回收：按仓库分区，仅展示名称与库存；点击名称查看追溯（不做物料卡片/编辑） */
function invRenderEmptyBottleWarehouseSections(groups) {
  const arr = Array.isArray(groups) ? groups : [];
  if (!arr.length) {
    return '<div class="inv-empty-bottle-root"><div class="empty-state">暂无空瓶回收数据</div></div>';
  }
  const total = arr.reduce((s, g) => s + (parseInt(g.total_empty_bottles, 10) || 0), 0);
  return `
    <div class="inv-empty-bottle-root">
      <p class="form-hint inv-empty-bottle-lead">按仓库查看空瓶名称与当前库存；点击名称可查看<strong>项目编号、回收时间（入库登记时间）、数量</strong>追溯明细。各仓合计：<strong>${total}</strong></p>
      ${arr
        .map((g) => {
          const whLabel = `${g.brand_code || ''} · ${g.region || ''}`;
          const rows = Array.isArray(g.rows) ? g.rows : [];
          const sub = parseInt(g.total_empty_bottles, 10) || 0;
          const rowsHtml = rows.length
            ? rows
                .map(
                  (r) => `
            <button type="button" class="inv-empty-bottle-name-row" onclick="invOpenEmptyBottleTraceModal(${Number(r.item_id)})">
              <span class="inv-empty-bottle-name">${escapeHtml(r.name || '')}</span>
              <span class="inv-empty-bottle-qty">库存 <strong>${parseInt(r.quantity_on_hand, 10) || 0}</strong></span>
              <span class="inv-empty-bottle-go" aria-hidden="true">追溯 →</span>
            </button>`,
                )
                .join('')
            : '<div class="empty-state inv-empty-bottle-wh-empty">该仓库暂无空瓶物料</div>';
          return `
        <section class="inv-empty-bottle-wh-section">
          <div class="inv-empty-bottle-wh-head">
            <h3 class="inv-empty-bottle-wh-title">${escapeHtml(whLabel)}</h3>
            <span class="form-hint" style="margin:0">小计 ${sub}</span>
          </div>
          <div class="inv-empty-bottle-wh-body">${rowsHtml}</div>
        </section>`;
        })
        .join('')}
    </div>`;
}

async function invOpenEmptyBottleTraceModal(itemId) {
  const id = parseInt(itemId, 10);
  if (!Number.isFinite(id) || id <= 0) return;
  const body = document.getElementById('modalInvEmptyBottleBody');
  const title = document.getElementById('modalInvEmptyBottleTitle');
  if (!body) return;
  if (title) title.textContent = '空瓶回收追溯';
  body.innerHTML = '<div class="empty-state">加载中...</div>';
  openModal('modalInvEmptyBottleTrace');
  try {
    const data = await api('GET', `/inventory/empty-bottles/items/${id}/trace`);
    const it = data.item || {};
    if (title) title.textContent = it.name ? `空瓶追溯 · ${it.name}` : '空瓶回收追溯';
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const tableRows = lines
      .map((ln) => {
        const time = ln.inbound_recorded_at
          ? String(ln.inbound_recorded_at).slice(0, 19).replace('T', ' ')
          : '—';
        const proj = escapeHtml(ln.display_main || '—');
        const sub = ln.display_sub
          ? `<div class="form-hint" style="margin-top:4px">${escapeHtml(ln.display_sub)}</div>`
          : '';
        const src =
          ln.source_material_name && String(ln.source_material_name).trim()
            ? `<div class="form-hint" style="margin-top:4px">来源出库物料：${escapeHtml(String(ln.source_material_name).trim())}</div>`
            : '';
        return `<tr>
        <td>${proj}${sub}${src}</td>
        <td>${time}</td>
        <td>${ln.qty_empty_recovered != null ? escapeHtml(String(ln.qty_empty_recovered)) : '0'}</td>
      </tr>`;
      })
      .join('');
    body.innerHTML = `
      <p class="form-hint" style="margin-top:0;margin-bottom:12px">回收时间为<strong>提交入库登记</strong>时的系统时间（与「物品入库」台账一致）。</p>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>项目编号 / 关联</th><th>回收时间（入库登记）</th><th>空瓶数量</th></tr></thead>
          <tbody>${
            lines.length
              ? tableRows
              : '<tr><td colspan="3" style="color:var(--text-muted);padding:16px;text-align:center">暂无回收登记明细（历史数据可能仅能通过物料名称关联）</td></tr>'
          }</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    body.innerHTML = `<div class="empty-state" style="color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
  renderLucideIcons();
}

/** 兼容旧入口：空瓶回收已并入「库存管理」与仓库同排卡片 */
async function renderEmptyBottleRecovery() {
  navigate('inv-empty');
}

async function invOpenItemDetail(itemId) {
  const id = parseInt(itemId, 10);
  if (!Number.isFinite(id) || id <= 0) return;
  const body = document.getElementById('invItemDetailModalBody');
  const title = document.getElementById('invItemDetailTitle');
  if (!body) return;
  if (title) title.textContent = '物品详情';
  body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">加载中...</div>';
  openModal('modalInvItemDetail');
  try {
    const it = await api('GET', `/inventory/items/${id}`);
    const urls = Array.isArray(it.image_urls) ? it.image_urls.filter(Boolean) : [];
    // 控制弹窗高度：主图用固定高度，减少滚动查阅
    const main = urls[0]
      ? `<img src="${escapeHtml(urls[0])}" alt="" style="width:240px;max-width:100%;height:155px;object-fit:contain;object-position:center;border-radius:8px;background:var(--bg-secondary);border:1px solid var(--border)">`
      : `<div style="width:240px;max-width:100%;height:155px;border-radius:8px;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;color:var(--text-muted);border:1px solid var(--border)">暂无图片</div>`;
    const thumbs =
      urls.length > 1
        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;max-width:240px;max-height:86px;overflow:hidden">
            ${urls
              .slice(1, 9)
              .map(
                (u) =>
                  `<img src="${escapeHtml(u)}" alt="" style="width:46px;height:46px;object-fit:contain;object-position:center;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary)">`,
              )
              .join('')}
          </div>`
        : '';
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:280px 1fr;gap:12px;align-items:start">
        <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start">
          ${main}${thumbs}
        </div>
        <div style="display:grid;grid-template-columns:96px 1fr;gap:7px 12px;font-size:13px;line-height:1.55">
          <div style="color:var(--text-muted)">名称</div><div style="font-weight:700">${escapeHtml(it.name || '—')}</div>
          <div style="color:var(--text-muted)">规格</div><div>${escapeHtml(it.dimensions || '—')}</div>
          <div style="color:var(--text-muted)">库存</div><div><span class="${invStockClass(it)}">${escapeHtml(String(it.quantity_on_hand ?? 0))}</span></div>
          <div style="color:var(--text-muted)">累计出库</div><div>${escapeHtml(String(invStatQty(it.total_outbound)))}</div>
          <div style="color:var(--text-muted)">损坏 / 丢失</div><div>${escapeHtml(String(invStatQty(it.total_damaged)))} / ${escapeHtml(String(invStatQty(it.total_lost)))}</div>
          <div style="color:var(--text-muted)">备注</div><div style="word-break:break-word">${escapeHtml(it.description || '—')}</div>
        </div>
      </div>
    `;
    if (title) title.textContent = it.name ? `物品详情 · ${it.name}` : '物品详情';
  } catch (e) {
    body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

function invMergeOutboundLines(parts) {
  const m = new Map();
  for (const l of parts) {
    const id = l.item_id;
    if (!id || !Number.isFinite(id)) continue;
    const qty = Math.max(0, parseInt(l.quantity, 10) || 0);
    if (qty < 1) continue;
    const note = String(l.line_note || '').trim();
    const prev = m.get(id);
    if (!prev) {
      m.set(id, { item_id: id, quantity: qty, line_note: note || null });
    } else {
      prev.quantity += qty;
      const merged = [prev.line_note, note].filter(Boolean).join('；');
      prev.line_note = merged || null;
    }
  }
  return [...m.values()];
}

function invCollectCommonOutboundLines() {
  const lines = [];
  const rows = document.querySelectorAll('[data-inv-common-row]');
  rows.forEach((row) => {
    const id = parseInt(row.getAttribute('data-item-id'), 10);
    if (!Number.isFinite(id)) return;
    const ck = document.getElementById(`invCommonCk_${id}`);
    const qtyEl = document.getElementById(`invCommonQty_${id}`);
    const noteEl = document.getElementById(`invCommonNote_${id}`);
    if (!ck || !ck.checked) return;
    const qty = Math.max(0, parseInt(qtyEl && qtyEl.value, 10) || 0);
    if (qty < 1) return;
    const note = noteEl && noteEl.value ? String(noteEl.value).trim() : '';
    lines.push({ item_id: id, quantity: qty, line_note: note || null });
  });
  return lines;
}

/** 在重绘物资页面前调用：若当前 DOM 仍是「新建出库」表单，把已填内容写入 outboundForm，避免整页替换后丢失 */
function invCaptureOutboundDraft() {
  if (!document.getElementById('invLinkMode')) return;
  const g = (id) => document.getElementById(id);
  const of = inventoryPageState.outboundForm;
  of.linkMode = g('invLinkMode')?.value || of.linkMode || 'activity';
  of.project_code = g('invProjectCode')?.value ?? '';
  of.purpose = g('invPurpose')?.value ?? '';
  of.activity_id = g('invActivityId')?.value ?? '';
  of.recipient_city = g('invRecvCity')?.value ?? '';
  of.recipient_address = g('invRecvAddr')?.value ?? '';
  of.contact_name = g('invContactName')?.value ?? '';
  of.contact_phone = g('invContactPhone')?.value ?? '';
  of.logistics_method = g('invLogistics')?.value || of.logistics_method || INV_LOGISTICS_OPTS[0];
  of.tracking_number = g('invTrackingNo')?.value ?? '';
  of.remarks = g('invObRemarks')?.value ?? '';
  of.hint_msg = g('invHintMsg')?.textContent ?? '';
  inventoryPageState.linkMode = of.linkMode;
}

function invEnsureTabForPage(invPage) {
  if (invPage === 'master') {
    inventoryPageState.tab = 'items';
  } else if (invPage === 'outbound') {
    inventoryPageState.tab = 'outbound';
  } else if (invPage === 'inbound') {
    inventoryPageState.tab = 'returns';
  }
}

async function invFillInvProjectDatalist() {
  if (!currentYearFrameId) return;
  try {
    const actList = await api('GET', `/activities?yearFrameId=${currentYearFrameId}&isVirtual=0`);
    invSetOutboundProjectOptions(actList);
  } catch (_) { /* ignore */ }
}

function invSetOutboundProjectOptions(actList) {
  const seen = new Set();
  const vals = Array.isArray(actList)
    ? actList
      .map((a) => String(a && a.project_code ? a.project_code : '').trim())
      .filter((v) => {
        if (!v || seen.has(v)) return false;
        seen.add(v);
        return true;
      })
    : [];
  inventoryPageState.outboundProjectOptions = vals;
  invRenderProjectSuggestionList(document.getElementById('invProjectCode')?.value || '');
}

function invRenderProjectSuggestionList(keyword) {
  const menu = document.getElementById('invProjectMenu');
  if (!menu) return;
  const q = String(keyword || '').trim().toLowerCase();
  const all = Array.isArray(inventoryPageState.outboundProjectOptions) ? inventoryPageState.outboundProjectOptions : [];
  const list = q ? all.filter((v) => v.toLowerCase().includes(q)) : all;
  const shown = list.slice(0, 80);
  if (!shown.length) {
    menu.innerHTML = '<div class="inv-project-menu-empty">无匹配项目编号</div>';
    return;
  }
  menu.innerHTML = shown
    .map((v) => `<button type="button" class="inv-project-option" data-value="${escapeHtml(v)}" onclick="invPickProjectSuggestionFromBtn(this)">${escapeHtml(v)}</button>`)
    .join('');
}

function invOpenProjectSuggestionList() {
  const menu = document.getElementById('invProjectMenu');
  if (!menu) return;
  if (!inventoryPageState.outboundProjectMenuBound) {
    document.addEventListener('click', (evt) => {
      const target = evt && evt.target;
      if (!target) return;
      const wrap = document.querySelector('.inv-project-combobox');
      if (!wrap) return;
      if (!wrap.contains(target)) invCloseProjectSuggestionList();
    });
    inventoryPageState.outboundProjectMenuBound = true;
  }
  invRenderProjectSuggestionList(document.getElementById('invProjectCode')?.value || '');
  menu.style.display = 'block';
}

function invCloseProjectSuggestionList() {
  const menu = document.getElementById('invProjectMenu');
  if (menu) menu.style.display = 'none';
}

function invToggleProjectSuggestionList() {
  const menu = document.getElementById('invProjectMenu');
  if (!menu) return;
  if (menu.style.display === 'block') invCloseProjectSuggestionList();
  else invOpenProjectSuggestionList();
}

function invOnProjectInput(value) {
  invOpenProjectSuggestionList();
  invRenderProjectSuggestionList(value);
}

function invOnProjectInputBlur() {
  // Delay close slightly so clicking suggestion options still works.
  window.setTimeout(() => {
    const wrap = document.querySelector('.inv-project-combobox');
    const active = document.activeElement;
    if (!wrap || !active || !wrap.contains(active)) invCloseProjectSuggestionList();
  }, 120);
}

function invHandleProjectInputKeydown(e) {
  if (!e) return;
  if (e.key === 'Escape') {
    invCloseProjectSuggestionList();
    return;
  }
  if (e.key === 'Enter') {
    const first = document.querySelector('#invProjectMenu .inv-project-option');
    if (first) {
      e.preventDefault();
      first.click();
    }
  }
}

function invPickProjectSuggestionFromBtn(btn) {
  const val = btn ? String(btn.getAttribute('data-value') || '').trim() : '';
  const input = document.getElementById('invProjectCode');
  if (!input) return;
  input.value = val;
  inventoryPageState.outboundForm.project_code = val;
  invCloseProjectSuggestionList();
  void invApplyProjectHint();
}

function invSeedOutboundItemMetaFromItems(warehouseId, items) {
  const whNum = Number(warehouseId || 0);
  if (!whNum || !Array.isArray(items)) return;
  inventoryPageState.outboundItemMetaByWarehouse[whNum] =
    inventoryPageState.outboundItemMetaByWarehouse[whNum] || {};
  items.forEach((it) => {
    if (!it || it.id == null) return;
    inventoryPageState.outboundItemMetaByWarehouse[whNum][String(it.id)] = {
      name: it.name || '',
      dimensions: it.dimensions || '',
    };
  });
}

function invSetOutboundListFilter(mode) {
  if (mode !== 'common' && mode !== 'uncommon') return;
  invSaveCurrentWarehouseDraftFromModal();
  inventoryPageState.outboundListFilter = mode;
  const b1 = document.getElementById('invObFilterCommon');
  const b2 = document.getElementById('invObFilterUncommon');
  if (b1) {
    b1.classList.toggle('btn-primary', mode === 'common');
    b1.classList.toggle('btn-secondary', mode !== 'common');
  }
  if (b2) {
    b2.classList.toggle('btn-primary', mode === 'uncommon');
    b2.classList.toggle('btn-secondary', mode !== 'uncommon');
  }
  void invRefreshOutboundModalLineTables();
}

function invBuildCommonRowsHtml(items, preset) {
  const P = preset || {};
  const whId = Number(inventoryPageState.warehouseId || 0);
  const key = String(whId || 'global');
  const q = String((inventoryPageState.outboundCommonSearchByWarehouse || {})[key] || '').trim().toLowerCase();
  const listFilter = inventoryPageState.outboundListFilter || 'common';
  const poolRaw = Array.isArray(items) ? items.slice() : [];
  let pool = poolRaw;
  if (listFilter === 'common') pool = poolRaw.filter(invItemIsCommon);
  else if (listFilter === 'uncommon') pool = poolRaw.filter((it) => !invItemIsCommon(it));

  let sortedPool;
  if (listFilter === 'common') {
    const orderIdsStored = ((inventoryPageState.outboundCommonOrderByWarehouse || {})[key] || [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));
    const allCommonIds = pool.map((it) => Number(it.id));
    const orderIds = [...orderIdsStored.filter((id) => allCommonIds.includes(id)), ...allCommonIds.filter((id) => !orderIdsStored.includes(id))];
    inventoryPageState.outboundCommonOrderByWarehouse[key] = orderIds;
    const rank = new Map(orderIds.map((id, idx) => [id, idx]));
    sortedPool = pool.slice().sort((a, b) => {
      const ra = rank.has(Number(a.id)) ? rank.get(Number(a.id)) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(Number(b.id)) ? rank.get(Number(b.id)) : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
    });
  } else {
    sortedPool = pool.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
  }

  const filteredItems = sortedPool.filter((it) => {
    if (!q) return true;
    const text = `${it.name || ''} ${it.dimensions || ''}`.toLowerCase();
    return text.includes(q);
  });

  if (!filteredItems.length) {
    const emptyMsg =
      listFilter === 'common'
        ? '暂无常用物料。可切换到「非常用」或请管理员将物料设为常用。'
        : listFilter === 'uncommon'
          ? '暂无非常用物料。可切换到「常用」查看常用列表。'
          : '暂无物料。';
    return `<tr><td colspan="6" style="color:var(--text-muted);font-size:13px">${emptyMsg}</td></tr>`;
  }
  return filteredItems
    .map((it) => {
      const id = it.id;
      const p = P[id] != null ? P[id] : P[String(id)];
      const qty = p && p.quantity != null ? Math.max(0, parseInt(p.quantity, 10) || 0) : 0;
      const checked = qty > 0;
      const note = p && p.line_note != null ? String(p.line_note) : '';
      return `
        <tr data-inv-common-row data-item-id="${id}" draggable="true" ondragstart="invCommonDragStart(event, ${id})" ondragover="invCommonDragOver(event)" ondrop="invCommonDrop(event, ${id})" ondragend="invCommonDragEnd(event)">
          <td class="inv-ob-col-select">
            <div class="inv-common-select-wrap">
              <input type="checkbox" id="invCommonCk_${id}" class="inv-outbound-common-ck" ${checked ? 'checked' : ''} onchange="invOnOutboundCommonCk(${id})">
            </div>
          </td>
          <td class="inv-ob-col-material">
            <div class="inv-ob-name-block">
              <div class="inv-ob-name-line">
                <span class="inv-ob-name-text">${escapeHtml(it.name)}</span>
              </div>
              <div class="inv-ob-name-dim">${escapeHtml((it.dimensions || '—').slice(0, 40))}</div>
            </div>
          </td>
          <td class="inv-ob-col-stock ${invStockClass(it)}">${it.quantity_on_hand}</td>
          <td class="inv-ob-col-qty">
            <input type="number" class="form-control form-control-sm" id="invCommonQty_${id}" min="0" step="1" value="${qty}" placeholder="0" onchange="invOnOutboundCommonQty(${id})">
          </td>
          <td class="inv-ob-col-note"><input type="text" class="form-control form-control-sm" id="invCommonNote_${id}" placeholder="行备注" value="${escapeHtml(note)}" oninput="invOnOutboundCommonNote(${id})"></td>
          <td class="inv-ob-col-sort"><span class="inv-common-drag-handle" title="按住拖动排序">···</span></td>
        </tr>`;
    })
    .join('');
}

function invBuildSelectedOutboundPreviewHtml() {
  const whMap = new Map((inventoryPageState.outboundWarehousesCache || []).map((w) => [Number(w.id), w]));
  const rows = [];
  Object.keys(inventoryPageState.outboundCommonByWarehouse || {}).forEach((k) => {
    const wid = Number(k);
    if (!Number.isFinite(wid)) return;
    const wh = whMap.get(wid);
    const preset = inventoryPageState.outboundCommonByWarehouse[wid] || {};
    Object.entries(preset).forEach(([itemId, p]) => {
      const qty = p && p.checked ? Math.max(0, parseInt(p.quantity, 10) || 0) : 0;
      if (qty < 1) return;
      const idKey = String(itemId);
      const meta =
        inventoryPageState.outboundItemMetaByWarehouse?.[wid]?.[idKey] ||
        inventoryPageState.outboundItemMetaByWarehouse?.[wid]?.[itemId] ||
        {};
      rows.push({
        warehouse: wh ? `${invWarehouseBrandDisplay(wh)} · ${wh.region}` : `仓库#${wid}`,
        name: meta.name || `物料#${idKey}`,
        dimensions: meta.dimensions || '—',
        quantity: qty,
        note: p && p.line_note ? String(p.line_note).trim() : '',
      });
    });
  });
  if (!rows.length) {
    return '<div class="empty-state" style="margin:0">暂未选择物品。请在左侧勾选并填写数量。</div>';
  }
  return `
    <div class="table-wrapper inv-ob-preview-table-wrap">
      <table class="data-table inv-outbound-table inv-ob-preview-table">
        <thead><tr><th>仓库</th><th>物料</th><th>规格</th><th style="width:84px">数量</th><th>备注</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>
                <td>${escapeHtml(row.warehouse)}</td>
                <td>${escapeHtml(row.name)}</td>
                <td>${escapeHtml(row.dimensions)}</td>
                <td>${row.quantity}</td>
                <td>${escapeHtml(row.note || '—')}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function invBuildExtraLineRowsHtml(items, lines) {
  const byId = new Map(items.map((it) => [String(it.id), it]));
  const itemDisplay = (it) => `${it.name} [#${it.id}] (余${it.quantity_on_hand})`;
  const selectedDisplay = (selId) => {
    const it = byId.get(String(selId || ''));
    return it ? itemDisplay(it) : '';
  };
  return lines
    .map(
      (ln, idx) => `
      <tr>
        <td>
          <input type="text" class="form-control form-control-sm" data-idx="${idx}" list="invExtraItemList" placeholder="输入关键词并下拉选择物料" value="${escapeHtml(selectedDisplay(ln.item_id))}" onchange="invPatchOutboundLineByDisplay(${idx}, this.value)">
        </td>
        <td style="width:88px"><input type="number" class="form-control form-control-sm" min="1" step="1" value="${ln.quantity || 1}" onchange="invPatchOutboundLine(${idx},'quantity',this.value)"></td>
        <td><input type="text" class="form-control form-control-sm" placeholder="说明" value="${escapeHtml(ln.line_note || '')}" onchange="invPatchOutboundLine(${idx},'line_note',this.value)"></td>
        <td style="width:56px"><button type="button" class="btn btn-xs btn-ghost" onclick="invRemoveOutboundRow(${idx})">删</button></td>
      </tr>`,
    )
    .join('');
}

function invBuildOutboundModalMarkup(warehouses, items, of, modalOpts) {
  modalOpts = modalOpts || {};
  invSeedOutboundItemMetaFromItems(inventoryPageState.warehouseId, items);
  const commonPreset =
    modalOpts.commonPreset != null ? modalOpts.commonPreset : inventoryPageState.outboundEditCommonPreset;
  const commonRows = invBuildCommonRowsHtml(items, commonPreset);
  const editOrderId = modalOpts.editOrderId;
  const submitLabel = editOrderId ? '保存修改' : '确认出库';
  const whButtons = `
    <div class="inv-ob-warehouse-buttons">
      ${warehouses
        .map(
          (w) => `<button type="button" class="btn btn-sm inv-ob-wh-btn ${w.id === inventoryPageState.warehouseId ? 'btn-primary' : 'btn-secondary'}" data-wh-id="${w.id}" onclick="invOnModalWarehouseChange(${w.id})">${escapeHtml(invWarehouseBrandDisplay(w))} · ${escapeHtml(w.region)}</button>`,
        )
        .join('')}
    </div>`;
  const linkMode = of.linkMode === 'standalone' ? 'standalone' : 'activity';
  const whKey = String(Number(inventoryPageState.warehouseId || 0) || 'global');
  const commonSearch = String((inventoryPageState.outboundCommonSearchByWarehouse || {})[whKey] || '');
  const listFlt = inventoryPageState.outboundListFilter || 'common';
  const hintMsg = String(of.hint_msg || '').trim();
  const selectedPreview = invBuildSelectedOutboundPreviewHtml();
  return `
    <div class="inv-ob-modal-form">
      <input type="hidden" id="invOutboundEditOrderId" value="${editOrderId ? String(editOrderId) : ''}">
      <input type="hidden" id="invWarehouseSelect" value="${inventoryPageState.warehouseId || ''}">
      <div class="inv-ob-layout">
        <section class="inv-ob-pane inv-ob-pane-left">
          <div class="inv-ob-pane-card">
            <div class="inv-ob-wh-row">
              <h4 class="inv-ob-pane-title inv-ob-wh-title">仓库</h4>
              ${whButtons}
            </div>
            <div class="inv-ob-items-toolbar">
              <div class="inv-ob-filter-btns" role="group" aria-label="常用筛选">
                <button type="button" id="invObFilterCommon" class="btn btn-xs ${listFlt === 'common' ? 'btn-primary' : 'btn-secondary'}" onclick="invSetOutboundListFilter('common')">常用</button>
                <button type="button" id="invObFilterUncommon" class="btn btn-xs ${listFlt === 'uncommon' ? 'btn-primary' : 'btn-secondary'}" onclick="invSetOutboundListFilter('uncommon')">非常用</button>
              </div>
              <input type="text" class="form-control form-control-sm inv-ob-search-inline" id="invCommonSearch" placeholder="搜索名称/规格" value="${escapeHtml(commonSearch)}" oninput="invOnCommonSearchInput(this.value)">
            </div>
            <div class="table-wrapper inv-outbound-table-wrap inv-ob-items-table-wrap">
              <table class="data-table inv-outbound-table">
                <thead><tr><th class="inv-ob-col-select">选</th><th class="inv-ob-col-material">物料</th><th class="inv-ob-col-stock">库存</th><th class="inv-ob-col-qty">数量</th><th class="inv-ob-col-note">备注</th><th class="inv-ob-col-sort">序</th></tr></thead>
                <tbody id="invObCommonTbody">${commonRows}</tbody>
              </table>
            </div>
          </div>
        </section>

        <section class="inv-ob-pane inv-ob-pane-right">
          <div class="inv-ob-pane-card inv-ob-pane-top">
            <h4 class="inv-ob-pane-title">出库单基本信息</h4>
            <div class="inv-ob-modal-row">
              <div class="form-group inv-ob-field-short inv-ob-field-purpose">
                <label class="form-label">用途</label>
                <select class="form-control" id="invLinkMode" onchange="inventoryPageState.linkMode=this.value;inventoryPageState.outboundForm.linkMode=this.value;invToggleLinkMode()">
                  <option value="activity" ${linkMode !== 'standalone' ? 'selected' : ''}>活动用</option>
                  <option value="standalone" ${linkMode === 'standalone' ? 'selected' : ''}>非活动用</option>
                </select>
              </div>
              <div class="form-group inv-ob-field-mid inv-ob-field-project" id="invProjectWrap">
                <label class="form-label">项目编号（活动用）</label>
                <div class="inv-project-combobox">
                  <input type="text" class="form-control" id="invProjectCode" placeholder="与场次一致" autocomplete="off" value="${escapeHtml(of.project_code || '')}" onfocus="invOpenProjectSuggestionList()" onblur="invOnProjectInputBlur()" oninput="invOnProjectInput(this.value)" onkeydown="invHandleProjectInputKeydown(event)">
                  <button type="button" class="inv-project-trigger" onclick="invToggleProjectSuggestionList()" aria-label="展开项目编号建议"></button>
                  <div class="inv-project-menu" id="invProjectMenu" style="display:none"></div>
                </div>
                <span class="form-hint" id="invHintMsg" style="${hintMsg ? 'display:block;margin-top:4px' : 'display:none;margin-top:0'}">${escapeHtml(hintMsg)}</span>
              </div>
              <div class="form-group inv-ob-field-mid inv-ob-field-purpose-detail" id="invPurposeWrap" style="display:none">
                <label class="form-label">发货说明 <span class="required">*</span></label>
                <input type="text" class="form-control" id="invPurpose" placeholder="如：内部调拨/赞助寄样/办公使用" value="${escapeHtml(of.purpose || '')}">
              </div>
              <div class="form-group inv-ob-field-short inv-ob-field-logistics">
                <label class="form-label">物流方式</label>
                <select class="form-control" id="invLogistics">${INV_LOGISTICS_OPTS.map((x) => `<option value="${x}" ${(of.logistics_method || INV_LOGISTICS_OPTS[0]) === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
              </div>
              <div class="form-group inv-ob-field-mid inv-ob-field-tracking">
                <label class="form-label">物流单号</label>
                <input type="text" class="form-control" id="invTrackingNo" placeholder="物流单号可后续补填" value="${escapeHtml(of.tracking_number || '')}">
              </div>
            </div>
            <div class="inv-ob-modal-row">
              <div class="form-group inv-ob-field-short">
                <label class="form-label">收件城市</label>
                <input type="text" class="form-control" id="invRecvCity" value="${escapeHtml(of.recipient_city || '')}">
              </div>
              <div class="form-group inv-ob-field-short">
                <label class="form-label">联系人</label>
                <input type="text" class="form-control" id="invContactName" value="${escapeHtml(of.contact_name || '')}">
              </div>
              <div class="form-group inv-ob-field-short">
                <label class="form-label">联系电话</label>
                <input type="text" class="form-control" id="invContactPhone" value="${escapeHtml(of.contact_phone || '')}">
              </div>
            </div>
            <div class="inv-ob-modal-row inv-ob-modal-row-full">
              <div class="form-group inv-ob-field-full">
                <label class="form-label">收件地址</label>
                <input type="text" class="form-control" id="invRecvAddr" value="${escapeHtml(of.recipient_address || '')}">
              </div>
            </div>
            <div class="inv-ob-modal-row inv-ob-modal-row-full">
              <div class="form-group inv-ob-field-full">
                <label class="form-label">备注</label>
                <input type="text" class="form-control" id="invObRemarks" value="${escapeHtml(of.remarks || '')}">
              </div>
            </div>
            <div class="inv-outbound-actions inv-outbound-actions-inline">
              <button type="button" class="btn btn-primary" onclick="invSubmitOutbound()">${submitLabel}</button>
            </div>
          </div>

          <div class="inv-ob-pane-card inv-ob-pane-bottom">
            <div class="inv-ob-selected-head">
              <h4 class="inv-ob-pane-title">已选物品（只读）</h4>
              <span class="form-hint">左侧勾选并填写数量后，此处自动汇总展示</span>
            </div>
            <div id="invObSelectedPreview">${selectedPreview}</div>
          </div>
        </section>
      </div>
      <input type="hidden" id="invActivityId" value="${escapeHtml(String(of.activity_id || ''))}">
    </div>`;
}

function invRefreshSelectedPreview() {
  const el = document.getElementById('invObSelectedPreview');
  if (!el) return;
  invSaveCurrentWarehouseDraftFromModal();
  el.innerHTML = invBuildSelectedOutboundPreviewHtml();
}

function invSnapshotCommonPresetFromDom() {
  const preset = {};
  document.querySelectorAll('[data-inv-common-row]').forEach((row) => {
    const id = parseInt(row.getAttribute('data-item-id'), 10);
    if (!Number.isFinite(id)) return;
    const ck = document.getElementById(`invCommonCk_${id}`);
    const qtyEl = document.getElementById(`invCommonQty_${id}`);
    const noteEl = document.getElementById(`invCommonNote_${id}`);
    const qty = Math.max(0, parseInt(qtyEl && qtyEl.value, 10) || 0);
    preset[id] = {
      checked: !!(ck && ck.checked),
      quantity: qty,
      line_note: noteEl ? String(noteEl.value || '') : '',
    };
  });
  return preset;
}

function invSaveCurrentWarehouseDraftFromModal() {
  const whId = Number(inventoryPageState.warehouseId || 0);
  if (!whId) return;
  // NOTE:
  // 常用/非常用切换时，DOM 里只包含当前筛选下可见的行。
  // 这里必须与既有草稿合并，避免“切换筛选后之前已勾选物料被清空”。
  const prevPreset = inventoryPageState.outboundCommonByWarehouse[whId] || {};
  const domSnapshot = invSnapshotCommonPresetFromDom();
  inventoryPageState.outboundCommonByWarehouse[whId] = {
    ...prevPreset,
    ...domSnapshot,
  };
  inventoryPageState.outboundLinesByWarehouse[whId] = Array.isArray(inventoryPageState.outboundLines)
    ? inventoryPageState.outboundLines.map((x) => ({ ...x }))
    : [];
}

function invLoadWarehouseDraftToModal(warehouseId) {
  const whId = Number(warehouseId || 0);
  if (!whId) return;
  const lines = inventoryPageState.outboundLinesByWarehouse[whId];
  inventoryPageState.outboundLines = Array.isArray(lines) ? lines.map((x) => ({ ...x })) : [];
  inventoryPageState.outboundEditCommonPreset = inventoryPageState.outboundCommonByWarehouse[whId] || null;
}

async function invRefreshOutboundModalLineTables() {
  const whId = inventoryPageState.warehouseId;
  let items = [];
  if (whId) {
    try {
      items = await api('GET', `/inventory/items?inv_warehouse_id=${whId}`);
    } catch (_) {
      items = [];
    }
  }
  const whNum = Number(whId || 0);
  if (whNum > 0) {
    inventoryPageState.outboundItemMetaByWarehouse[whNum] = {};
    (Array.isArray(items) ? items : []).forEach((it) => {
      inventoryPageState.outboundItemMetaByWarehouse[whNum][String(it.id)] = {
        name: it.name || '',
        dimensions: it.dimensions || '',
      };
    });
  }
  const commonTbody = document.getElementById('invObCommonTbody');
  if (commonTbody) {
    if (inventoryPageState.editOutboundOrderId) {
      const snap = invSnapshotCommonPresetFromDom();
      inventoryPageState.outboundEditCommonPreset = {
        ...(inventoryPageState.outboundEditCommonPreset || {}),
        ...snap,
      };
    }
    const preset = inventoryPageState.editOutboundOrderId
      ? inventoryPageState.outboundEditCommonPreset
      : inventoryPageState.outboundCommonByWarehouse[Number(inventoryPageState.warehouseId)] || null;
    commonTbody.innerHTML = invBuildCommonRowsHtml(items, preset);
  }
  invRefreshSelectedPreview();
}

/** 仅重绘「其他物料」表格，避免刷新常用物料行导致勾选丢失 */
async function invRefreshOutboundExtraTbodyOnly() {
  const whId = inventoryPageState.warehouseId;
  let items = [];
  if (whId) {
    try {
      items = await api('GET', `/inventory/items?inv_warehouse_id=${whId}`);
    } catch (_) {
      items = [];
    }
  }
  const extraTbody = document.getElementById('invObExtraTbody');
  if (!extraTbody) return;
  const lines = inventoryPageState.outboundLines || [];
  extraTbody.innerHTML =
    invBuildExtraLineRowsHtml(items, lines) || '<tr><td colspan="4" style="color:var(--text-muted);font-size:13px">点击下方添加一行</td></tr>';
}

async function invOnModalWarehouseChange(warehouseId) {
  const id = parseInt(warehouseId, 10);
  if (!Number.isFinite(id)) return;
  invSaveCurrentWarehouseDraftFromModal();
  if (inventoryPageState.editOutboundOrderId && document.getElementById('invObCommonTbody')) {
    inventoryPageState.outboundEditCommonPreset = {
      ...(inventoryPageState.outboundEditCommonPreset || {}),
      ...invSnapshotCommonPresetFromDom(),
    };
  }
  inventoryPageState.warehouseId = id;
  invLoadWarehouseDraftToModal(id);
  document.querySelectorAll('.inv-ob-wh-btn').forEach((btn) => {
    const bid = parseInt(btn.getAttribute('data-wh-id') || '', 10);
    const active = Number.isFinite(bid) && bid === id;
    btn.classList.toggle('btn-primary', active);
    btn.classList.toggle('btn-secondary', !active);
  });
  await invRefreshOutboundModalLineTables();
  const hd = document.getElementById('invWarehouseSelect');
  if (hd) hd.value = String(id);
}

function invSetOutboundModalTitle(isEdit) {
  const el = document.querySelector('#modalInvOutbound .modal-title');
  if (el) el.textContent = isEdit ? '编辑物品出库' : '新建物品出库';
}

async function invOpenOutboundModal() {
  try {
    const body = document.getElementById('invOutboundModalBody');
    if (body) body.innerHTML = '<div class="empty-state">加载中...</div>';
    openModal('modalInvOutbound');
    inventoryPageState.editOutboundOrderId = null;
    inventoryPageState.outboundEditCommonPreset = null;
    inventoryPageState.outboundLines = [];
    inventoryPageState.outboundLinesByWarehouse = {};
    inventoryPageState.outboundCommonByWarehouse = {};
    inventoryPageState.outboundCommonSearchByWarehouse = {};
    inventoryPageState.outboundItemMetaByWarehouse = {};
    inventoryPageState.outboundListFilter = 'common';
    inventoryPageState.outboundForm = {
      linkMode: 'activity',
      project_code: '',
      purpose: '',
      activity_id: '',
      recipient_city: '',
      recipient_address: '',
      contact_name: '',
      contact_phone: '',
      logistics_method: INV_LOGISTICS_OPTS[0],
      tracking_number: '',
      remarks: '',
      hint_msg: '',
    };
    invSetOutboundModalTitle(false);
    let warehouses = [];
    try {
      warehouses = await api('GET', '/inventory/warehouses');
    } catch (e) {
      showToast(e.message || '加载仓库失败', 'error');
      closeModal();
      return;
    }
    if (!warehouses.length) {
      showToast('暂无仓库，请先在库存管理中新建仓库', 'warning');
      closeModal();
      return;
    }
    if (!inventoryPageState.warehouseId || !warehouses.some((w) => w.id === inventoryPageState.warehouseId)) {
      inventoryPageState.warehouseId = warehouses[0].id;
    }
    inventoryPageState.outboundWarehousesCache = warehouses.slice();
    let items = [];
    try {
      items = await api('GET', `/inventory/items?inv_warehouse_id=${inventoryPageState.warehouseId}`);
    } catch (_) {
      items = [];
    }
    const of = inventoryPageState.outboundForm;
    const curWh = Number(inventoryPageState.warehouseId || 0);
    inventoryPageState.outboundLinesByWarehouse[curWh] = [];
    inventoryPageState.outboundCommonByWarehouse[curWh] = {};
    inventoryPageState.outboundItemMetaByWarehouse[curWh] = {};
    (Array.isArray(items) ? items : []).forEach((it) => {
      inventoryPageState.outboundItemMetaByWarehouse[curWh][String(it.id)] = {
        name: it.name || '',
        dimensions: it.dimensions || '',
      };
    });
    if (!body) return;
    body.innerHTML = invBuildOutboundModalMarkup(warehouses, items, of);
    await invFillInvProjectDatalist();
    const lmEl = document.getElementById('invLinkMode');
    if (lmEl) {
      lmEl.value = of.linkMode !== 'standalone' ? 'activity' : 'standalone';
      inventoryPageState.linkMode = lmEl.value;
      of.linkMode = lmEl.value;
      invToggleLinkMode();
    }
    renderLucideIcons();
  } catch (e) {
    console.error('invOpenOutboundModal failed:', e);
    showToast(e?.message || '打开新建出库失败', 'error');
    closeModal();
  }
}

async function invToggleOutboundInlineForm(forceOpen) {
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !inventoryPageState.outboundInlineOpen;
  if (!nextOpen) {
    inventoryPageState.outboundInlineOpen = false;
    inventoryPageState.editOutboundOrderId = null;
    inventoryPageState.outboundEditCommonPreset = null;
    await renderInventory();
    return;
  }
  try {
    inventoryPageState.editOutboundOrderId = null;
    inventoryPageState.outboundEditCommonPreset = null;
    inventoryPageState.outboundLines = [];
    inventoryPageState.outboundLinesByWarehouse = {};
    inventoryPageState.outboundCommonByWarehouse = {};
    inventoryPageState.outboundCommonSearchByWarehouse = {};
    inventoryPageState.outboundItemMetaByWarehouse = {};
    inventoryPageState.outboundListFilter = 'common';
    inventoryPageState.outboundForm = {
      linkMode: 'activity',
      project_code: '',
      purpose: '',
      activity_id: '',
      recipient_city: '',
      recipient_address: '',
      contact_name: '',
      contact_phone: '',
      logistics_method: INV_LOGISTICS_OPTS[0],
      tracking_number: '',
      remarks: '',
      hint_msg: '',
    };
    let warehouses = [];
    try {
      warehouses = await api('GET', '/inventory/warehouses');
    } catch (e) {
      showToast(e.message || '加载仓库失败', 'error');
      return;
    }
    if (!warehouses.length) {
      showToast('暂无仓库，请先在库存管理中新建仓库', 'warning');
      return;
    }
    if (!inventoryPageState.warehouseId || !warehouses.some((w) => w.id === inventoryPageState.warehouseId)) {
      inventoryPageState.warehouseId = warehouses[0].id;
    }
    inventoryPageState.outboundWarehousesCache = warehouses.slice();
    const curWh = Number(inventoryPageState.warehouseId || 0);
    inventoryPageState.outboundLinesByWarehouse[curWh] = [];
    inventoryPageState.outboundCommonByWarehouse[curWh] = {};
    inventoryPageState.outboundInlineOpen = true;
    await renderInventory();
  } catch (e) {
    console.error('invToggleOutboundInlineForm failed:', e);
    showToast(e?.message || '打开页内新建出库失败', 'error');
  }
}

function invRenderOutboundOrderTable(orders) {
  if (!orders.length) {
    return '<div class="empty-state" style="margin-top:8px">暂无物品出库记录，可点击「新建出库」创建。</div>';
  }
  return `
    <div class="table-wrapper">
      <table class="data-table inv-ob-order-table">
        <thead>
          <tr>
            <th>出库日期</th>
            <th>项目编号</th>
            <th>物流方式</th>
            <th>物流单号</th>
            <th>发货仓</th>
            <th>收件城市</th>
            <th style="min-width:220px">操作</th>
            <th class="inv-ob-col-status">状态</th>
          </tr>
        </thead>
        <tbody>
          ${orders
            .map((o) => {
              const proj =
                o.link_mode === 'standalone' ? escapeHtml(o.purpose || '—') : escapeHtml(o.project_code || '—');
              const shipDate =
                o.shipped_at != null && String(o.shipped_at).trim()
                  ? String(o.shipped_at).slice(0, 10)
                  : '—';
              const st = String(o.status || '').toLowerCase();
              const statusHtml =
                st === 'closed'
                  ? '<span class="badge badge-success">已归还</span>'
                  : '<span class="badge badge-warning">出库中</span>';
              return `<tr>
            <td>${shipDate}</td>
            <td>${proj}</td>
            <td>${escapeHtml(o.logistics_method || '—')}</td>
            <td>${
              o.tracking_number
                ? `<a href="https://www.sf-express.com/cn/sc/dynamic_function/waybill/#search/bill-number/${encodeURIComponent(String(o.tracking_number))}" target="_blank" style="color:var(--accent);font-family:monospace;font-size:12px">${escapeHtml(o.tracking_number)}</a>`
                : '<span style="color:var(--text-muted)">—</span>'
            }</td>
            <td>${escapeHtml(o.brand_code)} ${escapeHtml(o.region)}</td>
            <td>${escapeHtml(o.recipient_city || '—')}</td>
            <td class="inv-ob-order-actions">
              <button type="button" class="btn btn-xs btn-secondary" onclick="event.stopPropagation();invOpenOutboundOrderDetail(${o.id})">出库单详情</button>
              <button type="button" class="btn btn-xs btn-ghost" onclick="event.stopPropagation();invOpenOutboundEditModal(${o.id})">编辑</button>
              <button type="button" class="btn btn-xs btn-ghost inv-admin-only" style="color:var(--danger)" onclick="event.stopPropagation();invDeleteOutboundOrder(${o.id})">删除</button>
            </td>
            <td class="inv-ob-col-status">${statusHtml}</td>
          </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function invRenderInboundLedgerTable(rows) {
  if (!rows.length) {
    return '<div class="empty-state" style="margin-top:8px">暂无已入库记录，可调整左侧年度查看。</div>';
  }
  return `
    <div class="table-wrapper inv-inbound-ledger-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>入库日期</th>
            <th>关联项目 / 用途</th>
            <th>仓库</th>
            <th>登记人</th>
            <th>汇总</th>
            <th>备注</th>
            <th style="min-width:72px"></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((r) => {
              const main = escapeHtml(r.display_main || '—');
              const sub = r.display_sub
                ? `<div class="inv-inbound-ledger-sub">${escapeHtml(r.display_sub)}</div>`
                : '';
              const rem = r.batch_remarks != null ? String(r.batch_remarks) : '';
              const remShort = rem.length > 40 ? `${rem.slice(0, 40)}…` : rem;
              const sum = `归${r.sum_qty_return} 空${r.sum_qty_empty_recovered} 留${r.sum_qty_customer_keep} 丢${r.sum_qty_lost} 损${r.sum_qty_damaged}`;
              return `<tr>
              <td>${r.return_date ? String(r.return_date).slice(0, 10) : '—'}</td>
              <td><div class="inv-inbound-ledger-main">${main}</div>${sub}</td>
              <td>${escapeHtml(r.brand_code)} ${escapeHtml(r.region)}</td>
              <td>${escapeHtml(r.operator || '—')}</td>
              <td style="font-size:12px;color:var(--text-secondary);white-space:nowrap">${sum}</td>
              <td style="max-width:160px;font-size:12px;color:var(--text-muted)" title="${escapeHtml(rem)}">${escapeHtml(remShort || '—')}</td>
              <td><button type="button" class="btn btn-xs btn-secondary" onclick="invOpenInboundReceiptDetail(${r.batch_id})">详情</button></td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

async function invOpenInboundReceiptDetail(batchId) {
  const titleEl = document.getElementById('modalInvInboundTitle');
  const body = document.getElementById('modalInvInboundBody');
  if (titleEl) titleEl.textContent = `入库单 #${batchId}`;
  if (!body) return;
  body.innerHTML = '<div class="empty-state">加载中…</div>';
  openModal('modalInvInboundReceipt');
  try {
    const det = await api('GET', `/inventory/inbound-receipts/${batchId}`);
    const h = det.head;
    const lines = det.lines || [];
    const disp = det.display || {};
    const obId = h.outbound_order_id;
    const main = escapeHtml(disp.display_main || '—');
    const sub = disp.display_sub
      ? `<div class="inv-inbound-detail-sub">${escapeHtml(disp.display_sub)}</div>`
      : '';
    const lineRows = lines.length
      ? lines
          .map(
            (ln) => `<tr>
          <td>${escapeHtml(ln.item_name)}</td>
          <td>${escapeHtml(ln.item_dimensions || '—')}</td>
          <td>${ln.outbound_qty}</td>
          <td>${ln.qty_return}</td>
          <td>${ln.qty_empty_recovered}</td>
          <td>${ln.qty_customer_keep}</td>
          <td>${ln.qty_lost}</td>
          <td>${ln.qty_damaged}</td>
        </tr>`,
          )
          .join('')
      : '<tr><td colspan="8" style="color:var(--text-muted)">无明细</td></tr>';
    const remHtml = h.batch_remarks != null && String(h.batch_remarks).trim()
      ? escapeHtml(String(h.batch_remarks))
      : '—';
    body.innerHTML = `
      <div class="modal-activity-form">
        <p class="modal-activity-lead">归还登记生成的入库凭证明细。下方「关联出库单」仅供系统内核对，日常请以项目编号 / 用途为准。</p>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">入库日期</label>
            <input class="form-control" value="${h.return_date ? String(h.return_date).slice(0, 10) : '—'}" readonly>
          </div>
          <div class="form-group">
            <label class="form-label">登记人</label>
            <input class="form-control" value="${escapeHtml(h.operator || '—')}" readonly>
          </div>
          <div class="form-group form-full">
            <label class="form-label">关联项目 / 用途</label>
            <input class="form-control" value="${main}" readonly>
            ${sub}
          </div>
          <div class="form-group">
            <label class="form-label">发货仓</label>
            <input class="form-control" value="${escapeHtml(h.brand_code)} ${escapeHtml(h.region)}" readonly>
          </div>
          <div class="form-group">
            <label class="form-label">关联出库单（系统）</label>
            <input class="form-control" value="#${obId}" readonly>
          </div>
          <div class="form-group form-full">
            <label class="form-label">归还备注</label>
            <div class="inv-inbound-remark-box">${remHtml}</div>
          </div>
        </div>
        <div class="table-wrapper" style="margin-top:14px;overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>物料</th><th>规格</th><th>出库数</th><th>归还</th><th>空瓶回收</th><th>留给客户</th><th>丢失</th><th>损坏</th>
              </tr>
            </thead>
            <tbody>${lineRows}</tbody>
          </table>
        </div>
      </div>`;
    renderLucideIcons();
  } catch (e) {
    body.innerHTML = `<div class="empty-state" style="color:var(--danger)">${escapeHtml(e.message || '加载失败')}</div>`;
  }
}

async function invOpenOutboundOrderDetail(orderId) {
  const titleEl = document.getElementById('invOutboundGroupTitle');
  const body = document.getElementById('invOutboundGroupBody');
  if (titleEl) titleEl.textContent = `出库单 #${orderId}`;
  if (!body) return;
  body.innerHTML = '<div class="empty-state">加载中…</div>';
  openModal('modalInvOutboundGroup');
  try {
    const det = await api('GET', `/inventory/outbound/${orderId}`);
    const ord = det.order;
    const lines = det.lines || [];
    const colHtml = '<colgroup><col style="width:25%"><col style="width:25%"><col style="width:15%"><col style="width:10%"><col style="width:25%"></colgroup>';
    const recipientCity = ord.recipient_city || '—';
    const contactName = ord.contact_name || '—';
    const contactPhone = ord.contact_phone || '—';
    const recipientAddr = ord.recipient_address || '—';
    const logisticsMethod = ord.logistics_method || '—';
    const trackingHtml = ord.tracking_number
      ? `<a href="https://www.sf-express.com/cn/sc/dynamic_function/waybill/#search/bill-number/${encodeURIComponent(String(ord.tracking_number))}" target="_blank" style="color:var(--accent);font-family:monospace;font-size:12px">${escapeHtml(ord.tracking_number)}</a>`
      : '<span style="color:var(--text-muted)">—</span>';
    const html = `
        <div class="inv-ob-shell">
          <div class="inv-ob-head-fixed">
            <div class="inv-ob-detail-head">出库单 #${ord.id} · ${ord.shipped_at ? String(ord.shipped_at).slice(0, 16) : '—'} · ${escapeHtml(ord.brand_code)} ${escapeHtml(ord.region)} · ${ord.status === 'closed' ? '已结清' : '待归还'}</div>
            <div class="activity-detail-grid" style="margin-bottom:12px">
              <section class="activity-detail-card">
                <h4>基础信息</h4>
                ${activityDetailRow('关联方式', ord.link_mode === 'standalone' ? '非项目出库' : '项目编号')}
                ${activityDetailRow(ord.link_mode === 'standalone' ? '用途说明' : '项目编号', ord.link_mode === 'standalone' ? (ord.purpose || '—') : (ord.project_code || '—'))}
                ${activityDetailRow('发货仓', `${ord.brand_code || ''} ${ord.region || ''}`.trim() || '—')}
                ${activityDetailRow('状态', ord.status === 'closed' ? '已归还' : '出库中')}
              </section>
              <section class="activity-detail-card">
                <h4>收件信息</h4>
                ${activityDetailRow('收件城市', recipientCity)}
                ${activityDetailRow('联系人', contactName)}
                ${activityDetailRow('联系电话', contactPhone)}
                ${activityDetailRow('收件地址', recipientAddr)}
                ${activityDetailRow('物流方式', logisticsMethod)}
                ${activityDetailRowHtml('物流单号', trackingHtml)}
              </section>
            </div>
          </div>
          <div class="inv-ob-items-header">
            <span class="inv-ob-items-label">物品清单</span>
            <button type="button" class="btn btn-sm btn-secondary" onclick="invDownloadPdf(${ord.id})">PDF</button>
          </div>
          <table class="data-table inv-ob-head-table">
            ${colHtml}
            <thead><tr><th>物料</th><th>规格</th><th>所属仓</th><th>数量</th><th>行备注</th></tr></thead>
          </table>
          <div class="inv-ob-body-scroll">
            <table class="data-table">
              ${colHtml}
              <tbody>
                ${
                  lines.length
                    ? lines
                        .map(
                          (ln) => `<tr>
                  <td>${escapeHtml(ln.item_name)}</td>
                  <td>${escapeHtml(ln.item_dimensions || '—')}</td>
                  <td>${escapeHtml(ln.line_brand_code || '—')} ${escapeHtml(ln.line_region || '')}</td>
                  <td>${ln.quantity}</td>
                  <td>${escapeHtml(ln.line_note || '—')}</td>
                </tr>`,
                        )
                        .join('')
                    : '<tr><td colspan="5">无明细</td></tr>'
                }
              </tbody>
            </table>
          </div>
        </div>`;
    body.innerHTML = html;
    renderLucideIcons();
  } catch (e) {
    body.innerHTML = `<div class="empty-state" style="color:var(--danger)">${escapeHtml(e.message || '加载失败')}</div>`;
  }
}

async function invOpenOutboundEditModal(orderId) {
  try {
    const inlineEdit = currentPage === 'inv-outbound';
    const body = document.getElementById('invOutboundModalBody');
    if (!inlineEdit) {
      if (body) body.innerHTML = '<div class="empty-state">加载中...</div>';
      openModal('modalInvOutbound');
    } else {
      inventoryPageState.outboundInlineOpen = true;
      inventoryPageState.editOutboundOrderId = orderId;
    }
    let det;
    try {
      det = await api('GET', `/inventory/outbound/${orderId}`);
    } catch (e) {
      showToast(e.message || '加载失败', 'error');
      if (!inlineEdit) closeModal();
      return;
    }
    const o = det.order;
    let warehouses = [];
    try {
      warehouses = await api('GET', '/inventory/warehouses');
    } catch (e) {
      showToast(e.message || '加载仓库失败', 'error');
      if (!inlineEdit) closeModal();
      return;
    }
    if (!warehouses.length) {
      showToast('暂无仓库，请先在库存管理中新建仓库', 'warning');
      if (!inlineEdit) closeModal();
      return;
    }
    inventoryPageState.warehouseId = o.inv_warehouse_id;
    if (!warehouses.some((w) => w.id === inventoryPageState.warehouseId)) {
      showToast('该出库单关联的仓库不存在', 'error');
      if (!inlineEdit) closeModal();
      return;
    }
    let items = [];
    try {
      items = await api('GET', `/inventory/items?inv_warehouse_id=${inventoryPageState.warehouseId}`);
    } catch (_) {
      items = [];
    }
    const commonPreset = {};
    for (const ln of det.lines || []) {
      const qty = Number(ln.quantity) || 0;
      const note = (ln.line_note && String(ln.line_note).trim()) || '';
      const prev = commonPreset[ln.item_id];
      if (!prev) {
        commonPreset[ln.item_id] = { checked: qty > 0, quantity: qty, line_note: note };
      } else {
        prev.quantity += qty;
        const merged = [prev.line_note, note].filter(Boolean).join('；');
        prev.line_note = merged;
        prev.checked = prev.quantity > 0;
      }
    }
    inventoryPageState.outboundLines = [];
    inventoryPageState.editOutboundOrderId = orderId;
    inventoryPageState.outboundEditCommonPreset = commonPreset;
    inventoryPageState.outboundLinesByWarehouse = {};
    inventoryPageState.outboundCommonByWarehouse = {
      [Number(o.inv_warehouse_id)]: commonPreset,
    };
    inventoryPageState.outboundWarehousesCache = warehouses.slice();
    inventoryPageState.outboundListFilter = 'common';
    inventoryPageState.outboundInlineOpen = inlineEdit;

    const of = inventoryPageState.outboundForm;
    of.linkMode = o.link_mode === 'standalone' ? 'standalone' : 'activity';
    of.project_code = o.project_code || '';
    of.purpose = o.purpose || '';
    of.activity_id = o.activity_id != null ? String(o.activity_id) : '';
    of.recipient_city = o.recipient_city || '';
    of.recipient_address = o.recipient_address || '';
    of.contact_name = o.contact_name || '';
    of.contact_phone = o.contact_phone || '';
    of.logistics_method = o.logistics_method || INV_LOGISTICS_OPTS[0];
    of.tracking_number = o.tracking_number || '';
    of.remarks = o.remarks || '';
    of.hint_msg = '';
    inventoryPageState.linkMode = of.linkMode;

    if (inlineEdit) {
      await renderInventory();
    } else {
      if (!body) return;
      body.innerHTML = invBuildOutboundModalMarkup(warehouses, items, of, {
        editOrderId: orderId,
        commonPreset,
      });
      invSetOutboundModalTitle(true);
      await invFillInvProjectDatalist();
      const lmEl = document.getElementById('invLinkMode');
      if (lmEl) {
        lmEl.value = of.linkMode !== 'standalone' ? 'activity' : 'standalone';
        inventoryPageState.linkMode = lmEl.value;
        of.linkMode = lmEl.value;
        invToggleLinkMode();
      }
    }
    renderLucideIcons();
  } catch (e) {
    console.error('invOpenOutboundEditModal failed:', e);
    showToast(e?.message || '打开编辑出库失败', 'error');
    if (currentPage !== 'inv-outbound') closeModal();
  }
}

async function invDeleteOutboundOrder(orderId) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除出库单', 'warning');
    return;
  }
  if (
    !window.confirm(
      `确定删除出库单 #${orderId}？\n\n将按原路冲销：先撤销归还登记带来的入库，再撤销出库扣减，并删除本单及全部归还记录（丢失/损坏统计也会随归还明细消失）。仅建议管理员用于测试数据清理。`,
    )
  ) {
    return;
  }
  try {
    await api('DELETE', `/inventory/outbound/${orderId}`);
    showToast('已删除', 'success');
    updateBadges();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

async function renderInventory() {
  invCaptureOutboundDraft();
  const container = document.getElementById('pageContainer');
  const yfId = currentYearFrameId;

  const invPage =
    currentPage === 'inventory' ? 'master' : currentPage === 'inv-outbound' ? 'outbound' : currentPage === 'inv-inbound' ? 'inbound' : null;
  if (!invPage) return;

  let warehouses = [];
  try {
    warehouses = await api('GET', '/inventory/warehouses');
  } catch (e) {
    const msg = escapeHtml(e.message || '');
    let extra = '若仍失败，请在本机执行 <code>npm run migrate:inventory</code> 并<strong>重启</strong> Node 进程。';
    if (String(e.message || '').includes('404')) {
      extra = '接口返回 404：当前运行的 node 进程<strong>未加载物资库存路由</strong>，请结束旧进程后重新执行 <code>npm run start</code>。';
    } else if (String(e.message || '').toLowerCase().includes("doesn't exist") || String(e.message || '').includes('不存在')) {
      extra = '数据库表可能未创建：执行 <code>npm run migrate:inventory</code> 后重启服务；或刷新页面重试（服务会在首次访问时尝试自动建表）。';
    } else if (String(e.message || '').includes('year_frame_id')) {
      extra = '库结构需升级：请执行 <code>npm run migrate:inventory-global-fiscal</code> 后重启服务。';
    }
    container.innerHTML = `<div class="empty-state" style="color:var(--danger)">加载失败：${msg}<p style="margin-top:12px;font-size:13px;color:var(--text-secondary)">${extra}</p></div>`;
    return;
  }

  if (!inventoryPageState.warehouseId && warehouses.length) {
    inventoryPageState.warehouseId = warehouses[0].id;
  }
  if (inventoryPageState.warehouseId && !warehouses.some((w) => w.id === inventoryPageState.warehouseId)) {
    inventoryPageState.warehouseId = warehouses.length ? warehouses[0].id : null;
  }

  let items = [];
  if (
    invPage === 'master' &&
    inventoryPageState.stockMasterView !== 'wine' &&
    inventoryPageState.stockMasterView !== 'empty' &&
    inventoryPageState.warehouseId
  ) {
    try {
      items = await api('GET', `/inventory/items?inv_warehouse_id=${inventoryPageState.warehouseId}`);
    } catch (_) {
      items = [];
    }
  }

  invEnsureTabForPage(invPage);

  let itemsViewMode = inventoryPageState.itemsViewMode || 'cards';
  if (!INV_ITEMS_VIEW_MODES.some((m) => m.id === itemsViewMode)) itemsViewMode = 'cards';
  inventoryPageState.itemsViewMode = itemsViewMode;

  const listActive = itemsViewMode === 'list';
  const gridActive = itemsViewMode === 'cards' || itemsViewMode === 'thumbnails';
  const gridToggleTitle = invGridViewToggleTitle(itemsViewMode);
  const masterIsWine = invPage === 'master' && inventoryPageState.stockMasterView === 'wine';
  const masterIsEmpty = invPage === 'master' && inventoryPageState.stockMasterView === 'empty';
  const masterIsItemCatalog = invPage === 'master' && inventoryPageState.stockMasterView === 'item-catalog';
  const masterIsWarehouse = invPage === 'master' && !masterIsWine && !masterIsEmpty && !masterIsItemCatalog;

  let displayItems = items;
  if (masterIsWarehouse) {
    const f = inventoryPageState.itemsListFilter || 'all';
    if (f === 'common') {
      displayItems = items.filter((it) => invItemIsCommon(it));
    } else if (f === 'uncommon') {
      displayItems = items.filter((it) => !invItemIsCommon(it));
    } else if (f === 'wine') {
      let cat = [];
      try {
        cat = await api('GET', '/wine/catalog');
      } catch (_) {
        cat = [];
      }
      const set = new Set((Array.isArray(cat) ? cat : []).map((c) => invCatalogRowWineKey(c)));
      displayItems = items.filter((it) => set.has(invItemWineCatalogKey(it)));
    }
  }

  const viewToggleHtml =
    invPage === 'master' && !masterIsWine && !masterIsEmpty
      ? `<div class="inv-view-toggle" role="toolbar" aria-label="物料展示方式">
      <div class="inv-view-toggle-inner">
        <button type="button" class="inv-view-opt ${listActive ? 'active' : ''}" onclick="invSetItemsViewMode('list')" title="列表" aria-label="列表">${INV_VIEW_LIST_ICON}</button>
        <button type="button" class="inv-view-opt ${gridActive ? 'active' : ''}" onclick="invCycleGridItemsView()" title="${escapeHtml(gridToggleTitle)}" aria-label="${escapeHtml(gridToggleTitle)}">${INV_VIEW_GRID_ICON}</button>
      </div>
    </div>`
      : '';

  const itemsFilterHtml = masterIsWarehouse
    ? invRenderItemsListFilterBar(inventoryPageState.itemsListFilter || 'all')
    : '';

  let panelHtml = '';
  if (invPage === 'master') {
    if (masterIsWine) {
      panelHtml = `
      <div class="stats-row" id="wineCatalogStats" style="margin-bottom:16px"></div>
      <div class="card">
        <div class="card-header">
          <h3><i data-lucide="book-open" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>目录列表</h3>
        </div>
        <div class="card-body" id="wineCatalogListHost">
          <div style="color:var(--text-muted);padding:20px;text-align:center">加载中...</div>
        </div>
      </div>`;
    } else if (masterIsItemCatalog) {
      panelHtml = `
      <div class="stats-row" id="itemCatalogStats" style="margin-bottom:16px"></div>
      <div class="card">
        <div class="card-header">
          <h3><i data-lucide="library" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>目录列表</h3>
        </div>
        <div class="card-body" id="itemCatalogListHost">
          <div style="color:var(--text-muted);padding:20px;text-align:center">加载中...</div>
        </div>
      </div>`;
    } else if (masterIsEmpty) {
      let emptyGroups = [];
      try {
        emptyGroups = await api('GET', '/inventory/empty-bottles/summary');
      } catch (_) {
        emptyGroups = [];
      }
      panelHtml = invRenderEmptyBottleWarehouseSections(emptyGroups);
    } else {
      panelHtml = invRenderItemsPanel(displayItems, itemsViewMode);
    }
  } else if (invPage === 'outbound') {
    let allOrders = [];
    try {
      allOrders = await api('GET', `/inventory/outbound${invOutboundListQuery()}`);
    } catch (_) {
      allOrders = [];
    }
    let inlineFormHtml = '';
    if (inventoryPageState.outboundInlineOpen) {
      const inlineEditId = parseInt(inventoryPageState.editOutboundOrderId, 10);
      const isEditingInline = Number.isFinite(inlineEditId);
      let currentItems = [];
      try {
        currentItems = await api('GET', `/inventory/items?inv_warehouse_id=${inventoryPageState.warehouseId}`);
      } catch (_) {
        currentItems = [];
      }
      inlineFormHtml = `
        <div class="card inv-ob-inline-shell">
          <div class="card-header inv-ob-inline-shell-head">
            <h3>${isEditingInline ? `编辑物品出库 #${inlineEditId}` : '新建物品出库'}</h3>
            <button type="button" class="btn btn-secondary btn-sm" onclick="invToggleOutboundInlineForm(false)">收起</button>
          </div>
          <div class="card-body">
            ${invBuildOutboundModalMarkup(warehouses, Array.isArray(currentItems) ? currentItems : [], inventoryPageState.outboundForm || {}, isEditingInline ? {
              editOrderId: inlineEditId,
              commonPreset: inventoryPageState.outboundCommonByWarehouse[Number(inventoryPageState.warehouseId)] || inventoryPageState.outboundEditCommonPreset || null,
            } : {})}
          </div>
        </div>`;
    }
    panelHtml = `${inlineFormHtml}${invRenderOutboundOrderTable(Array.isArray(allOrders) ? allOrders : [])}`;
  } else if (invPage === 'inbound') {
    let openOrders = [];
    try {
      openOrders = await api('GET', `/inventory/outbound${invOutboundListQuery({ status: 'open' })}`);
    } catch (_) {
      openOrders = [];
    }
    let inboundLedger = [];
    try {
      inboundLedger = await api('GET', `/inventory/inbound-receipts${invInboundReceiptListQuery()}`);
    } catch (_) {
      inboundLedger = [];
    }
    const ledgerArr = Array.isArray(inboundLedger) ? inboundLedger : [];
    panelHtml = `
      <div class="inv-inbound-section">
        ${invRenderInboundLedgerTable(ledgerArr)}
      </div>
      <div class="inv-inbound-divider" role="separator" aria-hidden="true"></div>
      <div class="inv-inbound-section">
        <h4 class="inv-inbound-section-title">待入库</h4>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>单号</th><th>品牌/区</th><th>项目编号 / 场次</th><th>出库时间</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${openOrders.length ? openOrders.map((o) => {
              const city = o.activity_city ? String(o.activity_city).trim() : '';
              const projLine =
                o.link_mode === 'standalone'
                  ? escapeHtml(o.purpose || '—')
                  : `${escapeHtml(o.project_code || '—')}${
                      city ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${escapeHtml(city)}</div>` : ''
                    }`;
              return `
              <tr>
                <td>#${o.id}</td>
                <td>${escapeHtml(o.brand_code)} ${escapeHtml(o.region)}</td>
                <td>${projLine}</td>
                <td>${o.shipped_at ? String(o.shipped_at).slice(0, 10) : '—'}</td>
                <td>
                  <button type="button" class="btn btn-sm btn-primary" onclick="invOpenReturn(${o.id})">归还登记</button>
                  <button type="button" class="btn btn-sm btn-secondary" onclick="invDownloadPdf(${o.id})">PDF</button>
                </td>
              </tr>`;
            }).join('') : '<tr><td colspan="5" style="color:var(--text-muted)">暂无待入库单据</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  const masterToolbarWh = `
    <div class="inv-master-warehouse-block">
      ${invRenderStockMasterCardsHtml(warehouses, inventoryPageState.warehouseId, inventoryPageState.stockMasterView)}
    </div>
    <div class="inv-toolbar inv-toolbar-master">
      <button type="button" class="btn btn-primary btn-sm inv-admin-only" onclick="invOpenNewItemModal()" ${inventoryPageState.warehouseId ? '' : 'disabled'}>添加物料</button>
      <button type="button" class="btn btn-secondary btn-sm inv-admin-only" onclick="invOpenAddItemCatalogModal()" ${inventoryPageState.warehouseId ? '' : 'disabled'}>物品目录</button>
      <button type="button" class="btn btn-secondary btn-sm inv-admin-only" onclick="invOpenAddWineModal()" ${inventoryPageState.warehouseId ? '' : 'disabled'}>酒品目录</button>
      <span class="form-hint" style="flex:1;min-width:200px;margin:0">仓库与物料为 <strong>25/26 财年共用</strong>；仓库增删请由管理员在库表或脚本中维护。按项目编号匹配场次时请先选左侧年度。</span>
    </div>`;
  const masterToolbarWine = `
    <div class="inv-master-warehouse-block">
      ${invRenderStockMasterCardsHtml(warehouses, inventoryPageState.warehouseId, inventoryPageState.stockMasterView)}
    </div>
    <div class="inv-toolbar inv-toolbar-master">
      <button type="button" class="btn btn-primary btn-sm inv-admin-only" onclick="openWineCatalogModal(null)">添加酒品</button>
      <span class="form-hint" style="flex:1;min-width:200px;margin:0">酒品<strong>目录</strong>为全局主数据（品牌、名称、规格、图片），<strong>不含分仓库存</strong>；向某仓库加酒请在对应仓库下使用「添加酒品」。</span>
    </div>`;
  const masterToolbarEmpty = `
    <div class="inv-master-warehouse-block">
      ${invRenderStockMasterCardsHtml(warehouses, inventoryPageState.warehouseId, inventoryPageState.stockMasterView)}
    </div>
    <div class="inv-toolbar inv-toolbar-master inv-toolbar-empty-ledger">
      <span class="form-hint" style="flex:1;min-width:200px;margin:0">空瓶回收仅作查看与追溯，列表为各仓当前库存。</span>
    </div>`;
  const masterToolbarItemCatalog = `
    <div class="inv-master-warehouse-block">
      ${invRenderStockMasterCardsHtml(warehouses, inventoryPageState.warehouseId, inventoryPageState.stockMasterView)}
    </div>
    <div class="inv-toolbar inv-toolbar-master">
      <button type="button" class="btn btn-primary btn-sm inv-admin-only" onclick="invSyncItemCatalogFromWarehouses()">同步目录（PHD/X.O/CLUB）</button>
      <span class="form-hint" style="flex:1;min-width:200px;margin:0">物品目录按名称+规格去重，用于后续新建北区/南区仓库时快速选品导入。</span>
    </div>`;
  const masterToolbar =
    invPage === 'master' && inventoryPageState.stockMasterView === 'wine'
      ? masterToolbarWine
      : invPage === 'master' && inventoryPageState.stockMasterView === 'item-catalog'
        ? masterToolbarItemCatalog
      : invPage === 'master' && inventoryPageState.stockMasterView === 'empty'
        ? masterToolbarEmpty
        : masterToolbarWh;

  const outboundPageHeader = `
    <div class="inv-out-page-head">
      <div class="inv-out-page-head-main">
        <span class="form-hint" style="margin:0">按项目编号汇总已出库记录；<strong>出库日期</strong>按发货时间，无则按创建时间。主数据请在 <strong>库存管理</strong> 维护。</span>
      </div>
      <button type="button" class="btn btn-primary btn-sm" onclick="invToggleOutboundInlineForm()">${inventoryPageState.outboundInlineOpen ? '收起新建' : '新建出库'}</button>
    </div>`;

  const inboundOpsToolbar = `<div class="inv-toolbar"></div>`;

  const tabsMasterTools = [itemsFilterHtml, viewToggleHtml].filter(Boolean).join('');
  const tabsBarMaster = `
    <div class="inv-tabs-bar">
      <span class="inv-page-lead">${masterIsWine ? '酒品目录' : masterIsItemCatalog ? '物品目录' : masterIsEmpty ? '空瓶回收' : '物料清单'}</span>
      ${tabsMasterTools ? `<div class="inv-tabs-bar-tools">${tabsMasterTools}</div>` : ''}
    </div>`;

  const tabsBarInbound = `
    <div class="inv-tabs-bar">
      <span class="inv-page-lead">已入库</span>
      <div class="inv-tabs-bar-tools"></div>
    </div>`;

  const toolbarHtml =
    invPage === 'master' ? masterToolbar : invPage === 'outbound' ? outboundPageHeader : inboundOpsToolbar;
  const tabsBarHtml = invPage === 'master' ? tabsBarMaster : invPage === 'outbound' ? '' : tabsBarInbound;

  container.innerHTML =
    invPage === 'master'
      ? `
    <section class="inv-master-layout">
      <div class="inv-master-sticky-head">
        ${toolbarHtml}
        ${tabsBarHtml}
      </div>
      <div class="inv-master-scroll-body">
        ${panelHtml}
      </div>
    </section>
  `
      : `
    ${toolbarHtml}
    ${tabsBarHtml}
    ${panelHtml}
  `;

  if (invPage === 'master' && inventoryPageState.stockMasterView === 'wine') {
    try {
      await loadWineCatalogPage();
      updateBadges();
    } catch (_) { /* ignore */ }
  }
  if (invPage === 'master' && inventoryPageState.stockMasterView === 'item-catalog') {
    try {
      await loadItemCatalogPage();
      updateBadges();
    } catch (_) { /* ignore */ }
  }

    try {
      if (yfId) {
        const actList = await api('GET', `/activities?yearFrameId=${yfId}&isVirtual=0`);
        invSetOutboundProjectOptions(actList);
      }
    } catch (_) { /* ignore */ }

  const lmEl = document.getElementById('invLinkMode');
  if (lmEl) {
    lmEl.value = inventoryPageState.outboundForm.linkMode || inventoryPageState.linkMode || 'activity';
    inventoryPageState.linkMode = lmEl.value;
    inventoryPageState.outboundForm.linkMode = lmEl.value;
    invToggleLinkMode();
  }
}

function invSwitchTab(t) {
  inventoryPageState.tab = t;
  if (t === 'outbound') inventoryPageState.outboundLines = Array.isArray(inventoryPageState.outboundLines) ? inventoryPageState.outboundLines : [];
  renderInventory();
}

function invToggleLinkMode() {
  const lm = document.getElementById('invLinkMode');
  const m = lm && lm.value === 'standalone';
  const pw = document.getElementById('invProjectWrap');
  const pr = document.getElementById('invPurposeWrap');
  if (pw) pw.style.display = m ? 'none' : 'block';
  if (pr) pr.style.display = m ? 'block' : 'none';
}

async function invApplyProjectHint() {
  const el = document.getElementById('invHintMsg');
  const pc = document.getElementById('invProjectCode')?.value?.trim();
  if (!pc) {
    if (el) el.textContent = '请输入项目编号';
    return;
  }
  if (!currentYearFrameId) {
    if (el) el.textContent = '请先在左侧选择年度，以便在对应年框下匹配场次';
    return;
  }
  try {
    const h = await api('GET', `/inventory/hints/project?year_frame_id=${currentYearFrameId}&project_code=${encodeURIComponent(pc)}`);
    if (h.activity_id) document.getElementById('invActivityId').value = h.activity_id;
    if (el) el.textContent = h.activity_id ? '已匹配到场次（仓库请手动选择）' : (h.message || '未匹配到场次');
    inventoryPageState.linkMode = 'activity';
    inventoryPageState.outboundForm.linkMode = 'activity';
    inventoryPageState.outboundForm.project_code = pc;
    inventoryPageState.outboundForm.hint_msg = h.activity_id ? '已匹配到场次（仓库请手动选择）' : (h.message || '未匹配到场次');
    const lm = document.getElementById('invLinkMode');
    if (lm) lm.value = 'activity';
    invToggleLinkMode();
    const pcEl = document.getElementById('invProjectCode');
    if (pcEl) pcEl.value = pc;
    const aiEl = document.getElementById('invActivityId');
    if (aiEl && h.activity_id) {
      aiEl.value = h.activity_id;
      inventoryPageState.outboundForm.activity_id = String(h.activity_id);
    }
  } catch (e) {
    if (el) el.textContent = e.message || '匹配失败';
  }
}

function invOnOutboundCommonCk(itemId) {
  const ck = document.getElementById(`invCommonCk_${itemId}`);
  const q = document.getElementById(`invCommonQty_${itemId}`);
  if (!ck || !q) return;
  if (ck.checked && (parseInt(q.value, 10) || 0) < 1) q.value = 1;
  if (!ck.checked) q.value = 0;
  invRefreshSelectedPreview();
}

function invOnOutboundCommonQty(itemId) {
  const ck = document.getElementById(`invCommonCk_${itemId}`);
  const q = document.getElementById(`invCommonQty_${itemId}`);
  if (!q) return;
  const n = Math.max(0, parseInt(q.value, 10) || 0);
  q.value = n;
  if (ck) ck.checked = n > 0;
  invRefreshSelectedPreview();
}

function invOnOutboundCommonNote(itemId) {
  if (!Number.isFinite(Number(itemId))) return;
  invRefreshSelectedPreview();
}

function invPatchOutboundLine(idx, key, val) {
  const lines = inventoryPageState.outboundLines || [];
  if (!lines[idx]) return;
  if (key === 'quantity') lines[idx].quantity = Math.max(1, parseInt(val, 10) || 1);
  else if (key === 'item_id') lines[idx].item_id = val ? parseInt(val, 10) : '';
  else lines[idx][key] = val;
  if (document.getElementById('invObExtraTbody')) {
    void invRefreshOutboundExtraTbodyOnly();
  }
}

function invPatchOutboundLineByDisplay(idx, displayVal) {
  const m = String(displayVal || '').match(/\[#(\d+)\]/);
  const itemId = m ? parseInt(m[1], 10) : '';
  invPatchOutboundLine(idx, 'item_id', itemId);
}

function invOnCommonSearchInput(val) {
  const whId = Number(inventoryPageState.warehouseId || 0);
  const key = String(whId || 'global');
  inventoryPageState.outboundCommonSearchByWarehouse = inventoryPageState.outboundCommonSearchByWarehouse || {};
  inventoryPageState.outboundCommonSearchByWarehouse[key] = String(val || '');
  const commonTbody = document.getElementById('invObCommonTbody');
  if (!commonTbody) return;
  const wh = inventoryPageState.warehouseId;
  if (!wh) return;
  api('GET', `/inventory/items?inv_warehouse_id=${wh}`)
    .then((items) => {
      const arr = Array.isArray(items) ? items : [];
      invSeedOutboundItemMetaFromItems(wh, arr);
      const preset = inventoryPageState.outboundEditCommonPreset;
      commonTbody.innerHTML = invBuildCommonRowsHtml(arr, preset);
      invRefreshSelectedPreview();
    })
    .catch(() => {});
}

function invMoveCommonItem(itemId, step) {
  invSaveCurrentWarehouseDraftFromModal();
  const whId = Number(inventoryPageState.warehouseId || 0);
  const key = String(whId || 'global');
  inventoryPageState.outboundCommonOrderByWarehouse = inventoryPageState.outboundCommonOrderByWarehouse || {};
  const ids = [...new Set((inventoryPageState.outboundCommonOrderByWarehouse[key] || []).map((x) => Number(x)).filter((x) => Number.isFinite(x)))];
  if (!ids.includes(Number(itemId))) ids.push(Number(itemId));
  const i = ids.indexOf(Number(itemId));
  if (i < 0) return;
  if (step === 'top') {
    if (i === 0) return;
    ids.splice(i, 1);
    ids.unshift(Number(itemId));
  } else if (step === 'bottom') {
    if (i === ids.length - 1) return;
    ids.splice(i, 1);
    ids.push(Number(itemId));
  } else {
    const j = i + (step > 0 ? 1 : -1);
    if (j < 0 || j >= ids.length) return;
    const tmp = ids[i];
    ids[i] = ids[j];
    ids[j] = tmp;
  }
  inventoryPageState.outboundCommonOrderByWarehouse[key] = ids;
  invSaveCommonOrderStore();
  const commonTbody = document.getElementById('invObCommonTbody');
  if (!commonTbody) return;
  const wh = inventoryPageState.warehouseId;
  if (!wh) return;
  api('GET', `/inventory/items?inv_warehouse_id=${wh}`)
    .then((items) => {
      const arr = Array.isArray(items) ? items : [];
      invSeedOutboundItemMetaFromItems(wh, arr);
      const preset = inventoryPageState.editOutboundOrderId
        ? inventoryPageState.outboundEditCommonPreset
        : inventoryPageState.outboundCommonByWarehouse[Number(wh)] || null;
      commonTbody.innerHTML = invBuildCommonRowsHtml(arr, preset);
      invRefreshSelectedPreview();
    })
    .catch(() => {});
}

let invCommonDraggingItemId = null;

function invCommonDragStart(event, itemId) {
  invCommonDraggingItemId = Number(itemId);
  try {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(itemId));
  } catch (_) { /* ignore */ }
}

function invCommonDragOver(event) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function invCommonDrop(event, targetItemId) {
  event.preventDefault();
  invSaveCurrentWarehouseDraftFromModal();
  const targetId = Number(targetItemId);
  const sourceId = Number(invCommonDraggingItemId);
  if (!Number.isFinite(sourceId) || !Number.isFinite(targetId) || sourceId === targetId) return;
  const whId = Number(inventoryPageState.warehouseId || 0);
  const key = String(whId || 'global');
  const domOrder = Array.from(document.querySelectorAll('#invObCommonTbody [data-inv-common-row]'))
    .map((row) => Number(row.getAttribute('data-item-id')))
    .filter((id) => Number.isFinite(id));
  if (!domOrder.length) return;
  const ids = [...domOrder];
  const from = ids.indexOf(sourceId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return;
  ids.splice(from, 1);
  ids.splice(to, 0, sourceId);
  inventoryPageState.outboundCommonOrderByWarehouse[key] = ids;
  invSaveCommonOrderStore();
  const commonTbody = document.getElementById('invObCommonTbody');
  if (!commonTbody) return;
  const wh = inventoryPageState.warehouseId;
  if (!wh) return;
  api('GET', `/inventory/items?inv_warehouse_id=${wh}`)
    .then((items) => {
      const arr = Array.isArray(items) ? items : [];
      invSeedOutboundItemMetaFromItems(wh, arr);
      const preset = inventoryPageState.editOutboundOrderId
        ? inventoryPageState.outboundEditCommonPreset
        : inventoryPageState.outboundCommonByWarehouse[Number(wh)] || null;
      commonTbody.innerHTML = invBuildCommonRowsHtml(arr, preset);
      invRefreshSelectedPreview();
    })
    .catch(() => {});
}

function invCommonDragEnd() {
  invCommonDraggingItemId = null;
}

async function invToggleItemCommon(id, asCommon) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可修改常用物料', 'warning');
    return;
  }
  const pageScrollSnapshot = invCapturePageScrollPosition(id);
  try {
    await api('PUT', `/inventory/items/${id}`, { is_common: Boolean(asCommon) });
    showToast(asCommon ? '已设为常用物料' : '已取消常用', 'success');
    await renderInventory();
    invRestorePageScrollPosition(pageScrollSnapshot);
  } catch (e) {
    showToast(e.message || '更新失败', 'error');
  }
}

function invAddOutboundRow() {
  inventoryPageState.outboundLines = inventoryPageState.outboundLines || [];
  inventoryPageState.outboundLines.push({ item_id: '', quantity: 1, line_note: '' });
  if (document.getElementById('invObExtraTbody')) {
    void invRefreshOutboundExtraTbodyOnly();
  } else {
    renderInventory();
  }
}

function invRemoveOutboundRow(idx) {
  inventoryPageState.outboundLines.splice(idx, 1);
  if (document.getElementById('invObExtraTbody')) {
    void invRefreshOutboundExtraTbodyOnly();
  } else {
    renderInventory();
  }
}

async function invSubmitOutbound() {
  const isInlineMode = !!document.querySelector('.inv-ob-inline-shell');
  const ws = document.getElementById('invWarehouseSelect');
  const whId = ws ? parseInt(ws.value, 10) || null : inventoryPageState.warehouseId;
  if (ws && Number.isFinite(whId)) inventoryPageState.warehouseId = whId;
  invSaveCurrentWarehouseDraftFromModal();
  const lm = document.getElementById('invLinkMode')?.value === 'standalone' ? 'standalone' : 'activity';
  const baseBody = {
    link_mode: lm,
    project_code: lm === 'activity' ? (document.getElementById('invProjectCode')?.value || '').trim() : null,
    purpose: lm === 'standalone' ? (document.getElementById('invPurpose')?.value || '').trim() : null,
    year_frame_id: currentYearFrameId || null,
    activity_id: document.getElementById('invActivityId')?.value || null,
    recipient_city: document.getElementById('invRecvCity')?.value || null,
    recipient_address: document.getElementById('invRecvAddr')?.value || null,
    contact_name: document.getElementById('invContactName')?.value || null,
    contact_phone: document.getElementById('invContactPhone')?.value || null,
    logistics_method: document.getElementById('invLogistics')?.value || null,
    tracking_number: (document.getElementById('invTrackingNo')?.value || '').trim() || null,
    remarks: document.getElementById('invObRemarks')?.value || null,
  };
  if (lm === 'activity' && !baseBody.project_code) {
    showToast('请填写项目编号', 'warning');
    return;
  }
  if (lm === 'standalone' && !baseBody.purpose) {
    showToast('请填写非活动信息', 'warning');
    return;
  }
  const editHidden = document.getElementById('invOutboundEditOrderId');
  const editIdRaw = editHidden && editHidden.value ? editHidden.value : inventoryPageState.editOutboundOrderId;
  const editId = parseInt(editIdRaw, 10);
  const whIds = new Set();
  Object.keys(inventoryPageState.outboundCommonByWarehouse || {}).forEach((k) => {
    const id = parseInt(k, 10);
    if (Number.isFinite(id)) whIds.add(id);
  });
  Object.keys(inventoryPageState.outboundLinesByWarehouse || {}).forEach((k) => {
    const id = parseInt(k, 10);
    if (Number.isFinite(id)) whIds.add(id);
  });
  if (Number.isFinite(whId)) whIds.add(whId);
  const mergedAllLines = [];
  for (const wid of whIds) {
    const commonPreset = inventoryPageState.outboundCommonByWarehouse[wid] || {};
    const fromCommon = Object.entries(commonPreset)
      .map(([itemId, p]) => ({
        item_id: parseInt(itemId, 10),
        quantity: p && p.checked ? Math.max(0, parseInt(p.quantity, 10) || 0) : 0,
        line_note: p && p.line_note ? String(p.line_note) : null,
      }))
      .filter((x) => Number.isFinite(x.item_id) && x.quantity > 0);
    const extra = (inventoryPageState.outboundLinesByWarehouse[wid] || [])
      .filter((l) => l.item_id && l.quantity > 0)
      .map((l) => ({
        item_id: parseInt(l.item_id, 10),
        quantity: parseInt(l.quantity, 10),
        line_note: l.line_note || null,
      }));
    mergedAllLines.push(...fromCommon, ...extra);
  }
  const combinedLines = invMergeOutboundLines(mergedAllLines);
  if (Number.isFinite(editId)) {
    const lines = combinedLines;
    if (!whId || !lines.length) {
      showToast('请至少在当前仓库填写出库明细', 'warning');
      return;
    }
    const one = { ...baseBody, inv_warehouse_id: whId, lines };
    try {
      await api('PUT', `/inventory/outbound/${editId}`, one);
      showToast('已保存', 'success');
      inventoryPageState.editOutboundOrderId = null;
      inventoryPageState.outboundEditCommonPreset = null;
      inventoryPageState.outboundLines = [];
      inventoryPageState.outboundLinesByWarehouse = {};
      inventoryPageState.outboundCommonByWarehouse = {};
      inventoryPageState.outboundItemMetaByWarehouse = {};
      inventoryPageState.outboundForm = {
        linkMode: 'activity',
        project_code: '',
        purpose: '',
        activity_id: '',
        recipient_city: '',
        recipient_address: '',
        contact_name: '',
        contact_phone: '',
        logistics_method: INV_LOGISTICS_OPTS[0],
        tracking_number: '',
        remarks: '',
        hint_msg: '',
      };
      inventoryPageState.linkMode = 'activity';
      inventoryPageState.tab = 'outbound';
      if (!isInlineMode) closeModal();
      inventoryPageState.outboundInlineOpen = false;
      invSetOutboundModalTitle(false);
      document.getElementById('invOutboundModalBody') && (document.getElementById('invOutboundModalBody').innerHTML = '');
      updateBadges();
      await renderInventory();
    } catch (e) {
      showToast(e.message || '出库失败', 'error');
    }
    return;
  }
  if (!combinedLines.length) {
    showToast('请至少在一个仓库勾选/填写出库明细', 'warning');
    return;
  }
  try {
    const primaryWhId =
      Number.isFinite(whId) && whId > 0 ? whId : Number.parseInt([...whIds][0], 10) || null;
    const created = await api('POST', '/inventory/outbound', {
      ...baseBody,
      inv_warehouse_id: primaryWhId,
      lines: combinedLines,
    });
    if (lm === 'standalone') {
      const ord = created && created.order ? created.order : null;
      if (ord) {
        const whMap = new Map((inventoryPageState.outboundWarehousesCache || []).map((w) => [Number(w.id), w]));
        const logisticsCompany = baseBody.logistics_method || '物流';
        let sampleWh = null;
        for (const line of created.lines || []) {
          const c = whMap.get(Number(line.inv_warehouse_id));
          if (c) {
            sampleWh = c;
            break;
          }
        }
        try {
          await api('POST', '/logistics', {
            year_frame_id: currentYearFrameId || null,
            activity_id: null,
            merged_into_activity: 0,
            allocation_note: '物品出库-非活动用',
            logistics_company: logisticsCompany,
            brand: sampleWh?.brand_code || 'PHD',
            express_company: logisticsCompany,
            tracking_number: baseBody.tracking_number || null,
            origin_city: sampleWh ? `${sampleWh.region || ''}仓` : null,
            destination_city: baseBody.recipient_city || null,
            shipping_date: todayDateInputValue(),
            fee: 0,
            related_project_code: null,
            remarks: `${baseBody.purpose || ''}${baseBody.remarks ? `；${baseBody.remarks}` : ''} [INV-OB:${ord.id}]`,
            special_car: 0,
            monthly_settlement: 0,
          });
        } catch (_) {
          showToast('出库已完成，但物流成本记录创建失败，请在物流模块手动补录', 'warning');
        }
      }
    }
    showToast('出库成功', 'success');
    inventoryPageState.editOutboundOrderId = null;
    inventoryPageState.outboundEditCommonPreset = null;
    inventoryPageState.outboundLines = [];
    inventoryPageState.outboundLinesByWarehouse = {};
    inventoryPageState.outboundCommonByWarehouse = {};
    inventoryPageState.outboundItemMetaByWarehouse = {};
    inventoryPageState.outboundForm = {
      linkMode: 'activity',
      project_code: '',
      purpose: '',
      activity_id: '',
      recipient_city: '',
      recipient_address: '',
      contact_name: '',
      contact_phone: '',
      logistics_method: INV_LOGISTICS_OPTS[0],
      tracking_number: '',
      remarks: '',
      hint_msg: '',
    };
    inventoryPageState.linkMode = 'activity';
    inventoryPageState.tab = 'outbound';
    if (!isInlineMode) closeModal();
    inventoryPageState.outboundInlineOpen = false;
    invSetOutboundModalTitle(false);
    document.getElementById('invOutboundModalBody') && (document.getElementById('invOutboundModalBody').innerHTML = '');
    updateBadges();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '出库失败', 'error');
  }
}

/** 物资物料图片：仅上传，URL 存隐藏 textarea；支持追加 / 替换 */
let _invImgUpload = { scope: 'new', action: 'append', index: null };

function invItemImageUrlsRead(scope) {
  const id = scope === 'edit' ? 'invEditItemImages' : 'invItemImages';
  const el = document.getElementById(id);
  return (el && el.value ? el.value : '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function invItemImageUrlsWrite(scope, urls) {
  const id = scope === 'edit' ? 'invEditItemImages' : 'invItemImages';
  const el = document.getElementById(id);
  if (el) el.value = urls.join('\n');
}

function invRenderItemImagePreview(scope) {
  const wrapId = scope === 'edit' ? 'invEditItemImagePreview' : 'invItemImagePreview';
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const urls = invItemImageUrlsRead(scope);
  if (!urls.length) {
    wrap.innerHTML =
      scope === 'edit'
        ? '<span class="form-hint" style="font-size:12px;color:var(--text-muted)">暂无图片</span>'
        : '<span class="form-hint" style="font-size:12px">暂无图片，可添加多张</span>';
    return;
  }
  wrap.innerHTML = urls
    .map((url, i) => {
      const safe = escapeHtml(url);
      return `<div class="inv-img-tile">
        <div class="inv-img-tile-inner">
          <img src="${safe}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div class="inv-img-tile-actions">
            <button type="button" class="btn btn-xs btn-secondary" onclick="invQueueItemImageUpload('${scope}','replace',${i})">替换</button>
            <button type="button" class="btn btn-xs btn-ghost" style="color:var(--danger)" onclick="invRemoveItemImageAt('${scope}',${i})">删除</button>
          </div>
        </div>
      </div>`;
    })
    .join('');
}

function invQueueItemImageUpload(scope, action, index) {
  _invImgUpload = {
    scope,
    action: action === 'replace' ? 'replace' : 'append',
    index: index == null || index === '' ? null : Number(index),
  };
  const fid = scope === 'edit' ? 'invEditItemImageFile' : 'invItemImageFile';
  document.getElementById(fid)?.click();
}

function invRemoveItemImageAt(scope, index) {
  const urls = invItemImageUrlsRead(scope);
  const i = parseInt(index, 10);
  if (!Number.isFinite(i) || i < 0 || i >= urls.length) return;
  urls.splice(i, 1);
  invItemImageUrlsWrite(scope, urls);
  invRenderItemImagePreview(scope);
}

async function invHandleItemImageFile(e, scope) {
  const f = e.target?.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (_invImgUpload.scope !== scope) {
    _invImgUpload = { scope, action: 'append', index: null };
  }
  try {
    const url = await apiInventoryUpload(f);
    let urls = invItemImageUrlsRead(scope);
    const { action, index } = _invImgUpload;
    if (action === 'replace' && Number.isFinite(index) && index >= 0 && index < urls.length) {
      urls[index] = url;
    } else {
      urls.push(url);
    }
    invItemImageUrlsWrite(scope, urls);
    invRenderItemImagePreview(scope);
    showToast(action === 'replace' ? '已替换图片' : '图片已添加', 'success');
  } catch (err) {
    showToast(err.message || '上传失败', 'error');
  }
  _invImgUpload = { scope, action: 'append', index: null };
}

function invCancelEditItem() {
  inventoryPageState.itemModalMode = null;
  const body = document.getElementById('invItemEditModalBody');
  if (body) body.innerHTML = '';
  if (activeModal === 'modalInvItemEdit') {
    closeModal();
  }
}

/** 留空表示 null（沿用归还汇总或未设预警）；非法输入则抛错 */
function invOptionalNonNegIntOrNullInput(elId, label) {
  const el = document.getElementById(elId);
  if (!el) return null;
  const s = String(el.value ?? '').trim();
  if (s === '') return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label}须为非负整数或留空`);
  }
  return n;
}

/**
 * 与「归还登记汇总」相同则不写入覆盖列（NULL）；不同则写入（含 0）。
 * 留空（parsed=null）表示取消手工覆盖，仍按归还汇总。
 */
function invMergeStatOverride(parsed, aggFromReturns) {
  if (parsed === null) return null;
  const a = Number.isFinite(aggFromReturns) ? Math.trunc(aggFromReturns) : 0;
  if (parsed === a) return null;
  return parsed;
}

function invItemModalFormHtml(opts) {
  const { mode, it } = opts;
  const urls = it && Array.isArray(it.image_urls) ? it.image_urls.join('\n') : '';
  const common = it && invItemIsCommon(it);
  const aggDmg =
    it && it.aggregated_total_damaged != null ? invStatQty(it.aggregated_total_damaged) : it ? invStatQty(it.total_damaged) : 0;
  const aggLost =
    it && it.aggregated_total_lost != null ? invStatQty(it.aggregated_total_lost) : it ? invStatQty(it.total_lost) : 0;
  /** 与列表/详情一致：已合并覆盖后的展示值 */
  const effDmg = it ? invStatQty(it.total_damaged) : 0;
  const effLost = it ? invStatQty(it.total_lost) : 0;
  const dmgVal = mode === 'edit' ? String(effDmg) : '';
  const lostVal = mode === 'edit' ? String(effLost) : '';
  const statRow =
    mode === 'edit'
      ? `
      <div class="inv-item-edit-stat-row">
        <input type="hidden" id="invAggDamaged" value="${aggDmg}">
        <input type="hidden" id="invAggLost" value="${aggLost}">
        <div class="form-group">
          <label class="form-label">损坏（累计）</label>
          <input type="number" class="form-control" id="invEditItemDamagedOverride" min="0" step="1" value="${escapeHtml(
            dmgVal
          )}" placeholder="归还汇总 ${aggDmg}" title="与归还汇总一致可不存覆盖；填 0 表示强制为 0；整格清空表示仍按归还汇总">
        </div>
        <div class="form-group">
          <label class="form-label">丢失（累计）</label>
          <input type="number" class="form-control" id="invEditItemLostOverride" min="0" step="1" value="${escapeHtml(
            lostVal
          )}" placeholder="归还汇总 ${aggLost}" title="与归还汇总一致可不存覆盖；填 0 表示强制为 0；整格清空表示仍按归还汇总">
        </div>
      </div>`
      : '';
  const idVal = it && it.id != null ? String(it.id) : '';
  const nameVal = it && it.name != null ? escapeHtml(it.name) : '';
  const dimVal = it && it.dimensions != null ? escapeHtml(it.dimensions) : '';
  const qtyVal = it && it.quantity_on_hand != null ? Number(it.quantity_on_hand) || 0 : 0;
  const descVal = it && it.description != null ? escapeHtml(it.description) : '';
  const alertVal =
    it && it.alert_below != null && it.alert_below !== '' ? String(Math.max(0, parseInt(it.alert_below, 10) || 0)) : '';
  return `
    <div class="inv-item-modal-form">
      <input type="hidden" id="invEditItemId" value="${escapeHtml(idVal)}">
      <div class="form-group">
        <label class="form-label">物品名称 <span class="required">*</span></label>
        <input class="form-control" id="invEditItemName" value="${nameVal}">
      </div>
      ${statRow}
      <div class="inv-item-edit-core-row">
        <div class="form-group">
          <label class="form-label">规格</label>
          <input class="form-control" id="invEditItemDim" placeholder="如 100×50×30 cm" value="${dimVal}">
        </div>
        <div class="form-group">
          <label class="form-label">库存</label>
          <input type="number" class="form-control" id="invEditItemQty" min="0" step="1" value="${qtyVal}">
        </div>
        <div class="form-group">
          <label class="form-label">库存预警线</label>
          <input type="number" class="form-control" id="invEditItemAlertBelow" min="0" step="1" value="${escapeHtml(
            alertVal
          )}" placeholder="低于此数量时标黄提示，可留空">
        </div>
      </div>
      <div class="form-group inv-item-edit-common-row">
        <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0;font-weight:500">
          <input type="checkbox" id="invEditItemIsCommon" ${common ? 'checked' : ''}>
          <span>常用物料</span>
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">备注</label>
        <textarea class="form-control" id="invEditItemDesc" rows="2">${descVal}</textarea>
      </div>
      <div class="form-group inv-item-edit-images-block">
        <div id="invEditItemImagePreview" class="inv-item-images-preview"></div>
        <button type="button" class="btn btn-secondary inv-item-add-img-btn" onclick="invQueueItemImageUpload('edit','append')">添加图片</button>
        <input type="file" id="invEditItemImageFile" accept="image/*" style="display:none" onchange="invHandleItemImageFile(event,'edit')">
        <textarea id="invEditItemImages" style="display:none" aria-hidden="true">${escapeHtml(urls)}</textarea>
      </div>
      <div class="inv-item-edit-save-row">
        <button type="button" class="btn btn-primary inv-item-save-btn" id="invItemSaveBtn" onclick="invSaveEditItem()">${mode === 'new' ? '保存' : '保存修改'}</button>
        <button type="button" class="btn btn-secondary" onclick="invCancelEditItem()">取消</button>
      </div>
    </div>`;
}

async function invOpenEditItem(itemId) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可编辑库存主数据', 'warning');
    return;
  }
  const body = document.getElementById('invItemEditModalBody');
  if (!body) return;
  let it;
  try {
    it = await api('GET', `/inventory/items/${itemId}`);
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
    return;
  }
  if (inventoryPageState.warehouseId && Number(it.inv_warehouse_id) !== Number(inventoryPageState.warehouseId)) {
    showToast('该物品不属于当前所选仓库', 'warning');
    return;
  }
  inventoryPageState.itemModalMode = 'edit';
  const mt = document.getElementById('invItemModalTitle');
  if (mt) mt.textContent = '编辑物品';
  body.innerHTML = invItemModalFormHtml({ mode: 'edit', it });
  invRenderItemImagePreview('edit');
  openModal('modalInvItemEdit');
  renderLucideIcons();
}

function invOpenNewItemModal() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可添加物料', 'warning');
    return;
  }
  if (!inventoryPageState.warehouseId) {
    showToast('请先点击仓库卡片', 'warning');
    return;
  }
  const body = document.getElementById('invItemEditModalBody');
  if (!body) return;
  inventoryPageState.itemModalMode = 'new';
  const mt = document.getElementById('invItemModalTitle');
  if (mt) mt.textContent = '添加物品';
  body.innerHTML = invItemModalFormHtml({ mode: 'new', it: null });
  invRenderItemImagePreview('edit');
  openModal('modalInvItemEdit');
  renderLucideIcons();
}

async function invOpenAddWineModal() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可添加酒品到仓库', 'warning');
    return;
  }
  const whId = Number(inventoryPageState.warehouseId || 0);
  if (!whId) {
    showToast('请先点击仓库卡片', 'warning');
    return;
  }
  const body = document.getElementById('invAddWineModalBody');
  if (!body) return;
  body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">加载酒品目录中...</div>';
  openModal('modalInvAddWine');
  try {
    const [catalog, warehouses] = await Promise.all([
      api('GET', '/wine/catalog'),
      api('GET', '/inventory/warehouses'),
    ]);
    invAddWineModalState.catalog = Array.isArray(catalog) ? catalog : [];
    invAddWineModalState.warehouses = Array.isArray(warehouses) ? warehouses : [];
    invAddWineModalState.warehouseId = whId;
    invAddWineModalState.search = '';
    if (!invAddWineModalState.warehouses.some((w) => Number(w.id) === whId)) {
      invAddWineModalState.warehouseId = Number(invAddWineModalState.warehouses[0]?.id || 0) || null;
    }
    await invRenderAddWineModalContent();
  } catch (e) {
    body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

async function invRenderAddWineModalContent() {
  const body = document.getElementById('invAddWineModalBody');
  if (!body) return;
  const whId = Number(invAddWineModalState.warehouseId || 0);
  if (!whId) {
    body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">暂无可用仓库，请先创建仓库。</div>';
    return;
  }
  const wh = (invAddWineModalState.warehouses || []).find((w) => Number(w.id) === whId);
  const items = await api('GET', `/inventory/items?inv_warehouse_id=${whId}`);
  const exists = new Set(
    (items || []).map((it) => `${String(it.name || '').trim()}@@${String(it.dimensions || '').trim()}`),
  );
  const rows = (invAddWineModalState.catalog || []).map((c) => {
    const spec = [c.category, c.volume_label].filter((x) => String(x || '').trim()).join(' · ');
    const key = `${String(c.name || '').trim()}@@${String(spec || '').trim()}`;
    const already = exists.has(key);
    const img =
      Array.isArray(c.image_urls) && c.image_urls[0]
        ? `<img src="${escapeHtml(c.image_urls[0])}" alt="" style="width:40px;height:40px;object-fit:contain;border-radius:6px;background:var(--bg-primary)">`
        : '<span style="color:var(--text-muted)">—</span>';
    const searchText = [c.brand, c.name, spec]
      .map((x) => String(x || '').trim().toLowerCase())
      .filter(Boolean)
      .join(' ');
    return `
      <tr data-catalog-id="${c.id}" data-search="${escapeHtml(searchText)}">
        <td>${img}</td>
        <td>${escapeHtml(c.brand || '—')}</td>
        <td style="font-weight:600">${escapeHtml(c.name || '—')}</td>
        <td>${escapeHtml(spec || '—')}</td>
        <td style="text-align:center">
          ${already ? `<span style="font-size:12px;color:var(--text-muted)">已在仓库</span>` : `<input type="checkbox" class="inv-add-wine-ck" data-catalog-id="${c.id}">`}
        </td>
        <td style="width:100px">
          ${already ? '<span style="color:var(--text-muted);font-size:12px">—</span>' : `<input type="number" class="form-control inv-add-wine-qty" data-catalog-id="${c.id}" min="0" step="1" value="0" placeholder="0">`}
        </td>
      </tr>`;
  });
  const whOpts = (invAddWineModalState.warehouses || [])
    .map((w) => `<option value="${w.id}" ${Number(w.id) === whId ? 'selected' : ''}>${escapeHtml(`${invWarehouseBrandDisplay(w) || ''} · ${w.region || ''}${w.label ? ` · ${w.label}` : ''}`)}</option>`)
    .join('');
  body.innerHTML = `
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">目标仓库</label>
      <select class="form-control" id="invAddWineWarehouse" onchange="invOnAddWineWarehouseChange(this.value)">
        ${whOpts}
      </select>
    </div>
    <div class="form-hint" style="margin:0 0 10px">
      当前仓库：<strong>${escapeHtml(wh ? `${invWarehouseBrandDisplay(wh)} · ${wh.region}` : `#${whId}`)}</strong>。可手动勾选目录酒品加入该仓库；数量可填 0，后续再调整。
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <button type="button" class="btn btn-secondary btn-xs" onclick="invAddWineToggleAll(true)">全选可添加</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="invAddWineToggleAll(false)">全不选</button>
      <input
        type="text"
        class="form-control"
        id="invAddWineSearch"
        value="${escapeHtml(invAddWineModalState.search || '')}"
        placeholder="搜索品牌/名称/类别容量"
        style="margin-left:auto;max-width:280px"
        oninput="invFilterAddWineRows(this.value)"
      >
    </div>
    <div class="table-wrapper" style="max-height:52vh;overflow:auto">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:52px">图</th>
            <th>品牌</th>
            <th>名称</th>
            <th>类别·容量</th>
            <th style="width:96px;text-align:center">加入</th>
            <th style="width:110px">初始数量</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
  invFilterAddWineRows(invAddWineModalState.search || '');
}

function invFilterAddWineRows(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  invAddWineModalState.search = kw;
  document.querySelectorAll('#invAddWineModalBody tbody tr[data-search]').forEach((tr) => {
    const hay = String(tr.getAttribute('data-search') || '').toLowerCase();
    tr.style.display = !kw || hay.includes(kw) ? '' : 'none';
  });
}

async function invOnAddWineWarehouseChange(warehouseId) {
  const id = parseInt(warehouseId, 10);
  if (!Number.isFinite(id)) return;
  invAddWineModalState.warehouseId = id;
  const body = document.getElementById('invAddWineModalBody');
  if (body) body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">切换仓库中...</div>';
  try {
    await invRenderAddWineModalContent();
  } catch (e) {
    if (body) body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

function invAddWineToggleAll(checked) {
  document.querySelectorAll('.inv-add-wine-ck').forEach((el) => {
    el.checked = !!checked;
  });
}

async function invSubmitAddWineToWarehouse() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可添加酒品到仓库', 'warning');
    return;
  }
  const whId = Number(
    document.getElementById('invAddWineWarehouse')?.value || invAddWineModalState.warehouseId || inventoryPageState.warehouseId || 0,
  );
  if (!whId) {
    showToast('请先选择仓库', 'warning');
    return;
  }
  const picked = [];
  document.querySelectorAll('.inv-add-wine-ck:checked').forEach((ck) => {
    const catalogId = parseInt(ck.dataset.catalogId, 10);
    if (!Number.isFinite(catalogId) || catalogId <= 0) return;
    const qtyEl = document.querySelector(`.inv-add-wine-qty[data-catalog-id="${catalogId}"]`);
    const q = parseInt(qtyEl?.value, 10);
    picked.push({ catalog_id: catalogId, quantity: Number.isFinite(q) && q >= 0 ? q : 0 });
  });
  if (!picked.length) {
    showToast('请先勾选要添加的酒品', 'warning');
    return;
  }
  try {
    const ret = await api('POST', '/inventory/items/from-catalog', {
      inv_warehouse_id: whId,
      items: picked,
    });
    inventoryPageState.warehouseId = whId;
    showToast(
      `已添加 ${ret.inserted || 0} 条；已存在 ${ret.skipped_existing || 0} 条`,
      'success',
    );
    closeModal();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '添加失败', 'error');
  }
}

function invCapturePageScrollPosition(anchorItemId) {
  const container = document.getElementById('pageContainer');
  const scrollingEl = document.scrollingElement || document.documentElement;
  const listWrap = container ? container.querySelector('.inv-items-table-wrap') : null;
  const normalizedAnchorId = Number(anchorItemId);
  const anchorEl =
    container && Number.isFinite(normalizedAnchorId) && normalizedAnchorId > 0
      ? container.querySelector(`[data-item-id="${normalizedAnchorId}"]`)
      : null;
  return {
    containerTop: container ? container.scrollTop : null,
    pageTop: Math.max(0, window.scrollY || scrollingEl?.scrollTop || 0),
    listWrapTop: listWrap ? listWrap.scrollTop : null,
    anchorItemId: Number.isFinite(normalizedAnchorId) && normalizedAnchorId > 0 ? normalizedAnchorId : null,
    anchorTop: anchorEl ? anchorEl.getBoundingClientRect().top : null,
  };
}

function invRestorePageScrollPosition(snapshot) {
  if (!snapshot) return;
  const restoreOnce = () => {
    const container = document.getElementById('pageContainer');
    if (container && Number.isFinite(snapshot.containerTop)) {
      container.scrollTop = Math.max(0, snapshot.containerTop);
    }
    const listWrap = container ? container.querySelector('.inv-items-table-wrap') : null;
    if (listWrap && Number.isFinite(snapshot.listWrapTop)) {
      listWrap.scrollTop = Math.max(0, snapshot.listWrapTop);
    }
    const targetTop = Number.isFinite(snapshot.pageTop) ? Math.max(0, snapshot.pageTop) : 0;
    window.scrollTo(0, targetTop);
    if (container && snapshot.anchorItemId && Number.isFinite(snapshot.anchorTop)) {
      const anchorEl = container.querySelector(`[data-item-id="${snapshot.anchorItemId}"]`);
      if (anchorEl) {
        const nowTop = anchorEl.getBoundingClientRect().top;
        const delta = nowTop - snapshot.anchorTop;
        if (Math.abs(delta) > 1) window.scrollBy(0, delta);
      }
    }
  };
  requestAnimationFrame(() => {
    restoreOnce();
    requestAnimationFrame(restoreOnce);
  });
}

async function invSaveEditItem() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可保存库存主数据', 'warning');
    return;
  }
  const mode = inventoryPageState.itemModalMode;
  const idRaw = document.getElementById('invEditItemId')?.value;
  const id = parseInt(idRaw, 10);
  const name = document.getElementById('invEditItemName')?.value?.trim();
  const qty = parseInt(document.getElementById('invEditItemQty')?.value, 10);
  const urls = (document.getElementById('invEditItemImages')?.value || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!name) {
    showToast('请填写物品名称', 'warning');
    return;
  }
  if (!Number.isFinite(qty) || qty < 0) {
    showToast('库存须为非负整数', 'warning');
    return;
  }
  let alertBelow;
  let statsDamagedOverride;
  let statsLostOverride;
  try {
    alertBelow = invOptionalNonNegIntOrNullInput('invEditItemAlertBelow', '库存预警线');
    statsDamagedOverride = invOptionalNonNegIntOrNullInput('invEditItemDamagedOverride', '损坏（累计）');
    statsLostOverride = invOptionalNonNegIntOrNullInput('invEditItemLostOverride', '丢失（累计）');
  } catch (err) {
    showToast(err.message || '输入无效', 'warning');
    return;
  }
  if (mode !== 'new' && Number.isFinite(id) && id > 0) {
    const aggDEl = document.getElementById('invAggDamaged');
    const aggLEl = document.getElementById('invAggLost');
    if (aggDEl && aggLEl) {
      const aggD = parseInt(String(aggDEl.value ?? '0'), 10);
      const aggL = parseInt(String(aggLEl.value ?? '0'), 10);
      statsDamagedOverride = invMergeStatOverride(statsDamagedOverride, Number.isFinite(aggD) ? aggD : 0);
      statsLostOverride = invMergeStatOverride(statsLostOverride, Number.isFinite(aggL) ? aggL : 0);
    }
  }
  const pageScrollSnapshot = invCapturePageScrollPosition(Number.isFinite(id) && id > 0 ? id : null);
  try {
    if (mode === 'new' || !Number.isFinite(id) || id <= 0) {
      if (!inventoryPageState.warehouseId) {
        showToast('请先点击仓库卡片', 'warning');
        return;
      }
      await api('POST', '/inventory/items', {
        inv_warehouse_id: inventoryPageState.warehouseId,
        name,
        initial_quantity: qty,
        dimensions: document.getElementById('invEditItemDim')?.value || null,
        description: document.getElementById('invEditItemDesc')?.value || null,
        alert_below: alertBelow,
        image_urls: urls,
        is_common: document.getElementById('invEditItemIsCommon')?.checked === true,
      });
      showToast('已添加', 'success');
    } else {
      await api('PUT', `/inventory/items/${id}`, {
        name,
        quantity_on_hand: qty,
        dimensions: document.getElementById('invEditItemDim')?.value || null,
        description: document.getElementById('invEditItemDesc')?.value || null,
        alert_below: alertBelow,
        image_urls: urls,
        is_common: document.getElementById('invEditItemIsCommon')?.checked === true,
        stats_damaged_override: statsDamagedOverride,
        stats_lost_override: statsLostOverride,
      });
      showToast('已保存', 'success');
    }
    invCancelEditItem();
    await renderInventory();
    invRestorePageScrollPosition(pageScrollSnapshot);
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

async function invDeleteItem(id) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除物料', 'warning');
    return;
  }
  if (!window.confirm('删除该物料？')) return;
  const pageScrollSnapshot = invCapturePageScrollPosition(id);
  try {
    await api('DELETE', `/inventory/items/${id}`);
    showToast('已删除', 'success');
    await renderInventory();
    invRestorePageScrollPosition(pageScrollSnapshot);
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

async function invOpenReturn(orderId) {
  const body = document.getElementById('invReturnModalBody');
  const title = document.getElementById('invReturnModalTitle');
  if (!body) return;
  body.innerHTML = '<div class="empty-state">加载中…</div>';
  if (title) title.textContent = `归还登记`;
  try {
    inventoryPageState.returnDetail = await api('GET', `/inventory/outbound/${orderId}`);
    inventoryPageState.returnOrderId = orderId;
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
    return;
  }
  const rd = inventoryPageState.returnDetail;
  const lines = Array.isArray(rd?.lines) ? rd.lines : [];
  const doneByLine = new Map();
  (rd?.batches || []).forEach((b) => {
    (b?.lines || []).forEach((rl) => {
      const lid = Number(rl.outbound_line_id);
      if (!Number.isFinite(lid)) return;
      const done =
        (parseInt(rl.qty_return, 10) || 0) +
        (parseInt(rl.qty_lost, 10) || 0) +
        (parseInt(rl.qty_damaged, 10) || 0) +
        (parseInt(rl.qty_empty_recovered, 10) || 0) +
        (parseInt(rl.qty_customer_keep, 10) || 0);
      doneByLine.set(lid, (doneByLine.get(lid) || 0) + Math.max(0, done));
    });
  });
  const rows = lines
    .map((ln) => {
      const shipped = Number(ln.quantity) || 0;
      const done = doneByLine.get(Number(ln.id)) || 0;
      const remain = Math.max(0, shipped - done);
      return `
      <tr>
        <td>${escapeHtml(ln.item_name)}<input type="hidden" id="ret_max_${ln.id}" value="${remain}"></td>
        <td>${shipped}</td>
        <td>${done}</td>
        <td>${remain}</td>
        <td><input type="number" class="form-control" min="0" id="ret_ok_${ln.id}" value="0"></td>
        <td><input type="number" class="form-control" min="0" id="ret_lost_${ln.id}" value="0"></td>
        <td><input type="number" class="form-control" min="0" id="ret_dmg_${ln.id}" value="0"></td>
        <td><input type="number" class="form-control" min="0" id="ret_empty_${ln.id}" value="0"></td>
        <td><input type="number" class="form-control" min="0" id="ret_keep_${ln.id}" value="0"></td>
      </tr>`;
    })
    .join('');
  const order = rd?.order || {};
  const projLine =
    order.link_mode === 'standalone'
      ? escapeHtml(order.purpose || '—')
      : escapeHtml(order.project_code || '—');
  body.innerHTML = `
    <div class="modal-activity-form">
      <p class="modal-activity-lead">请填写归还、丢失、损坏、空瓶回收、留给客户数量，五项合计不能超过该物料出库数量。仅「空瓶回收」会增加空瓶库存，其它项均按消耗记录。</p>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">出库单</label>
          <input class="form-control" value="#${inventoryPageState.returnOrderId}" readonly>
        </div>
        <div class="form-group">
          <label class="form-label">项目/用途</label>
          <input class="form-control" value="${projLine}" readonly>
        </div>
        <div class="form-group">
          <label class="form-label">归还日期</label>
          <input type="date" class="form-control" id="invReturnDate" value="${new Date().toISOString().slice(0, 10)}">
        </div>
        <div class="form-group">
          <label class="form-label">备注</label>
          <input type="text" class="form-control" id="invReturnRemarks" placeholder="可选">
        </div>
      </div>
      <div class="table-wrapper" style="margin-top:14px;overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>物料</th><th>出库数</th><th>已登记</th><th>剩余可登记</th><th>归还</th><th>丢失</th><th>损坏</th><th>空瓶回收</th><th>留给客户</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="9" style="color:var(--text-muted)">无可归还明细</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
  openModal('modalInvReturn');
}

function invCancelReturnForm() {
  inventoryPageState.returnDetail = null;
  inventoryPageState.returnOrderId = null;
  closeModal();
}

async function invSubmitReturn() {
  const oid = inventoryPageState.returnOrderId;
  if (!oid) return;
  const detail = inventoryPageState.returnDetail;
  if (!detail || !Array.isArray(detail.lines)) {
    showToast('数据已过期，请重新打开归还', 'warning');
    return;
  }
  const lines = (detail.lines || []).map((ln) => {
    const qty_return = parseInt(document.getElementById(`ret_ok_${ln.id}`)?.value, 10) || 0;
    const qty_lost = parseInt(document.getElementById(`ret_lost_${ln.id}`)?.value, 10) || 0;
    const qty_damaged = parseInt(document.getElementById(`ret_dmg_${ln.id}`)?.value, 10) || 0;
    const qty_empty_recovered = parseInt(document.getElementById(`ret_empty_${ln.id}`)?.value, 10) || 0;
    const qty_customer_keep = parseInt(document.getElementById(`ret_keep_${ln.id}`)?.value, 10) || 0;
    const max = parseInt(document.getElementById(`ret_max_${ln.id}`)?.value, 10) || 0;
    const entered = qty_return + qty_lost + qty_damaged + qty_empty_recovered + qty_customer_keep;
    if (entered > max) {
      throw new Error(`「${ln.item_name || `明细#${ln.id}`}」本次登记 ${entered}，超过剩余可登记 ${max}`);
    }
    return {
      outbound_line_id: ln.id,
      qty_return,
      qty_lost,
      qty_damaged,
      qty_empty_recovered,
      qty_customer_keep,
    };
  });
  const body = {
    return_date: document.getElementById('invReturnDate')?.value || new Date().toISOString().slice(0, 10),
    remarks: document.getElementById('invReturnRemarks')?.value || null,
    lines,
  };
  try {
    await api('POST', `/inventory/outbound/${oid}/returns`, body);
    showToast('归还已登记', 'success');
    inventoryPageState.returnOrderId = null;
    inventoryPageState.returnDetail = null;
    closeModal();
    updateBadges();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '失败', 'error');
  }
}

/** 出库单 PDF 接口地址；?download=1 时服务端返回 attachment（仅用于按需下载，预览用 fetch+blob，避免误触发下载） */
function invOutboundPdfUrl(id, download) {
  const base = `${API}/inventory/outbound/${id}/pdf`;
  return download ? `${base}?download=1` : base;
}

let invPdfPreviewBlob = null;

function invRevokePdfPreviewBlobUrl() {
  const frame = document.getElementById('invOutboundPdfFrame');
  if (frame && frame.dataset.pdfBlobUrl) {
    URL.revokeObjectURL(frame.dataset.pdfBlobUrl);
    delete frame.dataset.pdfBlobUrl;
  }
  invPdfPreviewBlob = null;
}

function invFilenameFromDisposition(cd, fallbackName) {
  const raw = String(cd || '');
  if (!raw) return fallbackName;
  // RFC 5987: filename*=UTF-8''...
  const star = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star && star[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, ''));
    } catch (_) {
      return star[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  // fallback: filename="..."
  const normal = raw.match(/filename\s*=\s*("?)([^";]+)\1/i);
  if (normal && normal[2]) return normal[2].trim();
  return fallbackName;
}

function invResetOutboundPdfModal() {
  invRevokePdfPreviewBlobUrl();
  const frame = document.getElementById('invOutboundPdfFrame');
  if (frame) frame.src = 'about:blank';
  const body = document.getElementById('invOutboundPdfBody');
  if (body) {
    body.classList.add('inv-pdf-loading');
    const ld = document.getElementById('invOutboundPdfLoading');
    if (ld) ld.textContent = '加载中…';
  }
  const dlBtn = document.getElementById('invOutboundPdfDownloadBtn');
  if (dlBtn) {
    dlBtn.disabled = true;
    dlBtn.onclick = null;
  }
}

async function invDownloadPdf(id) {
  const titleEl = document.getElementById('invOutboundPdfTitle');
  const frame = document.getElementById('invOutboundPdfFrame');
  const dlBtn = document.getElementById('invOutboundPdfDownloadBtn');
  const body = document.getElementById('invOutboundPdfBody');
  const loadingEl = document.getElementById('invOutboundPdfLoading');

  if (titleEl) titleEl.textContent = `出库单 #${id} 预览`;
  invRevokePdfPreviewBlobUrl();
  if (frame) frame.src = 'about:blank';
  if (body) body.classList.remove('inv-pdf-loading');
  if (loadingEl) loadingEl.textContent = '加载中…';
  if (dlBtn) {
    dlBtn.disabled = true;
    dlBtn.onclick = null;
  }

  try {
    const res = await fetch(invOutboundPdfUrl(id, false), { credentials: 'include' });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) {
      let msg = `加载失败 (${res.status})`;
      if (ct.includes('json')) {
        try {
          const j = await res.json();
          if (j && j.error) msg = j.error;
        } catch (_) { /* ignore */ }
      }
      throw new Error(msg);
    }
    if (!ct.includes('pdf') && !ct.includes('octet-stream')) {
      const t = await res.text();
      throw new Error(t.slice(0, 160) || '服务器未返回 PDF');
    }
    const downloadName = invFilenameFromDisposition(
      res.headers.get('content-disposition'),
      `出库单_${id}.pdf`
    );
    const blob = await res.blob();
    invPdfPreviewBlob = blob;
    const blobUrl = URL.createObjectURL(blob);
    if (frame) {
      frame.dataset.pdfBlobUrl = blobUrl;
      frame.src = blobUrl;
    }
    if (body) body.classList.remove('inv-pdf-loading');
    if (dlBtn) {
      dlBtn.disabled = false;
      dlBtn.onclick = () => {
        if (!invPdfPreviewBlob) return;
        const url = URL.createObjectURL(invPdfPreviewBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = downloadName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      };
    }
    requestAnimationFrame(() => {
      openModal('modalInvOutboundPdf');
    });
  } catch (e) {
    if (loadingEl) loadingEl.textContent = e.message || '加载失败';
    if (body) body.classList.add('inv-pdf-loading');
    showToast(e.message || 'PDF 加载失败', 'error');
  }
}


