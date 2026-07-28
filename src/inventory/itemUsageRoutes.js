const express = require('express');
const db = require('../config/database');
const { jsonYmd } = require('./formatters');
const { sqlAggNum } = require('./wineHelpers');

const router = express.Router();

/** 物品关联场次用量；酒类同时返回归还、空瓶、留客、丢失、损坏和消耗。 */
router.get('/items/:id/activity-usage', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return res.status(400).json({ error: '无效物品 ID' });
    }
    const [items] = await db.query(
      'SELECT id, name, is_wine, wine_label FROM inv_items WHERE id = ? LIMIT 1',
      [itemId]
    );
    if (!items.length) return res.status(404).json({ error: '物品不存在' });
    const item = items[0];

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

    const data = rows.map((row) => ({
      outbound_line_id: Number(row.outbound_line_id),
      outbound_order_id: Number(row.outbound_order_id),
      project_code: row.project_code ? String(row.project_code).trim() : null,
      outbound_date: jsonYmd(row.outbound_shipped_at),
      outbound_quantity: sqlAggNum(row.outbound_quantity),
      inbound_date: row.return_line_id ? jsonYmd(row.inbound_date) : null,
      inbound_quantity: row.return_line_id ? sqlAggNum(row.inbound_quantity) : null,
      qty_empty_recovered: row.return_line_id ? sqlAggNum(row.qty_empty_recovered) : null,
      qty_customer_keep: row.return_line_id ? sqlAggNum(row.qty_customer_keep) : null,
      qty_lost: row.return_line_id ? sqlAggNum(row.qty_lost) : null,
      qty_damaged: row.return_line_id ? sqlAggNum(row.qty_damaged) : null,
      qty_consumed: row.return_line_id ? sqlAggNum(row.qty_consumed) : null,
    }));

    res.json({
      is_wine: Number(item.is_wine) === 1,
      data,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载场次用量失败' });
  }
});

module.exports = router;
