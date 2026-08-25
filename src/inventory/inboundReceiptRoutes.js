const express = require('express');
const db = require('../config/database');
const { jsonYmd, parseMonthRangeForSql } = require('./formatters');
const { inboundReceiptDisplayLabels } = require('./outboundHelpers');

const router = express.Router();

/** 归还登记批次列表；按财年筛选规则与物品出库列表一致。 */
router.get('/inbound-receipts', async (req, res) => {
  try {
    const monthRange = parseMonthRangeForSql(req.query.month);
    const yearFrameRaw = req.query.yearFrameId ?? req.query.year_frame_id;
    const yearFrameId = parseInt(yearFrameRaw, 10);
    let sql = `
      SELECT
        rb.id AS batch_id,
        rb.outbound_order_id,
        rb.return_date,
        rb.operator,
        rb.remarks AS batch_remarks,
        rb.created_at,
        o.link_mode,
        o.project_code,
        o.purpose,
        o.activity_id,
        o.status AS outbound_status,
        wh.region,
        bi.brand_code,
        act.city AS activity_city,
        act.activity_type,
        act.client_name,
        COALESCE(agg.sum_qty_return, 0) AS sum_qty_return,
        COALESCE(agg.sum_qty_empty_recovered, 0) AS sum_qty_empty_recovered,
        COALESCE(agg.sum_qty_customer_keep, 0) AS sum_qty_customer_keep,
        COALESCE(agg.sum_qty_lost, 0) AS sum_qty_lost,
        COALESCE(agg.sum_qty_damaged, 0) AS sum_qty_damaged,
        COALESCE(agg.sum_qty_consumed, 0) AS sum_qty_consumed,
        (SELECT GROUP_CONCAT(
                  CONCAT_WS(' ', it.name,
                    CONCAT('×',
                      COALESCE(rl.qty_return,0)
                      + COALESCE(rl.qty_empty_recovered,0)
                      + COALESCE(rl.qty_customer_keep,0)
                      + COALESCE(rl.qty_lost,0)
                      + COALESCE(rl.qty_damaged,0)
                      + COALESCE(rl.qty_consumed,0)
                    ),
                    NULLIF(it.dimensions, '')
                  )
                  ORDER BY it.name SEPARATOR ' / ')
           FROM inv_return_lines rl
           JOIN inv_outbound_lines ol ON ol.id = rl.outbound_line_id
           JOIN inv_items it ON it.id = ol.item_id
           WHERE rl.batch_id = rb.id) AS items_summary
      FROM inv_return_batches rb
      INNER JOIN inv_outbound_orders o ON o.id = rb.outbound_order_id
      INNER JOIN inv_warehouses wh ON wh.id = o.inv_warehouse_id
      INNER JOIN brand_inventory bi ON bi.id = wh.brand_id
      LEFT JOIN activities act ON act.id = o.activity_id
      LEFT JOIN (
        SELECT
          batch_id,
          SUM(qty_return) AS sum_qty_return,
          SUM(qty_empty_recovered) AS sum_qty_empty_recovered,
          SUM(qty_customer_keep) AS sum_qty_customer_keep,
          SUM(qty_lost) AS sum_qty_lost,
          SUM(qty_damaged) AS sum_qty_damaged,
          SUM(qty_consumed) AS sum_qty_consumed
        FROM inv_return_lines
        GROUP BY batch_id
      ) agg ON agg.batch_id = rb.id
      WHERE 1=1
    `;
    const params = [];
    if (Number.isFinite(yearFrameId)) {
      sql += ` AND (
        (o.activity_id IS NOT NULL AND act.year_frame_id = ?)
        OR (o.link_mode = 'standalone' AND o.activity_id IS NULL)
        OR (
          o.activity_id IS NULL
          AND o.link_mode = 'activity'
          AND TRIM(COALESCE(o.project_code, '')) <> ''
          AND EXISTS (
            SELECT 1 FROM activities act_yf
            WHERE act_yf.project_code = o.project_code AND act_yf.year_frame_id = ?
          )
        )
      )`;
      params.push(yearFrameId, yearFrameId);
    }
    if (monthRange) {
      sql += ' AND rb.created_at >= ? AND rb.created_at < ?';
      params.push(monthRange[0], monthRange[1]);
    }
    sql += ' ORDER BY rb.return_date DESC, rb.id DESC';
    const [rows] = await db.query(sql, params);
    const output = rows.map((row) => ({
      ...row,
      return_date: jsonYmd(row.return_date),
      ...inboundReceiptDisplayLabels(row),
    }));
    res.json(output);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

/** 单张入库单详情：明细行及关联出库单号。 */
router.get('/inbound-receipts/:batchId', async (req, res) => {
  try {
    const batchId = parseInt(req.params.batchId, 10);
    if (!Number.isFinite(batchId)) return res.status(400).json({ error: '无效 ID' });
    const [heads] = await db.query(
      `
      SELECT
        rb.id AS batch_id,
        rb.outbound_order_id,
        rb.return_date,
        rb.operator,
        rb.remarks AS batch_remarks,
        rb.created_at,
        o.link_mode,
        o.project_code,
        o.purpose,
        o.shipped_at,
        o.status AS outbound_status,
        o.inv_warehouse_id,
        wh.region,
        bi.brand_code,
        act.city AS activity_city,
        act.activity_type,
        act.client_name
      FROM inv_return_batches rb
      INNER JOIN inv_outbound_orders o ON o.id = rb.outbound_order_id
      INNER JOIN inv_warehouses wh ON wh.id = o.inv_warehouse_id
      INNER JOIN brand_inventory bi ON bi.id = wh.brand_id
      LEFT JOIN activities act ON act.id = o.activity_id
      WHERE rb.id = ?
    `,
      [batchId]
    );
    if (!heads.length) return res.status(404).json({ error: '入库单不存在' });
    const head = { ...heads[0], return_date: jsonYmd(heads[0].return_date) };
    const [lines] = await db.query(
      `
      SELECT
        rl.id AS return_line_id,
        rl.outbound_line_id,
        rl.qty_return,
        rl.qty_lost,
        rl.qty_damaged,
        rl.qty_consumed,
        rl.qty_customer_keep,
        rl.qty_empty_recovered,
        ol.quantity AS outbound_qty,
        it.name AS item_name,
        it.dimensions AS item_dimensions
      FROM inv_return_lines rl
      INNER JOIN inv_outbound_lines ol ON ol.id = rl.outbound_line_id
      INNER JOIN inv_items it ON it.id = ol.item_id
      WHERE rl.batch_id = ?
      ORDER BY rl.id
    `,
      [batchId]
    );
    res.json({ head, lines, display: inboundReceiptDisplayLabels(head) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

module.exports = router;
