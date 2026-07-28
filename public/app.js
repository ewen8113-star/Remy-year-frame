/* ===================================================
   人头马年框项目管理 - 前端主程序
   对接后端 API：
   - 正常：与页面同源 /api（用 node 启动后访问 http://localhost:端口/）
   - 若误用 file:// 打开本页：读 localStorage.remy_apiBase，否则默认 http://127.0.0.1:3088/api
   =================================================== */

/** 提升版本号可一次性把各浏览器默认年切到「当前财年」（仍可手动切换并记住） */
const REMY_FY_PREF_VERSION = '2';

function resolveInitialActiveYear() {
  const currentFy = getFiscalYearCodeForDate();
  try {
    if (localStorage.getItem('remy_fyPrefVersion') !== REMY_FY_PREF_VERSION) {
      localStorage.setItem('remy_activeYear', currentFy);
      localStorage.setItem('remy_fyPrefVersion', REMY_FY_PREF_VERSION);
      return currentFy;
    }
    const raw = localStorage.getItem('remy_activeYear') || currentFy;
    return (String(raw).match(/\d{2}/) || [currentFy])[0];
  } catch (_) {
    return currentFy;
  }
}

let currentYear = resolveInitialActiveYear();
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
let reimbursementPageState = {
  rows: [],
  paymentOrders: [],
  activities: [],
  logistics: [],
  warehouse: [],
  materialPurchases: [],
  propRepairs: [],
  filterInput: '',
  view: 'registrations',
  statsCard: null,
  /** 费用统计：品牌 / 分类 / 归属月（YYYY-MM） */
  statsFilterBrand: '',
  statsFilterBucket: '',
  statsFilterMonth: '',
  /** 费用统计 · 按项目编号表已展开的行 */
  statsExpandedProjectCodes: new Set(),
  selectedIds: new Set(),
  expandedPaymentOrderIds: new Set(),
  paymentOrderDetailCache: {},
  expandedRegistrationPoIds: new Set(),
};
/** 付款申请 · 成本登记列表行内展开 */
let reimbursementListExpanded = new Set();
let paymentOrderState = { candidates: [], selectedKeys: new Set(), previewRows: [], filters: {}, saving: false };
const reimbursementActivityIndex = {
  codes: new Set(),
  codeToId: new Map(),
  idToCode: new Map(),
};
let reimbursementProjectMenuBound = false;
const REIMB_PROJECT_MENU_Z = 10050;
const REIMB_PAYMENT_TYPE_OPTIONS = [
  { value: 'personal_reimbursement', label: '个人报销' },
  { value: 'corporate_payment', label: '对公付款' },
];
/** 收款方：个人 / 公司（对应 payment_type） */
const REIMB_PAYEE_PARTY_OPTIONS = [
  { value: 'personal', label: '个人', payment_type: 'personal_reimbursement' },
  { value: 'company', label: '公司', payment_type: 'corporate_payment' },
];
let reimbPayeeInfoCache = [];

function reimbPayeePartyFromPaymentType(paymentType) {
  return String(paymentType || '') === 'corporate_payment' ? 'company' : 'personal';
}

function reimbPaymentTypeFromPayeeParty(party) {
  return (
    REIMB_PAYEE_PARTY_OPTIONS.find((x) => x.value === party)?.payment_type || 'personal_reimbursement'
  );
}

function reimbPayeePartyLabel(party) {
  return REIMB_PAYEE_PARTY_OPTIONS.find((x) => x.value === party)?.label || '个人';
}

function reimbNormalizePayeeName(name) {
  return String(name || '').trim();
}

function reimbLooksLikeCompanyName(name) {
  const n = reimbNormalizePayeeName(name);
  if (!n) return false;
  return /(有限公司|股份有限公司|有限责任公司|集团有限公司|集团公司|集团)$/.test(n);
}

function reimbBuildSupplierNameSet(rows) {
  const set = new Set();
  (Array.isArray(rows) ? rows : [])
    .filter((e) => e.is_active !== false && e.is_active !== 0)
    .forEach((e) => {
      const c = e.content || {};
      const name = reimbNormalizePayeeName(c.company_name || e.name);
      if (name) set.add(name);
    });
  return set;
}

function reimbIsCompanyPayeeName(name, supplierNames) {
  const n = reimbNormalizePayeeName(name);
  if (!n) return true;
  if (supplierNames && supplierNames.has(n)) return true;
  return reimbLooksLikeCompanyName(n);
}

function reimbCostAttributionLabel(isNonActivity) {
  return isNonActivity ? '统筹成本（不同步场次）' : '活动成本（可同步场次）';
}

function reimbRecordIsNonActivity(r) {
  return (
    !!r
    && String(r.cost_module) === 'general'
    && !r.activity_id
    && !(r.merged_into_activity === 1 || r.merged_into_activity === true)
  );
}

function reimbRecordCostAttributionLabel(r) {
  if (!r) return '';
  if (r.merged_into_activity === 1 || r.merged_into_activity === true) {
    return '活动成本（已同步场次）';
  }
  return reimbCostAttributionLabel(reimbRecordIsNonActivity(r));
}
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
  { value: 'reimbursed', label: '已报销' },
];

/** 个人报销可选状态（含已支付 / 已报销） */
const REIMB_PERSONAL_CLAIM_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'submitted', label: '待支付' },
  { value: 'paid', label: '已支付' },
  { value: 'reimbursed', label: '已报销' },
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
  if (v === 'paid' || v === 'reimbursed') return 'badge-success';
  if (v === 'submitted') return 'badge-accent';
  if (v === 'rejected') return 'badge-danger';
  return 'badge-gray';
}

function reimbClaimStatusOptionsForRecord(record) {
  const pt = String(record?.payment_type || 'personal_reimbursement');
  return pt === 'personal_reimbursement' ? REIMB_PERSONAL_CLAIM_STATUS_OPTIONS : REIMB_CLAIM_STATUS_OPTIONS;
}

function reimbClaimStatusNeedsPaymentDate(status) {
  return status === 'paid' || status === 'reimbursed';
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
  if (orderId) {
    return `<span class="badge badge-warning">待付款单 #${escapeHtml(orderId)}</span>`;
  }
  return '<span class="badge badge-gray">未支付</span>';
}

function paymentOrderStatusBadgeHtml(status) {
  const paid = String(status || '').toLowerCase() === 'paid';
  return paid
    ? '<span class="badge badge-success">已支付</span>'
    : '<span class="badge badge-warning">未支付</span>';
}

function yearFrameDisplayLabel(frame) {
  const raw = String(frame?.year || frame?.name || '').trim();
  const yy = (raw.match(/\d{2}/) || [String(currentYear || '').padStart(2, '0')])[0];
  return yy ? `${yy}年度` : String(frame?.id || '');
}
