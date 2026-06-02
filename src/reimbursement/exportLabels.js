/** 与前端 REIMB_DETAIL_* 一致，供 Excel / 服务端导出 */

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
    ['supervisor', '督导'],
    ['pg', 'PG礼仪'],
    ['parttime', '兼职'],
    ['bartender', '调酒师'],
    ['photo', '摄影师'],
    ['cloud_album_edit', '云相册修图'],
    ['performance', '演职人员'],
    ['makeup', '化妆师'],
  ],
  travel: [
    ['travel_supervisor', '督导差旅'],
    ['travel_company', '盛融差旅'],
  ],
  stage: [
    ['structure', '结构制作/搭建'],
    ['av', 'AV灯光音响'],
  ],
  print: [
    ['print', '印刷/快印'],
    ['spray', '写真/喷绘'],
  ],
  purchase: [
    ['floral', '花艺'],
    ['payment', '活动物料'],
    ['tasting', '品鉴物料'],
  ],
  logistics: [
    ['express', '快递/闪送'],
    ['logistics', '物流'],
  ],
  advance: [
    ['venue_fee', '场地费'],
    ['meal_fee', '餐费'],
    ['other_advance', '其他'],
  ],
};

const REIMB_BRAND_YEAR_FRAME = {
  PHD: 'N220630-RC PHD',
  'X.O': 'N230901-RM XO',
  XO: 'N230901-RM XO',
  CLUB: 'N230530-RM Club',
};

const CLAIM_STATUS_LABELS = {
  draft: '草稿',
  submitted: '待支付',
  paid: '已支付',
  reimbursed: '已报销',
  rejected: '已驳回',
};

function blockLabel(block) {
  return REIMB_DETAIL_BLOCKS.find((x) => x.value === block)?.label || block || '';
}

function categoryLabel(block, category) {
  const opts = REIMB_DETAIL_CATEGORY_OPTIONS[block] || [];
  const hit = opts.find(([v]) => v === category);
  return hit ? hit[1] : category || '';
}

function claimStatusLabel(status) {
  return CLAIM_STATUS_LABELS[String(status || '').trim()] || '草稿';
}

function brandYearFrameCode(brand) {
  const b = String(brand || '').trim().toUpperCase();
  if (b === 'PHD') return REIMB_BRAND_YEAR_FRAME.PHD;
  if (b === 'X.O' || b === 'XO') return REIMB_BRAND_YEAR_FRAME['X.O'];
  if (b === 'CLUB') return REIMB_BRAND_YEAR_FRAME.CLUB;
  return '';
}

module.exports = {
  blockLabel,
  categoryLabel,
  claimStatusLabel,
  brandYearFrameCode,
  REIMB_BRAND_YEAR_FRAME,
  REIMB_DETAIL_CATEGORY_OPTIONS,
};
