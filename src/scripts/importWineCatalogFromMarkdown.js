/**
 * 从项目根目录「酒品信息总表.md」解析天猫旗舰店表格，写入 wine_catalog。
 *
 * 用法:
 *   node src/scripts/importWineCatalogFromMarkdown.js
 *   node src/scripts/importWineCatalogFromMarkdown.js --file=酒品信息总表.md
 *   node src/scripts/importWineCatalogFromMarkdown.js --dry-run
 *
 * 默认会先删除 sku_code 以 IMPORT-TMALL- 开头的旧导入，再插入（可重复执行）。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { ensureWineCatalog } = require('../wine/ensureWineCatalog');

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (k, def) => {
    const p = argv.find((a) => a.startsWith(`--${k}=`));
    if (p) return p.slice(`--${k}=`.length);
    return def;
  };
  return {
    file: get('file', path.join(__dirname, '../../酒品信息总表.md')),
    dryRun: argv.includes('--dry-run'),
  };
}

/** 从 ### 标题推断品牌与粗类别 */
function applySectionHeader(line, state) {
  const s = line.trim();
  if (/^##\s*一、/.test(s)) {
    state.major = 'bruich';
    return;
  }
  if (/^##\s*二、/.test(s)) {
    state.major = 'remy';
    return;
  }
  if (!/^###/.test(s)) return;

  if (state.major === 'bruich') {
    if (/植物学家/.test(s)) {
      state.brand = '布赫拉迪';
      state.category = '金酒';
    } else {
      state.brand = '布赫拉迪';
      state.category = '威士忌';
    }
    return;
  }

  if (state.major === 'remy') {
    if (/君度系列/.test(s)) {
      state.brand = '君度';
      state.category = '力娇酒';
      return;
    }
    if (/组合礼盒/.test(s)) {
      state.brand = '人头马君度';
      state.category = '礼盒';
      return;
    }
    if (/人头马\s*VSOP|VSOP\s*系列/.test(s)) {
      state.brand = '人头马';
      state.category = '干邑';
      return;
    }
    if (/人头马\s*CLUB|CLUB\s*系列/.test(s)) {
      state.brand = '人头马';
      state.category = '干邑';
      return;
    }
    if (/人头马\s*XO|XO\s*系列/.test(s)) {
      state.brand = '人头马';
      state.category = '干邑';
      return;
    }
  }
}

function parseTableRow(line) {
  if (!line.trim().startsWith('|')) return null;
  const parts = line.split('|').map((c) => c.trim());
  if (parts.length < 8) return null;
  const cols = parts.slice(1, -1);
  if (cols.length < 6) return null;
  const [产品名称, 英文名, 系列, 容量, 参考价, 备注] = cols;
  if (!产品名称 || 产品名称 === '产品名称') return null;
  if (/^[-:|]+$/.test(产品名称.replace(/\s/g, ''))) return null;
  if (产品名称.includes('---')) return null;
  return { 产品名称, 英文名, 系列, 容量, 参考价, 备注 };
}

function buildName(row) {
  let n = String(row.产品名称 || '').trim();
  const en = String(row.英文名 || '').trim();
  const note = String(row.备注 || '').trim();
  if (en && n.length + en.length + 3 <= 200) {
    n = `${n} / ${en}`;
  }
  if (note && n.length + note.length + 4 <= 200) {
    n = `${n}（${note}）`;
  }
  if (n.length > 200) n = n.slice(0, 200);
  return n;
}

function buildCategory(row, state) {
  const series = String(row.系列 || '').trim();
  const base = state.category || '其他';
  if (series) return `${base}/${series}`.slice(0, 64);
  return base.slice(0, 64);
}

async function run() {
  const { file, dryRun } = parseArgs();
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.error('文件不存在:', abs);
    process.exit(1);
  }
  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);

  const state = {
    major: null,
    brand: '布赫拉迪',
    category: '威士忌',
  };

  const rows = [];
  for (const line of lines) {
    if (/^###\s/.test(line) || /^##\s/.test(line)) {
      applySectionHeader(line, state);
      continue;
    }
    const parsed = parseTableRow(line);
    if (!parsed) continue;
    const name = buildName(parsed);
    if (!name) continue;
    const vol = String(parsed.容量 || '').trim() || null;
    const category = buildCategory(parsed, state);
    const brand = state.brand || '';
    rows.push({ brand, name, category, volume_label: vol, sort_order: rows.length + 1 });
  }

  console.log(`解析到 ${rows.length} 条酒品（来自 ${abs}）`);
  if (dryRun) {
    rows.slice(0, 5).forEach((r, i) => console.log(`  [${i + 1}] ${r.brand} | ${r.name} | ${r.volume_label} | ${r.category}`));
    if (rows.length > 5) console.log(`  ... 共 ${rows.length} 条`);
    process.exit(0);
  }

  await ensureWineCatalog(db);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [del] = await conn.query("DELETE FROM wine_catalog WHERE sku_code LIKE 'IMPORT-TMALL-%'");
    console.log('已清除旧导入行数:', del.affectedRows || 0);

    let n = 0;
    for (const r of rows) {
      const sku = `IMPORT-TMALL-${String(n + 1).padStart(5, '0')}`;
      await conn.query(
        `INSERT INTO wine_catalog (brand, name, category, volume_label, image_urls, sku_code, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [r.brand, r.name, r.category, r.volume_label, JSON.stringify([]), sku, r.sort_order]
      );
      n += 1;
    }
    await conn.commit();
    console.log(`✅ 已写入 wine_catalog：${n} 条（sku IMPORT-TMALL-00001 …）`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
