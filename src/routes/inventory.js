const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const PdfPrinter = require('pdfmake/js/Printer').default;
const URLResolver = require('pdfmake/js/URLResolver').default;
const pdfVirtualFs = require('pdfmake/js/virtual-fs').default;
const robotoVfsMap = require('pdfmake/build/vfs_fonts.js');
const cnVfsMap = require('pdfmake-support-chinese-fonts/vfs_fonts').pdfMake.vfs;
const {
  projectCodeHasDateSuffix,
  repairProjectCodeDate,
} = require('../lib/projectCode');

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

let _inventoryPdfVfsMerged = false;
function ensureInventoryPdfVfs() {
  if (_inventoryPdfVfsMerged) return;
  [robotoVfsMap, cnVfsMap].forEach((map) => {
    Object.keys(map).forEach((name) => {
      pdfVirtualFs.writeFileSync(name, Buffer.from(map[name], 'base64'));
    });
  });
  _inventoryPdfVfsMerged = true;
}

const router = express.Router();
const db = require('../config/database');
const { ensureInventoryTables } = require('../inventory/ensureInventoryTables');
const { writeWineUsageStatsExcel } = require('../inventory/buildWineUsageStatsExcel');
const { ensureWineCatalog } = require('../wine/ensureWineCatalog');
const { todayYmd, formatYmd, formatDateTimeSecond, beijingParts } = require('../lib/businessTime');

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

function serializeOrderDetailForJson(detail) {
  if (!detail) return detail;
  const order = applyActivityProjectCodeToOrder({ ...detail.order });
  if (order.activity_date) order.activity_date = jsonYmd(order.activity_date);
  const batches = (detail.batches || []).map((b) => ({
    ...b,
    return_date: jsonYmd(b.return_date),
    created_at: formatDateTimeSecond(b.created_at) || b.created_at,
  }));
  return { ...detail, order, batches };
}

/** 归还登记行已登记数量合计（与结清判定一致） */
const RETURN_LINE_ACCOUNTED_SUM_SQL =
  'qty_return + qty_lost + qty_damaged + COALESCE(qty_consumed, 0) + qty_customer_keep + qty_empty_recovered';
const RETURN_LINE_ACCOUNTED_SUM_RL_SQL =
  'rl.qty_return + rl.qty_lost + rl.qty_damaged + COALESCE(rl.qty_consumed, 0) + rl.qty_customer_keep + rl.qty_empty_recovered';

async function queryOutboundReturnRemain(dbOrConn, orderId) {
  const [rows] = await dbOrConn.query(
    `
    SELECT ol.id AS outbound_line_id, ol.quantity AS shipped, it.name AS item_name,
      COALESCE((
        SELECT SUM(${RETURN_LINE_ACCOUNTED_SUM_SQL})
        FROM inv_return_lines rl WHERE rl.outbound_line_id = ol.id
      ), 0) AS accounted
    FROM inv_outbound_lines ol
    JOIN inv_items it ON it.id = ol.item_id
    WHERE ol.order_id = ?
  `,
    [orderId]
  );
  let qtyUnaccounted = 0;
  const pendingLines = [];
  (rows || []).forEach((r) => {
    const shipped = Number(r.shipped) || 0;
    const accounted = Number(r.accounted) || 0;
    const remaining = Math.max(0, shipped - accounted);
    if (remaining > 0) {
      qtyUnaccounted += remaining;
      pendingLines.push({
        outbound_line_id: r.outbound_line_id,
        item_name: r.item_name,
        shipped,
        accounted,
        remaining,
      });
    }
  });
  return { qty_unaccounted: qtyUnaccounted, pending_return_lines: pendingLines };
}

function attachOutboundReturnRemain(order, remain) {
  if (!order || !remain) return order;
  return {
    ...order,
    qty_unaccounted: remain.qty_unaccounted,
    pending_return_lines: remain.pending_return_lines,
  };
}

router.use(async (req, res, next) => {
  try {
    await ensureInventoryTables(db);
    next();
  } catch (e) {
    console.error('物资库存表初始化失败:', e);
    res.status(500).json({ error: e.message || '物资库存表初始化失败' });
  }
});

const INV_REGIONS = ['东区', '南区', '北区', '东南区'];

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

async function resolveBrandId(brandRaw) {
  const s = String(brandRaw || '').trim();
  if (!s) return null;
  const up = s.toUpperCase().replace(/\s/g, '');
  const tryCodes = [];
  if (up.includes('CLUB')) tryCodes.push('CLUB');
  else if (up.includes('PHD')) tryCodes.push('PHD');
  else if (up.includes('XO') || up.includes('X.O')) tryCodes.push('X.O');
  else if (up.includes('REMY')) tryCodes.push('REMY');
  else if (up.includes('RC')) tryCodes.push('RC');
  else tryCodes.push(s);
  for (const c of tryCodes) {
    const [rows] = await db.query('SELECT id FROM brand_inventory WHERE brand_code = ? LIMIT 1', [c]);
    if (rows.length) return rows[0].id;
  }
  const [rows2] = await db.query('SELECT id FROM brand_inventory WHERE brand_name LIKE ? LIMIT 1', [`%${s}%`]);
  return rows2.length ? rows2[0].id : null;
}

/** 物料图片物理目录（相对项目根：public/uploads/inventory）；静态由 express 提供 /uploads；DB inv_items.image_urls 存 /uploads/inventory/文件名 */
const uploadDir = path.join(__dirname, '../../public/uploads/inventory');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    const safe = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}${ext}`;
    cb(null, safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error('仅支持 jpeg/png/gif/webp 图片'), ok);
  },
});

const systemUnicodeFontPath = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
const hasSystemUnicodeFont = fs.existsSync(systemUnicodeFontPath);

const pdfFonts = hasSystemUnicodeFont
  ? {
      unicode: {
        normal: systemUnicodeFontPath,
        bold: systemUnicodeFontPath,
        italics: systemUnicodeFontPath,
        bolditalics: systemUnicodeFontPath,
      },
      fangzhen: {
        normal: 'fzhei-jt.TTF',
        bold: 'fzhei-jt.TTF',
        italics: 'fzhei-jt.TTF',
        bolditalics: 'fzhei-jt.TTF',
      },
    }
  : {
      fangzhen: {
        normal: 'fzhei-jt.TTF',
        bold: 'fzhei-jt.TTF',
        italics: 'fzhei-jt.TTF',
        bolditalics: 'fzhei-jt.TTF',
      },
    };

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

function normKeyPart(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase();
}

function itemCatalogUniqueKey(name, dimensions) {
  return `${normKeyPart(name)}@@${normKeyPart(dimensions)}`;
}

function buildEmptyBottleName(itemNameRaw) {
  const base = String(itemNameRaw || '').trim();
  if (!base) return '空瓶';
  if (base.includes('空瓶')) return base;
  return `${base} 空瓶`;
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

async function ensureEmptyBottleItem(conn, sourceItem) {
  const whId = Number(sourceItem?.inv_warehouse_id);
  const itemName = buildEmptyBottleName(sourceItem?.name);
  if (!Number.isFinite(whId) || !itemName) throw new Error('空瓶库存识别失败');
  const [ex] = await conn.query(
    'SELECT id FROM inv_items WHERE inv_warehouse_id = ? AND name = ? LIMIT 1',
    [whId, itemName]
  );
  if (ex.length) return Number(ex[0].id);
  const [ret] = await conn.query(
    `INSERT INTO inv_items (inv_warehouse_id, name, description, dimensions, initial_quantity, quantity_on_hand, alert_below, image_urls, is_common)
     VALUES (?, ?, ?, ?, 0, 0, NULL, '[]', 0)`,
    [
      whId,
      itemName,
      '系统自动生成：空瓶回收库存',
      sourceItem?.dimensions || null,
    ]
  );
  return Number(ret.insertId);
}

async function ensureReturnItemInWarehouse(conn, sourceItem, targetWarehouseId) {
  const whId = Number(targetWarehouseId);
  const name = String(sourceItem?.name || '').trim();
  const dimensions = sourceItem?.dimensions == null ? null : String(sourceItem.dimensions);
  if (!Number.isFinite(whId) || whId <= 0 || !name) {
    throw new Error('归还入库物料识别失败');
  }
  const [exists] = await conn.query(
    'SELECT id FROM inv_items WHERE inv_warehouse_id = ? AND name = ? AND COALESCE(dimensions, \'\') = COALESCE(?, \'\') LIMIT 1',
    [whId, name, dimensions]
  );
  if (exists.length) return Number(exists[0].id);

  const [ret] = await conn.query(
    `INSERT INTO inv_items (
      inv_warehouse_id, name, description, dimensions, initial_quantity, quantity_on_hand, alert_below, image_urls, is_common, is_wine, wine_label
    ) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
    [
      whId,
      name,
      sourceItem?.description || null,
      dimensions,
      sourceItem?.alert_below == null ? null : Number(sourceItem.alert_below),
      serializeImageUrlsForDb(sourceItem?.image_urls),
      sourceItem?.is_common ? 1 : 0,
      sourceItem?.is_wine ? 1 : 0,
      sourceItem?.wine_label || null,
    ]
  );
  return Number(ret.insertId);
}

function wineCatalogSpecLine(row) {
  const v = String(row?.volume_label || '').trim();
  return v || '';
}

/** 酒类统计归并名：目录入库默认「名称 + 容量」 */
function defaultWineLabelFromCatalog(row) {
  const name = String(row?.name || '').trim();
  const spec = wineCatalogSpecLine(row);
  if (!name) return '';
  return spec ? `${name} ${spec}` : name;
}

/** 出库统计用酒名：优先 wine_label，否则物料名称 */
function wineStatLabelFromItem(row) {
  const lbl = String(row?.wine_label || '').trim();
  if (lbl) return lbl;
  return String(row?.name || '').trim() || '—';
}

/** 规格展示统一为小写容量写法（700ML → 700ml） */
function normalizeVolumeDisplay(spec) {
  const s = String(spec || '').trim();
  if (!s) return '';
  return s.replace(/\s+/g, '').replace(/ML/g, 'ml').replace(/毫升/g, 'ml');
}

/** 从物料规格或统计名中解析容量展示（如 350ml、700ml、1L） */
function wineVolumeSpecFromRow(dimensions, wineLabel) {
  const d = String(dimensions || '').trim();
  if (d) {
    const ml = d.match(/\d+(?:\.\d+)?\s*ml/i);
    if (ml) return normalizeVolumeDisplay(ml[0]);
    const liter = d.match(/\d+(?:\.\d+)?\s*(?:l|L|升)/i);
    if (liter) return normalizeVolumeDisplay(liter[0]);
    if (/毫升/.test(d)) {
      const m = d.match(/\d+(?:\.\d+)?\s*毫升/);
      if (m) return normalizeVolumeDisplay(m[0].replace(/毫升/g, 'ml'));
    }
    if (/\d+\s*ml/i.test(d)) return normalizeVolumeDisplay(d.match(/\d+\s*ml/i)[0]);
    if (d.length <= 32 && /\d/.test(d) && /ml|升|L/i.test(d)) return normalizeVolumeDisplay(d);
  }
  const lbl = String(wineLabel || '').trim();
  const tail =
    lbl.match(/(\d+(?:\.\d+)?\s*(?:ml|mL|ML|毫升))\s*$/i) ||
    lbl.match(/(\d+(?:\.\d+)?\s*(?:l|L|升))\s*$/i);
  if (tail) return normalizeVolumeDisplay(tail[1]);
  return '';
}

/**
 * 用酒统计酒品列固定顺序（按关键词匹配酒类统计名；表头展示完整名称，不裁剪简称）。
 * hints：归一化后须全部包含；excludeHints：任一词命中则排除（用于区分 XO 与凯珊 XO 等）。
 */
const WINE_USAGE_FIXED_COLUMN_ORDER = [
  { hints: ['vsop'], volume: '375ml' },
  { hints: ['vsop'], volume: '700ml' },
  { hints: ['club'], volume: '350ml' },
  { hints: ['club'], volume: '700ml' },
  {
    hints: ['xo'],
    volume: '350ml',
    excludeHints: [
      '凯珊',
      'oct',
      'octomore',
      '波夏',
      'portcharlotte',
      '植物',
      'botanist',
      '迈夏',
      'tamnavulin',
      '君度',
      'cointreau',
      '布赫拉迪',
      'bruichladdich',
      '大麦',
      '古卓',
      'classic',
      'barley',
    ],
  },
  {
    hints: ['xo'],
    volume: '700ml',
    excludeHints: [
      '凯珊',
      'oct',
      'octomore',
      '波夏',
      'portcharlotte',
      '植物',
      'botanist',
      '迈夏',
      'tamnavulin',
      '君度',
      'cointreau',
      '布赫拉迪',
      'bruichladdich',
      '大麦',
      '古卓',
      'classic',
      'barley',
    ],
  },
  { hints: ['君度'], volume: '350ml' },
  { hints: ['君度'], volume: '700ml' },
  { hints: ['经典大麦'], volume: '200ml' },
  { hints: ['经典大麦'], volume: '700ml' },
  { hints: ['12年'], volume: '700ml', excludeHints: ['15年', '18年', '2013', '2012'] },
  { hints: ['15年'], volume: '700ml', excludeHints: ['12年', '18年', '2013', '2012'] },
  { hints: ['18年'], volume: '700ml', excludeHints: ['12年', '15年', '2013', '2012'] },
  { hints: ['大麦2013', '2013'], volume: '700ml' },
  { hints: ['古卓2012', '2012'], volume: '700ml' },
  { hints: ['波夏'], volume: '500ml' },
  { hints: ['波夏'], volume: '700ml' },
  { hints: ['oct', '15.1'], volume: '700ml' },
  { hints: ['oct', '15.2'], volume: '700ml' },
  { hints: ['oct', '15.3'], volume: '700ml' },
  { hints: ['植物学家'], volume: '350ml' },
  { hints: ['植物学家'], volume: '700ml' },
  { hints: ['凯珊禧年'], volume: '700ml' },
  { hints: ['凯珊波本'], volume: '700ml' },
  { hints: ['凯珊', 'xo'], volume: '700ml' },
  { hints: ['迈夏尔'], volume: '700ml' },
];

function normalizeWineMatchKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(/-/g, '');
}

function normalizeWineMatchBlob(wine) {
  const vol = normalizeVolumeDisplay(wine.volume) || '';
  return normalizeWineMatchKey(`${wine.label || ''} ${vol}`);
}

function wineMatchesUsageColumnSlot(wine, slot) {
  const blob = normalizeWineMatchBlob(wine);
  const vol = normalizeVolumeDisplay(wine.volume);
  const slotVol = normalizeVolumeDisplay(slot.volume);
  if (slotVol && vol !== slotVol) return false;
  for (const h of slot.hints || []) {
    if (!blob.includes(normalizeWineMatchKey(h))) return false;
  }
  for (const ex of slot.excludeHints || []) {
    if (blob.includes(normalizeWineMatchKey(ex))) return false;
  }
  return true;
}

function wineUsageEntryFromLabel(label, dimensions, total = 0) {
  const lbl = String(label || '').trim();
  if (!lbl) return null;
  const volume =
    normalizeVolumeDisplay(wineVolumeSpecFromRow(dimensions, lbl)) ||
    normalizeVolumeDisplay(wineVolumeSpecFromRow(null, lbl)) ||
    null;
  return { label: lbl, displayName: lbl, volume, total: Number(total) || 0 };
}

/** 物料 + 酒品目录：为零用量列提供完整酒类统计名 */
async function fetchWineRegistryForUsageStats(conn) {
  await ensureWineCatalog(conn);
  const [[itemRows], [catalogRows]] = await Promise.all([
    conn.query(
      `
      SELECT COALESCE(NULLIF(TRIM(wine_label), ''), TRIM(name)) AS wl,
             MAX(NULLIF(TRIM(dimensions), '')) AS dimensions
      FROM inv_items
      WHERE is_wine = 1
      GROUP BY wl
      `,
    ),
    conn.query('SELECT name, category, volume_label FROM wine_catalog ORDER BY sort_order, id'),
  ]);
  const byLabel = new Map();
  (itemRows || []).forEach((r) => {
    const entry = wineUsageEntryFromLabel(r.wl, r.dimensions, 0);
    if (entry) byLabel.set(entry.label, entry);
  });
  (catalogRows || []).forEach((c) => {
    const lbl = defaultWineLabelFromCatalog(c);
    const entry = wineUsageEntryFromLabel(lbl, wineCatalogSpecLine(c), 0);
    if (entry && !byLabel.has(entry.label)) byLabel.set(entry.label, entry);
  });
  return [...byLabel.values()];
}

/**
 * 固定列顺序：每个槽位始终一列（含零用量）。
 * 优先用本期有出库的酒；否则用仓库/目录登记名；仍无则占位（仅容量，便于对列）。
 */
function orderWinesForUsageStats(wines, registry = []) {
  const list = Array.isArray(wines) ? wines : [];
  const reg = Array.isArray(registry) ? registry : [];
  const used = new Set();
  const usedReg = new Set();
  const ordered = [];

  const takeMatch = (arr, usedSet, slot) => {
    const idx = arr.findIndex((w, i) => !usedSet.has(i) && wineMatchesUsageColumnSlot(w, slot));
    if (idx < 0) return null;
    usedSet.add(idx);
    return arr[idx];
  };

  for (const slot of WINE_USAGE_FIXED_COLUMN_ORDER) {
    let w = takeMatch(list, used, slot);
    if (!w) w = takeMatch(reg, usedReg, slot);
    if (!w) {
      const vol = normalizeVolumeDisplay(slot.volume) || null;
      const hint = (slot.hints || []).join(' ');
      ordered.push({
        label: `__slot__${normalizeWineMatchKey(hint)}__${vol || ''}`,
        displayName: hint ? `${hint} ${vol || ''}`.trim() : vol || '—',
        volume: vol,
        total: 0,
        isPlaceholder: true,
      });
      continue;
    }
    ordered.push({
      label: w.label,
      displayName: w.displayName || w.label,
      volume: w.volume || normalizeVolumeDisplay(slot.volume) || null,
      total: Number(w.total) || 0,
    });
  }
  list.forEach((w, i) => {
    if (!used.has(i)) {
      ordered.push({
        label: w.label,
        displayName: w.displayName || w.label,
        volume: w.volume || null,
        total: Number(w.total) || 0,
      });
    }
  });
  return ordered;
}

/** 各酒类统计名 → 仓库物料规格（出库聚合未带出规格时的兜底） */
async function fetchWineLabelDimensionsLookup(conn) {
  const [rows] = await conn.query(
    `
    SELECT COALESCE(NULLIF(TRIM(wine_label), ''), TRIM(name)) AS wl,
           MAX(NULLIF(TRIM(dimensions), '')) AS dimensions
    FROM inv_items
    WHERE is_wine = 1
    GROUP BY wl
    `
  );
  const m = new Map();
  (rows || []).forEach((r) => {
    const wl = String(r.wl || '').trim();
    const dim = r.dimensions != null ? String(r.dimensions).trim() : '';
    if (!wl || !dim) return;
    m.set(wl, dim);
  });
  return m;
}

/** 表头展示：统计名归并键 + 酒名 + 规格行 */
function wineColumnDisplayMeta(wineLabel, dimensions) {
  const label = String(wineLabel || '').trim() || '—';
  const volume = wineVolumeSpecFromRow(dimensions, label);
  let displayName = label;
  if (volume) {
    const vlow = volume.toLowerCase();
    const low = label.toLowerCase();
    if (low.endsWith(vlow)) {
      displayName = label.slice(0, label.length - volume.length).trim();
    } else {
      const idx = label.lastIndexOf(volume);
      if (idx > 0) displayName = label.slice(0, idx).trim();
    }
  }
  return { label, displayName, volume: volume || null };
}

/** 仓库物料与酒品目录对齐键（与 /items/from-catalog 入库规格一致：仅 volume_label） */
function invItemWineKey(name, dimensions) {
  const n = String(name == null ? '' : name).trim();
  const d = dimensions == null ? '' : String(dimensions).trim();
  return `${n}\0${d}`;
}

/** 前端筛「酒」用的规格展示（品类 · 容量），用于识别规格写法不一致 */
function wineCatalogSpecLineUi(row) {
  const parts = [row.category, row.volume_label].filter((x) => String(x || '').trim());
  return parts.length ? parts.join(' · ') : '';
}

/** 疑似酒类：含 数字+ml / 毫升，或名称含常见酒类词（排除空瓶库存行） */
function isSuspectedWineItem(row) {
  const name = String(row?.name || '');
  if (/空瓶/.test(name)) return false;
  const combined = `${name} ${row?.dimensions || ''} ${row?.description || ''}`;
  if (/\d+\s*ml\b/i.test(combined)) return true;
  if (/毫升/.test(combined)) return true;
  if (
    /(人头马|rémy|remy|vsop|xo|club|路易十三|干邑|cognac|特藏|香槟|威士忌|白兰地|利口|金酒)/i.test(
      name
    )
  ) {
    return true;
  }
  return false;
}

function classifyWineItemRow(item, catalogStrictKeys, catalogUiKeys, catalogNames) {
  const key = invItemWineKey(item.name, item.dimensions);
  const keyUi = invItemWineKey(item.name, wineCatalogSpecLineUi({ category: null, volume_label: item.dimensions }));
  const nameTrim = String(item.name || '').trim();
  const suspected = isSuspectedWineItem(item);
  let catalogStatus = 'not_in_catalog';
  if (catalogStrictKeys.has(key)) {
    catalogStatus = 'catalog_ok';
  } else if (catalogUiKeys.has(key)) {
    catalogStatus = 'catalog_spec_mismatch';
  } else if (catalogNames.has(nameTrim)) {
    catalogStatus = 'catalog_name_only';
  }
  const needsReview = suspected && catalogStatus !== 'catalog_ok';
  return { catalogStatus, suspected, needsReview };
}

/** MySQL 聚合 / mysql2 可能返回 string、bigint；统一为安全数字 */
function sqlAggNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function compactDateYYMMDD(input) {
  const p = beijingParts(input || new Date());
  if (!p) return '';
  const yy = String(p.year).slice(-2);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function extractBrandFromProjectCode(projectCodeRaw) {
  const s = String(projectCodeRaw || '').toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (s.includes('CLUB')) return 'CLUB';
  if (s.includes('PHD')) return 'PHD';
  if (s.includes('X.O') || s.includes('XO')) return 'XO';
  if (s.includes('REMY')) return 'REMY';
  if (s.includes('RC')) return 'RC';
  return '';
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

/**
 * 项目出库：未带 activity_id 时按 project_code 与可选 year_frame_id 解析场次，
 * 避免仅保存项目编号、activity_id 为空时在按财年筛选的列表中消失。
 */
async function resolveOutboundActivityId(conn, projectCodeRaw, activityIdRaw, yearFrameIdRaw) {
  const pc = String(projectCodeRaw || '').trim();
  if (activityIdRaw != null && String(activityIdRaw).trim() !== '') {
    const aid = parseInt(activityIdRaw, 10);
    if (Number.isFinite(aid)) return aid;
  }
  if (!pc) {
    const err = new Error('请填写项目编号或匹配场次');
    err.statusCode = 400;
    throw err;
  }
  const yf = parseInt(yearFrameIdRaw, 10);
  if (Number.isFinite(yf)) {
    const [rows] = await conn.query(
      'SELECT id FROM activities WHERE project_code = ? AND year_frame_id = ? LIMIT 1',
      [pc, yf]
    );
    if (!rows.length) {
      const err = new Error('当前年度下未找到与项目编号匹配的场次，请核对左侧年度或项目编号');
      err.statusCode = 400;
      throw err;
    }
    return rows[0].id;
  }
  const [rows] = await conn.query('SELECT id, year_frame_id FROM activities WHERE project_code = ?', [pc]);
  if (!rows.length) {
    const err = new Error('未找到与项目编号匹配的场次');
    err.statusCode = 400;
    throw err;
  }
  if (rows.length > 1) {
    const err = new Error('该项目编号在多个年度存在，请先在左侧选择年度后再保存');
    err.statusCode = 400;
    throw err;
  }
  return rows[0].id;
}

/**
 * 出库单保存用项目编号：已关联场次时与场次表一致；否则按活动日期补全 YYMMDD。
 */
async function canonicalOutboundProjectCode(conn, opts) {
  const lm = opts.link_mode === 'standalone' ? 'standalone' : 'activity';
  if (lm !== 'activity') return null;

  const activityId =
    opts.activity_id != null && String(opts.activity_id).trim() !== ''
      ? parseInt(opts.activity_id, 10)
      : null;
  let actRow = null;
  if (Number.isFinite(activityId)) {
    const [acts] = await conn.query('SELECT project_code, date FROM activities WHERE id = ? LIMIT 1', [
      activityId,
    ]);
    actRow = acts[0] || null;
    const actPc = String(actRow?.project_code || '').trim();
    if (actPc) return actPc;
  }

  let pc = String(opts.project_code || '').trim();
  const repairDate = opts.activity_date || actRow?.date || null;
  if (pc && repairDate && !projectCodeHasDateSuffix(pc)) {
    pc = repairProjectCodeDate(pc, repairDate);
  }
  return pc || null;
}

function applyActivityProjectCodeToOrder(order) {
  if (!order) return order;
  const actPc = String(order.activity_project_code || '').trim();
  if (actPc) order.project_code = actPc;
  return order;
}

/** 入库单台账对用户展示：活动出库 → 项目编号 + 场次辅助信息；非活动 → 手动填写的用途 */
function inboundReceiptDisplayLabels(row) {
  const standalone = String(row.link_mode || '') === 'standalone';
  if (standalone) {
    const main = String(row.purpose || '').trim();
    return { display_main: main || '—', display_sub: '' };
  }
  const pc = String(row.project_code || '').trim();
  const subParts = [];
  if (row.activity_city) subParts.push(String(row.activity_city).trim());
  if (row.activity_type) subParts.push(String(row.activity_type).trim());
  if (row.client_name) subParts.push(String(row.client_name).trim());
  return {
    display_main: pc || '—',
    display_sub: subParts.length ? subParts.join(' · ') : '',
  };
}

// ---------- 仓库 ----------
router.get('/warehouses', async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT w.id, w.brand_id, w.region, w.label, w.city, w.remarks, w.created_at,
             bi.brand_code, bi.brand_name
      FROM inv_warehouses w
      JOIN brand_inventory bi ON bi.id = w.brand_id
      ORDER BY bi.id, w.region
    `
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

router.post('/warehouses', async (req, res) => {
  try {
    const { brand_id, label, city, remarks } = req.body;
    const region = canonicalRegion(req.body.region);
    const bid = parseInt(brand_id, 10);
    if (!Number.isFinite(bid) || !region) {
      return res.status(400).json({ error: '请填写品牌与区域（东区/南区/北区/东南区）' });
    }
    const [result] = await db.query(
      'INSERT INTO inv_warehouses (brand_id, region, label, city, remarks) VALUES (?, ?, ?, ?, ?)',
      [
        bid,
        region,
        label ? String(label).trim() : null,
        city ? String(city).trim() : null,
        remarks ? String(remarks).trim() : null,
      ]
    );
    const [rows] = await db.query(
      `
      SELECT w.*, bi.brand_code, bi.brand_name FROM inv_warehouses w
      JOIN brand_inventory bi ON bi.id = w.brand_id WHERE w.id = ?
    `,
      [result.insertId]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '已存在相同品牌与区域的仓库' });
    console.error(e);
    res.status(500).json({ error: e.message || '创建失败' });
  }
});

router.put('/warehouses/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const { brand_id, label, city, remarks } = req.body;
    const region = canonicalRegion(req.body.region);
    const bid = parseInt(brand_id, 10);
    if (!Number.isFinite(bid) || !region) {
      return res.status(400).json({ error: '请填写品牌与区域（东区/南区/北区/东南区）' });
    }
    await db.query(
      'UPDATE inv_warehouses SET brand_id = ?, region = ?, label = ?, city = ?, remarks = ? WHERE id = ?',
      [
        bid,
        region,
        label ? String(label).trim() : null,
        city ? String(city).trim() : null,
        remarks ? String(remarks).trim() : null,
        id,
      ]
    );
    const [rows] = await db.query(
      `SELECT w.*, bi.brand_code, bi.brand_name FROM inv_warehouses w
       JOIN brand_inventory bi ON bi.id = w.brand_id WHERE w.id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: '仓库不存在' });
    res.json(rows[0]);
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '已存在相同品牌与区域的仓库' });
    console.error(e);
    res.status(500).json({ error: e.message || '更新失败' });
  }
});

router.delete('/warehouses/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    await db.query('DELETE FROM inv_warehouses WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '删除失败' });
  }
});

// ---------- 酒品对照排查（各仓物料 vs 酒品目录） ----------
router.get('/wine-audit', async (req, res) => {
  try {
    await ensureWineCatalog(db);
    const [catalogRows] = await db.query(
      'SELECT id, brand, name, category, volume_label FROM wine_catalog ORDER BY brand, name, id'
    );
    const catalogStrictKeys = new Set();
    const catalogUiKeys = new Set();
    const catalogNames = new Set();
    (catalogRows || []).forEach((c) => {
      const name = String(c.name || '').trim();
      if (name) catalogNames.add(name);
      catalogStrictKeys.add(invItemWineKey(c.name, wineCatalogSpecLine(c)));
      catalogUiKeys.add(invItemWineKey(c.name, wineCatalogSpecLineUi(c)));
    });

    const [itemRows] = await db.query(
      `
      SELECT i.id, i.inv_warehouse_id, i.name, i.dimensions, i.description, i.quantity_on_hand,
             i.is_common, i.is_wine, i.wine_label,
             w.region, w.label AS warehouse_label, w.city,
             b.brand_code, b.brand_name
      FROM inv_items i
      JOIN inv_warehouses w ON w.id = i.inv_warehouse_id
      LEFT JOIN brand_inventory b ON b.id = w.brand_id
      ORDER BY b.brand_code, w.region, i.name, i.id
      `
    );

    const whMap = new Map();
    let needsReviewTotal = 0;
    let specMismatchTotal = 0;
    let catalogOkTotal = 0;
    let suspectedTotal = 0;

    for (const row of itemRows || []) {
      const whId = Number(row.inv_warehouse_id);
      if (!whMap.has(whId)) {
        whMap.set(whId, {
          warehouse_id: whId,
          warehouse_label: formatWarehouseLabel(row.brand_code, row.region),
          region: row.region,
          brand_code: row.brand_code,
          brand_name: row.brand_name,
          city: row.city,
          warehouse_custom_label: row.warehouse_label,
          counts: {
            items_total: 0,
            suspected: 0,
            catalog_ok: 0,
            needs_review: 0,
            spec_mismatch: 0,
          },
          needs_review: [],
          spec_mismatch: [],
        });
      }
      const bucket = whMap.get(whId);
      bucket.counts.items_total += 1;
      const cls = classifyWineItemRow(row, catalogStrictKeys, catalogUiKeys, catalogNames);
      if (cls.suspected) {
        bucket.counts.suspected += 1;
        suspectedTotal += 1;
      }
      if (cls.catalogStatus === 'catalog_ok') {
        bucket.counts.catalog_ok += 1;
        catalogOkTotal += 1;
      }
      const entry = {
        id: row.id,
        name: row.name,
        dimensions: row.dimensions,
        description: row.description,
        quantity_on_hand: sqlAggNum(row.quantity_on_hand),
        is_common: Number(row.is_common) === 1,
        is_wine: Number(row.is_wine) === 1,
        wine_label: row.wine_label || null,
        catalog_status: cls.catalogStatus,
        suspected: cls.suspected,
        needs_review: cls.needsReview,
        catalog_status_label:
          cls.catalogStatus === 'catalog_ok'
            ? '已与目录一致'
            : cls.catalogStatus === 'catalog_spec_mismatch'
              ? '名称规格与目录不一致'
              : cls.catalogStatus === 'catalog_name_only'
                ? '名称在目录、规格未对齐'
                : '未在酒品目录',
      };
      if (cls.needsReview) {
        bucket.needs_review.push(entry);
        bucket.counts.needs_review += 1;
        needsReviewTotal += 1;
      }
      if (
        cls.catalogStatus === 'catalog_spec_mismatch' ||
        cls.catalogStatus === 'catalog_name_only'
      ) {
        bucket.spec_mismatch.push(entry);
        bucket.counts.spec_mismatch += 1;
        specMismatchTotal += 1;
      }
    }

    res.json({
      data: {
        summary: {
          catalog_count: catalogRows.length,
          warehouse_count: whMap.size,
          item_count: itemRows.length,
          suspected_count: suspectedTotal,
          catalog_ok_count: catalogOkTotal,
          needs_review_count: needsReviewTotal,
          spec_mismatch_count: specMismatchTotal,
        },
        rules: {
          catalog_match:
            '从酒品目录「添加酒品」入库时，规格字段仅保存目录中的容量（volume_label）；仓库筛「酒」若用「品类·容量」可能对不齐。',
          suspected:
            '名称/规格/说明含「数字+ml」或「毫升」，或名称含常见酒类词；名称含「空瓶」的库存行不计入疑似酒。',
        },
        warehouses: [...whMap.values()].filter(
          (w) => w.counts.needs_review > 0 || w.counts.spec_mismatch > 0 || w.counts.suspected > 0
        ),
        warehouses_all: [...whMap.values()],
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '酒品对照排查失败' });
  }
});

// ---------- 物料 ----------
router.get('/items', async (req, res) => {
  try {
    const whId = parseInt(req.query.inv_warehouse_id, 10);
    if (!Number.isFinite(whId)) return res.status(400).json({ error: '缺少 inv_warehouse_id' });
    const [rows] = await db.query(
      'SELECT * FROM inv_items WHERE inv_warehouse_id = ? ORDER BY is_common DESC, name, id',
      [whId]
    );
    const [obAgg] = await db.query(
      `
      SELECT ol.item_id, COALESCE(SUM(ol.quantity), 0) AS total_outbound
      FROM inv_outbound_lines ol
      JOIN inv_outbound_orders o ON o.id = ol.order_id
      WHERE o.inv_warehouse_id = ?
      GROUP BY ol.item_id
    `,
      [whId]
    );
    const [retAgg] = await db.query(
      `
      SELECT ol.item_id,
        COALESCE(SUM(rl.qty_damaged), 0) AS total_damaged,
        COALESCE(SUM(rl.qty_lost), 0) AS total_lost
      FROM inv_return_lines rl
      JOIN inv_outbound_lines ol ON ol.id = rl.outbound_line_id
      JOIN inv_outbound_orders o ON o.id = ol.order_id
      WHERE o.inv_warehouse_id = ?
      GROUP BY ol.item_id
    `,
      [whId]
    );
    const obMap = new Map(obAgg.map((r) => [Number(r.item_id), sqlAggNum(r.total_outbound)]));
    const retMap = new Map(
      retAgg.map((r) => [
        Number(r.item_id),
        { d: sqlAggNum(r.total_damaged), l: sqlAggNum(r.total_lost) },
      ]),
    );
    res.json(
      rows.map((r) => {
        const rid = Number(r.id);
        const rr = retMap.get(rid) || { d: 0, l: 0 };
        const dEff = r.stats_damaged_override != null ? sqlAggNum(r.stats_damaged_override) : rr.d;
        const lEff = r.stats_lost_override != null ? sqlAggNum(r.stats_lost_override) : rr.l;
        return {
          ...r,
          image_urls: parseImageUrls(r),
          total_outbound: obMap.get(rid) ?? 0,
          total_damaged: dEff,
          total_lost: lEff,
        };
      }),
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

router.get('/items/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [rows] = await db.query('SELECT * FROM inv_items WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: '物料不存在' });
    const row = rows[0];
    const whId = row.inv_warehouse_id;
    /** 标量子查询保证始终一行，避免 JOIN 无匹配时结果集为空导致累计全为 0 */
    const [aggRows] = await db.query(
      `
      SELECT
        (SELECT COALESCE(SUM(ol.quantity), 0)
         FROM inv_outbound_lines ol
         INNER JOIN inv_outbound_orders o ON o.id = ol.order_id
         WHERE o.inv_warehouse_id = ? AND ol.item_id = ?) AS total_outbound,
        (SELECT COALESCE(SUM(rl.qty_damaged), 0)
         FROM inv_return_lines rl
         INNER JOIN inv_outbound_lines ol ON ol.id = rl.outbound_line_id
         INNER JOIN inv_outbound_orders o ON o.id = ol.order_id
         WHERE o.inv_warehouse_id = ? AND ol.item_id = ?) AS total_damaged,
        (SELECT COALESCE(SUM(rl.qty_lost), 0)
         FROM inv_return_lines rl
         INNER JOIN inv_outbound_lines ol ON ol.id = rl.outbound_line_id
         INNER JOIN inv_outbound_orders o ON o.id = ol.order_id
         WHERE o.inv_warehouse_id = ? AND ol.item_id = ?) AS total_lost
    `,
      [whId, id, whId, id, whId, id]
    );
    const a = aggRows[0] || {};
    const aggDmg = sqlAggNum(a.total_damaged);
    const aggLost = sqlAggNum(a.total_lost);
    let td = aggDmg;
    let tl = aggLost;
    if (row.stats_damaged_override != null) td = sqlAggNum(row.stats_damaged_override);
    if (row.stats_lost_override != null) tl = sqlAggNum(row.stats_lost_override);
    res.json({
      ...row,
      image_urls: parseImageUrls(row),
      total_outbound: sqlAggNum(a.total_outbound),
      aggregated_total_damaged: aggDmg,
      aggregated_total_lost: aggLost,
      total_damaged: td,
      total_lost: tl,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

/** 物品关联场次用量：出库日期/数量 + 归还入库日期/数量（按项目编号）；酒类含回收明细 */
router.get('/items/:id/activity-usage', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    if (!Number.isFinite(itemId) || itemId <= 0) return res.status(400).json({ error: '无效物品 ID' });
    const [items] = await db.query(
      'SELECT id, name, is_wine, wine_label FROM inv_items WHERE id = ? LIMIT 1',
      [itemId]
    );
    if (!items.length) return res.status(404).json({ error: '物品不存在' });
    const itemRow = items[0];

    const [rows] = await db.query(
      `
      SELECT
        ol.id AS outbound_line_id,
        o.id AS outbound_order_id,
        COALESCE(NULLIF(TRIM(act.project_code), ''), NULLIF(TRIM(o.project_code), '')) AS project_code,
        o.shipped_at AS outbound_shipped_at,
        ol.quantity AS outbound_quantity,
        rl.id AS return_line_id,
        rb.return_date AS inbound_date,
        rl.qty_return AS inbound_quantity,
        rl.qty_empty_recovered,
        rl.qty_customer_keep,
        rl.qty_lost,
        rl.qty_damaged,
        rl.qty_consumed
      FROM inv_outbound_lines ol
      INNER JOIN inv_outbound_orders o ON o.id = ol.order_id
      LEFT JOIN activities act ON act.id = o.activity_id
      LEFT JOIN inv_return_lines rl ON rl.outbound_line_id = ol.id
      LEFT JOIN inv_return_batches rb ON rb.id = rl.batch_id
      WHERE ol.item_id = ?
        AND (
          o.activity_id IS NOT NULL
          OR NULLIF(TRIM(o.project_code), '') IS NOT NULL
          OR NULLIF(TRIM(act.project_code), '') IS NOT NULL
        )
      ORDER BY o.shipped_at DESC, rb.return_date DESC, rl.id DESC
    `,
      [itemId]
    );

    const mapped = rows.map((r) => ({
      outbound_line_id: Number(r.outbound_line_id),
      outbound_order_id: Number(r.outbound_order_id),
      project_code: r.project_code ? String(r.project_code).trim() : null,
      outbound_date: jsonYmd(r.outbound_shipped_at),
      outbound_quantity: sqlAggNum(r.outbound_quantity),
      inbound_date: r.return_line_id ? jsonYmd(r.inbound_date) : null,
      inbound_quantity: r.return_line_id ? sqlAggNum(r.inbound_quantity) : null,
      qty_empty_recovered: r.return_line_id ? sqlAggNum(r.qty_empty_recovered) : null,
      qty_customer_keep: r.return_line_id ? sqlAggNum(r.qty_customer_keep) : null,
      qty_lost: r.return_line_id ? sqlAggNum(r.qty_lost) : null,
      qty_damaged: r.return_line_id ? sqlAggNum(r.qty_damaged) : null,
      qty_consumed: r.return_line_id ? sqlAggNum(r.qty_consumed) : null,
    }));

    res.json({
      is_wine: Number(itemRow.is_wine) === 1,
      data: mapped,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载场次用量失败' });
  }
});

router.get('/empty-bottles/summary', async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT
        w.id AS inv_warehouse_id,
        w.region,
        bi.brand_code,
        i.id AS item_id,
        i.name,
        i.quantity_on_hand,
        i.updated_at
      FROM inv_items i
      JOIN inv_warehouses w ON w.id = i.inv_warehouse_id
      JOIN brand_inventory bi ON bi.id = w.brand_id
      WHERE i.name LIKE '%空瓶%'
      ORDER BY bi.brand_code, w.region, i.name, i.id
    `
    );
    const byWarehouse = new Map();
    rows.forEach((r) => {
      const key = `${r.inv_warehouse_id}`;
      if (!byWarehouse.has(key)) {
        byWarehouse.set(key, {
          inv_warehouse_id: Number(r.inv_warehouse_id),
          brand_code: r.brand_code,
          region: r.region,
          total_empty_bottles: 0,
          rows: [],
        });
      }
      const g = byWarehouse.get(key);
      const q = Math.max(0, parseInt(r.quantity_on_hand, 10) || 0);
      g.total_empty_bottles += q;
      g.rows.push({
        item_id: Number(r.item_id),
        name: r.name,
        quantity_on_hand: q,
        updated_at: r.updated_at,
      });
    });
    res.json(Array.from(byWarehouse.values()));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载空瓶回收汇总失败' });
  }
});

/**
 * 空瓶回收追溯：按 inv_items（空瓶物料）汇总归还登记行，回收时间 = 入库批次 created_at（填写登记时间）
 */
router.get('/empty-bottles/items/:itemId/trace', async (req, res) => {
  try {
    const monthRange = parseMonthRangeForSql(req.query.month);
    const itemId = parseInt(req.params.itemId, 10);
    if (!Number.isFinite(itemId) || itemId <= 0) return res.status(400).json({ error: '无效物品' });
    const [items] = await db.query(
      `SELECT i.id, i.name, i.description, i.quantity_on_hand, i.inv_warehouse_id,
              w.region, bi.brand_code
       FROM inv_items i
       JOIN inv_warehouses w ON w.id = i.inv_warehouse_id
       JOIN brand_inventory bi ON bi.id = w.brand_id
       WHERE i.id = ?`,
      [itemId]
    );
    if (!items.length) return res.status(404).json({ error: '物品不存在' });
    const emptyItem = items[0];
    const nm = String(emptyItem.name || '');
    const desc = String(emptyItem.description || '');
    if (!nm.includes('空瓶') && !desc.includes('空瓶')) {
      return res.status(400).json({ error: '仅支持空瓶类物料的回收追溯' });
    }
    const whId = Number(emptyItem.inv_warehouse_id);
    const targetName = nm;

    const [rawRows] = await db.query(
      `
      SELECT
        rl.id AS return_line_id,
        rl.qty_empty_recovered,
        rl.empty_bottle_item_id,
        rb.id AS batch_id,
        rb.created_at AS inbound_recorded_at,
        rb.return_date,
        o.id AS outbound_order_id,
        o.link_mode,
        o.purpose,
        COALESCE(NULLIF(TRIM(act.project_code), ''), NULLIF(TRIM(o.project_code), '')) AS project_code,
        act.city AS activity_city,
        act.activity_type AS activity_type,
        act.client_name AS client_name,
        it_src.name AS source_material_name
      FROM inv_return_lines rl
      INNER JOIN inv_return_batches rb ON rb.id = rl.batch_id
      INNER JOIN inv_outbound_orders o ON o.id = rb.outbound_order_id
      INNER JOIN inv_outbound_lines ol ON ol.id = rl.outbound_line_id
      INNER JOIN inv_items it_src ON it_src.id = ol.item_id
      LEFT JOIN activities act ON act.id = o.activity_id
      WHERE rl.qty_empty_recovered > 0
        AND o.inv_warehouse_id = ?
        ${monthRange ? 'AND rb.created_at >= ? AND rb.created_at < ?' : ''}
      ORDER BY rb.created_at DESC, rl.id DESC
    `,
      monthRange ? [whId, monthRange[0], monthRange[1]] : [whId]
    );

    const filtered = rawRows.filter((row) => {
      const eid = row.empty_bottle_item_id != null ? Number(row.empty_bottle_item_id) : null;
      if (Number.isFinite(eid) && eid > 0) return eid === itemId;
      return buildEmptyBottleName(row.source_material_name) === targetName;
    });

    const lines = filtered.map((r) => {
      const labels = inboundReceiptDisplayLabels({
        link_mode: r.link_mode,
        purpose: r.purpose,
        project_code: r.project_code,
        activity_city: r.activity_city,
        activity_type: r.activity_type,
        client_name: r.client_name,
      });
      return {
        return_line_id: Number(r.return_line_id),
        qty_empty_recovered: Math.max(0, parseInt(r.qty_empty_recovered, 10) || 0),
        inbound_recorded_at: r.inbound_recorded_at,
        return_date: r.return_date,
        batch_id: Number(r.batch_id),
        outbound_order_id: Number(r.outbound_order_id),
        /** 对应出库明细中的原物料名称（非空瓶库存名） */
        source_material_name: r.source_material_name,
        display_main: labels.display_main,
        display_sub: labels.display_sub,
      };
    });

    res.json({
      item: {
        id: Number(emptyItem.id),
        name: emptyItem.name,
        quantity_on_hand: Math.max(0, parseInt(emptyItem.quantity_on_hand, 10) || 0),
        inv_warehouse_id: whId,
        brand_code: emptyItem.brand_code,
        region: emptyItem.region,
      },
      lines,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载空瓶追溯失败' });
  }
});

router.post('/items', async (req, res) => {
  try {
    const {
      inv_warehouse_id,
      name,
      description,
      dimensions,
      initial_quantity,
      alert_below,
      image_urls,
      is_common,
      is_wine,
      wine_label,
    } = req.body;
    const whId = parseInt(inv_warehouse_id, 10);
    const initQ = Math.max(0, parseInt(initial_quantity, 10) || 0);
    if (!Number.isFinite(whId) || !String(name || '').trim()) {
      return res.status(400).json({ error: '请填写仓库与物品名称' });
    }
    let urls = image_urls;
    if (urls != null && !Array.isArray(urls)) urls = [];
    const common = Boolean(is_common);
    const wineFlag = Boolean(is_wine);
    const wl = String(wine_label || '').trim() || null;
    const [result] = await db.query(
      `INSERT INTO inv_items (inv_warehouse_id, name, description, dimensions, initial_quantity, quantity_on_hand, alert_below, image_urls, is_common, is_wine, wine_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        whId,
        String(name).trim(),
        description || null,
        dimensions || null,
        initQ,
        initQ,
        alert_below != null && alert_below !== '' ? parseInt(alert_below, 10) : null,
        JSON.stringify(urls || []),
        common ? 1 : 0,
        wineFlag ? 1 : 0,
        wl,
      ]
    );
    const [rows] = await db.query('SELECT * FROM inv_items WHERE id = ?', [result.insertId]);
    const row = rows[0];
    res.json({ ...row, image_urls: parseImageUrls(row) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '保存失败' });
  }
});

router.post('/items/from-catalog', async (req, res) => {
  try {
    await ensureWineCatalog(db);
    const whId = parseInt(req.body?.inv_warehouse_id, 10);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!Number.isFinite(whId) || whId <= 0) {
      return res.status(400).json({ error: '缺少 inv_warehouse_id' });
    }
    if (!items.length) {
      return res.status(400).json({ error: '请选择至少一条酒品目录' });
    }
    const ids = [
      ...new Set(
        items
          .map((it) => parseInt(it?.catalog_id, 10))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];
    if (!ids.length) return res.status(400).json({ error: '目录项无效' });

    const [whRows] = await db.query('SELECT id FROM inv_warehouses WHERE id = ? LIMIT 1', [whId]);
    if (!whRows.length) return res.status(404).json({ error: '仓库不存在' });

    const ph = ids.map(() => '?').join(', ');
    const [catalogRows] = await db.query(
      `SELECT id, brand, name, category, volume_label, image_urls
       FROM wine_catalog
       WHERE id IN (${ph})`,
      ids,
    );
    const catalogById = new Map(catalogRows.map((r) => [Number(r.id), r]));

    let inserted = 0;
    let skippedExisting = 0;
    for (const raw of items) {
      const catalogId = parseInt(raw?.catalog_id, 10);
      if (!Number.isFinite(catalogId) || catalogId <= 0) continue;
      const c = catalogById.get(catalogId);
      if (!c) continue;
      const qRaw = parseInt(raw?.quantity, 10);
      const qty = Number.isFinite(qRaw) && qRaw > 0 ? qRaw : 0;
      const spec = wineCatalogSpecLine(c);
      const [exist] = await db.query(
        'SELECT id FROM inv_items WHERE inv_warehouse_id = ? AND name = ? AND COALESCE(dimensions, \'\') = COALESCE(?, \'\') LIMIT 1',
        [whId, String(c.name || '').trim(), spec || null],
      );
      if (exist.length) {
        skippedExisting += 1;
        continue;
      }
      let urls = [];
      try {
        const parsed = typeof c.image_urls === 'string' ? JSON.parse(c.image_urls) : c.image_urls;
        if (Array.isArray(parsed)) urls = parsed;
      } catch (_) {
        urls = [];
      }
      const wineLbl = defaultWineLabelFromCatalog(c);
      await db.query(
        `INSERT INTO inv_items (inv_warehouse_id, name, description, dimensions, initial_quantity, quantity_on_hand, alert_below, image_urls, is_common, is_wine, wine_label)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 1, ?)`,
        [
          whId,
          String(c.name || '').trim(),
          null,
          spec || null,
          qty,
          qty,
          JSON.stringify(urls),
          wineLbl || null,
        ],
      );
      inserted += 1;
    }

    res.json({
      ok: true,
      inserted,
      skipped_existing: skippedExisting,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '批量添加失败' });
  }
});

/** 物品目录（全局主数据）：用于新仓库快速导入物料 */
router.get('/item-catalog', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, dimensions, description, image_urls, is_common, source_brands, source_regions, created_at, updated_at
       FROM inv_item_catalog
       ORDER BY is_common DESC, name ASC, id ASC`,
    );
    res.json(
      rows.map((r) => ({
        ...r,
        image_urls: parseImageUrls(r),
      })),
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '获取物品目录失败' });
  }
});

/** 从现有仓库物料同步生成目录（PHD/X.O/CLUB；X.O 限东区和东南区） */
router.post('/item-catalog/sync-from-warehouses', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT i.name, i.dimensions, i.description, i.image_urls, i.is_common, bi.brand_code, w.region
       FROM inv_items i
       INNER JOIN inv_warehouses w ON w.id = i.inv_warehouse_id
       INNER JOIN brand_inventory bi ON bi.id = w.brand_id
       WHERE (
          bi.brand_code IN ('PHD', 'CLUB')
          OR (bi.brand_code = 'X.O' AND w.region IN ('东区', '东南区'))
       )
       ORDER BY i.id ASC`,
    );
    const picked = Array.isArray(rows) ? rows : [];
    const byKey = new Map();
    for (const r of picked) {
      const name = String(r.name || '').trim();
      if (!name) continue;
      const dim = String(r.dimensions || '').trim();
      const key = itemCatalogUniqueKey(name, dim);
      if (!byKey.has(key)) {
        byKey.set(key, {
          name,
          dimensions: dim || null,
          description: String(r.description || '').trim() || null,
          image_urls: parseImageUrls(r),
          is_common: r.is_common ? 1 : 0,
          brands: new Set(),
          regions: new Set(),
        });
      }
      const cur = byKey.get(key);
      if (!cur.description && r.description) cur.description = String(r.description).trim();
      if ((!cur.image_urls || !cur.image_urls.length) && parseImageUrls(r).length) cur.image_urls = parseImageUrls(r);
      if (r.is_common) cur.is_common = 1;
      if (r.brand_code) cur.brands.add(String(r.brand_code).trim());
      if (r.region) cur.regions.add(String(r.region).trim());
    }

    let inserted = 0;
    let updated = 0;
    for (const v of byKey.values()) {
      const sourceBrands = [...v.brands].filter(Boolean).sort().join('、') || null;
      const sourceRegions = [...v.regions].filter(Boolean).sort().join('、') || null;
      const [exist] = await db.query(
        `SELECT id, source_brands, source_regions FROM inv_item_catalog
         WHERE name = ? AND COALESCE(dimensions, '') = COALESCE(?, '')
         LIMIT 1`,
        [v.name, v.dimensions || null],
      );
      if (exist.length) {
        const old = exist[0];
        const mergedBrands = [
          ...new Set([
            ...String(old.source_brands || '')
              .split('、')
              .map((x) => x.trim())
              .filter(Boolean),
            ...String(sourceBrands || '')
              .split('、')
              .map((x) => x.trim())
              .filter(Boolean),
          ]),
        ]
          .sort()
          .join('、') || null;
        const mergedRegions = [
          ...new Set([
            ...String(old.source_regions || '')
              .split('、')
              .map((x) => x.trim())
              .filter(Boolean),
            ...String(sourceRegions || '')
              .split('、')
              .map((x) => x.trim())
              .filter(Boolean),
          ]),
        ]
          .sort()
          .join('、') || null;
        await db.query(
          `UPDATE inv_item_catalog
           SET description = COALESCE(?, description),
               image_urls = CASE WHEN COALESCE(?, '') <> '' THEN ? ELSE image_urls END,
               is_common = GREATEST(COALESCE(is_common, 0), ?),
               source_brands = ?,
               source_regions = ?
           WHERE id = ?`,
          [
            v.description || null,
            JSON.stringify(v.image_urls || []),
            JSON.stringify(v.image_urls || []),
            v.is_common ? 1 : 0,
            mergedBrands,
            mergedRegions,
            old.id,
          ],
        );
        updated += 1;
      } else {
        await db.query(
          `INSERT INTO inv_item_catalog
           (name, dimensions, description, image_urls, is_common, source_brands, source_regions)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            v.name,
            v.dimensions || null,
            v.description || null,
            JSON.stringify(v.image_urls || []),
            v.is_common ? 1 : 0,
            sourceBrands,
            sourceRegions,
          ],
        );
        inserted += 1;
      }
    }

    res.json({ ok: true, total_source_rows: picked.length, unique_items: byKey.size, inserted, updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '同步物品目录失败' });
  }
});

/** 从物品目录添加到仓库：相同名称+规格不重复添加 */
router.post('/items/from-item-catalog', async (req, res) => {
  try {
    const whId = parseInt(req.body?.inv_warehouse_id, 10);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!Number.isFinite(whId) || whId <= 0) {
      return res.status(400).json({ error: '缺少 inv_warehouse_id' });
    }
    if (!items.length) {
      return res.status(400).json({ error: '请选择至少一条物品目录' });
    }
    const ids = [
      ...new Set(
        items
          .map((it) => parseInt(it?.catalog_id, 10))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];
    if (!ids.length) return res.status(400).json({ error: '目录项无效' });

    const [whRows] = await db.query('SELECT id FROM inv_warehouses WHERE id = ? LIMIT 1', [whId]);
    if (!whRows.length) return res.status(404).json({ error: '仓库不存在' });

    const ph = ids.map(() => '?').join(', ');
    const [catalogRows] = await db.query(
      `SELECT id, name, dimensions, description, image_urls, is_common
       FROM inv_item_catalog
       WHERE id IN (${ph})`,
      ids,
    );
    const catalogById = new Map(catalogRows.map((r) => [Number(r.id), r]));

    let inserted = 0;
    let skippedExisting = 0;
    for (const raw of items) {
      const catalogId = parseInt(raw?.catalog_id, 10);
      if (!Number.isFinite(catalogId) || catalogId <= 0) continue;
      const c = catalogById.get(catalogId);
      if (!c) continue;
      const qRaw = parseInt(raw?.quantity, 10);
      const qty = Number.isFinite(qRaw) && qRaw > 0 ? qRaw : 0;
      const [exist] = await db.query(
        'SELECT id FROM inv_items WHERE inv_warehouse_id = ? AND name = ? AND COALESCE(dimensions, \'\') = COALESCE(?, \'\') LIMIT 1',
        [whId, String(c.name || '').trim(), c.dimensions || null],
      );
      if (exist.length) {
        skippedExisting += 1;
        continue;
      }
      await db.query(
        `INSERT INTO inv_items (inv_warehouse_id, name, description, dimensions, initial_quantity, quantity_on_hand, alert_below, image_urls, is_common)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          whId,
          String(c.name || '').trim(),
          c.description || null,
          c.dimensions || null,
          qty,
          qty,
          JSON.stringify(parseImageUrls(c)),
          c.is_common ? 1 : 0,
        ],
      );
      inserted += 1;
    }

    res.json({
      ok: true,
      inserted,
      skipped_existing: skippedExisting,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '批量添加失败' });
  }
});

router.put('/items/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const {
      name,
      description,
      dimensions,
      alert_below,
      image_urls,
      is_common,
      is_wine,
      wine_label,
      quantity_on_hand,
      stats_damaged_override,
      stats_lost_override,
    } = req.body;
    const patches = [];
    const vals = [];
    if (quantity_on_hand !== undefined) {
      const q = parseInt(quantity_on_hand, 10);
      if (!Number.isFinite(q) || q < 0) {
        return res.status(400).json({ error: '当前库存须为非负整数' });
      }
      patches.push('quantity_on_hand = ?');
      vals.push(q);
    }
    if (name != null) {
      patches.push('name = ?');
      vals.push(String(name).trim());
    }
    if (description !== undefined) {
      patches.push('description = ?');
      vals.push(description || null);
    }
    if (dimensions !== undefined) {
      patches.push('dimensions = ?');
      vals.push(dimensions || null);
    }
    if (alert_below !== undefined) {
      patches.push('alert_below = ?');
      vals.push(alert_below != null && alert_below !== '' ? parseInt(alert_below, 10) : null);
    }
    if (image_urls !== undefined) {
      patches.push('image_urls = ?');
      vals.push(JSON.stringify(Array.isArray(image_urls) ? image_urls : []));
    }
    if (is_common !== undefined) {
      patches.push('is_common = ?');
      vals.push(Boolean(is_common) ? 1 : 0);
    }
    if (is_wine !== undefined) {
      patches.push('is_wine = ?');
      vals.push(Boolean(is_wine) ? 1 : 0);
    }
    if (wine_label !== undefined) {
      const wl = String(wine_label || '').trim();
      patches.push('wine_label = ?');
      vals.push(wl || null);
    }
    if (stats_damaged_override !== undefined) {
      if (stats_damaged_override === null || stats_damaged_override === '') {
        patches.push('stats_damaged_override = NULL');
      } else {
        const v = parseInt(stats_damaged_override, 10);
        if (!Number.isFinite(v) || v < 0) {
          return res.status(400).json({ error: '损坏（累计）须为非负整数或留空' });
        }
        patches.push('stats_damaged_override = ?');
        vals.push(v);
      }
    }
    if (stats_lost_override !== undefined) {
      if (stats_lost_override === null || stats_lost_override === '') {
        patches.push('stats_lost_override = NULL');
      } else {
        const v = parseInt(stats_lost_override, 10);
        if (!Number.isFinite(v) || v < 0) {
          return res.status(400).json({ error: '丢失（累计）须为非负整数或留空' });
        }
        patches.push('stats_lost_override = ?');
        vals.push(v);
      }
    }
    if (!patches.length) return res.status(400).json({ error: '无更新字段' });
    vals.push(id);
    await db.query(`UPDATE inv_items SET ${patches.join(', ')} WHERE id = ?`, vals);
    const [rows] = await db.query('SELECT * FROM inv_items WHERE id = ?', [id]);
    const row = rows[0];
    res.json({ ...row, image_urls: parseImageUrls(row) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '更新失败' });
  }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    await db.query('DELETE FROM inv_items WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '删除失败' });
  }
});

router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '上传失败' });
    try {
      if (!req.file) return res.status(400).json({ error: '未选择文件' });
      const url = `/uploads/inventory/${req.file.filename}`;
      res.json({ url, filename: req.file.filename });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || '上传失败' });
    }
  });
});

// ---------- 项目编号 → 建议仓库 ----------
router.get('/hints/project', async (req, res) => {
  try {
    const yfid = parseInt(req.query.year_frame_id, 10);
    const project_code = String(req.query.project_code || '').trim();
    if (!Number.isFinite(yfid) || !project_code) {
      return res.json({ activity_id: null, brand_id: null, suggested_warehouse_id: null, activity_region: null });
    }
    const [acts] = await db.query(
      'SELECT id, brand, region FROM activities WHERE year_frame_id = ? AND project_code = ? LIMIT 1',
      [yfid, project_code]
    );
    if (!acts.length) {
      return res.json({ activity_id: null, brand_id: null, suggested_warehouse_id: null, activity_region: null, message: '未找到匹配场次' });
    }
    const a = acts[0];
    const brand_id = await resolveBrandId(a.brand);
    const hr = hintRegionFromActivityRegion(a.region);
    let suggested_warehouse_id = null;
    if (brand_id && hr) {
      const [wh] = await db.query(
        'SELECT id FROM inv_warehouses WHERE brand_id = ? AND region = ? LIMIT 1',
        [brand_id, hr]
      );
      if (wh.length) suggested_warehouse_id = wh[0].id;
    }
    res.json({
      activity_id: a.id,
      brand_id,
      suggested_warehouse_id,
      activity_region: a.region,
      hint_region: hr,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '解析失败' });
  }
});

async function loadOrderDetail(orderId) {
  // 注意：SELECT 顺序很关键——act.activity_date 必须用别名 activity_date_link，
  // 否则会与 o.* 中的 o.activity_date 重名，mysql2 会用最后一个覆盖前面，丢失关联活动的日期作为后备。
  const [orders] = await db.query(
    `
    SELECT o.*,
           wh.region, wh.brand_id, bi.brand_code, bi.brand_name,
           act.project_code AS activity_project_code,
           act.activity_date AS activity_date_link,
           ayf.year AS activity_year_label
    FROM inv_outbound_orders o
    LEFT JOIN inv_warehouses wh ON wh.id = o.inv_warehouse_id
    LEFT JOIN brand_inventory bi ON bi.id = wh.brand_id
    LEFT JOIN activities act ON act.id = o.activity_id
    LEFT JOIN year_frames ayf ON ayf.id = act.year_frame_id
    WHERE o.id = ?
  `,
    [orderId]
  );
  if (!orders.length) return null;
  const o = orders[0];
  const [lines] = await db.query(
    `
    SELECT ol.*, it.name AS item_name, it.dimensions AS item_dimensions,
           it.inv_warehouse_id,
           wh.region AS line_region,
           bi.brand_code AS line_brand_code
    FROM inv_outbound_lines ol
    JOIN inv_items it ON it.id = ol.item_id
    LEFT JOIN inv_warehouses wh ON wh.id = it.inv_warehouse_id
    LEFT JOIN brand_inventory bi ON bi.id = wh.brand_id
    WHERE ol.order_id = ?
    ORDER BY ol.id
  `,
    [orderId]
  );
  const [batches] = await db.query(
    `
    SELECT rb.*, wh.region AS inbound_region, bi.brand_code AS inbound_brand_code, bi.brand_name AS inbound_brand_name
    FROM inv_return_batches rb
    LEFT JOIN inv_warehouses wh ON wh.id = rb.inbound_warehouse_id
    LEFT JOIN brand_inventory bi ON bi.id = wh.brand_id
    WHERE rb.outbound_order_id = ?
    ORDER BY rb.id DESC
  `,
    [orderId]
  );
  const batchIds = batches.map((b) => b.id);
  let returnLinesByBatch = {};
  if (batchIds.length) {
    const [rls] = await db.query(
      `SELECT rl.* FROM inv_return_lines rl WHERE rl.batch_id IN (${batchIds.map(() => '?').join(',')})`,
      batchIds
    );
    returnLinesByBatch = rls.reduce((acc, row) => {
      if (!acc[row.batch_id]) acc[row.batch_id] = [];
      acc[row.batch_id].push(row);
      return acc;
    }, {});
  }
  return { order: o, lines, batches: batches.map((b) => ({ ...b, lines: returnLinesByBatch[b.id] || [] })) };
}

// ---------- 出库（创建即出库） ----------
router.post('/outbound', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const {
      inv_warehouse_id,
      link_mode,
      project_code,
      purpose,
      activity_id,
      shipped_at,
      activity_date,
      recipient_city,
      recipient_address,
      contact_name,
      contact_phone,
      logistics_supplier,
      logistics_method,
      tracking_number,
      remarks,
      lines,
      year_frame_id,
    } = req.body;
    const whId = parseInt(inv_warehouse_id, 10);
    const lm = link_mode === 'standalone' ? 'standalone' : 'activity';
    const op = (req.session && req.session.user && req.session.user.username) || '';

    if (!Array.isArray(lines) || !lines.length) {
      return res.status(400).json({ error: '请填写出库明细' });
    }
    if (lm === 'activity' && !String(project_code || '').trim()) {
      return res.status(400).json({ error: '关联场次出库请填写项目编号' });
    }
    if (lm === 'standalone' && !String(purpose || '').trim()) {
      return res.status(400).json({ error: '非项目出库请填写用途说明' });
    }
    const trackingNumber = tracking_number != null && String(tracking_number).trim() !== '' ? String(tracking_number).trim() : null;
    const shippedAtDb = parseOutboundShippedAtInput(shipped_at) || new Date();
    const activityDateDb = parseActivityDateInput(activity_date);

    await conn.beginTransaction();

    let resolvedActivityId = null;
    if (lm === 'activity') {
      try {
        resolvedActivityId = await resolveOutboundActivityId(conn, project_code, activity_id, year_frame_id);
      } catch (e) {
        await conn.rollback();
        return res.status(e.statusCode || 400).json({ error: e.message || '场次解析失败' });
      }
    }

    let headerWhId = Number.isFinite(whId) ? whId : null;
    if (!headerWhId) {
      const firstItemId = parseInt(lines[0]?.item_id, 10);
      if (Number.isFinite(firstItemId)) {
        const [it0] = await conn.query('SELECT inv_warehouse_id FROM inv_items WHERE id = ? LIMIT 1', [firstItemId]);
        if (it0.length) headerWhId = Number(it0[0].inv_warehouse_id);
      }
    }
    if (!headerWhId) throw new Error('无法识别仓库，请检查出库明细');

    const storedProjectCode = await canonicalOutboundProjectCode(conn, {
      link_mode: lm,
      project_code,
      activity_id: resolvedActivityId,
      activity_date: activityDateDb,
    });

    const [result] = await conn.query(
      `
      INSERT INTO inv_outbound_orders (
        inv_warehouse_id, activity_id, link_mode, project_code, purpose,
        recipient_city, recipient_address, contact_name, contact_phone, logistics_supplier, logistics_method, tracking_number,
        status, shipped_at, activity_date, operator, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shipped', ?, ?, ?, ?)
    `,
      [
        headerWhId,
        resolvedActivityId,
        lm,
        storedProjectCode,
        lm === 'standalone' ? String(purpose).trim() : null,
        recipient_city || null,
        recipient_address || null,
        contact_name || null,
        contact_phone || null,
        logistics_supplier != null && String(logistics_supplier).trim() !== ''
          ? String(logistics_supplier).trim()
          : null,
        logistics_method || null,
        trackingNumber,
        shippedAtDb,
        activityDateDb,
        op,
        remarks || null,
      ]
    );
    const orderId = result.insertId;

    for (const ln of lines) {
      const itemId = parseInt(ln.item_id, 10);
      const qty = parseInt(ln.quantity, 10);
      const lineNote = ln.line_note || null;
      if (!Number.isFinite(itemId) || !Number.isFinite(qty) || qty <= 0) {
        throw new Error('明细行数量无效');
      }
      const [itRows] = await conn.query(
        'SELECT id, inv_warehouse_id, quantity_on_hand FROM inv_items WHERE id = ? FOR UPDATE',
        [itemId]
      );
      if (!itRows.length) throw new Error('物料不存在');
      const onHand = Number(itRows[0].quantity_on_hand);
      if (onHand < qty) throw new Error(`「${itemId}」库存不足（当前 ${onHand}）`);
      await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', [qty, itemId]);
      await conn.query(
        'INSERT INTO inv_outbound_lines (order_id, item_id, quantity, line_note) VALUES (?, ?, ?, ?)',
        [orderId, itemId, qty, lineNote]
      );
    }

    await conn.commit();
    const detail = await loadOrderDetail(orderId);
    res.json(serializeOrderDetailForJson(detail));
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message || '出库失败' });
  } finally {
    conn.release();
  }
});

/**
 * 台账月份下界/上界（与出库、入库单、空瓶追溯同一财年规则），用于下拉从「最早有记录」月份开始
 */
router.get('/ledger-month-range', async (req, res) => {
  try {
    const yfRaw = req.query.yearFrameId ?? req.query.year_frame_id;
    const yfId = parseInt(yfRaw, 10);
    const fiscalClause = Number.isFinite(yfId)
      ? ` AND (
        (o.activity_id IS NOT NULL AND act.year_frame_id = ?)
        OR (o.link_mode = 'standalone' AND o.activity_id IS NULL)
        OR (
          o.activity_id IS NULL
          AND o.link_mode = 'activity'
          AND TRIM(COALESCE(o.project_code, '')) <> ''
          AND EXISTS (
            SELECT 1 FROM activities act_yf
            WHERE act_yf.project_code = o.project_code AND act_yf.year_frame_id = ?
          )
        )
      )`
      : '';
    const fiscalParams = Number.isFinite(yfId) ? [yfId, yfId] : [];

    const sqlOb = `
      SELECT
        MIN(COALESCE(o.shipped_at, o.created_at)) AS tmin,
        MAX(COALESCE(o.shipped_at, o.created_at)) AS tmax
      FROM inv_outbound_orders o
      LEFT JOIN activities act ON act.id = o.activity_id
      WHERE COALESCE(o.shipped_at, o.created_at) IS NOT NULL
      ${fiscalClause}
    `;
    const sqlRb = `
      SELECT
        MIN(rb.created_at) AS tmin,
        MAX(rb.created_at) AS tmax
      FROM inv_return_batches rb
      INNER JOIN inv_outbound_orders o ON o.id = rb.outbound_order_id
      LEFT JOIN activities act ON act.id = o.activity_id
      WHERE rb.created_at IS NOT NULL
      ${fiscalClause}
    `;

    const [[obRow]] = await db.query(sqlOb, fiscalParams);
    const [[rbRow]] = await db.query(sqlRb, fiscalParams);

    const toDate = (v) => {
      if (v == null) return null;
      const d = v instanceof Date ? v : new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const candidates = [toDate(obRow?.tmin), toDate(obRow?.tmax), toDate(rbRow?.tmin), toDate(rbRow?.tmax)].filter(Boolean);
    if (!candidates.length) {
      return res.json({ min_month: null, max_month: null });
    }

    const tmin = new Date(Math.min(...candidates.map((d) => d.getTime())));
    const tmax = new Date(Math.max(...candidates.map((d) => d.getTime())));

    const toYm = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let minMonth = toYm(tmin);
    let maxMonth = toYm(tmax);

    const now = new Date();
    const capYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (maxMonth > capYm) maxMonth = capYm;
    if (minMonth > maxMonth) {
      minMonth = maxMonth;
    }

    res.json({ min_month: minMonth, max_month: maxMonth });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载月份范围失败' });
  }
});

router.get('/outbound', async (req, res) => {
  try {
    const st = req.query.status;
    const monthRange = parseMonthRangeForSql(req.query.month);
    const yfRaw = req.query.yearFrameId ?? req.query.year_frame_id;
    const yfId = parseInt(yfRaw, 10);
    // activity_date 优先取出库单上自填的 o.activity_date，
    // 没填则 fallback 到关联活动 act.activity_date（兼容老数据）；
    // 同时保留 act.activity_date 作为联动展示字段。
    let sql = `
      SELECT o.id, o.activity_id,
             COALESCE(NULLIF(TRIM(act.project_code), ''), NULLIF(TRIM(o.project_code), '')) AS project_code,
             o.purpose, o.link_mode, o.status, o.shipped_at, o.recipient_city,
             o.contact_name, o.contact_phone, o.logistics_supplier, o.recipient_address, o.remarks,
             o.logistics_method, o.tracking_number, o.created_at,
             wh.region, bi.brand_code,
             COALESCE(o.activity_date, act.date, act.activity_date) AS activity_date,
             act.city AS activity_city,
             (SELECT COUNT(*) FROM inv_outbound_lines ol WHERE ol.order_id = o.id) AS line_count,
             (SELECT GROUP_CONCAT(CONCAT_WS(' ', it.name, CONCAT('×', ol2.quantity), NULLIF(it.dimensions, '')) ORDER BY it.name SEPARATOR ' / ')
                FROM inv_outbound_lines ol2
                JOIN inv_items it ON it.id = ol2.item_id
                WHERE ol2.order_id = o.id) AS items_summary,
             (SELECT COUNT(*) FROM inv_return_batches rb WHERE rb.outbound_order_id = o.id) AS return_batch_count,
             (SELECT COALESCE(SUM(GREATEST(0, ol.quantity - COALESCE((
                SELECT SUM(${RETURN_LINE_ACCOUNTED_SUM_SQL})
                FROM inv_return_lines rl WHERE rl.outbound_line_id = ol.id
              ), 0))), 0)
              FROM inv_outbound_lines ol WHERE ol.order_id = o.id) AS qty_unaccounted
      FROM inv_outbound_orders o
      JOIN inv_warehouses wh ON wh.id = o.inv_warehouse_id
      JOIN brand_inventory bi ON bi.id = wh.brand_id
      LEFT JOIN activities act ON act.id = o.activity_id
      WHERE 1=1
    `;
    const params = [];
    if (st === 'open') {
      sql += ' AND o.status = ?';
      params.push('shipped');
    } else if (st === 'closed') {
      sql += ' AND o.status = ?';
      params.push('closed');
    }
    if (Number.isFinite(yfId)) {
      sql += ` AND (
        (o.activity_id IS NOT NULL AND act.year_frame_id = ?)
        OR (o.link_mode = 'standalone' AND o.activity_id IS NULL)
        OR (
          o.activity_id IS NULL
          AND o.link_mode = 'activity'
          AND TRIM(COALESCE(o.project_code, '')) <> ''
          AND EXISTS (
            SELECT 1 FROM activities act_yf
            WHERE act_yf.project_code = o.project_code AND act_yf.year_frame_id = ?
          )
        )
      )`;
      params.push(yfId, yfId);
    }
    if (monthRange) {
      sql += ' AND COALESCE(o.shipped_at, o.created_at) >= ? AND COALESCE(o.shipped_at, o.created_at) < ?';
      params.push(monthRange[0], monthRange[1]);
    }
    sql += ' ORDER BY o.id DESC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

/** 将出库单 project_code 与关联场次对齐，并补全缺 YYMMDD 的编号 */
router.post('/outbound/repair-project-codes', async (req, res) => {
  try {
    const yfRaw = req.body?.yearFrameId ?? req.body?.year_frame_id ?? req.query?.yearFrameId;
    const yfId = parseInt(yfRaw, 10);
    const yfClause = Number.isFinite(yfId) ? ' AND act.year_frame_id = ?' : '';
    const yfParams = Number.isFinite(yfId) ? [yfId] : [];

    const [syncR] = await db.query(
      `
      UPDATE inv_outbound_orders o
      INNER JOIN activities act ON act.id = o.activity_id
      SET o.project_code = act.project_code
      WHERE TRIM(COALESCE(act.project_code, '')) <> ''
        AND (o.project_code IS NULL OR TRIM(o.project_code) <> TRIM(act.project_code))
        ${yfClause}
    `,
      yfParams
    );
    const synced = Number(syncR?.affectedRows || 0);

    let selSql = `
      SELECT o.id, o.project_code, o.activity_id,
             COALESCE(o.activity_date, act.date) AS repair_date
      FROM inv_outbound_orders o
      LEFT JOIN activities act ON act.id = o.activity_id
      WHERE (o.link_mode = 'activity' OR o.activity_id IS NOT NULL)
        AND TRIM(COALESCE(o.project_code, '')) <> ''
        AND o.project_code NOT REGEXP '^[^ ]+ [0-9]{6}'
    `;
    const selParams = [];
    if (Number.isFinite(yfId)) {
      selSql += ' AND (act.year_frame_id = ? OR (o.activity_id IS NULL AND o.id IN (SELECT o2.id FROM inv_outbound_orders o2 INNER JOIN activities a2 ON a2.project_code = o2.project_code WHERE a2.year_frame_id = ?)))';
      selParams.push(yfId, yfId);
    }
    const [rows] = await db.query(selSql, selParams);
    let repaired = 0;
    for (const row of rows) {
      const next = repairProjectCodeDate(row.project_code, row.repair_date);
      if (!next || next === row.project_code || !projectCodeHasDateSuffix(next)) continue;
      await db.query('UPDATE inv_outbound_orders SET project_code = ? WHERE id = ?', [next, row.id]);
      repaired += 1;
    }

    res.json({
      synced,
      repaired,
      scanned: rows.length,
      message: `出库单：已与场次同步 ${synced} 条，补全日期 ${repaired} 条`,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '修复失败' });
  }
});

router.get('/outbound/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const detail = await loadOrderDetail(id);
    if (!detail) return res.status(404).json({ error: '单据不存在' });
    res.json(serializeOrderDetailForJson(detail));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

/** 物料入库：增加仓库物品库存并记录入库来源 */
router.post('/inbound', async (req, res) => {
  try {
    const db = require('../config/database');
    const { inv_warehouse_id, inv_item_id, quantity, items, source, remarks, inbound_date } = req.body;
    const wid = parseInt(inv_warehouse_id, 10);
    if (!Number.isFinite(wid)) return res.status(400).json({ error: '请选择有效仓库' });
    const date = parseReturnDateInput(inbound_date);
    const operator = req.session?.user?.display_name || req.session?.user?.username || '系统';
    const itemList = Array.isArray(items) && items.length
      ? items
      : (inv_item_id != null ? [{ inv_item_id, quantity }] : []);
    if (!itemList.length) return res.status(400).json({ error: '请至少选择一个物品' });
    const ids = [];
    for (const it of itemList) {
      const iid = parseInt(it.inv_item_id, 10);
      const qty = parseInt(it.quantity, 10);
      if (!Number.isFinite(iid) || !Number.isFinite(qty) || qty <= 0) continue;
      const [itemRows] = await db.query('SELECT id FROM inv_items WHERE id = ? AND inv_warehouse_id = ? LIMIT 1', [iid, wid]);
      if (!itemRows.length) continue;
      await db.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [qty, iid]);
      const [result] = await db.query(
        'INSERT INTO inv_inbound_records (inv_warehouse_id, inv_item_id, quantity, source, operator, remarks, inbound_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [wid, iid, qty, source || null, operator, remarks || null, date],
      );
      ids.push(result.insertId);
    }
    if (!ids.length) return res.status(400).json({ error: '没有有效的物品被入库' });
    res.json({ data: { ids, count: ids.length } });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message || '入库失败' });
  }
});

/** 物料入库记录列表 */
router.get('/inbound', async (req, res) => {
  try {
    const wid = parseInt(req.query.inv_warehouse_id, 10);
    let sql = `
      SELECT r.id, r.inv_warehouse_id, r.inv_item_id, r.quantity, r.source, r.operator, r.remarks, r.inbound_date, r.created_at,
             i.name AS item_name, i.dimensions AS item_dimensions,
             wh.region, bi.brand_code
      FROM inv_inbound_records r
      JOIN inv_items i ON i.id = r.inv_item_id
      JOIN inv_warehouses wh ON wh.id = r.inv_warehouse_id
      LEFT JOIN brand_inventory bi ON bi.id = wh.brand_id
    `;
    const params = [];
    if (Number.isFinite(wid)) {
      sql += ' WHERE r.inv_warehouse_id = ?';
      params.push(wid);
    }
    sql += ' ORDER BY r.created_at DESC LIMIT 50';
    const [rows] = await db.query(sql, params);
    res.json({ data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

/** 编辑物料入库记录的台账信息（不改库存数量） */
router.put('/inbound/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效ID' });
    const { source, remarks, inbound_date } = req.body || {};
    const date = inbound_date || null;
    const [[record]] = await db.query('SELECT id FROM inv_inbound_records WHERE id = ? LIMIT 1', [id]);
    if (!record) return res.status(404).json({ error: '记录不存在' });
    await db.query(
      'UPDATE inv_inbound_records SET source = ?, remarks = ?, inbound_date = COALESCE(?, inbound_date) WHERE id = ?',
      [source || null, remarks || null, date, id],
    );
    res.json({ data: { id } });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message || '更新失败' });
  }
});

/** 删除物料入库记录并回退库存 */
router.delete('/inbound/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效ID' });
    const [[record]] = await db.query('SELECT inv_item_id, quantity FROM inv_inbound_records WHERE id = ? LIMIT 1', [id]);
    if (!record) return res.status(404).json({ error: '记录不存在' });
    await db.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', [record.quantity, record.inv_item_id]);
    await db.query('DELETE FROM inv_inbound_records WHERE id = ?', [id]);
    res.json({ data: { id } });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message || '删除失败' });
  }
});

/** 入库单台账：归还登记批次列表（inv_return_batches），按财年筛选规则与物品出库列表一致 */
router.get('/inbound-receipts', async (req, res) => {
  try {
    const monthRange = parseMonthRangeForSql(req.query.month);
    const yfRaw = req.query.yearFrameId ?? req.query.year_frame_id;
    const yfId = parseInt(yfRaw, 10);
    let sql = `
      SELECT
        rb.id AS batch_id,
        rb.outbound_order_id,
        rb.return_date,
        rb.operator,
        rb.remarks AS batch_remarks,
        rb.created_at,
        o.link_mode,
        o.project_code,
        o.purpose,
        o.activity_id,
        o.status AS outbound_status,
        wh.region,
        bi.brand_code,
        act.city AS activity_city,
        act.activity_type,
        act.client_name,
        COALESCE(agg.sum_qty_return, 0) AS sum_qty_return,
        COALESCE(agg.sum_qty_empty_recovered, 0) AS sum_qty_empty_recovered,
        COALESCE(agg.sum_qty_customer_keep, 0) AS sum_qty_customer_keep,
        COALESCE(agg.sum_qty_lost, 0) AS sum_qty_lost,
        COALESCE(agg.sum_qty_damaged, 0) AS sum_qty_damaged,
        COALESCE(agg.sum_qty_consumed, 0) AS sum_qty_consumed,
        (SELECT GROUP_CONCAT(
                  CONCAT_WS(' ', it.name,
                    CONCAT('×',
                      COALESCE(rl.qty_return,0)
                      + COALESCE(rl.qty_empty_recovered,0)
                      + COALESCE(rl.qty_customer_keep,0)
                      + COALESCE(rl.qty_lost,0)
                      + COALESCE(rl.qty_damaged,0)
                      + COALESCE(rl.qty_consumed,0)
                    ),
                    NULLIF(it.dimensions, '')
                  )
                  ORDER BY it.name SEPARATOR ' / ')
           FROM inv_return_lines rl
           JOIN inv_outbound_lines ol ON ol.id = rl.outbound_line_id
           JOIN inv_items it ON it.id = ol.item_id
           WHERE rl.batch_id = rb.id) AS items_summary
      FROM inv_return_batches rb
      INNER JOIN inv_outbound_orders o ON o.id = rb.outbound_order_id
      INNER JOIN inv_warehouses wh ON wh.id = o.inv_warehouse_id
      INNER JOIN brand_inventory bi ON bi.id = wh.brand_id
      LEFT JOIN activities act ON act.id = o.activity_id
      LEFT JOIN (
        SELECT
          batch_id,
          SUM(qty_return) AS sum_qty_return,
          SUM(qty_empty_recovered) AS sum_qty_empty_recovered,
          SUM(qty_customer_keep) AS sum_qty_customer_keep,
          SUM(qty_lost) AS sum_qty_lost,
          SUM(qty_damaged) AS sum_qty_damaged,
          SUM(qty_consumed) AS sum_qty_consumed
        FROM inv_return_lines
        GROUP BY batch_id
      ) agg ON agg.batch_id = rb.id
      WHERE 1=1
    `;
    const params = [];
    if (Number.isFinite(yfId)) {
      sql += ` AND (
        (o.activity_id IS NOT NULL AND act.year_frame_id = ?)
        OR (o.link_mode = 'standalone' AND o.activity_id IS NULL)
        OR (
          o.activity_id IS NULL
          AND o.link_mode = 'activity'
          AND TRIM(COALESCE(o.project_code, '')) <> ''
          AND EXISTS (
            SELECT 1 FROM activities act_yf
            WHERE act_yf.project_code = o.project_code AND act_yf.year_frame_id = ?
          )
        )
      )`;
      params.push(yfId, yfId);
    }
    if (monthRange) {
      sql += ' AND rb.created_at >= ? AND rb.created_at < ?';
      params.push(monthRange[0], monthRange[1]);
    }
    sql += ' ORDER BY rb.return_date DESC, rb.id DESC';
    const [rows] = await db.query(sql, params);
    const out = rows.map((r) => {
      const labels = inboundReceiptDisplayLabels(r);
      return { ...r, return_date: jsonYmd(r.return_date), ...labels };
    });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

/** 入库单台账：单张详情（明细行 + 关联出库单号供核对） */
router.get('/inbound-receipts/:batchId', async (req, res) => {
  try {
    const batchId = parseInt(req.params.batchId, 10);
    if (!Number.isFinite(batchId)) return res.status(400).json({ error: '无效 ID' });
    const [heads] = await db.query(
      `
      SELECT
        rb.id AS batch_id,
        rb.outbound_order_id,
        rb.return_date,
        rb.operator,
        rb.remarks AS batch_remarks,
        rb.created_at,
        o.link_mode,
        o.project_code,
        o.purpose,
        o.shipped_at,
        o.status AS outbound_status,
        o.inv_warehouse_id,
        wh.region,
        bi.brand_code,
        act.city AS activity_city,
        act.activity_type,
        act.client_name
      FROM inv_return_batches rb
      INNER JOIN inv_outbound_orders o ON o.id = rb.outbound_order_id
      INNER JOIN inv_warehouses wh ON wh.id = o.inv_warehouse_id
      INNER JOIN brand_inventory bi ON bi.id = wh.brand_id
      LEFT JOIN activities act ON act.id = o.activity_id
      WHERE rb.id = ?
    `,
      [batchId]
    );
    if (!heads.length) return res.status(404).json({ error: '入库单不存在' });
    const head = { ...heads[0], return_date: jsonYmd(heads[0].return_date) };
    const [lines] = await db.query(
      `
      SELECT
        rl.id AS return_line_id,
        rl.outbound_line_id,
        rl.qty_return,
        rl.qty_lost,
        rl.qty_damaged,
        rl.qty_consumed,
        rl.qty_customer_keep,
        rl.qty_empty_recovered,
        ol.quantity AS outbound_qty,
        it.name AS item_name,
        it.dimensions AS item_dimensions
      FROM inv_return_lines rl
      INNER JOIN inv_outbound_lines ol ON ol.id = rl.outbound_line_id
      INNER JOIN inv_items it ON it.id = ol.item_id
      WHERE rl.batch_id = ?
      ORDER BY rl.id
    `,
      [batchId]
    );
    const labels = inboundReceiptDisplayLabels(head);
    res.json({ head, lines, display: labels });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

/** 更新出库单：头信息 + 明细行（与新建校验一致；先回冲旧行再扣新行；无归还记录且未结清） */
router.put('/outbound/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(orderId)) return res.status(400).json({ error: '无效 ID' });
    const {
      inv_warehouse_id,
      link_mode,
      project_code,
      purpose,
      activity_id,
      shipped_at,
      activity_date,
      recipient_city,
      recipient_address,
      contact_name,
      contact_phone,
      logistics_supplier,
      logistics_method,
      tracking_number,
      remarks,
      lines,
      year_frame_id,
    } = req.body;
    const whId = parseInt(inv_warehouse_id, 10);
    const lm = link_mode === 'standalone' ? 'standalone' : 'activity';
    const op = (req.session && req.session.user && req.session.user.username) || '';

    if (!Array.isArray(lines) || !lines.length) {
      return res.status(400).json({ error: '请填写出库明细' });
    }
    if (lm === 'activity' && !String(project_code || '').trim()) {
      return res.status(400).json({ error: '请填写项目编号' });
    }
    if (lm === 'standalone' && !String(purpose || '').trim()) {
      return res.status(400).json({ error: '请填写用途说明' });
    }
    const trackingNumber = tracking_number != null && String(tracking_number).trim() !== '' ? String(tracking_number).trim() : null;
    const shippedAtPut = parseOutboundShippedAtInput(shipped_at) || new Date();
    const activityDatePut = parseActivityDateInput(activity_date);

    await conn.beginTransaction();

    let resolvedActivityIdPut = null;
    if (lm === 'activity') {
      try {
        resolvedActivityIdPut = await resolveOutboundActivityId(conn, project_code, activity_id, year_frame_id);
      } catch (e) {
        await conn.rollback();
        return res.status(e.statusCode || 400).json({ error: e.message || '场次解析失败' });
      }
    }

    const [ords] = await conn.query(
      'SELECT id, status FROM inv_outbound_orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (!ords.length) {
      await conn.rollback();
      return res.status(404).json({ error: '单据不存在' });
    }
    if (ords[0].status === 'closed') {
      await conn.rollback();
      return res.status(400).json({ error: '已结清单据不可修改' });
    }
    const [rb] = await conn.query(
      'SELECT COUNT(*) AS c FROM inv_return_batches WHERE outbound_order_id = ?',
      [orderId]
    );
    if (Number(rb[0].c) > 0) {
      await conn.rollback();
      return res.status(400).json({ error: '已有归还记录，不可修改' });
    }

    const [oldLines] = await conn.query(
      'SELECT item_id, quantity FROM inv_outbound_lines WHERE order_id = ?',
      [orderId]
    );
    for (const ol of oldLines) {
      await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [
        ol.quantity,
        ol.item_id,
      ]);
    }
    await conn.query('DELETE FROM inv_outbound_lines WHERE order_id = ?', [orderId]);

    let headerWhId = Number.isFinite(whId) ? whId : null;
    if (!headerWhId) {
      const firstItemId = parseInt(lines[0]?.item_id, 10);
      if (Number.isFinite(firstItemId)) {
        const [it0] = await conn.query('SELECT inv_warehouse_id FROM inv_items WHERE id = ? LIMIT 1', [firstItemId]);
        if (it0.length) headerWhId = Number(it0[0].inv_warehouse_id);
      }
    }
    if (!headerWhId) throw new Error('无法识别仓库，请检查出库明细');

    const storedProjectCodePut = await canonicalOutboundProjectCode(conn, {
      link_mode: lm,
      project_code,
      activity_id: resolvedActivityIdPut,
      activity_date: activityDatePut,
    });

    await conn.query(
      `
      UPDATE inv_outbound_orders SET
        inv_warehouse_id = ?, activity_id = ?, link_mode = ?, project_code = ?, purpose = ?,
        recipient_city = ?, recipient_address = ?, contact_name = ?, contact_phone = ?,
        logistics_supplier = ?, logistics_method = ?, tracking_number = ?, remarks = ?, shipped_at = ?, activity_date = ?, operator = ?
      WHERE id = ?
    `,
      [
        headerWhId,
        resolvedActivityIdPut,
        lm,
        storedProjectCodePut,
        lm === 'standalone' ? String(purpose).trim() : null,
        recipient_city || null,
        recipient_address || null,
        contact_name || null,
        contact_phone || null,
        logistics_supplier != null && String(logistics_supplier).trim() !== ''
          ? String(logistics_supplier).trim()
          : null,
        logistics_method || null,
        trackingNumber,
        remarks || null,
        shippedAtPut,
        activityDatePut,
        op,
        orderId,
      ]
    );

    for (const ln of lines) {
      const itemId = parseInt(ln.item_id, 10);
      const qty = parseInt(ln.quantity, 10);
      const lineNote = ln.line_note || null;
      if (!Number.isFinite(itemId) || !Number.isFinite(qty) || qty <= 0) {
        throw new Error('明细行数量无效');
      }
      const [itRows] = await conn.query(
        'SELECT id, inv_warehouse_id, quantity_on_hand FROM inv_items WHERE id = ? FOR UPDATE',
        [itemId]
      );
      if (!itRows.length) throw new Error('物料不存在');
      const onHand = Number(itRows[0].quantity_on_hand);
      if (onHand < qty) throw new Error(`库存不足（当前 ${onHand}）`);
      await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', [qty, itemId]);
      await conn.query(
        'INSERT INTO inv_outbound_lines (order_id, item_id, quantity, line_note) VALUES (?, ?, ?, ?)',
        [orderId, itemId, qty, lineNote]
      );
    }

    await conn.commit();
    const detail = await loadOrderDetail(orderId);
    res.json(serializeOrderDetailForJson(detail));
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message || '保存失败' });
  } finally {
    conn.release();
  }
});

/**
 * 删除出库单（仅管理员，见 requireWriteAccess）：
 * 1）冲销空瓶回收：按 inv_return_lines.qty_empty_recovered 从空瓶库存扣回；
 * 2）删除归还批次（级联删除归还明细）；
 * 3）冲销出库：按出库明细把数量加回库存（与出库时 -库存 相反）；
 * 4）删除由该单自动同步的物流成本（remarks 含 [INV-OB:本单ID]）；
 * 5）删除出库单头（级联删除出库明细）。
 * 效果等价于该单及归还从未发生（丢失/损坏统计随归还明细一并删除）。
 */
router.delete('/outbound/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(orderId)) return res.status(400).json({ error: '无效 ID' });

    await conn.beginTransaction();
    const [ords] = await conn.query(
      'SELECT id, status FROM inv_outbound_orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (!ords.length) {
      await conn.rollback();
      return res.status(404).json({ error: '单据不存在' });
    }

    const [retRows] = await conn.query(
      `
      SELECT rl.qty_return, rl.qty_empty_recovered, rl.empty_bottle_item_id, rl.return_item_id, ol.item_id
      FROM inv_return_lines rl
      INNER JOIN inv_return_batches rb ON rb.id = rl.batch_id
      INNER JOIN inv_outbound_lines ol ON ol.id = rl.outbound_line_id
      WHERE rb.outbound_order_id = ?
    `,
      [orderId]
    );
    const itemCache = new Map();
    for (const row of retRows) {
      const itemId = parseInt(row.return_item_id, 10) || parseInt(row.item_id, 10);
      if (!Number.isFinite(itemId)) continue;
      const qr = Math.max(0, parseInt(row.qty_return, 10) || 0);
      const qe = Math.max(0, parseInt(row.qty_empty_recovered, 10) || 0);
      if (qr > 0) {
        const [srcLock] = await conn.query('SELECT id, quantity_on_hand FROM inv_items WHERE id = ? FOR UPDATE', [itemId]);
        if (!srcLock.length) throw new Error(`物料 #${itemId} 不存在，无法冲销归还入库`);
        const srcOnHand = Number(srcLock[0].quantity_on_hand);
        if (srcOnHand < qr) {
          throw new Error(`物料 #${itemId} 当前库存 ${srcOnHand}，不足以冲销归还入库 ${qr}`);
        }
        await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', [qr, itemId]);
      }
      if (qe > 0) {
        let emptyItemId = parseInt(row.empty_bottle_item_id, 10);
        // 优先按归还明细中实际记录的空瓶物料扣减，避免因名称/规格变更导致扣错条目
        if (!Number.isFinite(emptyItemId) || emptyItemId <= 0) {
          let src = itemCache.get(itemId);
          if (!src) {
            const [srcRows] = await conn.query(
              'SELECT id, inv_warehouse_id, name, dimensions FROM inv_items WHERE id = ? LIMIT 1',
              [itemId]
            );
            if (!srcRows.length) throw new Error(`物料 #${itemId} 不存在，无法冲销空瓶回收`);
            src = srcRows[0];
            itemCache.set(itemId, src);
          }
          emptyItemId = await ensureEmptyBottleItem(conn, src);
        }
        const [emptyLock] = await conn.query('SELECT id, quantity_on_hand FROM inv_items WHERE id = ? FOR UPDATE', [emptyItemId]);
        if (!emptyLock.length) throw new Error(`空瓶物料 #${emptyItemId} 不存在，无法冲销空瓶回收`);
        const emptyOnHand = Number(emptyLock[0].quantity_on_hand);
        if (emptyOnHand < qe) {
          throw new Error(`空瓶物料 #${emptyItemId} 当前库存 ${emptyOnHand}，不足以冲销空瓶回收 ${qe}`);
        }
        await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', [qe, emptyItemId]);
      }
    }

    await conn.query('DELETE FROM inv_return_batches WHERE outbound_order_id = ?', [orderId]);

    const [lines] = await conn.query(
      'SELECT item_id, quantity FROM inv_outbound_lines WHERE order_id = ?',
      [orderId]
    );
    for (const ln of lines) {
      const q = parseInt(ln.quantity, 10) || 0;
      if (q <= 0) continue;
      await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [q, ln.item_id]);
    }

    // 无项目编号 standalone 出库在物流成本中自动插入的行，与出库单绑定；删单时一并清除
    const [delLogiResult] = await conn.query(
      'DELETE FROM logistics WHERE remarks LIKE CONCAT("%[INV-OB:", ?, "]%")',
      [orderId]
    );
    const cleanedLogistics = (delLogiResult && delLogiResult.affectedRows) || 0;

    await conn.query('DELETE FROM inv_outbound_orders WHERE id = ?', [orderId]);
    await conn.commit();
    res.json({ ok: true, cleaned_logistics: cleanedLogistics });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message || '删除失败' });
  } finally {
    conn.release();
  }
});

/**
 * 清理「出库残留物流」：扫描 logistics.remarks 含 [INV-OB:N] 但 N 已被删除的孤儿行，统一清掉。
 * 仅管理员可调用（路由级 requireWriteAccess 已挂载）。
 * - 用于历史数据回补：早期版本删出库单未做联动 / 用户手动改过 remarks 等场景。
 * - 当前版本删出库单已做 INV-OB 标记联动；这里是「兜底回扫」工具，幂等可重复执行。
 */
router.post('/cleanup-orphan-logistics', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, remarks FROM logistics WHERE remarks LIKE '%[INV-OB:%'"
    );
    const orphanIds = [];
    const referenced = new Set();
    for (const row of rows) {
      const m = String(row.remarks || '').match(/\[INV-OB:(\d+)\]/);
      if (!m) continue;
      const obId = parseInt(m[1], 10);
      if (!Number.isFinite(obId)) continue;
      referenced.add(obId);
      // 缓存避免重复查询
    }
    if (!referenced.size) {
      return res.json({ ok: true, scanned: rows.length, cleaned: 0, orphan_ids: [] });
    }
    const idList = Array.from(referenced);
    const [existRows] = await db.query(
      `SELECT id FROM inv_outbound_orders WHERE id IN (${idList.map(() => '?').join(',')})`,
      idList
    );
    const existing = new Set(existRows.map((r) => Number(r.id)));
    for (const row of rows) {
      const m = String(row.remarks || '').match(/\[INV-OB:(\d+)\]/);
      if (!m) continue;
      const obId = parseInt(m[1], 10);
      if (!Number.isFinite(obId)) continue;
      if (!existing.has(obId)) orphanIds.push(row.id);
    }
    if (orphanIds.length) {
      await db.query(
        `DELETE FROM logistics WHERE id IN (${orphanIds.map(() => '?').join(',')})`,
        orphanIds
      );
    }
    res.json({ ok: true, scanned: rows.length, cleaned: orphanIds.length, orphan_ids: orphanIds });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '清理失败' });
  }
});

router.post('/outbound/:id/returns', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const orderId = parseInt(req.params.id, 10);
    const { return_date, remarks, lines, inbound_warehouse_id } = req.body;
    const op = (req.session && req.session.user && req.session.user.username) || '';

    if (!Number.isFinite(orderId) || !Array.isArray(lines) || !lines.length) {
      return res.status(400).json({ error: '请填写归还明细' });
    }
    const rd = parseReturnDateInput(return_date);

    await conn.beginTransaction();

    const [ords] = await conn.query('SELECT id, status, inv_warehouse_id FROM inv_outbound_orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!ords.length) throw new Error('单据不存在');
    if (ords[0].status === 'closed') throw new Error('该单已结清');
    const inputInboundWhId = parseInt(inbound_warehouse_id, 10);
    // 批次级 inbound_warehouse_id 仅作台账备注；实际库存按各行物料所属出库仓归还
    const batchInboundWhId =
      Number.isFinite(inputInboundWhId) && inputInboundWhId > 0 ? inputInboundWhId : null;
    if (batchInboundWhId) {
      const [inboundWhRows] = await conn.query('SELECT id FROM inv_warehouses WHERE id = ? LIMIT 1', [batchInboundWhId]);
      if (!inboundWhRows.length) throw new Error('归还入库仓库不存在');
    }

    const hasQty = lines.some(
      (x) =>
        (parseInt(x.qty_return, 10) || 0) +
          (parseInt(x.qty_lost, 10) || 0) +
          (parseInt(x.qty_damaged, 10) || 0) +
          (parseInt(x.qty_consumed, 10) || 0) +
          (parseInt(x.qty_customer_keep, 10) || 0) +
          (parseInt(x.qty_empty_recovered, 10) || 0) >
        0
    );
    if (!hasQty) throw new Error('请至少在一行填写归还、丢失、损坏、消耗、空瓶回收或留给客户数量');

    const [batchIns] = await conn.query(
      'INSERT INTO inv_return_batches (outbound_order_id, return_date, inbound_warehouse_id, operator, remarks) VALUES (?, ?, ?, ?, ?)',
      [orderId, rd, batchInboundWhId, op, remarks || null]
    );
    const batchId = batchIns.insertId;

    for (const ln of lines) {
      const olId = parseInt(ln.outbound_line_id, 10);
      const qr = Math.max(0, parseInt(ln.qty_return, 10) || 0);
      const ql = Math.max(0, parseInt(ln.qty_lost, 10) || 0);
      const qd = Math.max(0, parseInt(ln.qty_damaged, 10) || 0);
      const qc = Math.max(0, parseInt(ln.qty_consumed, 10) || 0);
      const qk = Math.max(0, parseInt(ln.qty_customer_keep, 10) || 0);
      const qe = Math.max(0, parseInt(ln.qty_empty_recovered, 10) || 0);
      if (qr + ql + qd + qc + qk + qe === 0) continue;

      const [olRows] = await conn.query(
        `SELECT
           ol.id, ol.order_id, ol.item_id, ol.quantity,
           it.inv_warehouse_id, it.name, it.description, it.dimensions,
           it.alert_below, it.image_urls, it.is_common, it.is_wine, it.wine_label
         FROM inv_outbound_lines ol
         JOIN inv_items it ON it.id = ol.item_id
         WHERE ol.id = ? FOR UPDATE`,
        [olId]
      );
      if (!olRows.length || olRows[0].order_id !== orderId) throw new Error('无效出库明细行');
      const shipped = Number(olRows[0].quantity);
      const [prevRows] = await conn.query(
        `
        SELECT COALESCE(SUM(${RETURN_LINE_ACCOUNTED_SUM_RL_SQL}), 0) AS s
        FROM inv_return_lines rl
        JOIN inv_return_batches rb ON rb.id = rl.batch_id
        WHERE rl.outbound_line_id = ? AND rb.id <> ?
      `,
        [olId, batchId]
      );
      const already = Number(prevRows[0].s);
      if (qr + ql + qd + qc + qk + qe + already > shipped) {
        throw new Error(`明细行 #${olId} 归还+丢失+损坏+消耗+留客+空瓶回收 超过出库数量`);
      }

      let emptyBottleItemId = null;
      if (qe > 0) {
        emptyBottleItemId = await ensureEmptyBottleItem(conn, olRows[0]);
      }

      let returnItemId = Number(olRows[0].item_id);
      if (qr > 0) {
        const sourceWhId = Number(olRows[0].inv_warehouse_id);
        const lineOverrideWhId = parseInt(ln.inbound_warehouse_id, 10);
        const targetWhId =
          Number.isFinite(lineOverrideWhId) && lineOverrideWhId > 0
            ? lineOverrideWhId
            : Number.isFinite(batchInboundWhId) && batchInboundWhId > 0
              ? batchInboundWhId
              : sourceWhId;
        if (!Number.isFinite(targetWhId) || targetWhId <= 0) {
          throw new Error(`明细行 #${olId} 无法识别原出库仓库`);
        }
        const [targetWhRows] = await conn.query('SELECT id FROM inv_warehouses WHERE id = ? LIMIT 1', [targetWhId]);
        if (!targetWhRows.length) throw new Error(`明细行 #${olId} 归还入库仓库不存在`);
        if (targetWhId !== sourceWhId) {
          returnItemId = await ensureReturnItemInWarehouse(conn, olRows[0], targetWhId);
        }
      }

      await conn.query(
        'INSERT INTO inv_return_lines (batch_id, outbound_line_id, return_item_id, qty_return, qty_lost, qty_damaged, qty_consumed, qty_customer_keep, qty_empty_recovered, empty_bottle_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [batchId, olId, returnItemId, qr, ql, qd, qc, qk, qe, emptyBottleItemId]
      );

      if (qr > 0) {
        await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [qr, returnItemId]);
      }
      if (qe > 0 && emptyBottleItemId) {
        await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [qe, emptyBottleItemId]);
      }
    }

    const [linesOrder] = await conn.query('SELECT id, quantity FROM inv_outbound_lines WHERE order_id = ?', [orderId]);
    let allClosed = true;
    for (const ol of linesOrder) {
      const [sumRow] = await conn.query(
        `SELECT COALESCE(SUM(${RETURN_LINE_ACCOUNTED_SUM_SQL}), 0) AS s FROM inv_return_lines WHERE outbound_line_id = ?`,
        [ol.id]
      );
      const t = Number(sumRow[0].s);
      if (t < Number(ol.quantity)) allClosed = false;
    }
    if (allClosed) {
      await conn.query("UPDATE inv_outbound_orders SET status = 'closed' WHERE id = ?", [orderId]);
    }

    await conn.commit();
    const detail = await loadOrderDetail(orderId);
    const remain = await queryOutboundReturnRemain(db, orderId);
    if (detail && detail.order) detail.order = attachOutboundReturnRemain(detail.order, remain);
    res.json(serializeOrderDetailForJson(detail));
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message || '归还失败' });
  } finally {
    conn.release();
  }
});

/**
 * 用酒统计：按场次汇总出库单中带「酒类」标签的物料数量。
 * 归并键为 inv_items.wine_label（空则用名称），避免规格字段写法不一致导致统计偏差。
 */
async function buildWineUsageStats(query) {
  const yfRaw = query.yearFrameId ?? query.year_frame_id;
  const yfId = parseInt(yfRaw, 10);
  if (!Number.isFinite(yfId)) {
    const err = new Error('请选择年度');
    err.status = 400;
    throw err;
  }
  /** 与字典 activity_region 取值一致（含西南区、东区-婚宴等），不用仓库 INV_REGIONS 白名单 */
  const region = String(query.region || '').trim() || null;
  const belonging = String(query.belonging || '').trim() || null;
  const projectRaw = String(query.project_code || query.q || query.search || '').trim();
  const projectTerms = projectRaw ? projectRaw.split(/\s+/).filter(Boolean) : [];
  const dateFrom = parseActivityDateInput(query.date_from || query.dateFrom);
  const dateTo = parseActivityDateInput(query.date_to || query.dateTo);
  const monthRange = parseMonthRangeForSql(query.month);

  let sql = `
    SELECT
      COALESCE(act1.id, act2.id) AS activity_id,
      COALESCE(act1.region, act2.region) AS region,
      COALESCE(NULLIF(TRIM(act1.project_code), ''), NULLIF(TRIM(act2.project_code), ''), NULLIF(TRIM(o.project_code), '')) AS project_code,
      COALESCE(act1.belonging, act2.belonging) AS belonging,
      COALESCE(o.activity_date, act1.date, act2.date) AS activity_date,
      COALESCE(NULLIF(TRIM(i.wine_label), ''), TRIM(i.name)) AS wine_label,
      MAX(NULLIF(TRIM(i.dimensions), '')) AS item_dimensions,
      SUM(ol.quantity) AS qty
    FROM inv_outbound_lines ol
    INNER JOIN inv_outbound_orders o ON o.id = ol.order_id
    INNER JOIN inv_items i ON i.id = ol.item_id AND i.is_wine = 1
    LEFT JOIN activities act1 ON act1.id = o.activity_id
    LEFT JOIN activities act2 ON act2.id IS NULL
      AND o.activity_id IS NULL
      AND TRIM(COALESCE(o.project_code, '')) <> ''
      AND act2.project_code = o.project_code
      AND act2.year_frame_id = ?
    WHERE COALESCE(act1.id, act2.id) IS NOT NULL
      AND COALESCE(act1.year_frame_id, act2.year_frame_id) = ?
  `;
  const params = [yfId, yfId];

  if (region) {
    sql += ' AND COALESCE(act1.region, act2.region) = ?';
    params.push(region);
  }
  if (belonging) {
    sql += ' AND COALESCE(act1.belonging, act2.belonging) = ?';
    params.push(belonging);
  }
  if (projectTerms.length) {
    const projExpr =
      'COALESCE(NULLIF(TRIM(act1.project_code), \'\'), NULLIF(TRIM(act2.project_code), \'\'), NULLIF(TRIM(o.project_code), \'\'))';
    projectTerms.forEach(() => {
      sql += ` AND ${projExpr} LIKE ?`;
    });
    projectTerms.forEach((term) => params.push(`%${term}%`));
  }
  if (dateFrom) {
    sql += ' AND COALESCE(o.activity_date, act1.date, act2.date) >= ?';
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += ' AND COALESCE(o.activity_date, act1.date, act2.date) <= ?';
    params.push(dateTo);
  }
  if (monthRange) {
    sql += ' AND COALESCE(o.activity_date, act1.date, act2.date) >= ? AND COALESCE(o.activity_date, act1.date, act2.date) < ?';
    params.push(monthRange[0].slice(0, 10), monthRange[1].slice(0, 10));
  }

  sql += `
    GROUP BY
      COALESCE(act1.id, act2.id),
      COALESCE(act1.region, act2.region),
      COALESCE(NULLIF(TRIM(act1.project_code), ''), NULLIF(TRIM(act2.project_code), ''), NULLIF(TRIM(o.project_code), '')),
      COALESCE(act1.belonging, act2.belonging),
      COALESCE(o.activity_date, act1.date, act2.date),
      COALESCE(NULLIF(TRIM(i.wine_label), ''), TRIM(i.name))
    ORDER BY activity_date DESC, project_code, wine_label
  `;

  const [[aggRows], dimByWineLabel, wineRegistry] = await Promise.all([
    db.query(sql, params),
    fetchWineLabelDimensionsLookup(db),
    fetchWineRegistryForUsageStats(db),
  ]);
  const wineMetaMap = new Map();
  const rowMap = new Map();

  for (const r of aggRows || []) {
    const wl = String(r.wine_label || '').trim() || '—';
    const qty = sqlAggNum(r.qty);
    if (!wineMetaMap.has(wl)) {
      wineMetaMap.set(wl, { total: 0, specQty: new Map(), sampleDimensions: null });
    }
    const wm = wineMetaMap.get(wl);
    wm.total += qty;
    const spec = wineVolumeSpecFromRow(r.item_dimensions, wl);
    if (spec) wm.specQty.set(spec, (wm.specQty.get(spec) || 0) + qty);
    if (!wm.sampleDimensions && r.item_dimensions) wm.sampleDimensions = r.item_dimensions;

    const actId = Number(r.activity_id);
    if (!rowMap.has(actId)) {
      rowMap.set(actId, {
        activity_id: actId,
        region: r.region || '—',
        project_code: String(r.project_code || '').trim() || '—',
        belonging: r.belonging || '—',
        activity_date: jsonYmd(r.activity_date),
        quantities: {},
      });
    }
    const row = rowMap.get(actId);
    row.quantities[wl] = (row.quantities[wl] || 0) + qty;
  }

  const wines = [...wineMetaMap.entries()]
    .map(([label, wm]) => {
      let dominantSpec = '';
      let bestQ = -1;
      wm.specQty.forEach((q, spec) => {
        if (q > bestQ) {
          bestQ = q;
          dominantSpec = spec;
        }
      });
      const dimsHint =
        dominantSpec ||
        wm.sampleDimensions ||
        dimByWineLabel.get(label) ||
        null;
      const volume =
        normalizeVolumeDisplay(wineVolumeSpecFromRow(dimsHint, label)) ||
        normalizeVolumeDisplay(dominantSpec) ||
        normalizeVolumeDisplay(wineVolumeSpecFromRow(dimByWineLabel.get(label), label)) ||
        null;
      return {
        label,
        displayName: label,
        volume,
        total: wm.total,
      };
    });

  const winesOrdered = orderWinesForUsageStats(wines, wineRegistry);

  const rows = [...rowMap.values()].sort((a, b) => {
    const da = a.activity_date || '';
    const db = b.activity_date || '';
    if (da !== db) return db.localeCompare(da);
    return String(a.project_code).localeCompare(String(b.project_code), 'zh');
  });

  return {
    filters: {
      year_frame_id: yfId,
      region,
      belonging,
      project_code: projectRaw || null,
      date_from: dateFrom,
      date_to: dateTo,
      month: monthRange ? String(query.month || '').trim() : null,
    },
    wines: winesOrdered,
    rows,
    summary: {
      session_count: rows.length,
      wine_kind_count: winesOrdered.filter((w) => w.total > 0).length,
      wine_column_count: winesOrdered.length,
      total_bottles: winesOrdered.reduce((s, w) => s + w.total, 0),
    },
  };
}

router.get('/wine-usage-stats', async (req, res) => {
  try {
    const data = await buildWineUsageStats(req.query);
    res.json({ data });
  } catch (e) {
    const code = e.status || 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: e.message || '用酒统计加载失败' });
  }
});

/** 从酒品目录对齐的物料批量标记酒类并写入统计标签 */
router.post('/items/backfill-wine-tags', async (req, res) => {
  try {
    await ensureWineCatalog(db);
    const [catalogRows] = await db.query(
      'SELECT brand, name, category, volume_label FROM wine_catalog'
    );
    const keyToLabel = new Map();
    (catalogRows || []).forEach((c) => {
      keyToLabel.set(invItemWineKey(c.name, wineCatalogSpecLine(c)), defaultWineLabelFromCatalog(c));
    });
    const [items] = await db.query(
      'SELECT id, name, dimensions FROM inv_items WHERE is_wine = 0 OR wine_label IS NULL OR wine_label = \'\''
    );
    let updated = 0;
    for (const it of items || []) {
      const key = invItemWineKey(it.name, it.dimensions);
      const lbl = keyToLabel.get(key);
      if (!lbl) continue;
      await db.query('UPDATE inv_items SET is_wine = 1, wine_label = ? WHERE id = ?', [lbl, it.id]);
      updated += 1;
    }
    res.json({ ok: true, updated, catalog_keys: keyToLabel.size });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '批量标记失败' });
  }
});

router.get('/wine-usage-stats/excel', async (req, res) => {
  try {
    const data = await buildWineUsageStats(req.query);
    await writeWineUsageStatsExcel(res, data);
  } catch (e) {
    const code = e.status || 500;
    if (code >= 500) console.error(e);
    if (!res.headersSent) res.status(code).json({ error: e.message || 'Excel 导出失败' });
  }
});

router.get('/outbound/:id/pdf', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const detail = await loadOrderDetail(id);
    if (!detail) return res.status(404).json({ error: '单据不存在' });
    const { order, lines } = detail;

    const lineWhMap = new Map();
    lines.forEach((ln) => {
      const key = `${ln.line_brand_code || '—'}|${ln.line_region || '—'}`;
      if (!lineWhMap.has(key)) lineWhMap.set(key, []);
      lineWhMap.get(key).push(ln);
    });
    const whCount = lineWhMap.size;
    const shippedDateCn = formatCnYmd(order.shipped_at);

    const whNames = Array.from(lineWhMap.keys()).map((k) => {
      const [b, r] = String(k).split('|');
      return formatWarehouseLabel(b, r);
    });
    const warehouseLabel = whCount > 1
      ? `多仓（${whNames.join(' / ')}）`
      : formatWarehouseLabel(order.brand_code, order.region);
    const projectCodeLabel =
      order.link_mode === 'standalone'
        ? String(order.purpose || '').trim() || '—'
        : String(order.project_code || '').trim() || '—';

    const lineTableBody = [
      [
        { text: '序号', style: 'thCenter' },
        { text: '物品名称', style: 'th' },
        { text: '所属仓库', style: 'thCenter' },
        { text: '数量', style: 'thCenter' },
        { text: '规格/尺寸', style: 'th' },
        { text: '说明', style: 'thCenter' },
      ],
    ];
    lines.forEach((ln, idx) => {
      lineTableBody.push([
        { text: String(idx + 1), style: 'tdCenter' },
        { text: String(ln.item_name || ''), style: 'tdLeft' },
        { text: formatWarehouseLabel(ln.line_brand_code, ln.line_region), style: 'tdCenter' },
        { text: String(ln.quantity || ''), style: 'tdCenter' },
        { text: String(ln.item_dimensions || '—'), style: 'tdLeft' },
        { text: String(ln.line_note || '—'), style: 'tdLeft' },
      ]);
    });

    const docDefinition = {
      pageSize: 'A4',
      pageOrientation: 'portrait',
      pageMargins: [40, 40, 40, 40],
      defaultStyle: { font: hasSystemUnicodeFont ? 'unicode' : 'fangzhen', fontSize: 10, lineHeight: 1.2 },
      content: [
        { text: '物品出库单', style: 'title', alignment: 'center', margin: [0, 0, 0, 6] },
        { text: [{ text: '项目编号：', bold: true }, projectCodeLabel], margin: [0, 0, 0, 3] },
        {
          columns: [
            { width: 'auto', text: [{ text: '出库时间：', bold: true }, shippedDateCn] },
            { width: '*', text: [{ text: '所属仓库：', bold: true }, warehouseLabel] },
          ],
          columnGap: 16,
          margin: [0, 0, 0, 6],
        },
        { text: '收件信息', style: 'h2' },
        { text: [{ text: '城市：', bold: true }, order.recipient_city || '—'], margin: [0, 0, 0, 3] },
        {
          columns: [
            { width: 'auto', text: [{ text: '联系人：', bold: true }, order.contact_name || '—'] },
            { width: '*', text: [{ text: '联系电话：', bold: true }, order.contact_phone || '—'] },
          ],
          columnGap: 24,
          margin: [0, 0, 0, 3],
        },
        { text: [{ text: '地址：', bold: true }, order.recipient_address || '—'], margin: [0, 0, 0, 3] },
        { text: [{ text: '物流方式：', bold: true }, order.logistics_method || '—'], margin: [0, 0, 0, 6] },
        { text: '物品明细', style: 'h2' },
        {
          table: {
            widths: ['8%', '30%', '14%', '8%', '12%', '28%'],
            headerRows: 1,
            body: lineTableBody,
          },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#888888',
            vLineColor: () => '#888888',
            paddingTop: () => 3,
            paddingBottom: () => 3,
            paddingLeft: () => 4,
            paddingRight: () => 4,
          },
        },
        ...(order.remarks ? [{ text: `备注：${order.remarks}`, margin: [0, 6, 0, 0] }] : []),
      ],
      styles: {
        title: { fontSize: 18, bold: true },
        h2: { fontSize: 11, bold: true, margin: [0, 6, 0, 3] },
        th: { bold: true, fontSize: 9, fillColor: '#f0f0f0' },
        thCenter: { bold: true, alignment: 'center', fontSize: 9, fillColor: '#f0f0f0' },
        tdLeft: { alignment: 'left', fontSize: 9, lineHeight: 1.2 },
        tdCenter: { alignment: 'center', fontSize: 9, lineHeight: 1.2 },
      },
    };

    ensureInventoryPdfVfs();
    const urlResolver = new URLResolver(pdfVirtualFs);
    const printer = new PdfPrinter(pdfFonts, pdfVirtualFs, urlResolver);
    const pdfDoc = await printer.createPdfKitDocument(docDefinition);
    // 仓库名按统一规则（与列表/PDF 内文一致）：
    //   - X.O 北区/南区 → 「北区仓库」「南区仓库」（公司级跨品牌总仓）
    //   - 多仓出库 → 「多仓」
    //   - 其它 → 「品牌 区域」
    const warehousePartSrc = whCount > 1 ? '多仓' : formatWarehouseLabel(order.brand_code, order.region);
    const warehousePart = safeFilePart(warehousePartSrc) || '未知仓库';
    // 文件名规则：
    //   - 有项目编号（活动用）：`项目内容 + 出库单（仓库名）.pdf`
    //       「项目内容」= project_code 中年框前缀空格后的活动描述段（YYMMDD + 城市 + 内容）
    //       如：`N220630-RC-PHD 250522上海PHD晚宴` → 「250522上海PHD晚宴出库单（PHD东区）.pdf」
    //   - 无项目编号（standalone / 缺失）：`活动日期YYMMDD + 城市 + 出库单（仓库名）.pdf`
    //       活动日期 fallback：o.activity_date → 关联活动 act.activity_date → shipped_at → created_at
    const projectCodeTrim = String(order.project_code || '').trim();
    const isStandalone = order.link_mode === 'standalone' || !projectCodeTrim;
    let finalBaseName;
    if (isStandalone) {
      const dateSource =
        order.activity_date ||
        order.activity_date_link ||
        order.shipped_at ||
        order.created_at;
      const datePart = compactDateYYMMDD(dateSource) || '000000';
      const cityPart = safeFilePart(order.recipient_city) || '未知城市';
      finalBaseName = `${datePart}${cityPart}出库单（${warehousePart}）`;
    } else {
      const projectContentRaw = extractProjectContent(projectCodeTrim);
      const projectPart = safeFilePart(projectContentRaw) || safeFilePart(projectCodeTrim) || '未知项目';
      finalBaseName = `${projectPart}出库单（${warehousePart}）`;
    }
    const filenameEnc = encodeURIComponent(`${finalBaseName}.pdf`);
    const asDownload = req.query.download === '1' || req.query.download === 'true';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      asDownload ? `attachment; filename*=UTF-8''${filenameEnc}` : `inline; filename*=UTF-8''${filenameEnc}`,
    );
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'PDF 失败' });
  }
});

module.exports = router;
