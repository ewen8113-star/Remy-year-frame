/**
 * Summary 汇总列：按板块名称归并（不同 section_code 但语义相同的列合并为一列）
 */

/** 别名 → 标准列名（与报价模版/单场明细常用名称一致） */
const SUMMARY_SECTION_NAME_ALIASES = {
  人员沟通费: '前期沟通',
  沟通调度: '前期沟通',
  物料运输费用: '物流运输费用',
  物料运输: '物流运输费用',
  运输费用: '物流运输费用',
  往返运费: '物流运输费用',
  '摄影师&相册': '摄影及直播相册',
  摄影师相册: '摄影及直播相册',
  人员费用: '摄影及直播相册',
  摄影摄像: '摄影及直播相册',
};

/** 标准列名排序（合并导出 Summary 表头顺序） */
const SUMMARY_SECTION_SORT_ORDER = {
  前期沟通: 10,
  执行人员: 15,
  设计费: 20,
  物料制作费用: 30,
  物流运输费用: 40,
  摄影及直播相册: 50,
};

function normalizeSummarySectionName(raw) {
  const name = String(raw || '').trim();
  if (!name) return '';
  if (SUMMARY_SECTION_NAME_ALIASES[name]) return SUMMARY_SECTION_NAME_ALIASES[name];
  if (/物料.*运输|运输.*物料/.test(name)) return '物流运输费用';
  if (name.includes('物流运输')) return '物流运输费用';
  return name;
}

function summarySectionSortOrder(canonicalName, sectionCode) {
  if (SUMMARY_SECTION_SORT_ORDER[canonicalName] != null) {
    return SUMMARY_SECTION_SORT_ORDER[canonicalName];
  }
  const c = String(sectionCode || '').trim().toUpperCase();
  if (/^[A-Z]$/.test(c)) return (c.charCodeAt(0) - 64) * 100;
  const n = parseFloat(c);
  return Number.isFinite(n) ? n * 100 : 9999;
}

module.exports = {
  SUMMARY_SECTION_NAME_ALIASES,
  SUMMARY_SECTION_SORT_ORDER,
  normalizeSummarySectionName,
  summarySectionSortOrder,
};
