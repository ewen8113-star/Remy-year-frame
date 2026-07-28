/* 字典管理页面：依赖 app.js 暴露的 api / escapeHtml / showToast / renderLucideIcons / openModal / closeModal / hasWriteAccess */

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
  personal_payee: {
    label: '个人收款信息',
    icon: 'wallet',
    desc: '个人报销收款方：姓名 + 付款方式 + 银行信息（自动记忆，下次填充）',
    fields: [
      { key: 'payee_name', label: '姓名', type: 'text', required: true },
      { key: 'payment_method', label: '付款方式', type: 'text' },
      { key: 'bank_name', label: '开户行', type: 'text' },
      { key: 'bank_account', label: '银行账号', type: 'text' },
    ],
    nameField: 'payee_name',
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
