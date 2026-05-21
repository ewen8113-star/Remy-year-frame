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
let materialDashboardState = {
  open: true,
  keyword: '',
  brand: '',
  category: '',
  detailRowsFY: [],
  fy: null,
  topLimit: 10,
};
let propRepairPageState = { filterBrandId: '' };
let reimbursementPageState = { rows: [], paymentOrders: [], activities: [], filterInput: '', view: 'registrations', selectedIds: new Set() };
/** 付款申请 · 成本登记列表行内展开 */
let reimbursementListExpanded = new Set();
let paymentOrderState = { candidates: [], selectedKeys: new Set(), previewRows: [] };
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
  { value: 'logistics', label: '物流成本' },
  { value: 'prop_repair', label: '道具维修成本' },
  { value: 'material_purchase', label: '额外成本' },
  { value: 'general', label: '内部成本' },
];
const REIMB_CLAIM_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'submitted', label: '待支付' },
  { value: 'paid', label: '已支付' },
];

function reimbPaymentTypeLabel(v) {
  return REIMB_PAYMENT_TYPE_OPTIONS.find((x) => x.value === v)?.label || '个人报销';
}
function reimbCostModuleLabel(v) {
  if (v === 'warehouse') return '仓储成本（月结）';
  return REIMB_COST_MODULE_OPTIONS.find((x) => x.value === v)?.label || '活动成本';
}
function reimbClaimStatusLabel(v) {
  if (v === 'rejected') return '已驳回';
  return REIMB_CLAIM_STATUS_OPTIONS.find((x) => x.value === v)?.label || '草稿';
}
function reimbClaimStatusBadgeClass(v) {
  if (v === 'paid') return 'badge-success';
  if (v === 'submitted') return 'badge-accent';
  if (v === 'rejected') return 'badge-danger';
  return 'badge-gray';
}

function paymentSourceLabel(v) {
  const map = {
    warehouse: '仓储',
    logistics: '物流',
    material_purchase: '物料采购',
    prop_repair: '道具维修',
    reimbursement: '成本登记',
  };
  return map[v] || v || '—';
}

function paymentStatusHtml(v, orderId) {
  if (String(v || '') === 'paid') {
    const suffix = orderId ? ` #${escapeHtml(orderId)}` : '';
    return `<span class="badge badge-success">已支付${suffix}</span>`;
  }
  return '<span class="badge badge-gray">未支付</span>';
}

function yearFrameDisplayLabel(frame) {
  const raw = String(frame?.year || frame?.name || '').trim();
  const yy = (raw.match(/\d{2}/) || [String(currentYear || '').padStart(2, '0')])[0];
  return yy ? `${yy}年度` : String(frame?.id || '');
}
const REIMB_DETAIL_META_PREFIX = '\n\n[REIMB_DETAIL_JSON]';
const REIMB_DETAIL_META_MARKER = '[REIMB_DETAIL_JSON]';
const REIMB_DETAIL_BLOCKS = [
  { value: 'personnel', label: '人员' },
  { value: 'travel', label: '差旅' },
  { value: 'stage', label: '舞美制作' },
  { value: 'print', label: '画面制作' },
  { value: 'purchase', label: '采购' },
  { value: 'logistics', label: '物流' },
  { value: 'advance', label: '垫付' },
];
const REIMB_DETAIL_CATEGORY_OPTIONS = {
  personnel: [
    ['supervisor', '督导'], ['pg', 'PG礼仪'], ['parttime', '兼职'], ['bartender', '调酒师'],
    ['photo', '摄影师'], ['cloud_album_edit', '云相册修图'], ['performance', '演职人员'], ['makeup', '化妆师'],
  ],
  travel: [['travel_supervisor', '督导差旅'], ['travel_company', '盛融差旅']],
  stage: [['structure', '结构制作/搭建'], ['av', 'AV灯光音响']],
  print: [['print', '印刷/快印'], ['spray', '写真/喷绘']],
  purchase: [['floral', '花艺'], ['payment', '活动物料'], ['tasting', '品鉴物料']],
  logistics: [['express', '快递/闪送'], ['logistics', '物流']],
  advance: [['venue_fee', '场地费'], ['meal_fee', '餐费'], ['other_advance', '其他']],
};
const REIMB_DETAIL_BRAND_OPTIONS = [
  'N230530-RM Club',
  'N220630-RC PHD',
  'N230901-RM XO',
  '内部',
  'Remy-RC',
  '其他',
];
function reimbDetailBrandFromLegacyBrand(brand) {
  const b = String(brand || '').trim().toUpperCase();
  if (b === 'PHD') return 'N220630-RC PHD';
  if (b === 'X.O' || b === 'XO') return 'N230901-RM XO';
  if (b === 'CLUB') return 'N230530-RM Club';
  if (b === 'RC' || b === 'REMY-RC') return 'Remy-RC';
  if (b === 'REMY' || b === 'VSOP') return '内部';
  return '';
}
let logisticsState = { data: [], selectedIds: new Set() };
let warehouseState = { data: [], selectedIds: new Set() };
let logisticsSortState = { key: 'shipping_date', dir: 'desc' };
let warehouseMergeFilter = 'all';
/** @type {'legacy'|'period_quote'} 仓储弹窗：传统按天 / 账期按月报价 */
let warehouseFormMode = 'legacy';
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
    shipped_at: '',
    activity_date: '',
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
  /** 物品出库台账搜索关键词：可按物品名/项目编号/收件人/单号/用途/仓库等模糊过滤 */
  outboundSearch: '',
  outboundMonthFilter: 'all',
  /** 物品出库台账数据缓存：用于搜索时本地过滤，避免重复请求 */
  _outboundListCache: [],
  inboundDirectRows: [],
  inboundEditId: null,
  /** 物品入库：已入库 / 待入库 月份筛选与分页 */
  inboundLedgerMonthFilter: 'all',
  inboundPendingMonthFilter: 'all',
  inboundLedgerPage: 1,
  inboundPendingPage: 1,
  _inboundLedgerCache: [],
  _inboundPendingCache: [],
};

const INV_INBOUND_PAGE_SIZE = 10;

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
      '[onclick*="showReimbursementForm"]',
      '[onclick*="showCorporatePaymentTodo"]',
      '[onclick*="saveReimbursementForm"]',
      '[onclick*="deleteReimbursementRecord"]',
      '[onclick*="reimbAppendInvoiceRow"]',
      '[onclick*="reimbRemoveInvoiceRow"]',
      '[onclick*="reimbAppendDetailRow"]',
      '[onclick*="reimbRemoveDetailRow"]',
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
    pgFlag: '',
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
    material: '额外成本',
    'prop-repair': '道具维修',
    reimbursement: '付款申请',
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
    material: renderMaterialPurchases,
    'prop-repair': renderPropRepairs,
    reimbursement: renderReimbursements,
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
    inventory: 'stock',
    'inv-outbound': 'stock',
    'inv-inbound': 'stock',
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
  const t = type === 'danger' ? 'error' : type;
  const icons = {
    success: '<i data-lucide="circle-check-big" style="width:14px;height:14px"></i>',
    error: '<i data-lucide="circle-x" style="width:14px;height:14px"></i>',
    warning: '<i data-lucide="triangle-alert" style="width:14px;height:14px"></i>',
    info: '<i data-lucide="info" style="width:14px;height:14px"></i>',
  };
  const el = document.createElement('div');
  el.className = `toast ${t}`;
  el.innerHTML = `<span>${icons[t] || ''}</span><span>${msg}</span>`;
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

function roundMoney2(v) {
  return Math.round((parseFloat(v) || 0) * 100) / 100;
}

function fmtMoney(v) {
  const n = roundMoney2(v);
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 数字格式化（用于数量字段，保留最多 2 位小数，去掉无意义零） */
function fmtNumber(v) {
  const n = Number(v);
  if (!isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n).toLocaleString('zh-CN');
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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

/** 业务时区：北京时间（上海，UTC+8） */
const BUSINESS_TZ_OFFSET_MS = 8 * 3600 * 1000;

function beijingParts(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [year, month, day] = s.split('-').map((x) => parseInt(x, 10));
    return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
      ? { year, month, day, hours: 0, minutes: 0, seconds: 0 }
      : null;
  }
  const dt = raw instanceof Date ? raw : new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  const bj = new Date(dt.getTime() + BUSINESS_TZ_OFFSET_MS);
  return {
    year: bj.getUTCFullYear(),
    month: bj.getUTCMonth() + 1,
    day: bj.getUTCDate(),
    hours: bj.getUTCHours(),
    minutes: bj.getUTCMinutes(),
    seconds: bj.getUTCSeconds(),
  };
}

function fmtDate(d) {
  const p = beijingParts(d);
  if (!p) return '—';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function fmtDateShort(d) {
  const p = beijingParts(d);
  if (!p) return '—';
  return `${p.month}/${p.day}`;
}

/** 场次业务日历（北京时间），用于年月筛选 */
function activityBusinessYm(raw) {
  const p = beijingParts(raw);
  return p ? { year: p.year, month: p.month } : null;
}

/**
 * 填入 <input type="date">：与列表 fmtDate 一致（北京时间）
 */
function toDateInputValue(raw) {
  const p = beijingParts(raw);
  if (!p) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function todayDateInputValue() {
  const p = beijingParts(new Date());
  if (!p) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** 物资/入库台账：从 API 日期（含 UTC ISO）取北京时间 YYYY-MM-DD */
function invBusinessYmd(raw) {
  const p = beijingParts(raw);
  if (!p) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
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
  pgFlag: '',
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
  dashboardState.pgFlag = document.getElementById('dashFilterPg')?.value || '';
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
  const pgSel = document.getElementById('dashFilterPg');
  if (pgSel) pgSel.value = dashboardState.pgFlag || '';
}

function resetDashboardFilters() {
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
  if (dashboardState.pgFlag) sp.set('pgFlags', dashboardState.pgFlag);
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
            <div class="dash-field">
              <label class="dash-label" for="dashFilterPg">PG礼仪</label>
              <select class="dash-control" id="dashFilterPg" onchange="filterDashboard()">
                <option value="">PG礼仪</option>
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
        <div class="stat-card danger"><div class="stat-label">含 PG 礼仪场次</div><div class="stat-value">${overview.pgSessions ?? 0}</div><div class="stat-sub">cost_details.pg &gt; 0（不含 PG 筛选）</div></div>
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
function triggerActivityImport() {
  const inp = document.getElementById('actImportFile');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

async function onActivityImportFileSelected(ev) {
  const file = ev.target && ev.target.files && ev.target.files[0];
  if (!file) return;
  const name = String(file.name || '').toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    showToast('请选择 Excel 文件（.xlsx 或 .xls）', 'warning');
    return;
  }
  const fd = new FormData();
  fd.append('file', file);
  if (currentYearFrameId) fd.append('yearFrameId', String(currentYearFrameId));
  try {
    showToast('正在导入场次，请稍候…', 'info');
    const res = await fetch('/api/activities/import', {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || res.statusText || '导入失败');
    const data = payload.data || payload;
    const failed = data.failed || [];
    const skipped = data.skipped || [];
    const created = data.created || [];
    const msg =
      payload.message ||
      `导入完成：成功 ${data.createdCount || 0} 条，跳过 ${data.skippedCount || 0} 条，失败 ${data.failedCount || 0} 条`;
    const hasIssue = failed.length || skipped.length;
    showToast(msg, hasIssue ? 'warning' : 'success');
    const detailLines = [];
    created.forEach((c) => detailLines.push(`第 ${c.row} 行：已导入 ${c.project_code || ''}`));
    skipped.forEach((s) =>
      detailLines.push(`第 ${s.row} 行：已跳过 — ${s.reason || ''}${s.project_code ? `（${s.project_code}）` : ''}`)
    );
    failed.forEach((f) => detailLines.push(`第 ${f.row} 行：失败 — ${f.error || ''}`));
    if (detailLines.length) {
      console.info('场次导入明细\n' + detailLines.join('\n'));
    }
    if (hasIssue && detailLines.length) {
      alert(`导入明细：\n\n${detailLines.join('\n')}\n\n若「已跳过」为项目编号已存在，说明该场次此前已导入；若列表少一条，请检查「月份/年框」筛选是否过滤掉了另一条。`);
    }
    if (currentPage === 'activities') await loadActivities();
    else if (currentPage === 'calendar' && typeof window._calYear === 'number') drawCalendar(window._calYear, window._calMonth);
  } catch (err) {
    showToast('导入失败: ' + (err.message || err), 'error');
  } finally {
    ev.target.value = '';
  }
}

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
      <div class="toolbar-right" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <a class="btn btn-secondary btn-sm" href="/templates/activity-import-template.xlsx" download="场次导入模板.xlsx">下载导入模板</a>
        <input type="file" id="actImportFile" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style="display:none" onchange="onActivityImportFileSelected(event)">
        <button type="button" class="btn btn-secondary btn-sm" onclick="triggerActivityImport()">排期导入</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="showActivityModal()">+ 新建活动</button>
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

    // 年份筛选（业务日历 UTC+8，与列表日期显示一致）
    if (activitiesState.year) {
      filtered = filtered.filter((a) => {
        const ym = activityBusinessYm(a.date || a.activity_date);
        return ym && String(ym.year) === activitiesState.year;
      });
    }

    // 月份筛选（业务日历 UTC+8）
    if (activitiesState.month) {
      filtered = filtered.filter((a) => {
        const ym = activityBusinessYm(a.date || a.activity_date);
        return ym && String(ym.month) === activitiesState.month;
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
                ${activityCloudAlbumButtonHtml(a.cloud_album_url)}
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
  const city = normalizeProjectCodeCity(document.getElementById('actCity')?.value || '');
  syncActivityBrandFromYearFrameCode();
  const venue = normalizeProjectCodeToken(document.getElementById('actVenue')?.value || '');
  const client = normalizeProjectCodeToken(document.getElementById('actClient')?.value || '');
  const brand = normalizeProjectCodeToken(document.getElementById('actBrandField')?.value || '');
  const type = normalizeProjectCodeToken(document.getElementById('actActivityType')?.value || '');

  // 年框编号 + 空格 + 城市 + 场地 + 客户名称 + 品牌 + 活动类型
  const pc = `${code} ${city}${venue}${client}${brand}${type}`.trim();
  const el = document.getElementById('actProjectCode');
  if (el) el.value = pc;
}

/** 排期日历单元格文案：城市+场地+客户+品牌+活动类型，缺项用 - */
function formatCalendarActivitySummary(a) {
  const part = (raw) => {
    const t = String(raw ?? '').trim();
    return t || '-';
  };
  if (!a) return '-----';
  const city = part(normalizeProjectCodeCity(a.city) || a.city);
  const venue = part(a.venue);
  const client = part(a.client || a.client_name);
  const brand = part(a.brand);
  const type = part(a.activity_type);
  return `${city}${venue}${client}${brand}${type}`;
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
    genProjectCode();
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
            ${activityDetailRowHtml('云相册', activityCloudAlbumButtonHtml(a.cloud_album_url, { detailLabel: true }))}
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
          isVirt
            ? `<div class="activity-detail-block" style="margin-top:12px;font-size:12px;color:var(--text-secondary)">此为虚拟预估场次，不参与排期日历；报价计入上方「虚拟场次」页预存统计。</div>`
            : ''
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
    <div class="cal-page">
      <div class="cal-sticky-head">
        <div class="cal-toolbar">
          <div class="cal-toolbar-nav">
            <button type="button" class="btn btn-secondary" onclick="prevCalMonth()">‹ 上月</button>
            <h2 id="calTitle" class="cal-toolbar-title"></h2>
            <button type="button" class="btn btn-secondary" onclick="nextCalMonth()">下月 ›</button>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="goCalToday()">今天</button>
        </div>
        <div class="calendar-grid cal-weekhead" id="calHeader"></div>
      </div>
      <div class="calendar-grid cal-body-grid" id="calGrid"></div>
    </div>
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

    function calBrandClass(brand) {
      return String(brand || '').toLowerCase().replace(/\./g, '');
    }
    function calEventTitle(a) {
      const lines = [formatCalendarActivitySummary(a)];
      if (a.project_code) lines.push(String(a.project_code).trim());
      if (a.status === 'deferred') lines.push('延期');
      return lines.filter(Boolean).join('｜');
    }
    function calEventLabel(a) {
      return formatCalendarActivitySummary(a);
    }
    function calDayCellHtml(dayNum, opts) {
      const { isToday, isOtherMonth, acts } = opts;
      const countBadge =
        !isOtherMonth && acts.length ? `<span class="cal-date-count">${acts.length}场</span>` : '';
      const eventsHtml = isOtherMonth
        ? ''
        : `<div class="cal-cell-events">${acts
            .map(
              (a) => `<div class="cal-event brand-${calBrandClass(a.brand)}${
                a.status === 'deferred' ? ' cal-event-deferred' : ''
              }" title="${escapeHtml(calEventTitle(a))}" onclick="showActivityDetail(${a.id})">${escapeHtml(
                calEventLabel(a)
              )}</div>`
            )
            .join('')}</div>`;
      return `<div class="cal-cell${isOtherMonth ? ' other-month' : ''}${isToday ? ' today' : ''}">
        <div class="cal-date-row">
          <span class="cal-date">${dayNum}</span>
          ${countBadge}
        </div>
        ${eventsHtml}
      </div>`;
    }

    // 上月填充
    for (let i = startWeekDay - 1; i >= 0; i--) {
      html += calDayCellHtml(daysInPrevMonth - i, { isOtherMonth: true, acts: [] });
    }

    // 当月
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
      const key = `${year}-${month + 1}-${d}`;
      const acts = actMap[key] || [];
      html += calDayCellHtml(d, { isToday, acts });
    }

    // 下月填充
    const totalCells = startWeekDay + daysInMonth;
    const remaining = (7 - totalCells % 7) % 7;
    for (let d = 1; d <= remaining; d++) {
      html += calDayCellHtml(d, { isOtherMonth: true, acts: [] });
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

let _activityNoCostPendingId = null;

function openActivityNoCostConfirm(actId) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可标记无成本场次', 'warning');
    return;
  }
  _activityNoCostPendingId = Number(actId);
  openModal('modalActivityNoCost');
  renderLucideIcons();
}

async function submitActivityNoCostConfirm() {
  const id = _activityNoCostPendingId;
  if (!id || !Number.isFinite(id)) {
    closeModal();
    return;
  }
  try {
    await api('PUT', `/activities/${id}`, { no_cost: 1, total_cost: 0, cost_details: {} });
    showToast('已标记为无成本场次', 'success');
    closeModal();
    _activityNoCostPendingId = null;
    if (currentPage === 'cost') await renderCost();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

async function renderCost() {
  const container = document.getElementById('pageContainer');

  try {
    await ensureBelongingLabelMap();
    let qsAct = '?isVirtual=0';
    if (currentYearFrameId) qsAct += `&yearFrameId=${currentYearFrameId}`;
    const activities = await api('GET', `/activities${qsAct}`);

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
              <div style="margin-top:8px">成本以本场登记为准；数据看板按场次已登记成本与各板块公共池汇总，不与报销列表重复加计。</div>
              <div style="margin-top:6px;font-size:12px;color:var(--text-secondary)">无成本：点击行内 <strong>「无成本」</strong> 按钮，确认后移入「无成本场次」。</div>
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
                  <th style="min-width:84px;text-align:center;white-space:nowrap" title="标记本场无成本">无成本</th>
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
                    <td style="text-align:center" onclick="event.stopPropagation()">
                      <button type="button" class="cost-no-cost-pill" title="标记本场无成本" aria-label="标记本场活动无成本发生" onclick="openActivityNoCostConfirm(${a.id})">无成本</button>
                    </td>
                  </tr>
                `).join('')}
                ${filteredActsPending.length > 30 ? `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:10px">还有 ${filteredActsPending.length-30} 条，请在场次记录中查看</td></tr>` : ''}
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
                <th style="min-width:84px;text-align:center;white-space:nowrap" title="改标为无成本">无成本</th>
                <th>利润</th>
                <th style="white-space:nowrap">操作</th>
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
                    <td style="text-align:center" onclick="event.stopPropagation()">
                      <button type="button" class="cost-no-cost-pill" title="改标为无成本" aria-label="本场活动无成本发生" onclick="openActivityNoCostConfirm(${a.id})">无成本</button>
                    </td>
                    <td class="amount ${profit>=0?'amount-revenue':'amount-cost'}">${fmtMoney(profit)}</td>
                    <td style="white-space:nowrap" onclick="event.stopPropagation()">
                      <button type="button" class="btn btn-secondary btn-sm" onclick="showCostFillFromCost(${a.id})">编辑</button>
                      <button type="button" class="btn btn-danger btn-sm" onclick="clearActivityCostRegistration(${a.id})">删除</button>
                    </td>
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
      { key: 'makeup', label: '化妆师' },
    ],
  },
  {
    title: '二、差旅',
    items: [
      { key: 'travel_supervisor', label: '督导差旅' },
      { key: 'travel_company', label: '盛融差旅' },
    ],
  },
  {
    title: '三、舞美制作',
    items: [
      { key: 'structure', label: '结构制作/搭建' },
      { key: 'av', label: 'AV灯光音响' },
    ],
  },
  {
    title: '四、画面制作',
    items: [
      { key: 'print', label: '印刷/快印' },
      { key: 'spray', label: '写真/喷绘' },
    ],
  },
  {
    title: '五、采购',
    items: [
      { key: 'floral_design', label: '花艺' },
      { key: 'floral', label: '花艺' },
      { key: 'payment', label: '活动物料' },
      { key: 'tasting', label: '品鉴物料' },
    ],
  },
  {
    title: '六、物流',
    items: [
      { key: 'express', label: '快递（闪送）' },
      { key: 'logistics', label: '物流' },
    ],
  },
  {
    title: '七、垫付',
    items: [
      { key: 'venue_fee', label: '场地费' },
      { key: 'meal_fee', label: '餐费' },
      { key: 'other_advance', label: '其他' },
      { key: 'advance_offset', label: '备用金抵扣' },
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
      <input type="hidden" id="costDetailActId" value="${actId}">
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

    openModal('modalCostDetail');
    renderLucideIcons();
  } catch (err) {
    showToast('加载成本详情失败: ' + err.message, 'error');
  }
}

function openCostEditFromDetail() {
  const raw = document.getElementById('costDetailActId')?.value;
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) {
    showToast('无法识别场次', 'warning');
    return;
  }
  closeModal();
  setTimeout(() => showCostFillFromCost(id), 100);
}

async function clearActivityCostRegistrationFromDetail() {
  const raw = document.getElementById('costDetailActId')?.value;
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) {
    showToast('无法识别场次', 'warning');
    return;
  }
  await clearActivityCostRegistration(id);
}

async function clearActivityCostRegistration(actId) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除成本登记', 'warning');
    return;
  }
  const id = parseInt(actId, 10);
  if (!Number.isFinite(id)) return;
  if (!confirm('确定清除本场已登记的成本？清除后该场次将回到「待填写成本」，不会删除场次本身。')) return;
  try {
    await api('PUT', `/activities/${id}`, { total_cost: 0, cost_details: {}, no_cost: 0 });
    showToast('已清除成本登记', 'success');
    closeModal();
    if (currentPage === 'cost') await renderCost();
    if (currentPage === 'activities') loadActivities();
  } catch (e) {
    showToast(e.message || '操作失败', 'error');
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
const LOGISTICS_UNITS = ['东区仓库', '北区仓库', '南区仓库', '快递', '物流'];
const LOGISTICS_METHODS_BY_UNIT = {
  东区仓库: ['顺丰', '物流', '其他'],
  北区仓库: ['顺丰', '物流', '其他'],
  南区仓库: ['顺丰', '物流', '其他'],
  快递: ['顺丰', '京东', '圆通', '申通', '中通', '韵达', '其他'],
  物流: ['德邦', '跨越', 'EMS', '其他'],
};
const LOGISTICS_LEGACY_UNIT_MAP = {
  '东区仓库（叶老板）': '东区仓库',
  '南区仓库（天空）': '南区仓库',
  '北区仓库（叶老板）': '北区仓库',
};

function parseLogisticsAddrMeta(remarks) {
  const empty = () => ({
    shipName: '',
    shipPhone: '',
    shipAddr: '',
    recvName: '',
    recvPhone: '',
    recvAddr: '',
    purpose: '',
    sender: '',
    recipient: '',
    address: '',
  });
  const raw = String(remarks || '');
  const m = raw.match(/^\[LOG_ADDR\]([^\n]*)/);
  if (!m) return empty();
  const kv = {};
  m[1].split('|').forEach((part) => {
    const idx = part.indexOf(':');
    if (idx <= 0) return;
    const k = part.slice(0, idx);
    const v = part.slice(idx + 1).replace(/｜/g, '|');
    kv[k] = v;
  });
  const hasNew = ['发件人', '发件电话', '发件地址', '收件人', '收件电话', '收件地址'].some((key) =>
    Object.prototype.hasOwnProperty.call(kv, key),
  );
  if (hasNew) {
    const shipName = kv['发件人'] || '';
    const shipPhone = kv['发件电话'] || '';
    const shipAddr = kv['发件地址'] || '';
    const recvName = kv['收件人'] || '';
    const recvPhone = kv['收件电话'] || '';
    const recvAddr = kv['收件地址'] || '';
    const purpose = kv['用途'] || '';
    return {
      shipName,
      shipPhone,
      shipAddr,
      recvName,
      recvPhone,
      recvAddr,
      purpose,
      sender: [shipName, shipPhone].filter(Boolean).join(' '),
      recipient: [recvName, recvPhone].filter(Boolean).join(' '),
      address: recvAddr,
    };
  }
  const out = empty();
  if (Object.prototype.hasOwnProperty.call(kv, '发件')) {
    out.sender = kv['发件'] || '';
    out.recipient = kv['收件'] || '';
    out.address = kv['地址'] || '';
    out.recvAddr = out.address;
    const sJoin = out.sender.match(/^(.+?)\s+(1[3-9]\d{9}|\d{2,4}-\d{7,9})$/);
    if (sJoin) {
      out.shipName = sJoin[1].trim();
      out.shipPhone = sJoin[2].replace(/\s/g, '');
    } else {
      out.shipName = out.sender;
    }
    const rJoin = out.recipient.match(/^(.+?)\s+(1[3-9]\d{9}|\d{2,4}-\d{7,9})$/);
    if (rJoin) {
      out.recvName = rJoin[1].trim();
      out.recvPhone = rJoin[2].replace(/\s/g, '');
    } else {
      out.recvName = out.recipient;
    }
  }
  return out;
}

function buildLogisticsAddrMetaV2(shipName, shipPhone, shipAddr, recvName, recvPhone, recvAddr, purpose) {
  const esc = (v) => String(v || '').replace(/\|/g, '｜').replace(/\n/g, ' ');
  const parts = [];
  if (String(shipName || '').trim()) parts.push(`发件人:${esc(shipName)}`);
  if (String(shipPhone || '').trim()) parts.push(`发件电话:${esc(shipPhone)}`);
  if (String(shipAddr || '').trim()) parts.push(`发件地址:${esc(shipAddr)}`);
  if (String(recvName || '').trim()) parts.push(`收件人:${esc(recvName)}`);
  if (String(recvPhone || '').trim()) parts.push(`收件电话:${esc(recvPhone)}`);
  if (String(recvAddr || '').trim()) parts.push(`收件地址:${esc(recvAddr)}`);
  if (String(purpose || '').trim()) parts.push(`用途:${esc(purpose)}`);
  if (!parts.length) return '';
  return `[LOG_ADDR]${parts.join('|')}\n`;
}

/** 旧三字段（发件/收件/地址）→ 新键；仅保留给极少数兼容调用 */
function buildLogisticsAddrMeta(sender, recipient, address) {
  const s = String(sender || '').trim();
  const r = String(recipient || '').trim();
  const a = String(address || '').trim();
  if (!s && !r && !a) return '';
  return buildLogisticsAddrMetaV2(s, '', '', r, '', a, '');
}

async function copyTextToClipboard(text) {
  const s = String(text || '');
  if (!s.trim()) {
    showToast('没有可复制内容', 'warning');
    return;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(s);
    } else {
      throw new Error('no clipboard');
    }
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch (e2) {
      showToast('复制失败', 'error');
      return;
    }
  }
  showToast('已复制', 'success');
}

function copyLogisticsShipBundle() {
  const name = document.getElementById('logShipName')?.value?.trim() || '';
  const phone = document.getElementById('logShipPhone')?.value?.trim() || '';
  const addr = document.getElementById('logShipAddr')?.value?.trim() || '';
  const text = [name, phone, addr].filter(Boolean).join('\n');
  copyTextToClipboard(text);
}

function copyLogisticsRecvBundle() {
  const name = document.getElementById('logRecvName')?.value?.trim() || '';
  const phone = document.getElementById('logRecvPhone')?.value?.trim() || '';
  const addr = document.getElementById('logRecvAddr')?.value?.trim() || '';
  const text = [name, phone, addr].filter(Boolean).join('\n');
  copyTextToClipboard(text);
}

let logisticsSmartFillTarget = 'ship';

function parseLogisticsContactPaste(raw) {
  const t = String(raw || '').trim().replace(/\u00a0/g, ' ');
  if (!t) return { name: '', phone: '', addr: '' };
  const phoneRe = /(1[3-9]\d{9})|(\d{2,4}[- ]?\d{7,9}\b)/;
  const lines = t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length >= 2) {
    let pi = -1;
    let phone = '';
    lines.forEach((ln, i) => {
      if (pi < 0 && phoneRe.test(ln)) {
        const m = ln.match(phoneRe);
        if (m) {
          phone = m[0].replace(/\s/g, '');
          pi = i;
        }
      }
    });
    if (pi < 0) {
      return { name: lines[0] || '', phone: '', addr: lines.slice(1).join('\n') };
    }
    const namePart = lines.slice(0, pi).join(' ') || lines[pi].replace(phoneRe, '').trim();
    const addrPart = lines.slice(pi + 1).join('\n');
    return { name: namePart.trim(), phone: phone.trim(), addr: addrPart.trim() };
  }
  const m = t.match(phoneRe);
  const phone = m ? m[0].replace(/\s/g, '') : '';
  const rest = t.replace(phoneRe, ' ').replace(/\s+/g, ' ').trim();
  const parts = rest.split(/\s+/).filter(Boolean);
  if (!phone) {
    return { name: parts[0] || '', phone: '', addr: parts.slice(1).join(' ') };
  }
  if (parts.length <= 1) {
    return { name: parts[0] || '', phone, addr: '' };
  }
  return { name: (parts[0] || '').trim(), phone, addr: parts.slice(1).join(' ').trim() };
}

function openLogisticsSmartFill(which) {
  logisticsSmartFillTarget = which === 'recv' ? 'recv' : 'ship';
  const ta = document.getElementById('logisticsSmartFillPaste');
  if (ta) ta.value = '';
  const title = document.getElementById('logisticsSmartFillTitle');
  if (title) {
    title.textContent =
      logisticsSmartFillTarget === 'ship' ? '智能填写 · 发件信息' : '智能填写 · 收件信息';
  }
  openModal('modalLogisticsSmartFill');
}

function applyLogisticsSmartFill() {
  const ta = document.getElementById('logisticsSmartFillPaste');
  const { name, phone, addr } = parseLogisticsContactPaste(ta?.value || '');
  if (logisticsSmartFillTarget === 'recv') {
    const n = document.getElementById('logRecvName');
    const p = document.getElementById('logRecvPhone');
    const a = document.getElementById('logRecvAddr');
    if (n) n.value = name;
    if (p) p.value = phone;
    if (a) a.value = addr;
  } else {
    const n = document.getElementById('logShipName');
    const p = document.getElementById('logShipPhone');
    const a = document.getElementById('logShipAddr');
    if (n) n.value = name;
    if (p) p.value = phone;
    if (a) a.value = addr;
  }
  closeModal();
}

/** 物品出库「物流方式」→ 成本模块物流单位/方式（与 LOGISTICS_METHODS_BY_UNIT 一致） */
function invOutboundMethodToLogisticsUnitExpress(methodRaw) {
  const m = String(methodRaw || '').trim();
  if (!m || m === '其他') return { unit: '快递', express: '其他' };
  if (m === '物流') return { unit: '物流', express: '其他' };
  const expressSet = new Set(LOGISTICS_METHODS_BY_UNIT['快递']);
  const logisticsSet = new Set(LOGISTICS_METHODS_BY_UNIT['物流']);
  if (logisticsSet.has(m)) return { unit: '物流', express: m };
  if (expressSet.has(m)) return { unit: '快递', express: m };
  return { unit: '快递', express: m };
}

function preserveInvObSuffix(remarks) {
  const m = String(remarks || '').match(/\[INV-OB:\d+\][^\n]*$/);
  return m ? m[0].trim() : '';
}

function onLogisticsUnitChange() {
  const u = document.getElementById('logUnit')?.value || '快递';
  const sel = document.getElementById('logMethod');
  if (!sel) return;
  const methods = LOGISTICS_METHODS_BY_UNIT[u] || LOGISTICS_METHODS_BY_UNIT['快递'];
  sel.innerHTML = methods.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
}

function fillLogisticsUnitSelect(selected) {
  const sel = document.getElementById('logUnit');
  if (!sel) return;
  sel.innerHTML = LOGISTICS_UNITS.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
  if (selected && LOGISTICS_UNITS.includes(selected)) sel.value = selected;
}

function normalizeLogisticsUnitFromRow(item) {
  if (!item) return '快递';
  const u = String(item.logistics_company || '').trim();
  if (LOGISTICS_UNITS.includes(u)) return u;
  if (LOGISTICS_LEGACY_UNIT_MAP[u]) return LOGISTICS_LEGACY_UNIT_MAP[u];
  if (u.includes('东区')) return '东区仓库';
  if (u.includes('北区')) return '北区仓库';
  if (u.includes('南区')) return '南区仓库';
  const legacyExpress = new Set(LOGISTICS_METHODS_BY_UNIT['快递']);
  if (legacyExpress.has(u) && !String(item.express_company || '').trim()) return '快递';
  return '快递';
}

function normalizeLogisticsMethodFromRow(item, unit) {
  const ec = String(item.express_company || '').trim();
  if (ec) return ec;
  const u = String(item.logistics_company || '').trim();
  const legacyExpress = new Set(LOGISTICS_METHODS_BY_UNIT['快递']);
  if (unit === '快递' && legacyExpress.has(u)) return u;
  return (LOGISTICS_METHODS_BY_UNIT[unit] || LOGISTICS_METHODS_BY_UNIT['快递'])[0];
}

function logisticsRouteCellHtml(row) {
  const p = parseLogisticsAddrMeta(row?.remarks || '');
  const hasV2 =
    p.shipName ||
    p.shipPhone ||
    p.shipAddr ||
    p.recvName ||
    p.recvPhone ||
    p.recvAddr;
  if (hasV2) {
    const bits = [];
    const shipLine = [p.shipName, p.shipPhone].filter(Boolean).join(' ');
    const recvLine = [p.recvName, p.recvPhone].filter(Boolean).join(' ');
    if (shipLine) bits.push(`<span style="color:var(--text-secondary)">发</span> ${escapeHtml(shipLine)}`);
    if (p.shipAddr) bits.push(`<div style="font-size:11px;color:var(--text-muted)">${escapeHtml(p.shipAddr)}</div>`);
    if (recvLine) bits.push(`<span style="color:var(--text-secondary)">收</span> ${escapeHtml(recvLine)}`);
    if (p.recvAddr) bits.push(`<div style="font-size:11px;color:var(--text-muted)">${escapeHtml(p.recvAddr)}</div>`);
    return bits.length ? bits.join('') : '—';
  }
  if (p.sender || p.recipient || p.address) {
    const bits = [];
    if (p.sender) bits.push(`<span style="color:var(--text-secondary)">发</span> ${escapeHtml(p.sender)}`);
    if (p.recipient) bits.push(`<span style="color:var(--text-secondary)">收</span> ${escapeHtml(p.recipient)}`);
    const top = bits.length ? bits.join('<br/>') : '';
    const addr = p.address ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${escapeHtml(p.address)}</div>` : '';
    return top + addr || '—';
  }
  const a = String(row?.origin_city || '').trim();
  const b = String(row?.destination_city || '').trim();
  if (!a && !b) return '—';
  return `${escapeHtml(a)}→${escapeHtml(b)}`;
}

async function renderLogistics() {
  const container = document.getElementById('pageContainer');

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <input type="text" class="search-input" id="logSearch" placeholder="搜索单号/单位/方式/收发/用途..." oninput="filterLogistics()">
      </div>
      <div class="toolbar-right" style="display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-ghost btn-sm inv-admin-only" onclick="logisticsCleanupOrphanOutbound()" title="扫描并清理「出库单已删除但物流成本仍残留」的孤儿数据（按 [INV-OB:N] 标记识别）">清理出库残留</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="showLogisticsModal()">+ 新建物流</button>
      </div>
    </div>
    <div id="logTable"></div>
  `;

  await loadLogistics();
}

async function logisticsCleanupOrphanOutbound() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可执行此操作', 'warning');
    return;
  }
  if (
    !window.confirm(
      '将扫描所有物流成本记录，删除「备注含 [INV-OB:N] 但对应出库单已不存在」的孤儿行。\n\n该操作幂等安全，且只清理由出库模块自动生成的物流；不会影响手填的物流记录。是否继续？',
    )
  ) {
    return;
  }
  try {
    const resp = await api('POST', '/inventory/cleanup-orphan-logistics');
    const cleaned = Number((resp && resp.cleaned) || 0);
    const scanned = Number((resp && resp.scanned) || 0);
    if (cleaned > 0) {
      showToast(`已清理 ${cleaned} 条残留物流（共扫描 ${scanned} 条带 INV-OB 标记）`, 'success');
    } else {
      showToast(`未发现残留物流（共扫描 ${scanned} 条带 INV-OB 标记，全部有对应出库单）`, 'info');
    }
    await loadLogistics();
  } catch (e) {
    showToast(e.message || '清理失败', 'error');
  }
}

/** 与物流表格一致：当前已加载数据 + 搜索框过滤后的可见行 */
function getLogisticsVisibleRows() {
  const search = (document.getElementById('logSearch')?.value || '').toLowerCase();
  let data = logisticsState.data || [];
  if (search) {
    data = data.filter((l) => {
      const p = parseLogisticsAddrMeta(l.remarks || '');
      const blob = [
        l.tracking_number,
        l.logistics_company,
        l.express_company,
        l.origin_city,
        l.destination_city,
        p.sender,
        p.recipient,
        p.address,
        p.shipName,
        p.shipPhone,
        p.shipAddr,
        p.recvName,
        p.recvPhone,
        p.recvAddr,
        p.purpose,
        logisticsPurposeText(l),
      ]
        .join(' ')
        .toLowerCase();
      return blob.includes(search);
    });
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

function logisticsCompanyCellHtml(row) {
  const logisticsCompany = String(row?.logistics_company || '').trim();
  const expressCompany = String(row?.express_company || '').trim();
  const primary = logisticsCompany || expressCompany || '—';
  const showExpress = !isTruthyFlag(row?.special_car) && expressCompany && expressCompany !== primary;
  return `
    <span class="badge badge-blue">${escapeHtml(primary)}</span>
    ${showExpress ? `<span style="margin-left:6px;color:var(--text-secondary);font-size:12px">${escapeHtml(expressCompany)}</span>` : ''}
  `;
}

function logisticsTrackingCellHtml(row) {
  if (isTruthyFlag(row?.monthly_settlement)) {
    return `<span class="badge badge-green">月结${row?.settlement_month ? ` ${escapeHtml(row.settlement_month)}` : ''}</span>`;
  }
  if (row?.special_car) return '<span class="badge badge-accent">专车</span>';
  const trackingNumber = String(row?.tracking_number || '').trim();
  if (!trackingNumber) return '—';
  return `<a href="https://www.sf-express.com/cn/sc/dynamic_function/waybill/#search/bill-number/${encodeURIComponent(trackingNumber)}" target="_blank" style="color:var(--accent);font-family:monospace;font-size:12px">${escapeHtml(trackingNumber)}</a>`;
}

function logisticsPurposeText(row) {
  const p = parseLogisticsAddrMeta(row?.remarks || '');
  const purposeMeta = String(p.purpose || '').trim();
  const visibleRemarks = String(row?.remarks || '')
    .replace(/^\[LOG_ADDR\][^\n]*\n?/, '')
    .replace(/\s*\[INV-OB:\d+\]\s*/g, '')
    .replace(/[；;]\s*$/g, '')
    .trim();
  if (purposeMeta && visibleRemarks) return `${purposeMeta}\n${visibleRemarks}`;
  if (purposeMeta) return purposeMeta;
  if (visibleRemarks) return visibleRemarks;
  return String(row?.allocation_note || '').trim();
}

function logisticsPurposeCellHtml(row) {
  const text = logisticsPurposeText(row);
  return text ? escapeHtml(text) : '—';
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
              <th style="cursor:pointer;user-select:none" onclick="toggleLogisticsSort('shipping_date')" title="点击排序">日期${logisticsSortIndicator('shipping_date')}</th>
              <th style="cursor:pointer;user-select:none" onclick="toggleLogisticsSort('brand')" title="点击排序">品牌${logisticsSortIndicator('brand')}</th>
              <th style="cursor:pointer;user-select:none" onclick="toggleLogisticsSort('logistics_company')" title="点击排序">单位/方式${logisticsSortIndicator('logistics_company')}</th>
              <th>单号</th><th>收发/地址</th><th>用途说明</th><th>费用</th><th>付款状态</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${filtered.length ? filtered.map(l => {
              const lid = Number(l.id);
              return `
              <tr>
                <td>${logisticsDisplayDate(l)}</td>
                <td><span class="badge badge-purple">${escapeHtml(l.brand || 'PHD')}</span></td>
                <td>${logisticsCompanyCellHtml(l)}</td>
                <td>${logisticsTrackingCellHtml(l)}</td>
                <td style="font-size:12px;max-width:280px;white-space:normal;line-height:1.45">${logisticsRouteCellHtml(l)}</td>
                <td style="font-size:12px;max-width:260px;white-space:normal;line-height:1.45">${logisticsPurposeCellHtml(l)}</td>
                <td class="amount ${parseFloat(l.fee)>0?'amount-cost':'amount-neutral'}">${parseFloat(l.fee)>0?fmtMoney(l.fee):'—'}</td>
                <td>${paymentStatusHtml(l.payment_status, l.payment_order_id)}</td>
                <td>
                  <div style="display:flex;gap:4px">
                    <button class="btn btn-secondary btn-sm" onclick="showLogisticsModal(${l.id})">编辑</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteLogistics(${l.id})">删</button>
                  </div>
                </td>
              </tr>
            `;
            }).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:30px">暂无数据</td></tr>'}
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
  [
    'logTrack',
    'logBrand',
    'logDate',
    'logFee',
    'logPayeeName',
    'logPurpose',
    'logShipName',
    'logShipPhone',
    'logShipAddr',
    'logRecvName',
    'logRecvPhone',
    'logRecvAddr',
  ].forEach((f) => {
    const el = document.getElementById(f);
    if (el) el.value = '';
  });
  fillLogisticsUnitSelect('快递');
  onLogisticsUnitChange();
  document.getElementById('logBrand').value = 'PHD';
  document.getElementById('logDate').value = todayDateInputValue();

  const nid = id != null && id !== '' ? Number(id) : NaN;
  if (Number.isFinite(nid)) {
    let item = null;
    try {
      item = await api('GET', `/logistics/${nid}`);
    } catch (e) {
      item = logisticsState.data.find((l) => Number(l.id) === nid) || null;
    }
    if (item) {
      const unit = normalizeLogisticsUnitFromRow(item);
      fillLogisticsUnitSelect(unit);
      onLogisticsUnitChange();
      const method = normalizeLogisticsMethodFromRow(item, unit);
      const mSel = document.getElementById('logMethod');
      if (mSel && [...mSel.options].some((o) => o.value === method)) mSel.value = method;
      document.getElementById('logTrack').value = item.tracking_number || '';
      document.getElementById('logBrand').value = ['PHD', 'X.O', 'CLUB', 'REMY'].includes(item.brand) ? item.brand : 'PHD';
      if (item.shipping_date) document.getElementById('logDate').value = toDateInputValue(item.shipping_date);
      document.getElementById('logFee').value =
        item.fee != null && item.fee !== '' ? roundMoney2(item.fee).toFixed(2) : '';
      document.getElementById('logPayeeName').value = item.payee_name || '';
      const addr = parseLogisticsAddrMeta(item.remarks || '');
      document.getElementById('logPurpose').value = addr.purpose || '';
      const hasDetail =
        addr.shipName ||
        addr.shipPhone ||
        addr.shipAddr ||
        addr.recvName ||
        addr.recvPhone ||
        addr.recvAddr;
      if (hasDetail) {
        document.getElementById('logShipName').value = addr.shipName || '';
        document.getElementById('logShipPhone').value = addr.shipPhone || '';
        document.getElementById('logShipAddr').value = addr.shipAddr || '';
        document.getElementById('logRecvName').value = addr.recvName || '';
        document.getElementById('logRecvPhone').value = addr.recvPhone || '';
        document.getElementById('logRecvAddr').value = addr.recvAddr || '';
      } else if (addr.sender || addr.recipient || addr.address) {
        document.getElementById('logShipName').value = addr.sender || '';
        document.getElementById('logRecvName').value = addr.recipient || '';
        document.getElementById('logRecvAddr').value = addr.address || '';
      } else {
        document.getElementById('logShipName').value = item.origin_city || '';
        document.getElementById('logRecvName').value = item.destination_city || '';
      }
    }
  }
  openModal('modalLogistics');
}

/** 兼容旧 HTML 引用；新表单已移除专车/月结 */
function toggleLogSpecialCar() {}

async function saveLogistics() {
  const id = document.getElementById('logId').value;
  const unit = document.getElementById('logUnit')?.value || '';
  const method = document.getElementById('logMethod')?.value || '';
  if (!LOGISTICS_UNITS.includes(unit)) {
    showToast('请选择物流单位', 'warning');
    return;
  }
  if (!method) {
    showToast('请选择物流方式', 'warning');
    return;
  }
  const logisticsBrand = document.getElementById('logBrand').value;
  const shipDate = document.getElementById('logDate').value || '';
  if (!shipDate) {
    showToast('请选择发货日期', 'warning');
    return;
  }
  const feeRaw = document.getElementById('logFee').value;
  const fee = feeRaw === '' || feeRaw == null ? 0 : roundMoney2(feeRaw);
  if (fee < 0) {
    showToast('费用不能为负数', 'warning');
    return;
  }
  const payee = document.getElementById('logPayeeName')?.value?.trim() || '';
  if (!payee) {
    showToast('请填写收款方（物流公司）', 'warning');
    return;
  }
  const shipName = document.getElementById('logShipName')?.value?.trim() || '';
  const shipPhone = document.getElementById('logShipPhone')?.value?.trim() || '';
  const shipAddr = document.getElementById('logShipAddr')?.value?.trim() || '';
  const recvName = document.getElementById('logRecvName')?.value?.trim() || '';
  const recvPhone = document.getElementById('logRecvPhone')?.value?.trim() || '';
  const recvAddr = document.getElementById('logRecvAddr')?.value?.trim() || '';
  const purpose = document.getElementById('logPurpose')?.value?.trim() || '';
  const originLine = [shipName, shipPhone].filter(Boolean).join(' ');
  const destLine = [recvName, recvPhone].filter(Boolean).join(' ');
  let invSuffix = '';
  let existingTail = '';
  if (id) {
    let prev = null;
    try {
      prev = await api('GET', `/logistics/${id}`);
    } catch (_) {
      prev = logisticsState.data.find((l) => String(l.id) === String(id)) || null;
    }
    if (prev && prev.remarks) {
      invSuffix = preserveInvObSuffix(prev.remarks);
      existingTail = String(prev.remarks || '')
        .replace(/^\[LOG_ADDR\][^\n]*\n?/, '')
        .replace(/\s*\[INV-OB:\d+\][^\n]*\s*$/g, '')
        .trim();
    }
  }
  const addrLine = buildLogisticsAddrMetaV2(shipName, shipPhone, shipAddr, recvName, recvPhone, recvAddr, purpose).replace(
    /\n$/,
    '',
  );
  const pieces = [];
  if (addrLine) pieces.push(addrLine);
  if (existingTail) pieces.push(existingTail);
  if (invSuffix) pieces.push(invSuffix);
  const remarksFinal = pieces.length ? pieces.join('\n') : null;

  const trackingNumber = document.getElementById('logTrack').value?.trim() || null;
  const body = {
    year_frame_id: currentYearFrameId || 1,
    logistics_company: unit,
    brand: logisticsBrand,
    express_company: method,
    tracking_number: trackingNumber,
    special_car: 0,
    monthly_settlement: 0,
    settlement_month: null,
    origin_city: originLine || null,
    destination_city: destLine || null,
    shipping_date: shipDate || null,
    fee,
    payee_name: payee,
    related_project_code: null,
    activity_id: null,
    merged_into_activity: 0,
    allocation_note: null,
    remarks: remarksFinal,
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
    <div class="warehouse-page">
    <div class="toolbar" style="justify-content:space-between">
      <div class="toolbar-left">
        <select class="filter-select" id="warMergeFilter" onchange="setWarehouseMergeFilter(this.value)">
          <option value="all">计入：全部</option>
          <option value="unmerged">计入：未计入</option>
          <option value="merged">计入：已计入</option>
        </select>
      </div>
      <div class="toolbar-right" style="display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-secondary btn-sm" onclick="showWarehouseFixedCostModal()">生成固定成本</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="showWarehouseQuoteModal()">新建仓储报价</button>
      </div>
    </div>
    <div id="warSummary"></div>
    <div id="warTable"></div>
    </div>
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

function warehousePeriodMonthCount(startYmd, endYmd) {
  const s = String(startYmd || '').slice(0, 10);
  const e = String(endYmd || '').slice(0, 10);
  if (!s || !e || s > e) return 0;
  const ds = new Date(`${s}T12:00:00`);
  const de = new Date(`${e}T12:00:00`);
  if (Number.isNaN(ds.getTime()) || Number.isNaN(de.getTime())) return 0;
  return (de.getFullYear() - ds.getFullYear()) * 12 + (de.getMonth() - ds.getMonth()) + 1;
}

function warehouseMonthLabelFromPeriodDates(startYmd, endYmd) {
  const s = String(startYmd || '').slice(0, 7);
  const e = String(endYmd || '').slice(0, 7);
  if (!s || !e) return '';
  return s === e ? s : `${s}~${e}`;
}

function parseWarehouseMonthRangeToDates(monthStr) {
  const raw = String(monthStr || '').trim();
  const idx = raw.indexOf('~');
  if (idx < 0) return null;
  const a = raw.slice(0, idx).trim();
  const b = raw.slice(idx + 1).trim();
  if (!/^\d{4}-\d{2}$/.test(a) || !/^\d{4}-\d{2}$/.test(b)) return null;
  const [y2, m2] = b.split('-').map((x) => parseInt(x, 10));
  const lastD = new Date(y2, m2, 0).getDate();
  return { start: `${a}-01`, end: `${b}-${String(lastD).padStart(2, '0')}` };
}

function onWarehousePeriodChange() {
  if (warehouseFormMode !== 'period_quote') return;
  const ps = document.getElementById('warPeriodStart')?.value || '';
  const pe = document.getElementById('warPeriodEnd')?.value || '';
  const n = warehousePeriodMonthCount(ps, pe);
  const elQ = document.getElementById('warQty');
  if (elQ) elQ.value = n > 0 ? String(n) : '';
  updateWarQuotedPrice();
}

function applyWarehouseFormMode(mode) {
  warehouseFormMode = mode;
  const periodWrap = document.getElementById('warPeriodWrap');
  const monthLegacy = document.getElementById('warMonthLegacyWrap');
  const yfWrap = document.getElementById('warYearFrameWrap');
  const yfHint = document.getElementById('warYearFrameHint');
  const qtyLabel = document.getElementById('warQtyLabel');
  const qtyEl = document.getElementById('warQty');
  const proj = document.getElementById('warProjectBlock');
  const merge = document.getElementById('warMergeBlock');
  if (!periodWrap || !monthLegacy) return;
  if (mode === 'period_quote') {
    periodWrap.style.display = '';
    monthLegacy.style.display = 'none';
    if (qtyLabel) {
      qtyLabel.innerHTML =
        '数量（月） <span class="required">*</span> <span style="font-size:11px;color:var(--text-muted);font-weight:400">（按账期自动计算）</span>';
    }
    if (qtyEl) qtyEl.readOnly = true;
    if (proj) proj.style.display = 'none';
    if (merge) merge.style.display = 'none';
  } else {
    periodWrap.style.display = 'none';
    monthLegacy.style.display = '';
    if (qtyLabel) qtyLabel.innerHTML = '数量（月） <span class="required">*</span>';
    if (qtyEl) qtyEl.readOnly = false;
    if (yfHint) yfHint.style.display = 'none';
    if (yfWrap) yfWrap.style.display = '';
    if (proj) proj.style.display = '';
    if (merge) merge.style.display = '';
  }
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
        <div class="warehouse-summary-grid">
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
        <div class="warehouse-table-card">
          <div class="warehouse-table-head">
            <div>
              <div class="warehouse-table-title">仓储成本记录</div>
              <div class="warehouse-table-sub">固定成本、报价记录与付款状态</div>
            </div>
            <span class="badge badge-gray">${filteredData.length} 条</span>
          </div>
        <div class="table-wrapper warehouse-table-scroll act-table-scroll-wrap">
          <table class="data-table act-table-sticky-head warehouse-cost-table">
            <thead><tr>
              <th>财年</th>
              <th>月份</th>
              <th>品牌</th>
              <th>区域</th>
              <th>数量</th>
              <th>单价</th>
              <th>报价</th>
              <th>实际成本</th>
              <th>付款状态</th>
              <th>操作</th>
            </tr></thead>
            <tbody>
              ${filteredData.length ? filteredData.map(w => {
                const qty = parseFloat(w.quantity);
                const qtySafe = Number.isFinite(qty) ? qty : 0;
                const upNum = parseFloat(w.unit_price);
                const hasUnitPrice = w.unit_price != null && w.unit_price !== '' && Number.isFinite(upNum);
                const wid = Number(w.id);
                return `
                <tr>
                  <td><span class="badge badge-gray" style="font-weight:600">${escapeHtml(yearFrameDisplayLabel({ year: w.year_frame_name, id: w.year_frame_id }))}</span></td>
                  <td>${escapeHtml(w.month || '—')}</td>
                  <td><span class="badge badge-gray">${escapeHtml((w.brand != null && String(w.brand).trim() !== '' ? String(w.brand).trim() : 'PHD'))}</span></td>
                  <td><span class="badge badge-accent">${(() => { const r = normalizeWarehouseRegion(w.region); return r ? escapeHtml(r) : '—'; })()}</span></td>
                  <td>${qtySafe}<span style="font-size:11px;color:var(--text-muted);margin-left:3px">月</span></td>
                  <td>${hasUnitPrice ? fmtMoney(upNum) : '—'}</td>
                  <td class="amount amount-revenue">${fmtMoney(w.quoted_price)}</td>
                  <td class="amount ${w.no_actual_cost ? 'amount-neutral' : (parseFloat(w.actual_cost)>0?'amount-cost':'amount-neutral')}">${w.no_actual_cost ? '无' : (parseFloat(w.actual_cost)>0?fmtMoney(w.actual_cost):'—')}</td>
                  <td>${paymentStatusHtml(w.payment_status, w.payment_order_id)}</td>
                  <td>
                    <div style="display:flex;gap:4px">
                      <button class="btn btn-secondary btn-sm" onclick="showWarehouseModal(${w.id})">编辑</button>
                      <button class="btn btn-danger btn-sm" onclick="deleteWarehouse(${w.id})">删</button>
                    </div>
                  </td>
                </tr>
              `;
              }).join('') : '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:30px">暂无数据</td></tr>'}
            </tbody>
          </table>
        </div>
        </div>
      `;
    }
    void updateBadges();
    renderLucideIcons();
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

function setWarehouseMergeFilter(v) {
  warehouseMergeFilter = v || 'all';
  loadWarehouse();
}

function warehouseFiscalMonths() {
  const yy = parseInt(String(currentYear || '').match(/\d{2}/)?.[0] || '26', 10);
  const startYear = 2000 + yy;
  const out = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(Date.UTC(startYear, 3 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function daysInMonthValue(monthValue) {
  const [y, m] = String(monthValue || '').split('-').map((x) => parseInt(x, 10));
  if (!y || !m) return 0;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function warehouseFixedCostPreviewRows() {
  const region = document.getElementById('warFixedRegion')?.value || '北区';
  const monthChecks = Array.from(document.querySelectorAll('.war-fixed-month:checked')).map((x) => x.value);
  return monthChecks.map((month) => {
    const days = daysInMonthValue(month);
    const amount = region === '北区' ? roundMoney2(days * 100) : 5600;
    return { region, month, days, amount };
  });
}

function updateWarehouseFixedCostPreview() {
  const rows = warehouseFixedCostPreviewRows();
  const total = roundMoney2(rows.reduce((s, r) => s + r.amount, 0));
  const el = document.getElementById('warFixedPreview');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="color:var(--text-secondary);font-size:13px">将生成 ${rows.length} 条记录</span>
      <span class="amount" style="font-weight:800">${fmtMoney(total)}</span>
    </div>
    <div style="max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px">
      <table class="data-table">
        <thead><tr><th>区域</th><th>月份</th><th>计算</th><th style="text-align:right">成本</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.region)}</td><td>${escapeHtml(r.month)}</td><td>${r.region === '北区' ? `${r.days}天 x 100元` : '仓储+人工固定 5600元/月'}</td><td class="amount" style="text-align:right">${fmtMoney(r.amount)}</td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:14px">请选择月份</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function showWarehouseFixedCostModal() {
  const body = document.getElementById('warFixedCostBody');
  if (!body) return;
  const months = warehouseFiscalMonths();
  const monthHtml = months
    .map((m) => `<label style="display:flex;align-items:center;gap:6px;padding:8px;border:1px solid var(--border);border-radius:8px;cursor:pointer"><input type="checkbox" class="war-fixed-month" value="${m}" onchange="updateWarehouseFixedCostPreview()"> <span>${m}</span></label>`)
    .join('');
  body.innerHTML = `
    <div class="form-grid" style="grid-template-columns:1fr 1fr">
      <div class="form-group">
        <label class="form-label">财年</label>
        <input type="text" class="form-control" value="${escapeHtml(String(currentYear || '').padStart(2, '0'))}年度" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">区域</label>
        <select class="form-control" id="warFixedRegion" onchange="updateWarehouseFixedCostPreview()">
          <option value="北区">北区：按天 100 元</option>
          <option value="南区">南区：5600 元/月</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">品牌</label>
        <select class="form-control" id="warFixedBrand">
          ${WAREHOUSE_BRAND_OPTIONS.map((b) => `<option value="${b}" ${b === 'PHD' ? 'selected' : ''}>${b}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">收款方 <span class="required">*</span></label>
        <input type="text" class="form-control" id="warFixedPayee" placeholder="付款筛选用">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">月份</label>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">${monthHtml}</div>
    </div>
    <div id="warFixedPreview"></div>
  `;
  openModal('modalWarehouseFixedCost');
  updateWarehouseFixedCostPreview();
}

async function saveWarehouseFixedCosts() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可保存', 'warning');
    return;
  }
  const payee = document.getElementById('warFixedPayee')?.value?.trim() || '';
  const brand = document.getElementById('warFixedBrand')?.value || 'PHD';
  const rows = warehouseFixedCostPreviewRows();
  if (!payee) {
    showToast('请填写收款方', 'warning');
    return;
  }
  if (!rows.length) {
    showToast('请选择月份', 'warning');
    return;
  }
  const existing = new Set((warehouseState.data || []).map((w) => `${w.year_frame_id}:${normalizeWarehouseRegion(w.region)}:${w.month}`));
  const toCreate = rows.filter((r) => !existing.has(`${currentYearFrameId}:${r.region}:${r.month}`));
  if (!toCreate.length) {
    showToast('所选月份已存在同区域仓储记录，未生成重复记录', 'warning');
    return;
  }
  try {
    for (const r of toCreate) {
      await api('POST', '/warehouse', {
        year_frame_id: currentYearFrameId || 1,
        month: r.month,
        brand,
        region: r.region,
        wine_name: '',
        specifications: r.region === '北区' ? '固定仓储费' : '固定仓储+人工',
        quantity: r.region === '北区' ? r.days : 1,
        unit_price: r.region === '北区' ? 100 : 5600,
        quoted_price: 0,
        actual_cost: r.amount,
        no_actual_cost: 0,
        payee_name: payee,
        remarks: r.region === '北区' ? `${r.month} 北区固定仓储费：${r.days}天 x 100元` : `${r.month} 南区固定仓储+人工：5600元/月`,
      });
    }
    const skipped = rows.length - toCreate.length;
    showToast(`已生成 ${toCreate.length} 条固定仓储成本${skipped ? `，跳过重复 ${skipped} 条` : ''}`, 'success');
    closeModal();
    await loadWarehouse();
  } catch (e) {
    showToast(e.message || '生成失败', 'error');
  }
}

async function showWarehouseQuoteModal() {
  await showWarehouseModal(null, { quote: true });
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
    const label = yearFrameDisplayLabel(f);
    return `<option value="${f.id}">${escapeHtml(label || String(f.id))}</option>`;
  }).join('');
  const want = preferredFrameId || currentYearFrameId;
  if (want && frames.some(f => String(f.id) === String(want))) {
    sel.value = String(want);
  } else if (frames[0]) {
    sel.value = String(frames[0].id);
  }
}

async function showWarehouseModal(id = null, opts = {}) {
  const wid = id != null && id !== '' ? Number(id) : NaN;
  const editing = Number.isFinite(wid);
  const quoteNew = !editing && opts.quote === true;

  document.getElementById('warModalTitle').textContent = quoteNew
    ? '新建仓储报价'
    : editing
      ? '编辑仓储记录'
      : '新建仓储记录';
  document.getElementById('warId').value = editing ? String(wid) : '';
  ['warMonth', 'warQty', 'warUnitPrice', 'warQuotedPrice', 'warActualCost', 'warPayeeName', 'warRemarks', 'warProject', 'warAllocationNote', 'warPeriodStart', 'warPeriodEnd'].forEach((fid) => {
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
  const yfWrap = document.getElementById('warYearFrameWrap');
  const yfHint = document.getElementById('warYearFrameHint');
  if (yfWrap) yfWrap.style.display = '';
  if (yfHint) yfHint.style.display = 'none';

  let preferredYf = currentYearFrameId;
  let item = null;
  if (editing) {
    try {
      item = await api('GET', `/warehouse/${wid}`);
    } catch (e) {
      item = warehouseState.data.find((w) => Number(w.id) === wid) || null;
      if (!item) showToast('加载记录失败: ' + (e.message || ''), 'error');
    }
  }

  const periodParsed = item && item.month ? parseWarehouseMonthRangeToDates(item.month) : null;
  const usePeriod = quoteNew || !!periodParsed;

  if (quoteNew) {
    applyWarehouseFormMode('period_quote');
    if (yfWrap) yfWrap.style.display = 'none';
    if (noCostCb) {
      noCostCb.checked = true;
      toggleWarNoActualCost();
    }
    const remarks = document.getElementById('warRemarks');
    if (remarks && !remarks.value) remarks.value = '仓储报价记录';
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const ps = document.getElementById('warPeriodStart');
    const pe = document.getElementById('warPeriodEnd');
    if (ps) ps.value = `${y}-${m}-01`;
    if (pe) pe.value = todayDateInputValue();
    onWarehousePeriodChange();
  } else {
    applyWarehouseFormMode(usePeriod ? 'period_quote' : 'legacy');
    toggleWarNoActualCost();
  }

  await loadLogProjectDatalist();

  if (item) {
    preferredYf = item.year_frame_id;
    const b = item.brand != null && String(item.brand).trim() !== '' ? String(item.brand).trim() : 'PHD';
    if (brandEl) brandEl.value = WAREHOUSE_BRAND_OPTIONS.includes(b) ? b : 'PHD';
    const rSel = normalizeWarehouseRegion(item.region);
    if (reg) reg.value = WAREHOUSE_REGION_OPTIONS.includes(rSel) ? rSel : '';
    if (periodParsed) {
      const ps = document.getElementById('warPeriodStart');
      const pe = document.getElementById('warPeriodEnd');
      if (ps) ps.value = periodParsed.start;
      if (pe) pe.value = periodParsed.end;
      document.getElementById('warMonth').value = '';
      onWarehousePeriodChange();
    } else {
      document.getElementById('warMonth').value = item.month || '';
    }
    document.getElementById('warQty').value = item.quantity != null && item.quantity !== '' ? item.quantity : '';
    document.getElementById('warUnitPrice').value =
      item.unit_price != null && item.unit_price !== '' ? roundMoney2(item.unit_price).toFixed(2) : '';
    document.getElementById('warQuotedPrice').value =
      item.quoted_price != null && item.quoted_price !== '' ? roundMoney2(item.quoted_price).toFixed(2) : '';
    document.getElementById('warActualCost').value =
      item.actual_cost != null && item.actual_cost !== '' ? roundMoney2(item.actual_cost).toFixed(2) : '';
    document.getElementById('warPayeeName').value = item.payee_name || '';
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
    const rpc =
      item.related_project_code != null && String(item.related_project_code).trim() !== ''
        ? String(item.related_project_code).trim()
        : item.activity_project_code != null && String(item.activity_project_code).trim() !== ''
          ? String(item.activity_project_code).trim()
          : item.project_code != null && String(item.project_code).trim() !== ''
            ? String(item.project_code).trim()
            : '';
    const warProjectEl = document.getElementById('warProject');
    if (warProjectEl) warProjectEl.value = rpc;
    if (periodParsed) {
      const merged =
        item.merged_into_activity === true || item.merged_into_activity === 1 || String(item.merged_into_activity) === '1';
      if (merged || (rpc && rpc.trim())) {
        const proj = document.getElementById('warProjectBlock');
        const merge = document.getElementById('warMergeBlock');
        if (proj) proj.style.display = '';
        if (merge) merge.style.display = '';
      }
    }
  }

  try {
    await fillWarehouseYearFrameSelect(preferredYf);
  } catch (e) {
    showToast('加载年框失败: ' + (e.message || ''), 'error');
  }

  if (quoteNew) {
    if (yfWrap) yfWrap.style.display = 'none';
    const sel = document.getElementById('warYearFrameId');
    if (sel && currentYearFrameId) sel.value = String(currentYearFrameId);
  }

  if (item) {
    const rSel2 = normalizeWarehouseRegion(item.region);
    if (reg) reg.value = WAREHOUSE_REGION_OPTIONS.includes(rSel2) ? rSel2 : '';
  }
  updateWarQuotedPrice();
  openModal('modalWarehouse');
}

async function saveWarehouse() {
  const id = document.getElementById('warId').value;
  let yearFrameId = parseInt(document.getElementById('warYearFrameId').value, 10);
  if (!yearFrameId && currentYearFrameId) yearFrameId = currentYearFrameId;
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
  let monthVal = null;
  let qty = 0;
  if (warehouseFormMode === 'period_quote') {
    const ps = document.getElementById('warPeriodStart')?.value || '';
    const pe = document.getElementById('warPeriodEnd')?.value || '';
    monthVal = warehouseMonthLabelFromPeriodDates(ps, pe) || null;
    qty = warehousePeriodMonthCount(ps, pe);
    if (!ps || !pe) {
      showToast('请选择账期起止日期', 'warning');
      return;
    }
    if (qty <= 0) {
      showToast('账期无效：结束日期应不早于起始日期', 'warning');
      return;
    }
  } else {
    monthVal = document.getElementById('warMonth')?.value?.trim() || null;
    qty = parseInt(document.getElementById('warQty').value, 10) || 0;
    if (qty <= 0) {
      showToast('数量（月）须大于 0', 'error');
      return;
    }
  }
  const unitPrice = roundMoney2(document.getElementById('warUnitPrice').value);
  if (unitPrice <= 0) {
    showToast('单价须大于 0', 'error');
    return;
  }
  const projBlock = document.getElementById('warProjectBlock');
  const projHidden = projBlock && projBlock.style.display === 'none';
  const warProjectRaw = projHidden ? '' : (document.getElementById('warProject')?.value || '').replace(/^\uFEFF/, '').trim();
  if (warProjectRaw && !logisticsProjectIndex.codes.has(warProjectRaw)) {
    showToast('关联项目编号必须从活动项目编号中选择（请从下拉建议中选中）', 'error');
    return;
  }
  const mergedIntoActivity = projHidden ? false : !!document.getElementById('warMergedIntoActivity')?.checked;
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
    month: monthVal,
    brand,
    region,
    wine_name: '',
    specifications: '',
    quantity: qty,
    unit_price: unitPrice,
    quoted_price: roundMoney2(document.getElementById('warQuotedPrice').value),
    actual_cost: document.getElementById('warNoActualCost')?.checked ? 0 : roundMoney2(document.getElementById('warActualCost').value),
    payee_name: document.getElementById('warPayeeName')?.value?.trim() || null,
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
   页面：字典管理（通讯录 + 表单选项）
   - 通讯录（5 类内置 + 自定义）→ /api/dict
   - 表单选项（7 个 lookup_options category）→ /api/lookups
   说明：UX 遵循 ui-ux-pro-max（§4 一致性 / §8 分组 / §9 nav-hierarchy）。
   ============================================= */

/** 通讯录类别 schema：每个 category 定义可编辑字段集 & 主键字段（name 来源） */
const DICT_CATEGORY_DEFS = {
  recipient: {
    label: '收件人',
    icon: 'package',
    desc: '出库单常用收件人（联系人 / 电话 / 地址 / 城市）',
    fields: [
      { key: 'contact_name', label: '联系人', type: 'text', required: true },
      { key: 'phone', label: '联系电话', type: 'tel' },
      { key: 'address', label: '收件地址', type: 'text' },
      { key: 'city', label: '城市', type: 'text' },
    ],
    nameField: 'contact_name',
  },
  sender: {
    label: '发件方',
    icon: 'truck',
    desc: '物流发件方 / 仓库默认发件人',
    fields: [
      { key: 'warehouse_name', label: '仓库 / 公司', type: 'text' },
      { key: 'contact_name', label: '发件人', type: 'text', required: true },
      { key: 'phone', label: '联系电话', type: 'tel' },
      { key: 'address', label: '发件地址', type: 'text' },
    ],
    nameField: 'warehouse_name',
    nameFallback: 'contact_name',
  },
  supplier: {
    label: '供应商',
    icon: 'building-2',
    desc: '付款 / 报销开票主体（税号 / 银行 / 开票信息）',
    fields: [
      { key: 'company_name', label: '公司名称', type: 'text', required: true },
      { key: 'tax_no', label: '统一社会信用代码 / 税号', type: 'text' },
      { key: 'bank_name', label: '开户银行', type: 'text' },
      { key: 'bank_account', label: '银行账号', type: 'text' },
      { key: 'invoice_address', label: '开票地址', type: 'text' },
      { key: 'invoice_phone', label: '开票电话', type: 'tel' },
      { key: 'company_address', label: '公司地址', type: 'text' },
      { key: 'contact_name', label: '联系人', type: 'text' },
      { key: 'contact_phone', label: '联系电话', type: 'tel' },
    ],
    nameField: 'company_name',
  },
  payee: {
    label: '收款人',
    icon: 'credit-card',
    desc: '物流 / 服务方收款信息',
    fields: [
      { key: 'company_name', label: '收款方名称', type: 'text', required: true },
      { key: 'bank_name', label: '开户银行', type: 'text' },
      { key: 'bank_account', label: '银行账号', type: 'text' },
      { key: 'tax_no', label: '税号', type: 'text' },
      { key: 'contact_phone', label: '联系电话', type: 'tel' },
    ],
    nameField: 'company_name',
  },
  reimburser: {
    label: '报销人员',
    icon: 'user-circle-2',
    desc: '公司内部报销人员',
    fields: [
      { key: 'employee_name', label: '姓名', type: 'text', required: true },
      { key: 'employee_id', label: '员工编号', type: 'text' },
      { key: 'department', label: '部门', type: 'text' },
      { key: 'bank_card', label: '银行卡号', type: 'text' },
      { key: 'phone', label: '联系电话', type: 'tel' },
    ],
    nameField: 'employee_name',
  },
};

const DICT_BUILTIN_CATEGORIES = Object.keys(DICT_CATEGORY_DEFS);

/**
 * 用 dict_categories 表中 is_builtin 记录覆盖本地硬编码的 DICT_CATEGORY_DEFS。
 * 仅覆盖 label / icon / desc / fields（若 DB 有值），保持 nameField 等不变。
 */
function dictApplyBuiltinOverrides() {
  (dictPageState.customCategories || []).forEach((cc) => {
    if (!DICT_BUILTIN_CATEGORIES.includes(cc.code)) return;
    const def = DICT_CATEGORY_DEFS[cc.code];
    if (!def) return;
    if (cc.label) def.label = cc.label;
    if (cc.icon) def.icon = cc.icon;
    if (cc.description) def.desc = cc.description;
    const schema = Array.isArray(cc.fields_schema) ? cc.fields_schema : [];
    if (schema.length) {
      def.fields = schema.map((f) => ({
        key: f.key || '',
        label: f.label || f.key || '',
        type: f.type || 'text',
        required: !!f.required,
        placeholder: f.placeholder || '',
      }));
    }
  });
}

/** 表单下拉选项类别（复用现有 lookup_options） */
const DICT_LOOKUP_DEFS = [
  { category: 'activity_year_frame_code', label: '年框编号', icon: 'tag' },
  { category: 'activity_type', label: '活动类型', icon: 'sparkles' },
  { category: 'activity_period', label: '时段', icon: 'clock' },
  { category: 'activity_region', label: '区域', icon: 'map-pin' },
  { category: 'activity_belonging', label: '归属', icon: 'briefcase' },
  { category: 'activity_executor', label: '执行人员', icon: 'user' },
  { category: 'activity_status', label: '状态', icon: 'check-circle' },
];

const dictPageState = {
  /** 'dict' | 'lookup' | 'custom' */
  group: 'dict',
  /** category 名称（属于 group 的子项） */
  category: 'recipient',
  /** 列表数据 */
  rows: [],
  /** 类别统计（仅 dict） */
  catStats: {},
  /** 搜索词（仅 dict 用） */
  q: '',
  /** 是否含停用 */
  includeInactive: false,
  /** 加载中 */
  loading: false,
  /** 自定义类别列表（从 dict_categories 表加载） */
  customCategories: [],
};

function dictCurrentCategoryLabel() {
  if (dictPageState.group === 'dict') {
    const def = DICT_CATEGORY_DEFS[dictPageState.category];
    return def ? def.label : dictPageState.category;
  }
  if (dictPageState.group === 'custom') {
    const cc = (dictPageState.customCategories || []).find((c) => c.code === dictPageState.category);
    return cc ? cc.label : dictPageState.category;
  }
  const def = DICT_LOOKUP_DEFS.find((d) => d.category === dictPageState.category);
  return def ? def.label : dictPageState.category;
}

function dictCurrentCategoryDef() {
  if (dictPageState.group === 'dict') return DICT_CATEGORY_DEFS[dictPageState.category];
  if (dictPageState.group === 'custom') {
    const cc = (dictPageState.customCategories || []).find((c) => c.code === dictPageState.category);
    if (!cc) return null;
    const schema = Array.isArray(cc.fields_schema) ? cc.fields_schema : [];
    return {
      label: cc.label,
      icon: cc.icon || 'tag',
      desc: cc.description || '',
      fields: schema.map((f) => ({
        key: f.key || f.name || '',
        label: f.label || f.key || '',
        type: f.type || 'text',
        required: !!f.required,
      })),
      nameField: schema.length ? (schema[0].key || schema[0].name || '') : 'name',
      _customCategoryId: cc.id,
    };
  }
  return DICT_LOOKUP_DEFS.find((d) => d.category === dictPageState.category);
}

/** 主入口：渲染字典管理页面 */
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
      await api('PUT', `/dict/${id}`, body);
      showToast('已保存', 'success');
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
  const p = beijingParts(v);
  if (!p) return v ? String(v) : '—';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`;
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
/** 物料采购品牌归桶：从任意字符串里识别 PHD / X.O / CLUB / RC / 其他
 *  优先级：PHD > X.O > CLUB > RC > 其他（避免「N220630-RC PHD」被错判为 RC）
 *  说明：项目编码型字符串（如「N230530-RM Club」「Remy-RC」）也能正确识别。
 */
const MATERIAL_BRAND_BUCKETS = ['PHD', 'X.O', 'CLUB', 'RC', '其他'];

function detectBrandBucket(...inputs) {
  const raw = inputs
    .filter((x) => x !== undefined && x !== null && x !== '')
    .map((x) => String(x))
    .join(' ')
    .toUpperCase();
  const compact = raw.replace(/\s+/g, '');
  if (!raw) return '其他';
  if (compact.includes('PHD')) return 'PHD';
  if (compact.includes('X.O') || /(^|[^A-Z])XO([^A-Z]|$)/.test(raw)) return 'X.O';
  if (compact.includes('CLUB')) return 'CLUB';
  if (compact.includes('RC') || compact.includes('REMY')) return 'RC';
  return '其他';
}

/** 兼容旧调用名 */
function materialPurchaseBrandBucket(brandCode, brandName) {
  return detectBrandBucket(brandCode, brandName);
}

/** 按"明细行级"或"整条级"统一聚合，输入数组每项必须有 brandBucket + total_amount/subtotal */
function materialPurchaseAggFiveBuckets(items) {
  const totals = {};
  const counts = {};
  MATERIAL_BRAND_BUCKETS.forEach((k) => { totals[k] = 0; counts[k] = 0; });
  (items || []).forEach((it) => {
    const k = MATERIAL_BRAND_BUCKETS.includes(it.brandBucket) ? it.brandBucket : '其他';
    const amt = roundMoney2(it.subtotal != null ? it.subtotal : it.total_amount);
    totals[k] = roundMoney2(totals[k] + amt);
    counts[k] += 1;
  });
  return { totals, counts };
}

/** 旧名兼容（4 桶接口）：返回 5 桶但保留对外 keys，调用方需改用新逻辑 */
function materialPurchaseAggFourBuckets(rowsAllYear) {
  const items = (rowsAllYear || []).map((r) => ({
    brandBucket: detectBrandBucket(r.brand_code, r.brand_name, r.brand),
    total_amount: r.total_amount,
  }));
  return materialPurchaseAggFiveBuckets(items);
}

function materialPurchaseBrandMatchesFilter(row, brandId, brands) {
  if (!brandId) return true;
  if (String(row.brand_id || '') === String(brandId)) return true;
  const b = (brands || []).find((x) => String(x.id) === String(brandId));
  if (!b) return false;
  const rowBrand = String(row.brand_code || row.brand_name || row.brand || '').trim().toUpperCase();
  const brandCode = String(b.brand_code || '').trim().toUpperCase();
  const brandName = String(b.brand_name || '').trim().toUpperCase();
  return !!rowBrand && (rowBrand === brandCode || rowBrand === brandName);
}

function materialPurchaseRowsFromReimbursements(rows, brands, brandId = '') {
  return (rows || [])
    .filter((r) => {
      const m = String(r.cost_module || '');
      return m && m !== 'activity';
    })
    .map((r) => {
      const brand = String(r.brand || '').trim();
      const brandInfo = (brands || []).find((b) => {
        const code = String(b.brand_code || '').trim().toUpperCase();
        const name = String(b.brand_name || '').trim().toUpperCase();
        const rb = brand.toUpperCase();
        return rb && (rb === code || rb === name);
      });
      const meta = reimbReadDetailMeta(r.remarks || '');
      const detailRows = Array.isArray(meta.rows) ? meta.rows : [];
      const items = detailRows
        .filter((row) => row && row.block)
        .map((row) => {
          const blockLabel = (REIMB_DETAIL_BLOCKS.find((b) => b.value === row.block) || {}).label || row.block;
          const catLabel = (REIMB_DETAIL_CATEGORY_OPTIONS[row.block] || []).find(([v]) => v === row.category)?.[1] || row.category || '';
          const composedName = [blockLabel, catLabel].filter(Boolean).join(' · ');
          return {
            name: composedName || '其他',
            amount: roundMoney2(row.subtotal),
          };
        })
        .filter((row) => row.name && row.amount > 0);
      const mapped = {
        ...r,
        source_type: 'reimbursement',
        source_label: '报销申请',
        id: r.id,
        brand_id: brandInfo ? brandInfo.id : null,
        brand_code: brandInfo?.brand_code || brand,
        brand_name: brandInfo?.brand_name || brand,
        purchase_date: r.date,
        total_amount: roundMoney2(r.amount),
        activity_project_code: r.related_project_code || '',
        allocation_note: '报销申请',
        remarks: reimbVisibleRemarks(r.remarks || ''),
        items,
      };
      return mapped;
    })
    .filter((row) => materialPurchaseBrandMatchesFilter(row, brandId, brands));
}

/** 财年范围（每年 4 月 1 日 - 次年 3 月 31 日） */
function currentFiscalYearRange(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const startYear = m >= 4 ? y : y - 1;
  const pad = (n) => String(n).padStart(2, '0');
  const shortYear = String(startYear).slice(-2);
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
    // 中文短标签（如「26财年」），用于仪表盘标题旁的小字
    label: `${shortYear}财年`,
    // 完整跨度文本（如「2026-04 ~ 2027-03」），用于 tooltip 或长描述
    fullLabel: `${startYear}-04 ~ ${startYear + 1}-03`,
    inRange(dateStr) {
      const s = String(dateStr || '').slice(0, 10);
      if (!s) return false;
      return s >= this.start && s <= this.end;
    },
    monthsList() {
      const arr = [];
      for (let i = 0; i < 12; i++) {
        const mm = 4 + i;
        const yy = startYear + Math.floor((mm - 1) / 12);
        const m2 = ((mm - 1) % 12) + 1;
        arr.push(`${yy}-${pad(m2)}`);
      }
      return arr;
    },
  };
}

/** 从报销列表里抽出"额外成本"——所有 cost_module ≠ 'activity' 报销单的全部明细行，扁平化成统计单元。
 *  额外成本：不计入具体活动场次（无项目编号）的成本支出，含物料采购 / 物流 / 道具维修 / 统筹等。
 */
function materialPurchaseDetailRowsFromReimbursements(reimbursementRows, options = {}) {
  const { fiscalYear } = options;
  const out = [];
  (reimbursementRows || []).forEach((r) => {
    const costModule = String(r.cost_module || '');
    if (!costModule || costModule === 'activity') return;
    if (fiscalYear && !fiscalYear.inRange(r.date)) return;
    const meta = reimbReadDetailMeta(r.remarks || '');
    const detailRows = Array.isArray(meta.rows) ? meta.rows : [];
    detailRows.forEach((row, idx) => {
      if (!row || !row.block) return;
      const subtotal = roundMoney2(row.subtotal);
      if (!(subtotal > 0)) return;
      const dateStr = String(r.date || '').slice(0, 10);
      const month = dateStr ? dateStr.slice(0, 7) : '';
      const brandRaw = (typeof row.brand === 'string' && row.brand.trim()) ? row.brand.trim() : String(r.brand || '').trim();
      const brandBucket = detectBrandBucket(brandRaw, r.brand);
      const blockLabel = (REIMB_DETAIL_BLOCKS.find((b) => b.value === row.block) || {}).label || row.block;
      const catLabel = (REIMB_DETAIL_CATEGORY_OPTIONS[row.block] || []).find(([v]) => v === row.category)?.[1] || row.category || '';
      // 类别标签：优先「区块 · 子类」，子类缺省时回退到区块名
      const categoryLabel = catLabel ? `${blockLabel} · ${catLabel}` : blockLabel;
      out.push({
        reimbId: r.id,
        reimbDate: dateStr,
        month,
        brandRaw,
        brandBucket,
        block: row.block,
        blockLabel,
        // 类别 key 用「block:category」组合，确保下拉去重且能跨 block 同名 category 区分
        category: `${row.block}:${row.category || ''}`,
        categoryLabel,
        description: String(row.description || '').trim(),
        quantity: Number(row.quantity) || 0,
        unitPrice: roundMoney2(row.unit_price),
        subtotal,
        rowIndex: idx,
        applicantName: r.applicant_name || '',
        projectCode: r.related_project_code || '',
        costModule,
      });
    });
  });
  return out;
}

/** 聚合仪表盘指标 */
function aggregateMaterialDashboardData(detailRows, keyword = '') {
  const kw = String(keyword || '').trim().toLowerCase();
  // 关键字同时匹配「物品描述」和「类别标签（区块·子类）」
  const matched = kw
    ? (detailRows || []).filter((d) => {
        const desc = String(d.description || '').toLowerCase();
        const cat = String(d.categoryLabel || '').toLowerCase();
        const blk = String(d.blockLabel || '').toLowerCase();
        return desc.includes(kw) || cat.includes(kw) || blk.includes(kw);
      })
    : (detailRows || []).slice();
  const all = detailRows || [];
  const sum = (arr, pick = (x) => x.subtotal) => roundMoney2((arr || []).reduce((s, x) => s + roundMoney2(pick(x)), 0));
  const sumQty = (arr) => (arr || []).reduce((s, x) => s + (Number(x.quantity) || 0), 0);

  const overview = {
    totalAmount: sum(all),
    totalCount: all.length,
    matchedAmount: sum(matched),
    matchedCount: matched.length,
    matchedQty: sumQty(matched),
    distinctReimb: new Set(matched.map((x) => x.reimbId)).size,
  };

  const byMonthMap = new Map();
  matched.forEach((x) => {
    const k = x.month || '未知';
    byMonthMap.set(k, roundMoney2((byMonthMap.get(k) || 0) + x.subtotal));
  });
  const byBrand = MATERIAL_BRAND_BUCKETS.map((bucket) => {
    const rows = matched.filter((x) => x.brandBucket === bucket);
    return { bucket, amount: sum(rows), count: rows.length };
  });
  const byCategoryMap = new Map();
  matched.forEach((x) => {
    const k = x.categoryLabel || '其他';
    const cur = byCategoryMap.get(k) || { amount: 0, count: 0 };
    cur.amount = roundMoney2(cur.amount + x.subtotal);
    cur.count += 1;
    byCategoryMap.set(k, cur);
  });
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([label, v]) => ({ label, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount);

  const topItemMap = new Map();
  matched.forEach((x) => {
    const k = x.description || '（未填写）';
    const cur = topItemMap.get(k) || { name: k, amount: 0, qty: 0, count: 0 };
    cur.amount = roundMoney2(cur.amount + x.subtotal);
    cur.qty += Number(x.quantity) || 0;
    cur.count += 1;
    topItemMap.set(k, cur);
  });
  const topItems = Array.from(topItemMap.values()).sort((a, b) => b.amount - a.amount);

  return { overview, matched, byMonth: byMonthMap, byBrand, byCategory, topItems };
}

/* ===== 物料分析仪表盘 ===== */
function materialDashboardSectionHtml(detailRowsFY, fy) {
  materialDashboardState.detailRowsFY = detailRowsFY || [];
  materialDashboardState.fy = fy || currentFiscalYearRange();
  const open = !!materialDashboardState.open;
  const fyLabel = materialDashboardState.fy.label;
  const totalRows = (detailRowsFY || []).length;
  const totalAmount = roundMoney2((detailRowsFY || []).reduce((s, x) => s + roundMoney2(x.subtotal), 0));
  return `
    <div class="card mp-dash-card" id="mpDashCard" style="margin-bottom:16px">
      <div class="card-header mp-dash-header" onclick="materialDashboardToggle()" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="card-title" style="display:flex;align-items:center;gap:8px">
            <i data-lucide="line-chart" style="width:16px;height:16px"></i>
            成本分析
          </div>
          <span class="badge badge-gray" title="${escapeHtml(materialDashboardState.fy.fullLabel || fyLabel)}">${escapeHtml(fyLabel)}</span>
          <span style="color:var(--text-muted);font-size:12px">${totalRows} 条明细 · 合计 ${fmtMoney(totalAmount)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;color:var(--text-secondary);font-size:13px">
          <span>${open ? '收起' : '展开'}</span>
          <i data-lucide="${open ? 'chevron-up' : 'chevron-down'}" style="width:14px;height:14px"></i>
        </div>
      </div>
      <div class="card-body mp-dash-body" id="mpDashBody" style="display:${open ? 'block' : 'none'};padding:14px"></div>
    </div>
  `;
}

function materialDashboardToggle() {
  materialDashboardState.open = !materialDashboardState.open;
  const body = document.getElementById('mpDashBody');
  if (body) body.style.display = materialDashboardState.open ? 'block' : 'none';
  const card = document.getElementById('mpDashCard');
  if (card) {
    const chev = card.querySelector('.mp-dash-header [data-lucide]');
    if (chev) {
      chev.setAttribute('data-lucide', materialDashboardState.open ? 'chevron-up' : 'chevron-down');
      const span = chev.parentElement.querySelector('span');
      if (span) span.textContent = materialDashboardState.open ? '收起' : '展开';
      renderLucideIcons();
    }
  }
  if (materialDashboardState.open) materialDashboardRender();
}

function materialDashboardMount(detailRowsFY, fy) {
  materialDashboardState.detailRowsFY = detailRowsFY || [];
  materialDashboardState.fy = fy || currentFiscalYearRange();
  if (materialDashboardState.open) materialDashboardRender();
}

function materialDashboardOnKeywordInput(v) {
  materialDashboardState.keyword = String(v || '');
  // 防抖：250ms 内合并多次输入
  clearTimeout(materialDashboardOnKeywordInput._t);
  materialDashboardOnKeywordInput._t = setTimeout(() => {
    materialDashboardRender({ preserveFocus: true });
  }, 220);
}

function materialDashboardClearKeyword() {
  materialDashboardState.keyword = '';
  materialDashboardRender();
}

function materialDashboardSetBrand(v) {
  materialDashboardState.brand = v || '';
  materialDashboardRender();
}

function materialDashboardSetCategory(v) {
  materialDashboardState.category = v || '';
  materialDashboardRender();
}

function materialDashboardSetTopLimit(v) {
  materialDashboardState.topLimit = Number(v) || 10;
  materialDashboardRender();
}

function materialDashboardCurrentDetailRows() {
  const { detailRowsFY, brand, category } = materialDashboardState;
  return (detailRowsFY || []).filter((d) => {
    if (brand && d.brandBucket !== brand) return false;
    if (category && d.category !== category) return false;
    return true;
  });
}

function materialDashboardRender(opts = {}) {
  const body = document.getElementById('mpDashBody');
  if (!body) return;
  const state = materialDashboardState;
  const filtered = materialDashboardCurrentDetailRows();
  const data = aggregateMaterialDashboardData(filtered, state.keyword);
  const fy = state.fy || currentFiscalYearRange();
  const kw = state.keyword.trim();

  const overview = data.overview;
  const overviewCards = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:12px">
      <div class="stat-card" style="min-height:96px">
        <div class="stat-label">${kw ? `命中"${escapeHtml(kw)}"金额` : '财年总金额'}</div>
        <div class="stat-value sm">${fmtMoney(overview.matchedAmount)}</div>
        <div class="stat-sub">${overview.matchedCount} 条明细 · ${overview.distinctReimb} 张报销</div>
      </div>
      <div class="stat-card" style="min-height:96px">
        <div class="stat-label">${kw ? '命中数量合计' : '财年明细数量合计'}</div>
        <div class="stat-value sm">${fmtNumber(overview.matchedQty || 0)}</div>
        <div class="stat-sub">数量字段累计</div>
      </div>
      <div class="stat-card" style="min-height:96px">
        <div class="stat-label">${kw ? '占财年总金额比' : '财年合计'}</div>
        <div class="stat-value sm">${overview.totalAmount > 0 ? formatPercent(overview.matchedAmount / overview.totalAmount) : '—'}</div>
        <div class="stat-sub">${fmtMoney(overview.totalAmount)} · ${overview.totalCount} 条</div>
      </div>
    </div>
  `;

  // 类别选项（从财年明细动态生成，按 block 在常量数组中的顺序排序）
  const blockOrder = new Map(REIMB_DETAIL_BLOCKS.map((b, i) => [b.value, i]));
  const categorySet = new Map();
  (state.detailRowsFY || []).forEach((d) => {
    if (!categorySet.has(d.category)) categorySet.set(d.category, { label: d.categoryLabel, block: d.block });
  });
  const categoryEntries = Array.from(categorySet.entries()).sort((a, b) => {
    const oa = blockOrder.has(a[1].block) ? blockOrder.get(a[1].block) : 99;
    const ob = blockOrder.has(b[1].block) ? blockOrder.get(b[1].block) : 99;
    if (oa !== ob) return oa - ob;
    return String(a[1].label).localeCompare(String(b[1].label), 'zh-CN');
  });
  const categoryOpts = categoryEntries
    .map(([v, info]) => `<option value="${escapeHtml(v)}" ${state.category === v ? 'selected' : ''}>${escapeHtml(info.label)}</option>`)
    .join('');
  const brandOpts = MATERIAL_BRAND_BUCKETS
    .map((b) => `<option value="${escapeHtml(b)}" ${state.brand === b ? 'selected' : ''}>${escapeHtml(b)}</option>`)
    .join('');

  const filterBar = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
      <div style="position:relative;flex:1 1 240px;min-width:200px">
        <i data-lucide="search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text-muted)"></i>
        <input id="mpDashSearch" class="filter-select" placeholder="按物料/项目名称检索，如：腰果、印刷、快递..."
               value="${escapeHtml(kw)}" oninput="materialDashboardOnKeywordInput(this.value)"
               style="padding-left:30px;width:100%" />
        ${kw ? `<button class="btn btn-ghost btn-sm" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);padding:4px 8px" onclick="materialDashboardClearKeyword()">清除</button>` : ''}
      </div>
      <select class="filter-select" onchange="materialDashboardSetBrand(this.value)">
        <option value="">全部品牌桶</option>${brandOpts}
      </select>
      <select class="filter-select" onchange="materialDashboardSetCategory(this.value)">
        <option value="">全部类别</option>${categoryOpts}
      </select>
      <select class="filter-select" onchange="materialDashboardSetTopLimit(this.value)">
        ${[5, 10, 20, 50].map((n) => `<option value="${n}" ${state.topLimit === n ? 'selected' : ''}>Top ${n}</option>`).join('')}
      </select>
    </div>
  `;

  const monthsList = fy.monthsList();
  const monthData = monthsList.map((m) => roundMoney2(data.byMonth.get(m) || 0));
  const brandBadgeClass = (bucket) => ({
    PHD: 'badge-accent',
    'X.O': 'badge-warning',
    CLUB: 'badge-blue',
    RC: 'badge-success',
    '其他': 'badge-gray',
  }[bucket] || 'badge-gray');
  const brandTableRows = data.byBrand
    .map(
      (b) => `<tr>
        <td><span class="badge ${brandBadgeClass(b.bucket)}">${escapeHtml(b.bucket)}</span></td>
        <td style="text-align:right" class="amount">${fmtMoney(b.amount)}</td>
        <td style="text-align:right;color:var(--text-secondary)">${b.count}</td>
      </tr>`
    )
    .join('');
  const categoryTableRows = data.byCategory.length
    ? data.byCategory
        .map(
          (c) => `<tr>
            <td>${escapeHtml(c.label)}</td>
            <td style="text-align:right" class="amount">${fmtMoney(c.amount)}</td>
            <td style="text-align:right;color:var(--text-secondary)">${c.count}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:14px">暂无数据</td></tr>';

  const topItems = data.topItems.slice(0, state.topLimit);
  const topRows = topItems.length
    ? topItems
        .map(
          (t, i) => `<tr>
            <td style="color:var(--text-muted);width:32px">${i + 1}</td>
            <td>${escapeHtml(t.name)}</td>
            <td style="text-align:right" class="amount">${fmtMoney(t.amount)}</td>
            <td style="text-align:right;color:var(--text-secondary)">${fmtNumber(t.qty || 0)}</td>
            <td style="text-align:right;color:var(--text-secondary)">${t.count}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:14px">暂无命中</td></tr>';

  const hits = kw ? data.matched.slice(0, 50) : [];
  const hitsBlock = kw
    ? `
    <div class="card" style="margin-top:12px">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <div class="card-title">命中明细（前 50 条）</div>
        <div style="color:var(--text-muted);font-size:12px">关键字："${escapeHtml(kw)}" · 共 ${data.matched.length} 条</div>
      </div>
      <div class="card-body" style="padding:0">
        <div class="table-wrapper mp-hits-scroll">
          <table class="mp-hits-table">
            <thead><tr><th>日期</th><th>报销#</th><th>品牌</th><th>类别</th><th>项目名称</th><th style="text-align:right">数量</th><th style="text-align:right">单价</th><th style="text-align:right">小计</th></tr></thead>
            <tbody>${hits.map((h) => `<tr style="cursor:pointer" onclick="reimbursementOpenDetailModal(${h.reimbId})">
              <td>${escapeHtml(h.reimbDate)}</td>
              <td>#${escapeHtml(h.reimbId)}</td>
              <td><span class="badge ${brandBadgeClass(h.brandBucket)}">${escapeHtml(h.brandBucket)}</span></td>
              <td>${escapeHtml(h.categoryLabel)}</td>
              <td title="${escapeHtml(h.description || '')}">${escapeHtml(h.description || '—')}</td>
              <td style="text-align:right">${fmtNumber(h.quantity || 0)}</td>
              <td style="text-align:right">${fmtMoney(h.unitPrice)}</td>
              <td style="text-align:right" class="amount">${fmtMoney(h.subtotal)}</td>
            </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:14px">无命中</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`
    : '';

  body.innerHTML = `
    ${filterBar}
    ${overviewCards}
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-bottom:12px">
      <div class="card mp-dash-chart">
        <div class="card-header"><div class="card-title">月度走势（财年）</div></div>
        <div class="card-body" style="padding:10px 12px"><div style="position:relative;height:240px"><canvas id="chartMpMonth"></canvas></div></div>
      </div>
      <div class="card mp-dash-chart">
        <div class="card-header"><div class="card-title">品牌占比</div></div>
        <div class="card-body" style="padding:10px 12px"><div style="position:relative;height:240px"><canvas id="chartMpBrand"></canvas></div></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="card">
        <div class="card-header"><div class="card-title">品牌明细（明细行级）</div></div>
        <div class="card-body" style="padding:0">
          <div class="table-wrapper"><table>
            <thead><tr><th>品牌桶</th><th style="text-align:right">金额</th><th style="text-align:right">明细数</th></tr></thead>
            <tbody>${brandTableRows}</tbody>
          </table></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">类别分布</div></div>
        <div class="card-body" style="padding:0">
          <div class="table-wrapper"><table>
            <thead><tr><th>类别</th><th style="text-align:right">金额</th><th style="text-align:right">明细数</th></tr></thead>
            <tbody>${categoryTableRows}</tbody>
          </table></div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <div class="card-title">成本明细 Top ${state.topLimit}${kw ? `（含"${escapeHtml(kw)}"）` : ''}</div>
        <div style="color:var(--text-muted);font-size:12px">按金额降序，按项目名称聚合</div>
      </div>
      <div class="card-body" style="padding:0">
        <div class="table-wrapper"><table>
          <thead><tr><th style="width:32px">#</th><th>项目名称</th><th style="text-align:right">金额</th><th style="text-align:right">数量</th><th style="text-align:right">出现次数</th></tr></thead>
          <tbody>${topRows}</tbody>
        </table></div>
      </div>
    </div>
    ${hitsBlock}
  `;

  renderLucideIcons();
  materialDashboardDrawCharts(monthsList, monthData, data.byBrand);
  if (opts.preserveFocus) {
    const input = document.getElementById('mpDashSearch');
    if (input) {
      input.focus();
      const len = input.value.length;
      try { input.setSelectionRange(len, len); } catch (_) { /* ignore */ }
    }
  }
}

function materialDashboardDrawCharts(monthsList, monthData, byBrand) {
  if (charts.mpMonth) { try { charts.mpMonth.destroy(); } catch (_) {} charts.mpMonth = null; }
  if (charts.mpBrand) { try { charts.mpBrand.destroy(); } catch (_) {} charts.mpBrand = null; }
  const monthCtx = document.getElementById('chartMpMonth');
  const brandCtx = document.getElementById('chartMpBrand');
  const sec = (typeof getComputedStyle === 'function')
    ? (getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#64748b')
    : '#64748b';
  if (monthCtx && typeof Chart !== 'undefined') {
    charts.mpMonth = new Chart(monthCtx, {
      type: 'bar',
      data: {
        labels: monthsList.map((m) => m.slice(5) + '月'),
        datasets: [{ label: '金额', data: monthData, backgroundColor: '#3b82f6', borderRadius: 6 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => fmtMoney(c.raw || 0) } },
        },
        scales: {
          x: { ticks: { color: sec }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: sec, callback: (v) => fmtMoney(v || 0) } },
        },
      },
    });
  }
  if (brandCtx && typeof Chart !== 'undefined') {
    const colors = { PHD: '#a855f7', 'X.O': '#f59e0b', CLUB: '#3b82f6', RC: '#10b981', '其他': '#94a3b8' };
    const nonZero = byBrand.filter((b) => b.amount > 0);
    const labels = nonZero.length ? nonZero.map((b) => b.bucket) : ['无数据'];
    const values = nonZero.length ? nonZero.map((b) => b.amount) : [1];
    const bg = nonZero.length ? nonZero.map((b) => colors[b.bucket] || '#94a3b8') : ['#e5e7eb'];
    charts.mpBrand = new Chart(brandCtx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: bg, borderWidth: 0, hoverOffset: 6 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: sec, font: { size: 12 } } },
          tooltip: { callbacks: { label: (c) => `${c.label} · ${fmtMoney(c.raw || 0)}` } },
        },
        cutout: '55%',
      },
    });
  }
}

function sortMaterialPurchaseRows(rows) {
  return (rows || []).slice().sort((a, b) => {
    const at = new Date(a.purchase_date || 0).getTime() || 0;
    const bt = new Date(b.purchase_date || 0).getTime() || 0;
    if (bt !== at) return bt - at;
    return Number(b.id || 0) - Number(a.id || 0);
  });
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
  const isReimbursement = r.source_type === 'reimbursement';
  // 行点击 → 详情弹窗：reimbursement 派生走付款申请详情，直接登记走物料采购详情
  const openCall = isReimbursement
    ? `reimbursementOpenDetailModal(${r.id})`
    : `materialPurchaseOpenDetailModal(${r.id})`;
  return `<tr class="mp-list-row" style="cursor:pointer" onclick="${openCall}">
    <td>${isReimbursement ? `报销#${escapeHtml(r.id)}` : escapeHtml(r.id)}</td>
    <td>${escapeHtml(fmtDate(r.purchase_date))}</td>
    <td><span class="badge badge-${brandColor(r.brand_code || r.brand_name)}">${escapeHtml(r.brand_name || r.brand_code || '—')}</span></td>
    <td class="amount" style="text-align:right">${fmtMoney(r.total_amount)}</td>
    <td>${listActivityProjectHtml(r)}</td>
    <td>${listAllocationNoteHtml(r.allocation_note)}</td>
    <td>${merged ? '<span class="badge badge-success">已计入</span>' : '<span class="badge badge-gray">未计入</span>'}</td>
    <td>${paymentStatusHtml(r.payment_status, r.payment_order_id)}</td>
    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--text-secondary)" title="${escapeHtml(r.remarks || '')}">${escapeHtml(rem)}</td>
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

    const [rows, rowsAllYear, brands, reimbursementRows] = await Promise.all([
      api('GET', `/material-purchases${qStr ? `?${qStr}` : ''}`),
      api('GET', `/material-purchases${yfOnlyStr ? `?${yfOnlyStr}` : ''}`),
      api('GET', '/brand?active=true'),
      api('GET', `/reimbursements${yfOnlyStr ? `?${yfOnlyStr}` : ''}`),
    ]);

    const brandOpts = (brands || [])
      .map(
        (b) =>
          `<option value="${b.id}" ${String(materialPageState.filterBrandId) === String(b.id) ? 'selected' : ''}>${escapeHtml(b.brand_name || b.brand_code)}</option>`
      )
      .join('');

    const reimbursementMaterialRowsAllYear = materialPurchaseRowsFromReimbursements(reimbursementRows, brands);
    const reimbursementMaterialRowsForList = materialPurchaseRowsFromReimbursements(
      reimbursementRows,
      brands,
      materialPageState.filterBrandId
    );
    const listRows = sortMaterialPurchaseRows([...(rows || []), ...reimbursementMaterialRowsForList]);

    // 财年范围与方案B明细行（仪表盘 + 5桶卡共用）
    const fy = currentFiscalYearRange();
    const reimbDetailRowsFY = materialPurchaseDetailRowsFromReimbursements(reimbursementRows, { fiscalYear: fy });
    // 5桶卡：直接采购登记按整条 brand 归桶（限当前年框） + 报销明细行按 row brand 归桶（限当前财年）
    const bucketItems = [
      ...((rowsAllYear || []).map((r) => ({
        brandBucket: detectBrandBucket(r.brand_code, r.brand_name, r.brand),
        total_amount: r.total_amount,
      }))),
      ...reimbDetailRowsFY.map((d) => ({ brandBucket: d.brandBucket, subtotal: d.subtotal })),
    ];
    const { totals: bt, counts: bc } = materialPurchaseAggFiveBuckets(bucketItems);
    const grandTotal = roundMoney2(Object.values(bt).reduce((s, v) => s + roundMoney2(v), 0));

    const bucketDefs = [
      { key: 'PHD', title: 'PHD', sub: '路易十三 / PHD*', icon: 'flask-conical', card: 'stat-card accent' },
      { key: 'X.O', title: 'X.O', sub: '人头马 X.O / XO*', icon: 'wine', card: 'stat-card warning' },
      { key: 'CLUB', title: 'CLUB', sub: '人头马 CLUB*', icon: 'sparkles', card: 'stat-card blue' },
      { key: 'RC', title: 'RC', sub: '特级干邑 RC / Remy', icon: 'orbit', card: 'stat-card success' },
      { key: '其他', title: '其他', sub: '内部 / 未归类', icon: 'shapes', card: 'stat-card' },
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

    const listBody = listRows.length
      ? listRows.map((r) => materialPurchaseRowHtml(r)).join('')
      : '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px">暂无记录</td></tr>';

    container.innerHTML = `
      <div class="mp-page-banner" style="margin-bottom:12px;padding:10px 14px;border-radius:10px;background:var(--bg-input);color:var(--text-secondary);font-size:13px;display:flex;align-items:center;gap:8px">
        <i data-lucide="info" style="width:14px;height:14px"></i>
        额外成本：不计入具体场次的成本统计（物料采购 / 物流 / 道具维修 / 统筹支出等，按"成本归属 ≠ 活动成本"的报销与直接登记汇总）
      </div>
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card accent">
          <div class="stat-label">额外成本合计（当前年框）</div>
          <div class="stat-value sm">${fmtMoney(grandTotal)}</div>
          <div class="stat-sub">直接登记 + 不计入活动的报销明细（明细级品牌归桶）</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:16px">
        ${bucketCardsHtml}
      </div>
      ${materialDashboardSectionHtml(reimbDetailRowsFY, fy)}
      <div class="card">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div class="card-title">成本记录</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select class="filter-select" id="mpListBrandFilter" onchange="materialSetBrandFilter(this.value)">
              <option value="">全部品牌</option>${brandOpts}
            </select>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>ID</th><th>日期</th><th>品牌</th><th style="text-align:right">合计</th><th>关联项目</th><th>计入说明</th><th>计入状态</th><th>付款状态</th><th>备注</th></tr></thead>
              <tbody>${listBody}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    renderLucideIcons();
    applyRoleUiGuards();
    materialDashboardMount(reimbDetailRowsFY, fy);
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
      <div class="form-group">
        <label class="form-label">收款方</label>
        <input type="text" class="form-control" id="mpPayeeName" placeholder="用于付款合并" value="${escapeHtml((record && record.payee_name) || '')}">
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
    payee_name: document.getElementById('mpPayeeName')?.value?.trim() || null,
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
  if (a && a.brand) {
    const mapped = reimbDetailBrandFromLegacyBrand(a.brand);
    if (mapped) reimbDetailDefaultBrand = mapped;
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
      if (a && a.brand) {
        const mapped = reimbDetailBrandFromLegacyBrand(a.brand);
        if (mapped) reimbDetailDefaultBrand = mapped;
      }
    }
  }
}

function reimbVisibleRemarks(raw) {
  const s = String(raw || '');
  const idx = s.indexOf(REIMB_DETAIL_META_PREFIX);
  return idx >= 0 ? s.slice(0, idx).trim() : s.trim();
}

function reimbReadDetailMeta(raw) {
  const s = String(raw || '');
  const idx = s.indexOf(REIMB_DETAIL_META_PREFIX);
  if (idx < 0) return {};
  try {
    return JSON.parse(s.slice(idx + REIMB_DETAIL_META_PREFIX.length).trim()) || {};
  } catch {
    return {};
  }
}

function reimbParseJsonObject(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function reimbRemarksWithMeta(remarks, meta) {
  const visible = String(remarks || '').trim();
  return `${visible}${REIMB_DETAIL_META_PREFIX}${JSON.stringify(meta)}`;
}

function reimbCategoryOptionsHtml(block, selected) {
  const opts = REIMB_DETAIL_CATEGORY_OPTIONS[block] || [];
  return opts
    .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
}

function reimbBlockOptionsHtml(selected) {
  return REIMB_DETAIL_BLOCKS
    .map((x) => `<option value="${x.value}" ${x.value === selected ? 'selected' : ''}>${x.label}</option>`)
    .join('');
}

let reimbDetailDefaultBrand = '内部';

function reimbBrandOptionsHtml(selected) {
  return REIMB_DETAIL_BRAND_OPTIONS
    .map((v) => `<option value="${escapeHtml(v)}" ${v === selected ? 'selected' : ''}>${escapeHtml(v)}</option>`)
    .join('');
}

function reimbNewDetailRowData(row, index) {
  const block = row?.block || 'personnel';
  const firstCategory = (REIMB_DETAIL_CATEGORY_OPTIONS[block] || [])[0]?.[0] || '';
  const rawBrand = row?.brand;
  const brand =
    typeof rawBrand === 'string' && rawBrand.trim()
      ? rawBrand.trim()
      : reimbDetailDefaultBrand || REIMB_DETAIL_BRAND_OPTIONS[3] || '内部';
  return {
    brand,
    block,
    category: row?.category || firstCategory,
    description: row?.description || '',
    quantity: row?.quantity || '',
    unit_price: row?.unit_price || '',
    invoice: row?.invoice || '有',
    invoice_date: row?.invoice_date || '',
    invoice_no: row?.invoice_no || '',
    applicant: row?.applicant || getCurrentUserName(),
    remarks: row?.remarks || '',
    _index: index,
  };
}

function reimbDetailRowHtml(row, index) {
  const r = reimbNewDetailRowData(row, index);
  return `
    <tr class="reimb-detail-row">
      <td class="reimb-row-no">${index + 1}</td>
      <td class="reimb-col-brand"><select class="form-control reimb-line-brand" title="按品牌分摊年框">${reimbBrandOptionsHtml(r.brand)}</select></td>
      <td><select class="form-control reimb-line-block" onchange="reimbDetailBlockChanged(this)">${reimbBlockOptionsHtml(r.block)}</select></td>
      <td><select class="form-control reimb-line-category">${reimbCategoryOptionsHtml(r.block, r.category)}</select></td>
      <td><input type="text" class="form-control reimb-line-desc" value="${escapeHtml(r.description)}"></td>
      <td><input type="number" class="form-control reimb-line-qty" min="0" step="0.01" value="${escapeHtml(r.quantity)}" oninput="reimbUpdateDetailTotals()"></td>
      <td><input type="number" class="form-control reimb-line-price" min="0" step="0.01" value="${escapeHtml(r.unit_price)}" oninput="reimbUpdateDetailTotals()"></td>
      <td class="amount reimb-line-subtotal">¥0.00</td>
      <td>
        <select class="form-control reimb-line-invoice">
          <option value="有" ${r.invoice !== '无' ? 'selected' : ''}>有</option>
          <option value="无" ${r.invoice === '无' ? 'selected' : ''}>无</option>
        </select>
      </td>
      <td><input type="date" class="form-control reimb-line-invoice-date" value="${escapeHtml(r.invoice_date)}"></td>
      <td><input type="text" class="form-control reimb-line-invoice-no" value="${escapeHtml(r.invoice_no)}"></td>
      <td><input type="text" class="form-control reimb-line-applicant" value="${escapeHtml(r.applicant)}"></td>
      <td><input type="text" class="form-control reimb-line-remarks" value="${escapeHtml(r.remarks)}"></td>
      <td><button type="button" class="btn btn-secondary btn-sm" onclick="reimbRemoveDetailRow(this)">删</button></td>
    </tr>`;
}

function reimbAppendDetailRow(row = null) {
  const body = document.getElementById('reimbDetailRows');
  if (!body) return;
  body.insertAdjacentHTML('beforeend', reimbDetailRowHtml(row, body.querySelectorAll('.reimb-detail-row').length));
  reimbRenumberDetailRows();
  reimbUpdateDetailTotals();
}

function reimbRemoveDetailRow(btn) {
  const row = btn?.closest?.('.reimb-detail-row');
  if (row) row.remove();
  const body = document.getElementById('reimbDetailRows');
  if (body && !body.querySelector('.reimb-detail-row')) {
    for (let i = 0; i < 3; i += 1) reimbAppendDetailRow(null);
  }
  reimbRenumberDetailRows();
  reimbUpdateDetailTotals();
}

function reimbRenumberDetailRows() {
  document.querySelectorAll('#reimbDetailRows .reimb-detail-row').forEach((row, idx) => {
    const no = row.querySelector('.reimb-row-no');
    if (no) no.textContent = String(idx + 1);
  });
}

function reimbDetailBlockChanged(sel) {
  const row = sel?.closest?.('.reimb-detail-row');
  const cat = row?.querySelector?.('.reimb-line-category');
  if (!cat) return;
  cat.innerHTML = reimbCategoryOptionsHtml(sel.value, '');
}

function reimbCollectDetailRows() {
  const rows = [];
  document.querySelectorAll('#reimbDetailRows .reimb-detail-row').forEach((row) => {
    const quantity = roundMoney2(row.querySelector('.reimb-line-qty')?.value);
    const unit_price = roundMoney2(row.querySelector('.reimb-line-price')?.value);
    const subtotal = roundMoney2(quantity * unit_price);
    const item = {
      brand: row.querySelector('.reimb-line-brand')?.value?.trim() || '',
      block: row.querySelector('.reimb-line-block')?.value || '',
      category: row.querySelector('.reimb-line-category')?.value || '',
      description: row.querySelector('.reimb-line-desc')?.value?.trim() || '',
      quantity,
      unit_price,
      subtotal,
      invoice: row.querySelector('.reimb-line-invoice')?.value || '有',
      invoice_date: row.querySelector('.reimb-line-invoice-date')?.value || '',
      invoice_no: row.querySelector('.reimb-line-invoice-no')?.value?.trim() || '',
      applicant: row.querySelector('.reimb-line-applicant')?.value?.trim() || '',
      remarks: row.querySelector('.reimb-line-remarks')?.value?.trim() || '',
    };
    if (item.description || item.quantity || item.unit_price || item.subtotal || item.invoice_no || item.remarks) rows.push(item);
  });
  return rows;
}

function reimbResolveRecordBrand(rows) {
  for (const row of rows || []) {
    const b = String(row?.brand || '').trim();
    if (b) return b;
  }
  return '';
}

function reimbRowsToCostDetails(rows, advanceAmount) {
  const details = {};
  rows.forEach((row) => {
    const key = row.category;
    if (!key) return;
    details[key] = roundMoney2((details[key] || 0) + roundMoney2(row.subtotal));
  });
  if (advanceAmount > 0) details.advance_offset = -roundMoney2(advanceAmount);
  return details;
}

function reimbUpdateDetailTotals() {
  let gross = 0;
  document.querySelectorAll('#reimbDetailRows .reimb-detail-row').forEach((row) => {
    const subtotal = roundMoney2(roundMoney2(row.querySelector('.reimb-line-qty')?.value) * roundMoney2(row.querySelector('.reimb-line-price')?.value));
    gross += subtotal;
    const el = row.querySelector('.reimb-line-subtotal');
    if (el) el.textContent = fmtMoney(subtotal);
  });
  const useAdvance = !!document.getElementById('reimbUseAdvance')?.checked;
  const advance = useAdvance ? roundMoney2(document.getElementById('reimbAdvanceAmount')?.value) : 0;
  const net = roundMoney2(gross - advance);
  const grossEl = document.getElementById('reimbGrossTotal');
  const netEl = document.getElementById('reimbCostTotal');
  if (grossEl) grossEl.textContent = fmtMoney(gross);
  if (netEl) {
    netEl.textContent = fmtMoney(net);
    netEl.style.color = net > 0 ? 'var(--accent)' : net < 0 ? 'var(--danger)' : 'var(--text-secondary)';
    netEl.style.fontWeight = '700';
  }
}

function reimbOnCostAttributionChange() {
  const mergedNote = document.getElementById('reimbMergedNote');
  const merged = mergedNote && mergedNote.dataset.merged === '1';
  if (merged) return;
  const v = document.querySelector('input[name="reimbCostAttribution"]:checked')?.value || 'activity';
  const isNon = v === 'non_activity';
  const proj = document.querySelector('.reimb-form-body .reimb-project-field');
  const syncRow = document.querySelector('.reimb-form-body .reimb-sync-row');
  const costMod = document.getElementById('reimbCostModule');
  if (proj) proj.style.display = isNon ? 'none' : '';
  if (syncRow) syncRow.style.display = isNon ? 'none' : '';
  if (costMod) {
    if (isNon) {
      costMod.value = 'general';
      costMod.setAttribute('disabled', 'disabled');
    } else {
      costMod.removeAttribute('disabled');
    }
  }
  if (isNon) {
    const hid = document.getElementById('reimbActivityId');
    const pci = document.getElementById('reimbProjectCode');
    if (hid) hid.value = '';
    if (pci) pci.value = '';
    const syncEl = document.getElementById('reimbSyncToActivity');
    if (syncEl && !syncEl.disabled) syncEl.checked = false;
    const picked = document.getElementById('reimbActivityPicked');
    if (picked) {
      picked.style.display = 'none';
      picked.textContent = '';
    }
  }
  reimbOnSyncToActivityChange();
  reimbUpdateDetailTotals();
}

/**
 * 「同步项目成本」勾选状态变更：
 * 1. 项目编号 label 动态加/去 * 红星，提示必填
 * 2. 勾选时隐藏费用明细中的「品牌」列（同步项目成本场景下品牌由项目自动决定，不允许逐行差异化）
 * 3. 未勾选时品牌列恢复可见
 */
function reimbOnSyncToActivityChange() {
  const syncEl = document.getElementById('reimbSyncToActivity');
  const checked = !!syncEl?.checked;
  const lbl = document.getElementById('reimbProjectCodeLabel');
  if (lbl) {
    const existed = lbl.querySelector('.required');
    if (checked && !existed) {
      lbl.insertAdjacentHTML('beforeend', ' <span class="required">*</span>');
    } else if (!checked && existed) {
      existed.remove();
    }
  }
  const table = document.getElementById('reimbDetailTable');
  if (table) table.classList.toggle('no-brand-col', checked);
  const projInput = document.getElementById('reimbProjectCode');
  if (projInput) {
    if (checked) {
      projInput.classList.add('reimb-project-required');
      projInput.setAttribute('placeholder', '已勾选「同步项目成本」，必须从下拉选中项目编号');
    } else {
      projInput.classList.remove('reimb-project-required');
      projInput.setAttribute('placeholder', '输入关键字并从下拉选择项目编号');
    }
  }
}

function poQuickFilter(sourceType) {
  const el = document.getElementById('poFilter_sourceType');
  if (el) el.value = sourceType || '';
  paymentOrderLoadCandidates();
}

function reimbToggleAdvanceAmount() {
  const checked = !!document.getElementById('reimbUseAdvance')?.checked;
  const wrap = document.getElementById('reimbAdvanceAmountWrap');
  if (wrap) wrap.style.display = checked ? 'block' : 'none';
  reimbUpdateDetailTotals();
}

function reimbClaimStatusChanged() {
  const status = document.getElementById('reimbClaimStatus')?.value || 'draft';
  const wrap = document.getElementById('reimbPaymentDateWrap');
  const paymentDate = document.getElementById('reimbPaymentDate');
  if (wrap) wrap.style.display = status === 'paid' ? 'block' : 'none';
  if (status === 'paid' && paymentDate && !paymentDate.value) paymentDate.value = todayDateInputValue();
}

function paymentOrderKey(row) {
  return `${row.source_type}:${row.source_id}`;
}

function paymentOrderSelectedRows() {
  return (paymentOrderState.candidates || []).filter((row) => paymentOrderState.selectedKeys.has(paymentOrderKey(row)));
}

function paymentOrderDescriptionText(row) {
  const text = String(row?.description || '').trim();
  const idx = text.indexOf(REIMB_DETAIL_META_MARKER);
  return idx >= 0 ? text.slice(0, idx).trim() || '成本登记' : text;
}

function paymentOrderValidateSelection(rows) {
  if (!rows.length) {
    showToast('请先选择待付款记录', 'warning');
    return false;
  }
  const payees = [...new Set(rows.map((r) => String(r.payee_name || '').trim()).filter(Boolean))];
  if (payees.length !== 1 || rows.some((r) => !String(r.payee_name || '').trim())) {
    showToast('只能合并同一收款方的记录；空收款方请先回来源记录补填', 'warning');
    return false;
  }
  return true;
}

async function showCorporatePaymentTodo() {
  if (!currentYearFrameId) {
    showToast('请先选择年度', 'warning');
    return;
  }
  paymentOrderState = { candidates: [], selectedKeys: new Set(), previewRows: [] };
  const body = document.getElementById('modalPaymentOrderBody');
  if (body) body.innerHTML = '<div class="empty-state"><div class="skeleton skeleton-title"></div></div>';
  openModal('modalPaymentOrder');
  await paymentOrderLoadCandidates();
}

async function paymentOrderLoadCandidates() {
  const qs = new URLSearchParams();
  qs.set('yearFrameId', String(currentYearFrameId || ''));
  ['payee', 'brand', 'sourceType', 'projectCode', 'dateFrom', 'dateTo'].forEach((id) => {
    const v = document.getElementById(`poFilter_${id}`)?.value?.trim();
    if (v) qs.set(id, v);
  });
  try {
    paymentOrderState.candidates = await api('GET', `/payment-orders/candidates?${qs.toString()}`);
    const visibleKeys = new Set(paymentOrderState.candidates.map(paymentOrderKey));
    paymentOrderState.selectedKeys = new Set([...paymentOrderState.selectedKeys].filter((k) => visibleKeys.has(k)));
    paymentOrderRenderModal();
  } catch (e) {
    const body = document.getElementById('modalPaymentOrderBody');
    if (body) body.innerHTML = `<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message || '')}</div></div>`;
  }
}

function paymentOrderToggleRow(key, checked) {
  if (checked) paymentOrderState.selectedKeys.add(key);
  else paymentOrderState.selectedKeys.delete(key);
  paymentOrderState.previewRows = [];
  paymentOrderRenderModal();
}

function paymentOrderRenderModal() {
  const body = document.getElementById('modalPaymentOrderBody');
  if (!body) return;
  const filterVals = {};
  ['payee', 'brand', 'sourceType', 'projectCode', 'dateFrom', 'dateTo'].forEach((id) => {
    filterVals[id] = document.getElementById(`poFilter_${id}`)?.value || '';
  });
  const orderDateVal = document.getElementById('poOrderDate')?.value || todayDateInputValue();
  const paymentDateVal = document.getElementById('poPaymentDate')?.value || todayDateInputValue();
  const remarksVal = document.getElementById('poRemarks')?.value || '';
  const rows = paymentOrderState.candidates || [];
  const selected = paymentOrderSelectedRows();
  const total = roundMoney2(selected.reduce((s, r) => s + roundMoney2(r.amount), 0));
  const previewRows = paymentOrderState.previewRows || [];
  const sourceOpts = [
    ['', '全部板块'],
    ['warehouse', '仓储'],
    ['logistics', '物流'],
    ['material_purchase', '物料采购'],
    ['prop_repair', '道具维修'],
    ['reimbursement', '成本登记'],
  ].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  body.innerHTML = `
    <div class="payment-order-wizard">
      <span class="payment-order-wizard-label">新建对公 · 快捷筛选未付：</span>
      <button type="button" class="btn btn-secondary btn-xs" onclick="poQuickFilter('warehouse')">仓储</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="poQuickFilter('logistics')">物流</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="poQuickFilter('material_purchase')">物料采购</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="poQuickFilter('prop_repair')">道具维修</button>
      <button type="button" class="btn btn-secondary btn-xs" onclick="poQuickFilter('')">全部</button>
    </div>
    <div class="payment-order-filter-grid">
      <input class="form-control" id="poFilter_payee" placeholder="收款方精确筛选" value="${escapeHtml(filterVals.payee || '')}">
      <input class="form-control" id="poFilter_projectCode" placeholder="项目编号" value="${escapeHtml(filterVals.projectCode || '')}">
      <select class="form-control" id="poFilter_sourceType">${sourceOpts}</select>
      <select class="form-control" id="poFilter_brand">
        <option value="">全部品牌</option>${FIXED_BRAND_CODES.map((b) => `<option value="${b}">${b}</option>`).join('')}
      </select>
      <input type="date" class="form-control" id="poFilter_dateFrom" value="${escapeHtml(filterVals.dateFrom || '')}">
      <input type="date" class="form-control" id="poFilter_dateTo" value="${escapeHtml(filterVals.dateTo || '')}">
      <button type="button" class="btn btn-secondary btn-sm payment-order-filter-btn" onclick="paymentOrderLoadCandidates()">筛选</button>
    </div>
    <div class="payment-order-meta-grid">
      <label class="po-inline-field">
        <span class="po-inline-label">申请日期</span>
        <input type="date" class="form-control" id="poOrderDate" value="${escapeHtml(orderDateVal)}">
      </label>
      <label class="po-inline-field">
        <span class="po-inline-label">付款日期</span>
        <input type="date" class="form-control" id="poPaymentDate" value="${escapeHtml(paymentDateVal)}">
      </label>
      <label class="po-inline-field po-inline-field--grow">
        <span class="po-inline-label">备注</span>
        <input type="text" class="form-control" id="poRemarks" placeholder="选填" value="${escapeHtml(remarksVal)}">
      </label>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 10px">
      <div style="font-size:13px;color:var(--text-secondary)">未支付记录 ${rows.length} 条 · 已选 ${selected.length} 条</div>
      <div class="amount" style="font-weight:800">${fmtMoney(total)}</div>
    </div>
    <div class="table-wrapper payment-order-table-wrap">
      <table class="data-table payment-order-table">
        <thead><tr><th></th><th>日期</th><th>板块</th><th>收款方</th><th>品牌</th><th>项目编号</th><th>说明</th><th style="text-align:right">金额</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((r) => {
            const key = paymentOrderKey(r);
            const desc = paymentOrderDescriptionText(r);
            const brandText = String(r.brand || '—');
            const pcText = String(r.project_code || '—');
            return `<tr>
              <td><input type="checkbox" class="payment-order-check" ${paymentOrderState.selectedKeys.has(key) ? 'checked' : ''} onchange="paymentOrderToggleRow('${escapeHtml(key)}', this.checked)" aria-label="选择该条待付款记录"></td>
              <td>${escapeHtml(fmtDateShort(r.source_date))}</td>
              <td>${escapeHtml(paymentSourceLabel(r.source_type))}</td>
              <td title="${escapeHtml(r.payee_name || '')}">${escapeHtml(r.payee_name || '（未填）')}</td>
              <td title="${escapeHtml(brandText)}">${escapeHtml(brandText)}</td>
              <td title="${escapeHtml(pcText)}">${escapeHtml(pcText)}</td>
              <td class="payment-order-desc-cell" title="${escapeHtml(desc || '')}">${escapeHtml(desc || '—')}</td>
              <td class="amount" style="text-align:right">${fmtMoney(r.amount)}</td>
            </tr>`;
          }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:22px">暂无未支付记录</td></tr>'}
        </tbody>
      </table>
    </div>
    <div id="paymentOrderPreviewBlock" style="margin-top:14px">${previewRows.length ? paymentOrderPreviewBlockHtml(previewRows) : ''}</div>
  `;
  ['sourceType', 'brand'].forEach((id) => {
    const el = document.getElementById(`poFilter_${id}`);
    if (el) el.value = filterVals[id] || '';
  });
  paymentOrderUpdateFooterButtons();
}

function paymentOrderUpdateFooterButtons() {
  const selectedCount = (paymentOrderState.selectedKeys || new Set()).size;
  const previewBtn = document.getElementById('poPreviewBtn');
  const confirmBtn = document.getElementById('poConfirmBtn');
  if (previewBtn) {
    previewBtn.disabled = selectedCount === 0;
    previewBtn.title = selectedCount === 0 ? '请先勾选至少 1 条待付款记录' : '生成付款申请单预览';
  }
  if (confirmBtn) {
    const previewed = (paymentOrderState.previewRows || []).length > 0;
    confirmBtn.disabled = selectedCount === 0 || !previewed;
    confirmBtn.title = selectedCount === 0
      ? '请先勾选至少 1 条记录'
      : !previewed
        ? '请先点击「预览」生成付款申请单'
        : '保存付款单并标记所选记录为已支付';
  }
}

function paymentOrderPreviewBlockHtml(rows) {
  const payee = rows[0]?.payee_name || '';
  const total = roundMoney2(rows.reduce((s, r) => s + roundMoney2(r.amount), 0));
  return `<div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg-elevated)">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px">
      <strong>付款申请单预览 · ${escapeHtml(payee)}</strong>
      <span class="amount" style="font-weight:800">${fmtMoney(total)}</span>
    </div>
    <table class="data-table"><thead><tr><th>日期</th><th>板块</th><th>项目编号</th><th>品牌</th><th>城市</th><th>说明</th><th style="text-align:right">金额</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${escapeHtml(fmtDateShort(r.source_date))}</td><td>${escapeHtml(paymentSourceLabel(r.source_type))}</td><td>${escapeHtml(r.project_code || '—')}</td><td>${escapeHtml(r.brand || '—')}</td><td>${escapeHtml(r.city || '—')}</td><td>${escapeHtml(paymentOrderDescriptionText(r) || '—')}</td><td class="amount" style="text-align:right">${fmtMoney(r.amount)}</td></tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function paymentOrderPreviewSelected() {
  const rows = paymentOrderSelectedRows();
  if (!paymentOrderValidateSelection(rows)) return;
  paymentOrderState.previewRows = rows;
  const block = document.getElementById('paymentOrderPreviewBlock');
  if (block) {
    block.innerHTML = paymentOrderPreviewBlockHtml(rows);
    requestAnimationFrame(() => {
      try {
        block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (_) {
        block.scrollIntoView();
      }
    });
  }
  paymentOrderUpdateFooterButtons();
  showToast(`已生成 ${rows.length} 条预览，可继续保存`, 'success');
}

async function paymentOrderConfirmSave() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可保存', 'warning');
    return;
  }
  const rows = paymentOrderSelectedRows();
  if (!paymentOrderValidateSelection(rows)) return;
  if (!paymentOrderState.previewRows.length) {
    showToast('请先预览付款申请单', 'warning');
    return;
  }
  const body = {
    year_frame_id: currentYearFrameId,
    payee_name: rows[0].payee_name,
    order_date: document.getElementById('poOrderDate')?.value || todayDateInputValue(),
    payment_date: document.getElementById('poPaymentDate')?.value || todayDateInputValue(),
    remarks: document.getElementById('poRemarks')?.value?.trim() || null,
    items: rows.map((r) => ({ source_type: r.source_type, source_id: r.source_id })),
  };
  try {
    const saved = await api('POST', '/payment-orders', body);
    showToast(`付款单已保存：${saved.order_no || saved.id}`, 'success');
    closeModal();
    if (currentPage === 'reimbursement') await renderReimbursements();
    if (currentPage === 'logistics') await loadLogistics();
    if (currentPage === 'warehouse') await loadWarehouse();
    if (currentPage === 'material') await renderMaterialPurchases();
    if (currentPage === 'prop-repair') await renderPropRepairs();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

/**
 * 把付款单组装成「盛融报销单」格式的可打印 HTML。
 * - 来源 reimbursement：取原报销单 detail_rows
 * - 其他来源（活动/物料采购/物流/道具维修）：每条 item 作为一行明细兜底
 * - 替换原 sr-meta 行：付款单号 / 收款方 / 申请日期 / 付款日期
 */
async function buildPaymentOrderSheetHtml(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const reimbIds = [
    ...new Set(
      items
        .filter((i) => i && i.source_type === 'reimbursement')
        .map((i) => Number(i.source_id))
        .filter(Number.isFinite),
    ),
  ];
  const detailRows = [];
  let advanceTotal = 0;
  let hasInvoice = false;
  const invoices = [];
  let mergedIntoActivity = false;
  let firstPaymentType = null;
  let firstCostModule = null;

  for (const rid of reimbIds) {
    try {
      const rec = await api('GET', `/reimbursements/${rid}`);
      const p = reimbursementPayloadFromRecord(rec);
      if (!firstPaymentType) firstPaymentType = p.payment_type;
      if (!firstCostModule) firstCostModule = p.cost_module;
      if (Array.isArray(p.detail_rows) && p.detail_rows.length) {
        p.detail_rows.forEach((row) => {
          detailRows.push({
            ...row,
            brand: row.brand || p.brand || '',
            applicant: row.applicant || p.payee_name || order.payee_name || '',
          });
        });
      } else {
        detailRows.push({
          block: 'other',
          category: 'other',
          description: `成本登记 #${rid}`,
          subtotal: Number(p.amount) || 0,
          brand: p.brand || '',
          remarks: '',
          applicant: p.payee_name || order.payee_name || '',
          invoice: p.has_invoice ? '有' : '无',
        });
      }
      advanceTotal += Number(p.advance_amount) || 0;
      if (p.has_invoice) hasInvoice = true;
      if (Array.isArray(p.invoices)) invoices.push(...p.invoices);
      if (p.merged_into_activity) mergedIntoActivity = true;
    } catch (_) {
      /* 忽略单条失败，继续合成其它行 */
    }
  }

  items
    .filter((i) => i && i.source_type !== 'reimbursement')
    .forEach((i) => {
      detailRows.push({
        block: 'other',
        category: 'other',
        description:
          paymentOrderDescriptionText(i)
          || `${paymentSourceLabel(i.source_type)} #${i.source_id || ''}`.trim(),
        subtotal: Number(i.amount) || 0,
        brand: i.brand || '',
        remarks: i.city || '',
        applicant: order.payee_name || '',
        invoice: '无',
      });
    });

  const composedPayload = {
    id: order.id,
    date: order.order_date,
    remarks: order.remarks || '',
    activity_id: null,
    brand: '',
    payee_name: order.payee_name || '',
    project_code: '',
    payment_type: firstPaymentType || 'personal_reimbursement',
    cost_module: firstCostModule || 'activity',
    claim_status: String(order.status || '').toLowerCase() === 'paid' ? 'paid' : 'submitted',
    has_invoice: hasInvoice,
    invoices,
    cost_details: [],
    detail_rows: detailRows,
    advance_amount: roundMoney2(advanceTotal),
    amount: Number(order.total_amount) || 0,
    merged_into_activity: mergedIntoActivity,
    payment_status: String(order.status || '').toLowerCase() === 'paid' ? 'paid' : 'unpaid',
  };

  const sheet = buildReimbursementPrintableHtml(composedPayload);
  const titleReplaced = sheet.replace(
    /<h1 class="sr-title">[^<]*<\/h1>/,
    `<h1 class="sr-title">付款申请单</h1>`,
  );
  const docTitleReplaced = titleReplaced.replace(
    /<title>[^<]*<\/title>/,
    `<title>付款申请单 ${escapeHtml(order.order_no || `#${order.id}`)}</title>`,
  );
  const metaReplaced = docTitleReplaced.replace(
    /<div class="sr-meta">[\s\S]*?<\/div>/,
    `<div class="sr-meta">
      <span>付款单号：<strong>${escapeHtml(order.order_no || `#${order.id}`)}</strong></span>
      <span>收款方：<strong>${escapeHtml(order.payee_name || '—')}</strong></span>
      <span>申请日期：${escapeHtml(fmtDateShort(order.order_date) || '—')}</span>
      <span>付款日期：${escapeHtml(fmtDateShort(order.payment_date) || '—')}</span>
    </div>`,
  );
  return metaReplaced;
}

async function paymentOrderViewDetail(id) {
  try {
    const order = await api('GET', `/payment-orders/${id}`);
    const html = await buildPaymentOrderSheetHtml(order);
    openReimbursementPreviewModal({
      title: `付款单 ${order.order_no || `#${order.id}`}`,
      type: 'pdf',
      bodyHtml: `<iframe id="reimbPreviewPdfFrame" style="width:100%;height:70vh;border:1px solid #e5e7eb;border-radius:8px;background:#fff" srcdoc="${escapeHtml(html)}"></iframe>`,
    });
  } catch (e) {
    showToast(e.message || '加载付款单失败', 'error');
  }
}

/**
 * 删除付款单：后端会先把明细对应的成本记录回退到「未支付」状态，再删除主单 + 明细。
 */
async function paymentOrderDelete(id, label) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除付款单', 'warning');
    return;
  }
  const name = label || `#${id}`;
  if (!confirm(`确认删除付款单 ${name}？\n所属成本记录将回退为未支付状态，可重新生成付款单。`)) return;
  try {
    const res = await api('DELETE', `/payment-orders/${id}`);
    showToast(res?.message || '已删除付款单', 'success');
    if (currentPage === 'reimbursement') await renderReimbursements();
    void updateBadges();
  } catch (e) {
    showToast(e.message || '删除付款单失败', 'error');
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
  const payee_name = document.getElementById('reimbPayeeName')?.value?.trim() || '';
  const payment_type = document.getElementById('reimbPaymentType')?.value || 'personal_reimbursement';
  const cost_module = document.getElementById('reimbCostModule')?.value || 'activity';
  const claim_status = document.getElementById('reimbClaimStatus')?.value || 'draft';
  const rows = reimbCollectDetailRows();
  const brand = reimbResolveRecordBrand(rows);
  const use_advance = !!document.getElementById('reimbUseAdvance')?.checked;
  const advance_amount = use_advance ? roundMoney2(document.getElementById('reimbAdvanceAmount')?.value) : 0;
  const invoices = rows
    .filter((row) => row.invoice_no && row.invoice_date)
    .map((row) => ({ invoice_content: row.description, invoice_no: row.invoice_no, invoice_date: row.invoice_date, invoice_kind: '普票' }));
  const has_invoice = invoices.length > 0;
  const cost_details = reimbRowsToCostDetails(rows, advance_amount);
  const amount = roundMoney2(calcCostDetailsTotal(cost_details));
  const merged = document.getElementById('reimbMergedNote')?.dataset?.merged === '1';
  return {
    id,
    date,
    remarks,
    activity_id: actId,
    brand,
    payee_name,
    payment_type,
    cost_module,
    claim_status,
    project_code: act?.project_code || '',
    has_invoice,
    invoices,
    cost_details,
    detail_rows: rows,
    advance_amount,
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
  lines.push(['备注', esc(reimbVisibleRemarks(p.remarks))].join(','));
  lines.push(['有发票', p.has_invoice ? '是' : '否'].join(','));
  if (p.has_invoice && p.invoices.length) {
    lines.push('发票内容,发票号码,开票日期,专票/普票');
    p.invoices.forEach((iv) =>
      lines.push([esc(iv.invoice_content), esc(iv.invoice_no), iv.invoice_date, esc(iv.invoice_kind)].join(','))
    );
  }
  lines.push('');
  lines.push('编号,板块,类别,内容说明,数量,单价,小计,发票,发票日期,发票号码,申请人,备注');
  const detailRows = Array.isArray(p.detail_rows) && p.detail_rows.length ? p.detail_rows : [];
  detailRows.forEach((row, idx) => {
    const blockLabel = REIMB_DETAIL_BLOCKS.find((x) => x.value === row.block)?.label || row.block || '';
    const catLabel = (REIMB_DETAIL_CATEGORY_OPTIONS[row.block] || []).find(([v]) => v === row.category)?.[1] || row.category || '';
    lines.push([
      idx + 1, esc(blockLabel), esc(catLabel), esc(row.description), row.quantity, row.unit_price, row.subtotal,
      esc(row.invoice), row.invoice_date, esc(row.invoice_no), esc(row.applicant), esc(row.remarks),
    ].join(','));
  });
  if (p.advance_amount) lines.push(['备用金抵扣', '', '', '', '', '', -roundMoney2(p.advance_amount)].join(','));
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

/** 与列表 CSV / 打印共用结构（来源于 GET /reimbursements/:id） */
function reimbursementPayloadFromRecord(r) {
  const meta = reimbReadDetailMeta(r.remarks || '');
  return {
    id: r.id,
    date: r.date,
    remarks: reimbVisibleRemarks(r.remarks || ''),
    activity_id: r.activity_id,
    brand: r.brand || '',
    payee_name: String(r.payee_name || '').trim(),
    project_code: r.related_project_code || '',
    payment_type: r.payment_type || 'personal_reimbursement',
    cost_module: r.cost_module || 'activity',
    claim_status: r.claim_status || 'draft',
    has_invoice: !!(r.has_invoice === 1 || r.has_invoice === true),
    invoices: Array.isArray(r.invoices) ? r.invoices : [],
    cost_details: parseActivityCostDetails({ cost_details: r.cost_details }),
    detail_rows: Array.isArray(meta.rows) ? meta.rows : [],
    advance_amount: roundMoney2(meta.advance_amount),
    amount: parseFloat(r.amount) || 0,
    merged_into_activity: !!(r.merged_into_activity === 1 || r.merged_into_activity === true),
    payment_status: String(r.payment_status || 'unpaid').toLowerCase() === 'paid' ? 'paid' : 'unpaid',
  };
}

function reimbClaimStatusSheetLabel(v) {
  if (v === 'paid') return '已报销';
  if (v === 'submitted') return '待支付';
  if (v === 'rejected') return '已驳回';
  return '草稿';
}

/**
 * 报销单 PDF 中无项目编号时按品牌填年框编号（用户指定字面格式，不修改数据库）
 */
function reimbBrandYearFrameCodeForPdf(brand) {
  const b = String(brand || '').trim().toUpperCase();
  if (b === 'PHD') return 'N220630-RC PHD';
  if (b === 'X.O' || b === 'XO') return 'N230901-RM XO';
  if (b === 'CLUB') return 'N230530-RM Club';
  return '';
}

/** @deprecated 报销单 PDF 已移除「项目归属一览」附件页；保留函数以兼容旧引用 */
function buildReimbursementRosterAttachmentHtml(activities) {
  const acts = (activities || []).filter((a) => a && String(a.project_code || '').trim());
  const byBrand = new Map();
  acts.forEach((a) => {
    const b = String(a.brand || '其他').trim() || '其他';
    const pc = String(a.project_code || '').trim();
    if (!byBrand.has(b)) byBrand.set(b, new Set());
    byBrand.get(b).add(pc);
  });
  const brandLines = [...byBrand.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
    .map(([brand, codes]) => `${escapeHtml(brand)}年框： ${[...codes].sort().join(' / ')}`)
    .join('<br/>');

  const byExec = new Map();
  acts.forEach((a) => {
    const ex = String(a.executor || '').trim();
    const pc = String(a.project_code || '').trim();
    if (!ex) return;
    if (!byExec.has(ex)) byExec.set(ex, new Set());
    byExec.get(ex).add(pc);
  });
  const execLines = [...byExec.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));

  let tbody = '';
  tbody += `<tr><td>盛融</td><td>—</td><td class="sr-pre">${brandLines || '—'}</td><td></td></tr>`;
  execLines.forEach(([name, codes]) => {
    tbody += `<tr><td></td><td>${escapeHtml(name)}</td><td class="sr-pre">${[...codes].sort().map(escapeHtml).join('<br/>')}</td><td></td></tr>`;
  });
  let pad = 1 + execLines.length;
  while (pad < 8) {
    tbody += `<tr><td>&#160;</td><td>&#160;</td><td>&#160;</td><td>&#160;</td></tr>`;
    pad += 1;
  }

  return `<section class="sr-roster">
    <p class="sr-roster-note">说明：以下为当前年度场次项目编号汇总，可作附件；空白栏位可打印后手写。</p>
    <table class="sr-table sr-roster-table" aria-label="项目归属一览">
      <thead><tr><th style="width:12%">公司</th><th style="width:14%">人员</th><th style="width:50%">项目名称</th><th style="width:24%">备注</th></tr></thead>
      <tbody>${tbody}</tbody>
    </table>
  </section>`;
}

/**
 * 盛融报销单打印版式（对齐纸质模板：主表 + 项目归属附件页）
 */
function buildReimbursementPrintableHtml(p) {
  const detailRows = Array.isArray(p.detail_rows) ? p.detail_rows.filter(Boolean) : [];
  const padSlots = Math.max(15, detailRows.length);
  const rows = [];
  for (let i = 0; i < padSlots; i += 1) rows.push(detailRows[i] || null);

  const gross = roundMoney2(detailRows.reduce((s, row) => s + roundMoney2(row && row.subtotal), 0));
  const totalShow = roundMoney2(gross > 0 ? gross : p.amount || 0);
  const advance = roundMoney2(p.advance_amount || 0);
  const payee = (p.payee_name || '').trim() || (detailRows[0] && detailRows[0].applicant) || '—';
  const projectBase = (p.project_code || '').trim();
  const dStr = p.date ? String(p.date).slice(0, 10) : '';
  const monthLabel = dStr.length >= 7 ? `${parseInt(dStr.slice(5, 7), 10)}月` : '—';
  const filer = getCurrentUserName() || (detailRows[0] && detailRows[0].applicant) || '—';
  const statusLabel = reimbClaimStatusSheetLabel(p.claim_status);

  const lineRows = rows
    .map((row, idx) => {
      if (!row) {
        return `<tr>
          <td class="sr-c">${idx + 1}</td>
          <td></td><td></td><td></td><td></td>
          <td class="sr-m"></td>
          <td></td><td></td><td></td>
          <td></td>
          <td class="sr-c"></td>
          <td></td>
        </tr>`;
      }
      const blockLabel = REIMB_DETAIL_BLOCKS.find((x) => x.value === row.block)?.label || row.block || '';
      const catLabel = (REIMB_DETAIL_CATEGORY_OPTIONS[row.block] || []).find(([v]) => v === row.category)?.[1] || row.category || '';
      // 项目编号优先使用单据项目编号；无则按行品牌（年框编号），最后兜底单据 brand 推断
      const rowBrand = String(row.brand || '').trim();
      const lineProject =
        projectBase
        || (REIMB_DETAIL_BRAND_OPTIONS.includes(rowBrand) ? rowBrand : '')
        || reimbBrandYearFrameCodeForPdf(p.brand)
        || rowBrand
        || '—';
      const inv = row.invoice === '无' ? '无' : '有';
      return `<tr>
        <td class="sr-c">${idx + 1}</td>
        <td>${escapeHtml(lineProject)}</td>
        <td>${escapeHtml(blockLabel)}</td>
        <td>${escapeHtml(catLabel)}</td>
        <td>${escapeHtml(row.description || '')}</td>
        <td class="sr-m">${fmtMoney(row.subtotal || 0)}</td>
        <td class="sr-c">${escapeHtml(inv)}</td>
        <td>${row.invoice_date ? escapeHtml(String(row.invoice_date).slice(0, 10)) : ''}</td>
        <td class="sr-invoice-no">${escapeHtml(row.invoice_no || '')}</td>
        <td>${escapeHtml(payee)}</td>
        <td class="sr-c">${escapeHtml(statusLabel)}</td>
        <td>${escapeHtml(row.remarks || '')}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>盛融报销单</title>
<style>
  @page { size: A4; margin: 12mm 10mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Songti SC","SimSun","Noto Serif SC",serif; font-size: 10.5px; color: #1a1a1a; margin: 0; padding: 12px 8px 24px; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sr-sheet { max-width: 190mm; margin: 0 auto; }
  .sr-title { text-align: center; font-size: 17px; font-weight: 700; letter-spacing: 0.35em; margin: 0 0 10px; }
  .sr-meta { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; font-size: 11px; }
  .sr-meta span { white-space: nowrap; }
  table.sr-table { width: 100%; border-collapse: collapse; table-layout: auto; }
  table.sr-table th, table.sr-table td {
    border: 1px solid #000;
    padding: 3px 5px;
    vertical-align: middle;
    white-space: nowrap;
    overflow: hidden;
  }
  table.sr-table thead th {
    background: #ececec;
    font-weight: 600;
    font-size: 9.5px;
    text-align: center;
    line-height: 1.25;
    white-space: nowrap;
  }
  .sr-c { text-align: center; }
  .sr-m { text-align: right; font-variant-numeric: tabular-nums; }
  .sr-invoice-no { font-size: 9px; letter-spacing: -0.1px; }
  .sr-footer { margin-top: 10px; font-size: 11px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; align-items: center; }
  .sr-footer-row { grid-column: 1 / -1; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; border-top: 1px solid #000; padding-top: 8px; margin-top: 4px; }
  .sr-note { margin-top: 8px; font-size: 10px; color: #333; }
  @media print {
    body { padding: 0; }
    .sr-footer-row { break-inside: avoid; }
  }
</style></head><body>
  <div class="sr-sheet">
    <h1 class="sr-title">盛融报销单</h1>
    <div class="sr-meta">
      <span>提报月份：<strong>${escapeHtml(monthLabel)}</strong></span>
      <span>申请日期：${escapeHtml(dStr || '—')}</span>
      <span>品牌：${escapeHtml(p.brand || '按明细行归属')}</span>
    </div>
    <table class="sr-table" aria-label="报销明细">
      <thead>
        <tr>
          <th>序号</th>
          <th>项目编号</th>
          <th>板块</th>
          <th>类别</th>
          <th>内容说明</th>
          <th>报销金额含税</th>
          <th>发票</th>
          <th>发票日期</th>
          <th>发票号码</th>
          <th>收款方</th>
          <th>报销状态</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>
    <div class="sr-footer">
      <div><strong>合计金额（含税）：</strong>${fmtMoney(totalShow)}</div>
      <div><strong>备用金抵扣：</strong>${advance > 0 ? fmtMoney(advance) : '—'}</div>
      <div class="sr-footer-row">
        <span><strong>抵扣后应付：</strong>${fmtMoney(p.amount || 0)}</span>
        <span><strong>填报人：</strong>${escapeHtml(filer)}</span>
      </div>
    </div>
    <p class="sr-note">已计入项目成本：${p.merged_into_activity ? '是' : '否'}　｜　使用浏览器「打印 → 另存为 PDF」可选路径导出电子版。</p>
  </div>
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
    title: '盛融报销单 · 预览',
    type: 'pdf',
    bodyHtml: `<iframe id="reimbPreviewPdfFrame" style="width:100%;height:70vh;border:1px solid #e5e7eb;border-radius:8px;background:#fff" srcdoc="${escapeHtml(html)}"></iframe>`,
  });
}

async function reimbursementPrintTemplateById(id) {
  try {
    const r = await api('GET', `/reimbursements/${id}`);
    const p = reimbursementPayloadFromRecord(r);
    const html = buildReimbursementPrintableHtml(p);
    openReimbursementPreviewModal({
      title: `盛融报销单 · #${id}`,
      type: 'pdf',
      bodyHtml: `<iframe id="reimbPreviewPdfFrame" style="width:100%;height:70vh;border:1px solid #e5e7eb;border-radius:8px;background:#fff" srcdoc="${escapeHtml(html)}"></iframe>`,
    });
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
  }
}

/* =============================================
   付款申请 · 详情弹窗（行点击展开）
   也被「物料采购页」整行点击复用：通过 detailModalContext 区分来源。
   ============================================= */
let reimbursementDetailState = { id: null, record: null };
/** 'reimbursement' | 'material' —— 当前 detail modal 的来源；控制 footer 按钮行为 */
let detailModalContext = 'reimbursement';

function buildReimbursementDetailModalHtml(record) {
  const r = record || {};
  const meta = reimbReadDetailMeta(r.remarks || '');
  const rows = Array.isArray(meta.rows) ? meta.rows : [];
  const advance = roundMoney2(meta.advance_amount);
  const visibleRemarks = reimbVisibleRemarks(r.remarks || '');
  const amount = parseFloat(r.amount) || 0;
  const amountCls = amount > 0 ? 'amount-pos' : amount < 0 ? 'amount-neg' : '';
  const projectCode = String(r.related_project_code || '').trim();
  const projectDisplay = projectCode || '按明细行归属';
  const heroRows = [
    ['日期', escapeHtml(fmtDateShort(r.date) || '—')],
    ['申请类型', escapeHtml(reimbPaymentTypeLabel(r.payment_type || ''))],
    ['成本板块', escapeHtml(reimbCostModuleLabel(r.cost_module || ''))],
    ['项目编号', escapeHtml(projectDisplay)],
    [
      '金额（含税）',
      `<span class="reimb-detail-value ${amountCls}">${fmtMoney(amount)}</span>`,
      true,
    ],
    ['状态', `<span class="badge ${reimbClaimStatusBadgeClass(r.claim_status)}">${escapeHtml(reimbClaimStatusLabel(r.claim_status || ''))}</span>`, true],
    ['付款状态', paymentStatusHtml(r.payment_status, r.payment_order_id)],
    ['收款方', escapeHtml(r.payee_name || '—')],
    ['合并场次', r.merged_into_activity ? '<span class="badge badge-success">已计入</span>' : '<span class="badge badge-gray">未计入</span>'],
  ];
  const heroHtml = heroRows
    .map(([label, value, rawValue]) => {
      const v = rawValue ? value : `<span class="reimb-detail-value">${value}</span>`;
      return `<div class="reimb-detail-hero-row"><span class="reimb-detail-label">${escapeHtml(label)}</span>${v}</div>`;
    })
    .join('');

  const legacyBrandMappedDetail = reimbDetailBrandFromLegacyBrand(r.brand);
  const detailTbody = rows.length
    ? rows
        .map((row, idx) => {
          const blockLabel = REIMB_DETAIL_BLOCKS.find((x) => x.value === row.block)?.label || row.block || '';
          const catLabel = (REIMB_DETAIL_CATEGORY_OPTIONS[row.block] || []).find(([v]) => v === row.category)?.[1] || row.category || '';
          const subtotal = roundMoney2(row.subtotal);
          const rowBrand =
            (typeof row.brand === 'string' && row.brand.trim())
              ? row.brand.trim()
              : (legacyBrandMappedDetail || (r.brand ? String(r.brand) : '—'));
          return `<tr>
            <td class="reimb-ro-c">${idx + 1}</td>
            <td>${escapeHtml(rowBrand)}</td>
            <td>${escapeHtml(blockLabel)}</td>
            <td>${escapeHtml(catLabel)}</td>
            <td class="reimb-ro-wrap">${escapeHtml(row.description || '')}</td>
            <td class="reimb-ro-c">${row.quantity != null && row.quantity !== '' ? escapeHtml(row.quantity) : '—'}</td>
            <td class="reimb-ro-amount">${row.unit_price != null && row.unit_price !== '' ? fmtMoney(row.unit_price) : '—'}</td>
            <td class="reimb-ro-amount">${fmtMoney(subtotal)}</td>
            <td class="reimb-ro-c">${row.invoice === '无' ? '无' : '有'}</td>
            <td class="reimb-ro-mono">${escapeHtml(row.invoice_no || '')}</td>
            <td class="reimb-ro-wrap">${escapeHtml(row.remarks || '')}</td>
          </tr>`;
        })
        .join('')
    : '';

  const detailTable = rows.length
    ? `<div class="reimb-ro-scroll"><table class="reimb-ro-table">
        <thead>
          <tr><th>#</th><th>品牌</th><th>板块</th><th>类别</th><th>内容说明</th><th>数量</th><th>单价</th><th>小计</th><th>发票</th><th>发票号码</th><th>备注</th></tr>
        </thead>
        <tbody>${detailTbody}</tbody>
      </table></div>`
    : '<div class="reimb-detail-empty">无结构化明细（可能为旧数据）</div>';

  return `<div class="reimb-detail-body">
    <div class="reimb-detail-hero" aria-label="付款申请基本信息">${heroHtml}</div>
    <section class="reimb-detail-section">
      <h4 class="reimb-detail-section-title">费用明细</h4>
      ${detailTable}
      ${advance > 0 ? `<div style="margin-top:10px;font-size:12px;color:var(--text-secondary)">备用金抵扣：<span class="reimb-detail-value amount-neg">- ${fmtMoney(advance)}</span></div>` : ''}
    </section>
    <section class="reimb-detail-section">
      <h4 class="reimb-detail-section-title">备注</h4>
      <div style="white-space:pre-wrap;line-height:1.6;font-size:12px;color:var(--text-primary)">${escapeHtml(visibleRemarks || '—')}</div>
    </section>
  </div>`;
}

function detailModalSyncFooter() {
  // 成本登记详情仅做编辑/删除/关闭，PDF/打印一律走付款申请 → 付款单出单
  const pdfBtn = document.getElementById('reimbDetailPdfBtn');
  if (pdfBtn) pdfBtn.style.display = 'none';
}

async function reimbursementOpenDetailModal(id) {
  const nid = Number(id);
  if (!Number.isFinite(nid)) return;
  detailModalContext = 'reimbursement';
  reimbursementDetailState = { id: nid, record: null };
  const titleEl = document.getElementById('modalReimbDetailTitle');
  const bodyEl = document.getElementById('modalReimbDetailBody');
  if (!titleEl || !bodyEl) {
    showToast('详情弹窗未就绪，请刷新页面', 'warning');
    return;
  }
  titleEl.textContent = `付款申请详情 · #${nid}`;
  bodyEl.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-title">加载中…</div></div>';
  openModal('modalReimbDetail');
  detailModalSyncFooter();
  try {
    const r = await api('GET', `/reimbursements/${nid}`);
    reimbursementDetailState.record = r;
    bodyEl.innerHTML = buildReimbursementDetailModalHtml(r);
  } catch (e) {
    bodyEl.innerHTML = `<div class="empty-state" style="padding:24px"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message || '')}</div></div>`;
  }
}

/**
 * 物料采购详情弹窗：复用付款申请详情容器（统一视觉），footer 按钮按上下文派发。
 * - 行 = `material_purchases` 表中的直接登记记录（不是报销派生）
 * - PDF 预览按钮在物料采购上下文下隐藏
 */
async function materialPurchaseOpenDetailModal(id) {
  const nid = Number(id);
  if (!Number.isFinite(nid)) return;
  detailModalContext = 'material';
  reimbursementDetailState = { id: nid, record: null };
  const titleEl = document.getElementById('modalReimbDetailTitle');
  const bodyEl = document.getElementById('modalReimbDetailBody');
  if (!titleEl || !bodyEl) {
    showToast('详情弹窗未就绪，请刷新页面', 'warning');
    return;
  }
  titleEl.textContent = `物料采购详情 · #${nid}`;
  bodyEl.innerHTML = '<div class="empty-state" style="padding:24px"><div class="empty-title">加载中…</div></div>';
  openModal('modalReimbDetail');
  detailModalSyncFooter();
  try {
    const r = await api('GET', `/material-purchases/${nid}`);
    reimbursementDetailState.record = r;
    bodyEl.innerHTML = buildMaterialPurchaseDetailModalHtml(r);
  } catch (e) {
    bodyEl.innerHTML = `<div class="empty-state" style="padding:24px"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message || '')}</div></div>`;
  }
}

/**
 * 渲染物料采购详情正文（与付款申请详情保持视觉一致：hero 区 + 明细表 + 备注）
 */
function buildMaterialPurchaseDetailModalHtml(record) {
  const r = record || {};
  const merged = isMergedFlag(r.merged_into_activity);
  const amount = roundMoney2(r.total_amount);
  const heroRows = [
    ['日期', escapeHtml(fmtDateShort(r.purchase_date) || '—')],
    ['品牌', `<span class="badge badge-${brandColor(r.brand_code || r.brand_name)}">${escapeHtml(r.brand_name || r.brand_code || '—')}</span>`, true],
    ['合计', `<span class="reimb-detail-value ${amount > 0 ? 'amount-pos' : ''}">${fmtMoney(amount)}</span>`, true],
    ['关联项目', escapeHtml(r.activity_project_code || r.related_project_code || '—')],
    ['计入状态', merged ? '<span class="badge badge-success">已计入</span>' : '<span class="badge badge-gray">未计入</span>', true],
    ['付款状态', paymentStatusHtml(r.payment_status, r.payment_order_id), true],
  ];
  const heroHtml = heroRows
    .map(([label, value, rawValue]) => {
      const v = rawValue ? value : `<span class="reimb-detail-value">${value}</span>`;
      return `<div class="reimb-detail-hero-row"><span class="reimb-detail-label">${escapeHtml(label)}</span>${v}</div>`;
    })
    .join('');
  const items = Array.isArray(r.items) ? r.items : [];
  const tbody = items.length
    ? items.map((it, idx) => `<tr>
        <td class="reimb-ro-c">${idx + 1}</td>
        <td class="reimb-ro-wrap">${escapeHtml(it.name || '')}</td>
        <td class="reimb-ro-amount">${fmtMoney(it.amount)}</td>
      </tr>`).join('')
    : '';
  const table = items.length
    ? `<div class="reimb-ro-scroll"><table class="reimb-ro-table">
        <thead>
          <tr><th style="width:48px">#</th><th>项目名称</th><th style="text-align:right">金额</th></tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table></div>`
    : '<div class="reimb-detail-empty">无明细</div>';
  return `<div class="reimb-detail-body">
    <div class="reimb-detail-hero" aria-label="物料采购基本信息">${heroHtml}</div>
    <section class="reimb-detail-section">
      <h4 class="reimb-detail-section-title">采购明细</h4>
      ${table}
    </section>
    <section class="reimb-detail-section">
      <h4 class="reimb-detail-section-title">备注</h4>
      <div style="white-space:pre-wrap;line-height:1.6;font-size:12px;color:var(--text-primary)">${escapeHtml(r.remarks || '—')}</div>
    </section>
  </div>`;
}

async function reimbursementDetailEdit() {
  const id = reimbursementDetailState.id;
  if (!Number.isFinite(id)) return;
  closeModal();
  if (detailModalContext === 'material') {
    await showMaterialPurchaseModal(id);
  } else {
    await reimbursementEditById(id);
  }
}

async function reimbursementDetailDelete() {
  const id = reimbursementDetailState.id;
  if (!Number.isFinite(id)) return;
  closeModal();
  if (detailModalContext === 'material') {
    await deleteMaterialPurchaseRecord(id);
  } else {
    await deleteReimbursementRecord(id);
  }
}

/** @deprecated 成本登记详情已禁用 PDF 预览；保留以兼容旧入口 */
async function reimbursementDetailPdfPreview() {
  showToast('请在「付款申请」中生成付款单进行预览/导出', 'info');
}

async function reimbursementEditById(id) {
  try {
    const r = await api('GET', `/reimbursements/${id}`);
    await showReimbursementModal(r);
  } catch (e) {
    showToast(e.message || '加载失败', 'error');
  }
}

function reimbursementInlineHost() {
  return document.getElementById('reimbInlineHost');
}

function hideReimbursementInline() {
  const host = reimbursementInlineHost();
  if (!host) return;
  host.hidden = true;
  host.innerHTML = '';
}

async function showReimbursementModal(record) {
  return showReimbursementForm(record);
}

async function showReimbursementForm(record) {
  const host = reimbursementInlineHost();
  if (!host) {
    showToast('请先打开「付款申请」页面', 'warning');
    return;
  }
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
  const meta = reimbReadDetailMeta(record?.remarks || '');
  const remarksEsc = escapeHtml(reimbVisibleRemarks(record?.remarks || ''));
  const rawDetailRows = Array.isArray(meta.rows) && meta.rows.length ? meta.rows : [];
  const useAdvance = !!meta.use_advance;
  const advanceAmount = roundMoney2(meta.advance_amount);
  const paymentDateVal = meta.payment_date || '';
  const legacyBrandMapped = record && record.brand ? reimbDetailBrandFromLegacyBrand(record.brand) : '';
  reimbDetailDefaultBrand = legacyBrandMapped || '内部';
  const detailRows = rawDetailRows.map((row) => ({
    ...row,
    brand:
      typeof row?.brand === 'string' && row.brand.trim()
        ? row.brand.trim()
        : legacyBrandMapped || reimbDetailDefaultBrand,
  }));
  const payeeVal = record && record.payee_name ? String(record.payee_name) : '';
  const costModuleVal = record && record.cost_module ? String(record.cost_module) : 'activity';
  const claimStatusVal = record && record.claim_status ? String(record.claim_status) : 'draft';
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

  const isNonActivityRecord =
    !!record && !merged && String(record.cost_module) === 'general' && !record.activity_id;
  const paymentStatusVal = record && String(record.payment_status).toLowerCase() === 'paid' ? 'paid' : 'unpaid';

  const titleText = rid ? `编辑报销登记 · #${rid}` : '报销登记';
  host.hidden = false;
  host.innerHTML = `
    <section class="reimb-inline-panel" aria-label="付款申请登记">
      <header class="reimb-inline-header">
        <span class="reimb-inline-title">${escapeHtml(titleText)}</span>
        <button type="button" class="modal-close" aria-label="收起" onclick="hideReimbursementInline()">✕</button>
      </header>
      <div class="reimb-form-body" id="reimbInlineBody">
        <input type="hidden" id="reimbRecordId" value="${rid}">
        <input type="hidden" id="reimbActivityId" value="${actId || ''}">
        <div id="reimbMergedNote" style="display:${merged ? 'block' : 'none'};margin-bottom:10px;padding:10px;background:var(--accent-soft);border-radius:var(--radius-sm);font-size:12px;color:var(--text-primary)" data-merged="${merged ? '1' : '0'}">
          本单已同步项目成本；保存时将按费用明细再次合并。不可更换关联项目。
        </div>
        <div class="reimb-attr-row" id="reimbAttrWrap" style="display:${merged ? 'none' : 'flex'}">
          <span class="reimb-attr-label">成本归属</span>
          <div class="reimb-attr-options">
            <label class="reimb-attr-chip"><input type="radio" name="reimbCostAttribution" value="activity" ${!isNonActivityRecord ? 'checked' : ''} onchange="reimbOnCostAttributionChange()"><span>活动成本（可同步场次）</span></label>
            <label class="reimb-attr-chip"><input type="radio" name="reimbCostAttribution" value="non_activity" ${isNonActivityRecord ? 'checked' : ''} onchange="reimbOnCostAttributionChange()"><span>统筹成本（不同步场次）</span></label>
          </div>
          <p class="reimb-attr-hint">统筹成本（不同步场次）：净额 = 费用合计 − 备用金；正值（蓝色）为应付报销人，负值（红色）为归还公司；不计入场次成本。</p>
        </div>
        <input type="hidden" id="reimbPaymentType" value="personal_reimbursement">
        <div class="form-grid reimb-top-grid reimb-top-grid--dense">
          <div class="form-group reimb-project-field reimb-span-3">
            <label class="form-label" id="reimbProjectCodeLabel">项目编号</label>
            ${
              merged
                ? `<div class="reimb-project-readonly">${pickedMergedLabel}</div>`
                : `<input type="text" class="form-control" id="reimbProjectCode" list="reimbProjectList" autocomplete="off" placeholder="输入关键字并从下拉选择项目编号" oninput="reimbProjectInputChanged()">
                   <datalist id="reimbProjectList"></datalist>
                   <div id="reimbActivityPicked" style="display:none;margin-top:6px;font-size:12px;color:var(--text-secondary)"></div>`
            }
          </div>
          <div class="form-group">
            <label class="form-label">成本计入 <span class="required">*</span></label>
            <select class="form-control" id="reimbCostModule">${costModuleOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">状态 <span class="required">*</span></label>
            <select class="form-control" id="reimbClaimStatus" onchange="reimbClaimStatusChanged()">${claimStatusOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">付款状态</label>
            <select class="form-control" id="reimbPaymentStatus">
              <option value="unpaid" ${paymentStatusVal !== 'paid' ? 'selected' : ''}>未支付</option>
              <option value="paid" ${paymentStatusVal === 'paid' ? 'selected' : ''}>已支付</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">申请日期 <span class="required">*</span></label>
            <input type="date" class="form-control" id="reimbDate" value="${dateVal}">
          </div>
          <div class="form-group reimb-span-2">
            <label class="form-label">收款方</label>
            <input type="text" class="form-control" id="reimbPayeeName" placeholder="用于付款合并；生成付款单前必填" value="${escapeHtml(payeeVal)}">
          </div>
          <div class="form-group" id="reimbPaymentDateWrap" style="display:${claimStatusVal === 'paid' ? 'block' : 'none'}">
            <label class="form-label">付款日期</label>
            <input type="date" class="form-control" id="reimbPaymentDate" value="${escapeHtml(paymentDateVal)}">
          </div>
          <div class="form-group reimb-sync-row reimb-span-3" style="display:${merged ? 'none' : 'block'}">
            <label class="form-label">条件选择</label>
            <label class="reimb-option-row reimb-option-row--compact">
              <input type="checkbox" id="reimbSyncToActivity" ${merged ? 'checked disabled' : ''} onchange="reimbOnSyncToActivityChange()">
              <span>同步项目成本（默认不勾选；勾选时必须填写项目编号，所有费用只统计一次）</span>
            </label>
          </div>
        </div>
        <div class="form-group reimb-detail-section">
          <div class="reimb-detail-section-head">
            <span class="form-label" style="margin:0">费用明细</span>
            <span class="reimb-detail-hint">每行可独立选择品牌；空品牌按「内部」入账</span>
            <button type="button" class="btn btn-secondary btn-sm" onclick="reimbAppendDetailRow(null)">添加一行</button>
          </div>
          <div class="reimb-detail-table-wrap reimb-detail-table-wrap--compact">
            <table class="data-table reimb-detail-table reimb-detail-table--compact" id="reimbDetailTable">
              <thead>
                <tr>
                  <th>编号</th><th class="reimb-col-brand">品牌</th><th>板块</th><th>类别</th><th>内容说明</th><th>数量</th><th>单价</th><th>小计</th>
                  <th>发票</th><th>发票日期</th><th>发票号码</th><th>申请人</th><th>备注</th><th></th>
                </tr>
              </thead>
              <tbody id="reimbDetailRows"></tbody>
            </table>
          </div>
        </div>
        <div class="reimb-totals-row">
          <label class="reimb-advance-card">
            <input type="checkbox" id="reimbUseAdvance" ${useAdvance ? 'checked' : ''} onchange="reimbToggleAdvanceAmount()">
            <span class="reimb-advance-copy">
              <span class="reimb-advance-title">备用金</span>
              <span class="reimb-advance-sub">勾选后填写抵扣金额</span>
            </span>
          </label>
          <div class="form-group reimb-advance-amount" id="reimbAdvanceAmountWrap" style="display:${useAdvance ? 'block' : 'none'}">
            <label class="form-label">备用金金额</label>
            <input type="number" class="form-control" id="reimbAdvanceAmount" min="0" step="0.01" value="${advanceAmount > 0 ? advanceAmount.toFixed(2) : ''}" oninput="reimbUpdateDetailTotals()">
          </div>
          <div class="reimb-total-card">
            <span style="color:var(--text-secondary);font-size:13px">费用合计</span>
            <span class="amount" id="reimbGrossTotal">¥0.00</span>
          </div>
          <div class="reimb-total-card reimb-total-card-primary">
            <span style="color:var(--text-secondary);font-size:13px">金额合计</span>
            <span class="amount" style="font-weight:700;color:var(--accent)" id="reimbCostTotal">¥0.00</span>
          </div>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label class="form-label">备注</label>
          <textarea class="form-control" id="reimbRemarks" rows="2" placeholder="选填">${remarksEsc}</textarea>
        </div>
      </div>
      <footer class="reimb-inline-footer">
        <button type="button" class="btn btn-secondary" onclick="hideReimbursementInline()">取消</button>
        <button type="button" class="btn btn-primary" onclick="saveReimbursementForm()">保存</button>
      </footer>
    </section>
  `;

  if (detailRows.length) {
    detailRows.forEach((row) => reimbAppendDetailRow(row));
  } else if (record) {
    const parsed = reimbParseJsonObject(record.cost_details || {});
    const restoredRows = Object.entries(parsed)
      .filter(([key, value]) => key !== 'advance_offset' && roundMoney2(value) > 0)
      .map(([key, value]) => {
        const block = Object.keys(REIMB_DETAIL_CATEGORY_OPTIONS).find((b) =>
          (REIMB_DETAIL_CATEGORY_OPTIONS[b] || []).some(([cat]) => cat === key)
        ) || 'personnel';
        return { brand: legacyBrandMapped || '', block, category: key, quantity: 1, unit_price: roundMoney2(value) };
      });
    (restoredRows.length ? restoredRows : [null, null, null]).forEach((row) => reimbAppendDetailRow(row));
  } else {
    for (let i = 0; i < 3; i += 1) reimbAppendDetailRow(null);
  }
  if (!merged) {
    reimbRenderActivityPicker();
    if (actId) reimbSelectActivity(actId);
  } else if (document.getElementById('reimbActivityId') && actId) {
    document.getElementById('reimbActivityId').value = String(actId);
  }
  reimbClaimStatusChanged();
  reimbToggleAdvanceAmount();
  if (!merged) reimbOnCostAttributionChange();
  reimbOnSyncToActivityChange();
  reimbUpdateDetailTotals();
  renderLucideIcons();
  try {
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (_) { /* ignore */ }
}

async function saveReimbursementForm() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可保存', 'warning');
    return;
  }
  const rid = document.getElementById('reimbRecordId')?.value?.trim();
  const mergedNote = document.getElementById('reimbMergedNote');
  const alreadyMerged = mergedNote && mergedNote.dataset.merged === '1';
  const attribution = alreadyMerged
    ? 'activity'
    : document.querySelector('input[name="reimbCostAttribution"]:checked')?.value || 'activity';
  const isNonActivity = !alreadyMerged && attribution === 'non_activity';
  let actId = parseInt(document.getElementById('reimbActivityId')?.value, 10);
  const projectCodeInput = (document.getElementById('reimbProjectCode')?.value || '').replace(/^\uFEFF/, '').trim();
  const date = document.getElementById('reimbDate')?.value;
  const payee_name = document.getElementById('reimbPayeeName')?.value?.trim() || '';
  const remarks = document.getElementById('reimbRemarks')?.value?.trim() || '';
  const payment_type = document.getElementById('reimbPaymentType')?.value || 'personal_reimbursement';
  let cost_module = document.getElementById('reimbCostModule')?.value || 'activity';
  const claim_status = document.getElementById('reimbClaimStatus')?.value || 'draft';
  const payment_status = document.getElementById('reimbPaymentStatus')?.value === 'paid' ? 'paid' : 'unpaid';
  const rows = reimbCollectDetailRows();
  const use_advance = !!document.getElementById('reimbUseAdvance')?.checked;
  const advance_amount = use_advance ? roundMoney2(document.getElementById('reimbAdvanceAmount')?.value) : 0;
  const cost_details = reimbRowsToCostDetails(rows, advance_amount);
  const grossTotal = roundMoney2(rows.reduce((s, row) => s + roundMoney2(row.subtotal), 0));
  const total = roundMoney2(calcCostDetailsTotal(cost_details));
  const payment_date = document.getElementById('reimbPaymentDate')?.value || '';
  const brand = reimbResolveRecordBrand(rows);
  const invoices = rows
    .filter((row) => row.invoice_no && row.invoice_date)
    .map((row) => ({
      invoice_content: row.description,
      invoice_no: row.invoice_no,
      invoice_date: row.invoice_date,
      invoice_kind: '普票',
    }));
  const has_invoice = invoices.length > 0;
  const syncEl = document.getElementById('reimbSyncToActivity');
  const sync_to_activity = alreadyMerged ? true : isNonActivity ? false : !!syncEl?.checked;
  if (isNonActivity) {
    actId = NaN;
    cost_module = 'general';
  }
  const hasAct = Number.isFinite(actId) && actId > 0;

  if (!currentYearFrameId) {
    showToast('年框未就绪', 'warning');
    return;
  }
  if (!date) {
    showToast('请选择申请日期', 'warning');
    return;
  }
  if (projectCodeInput && !hasAct) {
    showToast('项目编号请从下拉候选中选中；若不关联请清空输入', 'warning');
    return;
  }
  if (claim_status === 'paid' && !payment_date) {
    showToast('状态为已支付时，请填写付款日期', 'warning');
    return;
  }
  if (!rows.length) {
    showToast('请至少填写一行费用明细', 'warning');
    return;
  }
  if (total === 0) {
    showToast('金额合计不能为 0', 'warning');
    return;
  }
  if (!isNonActivity && total <= 0) {
    showToast('活动成本模式下金额合计须大于 0', 'warning');
    return;
  }
  if (total < 0 && !isNonActivity) {
    showToast('负金额仅适用于「统筹成本（不同步场次）」归属', 'warning');
    return;
  }
  if (use_advance && advance_amount <= 0) {
    showToast('勾选备用金时，请填写备用金金额', 'warning');
    return;
  }
  if (sync_to_activity && !hasAct) {
    showToast('勾选「同步项目成本」时，必须填写项目编号并从下拉中选中', 'warning');
    const projInput = document.getElementById('reimbProjectCode');
    if (projInput) {
      projInput.classList.add('reimb-project-required-error');
      try {
        projInput.focus();
      } catch (_) {
        /* ignore */
      }
      setTimeout(() => projInput.classList.remove('reimb-project-required-error'), 2400);
    }
    return;
  }

  const body = {
    year_frame_id: currentYearFrameId,
    activity_id: hasAct ? actId : null,
    brand,
    date,
    payee_name,
    payment_status,
    remarks: reimbRemarksWithMeta(remarks, { rows, use_advance, advance_amount, gross_total: grossTotal, payment_date }),
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
    hideReimbursementInline();
    if (currentPage === 'reimbursement') await renderReimbursements();
    if (currentPage === 'material') await renderMaterialPurchases();
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
    if (currentPage === 'material') await renderMaterialPurchases();
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

function reimbursementRowClick(ev, id) {
  if (ev.target.closest('button') || ev.target.closest('input') || ev.target.closest('a')) return;
  const k = Number(id);
  if (!Number.isFinite(k)) return;
  reimbursementOpenDetailModal(k);
}

function reimbursementExpandDetailHtml(r) {
  const meta = reimbReadDetailMeta(r.remarks || '');
  const rows = Array.isArray(meta.rows) ? meta.rows : [];
  const adv = roundMoney2(meta.advance_amount);
  const lines = rows.length
    ? rows
        .map(
          (row, i) =>
            `${i + 1}. ${escapeHtml(row.description || '')}　小计 ${fmtMoney(row.subtotal || 0)}`
        )
        .join('<br/>')
    : '<span style="color:var(--text-muted)">无结构化明细（可能为旧数据）</span>';
  return `<div class="reimb-inline-detail" style="font-size:12px;line-height:1.5;color:var(--text-primary)">
    <div style="margin-bottom:6px"><strong>费用明细</strong></div>
    <div>${lines}</div>
    ${adv > 0 ? `<div style="margin-top:8px">备用金抵扣：<span class="amount">${fmtMoney(adv)}</span></div>` : ''}
    <div style="margin-top:8px;color:var(--text-secondary)">${escapeHtml(reimbVisibleRemarks(r.remarks || '') || '—')}</div>
  </div>`;
}

/** 成本登记多选辅助 */
function reimbursementSelectionEligible(r) {
  if (!r) return false;
  if (String(r.payment_status || 'unpaid').toLowerCase() === 'paid') return false;
  if (r.payment_order_id) return false;
  return true;
}

function reimbursementSelectionPrune() {
  if (!reimbursementPageState.selectedIds) reimbursementPageState.selectedIds = new Set();
  const valid = new Set(
    (reimbursementPageState.rows || [])
      .filter(reimbursementSelectionEligible)
      .map((r) => Number(r.id))
      .filter(Number.isFinite),
  );
  reimbursementPageState.selectedIds = new Set(
    [...reimbursementPageState.selectedIds].filter((id) => valid.has(Number(id))),
  );
}

function reimbursementToggleRowSelect(id, checked) {
  if (!reimbursementPageState.selectedIds) reimbursementPageState.selectedIds = new Set();
  const nid = Number(id);
  if (checked) reimbursementPageState.selectedIds.add(nid);
  else reimbursementPageState.selectedIds.delete(nid);
  reimbursementRenderListDom();
}

function reimbursementToggleSelectAll(checked) {
  if (!reimbursementPageState.selectedIds) reimbursementPageState.selectedIds = new Set();
  const view = reimbursementPageState.view || 'registrations';
  if (view !== 'registrations') return;
  if (checked) {
    (reimbursementPageState.rows || [])
      .filter(reimbursementSelectionEligible)
      .forEach((r) => reimbursementPageState.selectedIds.add(Number(r.id)));
  } else {
    reimbursementPageState.selectedIds.clear();
  }
  reimbursementRenderListDom();
}

/**
 * 合并选中的成本登记：把多条报销单的明细行汇总到一条新记录中，并删除原记录。
 * 合并不涉及付款流程；付款仍由「付款申请」入口走付款单出单。
 *
 * 校验：
 *  - ≥2 条
 *  - 都未支付 / 未关联付款单（reimbursementSelectionEligible）
 *  - 收款方、申请类型（个人/对公）、成本板块一致
 */
async function reimbursementMergeSelected() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可合并记录', 'warning');
    return;
  }
  if (!reimbursementPageState.selectedIds) reimbursementPageState.selectedIds = new Set();
  const ids = [...reimbursementPageState.selectedIds].map(Number).filter(Number.isFinite);
  if (ids.length < 2) {
    showToast('请至少勾选 2 条记录进行合并', 'warning');
    return;
  }
  const listRows = (reimbursementPageState.rows || []).filter((r) => ids.includes(Number(r.id)));
  if (listRows.length !== ids.length) {
    showToast('选中记录已发生变化，请刷新后重试', 'warning');
    return;
  }
  if (listRows.some((r) => !reimbursementSelectionEligible(r))) {
    showToast('选中记录中存在「已支付」或已关联付款单的项，请取消勾选后重试', 'warning');
    return;
  }
  const payees = [...new Set(listRows.map((r) => String(r.payee_name || '').trim()).filter(Boolean))];
  if (payees.length !== 1 || listRows.some((r) => !String(r.payee_name || '').trim())) {
    showToast('只能合并同一收款方的记录；空收款方请回到来源记录补填', 'warning');
    return;
  }
  const paymentTypes = [...new Set(listRows.map((r) => r.payment_type || 'personal_reimbursement'))];
  if (paymentTypes.length > 1) {
    showToast('个人报销与对公付款不可混合合并', 'warning');
    return;
  }
  const costModules = [...new Set(listRows.map((r) => r.cost_module || 'activity'))];
  if (costModules.length > 1) {
    showToast('不同成本板块的记录不可合并；请仅勾选同一板块', 'warning');
    return;
  }

  const summary = listRows
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((r) => `#${r.id}`)
    .join('、');
  if (!confirm(`确认合并 ${listRows.length} 条记录（${summary}）为一条新成本登记？\n原记录将被删除，且不可撤销。`)) return;

  let merged;
  try {
    merged = await reimbursementMergeRecordsByIds(ids);
  } catch (e) {
    showToast(e.message || '合并失败', 'error');
    return;
  }

  reimbursementPageState.selectedIds = new Set();
  showToast(`已合并为 #${merged.newId}（删除原 ${merged.deleted} 条）`, 'success');
  if (currentPage === 'reimbursement') await renderReimbursements();
  if (currentPage === 'material') await renderMaterialPurchases();
  if (currentPage === 'cost') await renderCost();
  void updateBadges();
}

/**
 * 合并实现：拉取每条报销单完整记录 → 汇总 detail_rows / advance / 备注 → POST 创建 → 逐条 DELETE 原记录。
 * 若新建成功后删除失败，会上抛错误并提示用户清理，避免数据双份。
 */
async function reimbursementMergeRecordsByIds(ids) {
  const fullRecords = [];
  for (const id of ids) {
    const r = await api('GET', `/reimbursements/${id}`);
    fullRecords.push(r);
  }
  const allRows = [];
  let advanceTotal = 0;
  let useAdvance = false;
  const visibleRemarks = [];
  fullRecords.forEach((r) => {
    const meta = reimbReadDetailMeta(r.remarks || '');
    if (Array.isArray(meta.rows)) {
      meta.rows.forEach((row) => row && allRows.push({ ...row }));
    }
    const adv = roundMoney2(meta.advance_amount);
    if (adv > 0) {
      useAdvance = true;
      advanceTotal = roundMoney2(advanceTotal + adv);
    }
    const visible = reimbVisibleRemarks(r.remarks || '').trim();
    if (visible) visibleRemarks.push(`#${r.id}：${visible}`);
  });
  if (!allRows.length) {
    throw new Error('选中记录没有可合并的费用明细');
  }

  const grossTotal = roundMoney2(allRows.reduce((s, row) => s + roundMoney2(row.subtotal), 0));
  const cost_details = reimbRowsToCostDetails(allRows, advanceTotal);
  if (calcCostDetailsTotal(cost_details) === 0) {
    throw new Error('合并后金额合计为 0，无法保存');
  }

  const dates = fullRecords.map((r) => String(r.date || '').slice(0, 10)).filter(Boolean).sort();
  const mergedDate = dates[dates.length - 1] || todayDateInputValue();
  const first = fullRecords[0] || {};
  const brand = reimbResolveRecordBrand(allRows) || first.brand || '';
  const payment_type = first.payment_type || 'personal_reimbursement';
  const cost_module = first.cost_module || 'activity';
  const payee_name = String(first.payee_name || '').trim();
  const activityIds = [...new Set(fullRecords.map((r) => r.activity_id).filter((x) => x != null))];
  const projectCodes = [...new Set(fullRecords.map((r) => r.related_project_code).filter(Boolean))];
  const cities = [...new Set(fullRecords.map((r) => r.city).filter(Boolean))];
  const sameActivity = activityIds.length === 1;
  const samePc = projectCodes.length === 1;
  const sameCity = cities.length === 1;

  const invoices = allRows
    .filter((row) => row.invoice_no && row.invoice_date)
    .map((row) => ({
      invoice_content: row.description,
      invoice_no: row.invoice_no,
      invoice_date: row.invoice_date,
      invoice_kind: '普票',
    }));
  const has_invoice = invoices.length > 0;

  const userRemarksJoined = visibleRemarks.length
    ? `合并自 ${ids.map((x) => `#${x}`).join(' + ')}\n${visibleRemarks.join('\n')}`
    : `合并自 ${ids.map((x) => `#${x}`).join(' + ')}`;
  const remarksWithMeta = reimbRemarksWithMeta(userRemarksJoined, {
    rows: allRows,
    use_advance: useAdvance,
    advance_amount: advanceTotal,
    gross_total: grossTotal,
    payment_date: '',
  });

  const body = {
    year_frame_id: currentYearFrameId,
    activity_id: sameActivity ? activityIds[0] : null,
    brand,
    date: mergedDate,
    payee_name,
    payment_status: 'unpaid',
    remarks: remarksWithMeta,
    payment_type,
    cost_module,
    claim_status: 'draft',
    has_invoice,
    invoices,
    cost_details,
    sync_to_activity: false,
    related_project_code: samePc ? projectCodes[0] : null,
    city: sameCity ? cities[0] : null,
  };

  const created = await api('POST', '/reimbursements', body);
  const newId = Number(created && created.id);
  if (!Number.isFinite(newId)) {
    throw new Error('合并后未返回新记录 ID');
  }

  let deleted = 0;
  const failures = [];
  for (const id of ids) {
    try {
      await api('DELETE', `/reimbursements/${id}`);
      deleted += 1;
    } catch (e) {
      failures.push(`#${id}: ${e.message || '删除失败'}`);
    }
  }
  if (failures.length) {
    throw new Error(`已新建合并记录 #${newId}，但以下原记录删除失败：\n${failures.join('\n')}\n请到列表手动删除。`);
  }
  return { newId, deleted };
}

function reimbursementRenderListDom() {
  const container = document.getElementById('pageContainer');
  if (!container) return;
  const view = reimbursementPageState.view || 'registrations';
  const rows = reimbursementPageState.rows || [];
  const orders = reimbursementPageState.paymentOrders || [];
  reimbursementSelectionPrune();
  const selectedIds = reimbursementPageState.selectedIds || new Set();
  const selectedCount = selectedIds.size;
  const kw = (reimbursementPageState.filterInput || '').trim().toLowerCase();
  const filtered = !kw
    ? rows
    : rows.filter((r) => {
        const pc = String(r.related_project_code || '').toLowerCase();
        const brand = String(r.brand || '').toLowerCase();
        const city = String(r.city || '').toLowerCase();
        const rm = reimbVisibleRemarks(r.remarks || '').toLowerCase();
        const tp = reimbPaymentTypeLabel(r.payment_type || '').toLowerCase();
        const mod = reimbCostModuleLabel(r.cost_module || '').toLowerCase();
        const st = reimbClaimStatusLabel(r.claim_status || '').toLowerCase();
        return pc.includes(kw) || brand.includes(kw) || city.includes(kw) || rm.includes(kw) || tp.includes(kw) || mod.includes(kw) || st.includes(kw) || String(r.id).includes(kw);
      });
  const fi = escapeHtml(reimbursementPageState.filterInput || '');
  const ordersFiltered = orders.filter((o) => {
    if (!kw) return true;
    return [o.order_no, o.payee_name, o.remarks, o.status, o.id].some((x) => String(x || '').toLowerCase().includes(kw));
  });
  const paymentOrderRow = (o) => `<tr>
          <td>${escapeHtml(o.order_no || `#${o.id}`)}</td>
          <td>${escapeHtml(fmtDateShort(o.order_date))}</td>
          <td>${escapeHtml(fmtDateShort(o.payment_date))}</td>
          <td>${escapeHtml(o.payee_name || '—')}</td>
          <td class="amount" style="text-align:left">${fmtMoney(o.total_amount)}</td>
          <td><span class="badge badge-success">${String(o.status || '') === 'paid' ? '已支付' : escapeHtml(o.status || '—')}</span></td>
          <td>${escapeHtml(o.item_count || 0)}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(o.remarks || '')}">${escapeHtml(o.remarks || '—')}</td>
          <td onclick="event.stopPropagation()" style="white-space:nowrap">
            <div class="reimbursement-row-actions">
              <button type="button" class="btn btn-secondary btn-sm" onclick="paymentOrderViewDetail(${o.id})">详情</button>
              <button type="button" class="btn btn-danger btn-sm" onclick="paymentOrderDelete(${o.id}, '${escapeHtml(o.order_no || `#${o.id}`)}')">删除</button>
            </div>
          </td>
        </tr>`;
  const ordersUnpaid = ordersFiltered.filter((o) => String(o.status || '').toLowerCase() !== 'paid');
  const ordersPaid = ordersFiltered.filter((o) => String(o.status || '').toLowerCase() === 'paid');
  const listRowsHtml =
    view === 'payment_orders'
      ? ordersFiltered.length === 0
        ? '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:24px">暂无付款单</td></tr>'
        : `${ordersUnpaid.length ? `<tr><td colspan="9" style="padding:8px 12px;font-size:12px;font-weight:600;color:var(--text-secondary);background:var(--bg-input)">未支付 ${ordersUnpaid.length} 笔</td></tr>` : ''}${ordersUnpaid.map(paymentOrderRow).join('')}${ordersPaid.length ? `<tr><td colspan="9" style="padding:8px 12px;font-size:12px;font-weight:600;color:var(--text-secondary);background:var(--bg-input)">已支付 ${ordersPaid.length} 笔</td></tr>` : ''}${ordersPaid.map(paymentOrderRow).join('')}`
      : '';

  const registrationRowsHtml = (list) =>
    list
      .flatMap((r) => {
        const m = r.merged_into_activity === 1 || r.merged_into_activity === true;
        const paymentType = r.payment_type || 'personal_reimbursement';
        const costModule = r.cost_module || 'activity';
        const claimStatus = r.claim_status || 'draft';
        const visibleRemarks = reimbVisibleRemarks(r.remarks || '');
        const amt = parseFloat(r.amount) || 0;
        const amtStyle =
          amt > 0 ? 'color:var(--accent);font-weight:600' : amt < 0 ? 'color:var(--danger);font-weight:600' : '';
        const eligible = reimbursementSelectionEligible(r);
        const checked = selectedIds.has(Number(r.id));
        const cbAttrs = `${eligible ? '' : 'disabled'} ${checked ? 'checked' : ''}`.trim();
        const cbTitle = eligible
          ? '勾选用于合并生成付款单'
          : '已支付或已关联付款单的记录不可合并';
        const main = `<tr class="reimb-list-row${checked ? ' reimb-list-row--selected' : ''}" style="cursor:pointer" onclick="reimbursementRowClick(event, ${r.id})">
                    <td class="reimb-select-cell" onclick="event.stopPropagation()" style="width:36px;text-align:center">
                      <input type="checkbox" ${cbAttrs} title="${escapeHtml(cbTitle)}" onclick="event.stopPropagation();reimbursementToggleRowSelect(${r.id}, this.checked)">
                    </td>
                    <td>${escapeHtml(fmtDateShort(r.date))}</td>
                    <td>${escapeHtml(reimbPaymentTypeLabel(paymentType))}</td>
                    <td>${escapeHtml(reimbCostModuleLabel(costModule))}</td>
                    <td class="project-code reimbursement-list-code" title="${escapeHtml(r.related_project_code || '')}">${escapeHtml(r.related_project_code || '—')}</td>
                    <td>${m ? '<span class="badge badge-success">已计入</span>' : '—'}</td>
                    <td class="amount" style="text-align:left;${amtStyle}">${fmtMoney(r.amount)}</td>
                    <td><span class="badge ${reimbClaimStatusBadgeClass(claimStatus)}">${escapeHtml(reimbClaimStatusLabel(claimStatus))}</span></td>
                    <td>${paymentStatusHtml(r.payment_status, r.payment_order_id)}</td>
                    <td class="reimbursement-list-payee" title="${escapeHtml(r.payee_name || '')}">${escapeHtml(r.payee_name || '—')}</td>
                    <td class="reimbursement-list-remarks" title="${escapeHtml(visibleRemarks)}">${escapeHtml(visibleRemarks || '—')}</td>
                    <td onclick="event.stopPropagation()">
                      <div class="reimbursement-row-actions">
                      <button type="button" class="btn btn-secondary btn-sm" onclick="reimbursementEditById(${r.id})">编辑</button>
                      <button type="button" class="btn btn-danger btn-sm" onclick="deleteReimbursementRecord(${r.id})">删除</button>
                      </div>
                    </td>
                  </tr>`;
        return [main];
      })
      .join('');
  const unpaidReg = filtered.filter((r) => String(r.payment_status || 'unpaid').toLowerCase() !== 'paid');
  const paidReg = filtered.filter((r) => String(r.payment_status || 'unpaid').toLowerCase() === 'paid');
  const eligibleVisible = filtered.filter(reimbursementSelectionEligible);
  const allEligibleChecked =
    eligibleVisible.length > 0 && eligibleVisible.every((r) => selectedIds.has(Number(r.id)));
  const someEligibleChecked = eligibleVisible.some((r) => selectedIds.has(Number(r.id)));
  const headerSelectChecked = allEligibleChecked ? 'checked' : '';
  const headerSelectIndeterminate = !allEligibleChecked && someEligibleChecked;
  const canMerge = selectedCount >= 2;
  container.innerHTML = `
    <div class="reimbursement-page">
      <div class="page-toolbar reimbursement-toolbar">
        <div class="reimb-tool-group" role="tablist" aria-label="付款申请视图切换">
          <button type="button" class="btn reimb-tool-btn reimb-tool-btn--tab" role="tab" aria-selected="${view === 'registrations' ? 'true' : 'false'}" data-active="${view === 'registrations' ? 'true' : 'false'}" onclick="reimbursementPageState.view='registrations';reimbursementRenderListDom()">成本登记</button>
          <button type="button" class="btn reimb-tool-btn reimb-tool-btn--tab" role="tab" aria-selected="${view === 'payment_orders' ? 'true' : 'false'}" data-active="${view === 'payment_orders' ? 'true' : 'false'}" onclick="reimbursementPageState.view='payment_orders';reimbursementRenderListDom()">付款单</button>
        </div>
        <span class="reimb-tool-divider" aria-hidden="true"></span>
        <div class="reimb-tool-group reimb-tool-group--actions">
          <button type="button" class="btn reimb-tool-btn reimb-tool-btn--action" onclick="showReimbursementForm(null)">
            <i data-lucide="plus" class="reimb-tool-btn-icon" aria-hidden="true"></i>报销登记
          </button>
          <button type="button" class="btn reimb-tool-btn reimb-tool-btn--action" onclick="showCorporatePaymentTodo()">
            <i data-lucide="file-text" class="reimb-tool-btn-icon" aria-hidden="true"></i>付款申请
          </button>
          ${
            view === 'registrations'
              ? `<button type="button" class="btn reimb-tool-btn reimb-tool-btn--action" onclick="reimbursementMergeSelected()" ${canMerge ? '' : 'disabled'} title="${escapeHtml(canMerge ? '将选中的成本登记合并为一条新记录（原记录删除，付款仍走付款申请）' : '请至少勾选 2 条同收款方、同板块的未支付记录')}">
                  <i data-lucide="git-merge" class="reimb-tool-btn-icon" aria-hidden="true"></i>合并选中${selectedCount > 0 ? `（${selectedCount}）` : ''}
                </button>`
              : ''
          }
        </div>
        <input type="search" class="form-control" id="reimbListFilter" placeholder="筛选：品牌 / 项目编号 / 城市 / 备注 / 类型" style="max-width:360px;margin-left:auto"
          value="${fi}"
          oninput="reimbursementPageState.filterInput=this.value;reimbursementListFilterDebounced()">
      </div>
      <div id="reimbInlineHost" class="reimbursement-inline-host" hidden></div>
      <div class="reimbursement-list-panel">
        <div class="table-wrapper reimbursement-list-wrap">
            ${view === 'payment_orders' ? `
            <table class="data-table">
              <thead>
                <tr><th>付款单号</th><th>申请日期</th><th>付款日期</th><th>收款方</th><th style="text-align:left">金额</th><th>状态</th><th>明细数</th><th>备注</th><th>操作</th></tr>
              </thead>
              <tbody>${listRowsHtml}</tbody>
            </table>
            ` : `
            <table class="data-table reimbursement-registration-table reimbursement-table-compact">
              <thead>
                <tr>
                  <th class="reimb-select-cell" style="width:36px;text-align:center">
                    <input type="checkbox" id="reimbSelectAll" ${headerSelectChecked} ${eligibleVisible.length ? '' : 'disabled'} title="全选当前未支付记录" onclick="reimbursementToggleSelectAll(this.checked)">
                  </th>
                  <th>日期</th>
                  <th>申请类型</th>
                  <th>成本板块</th>
                  <th>项目编号</th>
                  <th>合并场次</th>
                  <th style="text-align:left">金额</th>
                  <th>状态</th>
                  <th>付款状态</th>
                  <th>收款方</th>
                  <th>备注</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${
                  !filtered.length
                    ? '<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:24px">暂无记录</td></tr>'
                    : `${unpaidReg.length ? `<tr><td colspan="12" style="padding:8px 12px;font-size:12px;font-weight:600;color:var(--text-secondary);background:var(--bg-input)">未支付 · ${unpaidReg.length} 笔（点击行展开明细）</td></tr>` : ''}
                ${registrationRowsHtml(unpaidReg)}
                ${paidReg.length ? `<tr><td colspan="12" style="padding:8px 12px;font-size:12px;font-weight:600;color:var(--text-secondary);background:var(--bg-input)">已支付 · ${paidReg.length} 笔</td></tr>` : ''}
                ${registrationRowsHtml(paidReg)}`
                }
              </tbody>
            </table>
            `}
        </div>
          ${
            view !== 'payment_orders' && !filtered.length
              ? '<div class="empty-state" style="padding:24px"><div class="empty-title">暂无付款申请记录</div></div>'
              : ''
          }
      </div>
    </div>
    `;
  renderLucideIcons();
  const headerCb = document.getElementById('reimbSelectAll');
  if (headerCb) headerCb.indeterminate = !!headerSelectIndeterminate;
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
    const [rows, acts, paymentOrders] = await Promise.all([
      api('GET', `/reimbursements${qs}`),
      api('GET', `/activities?yearFrameId=${currentYearFrameId}&sortBy=date&sortOrder=DESC&isVirtual=0`),
      api('GET', `/payment-orders${qs}`),
    ]);
    reimbursementPageState.rows = rows;
    reimbursementPageState.activities = acts;
    reimbursementPageState.paymentOrders = paymentOrders;
    if (reimbursementPageState.filterInput == null) reimbursementPageState.filterInput = '';
    const idSet = new Set((rows || []).map((r) => Number(r.id)).filter(Number.isFinite));
    reimbursementListExpanded = new Set([...reimbursementListExpanded].filter((id) => idSet.has(id)));
    reimbursementRenderListDom();
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message)}</div></div>`;
  }
}

async function reimbursementQuickExport(id) {
  try {
    const r = await api('GET', `/reimbursements/${id}`);
    const p = reimbursementPayloadFromRecord(r);
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
   页面：道具维修（品牌 + 明细项目 + 报价/成本 + 付款状态）
   ============================================= */
function propRepairRowHtml(r) {
  const noCost = r.no_cost === true || r.no_cost === 1 || String(r.no_cost) === '1';
  const payee = String(r.payee_name || '').trim();
  return `<tr>
    <td>${r.id}</td>
    <td>${escapeHtml(fmtDate(r.repair_date))}</td>
    <td><span class="badge badge-accent">${escapeHtml(String(r.region || '—'))}</span></td>
    <td><span class="badge badge-${brandColor(r.brand_code || r.brand_name)}">${escapeHtml(r.brand_name || r.brand_code || '—')}</span></td>
    <td class="amount amount-revenue" style="text-align:right">${fmtMoney(r.quoted_price || 0)}</td>
    <td class="amount" style="text-align:right">${noCost ? '无成本' : fmtMoney(r.total_amount)}</td>
    <td>${payee ? escapeHtml(payee) : '—'}</td>
    <td>${paymentStatusHtml(r.payment_status, r.payment_order_id)}</td>
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

    const listRows = rows || [];
    const listBody = listRows.length
      ? listRows.map((r) => propRepairRowHtml(r)).join('')
      : '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px">暂无记录</td></tr>';

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
            <div class="card-sub">明细金额自动汇总为维修成本（成本）；对公付款生成后状态为已支付</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select class="filter-select" id="prListBrandFilter" onchange="propRepairSetBrandFilter(this.value)">
              <option value="">全部品牌</option>${brandOpts}
            </select>
            <button type="button" class="btn btn-primary btn-sm" onclick="showPropRepairModal(null)">+ 新建登记</button>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>ID</th><th>日期</th><th>区域</th><th>品牌</th><th style="text-align:right">报价</th><th style="text-align:right">成本</th><th>收款方</th><th>付款状态</th><th>操作</th></tr></thead>
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
  const noCost = record && (record.no_cost === true || record.no_cost === 1 || String(record.no_cost) === '1');
  const quotedPrice = record && record.quoted_price != null ? roundMoney2(record.quoted_price).toFixed(2) : '';
  const prPaid = record && (String(record.payment_status || '').toLowerCase() === 'paid');

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
    <div class="form-group">
      <label class="form-label">收款方</label>
      <input type="text" class="form-control" id="prPayeeName" placeholder="用于对公付款合并" value="${escapeHtml((record && record.payee_name) || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">付款状态</label>
      <select class="form-control" id="prPaymentStatus">
        <option value="unpaid" ${!prPaid ? 'selected' : ''}>未支付</option>
        <option value="paid" ${prPaid ? 'selected' : ''}>已支付</option>
      </select>
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
    <div style="margin-top:12px;padding:12px;background:var(--accent-soft);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">
      <span style="color:var(--text-secondary)">成本（明细合计）</span>
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
  const no_cost = !!document.getElementById('prNoCost')?.checked;
  const payment_status = document.getElementById('prPaymentStatus')?.value === 'paid' ? 'paid' : 'unpaid';
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
    payee_name: document.getElementById('prPayeeName')?.value?.trim() || null,
    payment_status,
    items,
    no_cost: no_cost ? 1 : 0,
    activity_id: null,
    merged_into_activity: 0,
    allocation_note: null,
    remarks: null,
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
    .map((w) => `<option value="${w.id}" ${Number(w.id) === whId ? 'selected' : ''}>${escapeHtml(`${invWarehouseFullLabel(w)}${w.label && w.label !== `${w.region}仓库` ? ` · ${w.label}` : ''}`)}</option>`)
    .join('');
  body.innerHTML = `
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">目标仓库</label>
      <select class="form-control" id="invAddItemCatalogWarehouse" onchange="invOnAddItemCatalogWarehouseChange(this.value)">
        ${whOpts}
      </select>
    </div>
    <div class="form-hint" style="margin:0 0 10px">
      当前仓库：<strong>${escapeHtml(wh ? invWarehouseFullLabel(wh) : `#${whId}`)}</strong>。从目录选择物料加入仓库；数量可填 0，后续再调整。
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
  // X.O 的「北区/南区」是公司级跨品牌备货仓，单独显示 brand 时省略 X.O 前缀
  if (code === 'X.O' && (region === '北区' || region === '南区')) {
    return region;
  }
  return String(w?.brand_code || '').trim();
}

/**
 * 仓库统一展示标签：用于「品牌 · 区域」组合显示，所有 UI 位置保持一致
 *   X.O 北区 → 「北区仓库」
 *   X.O 南区 → 「南区仓库」
 *   其余 → 「{brand_code} {region}」
 * 入参可为 inv_warehouses 行或仅有 brand_code/region 字段的对象（如出库单 join 结果）。
 */
function invWarehouseFullLabel(w) {
  const code = String(w?.brand_code || '').trim();
  const region = String(w?.region || '').trim();
  if (code.toUpperCase() === 'X.O' && (region === '北区' || region === '南区')) {
    return `${region}仓库`;
  }
  if (!code && !region) return '—';
  if (!code) return region;
  if (!region) return code;
  return `${code} ${region}`;
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
    return '<div class="empty-state inv-wh-cards-empty">暂无仓库。点击右上「+ 新建仓库」开始添加（仅管理员）。</div>';
  }
  const orderedWarehouses = invReorderWarehouseCards(warehouses);
  const sid = selectedId != null ? Number(selectedId) : null;
  return `
    <div class="inv-warehouse-cards" role="list" aria-label="选择仓库">
      ${orderedWarehouses
        .map((w) => {
          const active = sid != null && Number(w.id) === sid;
          const label = w.label ? `<div class="inv-wh-card-label">${escapeHtml(w.label)}</div>` : '';
          const city = w.city ? `<div class="inv-wh-card-city" title="所在城市">${escapeHtml(w.city)}</div>` : '';
          return `
        <div class="inv-wh-card-wrap">
          <button type="button" class="inv-wh-card ${active ? 'active' : ''}" data-wh-id="${w.id}" onclick="invSelectWarehouse(${w.id})" role="listitem">
            <div class="inv-wh-card-brand">${escapeHtml(invWarehouseBrandDisplay(w))}</div>
            <div class="inv-wh-card-region">${escapeHtml(w.region)}</div>
            ${city}
            ${label}
          </button>
          <button type="button" class="inv-wh-card-edit inv-admin-only" title="编辑仓库" aria-label="编辑仓库" onclick="event.stopPropagation();invOpenWarehouseModal(${w.id})"><i data-lucide="pencil" aria-hidden="true"></i></button>
        </div>`;
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
            const city = w.city ? `<div class="inv-wh-card-city" title="所在城市">${escapeHtml(w.city)}</div>` : '';
            return `
        <div class="inv-wh-card-wrap">
          <button type="button" class="inv-wh-card ${active ? 'active' : ''}" data-wh-id="${w.id}" onclick="invSelectWarehouse(${w.id})" role="listitem">
            <div class="inv-wh-card-brand">${escapeHtml(invWarehouseBrandDisplay(w))}</div>
            <div class="inv-wh-card-region">${escapeHtml(w.region)}</div>
            ${city}
            ${label}
          </button>
          <button type="button" class="inv-wh-card-edit inv-admin-only" title="编辑仓库" aria-label="编辑仓库" onclick="event.stopPropagation();invOpenWarehouseModal(${w.id})"><i data-lucide="pencil" aria-hidden="true"></i></button>
        </div>`;
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

/** 新建/编辑仓库的弹窗状态（编辑模式时记录目标 id） */
let invWarehouseModalState = { id: null, brands: [] };

const INV_WAREHOUSE_REGION_OPTIONS = ['东区', '南区', '北区', '东南区'];

async function invOpenWarehouseModal(id) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可维护仓库', 'warning');
    return;
  }
  const targetId = Number.isFinite(parseInt(id, 10)) ? parseInt(id, 10) : null;
  invWarehouseModalState = { id: targetId, brands: [] };

  // 优先用前端 _brandCache，缺失则现拉
  let brands = Array.isArray(_brandCache) && _brandCache.length ? _brandCache : null;
  if (!brands) {
    try {
      brands = await api('GET', '/brand?active=true');
      _brandCache = Array.isArray(brands) ? brands : [];
    } catch (_) {
      brands = [];
    }
  }
  invWarehouseModalState.brands = Array.isArray(brands) ? brands : [];

  // 编辑模式：拉取当前仓库详情
  let current = null;
  if (targetId) {
    try {
      const all = await api('GET', '/inventory/warehouses');
      current = (Array.isArray(all) ? all : []).find((w) => Number(w.id) === targetId) || null;
    } catch (_) {
      current = null;
    }
    if (!current) {
      showToast('未找到该仓库', 'error');
      return;
    }
  }

  const titleEl = document.getElementById('invWhModalTitle');
  if (titleEl) titleEl.textContent = current ? `编辑仓库 #${current.id}` : '新建仓库';
  const submitBtn = document.getElementById('invWhModalSubmit');
  if (submitBtn) submitBtn.textContent = current ? '保存修改' : '创建仓库';

  const brandOptions = invWarehouseModalState.brands
    .map((b) => `<option value="${b.id}" ${current && Number(current.brand_id) === Number(b.id) ? 'selected' : ''}>${escapeHtml(b.brand_code || '')} ${escapeHtml(b.brand_name || '')}</option>`)
    .join('');
  const regionOptions = INV_WAREHOUSE_REGION_OPTIONS
    .map((r) => `<option value="${r}" ${current && current.region === r ? 'selected' : ''}>${r}</option>`)
    .join('');

  const body = document.getElementById('invWhModalBody');
  if (body) {
    body.innerHTML = `
      <div class="form-group">
        <label class="form-label" for="invWhLabel">仓库名称 <span class="form-hint" style="font-weight:normal">（显示在卡片底部，例如：布赫拉迪 全国总仓）</span></label>
        <input type="text" class="form-control" id="invWhLabel" maxlength="128" placeholder="可选；留空则只显示「品牌 区域」" value="${escapeHtml(current?.label || '')}">
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label" for="invWhBrand">品牌归属 <span class="required">*</span></label>
          <select class="form-control" id="invWhBrand">
            <option value="">请选择品牌</option>
            ${brandOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="invWhRegion">区域 <span class="required">*</span></label>
          <select class="form-control" id="invWhRegion">
            <option value="">请选择区域</option>
            ${regionOptions}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="invWhCity">仓库所在城市</label>
        <input type="text" class="form-control" id="invWhCity" maxlength="64" placeholder="例如：北京 / 上海 / 广州（用于后台检索）" value="${escapeHtml(current?.city || '')}">
      </div>
      <div class="form-group">
        <label class="form-label" for="invWhRemarks">备注 <span class="form-hint" style="font-weight:normal">（实际承载品牌、特殊用途等说明）</span></label>
        <textarea class="form-control" id="invWhRemarks" rows="3" maxlength="500" placeholder="例：南区仓库虽挂在 X.O 名下，实际大多承载 PHD 物料；物流计入品牌请在物流页面手动调整。">${escapeHtml(current?.remarks || '')}</textarea>
      </div>
      <p class="form-hint" style="margin:0;font-size:12px;line-height:1.5;color:var(--text-secondary)">
        ${current
          ? '编辑后会立即生效；同一品牌下区域 <strong>唯一</strong>，调整请避免与已有仓库冲突。'
          : '同一品牌下区域 <strong>唯一</strong>，不能与已有仓库重复。创建后可继续添加物料/酒品。'}
      </p>
    `;
  }
  openModal('modalInvWarehouse');
  renderLucideIcons();
}

async function invSubmitWarehouseModal() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可维护仓库', 'warning');
    return;
  }
  const brandIdRaw = document.getElementById('invWhBrand')?.value || '';
  const region = String(document.getElementById('invWhRegion')?.value || '').trim();
  const label = String(document.getElementById('invWhLabel')?.value || '').trim();
  const city = String(document.getElementById('invWhCity')?.value || '').trim();
  const remarks = String(document.getElementById('invWhRemarks')?.value || '').trim();
  const brandId = parseInt(brandIdRaw, 10);
  if (!Number.isFinite(brandId)) {
    showToast('请选择品牌', 'warning');
    return;
  }
  if (!region) {
    showToast('请选择区域', 'warning');
    return;
  }
  const payload = {
    brand_id: brandId,
    region,
    label: label || null,
    city: city || null,
    remarks: remarks || null,
  };
  const editId = invWarehouseModalState.id;
  try {
    if (editId) {
      await api('PUT', `/inventory/warehouses/${editId}`, payload);
      showToast('仓库已更新', 'success');
    } else {
      await api('POST', '/inventory/warehouses', payload);
      showToast('仓库已创建', 'success');
    }
    closeModal();
    invWarehouseModalState = { id: null, brands: [] };
    inventoryPageState.outboundWarehousesCache = [];
    await renderInventory();
  } catch (e) {
    showToast(e.message || (editId ? '更新失败' : '创建失败'), 'error');
  }
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
        const time = ln.inbound_recorded_at ? fmtDateTime(ln.inbound_recorded_at) : '—';
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
  of.shipped_at = g('invObShipDate')?.value ?? '';
  of.activity_date = g('invObActivityDate')?.value ?? '';
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
        warehouse: wh ? invWarehouseFullLabel(wh) : `仓库#${wid}`,
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

/** 从收件地址文本中猜测「收件城市」（直辖市 / 省+市 / 市开头） */
function invExtractCityFromChineseAddress(addr) {
  const s = String(addr || '').trim();
  if (!s) return '';
  const muni = [
    ['北京市', '北京'],
    ['上海市', '上海'],
    ['天津市', '天津'],
    ['重庆市', '重庆'],
  ];
  for (const [full, short] of muni) {
    if (s.startsWith(full)) return short;
    if (s.startsWith(short) && s.length > short.length && /[市区县省]/.test(s[short.length])) return short;
  }
  const mProv = s.match(/^([\u4e00-\u9fa5]{2,8}省)([\u4e00-\u9fa5]{2,12}市)/);
  if (mProv) return mProv[2].replace(/市$/, '') || mProv[2];
  const mCity = s.match(/^([\u4e00-\u9fa5]{2,14}市)/);
  if (mCity) return mCity[1].replace(/市$/, '') || mCity[1];
  return '';
}

function invStripUsedCityPrefixFromAddress(addr, cityShort) {
  const s = String(addr || '').trim();
  const c = String(cityShort || '').trim();
  if (!s || !c) return s;
  const muniFull = { 北京: '北京市', 上海: '上海市', 天津: '天津市', 重庆: '重庆市' };
  const prefixes = [];
  if (muniFull[c]) prefixes.push(muniFull[c]);
  prefixes.push(c.endsWith('市') ? c : `${c}市`, c);
  let rest = s;
  for (const p of prefixes) {
    if (p && rest.startsWith(p)) {
      rest = rest.slice(p.length).replace(/^[，,、\s]+/, '');
      return rest || s;
    }
  }
  const m = s.match(/^[\u4e00-\u9fa5]{2,8}省([\u4e00-\u9fa5]{2,12}市)/);
  if (m && c && (m[1] === `${c}市` || m[1].startsWith(c))) {
    rest = s.slice(m[0].length).replace(/^[，,、\s]+/, '');
    return rest || s;
  }
  return s;
}

/**
 * 智能填写解析：从一段任意顺序/格式的文本中识别出 { name, phone, address, city }。
 *
 * 设计目标：兼容用户从淘宝/京东/微信/聊天记录复制的多种顺序与噪声格式。
 *  - 11 位手机号（1[3-9]xxxxxxxxx）优先识别；其次 7-12 位带分隔符的固话
 *  - "姓名 + 公司"用以下启发式分辨：2-8 位纯中文 / 英文人名 / 含「公司/有限/集团/工作室」等
 *  - 「地址」候选：含「省/市/区/县/镇/街/道/路/弄/巷/号/楼/层/室/苑/园/栋/单元/大厦/广场/花园/小区」等关键字
 *    或长度 ≥ 8 的兜底
 *  - 噪声标签自动去除：「收件人」「电话」「地址」「联系人」「Tel」「Phone」「Address」等前后缀
 *
 * 不依赖姓名 → 电话 → 地址的固定顺序；多行/单行/逗号分隔均可处理。
 */
function invParseOutboundRecipientPaste(raw) {
  const text0 = String(raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/[\t\f\v]/g, ' ')
    .trim();
  if (!text0) return { name: '', phone: '', address: '', city: '' };

  // 去掉常见字段标签前缀（不影响内容）：将 "收件人：xxx" 中的 "收件人：" 直接抹掉
  const labelRe = /(收件人|发件人|联系人|姓名|客户|电话|手机|联系电话|联系方式|tel|phone|地址|收货地址|收件地址|address)\s*[:：]\s*/gi;
  const cleaned = text0.replace(labelRe, ' ');

  // 1) 抽取手机号 / 固话
  const mobileRe = /1[3-9]\d{9}/g;
  const landlineRe = /\b\d{3,4}[-\s]?\d{7,8}\b/g;
  let phone = '';
  const mobs = cleaned.match(mobileRe);
  if (mobs && mobs.length) {
    phone = mobs[0];
  } else {
    const lls = cleaned.match(landlineRe);
    if (lls && lls.length) phone = lls[0].replace(/[\s-]/g, '');
  }

  // 2) 把所有手机号 / 固话从文本中移除（统一变空格）
  const withoutPhone = cleaned
    .replace(mobileRe, ' ')
    .replace(landlineRe, ' ')
    .replace(/[，,;；、|｜]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 3) 切片：按空白分；保留每个 token
  const tokens = withoutPhone.split(/\s+/).filter(Boolean);

  // 4) 分类判定
  const addrKeywordRe = /(省|市|区|县|镇|乡|村|街道|大道|街|路|弄|巷|号|楼|层|室|栋|苑|园|单元|大厦|广场|花园|公寓|小区|商业|开发区|新区|工业园|科技园|路口|站)/;
  const companyRe = /(公司|集团|有限|股份|工厂|工作室|事务所|商行|商贸|餐厅|酒店|店|铺|超市|药房|医院|学校|大学|中学|小学|大酒店|分公司|总公司)/;
  const purelyChineseNameRe = /^[\u4e00-\u9fa5·•．\.]{2,6}$/;
  const englishNameRe = /^[A-Za-z][A-Za-z\.\-]{0,20}(\s+[A-Za-z][A-Za-z\.\-]{0,20}){0,3}$/;

  const addrParts = [];
  const nameParts = [];
  const unknownParts = [];

  for (const tok of tokens) {
    if (!tok) continue;
    // 含地址关键字 → 地址
    if (addrKeywordRe.test(tok)) {
      addrParts.push(tok);
      continue;
    }
    // 含数字（如 "45-7" "1号" "6层"）但无地址关键字 → 倾向地址兜底
    if (/\d/.test(tok) && tok.length >= 2) {
      // 但纯数字小段（如门牌 "12"）单独可能是姓名前的编号，仍归地址
      addrParts.push(tok);
      continue;
    }
    // 公司名 → 姓名（作为收件单位）
    if (companyRe.test(tok)) {
      nameParts.push(tok);
      continue;
    }
    // 2-6 字纯中文 → 姓名
    if (purelyChineseNameRe.test(tok)) {
      nameParts.push(tok);
      continue;
    }
    // 英文姓名（首字母大写）→ 姓名
    if (englishNameRe.test(tok) && tok.length <= 24) {
      nameParts.push(tok);
      continue;
    }
    // 长 token（≥8）兜底为地址
    if (tok.length >= 8) {
      addrParts.push(tok);
      continue;
    }
    unknownParts.push(tok);
  }

  // 兜底 1：没有地址命中，但 unknown 里有长字符串 → 当作地址
  if (!addrParts.length) {
    for (let i = unknownParts.length - 1; i >= 0; i--) {
      if (unknownParts[i].length >= 4) {
        addrParts.unshift(unknownParts.splice(i, 1)[0]);
      }
    }
  }
  // 剩余 unknown 进入 name
  for (const u of unknownParts) nameParts.push(u);

  // 兜底 2：完全没识别出 name，但 address 里包含明显的人名子串（首段 2-4 字中文 + 后续大量地址关键字）
  if (!nameParts.length && addrParts.length) {
    const first = addrParts[0];
    const m = first.match(/^([\u4e00-\u9fa5]{2,4})(?=[\u4e00-\u9fa5]*(省|市|区|县|镇))/);
    if (m && !addrKeywordRe.test(m[1])) {
      nameParts.push(m[1]);
      addrParts[0] = first.slice(m[1].length).trim();
      if (!addrParts[0]) addrParts.shift();
    }
  }

  let name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
  let address = addrParts.join(' ').replace(/\s+/g, ' ').trim();
  const city = invExtractCityFromChineseAddress(address);
  const addrNorm = invStripUsedCityPrefixFromAddress(address, city);
  return {
    name,
    phone,
    city,
    address: (addrNorm || address).trim(),
  };
}

function invOpenOutboundSmartFill() {
  const ta = document.getElementById('invObSmartFillPaste');
  if (ta) ta.value = '';
  openModal('modalInvObSmartFill');
}

function invApplyOutboundSmartFill() {
  const ta = document.getElementById('invObSmartFillPaste');
  const { name, phone, address, city } = invParseOutboundRecipientPaste(ta?.value || '');
  const nEl = document.getElementById('invContactName');
  const pEl = document.getElementById('invContactPhone');
  const aEl = document.getElementById('invRecvAddr');
  const cEl = document.getElementById('invRecvCity');
  if (nEl) nEl.value = name;
  if (pEl) pEl.value = phone;
  if (aEl) aEl.value = address;
  if (cEl && city) cEl.value = city;
  closeModal();
  showToast(city ? '已填入（已识别收件城市）' : '已填入', 'success');
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
          (w) => `<button type="button" class="btn btn-sm inv-ob-wh-btn ${w.id === inventoryPageState.warehouseId ? 'btn-primary' : 'btn-secondary'}" data-wh-id="${w.id}" title="brand_id=${w.brand_id || ''} ${escapeHtml(w.brand_code || '')} / ${escapeHtml(w.region || '')}" onclick="invOnModalWarehouseChange(${w.id})">${escapeHtml(invWarehouseFullLabel(w))}</button>`,
        )
        .join('')}
    </div>`;
  const linkMode = of.linkMode === 'standalone' ? 'standalone' : 'activity';
  const whKey = String(Number(inventoryPageState.warehouseId || 0) || 'global');
  const commonSearch = String((inventoryPageState.outboundCommonSearchByWarehouse || {})[whKey] || '');
  const listFlt = inventoryPageState.outboundListFilter || 'common';
  const hintMsg = String(of.hint_msg || '').trim();
  const shipDateOut = String(of.shipped_at || '').trim() || todayDateInputValue();
  const activityDateOut = String(of.activity_date || '').trim();
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
            <div class="inv-ob-modal-row inv-ob-row-recv">
              <div class="form-group inv-ob-field-short">
                <label class="form-label">出库日期</label>
                <input type="date" class="form-control" id="invObShipDate" value="${escapeHtml(shipDateOut)}">
              </div>
              <div class="form-group inv-ob-field-short">
                <label class="form-label" title="关联活动的真实活动日期；非活动出库可留空">活动日期</label>
                <input type="date" class="form-control" id="invObActivityDate" value="${escapeHtml(activityDateOut)}" placeholder="可留空">
              </div>
              <div class="form-group inv-ob-field-short">
                <label class="form-label">收件城市</label>
                <input type="text" class="form-control" id="invRecvCity" value="${escapeHtml(of.recipient_city || '')}">
              </div>
            </div>
            <div class="inv-ob-modal-row inv-ob-row-addr">
              <div class="form-group inv-ob-field-short">
                <label class="form-label">联系人</label>
                <input type="text" class="form-control" id="invContactName" value="${escapeHtml(of.contact_name || '')}">
              </div>
              <div class="form-group inv-ob-field-short">
                <label class="form-label">联系电话</label>
                <input type="text" class="form-control" id="invContactPhone" value="${escapeHtml(of.contact_phone || '')}">
              </div>
              <div class="form-group inv-ob-field-full inv-ob-field-addr-grow">
                <label class="form-label">收件地址</label>
                <input type="text" class="form-control" id="invRecvAddr" value="${escapeHtml(of.recipient_address || '')}">
              </div>
              <div class="form-group inv-ob-smartfill-btn-wrap">
                <label class="form-label">智能填写</label>
                <button type="button" class="btn btn-secondary btn-sm" onclick="invOpenOutboundSmartFill()">智能填写</button>
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
      shipped_at: '',
      activity_date: '',
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
      shipped_at: '',
      activity_date: '',
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

/**
 * 物品出库台账本地过滤：按搜索词在多个字段（包括 items_summary 物品名摘要）做不区分大小写包含匹配。
 * 支持多关键字（用空格分隔为 AND 关系），便于同时锁定"品鉴杯 北京"等场景。
 */
function invFilterOutboundOrders(orders, query) {
  const arr = Array.isArray(orders) ? orders : [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return arr;
  const terms = q.split(/\s+/).filter(Boolean);
  return arr.filter((o) => {
    const blob = [
      o.items_summary,
      o.project_code,
      o.purpose,
      o.contact_name,
      o.contact_phone,
      o.tracking_number,
      o.logistics_method,
      o.recipient_city,
      o.recipient_address,
      o.brand_code,
      o.region,
      o.remarks,
      invWarehouseFullLabel(o),
      invBusinessYmd(o.shipped_at),
      `#${o.id}`,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return terms.every((t) => blob.includes(t));
  });
}

function invOutboundMonthKeys(orders) {
  const set = new Set();
  (orders || []).forEach((o) => {
    const ymd = invBusinessYmd(o.shipped_at || o.created_at);
    if (ymd) set.add(ymd.slice(0, 7));
  });
  return [...set].sort().reverse();
}

function invFilterOutboundByMonth(orders, monthKey) {
  if (!monthKey || monthKey === 'all') return orders;
  return (orders || []).filter((o) => {
    const d = o.shipped_at || o.created_at || '';
    return String(d).slice(0, 7) === monthKey;
  });
}

function invRenderOutboundMonthButtons(keys, selected) {
  return invRenderInvMonthBar(keys, selected, 'invSetOutboundMonth');
}

function invRenderInvMonthBar(keys, selected, setterFn) {
  const allActive = selected === 'all';
  const allBtn = `<button type="button" class="btn btn-secondary btn-sm${allActive ? ' inv-ob-month-active' : ''}" onclick="${setterFn}('all')">全部</button>`;
  const monthBtns = (keys || []).map((k) => {
    const [y, m] = k.split('-');
    const active = selected === k;
    return `<button type="button" class="btn btn-secondary btn-sm${active ? ' inv-ob-month-active' : ''}" onclick="${setterFn}('${k}')">${y}年${parseInt(m, 10)}月</button>`;
  }).join('');
  return `<div class="inv-ob-month-bar">${allBtn}${monthBtns}</div>`;
}

function invInboundLedgerDateKey(row) {
  const ymd = invBusinessYmd(row.return_date || row.inbound_date || row.created_at);
  return ymd ? ymd.slice(0, 7) : '';
}

function invInboundPendingDateKey(row) {
  const ymd = invBusinessYmd(row.shipped_at || row.created_at);
  return ymd ? ymd.slice(0, 7) : '';
}

function invMonthKeysFromRows(rows, dateKeyFn) {
  const set = new Set();
  (rows || []).forEach((r) => {
    const k = dateKeyFn(r);
    if (k) set.add(k);
  });
  return [...set].sort().reverse();
}

function invFilterRowsByMonth(rows, monthKey, dateKeyFn) {
  if (!monthKey || monthKey === 'all') return rows || [];
  return (rows || []).filter((r) => dateKeyFn(r) === monthKey);
}

function invPaginateSlice(rows, page, pageSize) {
  const total = (rows || []).length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const p = Math.min(Math.max(1, page), totalPages);
  const start = (p - 1) * pageSize;
  return { rows: (rows || []).slice(start, start + pageSize), page: p, totalPages, total };
}

function invSetInboundLedgerMonth(key) {
  inventoryPageState.inboundLedgerMonthFilter = key || 'all';
  inventoryPageState.inboundLedgerPage = 1;
  invRefreshInboundLedgerSection();
}

function invGoInboundLedgerPage(page) {
  inventoryPageState.inboundLedgerPage = page;
  invRefreshInboundLedgerSection();
}

function invSetInboundPendingMonth(key) {
  inventoryPageState.inboundPendingMonthFilter = key || 'all';
  inventoryPageState.inboundPendingPage = 1;
  invRefreshInboundPendingSection();
}

function invGoInboundPendingPage(page) {
  inventoryPageState.inboundPendingPage = page;
  invRefreshInboundPendingSection();
}

function invRefreshInboundLedgerSection() {
  const host = document.getElementById('invInboundLedgerHost');
  if (host) host.innerHTML = invRenderInboundLedgerHostContent();
  const bar = document.getElementById('invInboundLedgerMonthBar');
  if (bar) {
    const keys = invMonthKeysFromRows(inventoryPageState._inboundLedgerCache, invInboundLedgerDateKey);
    if (
      inventoryPageState.inboundLedgerMonthFilter !== 'all' &&
      !keys.includes(inventoryPageState.inboundLedgerMonthFilter)
    ) {
      inventoryPageState.inboundLedgerMonthFilter = 'all';
    }
    bar.innerHTML = invRenderInvMonthBar(keys, inventoryPageState.inboundLedgerMonthFilter, 'invSetInboundLedgerMonth');
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function invRefreshInboundPendingSection() {
  const host = document.getElementById('invInboundPendingHost');
  if (host) host.innerHTML = invRenderInboundPendingHostContent();
  const bar = document.getElementById('invInboundPendingMonthBar');
  if (bar) {
    const keys = invMonthKeysFromRows(inventoryPageState._inboundPendingCache, invInboundPendingDateKey);
    if (
      inventoryPageState.inboundPendingMonthFilter !== 'all' &&
      !keys.includes(inventoryPageState.inboundPendingMonthFilter)
    ) {
      inventoryPageState.inboundPendingMonthFilter = 'all';
    }
    bar.innerHTML = invRenderInvMonthBar(keys, inventoryPageState.inboundPendingMonthFilter, 'invSetInboundPendingMonth');
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function invRefreshOutboundTable() {
  const host = document.getElementById('invObTableHost');
  if (!host) return;
  const cache = Array.isArray(inventoryPageState._outboundListCache) ? inventoryPageState._outboundListCache : [];
  const byMonth = invFilterOutboundByMonth(cache, inventoryPageState.outboundMonthFilter);
  const filtered = invFilterOutboundOrders(byMonth, inventoryPageState.outboundSearch);
  host.innerHTML = invRenderOutboundOrderTable(filtered, {
    total: cache.length,
    filtered: filtered.length,
    search: inventoryPageState.outboundSearch,
  });
  const bar = document.getElementById('invObMonthBar');
  if (bar) {
    const keys = invOutboundMonthKeys(cache);
    bar.innerHTML = invRenderOutboundMonthButtons(keys, inventoryPageState.outboundMonthFilter);
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function invOnOutboundSearchInput(value) {
  const v = String(value == null ? '' : value);
  inventoryPageState.outboundSearch = v;
  const input = document.getElementById('invOutboundSearch');
  if (input && input.value !== v) input.value = v;
  invRefreshOutboundTable();
  const headActions = document.querySelector('.inv-out-page-head-actions .inv-ob-search');
  if (headActions) {
    const existed = headActions.querySelector('.inv-ob-search-clear');
    if (v && !existed) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inv-ob-search-clear';
      btn.setAttribute('aria-label', '清除搜索');
      btn.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
      btn.addEventListener('click', () => invOnOutboundSearchInput(''));
      headActions.appendChild(btn);
    } else if (!v && existed) {
      existed.remove();
    }
  }
  renderLucideIcons();
}

function invRenderOutboundOrderTable(orders, opts) {
  opts = opts || {};
  const q = String(opts.search || '').trim();
  if (!orders.length) {
    if (q) {
      return `<div class="empty-state" style="margin-top:8px">没有匹配「${escapeHtml(q)}」的出库单（当前年度共 ${Number(opts.total) || 0} 条）。</div>`;
    }
    return '<div class="empty-state" style="margin-top:8px">暂无物品出库记录，可点击「新建出库」创建。</div>';
  }
  const hintHtml = q
    ? `<div class="inv-ob-search-result-hint">已筛选出 <strong>${orders.length}</strong> / ${Number(opts.total) || orders.length} 条匹配「${escapeHtml(q)}」</div>`
    : '';
  return `
    ${hintHtml}
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
              const shipDate = o.shipped_at ? fmtDate(o.shipped_at) : '—';
              const st = String(o.status || '').toLowerCase();
              const statusHtml =
                st === 'closed'
                  ? '<span class="badge badge-success">已归还</span>'
                  : '<span class="badge badge-warning">出库中</span>';
              const itemsSummary = String(o.items_summary || '').trim();
              const trTitle = itemsSummary ? ` title="${escapeHtml(itemsSummary)}"` : '';
              return `<tr${trTitle}>
            <td>${shipDate}</td>
            <td>${proj}</td>
            <td>${escapeHtml(o.logistics_method || '—')}</td>
            <td>${
              o.tracking_number
                ? `<a href="https://www.sf-express.com/cn/sc/dynamic_function/waybill/#search/bill-number/${encodeURIComponent(String(o.tracking_number))}" target="_blank" style="color:var(--accent);font-family:monospace;font-size:12px">${escapeHtml(o.tracking_number)}</a>`
                : '<span style="color:var(--text-muted)">—</span>'
            }</td>
            <td title="${escapeHtml((o.brand_code || '') + ' / ' + (o.region || ''))}">${escapeHtml(invWarehouseFullLabel(o))}</td>
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

function invRenderInboundLedgerTableRows(rows) {
  return (rows || [])
    .map((r) => {
      const isDirect = r._kind === 'direct';
      const main = escapeHtml(r.display_main || '—');
      const sub = !isDirect && r.display_sub
        ? `<div class="inv-inbound-ledger-sub">${escapeHtml(r.display_sub)}</div>`
        : '';
      const rem = r.batch_remarks != null ? String(r.batch_remarks) : '';
      const remShort = rem.length > 40 ? `${rem.slice(0, 40)}…` : rem;
      const sourceCol = isDirect ? (r.source ? escapeHtml(r.source) : '—') : '—';
      const sum = isDirect
        ? `入库 ×${r._qty || 0}`
        : `归${r.sum_qty_return} 空${r.sum_qty_empty_recovered} 留${r.sum_qty_customer_keep} 丢${r.sum_qty_lost} 损${r.sum_qty_damaged}`;
      const detailBtn = isDirect
        ? `<div class="inv-row-actions">
            <button type="button" class="btn btn-xs btn-secondary" onclick="invOpenInboundEditModal(${r.batch_id})">编辑</button>
            <button type="button" class="btn btn-xs btn-danger" onclick="invDeleteInboundRecord(${r.batch_id})" title="删除并回退库存">删除</button>
          </div>`
        : `<button type="button" class="btn btn-xs btn-secondary" onclick="invOpenInboundReceiptDetail(${r.batch_id})">详情</button>`;
      const inboundSummary = String(r.items_summary || '').trim();
      const trTitle = inboundSummary ? ` title="${escapeHtml(inboundSummary)}"` : '';
      return `<tr${trTitle}>
      <td>${r.return_date ? escapeHtml(fmtDate(r.return_date)) : '—'}</td>
      <td><div class="inv-inbound-ledger-main">${main}</div>${sub}</td>
      <td>${escapeHtml(r.brand_code)} ${escapeHtml(r.region)}</td>
      <td style="font-size:12px;color:var(--text-secondary)">${sourceCol}</td>
      <td>${escapeHtml(r.operator || '—')}</td>
      <td style="font-size:12px;color:var(--text-secondary);white-space:nowrap">${sum}</td>
      <td style="max-width:160px;font-size:12px;color:var(--text-muted)" title="${escapeHtml(rem)}">${escapeHtml(remShort || '—')}</td>
      <td>${detailBtn}</td>
    </tr>`;
    })
    .join('');
}

function invRenderInboundLedgerTableOnly(rows) {
  return `
    <div class="table-wrapper inv-inbound-ledger-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>入库日期</th>
            <th>关联项目 / 用途</th>
            <th>仓库</th>
            <th>入库来源</th>
            <th>登记人</th>
            <th>汇总</th>
            <th>备注</th>
            <th style="min-width:72px"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? invRenderInboundLedgerTableRows(rows) : '<tr><td colspan="8" style="color:var(--text-muted)">暂无已入库记录</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function invRenderInboundLedgerHostContent() {
  const cache = inventoryPageState._inboundLedgerCache || [];
  const filtered = invFilterRowsByMonth(cache, inventoryPageState.inboundLedgerMonthFilter, invInboundLedgerDateKey);
  const pag = invPaginateSlice(filtered, inventoryPageState.inboundLedgerPage || 1, INV_INBOUND_PAGE_SIZE);
  inventoryPageState.inboundLedgerPage = pag.page;
  const batchCount = filtered.filter((r) => r && r._kind !== 'direct').length;
  const directCount = filtered.filter((r) => r && r._kind === 'direct').length;
  const monthHint =
    inventoryPageState.inboundLedgerMonthFilter !== 'all'
      ? ` · 月份 ${inventoryPageState.inboundLedgerMonthFilter}`
      : '';
  const summaryLine = `<div class="inv-inbound-summary">当前筛选共 <strong>${pag.total}</strong> 条 · 归还入库 ${batchCount} 条 · 直接入库 ${directCount} 条${monthHint} · 每页 ${INV_INBOUND_PAGE_SIZE} 条</div>`;
  if (!pag.total) {
    return `${summaryLine}<div class="empty-state" style="margin-top:8px">暂无已入库记录，可调整月份或左侧年度查看。</div>`;
  }
  return `${summaryLine}${invRenderInboundLedgerTableOnly(pag.rows)}${renderPagination(pag.page, pag.totalPages, pag.total, 'invGoInboundLedgerPage')}`;
}

function invRenderInboundPendingTableRows(orders) {
  return (orders || [])
    .map((o) => {
      const cityRaw = String(o.activity_city || o.recipient_city || '').trim();
      const cityCell = cityRaw ? escapeHtml(cityRaw) : '—';
      const projLine =
        o.link_mode === 'standalone'
          ? escapeHtml(o.purpose || '—')
          : escapeHtml(o.project_code || '—');
      const pendingSummary = String(o.items_summary || '').trim();
      const trTitle = pendingSummary ? ` title="${escapeHtml(pendingSummary)}"` : '';
      return `
      <tr${trTitle}>
        <td>#${o.id}</td>
        <td title="${escapeHtml((o.brand_code || '') + ' / ' + (o.region || ''))}">${escapeHtml(invWarehouseFullLabel(o))}</td>
        <td>${cityCell}</td>
        <td>${projLine}</td>
        <td>${o.shipped_at ? escapeHtml(fmtDate(o.shipped_at)) : '—'}</td>
        <td>
          <button type="button" class="btn btn-sm btn-primary" onclick="invOpenReturn(${o.id})">归还登记</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="invDownloadPdf(${o.id})">PDF</button>
        </td>
      </tr>`;
    })
    .join('');
}

function invRenderInboundPendingHostContent() {
  const cache = inventoryPageState._inboundPendingCache || [];
  const filtered = invFilterRowsByMonth(cache, inventoryPageState.inboundPendingMonthFilter, invInboundPendingDateKey);
  const pag = invPaginateSlice(filtered, inventoryPageState.inboundPendingPage || 1, INV_INBOUND_PAGE_SIZE);
  inventoryPageState.inboundPendingPage = pag.page;
  const monthHint =
    inventoryPageState.inboundPendingMonthFilter !== 'all'
      ? ` · 月份 ${inventoryPageState.inboundPendingMonthFilter}`
      : '';
  const summaryLine = `<div class="inv-inbound-summary">当前筛选共 <strong>${pag.total}</strong> 条${monthHint} · 每页 ${INV_INBOUND_PAGE_SIZE} 条</div>`;
  if (!pag.total) {
    return `${summaryLine}<div class="empty-state" style="margin-top:8px">暂无待入库单据，可调整月份筛选。</div>`;
  }
  return `${summaryLine}
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>单号</th><th>品牌/区</th><th>城市</th><th>项目编号 / 场次</th><th>出库时间</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${invRenderInboundPendingTableRows(pag.rows)}
        </tbody>
      </table>
    </div>
    ${renderPagination(pag.page, pag.totalPages, pag.total, 'invGoInboundPendingPage')}`;
}

function invRenderInboundLedgerTable(rows) {
  return invRenderInboundLedgerTableOnly(rows);
}


async function invOpenInboundReceiptDetail(batchId) {
  const titleEl = document.getElementById('modalInvInboundTitle');
  const body = document.getElementById('modalInvInboundReceiptBody');
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
            <input class="form-control" value="${h.return_date ? escapeHtml(fmtDate(h.return_date)) : '—'}" readonly>
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
            <div class="inv-ob-detail-head">出库单 #${ord.id} · ${ord.shipped_at ? String(ord.shipped_at).slice(0, 16) : '—'} · ${escapeHtml(invWarehouseFullLabel(ord))} · ${ord.status === 'closed' ? '已结清' : '待归还'}</div>
            <div class="activity-detail-grid" style="margin-bottom:12px">
              <section class="activity-detail-card">
                <h4>基础信息</h4>
                ${activityDetailRow('关联方式', ord.link_mode === 'standalone' ? '非项目出库' : '项目编号')}
                ${activityDetailRow(ord.link_mode === 'standalone' ? '用途说明' : '项目编号', ord.link_mode === 'standalone' ? (ord.purpose || '—') : (ord.project_code || '—'))}
                ${activityDetailRow('发货仓', invWarehouseFullLabel(ord))}
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
    of.shipped_at = o.shipped_at ? toDateInputValue(o.shipped_at) : todayDateInputValue();
    // 编辑回填优先用单据上保存的 activity_date；
    // 若旧单没填则取关联活动日期 activity_date_link 作为默认值（保存后会固化到出库单上）。
    {
      const ownActDate = o.activity_date != null && String(o.activity_date).trim() ? String(o.activity_date).slice(0, 10) : '';
      const linkActDate = o.activity_date_link != null && String(o.activity_date_link).trim() ? String(o.activity_date_link).slice(0, 10) : '';
      of.activity_date = ownActDate || linkActDate || '';
    }
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
    const resp = await api('DELETE', `/inventory/outbound/${orderId}`);
    const cleaned = Number((resp && resp.cleaned_logistics) || 0);
    if (cleaned > 0) {
      showToast(`已删除出库单，并联动清理 ${cleaned} 条物流成本`, 'success');
    } else {
      showToast('已删除', 'success');
    }
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
    inventoryPageState._outboundListCache = Array.isArray(allOrders) ? allOrders : [];
    const obMonthKeys = invOutboundMonthKeys(inventoryPageState._outboundListCache);
    if (inventoryPageState.outboundMonthFilter !== 'all' && !obMonthKeys.includes(inventoryPageState.outboundMonthFilter)) {
      inventoryPageState.outboundMonthFilter = 'all';
    }
    const byMonth = invFilterOutboundByMonth(inventoryPageState._outboundListCache, inventoryPageState.outboundMonthFilter);
    const filteredOrders = invFilterOutboundOrders(byMonth, inventoryPageState.outboundSearch);
    panelHtml = `${inlineFormHtml}<div id="invObMonthBar">${invRenderOutboundMonthButtons(obMonthKeys, inventoryPageState.outboundMonthFilter)}</div><div id="invObTableHost">${invRenderOutboundOrderTable(filteredOrders, {
      total: inventoryPageState._outboundListCache.length,
      filtered: filteredOrders.length,
      search: inventoryPageState.outboundSearch,
    })}</div>`;
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
    let directInbound = [];
    try {
      const direct = await api('GET', '/inventory/inbound');
      const arr = Array.isArray(direct?.data) ? direct.data : (Array.isArray(direct) ? direct : []);
      directInbound = arr.map((r) => {
        const nm = String(r.item_name || '—');
        const dim = String(r.item_dimensions || '').trim();
        const qty = Number(r.quantity || 0);
        const summary = dim ? `${nm} ×${qty} ${dim}` : `${nm} ×${qty}`;
        return {
          batch_id: r.id,
          _kind: 'direct',
          _qty: qty,
          return_date: r.inbound_date || r.created_at,
          inbound_date: r.inbound_date || '',
          display_main: dim ? `${nm} — ${dim}` : nm,
          items_summary: summary,
          brand_code: r.brand_code || '—',
          region: r.region || '—',
          operator: r.operator || '—',
          batch_remarks: r.remarks || '',
          source: r.source || null,
        };
      });
      inventoryPageState.inboundDirectRows = directInbound;
    } catch (_) {
      directInbound = [];
      inventoryPageState.inboundDirectRows = [];
    }
    const ledgerArr = [
      ...(Array.isArray(inboundLedger) ? inboundLedger : []),
      ...directInbound,
    ].sort((a, b) => {
      const da = invBusinessYmd(a.return_date || a.inbound_date || a.created_at);
      const db = invBusinessYmd(b.return_date || b.inbound_date || b.created_at);
      return db.localeCompare(da);
    });
    inventoryPageState._inboundLedgerCache = ledgerArr;
    inventoryPageState._inboundPendingCache = Array.isArray(openOrders) ? openOrders : [];
    const ledgerMonthKeys = invMonthKeysFromRows(inventoryPageState._inboundLedgerCache, invInboundLedgerDateKey);
    const pendingMonthKeys = invMonthKeysFromRows(inventoryPageState._inboundPendingCache, invInboundPendingDateKey);
    if (
      inventoryPageState.inboundLedgerMonthFilter !== 'all' &&
      !ledgerMonthKeys.includes(inventoryPageState.inboundLedgerMonthFilter)
    ) {
      inventoryPageState.inboundLedgerMonthFilter = 'all';
    }
    if (
      inventoryPageState.inboundPendingMonthFilter !== 'all' &&
      !pendingMonthKeys.includes(inventoryPageState.inboundPendingMonthFilter)
    ) {
      inventoryPageState.inboundPendingMonthFilter = 'all';
    }
    panelHtml = `
      <div class="inv-inbound-section">
        <div id="invInboundLedgerHost">${invRenderInboundLedgerHostContent()}</div>
      </div>
      <div class="inv-inbound-divider" role="separator" aria-hidden="true"></div>
      <div class="inv-inbound-section">
        <div class="inv-inbound-section-head">
          <h4 class="inv-inbound-section-title">待入库</h4>
          <div id="invInboundPendingMonthBar">${invRenderInvMonthBar(pendingMonthKeys, inventoryPageState.inboundPendingMonthFilter, 'invSetInboundPendingMonth')}</div>
        </div>
        <div id="invInboundPendingHost">${invRenderInboundPendingHostContent()}</div>
      </div>`;
  }

  const masterToolbarWh = `
    <div class="inv-master-warehouse-block">
      ${invRenderStockMasterCardsHtml(warehouses, inventoryPageState.warehouseId, inventoryPageState.stockMasterView)}
    </div>
    <div class="inv-toolbar inv-toolbar-master">
      <button type="button" class="btn btn-secondary btn-sm inv-admin-only" onclick="invOpenWarehouseModal()">+ 新建仓库</button>
      <button type="button" class="btn btn-primary btn-sm inv-admin-only" onclick="invOpenNewItemModal()" ${inventoryPageState.warehouseId ? '' : 'disabled'}>添加物料</button>
      <button type="button" class="btn btn-secondary btn-sm inv-admin-only" onclick="invOpenAddItemCatalogModal()" ${inventoryPageState.warehouseId ? '' : 'disabled'}>物品目录</button>
      <button type="button" class="btn btn-secondary btn-sm inv-admin-only" onclick="invOpenAddWineModal()" ${inventoryPageState.warehouseId ? '' : 'disabled'}>酒品目录</button>
      <button type="button" class="btn btn-secondary btn-sm inv-admin-only" onclick="invOpenInboundModal()" ${inventoryPageState.warehouseId ? '' : 'disabled'}>物料入库</button>
      <span class="form-hint" style="flex:1;min-width:200px;margin:0">仓库与物料为 <strong>25/26 财年共用</strong>；点击「+ 新建仓库」可补建；点击仓库卡片右上「编辑」可改名称/品牌/区域/城市/备注。按项目编号匹配场次时请先选左侧年度。</span>
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

  const outboundSearchVal = String(inventoryPageState.outboundSearch || '');
  const outboundPageHeader = `
    <div class="inv-out-page-head">
      <div class="inv-out-page-head-main">
        <span class="form-hint" style="margin:0">按项目编号汇总已出库记录；<strong>出库日期</strong>按发货时间，无则按创建时间。主数据请在 <strong>库存管理</strong> 维护。</span>
      </div>
      <div class="inv-out-page-head-actions">
        <div class="inv-ob-search">
          <input type="search" id="invOutboundSearch" class="form-control form-control-sm inv-ob-search-input"
            placeholder="关键词检索"
            value="${escapeHtml(outboundSearchVal)}"
            oninput="invOnOutboundSearchInput(this.value)"
            aria-label="出库单内容搜索"
            title="可按物品名 / 项目编号 / 收件人 / 物流单号 / 用途 / 仓库 / 城市 模糊搜索；空格分隔多关键字（AND）">
          ${outboundSearchVal ? `<button type="button" class="inv-ob-search-clear" aria-label="清除搜索" onclick="invOnOutboundSearchInput('')"><i data-lucide="x" aria-hidden="true"></i></button>` : ''}
        </div>
        <button type="button" class="btn btn-primary btn-sm" onclick="invToggleOutboundInlineForm()">${inventoryPageState.outboundInlineOpen ? '收起新建' : '新建出库'}</button>
      </div>
    </div>`;

  const inboundOpsToolbar = `<div class="inv-toolbar"></div>`;

  const tabsMasterTools = [itemsFilterHtml, viewToggleHtml].filter(Boolean).join('');
  const tabsBarMaster = `
    <div class="inv-tabs-bar">
      <span class="inv-page-lead">${masterIsWine ? '酒品目录' : masterIsItemCatalog ? '物品目录' : masterIsEmpty ? '空瓶回收' : '物料清单'}</span>
      ${tabsMasterTools ? `<div class="inv-tabs-bar-tools">${tabsMasterTools}</div>` : ''}
    </div>`;

  const inboundLedgerMonthKeys =
    invPage === 'inbound'
      ? invMonthKeysFromRows(inventoryPageState._inboundLedgerCache, invInboundLedgerDateKey)
      : [];
  const tabsBarInbound = `
    <div class="inv-tabs-bar">
      <div class="inv-inbound-section-head inv-inbound-tabs-head">
        <span class="inv-page-lead">已入库</span>
        <div id="invInboundLedgerMonthBar">${invRenderInvMonthBar(inboundLedgerMonthKeys, inventoryPageState.inboundLedgerMonthFilter, 'invSetInboundLedgerMonth')}</div>
      </div>
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
  if (inventoryPageState.editOutboundOrderId && document.getElementById('invObCommonTbody')) {
    inventoryPageState.outboundEditCommonPreset = {
      ...(inventoryPageState.outboundEditCommonPreset || {}),
      ...invSnapshotCommonPresetFromDom(),
    };
  } else {
    invSaveCurrentWarehouseDraftFromModal();
  }
  inventoryPageState.outboundCommonSearchByWarehouse = inventoryPageState.outboundCommonSearchByWarehouse || {};
  inventoryPageState.outboundCommonSearchByWarehouse[key] = String(val || '');
  inventoryPageState.outboundCommonSearchSeq = (inventoryPageState.outboundCommonSearchSeq || 0) + 1;
  const seq = inventoryPageState.outboundCommonSearchSeq;
  const commonTbody = document.getElementById('invObCommonTbody');
  if (!commonTbody) return;
  const wh = inventoryPageState.warehouseId;
  if (!wh) return;
  api('GET', `/inventory/items?inv_warehouse_id=${wh}`)
    .then((items) => {
      if (seq !== inventoryPageState.outboundCommonSearchSeq) return;
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
  const shipDateRaw = (document.getElementById('invObShipDate')?.value || '').trim();
  if (!shipDateRaw) {
    showToast('请选择出库日期', 'warning');
    return;
  }
  const activityDateRaw = (document.getElementById('invObActivityDate')?.value || '').trim();
  const baseBody = {
    link_mode: lm,
    project_code: lm === 'activity' ? (document.getElementById('invProjectCode')?.value || '').trim() : null,
    purpose: lm === 'standalone' ? (document.getElementById('invPurpose')?.value || '').trim() : null,
    year_frame_id: currentYearFrameId || null,
    activity_id: document.getElementById('invActivityId')?.value || null,
    shipped_at: shipDateRaw,
    activity_date: activityDateRaw || null,
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
        shipped_at: '',
        activity_date: '',
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
        const { unit, express } = invOutboundMethodToLogisticsUnitExpress(baseBody.logistics_method);
        let sampleWh = null;
        for (const line of created.lines || []) {
          const c = whMap.get(Number(line.inv_warehouse_id));
          if (c) {
            sampleWh = c;
            break;
          }
        }
        const cn = String(baseBody.contact_name || '').trim();
        const cp = String(baseBody.contact_phone || '').trim();
        const address = [baseBody.recipient_city, baseBody.recipient_address].filter(Boolean).join(' ').trim();
        const senderHint = sampleWh ? `${String(sampleWh.region || '').trim() || '仓库'}`.replace(/仓$/, '') + '仓发运' : '';
        const purposeLine = [baseBody.purpose, baseBody.remarks].filter(Boolean).join('；').trim();
        const addrLine = buildLogisticsAddrMetaV2('', '', senderHint, cn, cp, address, purposeLine).replace(/\n$/, '');
        const remarkPieces = [];
        if (addrLine) remarkPieces.push(addrLine);
        remarkPieces.push(`[INV-OB:${ord.id}]`);
        try {
          await api('POST', '/logistics', {
            year_frame_id: currentYearFrameId || null,
            activity_id: null,
            merged_into_activity: 0,
            allocation_note: null,
            logistics_company: unit,
            brand: sampleWh?.brand_code || 'PHD',
            express_company: express,
            tracking_number: baseBody.tracking_number || null,
            origin_city: senderHint || null,
            destination_city: baseBody.recipient_city || null,
            shipping_date: (baseBody.shipped_at || '').trim() || todayDateInputValue(),
            fee: 0,
            payee_name: express || '物流公司',
            payment_status: 'unpaid',
            related_project_code: null,
            remarks: remarkPieces.join('\n'),
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
      shipped_at: '',
      activity_date: '',
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

// 物料入库弹窗状态
let invInboundState = {
  warehouseId: null,
  warehouses: [],
  items: [],
  rows: [{ itemId: null, itemName: '', qty: 1 }],
};

async function invOpenInboundModal() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可操作物料入库', 'warning');
    return;
  }
  const submitBtn = document.getElementById('invInboundSubmitBtn');
  if (submitBtn) submitBtn.disabled = false;
  const whId = Number(inventoryPageState.warehouseId || 0);
  if (!whId) {
    showToast('请先点击仓库卡片', 'warning');
    return;
  }
  const body = document.getElementById('modalInvInboundBody');
  if (!body) return;
  invInboundState.rows = [{ itemId: null, itemName: '', qty: 1 }];
  body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">加载中...</div>';
  openModal('modalInvInbound');
  try {
    const [warehouses, items] = await Promise.all([
      api('GET', '/inventory/warehouses'),
      api('GET', `/inventory/items?inv_warehouse_id=${whId}`),
    ]);
    invInboundState.warehouseId = whId;
    invInboundState.warehouses = Array.isArray(warehouses) ? warehouses : [];
    invInboundState.items = Array.isArray(items) ? items : [];
    invRenderInboundModal();
  } catch (e) {
    body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

function invRenderInboundModal() {
  const body = document.getElementById('modalInvInboundBody');
  if (!body) return;
  const whOpts = invInboundState.warehouses
    .map((w) => `<option value="${w.id}" ${Number(w.id) === invInboundState.warehouseId ? 'selected' : ''}>${escapeHtml(`${invWarehouseFullLabel(w)}${w.label && w.label !== `${w.region}仓库` ? ` · ${w.label}` : ''}`)}</option>`)
    .join('');
  const today = todayDateInputValue();
  const rowHtml = invInboundState.rows
    .map((r, i) => `
      <div class="inv-inbound-row" style="display:flex;gap:8px;align-items:flex-end;margin-bottom:6px">
        <div style="position:relative;flex:1;min-width:0">
          <input type="text" class="form-control inv-inbound-row-search" data-idx="${i}" placeholder="搜索物品..." autocomplete="off"
            oninput="invFilterInboundItems(this.value,${i})" onfocus="invFilterInboundItems(this.value,${i})"
            onblur="setTimeout(()=>invCloseInboundDropdown(),180)"
            value="${escapeHtml(r.itemName)}">
          <div class="inv-inbound-dropdown" id="invInboundDropdown_${i}" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:180px;overflow-y:auto;background:var(--bg-primary);border:1px solid var(--border);border-radius:0 0 6px 6px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.1)"></div>
        </div>
        <input type="number" class="form-control inv-inbound-row-qty" data-idx="${i}" min="1" step="1" value="${r.qty}" style="width:80px;flex-shrink:0" placeholder="数量">
        <input type="hidden" class="inv-inbound-row-id" value="${r.itemId || ''}">
        ${invInboundState.rows.length > 1 ? `<button type="button" class="btn btn-xs btn-secondary" onclick="invRemoveInboundRow(${i})" style="flex-shrink:0" title="移除此行">✕</button>` : ''}
      </div>`)
    .join('');
  body.innerHTML = `
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">目标仓库</label>
      <select class="form-control" id="invInboundWarehouse" onchange="invOnInboundWarehouseChange(this.value)">
        ${whOpts}
      </select>
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">物品清单</label>
      <div id="invInboundRowsHost">${rowHtml}</div>
      <button type="button" class="btn btn-xs btn-secondary" onclick="invAddInboundRow()" style="margin-top:4px">+ 添加一行物品</button>
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">入库时间</label>
      <input type="date" class="form-control" id="invInboundDate" value="${today}">
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">入库来源</label>
      <input type="text" class="form-control" id="invInboundSource" placeholder="例如：采购入库、调拨入库、盘盈入库">
    </div>
    <div class="form-group" style="margin-bottom:0">
      <label class="form-label">备注</label>
      <input type="text" class="form-control" id="invInboundRemarks" placeholder="选填">
    </div>`;
}

function invAddInboundRow() {
  invSyncInboundRows();
  invInboundState.rows.push({ itemId: null, itemName: '', qty: 1 });
  invRenderInboundModal();
}

function invRemoveInboundRow(idx) {
  invSyncInboundRows();
  invInboundState.rows.splice(idx, 1);
  invRenderInboundModal();
}

function invSyncInboundRows() {
  const host = document.getElementById('invInboundRowsHost');
  if (!host) return;
  const searches = host.querySelectorAll('.inv-inbound-row-search');
  const qtys = host.querySelectorAll('.inv-inbound-row-qty');
  const ids = host.querySelectorAll('.inv-inbound-row-id');
  invInboundState.rows = [];
  for (let i = 0; i < searches.length; i++) {
    invInboundState.rows.push({
      itemId: parseInt(ids[i]?.value, 10) || null,
      itemName: searches[i]?.value || '',
      qty: parseInt(qtys[i]?.value, 10) || 1,
    });
  }
}

function invFilterInboundItems(query, rowIdx) {
  const dropdown = document.getElementById(`invInboundDropdown_${rowIdx}`);
  if (!dropdown) return;
  const q = (query || '').trim().toLowerCase();
  const filtered = q
    ? invInboundState.items.filter((it) => (it.name || '').toLowerCase().includes(q) || (it.dimensions || '').toLowerCase().includes(q))
    : invInboundState.items;
  if (filtered.length) {
    dropdown.style.display = 'block';
    dropdown.innerHTML = filtered
      .map((it) => `<div class="inv-inbound-dropdown-item" data-id="${it.id}" data-idx="${rowIdx}" onmousedown="invSelectInboundItem(${it.id},${rowIdx})" style="padding:7px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border-light,#eee);transition:background .12s">${escapeHtml(it.name || '')} — ${escapeHtml(it.dimensions || '')}（库存 ${it.quantity_on_hand || 0}）</div>`)
      .join('');
  } else {
    dropdown.style.display = 'block';
    dropdown.innerHTML = '<div style="padding:8px;color:var(--text-muted);font-size:12px">无匹配物品</div>';
  }
}

function invSelectInboundItem(id, rowIdx) {
  if (rowIdx == null) return;
  const search = document.querySelector(`.inv-inbound-row-search[data-idx="${rowIdx}"]`);
  const hidden = document.querySelector(`.inv-inbound-row-id[data-idx="${rowIdx}"]`) || document.querySelectorAll('.inv-inbound-row-id')[rowIdx];
  const dropdown = document.getElementById(`invInboundDropdown_${rowIdx}`);
  if (hidden) hidden.value = id;
  const item = invInboundState.items.find((it) => Number(it.id) === id);
  if (search && item) search.value = `${item.name || ''} — ${item.dimensions || ''}`;
  if (dropdown) dropdown.style.display = 'none';
}

function invCloseInboundDropdown() {
  const dropdown = document.getElementById('invInboundDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

async function invDeleteInboundRecord(id) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除入库记录', 'warning');
    return;
  }
  if (!confirm('确定删除该入库记录？仓库库存将自动回退。')) return;
  try {
    await api('DELETE', `/inventory/inbound/${id}`);
    showToast('已删除并回退库存', 'success');
    await renderInventory();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

function invOpenInboundEditModal(id) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可编辑入库记录', 'warning');
    return;
  }
  const row = (inventoryPageState.inboundDirectRows || []).find((r) => Number(r.batch_id) === Number(id));
  if (!row) {
    showToast('未找到该入库记录，请刷新后重试', 'warning');
    return;
  }
  inventoryPageState.inboundEditId = Number(id);
  const body = document.getElementById('modalInvInboundEditBody');
  if (!body) return;
  body.innerHTML = `
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">入库内容</label>
      <div style="padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);font-size:13px">
        <div style="font-weight:700">${escapeHtml(row.display_main || '—')}</div>
        <div style="margin-top:4px;color:var(--text-secondary)">数量：${escapeHtml(row._qty || 0)} ｜ 仓库：${escapeHtml(`${row.brand_code || ''} ${row.region || ''}`.trim() || '—')}</div>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">入库日期</label>
      <input type="date" class="form-control" id="invInboundEditDate" value="${escapeHtml(toDateInputValue(row.inbound_date || row.return_date))}">
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">入库来源</label>
      <input type="text" class="form-control" id="invInboundEditSource" placeholder="例如：采购入库、调拨入库、盘盈入库" value="${escapeHtml(row.source || '')}">
    </div>
    <div class="form-group" style="margin-bottom:0">
      <label class="form-label">备注</label>
      <input type="text" class="form-control" id="invInboundEditRemarks" placeholder="选填" value="${escapeHtml(row.batch_remarks || '')}">
    </div>
  `;
  openModal('modalInvInboundEdit');
}

async function invSubmitInboundEdit() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可编辑入库记录', 'warning');
    return;
  }
  const id = Number(inventoryPageState.inboundEditId || 0);
  if (!id) {
    showToast('未找到要编辑的入库记录', 'warning');
    return;
  }
  try {
    await api('PUT', `/inventory/inbound/${id}`, {
      inbound_date: document.getElementById('invInboundEditDate')?.value || null,
      source: document.getElementById('invInboundEditSource')?.value?.trim() || null,
      remarks: document.getElementById('invInboundEditRemarks')?.value?.trim() || null,
    });
    showToast('入库信息已更新', 'success');
    inventoryPageState.inboundEditId = null;
    closeModal();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '更新失败', 'error');
  }
}

async function invOnInboundWarehouseChange(val) {
  const wid = parseInt(val, 10);
  if (!Number.isFinite(wid)) return;
  invInboundState.warehouseId = wid;
  const body = document.getElementById('modalInvInboundBody');
  if (body) body.innerHTML = '<div style="padding:8px;color:var(--text-muted)">加载物品...</div>';
  try {
    const items = await api('GET', `/inventory/items?inv_warehouse_id=${wid}`);
    invInboundState.items = Array.isArray(items) ? items : [];
    invRenderInboundModal();
  } catch (e) {
    if (body) body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

async function invSubmitInbound() {
  invSyncInboundRows();
  const srcEl = document.getElementById('invInboundSource');
  const rmkEl = document.getElementById('invInboundRemarks');
  const dateEl = document.getElementById('invInboundDate');
  const validRows = invInboundState.rows.filter((r) => Number.isFinite(r.itemId) && r.itemId > 0 && Number.isFinite(r.qty) && r.qty > 0);
  if (!validRows.length) {
    showToast('请至少选择一个物品并输入有效数量', 'warning');
    return;
  }
  const btn = document.getElementById('invInboundSubmitBtn');
  if (btn) btn.disabled = true;
  try {
    const items = validRows.map((r) => ({ inv_item_id: r.itemId, quantity: r.qty }));
    await api('POST', '/inventory/inbound', {
      inv_warehouse_id: invInboundState.warehouseId,
      items,
      source: srcEl?.value?.trim() || null,
      remarks: rmkEl?.value?.trim() || null,
      inbound_date: dateEl?.value || null,
    });
    showToast('入库成功', 'success');
    if (btn) btn.disabled = false;
    closeModal();
    await renderInventory();
  } catch (e) {
    showToast(e.message || '入库失败', 'error');
    if (btn) btn.disabled = false;
  }
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
    .map((w) => `<option value="${w.id}" ${Number(w.id) === whId ? 'selected' : ''}>${escapeHtml(`${invWarehouseFullLabel(w)}${w.label && w.label !== `${w.region}仓库` ? ` · ${w.label}` : ''}`)}</option>`)
    .join('');
  body.innerHTML = `
    <div class="form-group" style="margin-bottom:10px">
      <label class="form-label">目标仓库</label>
      <select class="form-control" id="invAddWineWarehouse" onchange="invOnAddWineWarehouseChange(this.value)">
        ${whOpts}
      </select>
    </div>
    <div class="form-hint" style="margin:0 0 10px">
      当前仓库：<strong>${escapeHtml(wh ? invWarehouseFullLabel(wh) : `#${whId}`)}</strong>。可手动勾选目录酒品加入该仓库；数量可填 0，后续再调整。
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
          <input type="date" class="form-control" id="invReturnDate" value="${todayDateInputValue()}">
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
    return_date: document.getElementById('invReturnDate')?.value || todayDateInputValue(),
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
