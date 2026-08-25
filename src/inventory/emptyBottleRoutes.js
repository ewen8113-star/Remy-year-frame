const express = require('express');
const db = require('../config/database');
const { parseMonthRangeForSql } = require('./formatters');
const { buildEmptyBottleName } = require('./itemHelpers');
const { inboundReceiptDisplayLabels } = require('./outboundHelpers');

const router = express.Router();

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
    rows.forEach((row) => {
      const key = `${row.inv_warehouse_id}`;
      if (!byWarehouse.has(key)) {
        byWarehouse.set(key, {
          inv_warehouse_id: Number(row.inv_warehouse_id),
          brand_code: row.brand_code,
          region: row.region,
          total_empty_bottles: 0,
          rows: [],
        });
      }
      const warehouse = byWarehouse.get(key);
      const quantity = Math.max(0, parseInt(row.quantity_on_hand, 10) || 0);
      warehouse.total_empty_bottles += quantity;
      warehouse.rows.push({
        item_id: Number(row.item_id),
        name: row.name,
        quantity_on_hand: quantity,
        updated_at: row.updated_at,
      });
    });
    res.json(Array.from(byWarehouse.values()));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载空瓶回收汇总失败' });
  }
});

/** 回收时间使用入库批次 created_at，即填写登记时间。 */
router.get('/empty-bottles/items/:itemId/trace', async (req, res) => {
  try {
    const monthRange = parseMonthRangeForSql(req.query.month);
    const itemId = parseInt(req.params.itemId, 10);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return res.status(400).json({ error: '无效物品' });
    }
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
    const emptyBottleItem = items[0];
    const name = String(emptyBottleItem.name || '');
    const description = String(emptyBottleItem.description || '');
    if (!name.includes('空瓶') && !description.includes('空瓶')) {
      return res.status(400).json({ error: '仅支持空瓶类物料的回收追溯' });
    }
    const warehouseId = Number(emptyBottleItem.inv_warehouse_id);

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
      monthRange ? [warehouseId, monthRange[0], monthRange[1]] : [warehouseId]
    );

    const filteredRows = rawRows.filter((row) => {
      const linkedItemId =
        row.empty_bottle_item_id != null ? Number(row.empty_bottle_item_id) : null;
      if (Number.isFinite(linkedItemId) && linkedItemId > 0) return linkedItemId === itemId;
      return buildEmptyBottleName(row.source_material_name) === name;
    });

    const lines = filteredRows.map((row) => {
      const labels = inboundReceiptDisplayLabels({
        link_mode: row.link_mode,
        purpose: row.purpose,
        project_code: row.project_code,
        activity_city: row.activity_city,
        activity_type: row.activity_type,
        client_name: row.client_name,
      });
      return {
        return_line_id: Number(row.return_line_id),
        qty_empty_recovered: Math.max(0, parseInt(row.qty_empty_recovered, 10) || 0),
        inbound_recorded_at: row.inbound_recorded_at,
        return_date: row.return_date,
        batch_id: Number(row.batch_id),
        outbound_order_id: Number(row.outbound_order_id),
        source_material_name: row.source_material_name,
        display_main: labels.display_main,
        display_sub: labels.display_sub,
      };
    });

    res.json({
      item: {
        id: Number(emptyBottleItem.id),
        name: emptyBottleItem.name,
        quantity_on_hand: Math.max(0, parseInt(emptyBottleItem.quantity_on_hand, 10) || 0),
        inv_warehouse_id: warehouseId,
        brand_code: emptyBottleItem.brand_code,
        region: emptyBottleItem.region,
      },
      lines,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载空瓶追溯失败' });
  }
});

module.exports = router;
