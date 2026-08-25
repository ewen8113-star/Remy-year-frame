const express = require('express');
const db = require('../config/database');
const { parseImageUrls } = require('./formatters');
const { sqlAggNum } = require('./wineHelpers');

const router = express.Router();

router.get('/items', async (req, res) => {
  try {
    const warehouseId = parseInt(req.query.inv_warehouse_id, 10);
    if (!Number.isFinite(warehouseId)) {
      return res.status(400).json({ error: '缺少 inv_warehouse_id' });
    }
    const [rows] = await db.query(
      'SELECT * FROM inv_items WHERE inv_warehouse_id = ? ORDER BY is_common DESC, name, id',
      [warehouseId]
    );
    const [outboundTotals] = await db.query(
      `
      SELECT ol.item_id, COALESCE(SUM(ol.quantity), 0) AS total_outbound
      FROM inv_outbound_lines ol
      JOIN inv_outbound_orders o ON o.id = ol.order_id
      WHERE o.inv_warehouse_id = ?
      GROUP BY ol.item_id
    `,
      [warehouseId]
    );
    const [returnTotals] = await db.query(
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
      [warehouseId]
    );
    const outboundMap = new Map(
      outboundTotals.map((row) => [Number(row.item_id), sqlAggNum(row.total_outbound)])
    );
    const returnMap = new Map(
      returnTotals.map((row) => [
        Number(row.item_id),
        {
          damaged: sqlAggNum(row.total_damaged),
          lost: sqlAggNum(row.total_lost),
        },
      ])
    );
    res.json(
      rows.map((row) => {
        const itemId = Number(row.id);
        const totals = returnMap.get(itemId) || { damaged: 0, lost: 0 };
        const totalDamaged =
          row.stats_damaged_override != null
            ? sqlAggNum(row.stats_damaged_override)
            : totals.damaged;
        const totalLost =
          row.stats_lost_override != null ? sqlAggNum(row.stats_lost_override) : totals.lost;
        return {
          ...row,
          image_urls: parseImageUrls(row),
          total_outbound: outboundMap.get(itemId) ?? 0,
          total_damaged: totalDamaged,
          total_lost: totalLost,
        };
      })
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
    const item = rows[0];
    const warehouseId = item.inv_warehouse_id;
    const [aggregateRows] = await db.query(
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
      [warehouseId, id, warehouseId, id, warehouseId, id]
    );
    const aggregate = aggregateRows[0] || {};
    const aggregatedDamaged = sqlAggNum(aggregate.total_damaged);
    const aggregatedLost = sqlAggNum(aggregate.total_lost);
    res.json({
      ...item,
      image_urls: parseImageUrls(item),
      total_outbound: sqlAggNum(aggregate.total_outbound),
      aggregated_total_damaged: aggregatedDamaged,
      aggregated_total_lost: aggregatedLost,
      total_damaged:
        item.stats_damaged_override != null
          ? sqlAggNum(item.stats_damaged_override)
          : aggregatedDamaged,
      total_lost:
        item.stats_lost_override != null
          ? sqlAggNum(item.stats_lost_override)
          : aggregatedLost,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

module.exports = router;
