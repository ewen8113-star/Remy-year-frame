const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const PdfPrinter = require('pdfmake/js/Printer').default;
const URLResolver = require('pdfmake/js/URLResolver').default;
const pdfVirtualFs = require('pdfmake/js/virtual-fs').default;
const robotoVfsMap = require('pdfmake/build/vfs_fonts.js');
const cnVfsMap = require('pdfmake-support-chinese-fonts/vfs_fonts').pdfMake.vfs;

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
  const order = { ...detail.order };
  if (order.activity_date) order.activity_date = jsonYmd(order.activity_date);
  const batches = (detail.batches || []).map((b) => ({
    ...b,
    return_date: jsonYmd(b.return_date),
    created_at: formatDateTimeSecond(b.created_at) || b.created_at,
  }));
  return { ...detail, order, batches };
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
    return [];
  }
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

function wineCatalogSpecLine(row) {
  const v = String(row?.volume_label || '').trim();
  return v || '';
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
    } = req.body;
    const whId = parseInt(inv_warehouse_id, 10);
    const initQ = Math.max(0, parseInt(initial_quantity, 10) || 0);
    if (!Number.isFinite(whId) || !String(name || '').trim()) {
      return res.status(400).json({ error: '请填写仓库与物品名称' });
    }
    let urls = image_urls;
    if (urls != null && !Array.isArray(urls)) urls = [];
    const common = Boolean(is_common);
    const [result] = await db.query(
      `INSERT INTO inv_items (inv_warehouse_id, name, description, dimensions, initial_quantity, quantity_on_hand, alert_below, image_urls, is_common)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      await db.query(
        `INSERT INTO inv_items (inv_warehouse_id, name, description, dimensions, initial_quantity, quantity_on_hand, alert_below, image_urls, is_common)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0)`,
        [
          whId,
          String(c.name || '').trim(),
          null,
          spec || null,
          qty,
          qty,
          JSON.stringify(urls),
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
    'SELECT * FROM inv_return_batches WHERE outbound_order_id = ? ORDER BY id DESC',
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

    const [result] = await conn.query(
      `
      INSERT INTO inv_outbound_orders (
        inv_warehouse_id, activity_id, link_mode, project_code, purpose,
        recipient_city, recipient_address, contact_name, contact_phone, logistics_method, tracking_number,
        status, shipped_at, activity_date, operator, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shipped', ?, ?, ?, ?)
    `,
      [
        headerWhId,
        resolvedActivityId,
        lm,
        lm === 'activity' ? String(project_code).trim() : null,
        lm === 'standalone' ? String(purpose).trim() : null,
        recipient_city || null,
        recipient_address || null,
        contact_name || null,
        contact_phone || null,
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
      SELECT o.id, o.activity_id, o.project_code, o.purpose, o.link_mode, o.status, o.shipped_at, o.recipient_city,
             o.contact_name, o.contact_phone, o.recipient_address, o.remarks,
             o.logistics_method, o.tracking_number, o.created_at,
             wh.region, bi.brand_code,
             COALESCE(o.activity_date, act.activity_date) AS activity_date,
             act.city AS activity_city,
             (SELECT COUNT(*) FROM inv_outbound_lines ol WHERE ol.order_id = o.id) AS line_count,
             (SELECT GROUP_CONCAT(CONCAT_WS(' ', it.name, CONCAT('×', ol2.quantity), NULLIF(it.dimensions, '')) ORDER BY it.name SEPARATOR ' / ')
                FROM inv_outbound_lines ol2
                JOIN inv_items it ON it.id = ol2.item_id
                WHERE ol2.order_id = o.id) AS items_summary
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
        (SELECT GROUP_CONCAT(
                  CONCAT_WS(' ', it.name,
                    CONCAT('×',
                      COALESCE(rl.qty_return,0)
                      + COALESCE(rl.qty_empty_recovered,0)
                      + COALESCE(rl.qty_customer_keep,0)
                      + COALESCE(rl.qty_lost,0)
                      + COALESCE(rl.qty_damaged,0)
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
          SUM(qty_damaged) AS sum_qty_damaged
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

    await conn.query(
      `
      UPDATE inv_outbound_orders SET
        inv_warehouse_id = ?, activity_id = ?, link_mode = ?, project_code = ?, purpose = ?,
        recipient_city = ?, recipient_address = ?, contact_name = ?, contact_phone = ?,
        logistics_method = ?, tracking_number = ?, remarks = ?, shipped_at = ?, activity_date = ?, operator = ?
      WHERE id = ?
    `,
      [
        headerWhId,
        resolvedActivityIdPut,
        lm,
        lm === 'activity' ? String(project_code).trim() : null,
        lm === 'standalone' ? String(purpose).trim() : null,
        recipient_city || null,
        recipient_address || null,
        contact_name || null,
        contact_phone || null,
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
      SELECT rl.qty_return, rl.qty_empty_recovered, rl.empty_bottle_item_id, ol.item_id
      FROM inv_return_lines rl
      INNER JOIN inv_return_batches rb ON rb.id = rl.batch_id
      INNER JOIN inv_outbound_lines ol ON ol.id = rl.outbound_line_id
      WHERE rb.outbound_order_id = ?
    `,
      [orderId]
    );
    const itemCache = new Map();
    for (const row of retRows) {
      const itemId = parseInt(row.item_id, 10);
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
    const { return_date, remarks, lines } = req.body;
    const op = (req.session && req.session.user && req.session.user.username) || '';

    if (!Number.isFinite(orderId) || !Array.isArray(lines) || !lines.length) {
      return res.status(400).json({ error: '请填写归还明细' });
    }
    const rd = parseReturnDateInput(return_date);

    await conn.beginTransaction();

    const [ords] = await conn.query('SELECT id, status, inv_warehouse_id FROM inv_outbound_orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!ords.length) throw new Error('单据不存在');
    if (ords[0].status === 'closed') throw new Error('该单已结清');

    const hasQty = lines.some(
      (x) =>
        (parseInt(x.qty_return, 10) || 0) +
          (parseInt(x.qty_lost, 10) || 0) +
          (parseInt(x.qty_damaged, 10) || 0) +
          (parseInt(x.qty_customer_keep, 10) || 0) +
          (parseInt(x.qty_empty_recovered, 10) || 0) >
        0
    );
    if (!hasQty) throw new Error('请至少在一行填写归还、丢失、损坏、空瓶回收或留给客户数量');

    const [batchIns] = await conn.query(
      'INSERT INTO inv_return_batches (outbound_order_id, return_date, operator, remarks) VALUES (?, ?, ?, ?)',
      [orderId, rd, op, remarks || null]
    );
    const batchId = batchIns.insertId;

    for (const ln of lines) {
      const olId = parseInt(ln.outbound_line_id, 10);
      const qr = Math.max(0, parseInt(ln.qty_return, 10) || 0);
      const ql = Math.max(0, parseInt(ln.qty_lost, 10) || 0);
      const qd = Math.max(0, parseInt(ln.qty_damaged, 10) || 0);
      const qk = Math.max(0, parseInt(ln.qty_customer_keep, 10) || 0);
      const qe = Math.max(0, parseInt(ln.qty_empty_recovered, 10) || 0);
      if (qr + ql + qd + qk + qe === 0) continue;

      const [olRows] = await conn.query(
        `SELECT ol.id, ol.order_id, ol.item_id, ol.quantity, it.inv_warehouse_id, it.name, it.dimensions
         FROM inv_outbound_lines ol
         JOIN inv_items it ON it.id = ol.item_id
         WHERE ol.id = ? FOR UPDATE`,
        [olId]
      );
      if (!olRows.length || olRows[0].order_id !== orderId) throw new Error('无效出库明细行');
      const shipped = Number(olRows[0].quantity);
      const [prevRows] = await conn.query(
        `
        SELECT COALESCE(SUM(rl.qty_return + rl.qty_lost + rl.qty_damaged + rl.qty_customer_keep + rl.qty_empty_recovered), 0) AS s
        FROM inv_return_lines rl
        JOIN inv_return_batches rb ON rb.id = rl.batch_id
        WHERE rl.outbound_line_id = ? AND rb.id <> ?
      `,
        [olId, batchId]
      );
      const already = Number(prevRows[0].s);
      if (qr + ql + qd + qk + qe + already > shipped) {
        throw new Error(`明细行 #${olId} 归还+丢失+损坏+留客+空瓶回收 超过出库数量`);
      }

      let emptyBottleItemId = null;
      if (qe > 0) {
        emptyBottleItemId = await ensureEmptyBottleItem(conn, olRows[0]);
      }

      await conn.query(
        'INSERT INTO inv_return_lines (batch_id, outbound_line_id, qty_return, qty_lost, qty_damaged, qty_customer_keep, qty_empty_recovered, empty_bottle_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [batchId, olId, qr, ql, qd, qk, qe, emptyBottleItemId]
      );

      if (qr > 0) {
        // 归还数量应回补到原物料库存（与出库扣减相反）
        await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [qr, olRows[0].item_id]);
      }
      if (qe > 0 && emptyBottleItemId) {
        await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [qe, emptyBottleItemId]);
      }
    }

    const [linesOrder] = await conn.query('SELECT id, quantity FROM inv_outbound_lines WHERE order_id = ?', [orderId]);
    let allClosed = true;
    for (const ol of linesOrder) {
      const [sumRow] = await conn.query(
        'SELECT COALESCE(SUM(qty_return + qty_lost + qty_damaged + qty_customer_keep + qty_empty_recovered), 0) AS s FROM inv_return_lines WHERE outbound_line_id = ?',
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
    res.json(serializeOrderDetailForJson(detail));
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message || '归还失败' });
  } finally {
    conn.release();
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
        { text: String(ln.line_note || '—'), style: 'tdCenter' },
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
            widths: ['8%', '32%', '14%', '8%', '28%', '10%'],
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
