/** 报价明细「分类」列可选值（与导出表头一致） */
const QUOTATION_ITEM_CATEGORIES = [
  '专业服务费',
  '纯设计',
  '印刷/快印',
  '写真/喷绘',
  '结构搭建',
  '道具/物料制作',
  '采购',
  '运输',
  '操作',
  '人员',
  '执行差旅',
  '摄影摄像',
];

function normalizeItemCategory(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  return QUOTATION_ITEM_CATEGORIES.includes(v) ? v : v;
}

module.exports = { QUOTATION_ITEM_CATEGORIES, normalizeItemCategory };
