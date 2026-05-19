/**
 * 业务时区：中国标准时间（北京时间，UTC+8）
 * 全项目日期/时间展示与「今天」判断统一走此模块，避免服务器在 UTC 时区时偏差 8 小时。
 */
const OFFSET_MS = 8 * 3600 * 1000;

function parseInstant(raw) {
  if (raw == null || raw === '') return null;
  const dt = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** 将 UTC 时刻转为北京时间的年月日时分秒 */
function beijingParts(raw = new Date()) {
  const dt = parseInstant(raw);
  if (!dt) return null;
  const bj = new Date(dt.getTime() + OFFSET_MS);
  return {
    year: bj.getUTCFullYear(),
    month: bj.getUTCMonth() + 1,
    day: bj.getUTCDate(),
    hours: bj.getUTCHours(),
    minutes: bj.getUTCMinutes(),
    seconds: bj.getUTCSeconds(),
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatYmd(raw) {
  const p = beijingParts(raw);
  if (!p) return null;
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** 今天（北京时间）YYYY-MM-DD */
function todayYmd() {
  return formatYmd(new Date()) || '';
}

/** 北京时间 YYYY-MM-DD HH:mm */
function formatDateTimeMinute(raw) {
  const p = beijingParts(raw);
  if (!p) return null;
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hours)}:${pad2(p.minutes)}`;
}

/** 北京时间 YYYY-MM-DD HH:mm:ss */
function formatDateTimeSecond(raw) {
  const p = beijingParts(raw);
  if (!p) return null;
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hours)}:${pad2(p.minutes)}:${pad2(p.seconds)}`;
}

module.exports = {
  OFFSET_MS,
  beijingParts,
  todayYmd,
  formatYmd,
  formatDateTimeMinute,
  formatDateTimeSecond,
};
