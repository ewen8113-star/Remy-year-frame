const express = require('express');
const db = require('../config/database');
const { parseMonthRangeForSql } = require('./formatters');
const {
  RETURN_LINE_ACCOUNTED_SUM_SQL,
  loadOrderDetail,
  serializeOrderDetailForJson,
} = require('./outboundHelpers');

const router = express.Router();

router.get('/outbound', async (req, res) => {
  try {
    const status = req.query.status;
    const monthRange = parseMonthRangeForSql(req.query.month);
    const yearFrameRaw = req.query.yearFrameId ?? req.query.year_frame_id;
    const yearFrameId = parseInt(yearFrameRaw, 10);
    let sql = `
      SELECT o.id, o.activity_id,
             COALESCE(NULLIF(TRIM(act.project_code), ''), NULLIF(TRIM(o.project_code), '')) AS project_code,
             o.purpose, o.link_mode, o.status, o.shipped_at, o.recipient_city,
             o.contact_name, o.contact_phone, o.logistics_supplier, o.recipient_address, o.remarks,
             o.logistics_method, o.tracking_number, o.created_at,
             wh.region, bi.brand_code,
             COALESCE(o.activity_date, act.date, act.activity_date) AS activity_date,
             act.city AS activity_city,
             (SELECT COUNT(*) FROM inv_outbound_lines ol WHERE ol.order_id = o.id) AS line_count,
             (SELECT GROUP_CONCAT(CONCAT_WS(' ', it.name, CONCAT('×', ol2.quantity), NULLIF(it.dimensions, '')) ORDER BY it.name SEPARATOR ' / ')
                FROM inv_outbound_lines ol2
                JOIN inv_items it ON it.id = ol2.item_id
                WHERE ol2.order_id = o.id) AS items_summary,
             (SELECT COUNT(*) FROM inv_return_batches rb WHERE rb.outbound_order_id = o.id) AS return_batch_count,
             (SELECT COALESCE(SUM(GREATEST(0, ol.quantity - COALESCE((
                SELECT SUM(${RETURN_LINE_ACCOUNTED_SUM_SQL})
                FROM inv_return_lines rl WHERE rl.outbound_line_id = ol.id
              ), 0))), 0)
              FROM inv_outbound_lines ol WHERE ol.order_id = o.id) AS qty_unaccounted
      FROM inv_outbound_orders o
      JOIN inv_warehouses wh ON wh.id = o.inv_warehouse_id
      JOIN brand_inventory bi ON bi.id = wh.brand_id
      LEFT JOIN activities act ON act.id = o.activity_id
      WHERE 1=1
    `;
    const params = [];
    if (status === 'open') {
      sql += ' AND o.status = ?';
      params.push('shipped');
    } else if (status === 'closed') {
      sql += ' AND o.status = ?';
      params.push('closed');
    }
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
      sql +=
        ' AND COALESCE(o.shipped_at, o.created_at) >= ? AND COALESCE(o.shipped_at, o.created_at) < ?';
      params.push(monthRange[0], monthRange[1]);
    }
    sql += ' ORDER BY o.id DESC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

router.get('/outbound/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const detail = await loadOrderDetail(db, id);
    if (!detail) return res.status(404).json({ error: '单据不存在' });
    res.json(serializeOrderDetailForJson(detail));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

module.exports = router;
