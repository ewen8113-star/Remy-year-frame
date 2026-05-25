/**
 * 活动单场报价默认模版（A–G 大板块）
 */
const EVENT_TEMPLATE_ROWS = [
  {
    section_code: 'A',
    section_name: '前期沟通',
    subsection_code: 'A-1',
    subsection_name: '',
    item_category: '专业服务费',
    description: '人员沟通费',
    default_unit: '项',
    default_unit_price: 300,
    default_remarks: '',
    sort_order: 11,
  },
  {
    section_code: 'B',
    section_name: '设计费',
    subsection_code: 'B-1',
    subsection_name: '',
    item_category: '纯设计',
    description: '设计费',
    default_unit: '项',
    default_unit_price: 200,
    default_remarks: '',
    sort_order: 21,
  },
  {
    section_code: 'C',
    section_name: '物料制作费用',
    subsection_code: 'C-1',
    subsection_name: '',
    item_category: '印刷/快印',
    description: '菜单',
    default_unit: '项',
    default_unit_price: 8,
    default_remarks: '300铜版纸，专色印刷覆哑膜，双面打印',
    sort_order: 31,
  },
  {
    section_code: 'C',
    section_name: '物料制作费用',
    subsection_code: 'C-2',
    subsection_name: '',
    item_category: '印刷/快印',
    description: '名卡',
    default_unit: '份',
    default_unit_price: 12,
    default_remarks: '',
    sort_order: 32,
  },
  {
    section_code: 'C',
    section_name: '物料制作费用',
    subsection_code: 'C-3',
    subsection_name: '',
    item_category: '写真/喷绘',
    description: '背板指示牌等 (KT 板)',
    default_unit: '项',
    default_unit_price: 100,
    default_remarks: '指示牌*1 :600*900mm 写真覆亚膜KT板',
    sort_order: 33,
  },
  {
    section_code: 'C',
    section_name: '物料制作费用',
    subsection_code: 'C-4',
    subsection_name: '',
    item_category: '道具/物料制作',
    description: '鲜花',
    default_unit: '项',
    default_unit_price: 200,
    default_remarks: '',
    sort_order: 34,
  },
  {
    section_code: 'C',
    section_name: '物料制作费用',
    subsection_code: 'C-5',
    subsection_name: '',
    item_category: '道具/物料制作',
    description: '品鉴物料',
    default_unit: '份',
    default_unit_price: 500,
    default_remarks: '',
    sort_order: 35,
  },
  {
    section_code: 'D',
    section_name: '物流运输费用',
    subsection_code: 'D-1',
    subsection_name: '',
    item_category: '运输',
    description: '陈列道具\n桌面陈列&\n品鉴杯子',
    default_unit: '公里/来回',
    default_unit_price: 7,
    default_remarks: '',
    sort_order: 41,
  },
  {
    section_code: 'D',
    section_name: '物流运输费用',
    subsection_code: 'D-2',
    subsection_name: '',
    item_category: '操作',
    description: '仓库理货费',
    default_unit: '项',
    default_unit_price: 100,
    default_remarks: '仓管人员出库理货&入库盘点',
    sort_order: 42,
  },
  {
    section_code: 'D',
    section_name: '物流运输费用',
    subsection_code: 'D-3',
    subsection_name: '',
    item_category: '操作',
    description: '空瓶回收',
    default_unit: '场',
    default_unit_price: 100,
    default_remarks: '宴会现场管理及回收',
    sort_order: 43,
  },
  {
    section_code: 'E',
    section_name: '人员费用',
    subsection_code: 'E-1',
    subsection_name: '',
    item_category: '人员',
    description: '督导',
    default_unit: '人次',
    default_unit_price: 800,
    default_remarks: '',
    sort_order: 51,
  },
  {
    section_code: 'E',
    section_name: '人员费用',
    subsection_code: 'E-2',
    subsection_name: '',
    item_category: '人员',
    description: '兼职',
    default_unit: '人次',
    default_unit_price: 600,
    default_remarks: '',
    sort_order: 52,
  },
  {
    section_code: 'E',
    section_name: '人员费用',
    subsection_code: 'E-3',
    subsection_name: '',
    item_category: '人员',
    description: '礼仪',
    default_unit: '人次',
    default_unit_price: 800,
    default_remarks: '',
    sort_order: 53,
  },
  {
    section_code: 'E',
    section_name: '人员费用',
    subsection_code: 'E-4',
    subsection_name: '',
    item_category: '操作',
    description: '清洗/熨烫',
    default_unit: '份',
    default_unit_price: 80,
    default_remarks: '桌布，礼仪服装',
    sort_order: 54,
  },
  {
    section_code: 'F',
    section_name: '执行差旅费用',
    subsection_code: 'F-1',
    subsection_name: '',
    item_category: '执行差旅',
    description: '（高铁往返）',
    default_unit: '人',
    default_unit_price: 200,
    default_remarks: '按实结算，计费方式参照Logistics & Travel',
    sort_order: 61,
  },
  {
    section_code: 'F',
    section_name: '执行差旅费用',
    subsection_code: 'F-2',
    subsection_name: '',
    item_category: '执行差旅',
    description: '住宿',
    default_unit: '人',
    default_unit_price: 350,
    default_remarks: '',
    sort_order: 62,
  },
  {
    section_code: 'F',
    section_name: '执行差旅费用',
    subsection_code: 'F-3',
    subsection_name: '',
    item_category: '执行差旅',
    description: '餐补',
    default_unit: '人',
    default_unit_price: 100,
    default_remarks: '',
    sort_order: 63,
  },
  {
    section_code: 'G',
    section_name: '摄影摄像',
    subsection_code: 'G-1',
    subsection_name: '',
    item_category: '摄影摄像',
    description: '摄影师',
    default_unit: '人次',
    default_unit_price: 2500,
    default_remarks: '',
    sort_order: 71,
  },
  {
    section_code: 'G',
    section_name: '摄影摄像',
    subsection_code: 'G-2',
    subsection_name: '',
    item_category: '摄影摄像',
    description: '直播云相册',
    default_unit: '人次',
    default_unit_price: 1500,
    default_remarks: '',
    sort_order: 72,
  },
];

/** E-5~E-9 迁入 F/G 后，旧 ITEM 编号映射 */
const EVENT_TEMPLATE_SUBSECTION_LEGACY_MAP = {
  'E-5': 'F-1',
  'E-6': 'F-2',
  'E-7': 'F-3',
  'E-8': 'G-1',
  'E-9': 'G-2',
};

const EVENT_TEMPLATE_DESC_SYNC_CODES = new Set(['B-1', 'C-4', 'C-5']);

const EVENT_TEMPLATE_DESC_LEGACY = {
  'B-1': ['公司级设计'],
  'C-4': ['设计费'],
  'C-5': ['鲜花'],
};

const EVENT_TEMPLATE_BY_SUBSECTION = Object.fromEntries(
  EVENT_TEMPLATE_ROWS.map((r) => [r.subsection_code, r])
);

function shouldSyncEventTemplateDescription(item) {
  if (!item || Number(item.is_custom) === 1) return false;
  const code = String(item.subsection_code || '').trim();
  if (!EVENT_TEMPLATE_DESC_SYNC_CODES.has(code)) return false;
  const row = EVENT_TEMPLATE_BY_SUBSECTION[code];
  if (!row) return false;
  const desc = String(item.description || '').trim();
  const legacy = EVENT_TEMPLATE_DESC_LEGACY[code] || [];
  return legacy.includes(desc);
}

function applyEventTemplateDescriptionSync(items) {
  if (!Array.isArray(items)) return items;
  return items.map((it) => {
    if (!shouldSyncEventTemplateDescription(it)) return it;
    const row = EVENT_TEMPLATE_BY_SUBSECTION[it.subsection_code];
    return { ...it, description: row.description };
  });
}

function applyEventTemplateStructureSync(items) {
  if (!Array.isArray(items)) return items;
  return items.map((it) => {
    if (Number(it.is_custom) === 1) return it;
    const legacyCode = String(it.subsection_code || '').trim();
    const newCode = EVENT_TEMPLATE_SUBSECTION_LEGACY_MAP[legacyCode];
    if (!newCode) return it;
    const row = EVENT_TEMPLATE_BY_SUBSECTION[newCode];
    if (!row) return it;
    return {
      ...it,
      section_code: row.section_code,
      section_name: row.section_name,
      subsection_code: row.subsection_code,
      item_category: row.item_category,
      sort_order: row.sort_order,
    };
  });
}

function applyEventTemplateItemDefaults(items) {
  let out = applyEventTemplateStructureSync(items);
  out = applyEventTemplateDescriptionSync(out);
  return out.map((it) => {
    if (Number(it.is_custom) === 1) return it;
    const row = EVENT_TEMPLATE_BY_SUBSECTION[it.subsection_code];
    if (!row) return it;
    const next = { ...it };
    if (!String(next.item_category || '').trim()) next.item_category = row.item_category;
    if (legacyCodeClearsD1Remarks(it, row)) next.remarks = row.default_remarks || '';
    return next;
  });
}

function legacyCodeClearsD1Remarks(it, row) {
  if (row.subsection_code !== 'D-1') return false;
  return String(it.remarks || '').trim() === '广州-深圳往返';
}

module.exports = {
  EVENT_TEMPLATE_ROWS,
  EVENT_TEMPLATE_DESC_SYNC_CODES,
  EVENT_TEMPLATE_DESC_LEGACY,
  EVENT_TEMPLATE_SUBSECTION_LEGACY_MAP,
  EVENT_TEMPLATE_BY_SUBSECTION,
  shouldSyncEventTemplateDescription,
  applyEventTemplateDescriptionSync,
  applyEventTemplateStructureSync,
  applyEventTemplateItemDefaults,
};
