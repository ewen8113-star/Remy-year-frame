const { todayYmd, formatYmd, beijingParts } = require('../lib/businessTime');

const INV_REGIONS = ['东区', '南区', '北区', '东南区'];

/**
 * 仓库显示名（与前端 invWarehouseFullLabel 保持一致）。
 * - X.O 北区/南区是"公司级跨品牌总仓"，显示为「北区仓库」「南区仓库」
 * - 其它显示为「品牌 区域」
 * @param {string|null} brandCode
 * @param {string|null} region
 * @returns {string}
 */
function formatWarehouseLabel(brandCode, region) {
  const code = String(brandCode || '').trim();
  const reg = String(region || '').trim();
  if (code.toUpperCase() === 'X.O' && (reg === '北区' || reg === '南区')) {
    return `${reg}仓库`;
  }
  if (!code && !reg) return '—';
  if (!code) return reg;
  if (!reg) return code;
  return `${code} ${reg}`;
}

/** API 中的 DATE 字段统一为北京时间 YYYY-MM-DD，避免 JSON 序列化成 UTC 导致前端少一天 */
function jsonYmd(v) {
  if (v == null || v === '') return null;
  return formatYmd(v) || String(v).trim().slice(0, 10) || null;
}

function formatCnYmd(raw) {
  const p = beijingParts(raw);
  if (!p) return '—';
  return `${p.year}年${p.month}月${p.day}日`;
}

function parseReturnDateInput(raw) {
  const s = String(raw || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return todayYmd();
  return s;
}

function canonicalRegion(r) {
  if (r == null) return null;
  let s = String(r).replace(/^\uFEFF/, '').trim().normalize('NFKC');
  const trad = { 東區: '东区', 北區: '北区', 南區: '南区', 東南區: '东南区' };
  if (trad[s]) s = trad[s];
  return INV_REGIONS.includes(s) ? s : null;
}

/** 出库日期：YYYY-MM-DD → DATETIME 字符串（中午，避免时区边界） */
function parseOutboundShippedAtInput(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, mo, d] = s.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} 12:00:00`;
}

/**
 * 解析「活动日期」表单输入（YYYY-MM-DD），返回纯日期串供 DATE 字段存储；
 * 空或非法值返回 null，让数据库存 NULL（活动日期可空）。
 */
function parseActivityDateInput(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().slice(0, 10);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, mo, d] = s.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 活动区域与物理仓的建议映射（无对应仓时仍可选手选） */
function hintRegionFromActivityRegion(ar) {
  const s = String(ar || '').trim();
  if (!s) return null;
  if (INV_REGIONS.includes(s)) return s;
  if (s.includes('东南') && !s.includes('西南')) return '东南区';
  if (s.includes('东') && !s.includes('南')) return '东区';
  if (s.includes('西南')) return '南区';
  if (s.includes('南')) return '南区';
  if (s.includes('北')) return '北区';
  return '南区';
}

function parseImageUrls(row) {
  if (!row || row.image_urls == null) return [];
  try {
    const j = typeof row.image_urls === 'string' ? JSON.parse(row.image_urls) : row.image_urls;
    return Array.isArray(j) ? j : [];
  } catch {
    const s = String(row.image_urls || '').trim();
    if (s.startsWith('/') || s.startsWith('http://') || s.startsWith('https://')) return [s];
    return [];
  }
}

/** 写入 inv_items.image_urls 前统一为合法 JSON 数组字符串 */
function serializeImageUrlsForDb(raw) {
  return JSON.stringify(parseImageUrls({ image_urls: raw }));
}

/** query month=YYYY-MM → [startInclusive, endExclusive) 用于 DATETIME 区间筛选 */
function parseMonthRangeForSql(monthRaw) {
  const s = String(monthRaw || '').trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const y = parseInt(s.slice(0, 4), 10);
  const mo = parseInt(s.slice(5, 7), 10);
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  return [`${y}-${pad(mo)}-01 00:00:00`, `${ny}-${pad(nm)}-01 00:00:00`];
}

module.exports = {
  INV_REGIONS,
  canonicalRegion,
  formatCnYmd,
  formatWarehouseLabel,
  hintRegionFromActivityRegion,
  jsonYmd,
  parseActivityDateInput,
  parseImageUrls,
  parseMonthRangeForSql,
  parseOutboundShippedAtInput,
  parseReturnDateInput,
  serializeImageUrlsForDb,
};
