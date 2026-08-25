/* 前端无状态公共工具：由 app.js 和各页面模块共享。 */

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

/** 填入 <input type="date">：与列表 fmtDate 一致（北京时间）。 */
function toDateInputValue(raw) {
  const p = beijingParts(raw);
  if (!p) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function todayDateInputValue() {
  return toDateInputValue(new Date());
}

/**
 * 财年规则（北京时间）：
 * YY年度 = (2000+YY)-04-01 ～ (2001+YY)-03-31。
 */
function getFiscalYearCodeForDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const fiscalStartYear = month >= 4 ? year : year - 1;
  return String(fiscalStartYear % 100).padStart(2, '0');
}
