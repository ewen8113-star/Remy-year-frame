/**
 * 从「场次导入模板.xlsx」批量新建场次（一行一场）
 * 表头与新建活动表单字段一致
 */
const XLSX = require('xlsx');
const db = require('../config/database');
const { todayYmd } = require('../lib/businessTime');

const IMPORT_HEADERS = [
  '年框编号',
  '活动类型',
  '城市',
  '活动日期',
  '时段',
  '客户名称',
  '区域',
  '归属',
  '场地',
  '报价',
  '宾客人数',
  '执行人员',
  '品牌大使',
  '状态',
];

const HEADER_ALIASES = {
  年框编号: '年框编号',
  活动类型: '活动类型',
  城市: '城市',
  活动日期: '活动日期',
  日期: '活动日期',
  时段: '时段',
  客户名称: '客户名称',
  客户: '客户名称',
  区域: '区域',
  归属: '归属',
  场地: '场地',
  报价: '报价',
  宾客人数: '宾客人数',
  执行人员: '执行人员',
  品牌大使: '品牌大使',
  状态: '状态',
};

const STATUS_ALIASES = {
  代执行: 'pending',
  待执行: 'pending',
  延期: 'deferred',
  已完成: 'completed',
  已取消: 'cancelled',
  取消: 'cancelled',
};

function cleanCell(v) {
  if (v == null) return '';
  return String(v)
    .replace(/^\uFEFF+/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function normalizeHeader(h) {
  return cleanCell(h).replace(/\s+/g, '');
}

function cellOrNull(v) {
  const s = cleanCell(v);
  if (!s || s === '—' || s === '-') return null;
  return s;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 从 Excel 单元格显示文本解析日历日（与用户在表格中看到的一致，不做时区偏移）
 * 支持：2026/6/1、2026-06-01、2026年6月1日、6/1/26（视为 20xx，见 parseShortYear）
 */
function parseActivityDateFromDisplayString(raw) {
  const s = cleanCell(raw);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  let m = s.match(/^(\d{4})[/.-年](\d{1,2})[/.-月]?(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let y = parseInt(m[3], 10);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    return `${y}-${pad2(m[1])}-${pad2(m[2])}`;
  }
  return null;
}

/** Excel 序列日 → YYYY-MM-DD（无时区） */
function ymdFromExcelSerial(serial) {
  const dc = XLSX.SSF.parse_date_code(serial);
  if (!dc || !dc.y) return null;
  return `${dc.y}-${pad2(dc.m)}-${pad2(dc.d)}`;
}

/**
 * 解析活动日期：严禁对 xlsx 的 Date 做 UTC+8 偏移（会导致 6/1→5/31）
 * 优先 cell.w 显示文本，其次序列号，最后用 Date 的本地年月日
 */
function parseActivityDate(v) {
  if (v == null || v === '') return null;

  const fromStr = parseActivityDateFromDisplayString(v);
  if (fromStr) return fromStr;

  if (typeof v === 'number' && Number.isFinite(v) && v > 20000) {
    return ymdFromExcelSerial(v);
  }

  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }

  return parseActivityDateFromDisplayString(cleanCell(v));
}

/** 从工作表按行读取，活动日期列使用单元格显示值 cell.w */
function readImportRowsFromSheet(ws) {
  const ref = ws['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const headerRow = range.s.r;
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
    headers.push(cell ? cleanCell(cell.w != null ? cell.w : cell.v) : '');
  }

  const rows = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const row = {};
    let hasValue = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const header = headers[c - range.s.c];
      if (!header) continue;
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) {
        row[header] = '';
        continue;
      }
      const canonical = HEADER_ALIASES[normalizeHeader(header)] || cleanCell(header);
      if (canonical === '活动日期') {
        row[canonical] = cell.w != null && String(cell.w).trim() !== '' ? cell.w : cell.v;
      } else if (cell.t === 'n' || typeof cell.v === 'number') {
        row[canonical] = cell.v;
      } else {
        row[canonical] = cell.w != null && String(cell.w).trim() !== '' ? cell.w : cell.v;
      }
      if (cleanCell(row[canonical]) !== '') hasValue = true;
    }
    if (hasValue) rows.push(row);
  }
  return rows;
}

function normalizeProjectCodeCity(raw) {
  return String(raw || '')
    .replace(/\s+/g, '')
    .replace(/[^\u4e00-\u9fa5]/g, '')
    .trim();
}

function normalizeProjectCodeToken(raw) {
  return String(raw || '')
    .replace(/\s+/g, '')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9&.\-]/g, '')
    .trim();
}

function detectBrandByYearFrameCode(rawCode) {
  const normalized = String(rawCode || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!normalized) return '';
  if (normalized.includes('CLUB')) return 'CLUB';
  if (normalized.includes('PHD')) return 'PHD';
  if (normalized.includes('RC')) return 'RC';
  if (normalized.includes('XO')) return 'X.O';
  return '';
}

function buildProjectCode({ year_frame_code, date, city, brand, activity_type, client }) {
  let dateStr = '';
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    dateStr = date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);
  }
  const pc = `${year_frame_code || ''} ${dateStr}${normalizeProjectCodeCity(city)}${normalizeProjectCodeToken(client)}${normalizeProjectCodeToken(brand)}${normalizeProjectCodeToken(activity_type)}`.trim();
  return pc;
}

function yearFrameIdFromDate(dateStr, fallbackId) {
  const fb = Number(fallbackId) || 1;
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return fb;
  const y = parseInt(dateStr.slice(0, 4), 10);
  if (y >= 2026) return 2;
  return 1;
}

function maybeAutoCompleteStatusByDate(status, dateStr) {
  const st = String(status || '').trim() || 'pending';
  const dt = String(dateStr || '').slice(0, 10);
  if (st !== 'pending' || !/^\d{4}-\d{2}-\d{2}$/.test(dt)) return st;
  return dt < todayYmd() ? 'completed' : st;
}

async function loadLookupMaps() {
  const [rows] = await db.query(
    `SELECT category, TRIM(value) AS value, TRIM(label) AS label
     FROM lookup_options WHERE is_active = 1`
  );
  const maps = {};
  for (const r of rows) {
    const cat = r.category;
    if (!maps[cat]) maps[cat] = { byValue: new Map(), byLabel: new Map() };
    const val = String(r.value || '').trim();
    const label = String(r.label || r.value || '').trim();
    if (val) maps[cat].byValue.set(val, val);
    if (label) maps[cat].byLabel.set(label, val);
  }
  return maps;
}

function resolveLookup(maps, category, raw, { required = false, fieldLabel = category } = {}) {
  const s = cleanCell(raw);
  if (!s) {
    if (required) return { ok: false, error: `${fieldLabel}不能为空` };
    return { ok: true, value: null };
  }
  const m = maps[category];
  if (!m) return { ok: true, value: s };
  if (m.byValue.has(s)) return { ok: true, value: m.byValue.get(s) };
  if (m.byLabel.has(s)) return { ok: true, value: m.byLabel.get(s) };
  return { ok: false, error: `${fieldLabel}「${s}」不在系统选项中` };
}

async function resolveStatus(raw, lookupMaps) {
  const s = cleanCell(raw);
  if (!s) return { ok: true, value: 'pending' };
  if (STATUS_ALIASES[s]) return { ok: true, value: STATUS_ALIASES[s] };
  const fromLookup = resolveLookup(lookupMaps, 'activity_status', s, { fieldLabel: '状态' });
  if (fromLookup.ok) return fromLookup;
  const lo = s.toLowerCase();
  const whitelist = new Set(['pending', 'deferred', 'completed', 'cancelled']);
  if (whitelist.has(lo)) return { ok: true, value: lo };
  return { ok: false, error: `状态「${s}」无效` };
}

function parseQuotedPrice(v) {
  const s = cleanCell(v);
  if (!s) return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function parseGuestCount(v) {
  const s = cleanCell(v);
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function isEmptyDataRow(mapped) {
  return !cleanCell(mapped['年框编号']) && !cleanCell(mapped['活动类型']) && !cleanCell(mapped['城市']);
}

/**
 * @param {Buffer} buffer
 * @param {{ defaultYearFrameId?: number|null }} options
 */
async function importActivitiesFromExcelBuffer(buffer, options = {}) {
  const defaultYearFrameId = options.defaultYearFrameId != null ? Number(options.defaultYearFrameId) : null;
  const lookupMaps = await loadLookupMaps();

  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Excel 文件中没有工作表');
  const ws = wb.Sheets[sheetName];
  const rawRows = readImportRowsFromSheet(ws);
  if (!rawRows.length) throw new Error('Excel 中没有数据行');

  const headerKeys = new Set();
  rawRows.forEach((row) => Object.keys(row).forEach((k) => headerKeys.add(normalizeHeader(k))));
  const missingHeaders = IMPORT_HEADERS.filter((h) => !headerKeys.has(normalizeHeader(h)));
  if (missingHeaders.length === IMPORT_HEADERS.length) {
    throw new Error(`表头不匹配，需要包含：${IMPORT_HEADERS.join('、')}`);
  }

  const created = [];
  const skipped = [];
  const failed = [];

  for (let i = 0; i < rawRows.length; i++) {
    const excelRow = i + 2;
    const mapped = rawRows[i];
    if (isEmptyDataRow(mapped)) continue;

    try {
      const yearFrameCode = cleanCell(mapped['年框编号']);
      if (!yearFrameCode) {
        failed.push({ row: excelRow, error: '年框编号不能为空' });
        continue;
      }

      const yfLookup = resolveLookup(lookupMaps, 'activity_year_frame_code', yearFrameCode, {
        required: true,
        fieldLabel: '年框编号',
      });
      if (!yfLookup.ok) {
        failed.push({ row: excelRow, error: yfLookup.error });
        continue;
      }

      const activityType = resolveLookup(lookupMaps, 'activity_type', mapped['活动类型'], {
        required: true,
        fieldLabel: '活动类型',
      });
      if (!activityType.ok) {
        failed.push({ row: excelRow, error: activityType.error });
        continue;
      }

      const city = cleanCell(mapped['城市']);
      if (!city) {
        failed.push({ row: excelRow, error: '城市不能为空' });
        continue;
      }

      const date = parseActivityDate(mapped['活动日期']);
      const period =
        resolveLookup(lookupMaps, 'activity_period', mapped['时段'], { fieldLabel: '时段' }).value || '日常';
      const region = resolveLookup(lookupMaps, 'activity_region', mapped['区域'], { fieldLabel: '区域' }).value;
      const belonging =
        resolveLookup(lookupMaps, 'activity_belonging', mapped['归属'], { fieldLabel: '归属' }).value;
      const executor =
        resolveLookup(lookupMaps, 'activity_executor', mapped['执行人员'], { fieldLabel: '执行人员' }).value ||
        '无';

      const statusOut = await resolveStatus(mapped['状态'], lookupMaps);
      if (!statusOut.ok) {
        failed.push({ row: excelRow, error: statusOut.error });
        continue;
      }

      const brand = detectBrandByYearFrameCode(yearFrameCode) || 'PHD';
      const client = cellOrNull(mapped['客户名称']);
      const venue = cellOrNull(mapped['场地']);
      const quoted_price = parseQuotedPrice(mapped['报价']);
      const guest_count = parseGuestCount(mapped['宾客人数']);
      const brand_ambassador = cellOrNull(mapped['品牌大使']);

      const project_code = buildProjectCode({
        year_frame_code: yearFrameCode,
        date,
        city,
        brand,
        activity_type: activityType.value,
        client,
      });

      if (!project_code) {
        failed.push({ row: excelRow, error: '无法生成项目编号，请检查年框编号、日期、城市等' });
        continue;
      }

      const [dup] = await db.query('SELECT id FROM activities WHERE project_code = ? LIMIT 1', [project_code]);
      if (dup.length) {
        skipped.push({ row: excelRow, project_code, reason: '项目编号已存在' });
        continue;
      }

      const year_frame_id =
        defaultYearFrameId != null && Number.isFinite(Number(defaultYearFrameId)) && Number(defaultYearFrameId) > 0
          ? Number(defaultYearFrameId)
          : yearFrameIdFromDate(date, defaultYearFrameId);
      const status = maybeAutoCompleteStatusByDate(statusOut.value, date);

      const [result] = await db.query(
        `INSERT INTO activities (
          year_frame_id, year_frame_code, project_code, activity_type,
          city, brand, client, client_name, venue, date, period, region, belonging, guest_count,
          quoted_price, executor, brand_ambassador, status, remarks, wine_details, cloud_album_url,
          is_virtual
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          year_frame_id,
          yearFrameCode,
          project_code,
          activityType.value,
          city,
          brand,
          client,
          client,
          venue,
          date,
          period,
          region,
          belonging,
          guest_count,
          quoted_price,
          executor,
          brand_ambassador,
          status,
          null,
          JSON.stringify({}),
          null,
          0,
        ]
      );

      created.push({ row: excelRow, id: result.insertId, project_code });
    } catch (err) {
      failed.push({ row: excelRow, error: err.message || String(err) });
    }
  }

  return {
    createdCount: created.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    created,
    skipped,
    failed,
  };
}

module.exports = { importActivitiesFromExcelBuffer, IMPORT_HEADERS };
