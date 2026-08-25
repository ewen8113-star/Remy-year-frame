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

function reimbDefaultCostMonth() {
  const d = document.getElementById('reimbDate')?.value || '';
  if (d && d.length >= 7) {
    const m = parseInt(d.slice(5, 7), 10);
    if (Number.isFinite(m) && m >= 1 && m <= 12) return m;
  }
  const now = new Date();
  return now.getMonth() + 1;
}

function reimbCostMonthOptionsHtml(selected) {
  const sel = selected != null && selected !== '' ? parseInt(selected, 10) : NaN;
  const opts = ['<option value="">—</option>'];
  for (let m = 1; m <= 12; m += 1) {
    opts.push(`<option value="${m}" ${m === sel ? 'selected' : ''}>${m}月</option>`);
  }
  return opts.join('');
}

function reimbFormatCostMonth(v) {
  const m = parseInt(v, 10);
  if (!Number.isFinite(m) || m < 1 || m > 12) return '';
  return `${m}月`;
}

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
    logistics_supplier: '',
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
  /** 编辑出库：从单据明细缓存的物料名/规格（跨仓物料不在当前仓 items 列表时用于预览） */
  outboundEditLineMeta: {},
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

/** 用酒统计页筛选与缓存 */
const wineUsageStatsState = {
  region: '',
  belonging: '',
  /** 项目编号关键词（空格分隔多词为 AND，与出库台账搜索一致） */
  projectCode: '',
  dateFrom: '',
  dateTo: '',
  month: '',
  lastPayload: null,
};

let wineStatsSearchTimer = null;

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
