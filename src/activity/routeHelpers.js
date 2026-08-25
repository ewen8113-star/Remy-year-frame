const db = require('../config/database');
const { todayYmd } = require('../lib/businessTime');

/** 兼容全角字符、BOM、零宽；再 trim */
function cleanStatusInput(v) {
  if (v == null) return '';
  return String(v)
    .normalize('NFKC')
    .replace(/^\uFEFF+/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

/** 允许写入库的状态（与 lookup activity_status 及业务一致）；列类型为 VARCHAR 或 ENUM 均按此白名单解析 */
const APP_STATUS_WHITELIST = new Set(['pending', 'deferred', 'completed', 'cancelled']);

function canonicalStatusFromInput(s) {
  const lo = s.toLowerCase();
  if (s === '延期') return 'deferred';
  if (lo === 'done') return 'completed';
  if (lo === 'canceled' || lo === 'cancelled') return 'cancelled';
  if (APP_STATUS_WHITELIST.has(lo)) return lo;
  return null;
}

function maybeAutoCompleteStatusByDate(status, dateStr) {
  const st = String(status || '').trim() || 'pending';
  const dt = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) return st;
  const today = todayYmd();
  if (st === 'completed' && dt >= today) return 'pending';
  if (st !== 'pending') return st;
  return dt < today ? 'completed' : st;
}

/**
 * 解析前端/lookup 提交的状态。
 * 不再依赖解析 SHOW COLUMNS（部分环境 Type 含 COLLATE 等导致 ENUM 解析为空，误判 deferred 无效）。
 * @returns {{ ok: true, value: string } | { ok: false, message: string } | { ok: false, message: null }}
 */
async function resolveActivityStatusForWrite(raw) {
  const s = cleanStatusInput(raw);
  if (s === '') return { ok: false, message: null };

  let v = canonicalStatusFromInput(s);
  if (v && APP_STATUS_WHITELIST.has(v)) return { ok: true, value: v };

  const [rows] = await db.query(
    `SELECT TRIM(value) AS value FROM lookup_options
     WHERE category = 'activity_status' AND is_active = 1
       AND (TRIM(value) = ? OR TRIM(label) = ? OR LOWER(TRIM(value)) = ?)
     LIMIT 1`,
    [s, s, s.toLowerCase()]
  );
  if (rows.length) {
    const val = String(rows[0].value).trim();
    const lo = val.toLowerCase();
    const mapped = canonicalStatusFromInput(val) || (APP_STATUS_WHITELIST.has(lo) ? lo : null);
    if (mapped && APP_STATUS_WHITELIST.has(mapped)) return { ok: true, value: mapped };
  }

  return { ok: false, message: null };
}

module.exports = {
  maybeAutoCompleteStatusByDate,
  resolveActivityStatusForWrite,
};
