/**
 * 从现有仓库物料同步生成物品目录（inv_item_catalog）
 * 覆盖范围：PHD、CLUB，以及 X.O（东区/东南区）
 * 去重规则：name + dimensions
 *
 * 用法：
 *   node src/scripts/syncInvItemCatalogFromWarehouses.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');
const { ensureInventoryTables } = require('../inventory/ensureInventoryTables');

function parseImageUrls(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j.filter(Boolean).map(String) : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function keyFor(name, dimensions) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const d = String(dimensions || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return `${n}@@${d}`;
}

async function main() {
  await ensureInventoryTables(db);
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

  const byKey = new Map();
  for (const r of rows || []) {
    const name = String(r.name || '').trim();
    if (!name) continue;
    const dim = String(r.dimensions || '').trim();
    const k = keyFor(name, dim);
    if (!byKey.has(k)) {
      byKey.set(k, {
        name,
        dimensions: dim || null,
        description: String(r.description || '').trim() || null,
        image_urls: parseImageUrls(r.image_urls),
        is_common: r.is_common ? 1 : 0,
        brands: new Set(),
        regions: new Set(),
      });
    }
    const cur = byKey.get(k);
    if (!cur.description && r.description) cur.description = String(r.description).trim();
    if ((!cur.image_urls || !cur.image_urls.length) && parseImageUrls(r.image_urls).length) {
      cur.image_urls = parseImageUrls(r.image_urls);
    }
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
      `SELECT id, source_brands, source_regions, is_common
       FROM inv_item_catalog
       WHERE name = ? AND COALESCE(dimensions, '') = COALESCE(?, '')
       LIMIT 1`,
      [v.name, v.dimensions || null],
    );
    if (exist.length) {
      const old = exist[0];
      const mergedBrands = [...new Set([...(String(old.source_brands || '').split('、').filter(Boolean)), ...(sourceBrands || '').split('、').filter(Boolean)])]
        .sort()
        .join('、') || null;
      const mergedRegions = [...new Set([...(String(old.source_regions || '').split('、').filter(Boolean)), ...(sourceRegions || '').split('、').filter(Boolean)])]
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

  console.log(`✅ 物品目录同步完成：来源 ${rows.length} 行，去重 ${byKey.size} 条，新增 ${inserted}，更新 ${updated}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

