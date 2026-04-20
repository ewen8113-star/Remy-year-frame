/**
 * 从「物料数据.xlsx」导入三张表到对应物资仓库：
 *   X.O 东区2025 → X.O + 东区
 *   X.O 东南区2025（sheet 名末尾可能有空格）→ X.O + 东南区
 *   CLUB 东区2025 → CLUB + 东区
 *
 * 用法:
 *   node src/scripts/importMaterialThreeSheets2025.js
 *   node src/scripts/importMaterialThreeSheets2025.js --file=物料数据.xlsx
 *   node src/scripts/importMaterialThreeSheets2025.js --dry-run
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const db = require('../config/database');
const { ensureInventoryTables } = require('../inventory/ensureInventoryTables');

const INV_REGIONS = ['东区', '南区', '北区', '东南区'];

function canonicalRegion(r) {
  if (r == null) return null;
  let s = String(r).replace(/^\uFEFF/, '').trim().normalize('NFKC');
  const trad = { 東區: '东区', 北區: '北区', 南區: '南区', 東南區: '东南区' };
  if (trad[s]) s = trad[s];
  return INV_REGIONS.includes(s) ? s : null;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (k, def) => {
    const p = argv.find((a) => a.startsWith(`--${k}=`));
    if (p) return p.slice(`--${k}=`.length);
    return def;
  };
  return {
    file: get('file', path.join(__dirname, '../../物料数据.xlsx')),
    dryRun: argv.includes('--dry-run'),
  };
}

/** 与 wb.SheetNames 对齐：允许末尾空格 */
function resolveSheetName(wb, logicalKey) {
  const want = String(logicalKey).trim();
  const exact = wb.SheetNames.find((n) => n === want);
  if (exact) return exact;
  const loose = wb.SheetNames.find((n) => n.trim() === want);
  if (loose) return loose;
  const norm = (s) =>
    String(s)
      .trim()
      .replace(/\u3000/g, ' ')
      .replace(/\s+/g, '');
  const wn = norm(want);
  return wb.SheetNames.find((n) => !/WpsReserved/i.test(n) && norm(n) === wn) || null;
}

function normCell(c) {
  return String(c ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
}

function findHeaderRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i];
    if (!Array.isArray(r)) continue;
    for (const cell of r) {
      if (normCell(cell) === '物料名称') return i;
    }
  }
  return -1;
}

function mapColumns(headerRow) {
  const keys = headerRow.map((_, i) => normCell(headerRow[i]));
  const pick = (...aliases) => {
    for (const al of aliases) {
      const a = normCell(al);
      for (let i = 0; i < keys.length; i++) {
        if (!keys[i]) continue;
        if (keys[i] === a || keys[i].includes(a) || a.includes(keys[i])) return i;
      }
    }
    return -1;
  };
  const nameI = pick('物料名称');
  const qtyI = pick('可用数量');
  if (nameI < 0) throw new Error(`表头缺少「物料名称」，当前: ${JSON.stringify(headerRow)}`);
  if (qtyI < 0) throw new Error(`表头缺少「可用数量」，当前: ${JSON.stringify(headerRow)}`);
  return {
    编号: pick('编号'),
    品牌: pick('品牌'),
    物料名称: nameI,
    规格尺寸: pick('规格尺寸', '规格尺寸mm'),
    单位: pick('单位'),
    可用数量: qtyI,
    所在仓库: pick('所在仓库'),
    所属区域: pick('所属区域'),
    损坏数量: pick('损坏数量'),
    备注: pick('备注'),
  };
}

function buildDimensions(row, ci) {
  const spec = ci.规格尺寸 >= 0 ? String(row[ci.规格尺寸] ?? '').trim() : '';
  const unit = ci.单位 >= 0 ? String(row[ci.单位] ?? '').trim() : '';
  if (spec && unit) return `${spec}（${unit}）`;
  if (spec) return spec;
  if (unit) return unit;
  return null;
}

function buildDescription(row, ci) {
  const parts = [];
  const note = ci.备注 >= 0 ? String(row[ci.备注] ?? '').trim() : '';
  if (note) parts.push(note);
  const wh = ci.所在仓库 >= 0 ? String(row[ci.所在仓库] ?? '').trim() : '';
  if (wh) parts.push(`所在仓库：${wh}`);
  const rawDmg = ci.损坏数量 >= 0 ? row[ci.损坏数量] : '';
  const dmg = rawDmg === '' || rawDmg == null ? NaN : parseInt(String(rawDmg).trim(), 10);
  if (Number.isFinite(dmg) && dmg > 0) parts.push(`损坏数量：${dmg}`);
  return parts.length ? parts.join('；') : null;
}

async function resolveBrandId(conn, code) {
  const c = String(code || '').trim().toUpperCase().replace(/\s/g, '');
  if (!c) throw new Error('品牌为空');
  const [rows] = await conn.query(
    `SELECT id FROM brand_inventory
     WHERE UPPER(REPLACE(TRIM(brand_code), ' ', '')) = ?
        OR UPPER(TRIM(brand_code)) = ?
     LIMIT 1`,
    [c, c]
  );
  if (!rows.length) throw new Error(`品牌「${code}」在 brand_inventory 中不存在，请先在「酒品管理」维护品牌`);
  return rows[0].id;
}

async function getOrCreateWarehouse(conn, brandId, regionNorm) {
  const [ex] = await conn.query('SELECT id FROM inv_warehouses WHERE brand_id = ? AND region = ? LIMIT 1', [
    brandId,
    regionNorm,
  ]);
  if (ex.length) return ex[0].id;
  const [ret] = await conn.query('INSERT INTO inv_warehouses (brand_id, region, label) VALUES (?, ?, ?)', [
    brandId,
    regionNorm,
    'Excel导入',
  ]);
  return ret.insertId;
}

/** 逻辑名用于匹配实际 sheet（含「X.O 东南区2025」末尾空格等） */
const SHEET_TARGETS = [
  { key: 'X.O 东区2025', brand: 'X.O', region: '东区' },
  { key: 'X.O 东南区2025', brand: 'X.O', region: '东南区' },
  { key: 'CLUB 东区2025', brand: 'CLUB', region: '东区' },
];

function parseSheetData(wb, logicalSheetKey) {
  const sheetName = resolveSheetName(wb, logicalSheetKey);
  if (!sheetName) {
    return { sheetName: null, dataRows: [], ci: null };
  }
  const sh = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' });
  const hi = findHeaderRowIndex(rows);
  if (hi < 0) {
    throw new Error(`「${sheetName}」未找到表头（需含「物料名称」）`);
  }
  const ci = mapColumns(rows[hi]);
  const dataRows = rows.slice(hi + 1).filter((r) => String(r[ci.物料名称] ?? '').trim());
  return { sheetName, dataRows, ci };
}

async function importOneSheet(conn, dataRows, ci, whId, brandCode, dryRun) {
  let insert = 0;
  let update = 0;
  const seenNames = new Set();

  for (const row of dataRows) {
    const name = String(row[ci.物料名称] ?? '').trim();
    if (!name) continue;
    if (seenNames.has(name)) console.warn(`   ⚠️ 重复物料名称，后行覆盖前行: ${name}`);
    seenNames.add(name);

    const qtyRaw = row[ci.可用数量];
    const qty = qtyRaw === '' || qtyRaw == null ? 0 : parseInt(String(qtyRaw).trim(), 10);
    const q = Number.isFinite(qty) && qty >= 0 ? qty : 0;

    const rowBrand = ci.品牌 >= 0 ? String(row[ci.品牌] ?? '').trim() : '';
    if (
      rowBrand &&
      rowBrand.toUpperCase().replace(/\s|\./g, '') !== brandCode.toUpperCase().replace(/\s|\./g, '')
    ) {
      console.warn(`   ⚠️ 行品牌「${rowBrand}」与 sheet 目标「${brandCode}」不一致，仍导入目标仓库: ${name}`);
    }

    const dimensions = buildDimensions(row, ci);
    const description = buildDescription(row, ci);
    const isCommon = /常用/.test(String(ci.备注 >= 0 ? row[ci.备注] ?? '' : ''));

    if (dryRun) {
      console.log(`   [dry-run] ${name} | 库存=${q} | 规格=${dimensions || '—'} | 常用=${isCommon ? 1 : 0}`);
      continue;
    }

    const [exist] = await conn.query('SELECT id FROM inv_items WHERE inv_warehouse_id = ? AND name = ? LIMIT 1', [
      whId,
      name,
    ]);

    if (exist.length) {
      await conn.query(
        `UPDATE inv_items SET quantity_on_hand = ?, initial_quantity = ?, dimensions = ?, description = ?, is_common = ?
         WHERE id = ?`,
        [q, q, dimensions, description, isCommon ? 1 : 0, exist[0].id]
      );
      update += 1;
    } else {
      await conn.query(
        `INSERT INTO inv_items (inv_warehouse_id, name, description, dimensions, initial_quantity, quantity_on_hand, alert_below, image_urls, is_common)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [whId, name, description, dimensions, q, q, JSON.stringify([]), isCommon ? 1 : 0]
      );
      insert += 1;
    }
  }

  return { insert, update };
}

async function run() {
  const { file, dryRun } = parseArgs();
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.error('文件不存在:', abs);
    process.exit(1);
  }

  const wb = XLSX.readFile(abs, { cellDates: true });
  console.log('文件:', abs);
  console.log('Sheets:', wb.SheetNames.filter((n) => !/WpsReserved/i.test(n)).join(', '));

  if (dryRun) {
    for (const t of SHEET_TARGETS) {
      const regionNorm = canonicalRegion(t.region);
      if (!regionNorm) {
        console.error('无效区域', t.region);
        process.exit(1);
      }
      let parsed;
      try {
        parsed = parseSheetData(wb, t.key);
      } catch (e) {
        console.error(`「${t.key}」:`, e.message);
        continue;
      }
      if (!parsed.sheetName) {
        console.error(`未找到 sheet: ${t.key}`);
        continue;
      }
      console.log(`\n── [dry-run]「${parsed.sheetName}」→ ${t.brand} / ${regionNorm}：${parsed.dataRows.length} 行`);
      await importOneSheet(null, parsed.dataRows, parsed.ci, 0, t.brand, true);
    }
    console.log('\n✅ dry-run 结束（未写数据库）');
    return;
  }

  const conn = await db.getConnection();
  try {
    await ensureInventoryTables(db);
    let totalI = 0;
    let totalU = 0;

    for (const t of SHEET_TARGETS) {
      const regionNorm = canonicalRegion(t.region);
      if (!regionNorm) {
        console.error('无效区域', t.region);
        process.exit(1);
      }

      let parsed;
      try {
        parsed = parseSheetData(wb, t.key);
      } catch (e) {
        console.error(`「${t.key}」:`, e.message);
        continue;
      }
      if (!parsed.sheetName) {
        console.error(`未找到 sheet: ${t.key}，跳过`);
        continue;
      }

      console.log(`\n── Sheet「${parsed.sheetName}」→ ${t.brand} / ${regionNorm}：${parsed.dataRows.length} 行`);

      const brandId = await resolveBrandId(conn, t.brand);
      const whId = await getOrCreateWarehouse(conn, brandId, regionNorm);
      console.log(`   仓库 inv_warehouses.id=${whId}（brand_id=${brandId}）`);

      const { insert, update } = await importOneSheet(conn, parsed.dataRows, parsed.ci, whId, t.brand, false);
      totalI += insert;
      totalU += update;
      console.log(`   ✅ 本表：新建 ${insert}，更新 ${update}`);
    }

    console.log(`\n✅ 全部完成：新建 ${totalI}，更新 ${totalU}`);
  } finally {
    conn.release();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
