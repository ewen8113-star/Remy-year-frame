const { beijingParts } = require('./businessTime');

function projectCodeDateYYMMDD(raw) {
  const p = beijingParts(raw);
  if (!p) return '';
  const yy = String(p.year).slice(-2);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function projectCodeHasDateSuffix(projectCode) {
  return /^\S+\s+\d{6}/.test(String(projectCode || '').trim());
}

function repairProjectCodeDate(projectCode, date) {
  const s = String(projectCode || '').trim();
  const datePart = projectCodeDateYYMMDD(date);
  if (!s || !datePart) return s;
  const sp = s.indexOf(' ');
  if (sp < 0) return s;
  const prefix = s.slice(0, sp);
  let rest = s.slice(sp + 1).trim();
  // 历史脏数据：「2510-27」类残缺日期，先去掉再写入标准 YYMMDD
  rest = rest.replace(/^\d{4}-\d{1,2}-\d{1,2}/, '');
  if (/^\d{6}/.test(rest)) rest = datePart + rest.slice(6);
  else rest = datePart + rest;
  return `${prefix} ${rest}`.trim();
}

module.exports = {
  projectCodeDateYYMMDD,
  projectCodeHasDateSuffix,
  repairProjectCodeDate,
};
