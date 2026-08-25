const { serializeImageUrlsForDb } = require('./formatters');

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

module.exports = {
  buildEmptyBottleName,
  ensureEmptyBottleItem,
  ensureReturnItemInWarehouse,
  itemCatalogUniqueKey,
  normKeyPart,
};
