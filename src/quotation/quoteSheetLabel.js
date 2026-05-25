const { toCalendarDateYmd } = require('./calendarDate');

/**
 * 合并导出各场次 Sheet / 标签名：MMDD + 项目名称（如 0520上海品鉴）
 */
function normalizeEventDateYmd(raw) {
  return toCalendarDateYmd(raw);
}

/** 去掉项目名称开头已带的 MMDD，避免与活动日期重复拼接 */
function stripLeadingMmddFromTitle(title) {
  return String(title || '')
    .trim()
    .replace(/^(\d{4})(?=\D)/, '')
    .trim();
}

/** 各场次 Sheet 表头「项目名称」：用该场报价单原名，不拼接合并名、不重复加日期 */
function quoteSheetHeaderProjectName(q) {
  return String(q?.project_name || q?.project_code || '').trim() || '—';
}

function quoteSheetDisplayName(q, fallbackIdx) {
  const ymd = normalizeEventDateYmd(q?.event_date);
  let mmdd = '';
  if (ymd) {
    const p = ymd.split('-');
    if (p.length >= 3) mmdd = `${p[1]}${p[2]}`;
  }
  const rawTitle =
    String(q?.project_name || q?.project_code || '').trim() ||
    (fallbackIdx != null ? `场次${fallbackIdx + 1}` : '场次');
  const baseTitle = stripLeadingMmddFromTitle(rawTitle) || rawTitle;
  if (mmdd) return baseTitle ? `${mmdd}${baseTitle}` : mmdd;
  return rawTitle;
}

module.exports = {
  quoteSheetDisplayName,
  quoteSheetHeaderProjectName,
  normalizeEventDateYmd,
  stripLeadingMmddFromTitle,
};
