/**
 * 刷新目录中的“发光底座”重命名项。
 *
 * 背景：
 * 1) PHD 仓库：发光底座 -> 六边形发光底座
 * 2) X.O 仓库（东区/东南区）：发光底座 -> 发光底座（三件套）
 *
 * 做法：
 * - 先以“新名称”从仓库物料获取 dimensions
 * - 再删除 inv_item_catalog 中同 dimensions 但 name 不是新名称的旧目录行
 *   （按 source_brands 过滤，避免误删其他品牌的同规格物料）
 *
 * 用法：
 *   node src/scripts/refreshInvItemCatalogRenamedGlowBases.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

async function main() {
  const phdNew = '六边形发光底座';
  const xoNew = '发光底座（三件套）';

  // PHD：全区都纳入（你们项目里通常只有一个东区仓库）
  const [phdDimsRows] = await db.query(
    `SELECT DISTINCT COALESCE(i.dimensions,'') AS dim
     FROM inv_items i
     JOIN inv_warehouses w ON w.id = i.inv_warehouse_id
     JOIN brand_inventory b ON b.id = w.brand_id
     WHERE b.brand_code = 'PHD' AND i.name = ?`,
    [phdNew],
  );
  const phdDims = (phdDimsRows || []).map((r) => r.dim).filter((d) => d !== null);

  // X.O：仅东区/东南区（与 item-catalog 同步范围一致）
  const [xoDimsRows] = await db.query(
    `SELECT DISTINCT COALESCE(i.dimensions,'') AS dim
     FROM inv_items i
     JOIN inv_warehouses w ON w.id = i.inv_warehouse_id
     JOIN brand_inventory b ON b.id = w.brand_id
     WHERE b.brand_code = 'X.O'
       AND w.region IN ('东区', '东南区')
       AND i.name = ?`,
    [xoNew],
  );
  const xoDims = (xoDimsRows || []).map((r) => r.dim).filter((d) => d !== null);

  console.log('phdDims:', phdDims);
  console.log('xoDims:', xoDims);

  let deleted = 0;

  for (const dim of phdDims) {
    const [r] = await db.query(
      `DELETE FROM inv_item_catalog
       WHERE COALESCE(dimensions,'') = ?
         AND name <> ?
         AND source_brands LIKE ?`,
      [dim, phdNew, '%PHD%'],
    );
    deleted += r.affectedRows || 0;
  }

  for (const dim of xoDims) {
    const [r] = await db.query(
      `DELETE FROM inv_item_catalog
       WHERE COALESCE(dimensions,'') = ?
         AND name <> ?
         AND source_brands LIKE ?`,
      [dim, xoNew, '%X.O%'],
    );
    deleted += r.affectedRows || 0;
  }

  console.log(`✅ 刷新完成：删除旧目录行 ${deleted} 条`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

