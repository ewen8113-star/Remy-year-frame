/**
 * 日历日期 YYYY-MM-DD（按业务时区 +08:00，避免 mysql2 DATE / Excel 时区导致差一天）
 */
const BJ_OFFSET_MS = 8 * 60 * 60 * 1000;

function toCalendarDateYmd(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    if (t.includes('T') || /\d{2}:\d{2}/.test(t)) {
      const dt = new Date(t);
      if (!Number.isNaN(dt.getTime())) {
        const d = new Date(dt.getTime() + BJ_OFFSET_MS);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      }
    }
    const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const slash = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (slash) {
      return `${slash[1]}-${String(slash[2]).padStart(2, '0')}-${String(slash[3]).padStart(2, '0')}`;
    }
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const d = new Date(raw.getTime() + BJ_OFFSET_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const dt = new Date(String(raw).trim());
  if (Number.isNaN(dt.getTime())) return '';
  const d = new Date(dt.getTime() + BJ_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

module.exports = { toCalendarDateYmd, BJ_OFFSET_MS };
