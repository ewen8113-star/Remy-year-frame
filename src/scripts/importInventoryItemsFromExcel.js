/**
 * 从 Excel 导入物资库存物料（单 sheet）
 * 默认读取项目根目录「物料数据.xlsx」的 PHD2025 表。
 *
 * 用法:
 *   node src/scripts/importInventoryItemsFromExcel.js
 *   node src/scripts/importInventoryItemsFromExcel.js --file=物料数据.xlsx --sheet=PHD2025 --region=东区
 *   node src/scripts/importInventoryItemsFromExcel.js --dry-run
 *
 * 说明:
 *   - 需已配置 .env 数据库；会先 ensure inv_* 表
 *   - --region 指定目标物理仓区域（与 inv_warehouses 一致），不存在则自动创建（label: Excel导入）
 *   - 按「品牌」列解析 brand_inventory.brand_code，与仓库品牌一致
 *   - 同仓库同名物料已存在则更新数量与规格/备注（不覆盖已有图片）
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
    sheet: get('sheet', 'PHD2025'),
    region: get('region', '东区'),
    dryRun: argv.includes('--dry-run'),
  };
}

function colIndex(headerRow, names) {
  const idx = {};
  headerRow.forEach((cell, i) => {
    const h = String(cell ?? '').replace(/\s/g, '').trim();
    if (h) idx[h] = i;
  });
  const out = {};
  for (const n of names) {
    if (idx[n] === undefined) {
      throw new Error(`表头缺少列「${n}」，当前表头: ${JSON.stringify(headerRow)}`);
    }
    out[n] = idx[n];
  }
  return out;
}

function buildDimensions(row, ci) {
  const spec = String(row[ci['规格尺寸']] ?? '').trim();
  const unit = String(row[ci['单位']] ?? '').trim();
  if (spec && unit) return `${spec}（${unit}）`;
  if (spec) return spec;
  if (unit) return unit;
  return null;
}

function buildDescription(row, ci) {
  let desc = String(row[ci['备注']] ?? '').trim();
  const rawDmg = row[ci['损坏数量']];
  const dmg =
    rawDmg === '' || rawDmg == null ? NaN : parseInt(String(rawDmg).trim(), 10);
  if (Number.isFinite(dmg) && dmg > 0) {
    desc = desc ? `${desc}；损坏数量：${dmg}` : `损坏数量：${dmg}`;
  }
  return desc || null;
}

async function resolveBrandId(conn, code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) throw new Error('品牌为空');
  const [rows] = await conn.query('SELECT id FROM brand_inventory WHERE UPPER(TRIM(brand_code)) = ? LIMIT 1', [c]);
  if (!rows.length) throw new Error(`品牌「${code}」在 brand_inventory 中不存在，请先维护品牌`);
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

async function run() {
  const { file, sheet, region: regionRaw, dryRun } = parseArgs();
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.error('文件不存在:', abs);
    process.exit(1);
  }
  const regionNorm = canonicalRegion(regionRaw);
  if (!regionNorm) {
    console.error('无效 --region，允许：', INV_REGIONS.join(' / '));
    process.exit(1);
  }

  const wb = XLSX.readFile(abs, { cellDates: true });
  const sh = wb.Sheets[sheet];
  if (!sh) {
    console.error('未找到 sheet:', sheet, '；可用:', wb.SheetNames.join(', '));
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' });
  if (rows.length < 2) {
    console.error('表数据为空');
    process.exit(1);
  }

  const headerRow = rows[0];
  const ci = colIndex(headerRow, ['编号', '品牌', '物料名称', '规格尺寸', '单位', '可用数量', '损坏数量', '备注']);

  const dataRows = rows.slice(1).filter((r) => String(r[ci['物料名称']] ?? '').trim());
  console.log(`读取 ${sheet}：${dataRows.length} 行物料（已跳过空名称行）`);

  const brandCodePreview = dataRows.length ? String(dataRows[0][ci['品牌']] || 'PHD').trim() : 'PHD';

  if (dryRun) {
    console.log(`[dry-run] 将使用品牌「${brandCodePreview}」，目标区域「${regionNorm}」（不写数据库）`);
    const seenNames = new Set();
    for (const row of dataRows) {
      const name = String(row[ci['物料名称']] ?? '').trim();
      if (!name) continue;
      if (seenNames.has(name)) console.warn('⚠️ Excel 内重复物料名称:', name);
      seenNames.add(name);
      const qtyRaw = row[ci['可用数量']];
      const qty = qtyRaw === '' || qtyRaw == null ? 0 : parseInt(String(qtyRaw).trim(), 10);
      const q = Number.isFinite(qty) && qty >= 0 ? qty : 0;
      const dimensions = buildDimensions(row, ci);
      const isCommon = /常用/.test(String(row[ci['备注']] ?? ''));
      console.log(`  ${name} | 库存=${q} | 规格=${dimensions || '—'} | 常用=${isCommon ? 1 : 0}`);
    }
    console.log('✅ dry-run 结束');
    process.exit(0);
  }

  const conn = await db.getConnection();
  try {
    await ensureInventoryTables(db);

    const brandCode = brandCodePreview;
    const brandId = await resolveBrandId(conn, brandCode);
    console.log(`品牌: ${brandCode} → id=${brandId}，目标区域: ${regionNorm}`);

    const whId = await getOrCreateWarehouse(conn, brandId, regionNorm);
    console.log(`仓库 inv_warehouses.id=${whId}`);

    let insert = 0;
    let update = 0;
    const seenNames = new Set();

    for (const row of dataRows) {
      const name = String(row[ci['物料名称']] ?? '').trim();
      if (!name) continue;
      if (seenNames.has(name)) {
        console.warn('⚠️ Excel 内重复物料名称，后行覆盖前行:', name);
      }
      seenNames.add(name);

      const qtyRaw = row[ci['可用数量']];
      const qty = qtyRaw === '' || qtyRaw == null ? 0 : parseInt(String(qtyRaw).trim(), 10);
      const q = Number.isFinite(qty) && qty >= 0 ? qty : 0;

      const dimensions = buildDimensions(row, ci);
      const description = buildDescription(row, ci);
      const isCommon = /常用/.test(String(row[ci['备注']] ?? ''));

      const [exist] = await conn.query(
        'SELECT id FROM inv_items WHERE inv_warehouse_id = ? AND name = ? LIMIT 1',
        [whId, name]
      );

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

    if (!dryRun) {
      console.log(`✅ 完成：新建 ${insert} 条，更新 ${update} 条`);
    }
  } finally {
    conn.release();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
