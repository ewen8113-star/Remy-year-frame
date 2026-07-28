const { beijingParts } = require('../lib/businessTime');

function compactDateYYMMDD(input) {
  const p = beijingParts(input || new Date());
  if (!p) return '';
  const yy = String(p.year).slice(-2);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function safeFilePart(v) {
  return String(v || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '');
}

/**
 * 从「项目编号」中提取「项目内容」用于 PDF 文件名。
 * 现实数据格式：年框前缀 + 空格 + 「YYMMDD + 城市 + 描述」，例：
 *   "N220630-RC-PHD 250522上海PHD晚宴" → "250522上海PHD晚宴"
 * 规则：若第一个空格之后以 6 位数字（YYMMDD）开头，则取空格之后整段；
 *      否则（如纯年框编号 "N230530-RM Club"）保持完整 project_code。
 */
function extractProjectContent(projectCodeRaw) {
  const s = String(projectCodeRaw || '').trim();
  if (!s) return '';
  const m = s.match(/^\S+\s+(\d{6}.*)$/);
  if (m && m[1]) return m[1].trim();
  return s;
}

module.exports = {
  compactDateYYMMDD,
  extractProjectContent,
  safeFilePart,
};
