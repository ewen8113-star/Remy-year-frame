const { ensureWineCatalog } = require('../wine/ensureWineCatalog');

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

module.exports = {
  classifyWineItemRow,
  defaultWineLabelFromCatalog,
  fetchWineLabelDimensionsLookup,
  fetchWineRegistryForUsageStats,
  invItemWineKey,
  isSuspectedWineItem,
  normalizeVolumeDisplay,
  orderWinesForUsageStats,
  sqlAggNum,
  wineCatalogSpecLine,
  wineCatalogSpecLineUi,
  wineColumnDisplayMeta,
  wineStatLabelFromItem,
  wineUsageEntryFromLabel,
  wineVolumeSpecFromRow,
};
