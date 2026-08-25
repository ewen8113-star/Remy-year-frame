const { formatDateTimeSecond } = require('../lib/businessTime');
const { jsonYmd } = require('./formatters');

/** 归还登记行已登记数量合计（与结清判定一致） */
const RETURN_LINE_ACCOUNTED_SUM_SQL =
  'qty_return + qty_lost + qty_damaged + COALESCE(qty_consumed, 0) + qty_customer_keep + qty_empty_recovered';
const RETURN_LINE_ACCOUNTED_SUM_RL_SQL =
  'rl.qty_return + rl.qty_lost + rl.qty_damaged + COALESCE(rl.qty_consumed, 0) + rl.qty_customer_keep + rl.qty_empty_recovered';

function applyActivityProjectCodeToOrder(order) {
  if (!order) return order;
  const actPc = String(order.activity_project_code || '').trim();
  if (actPc) order.project_code = actPc;
  return order;
}

function serializeOrderDetailForJson(detail) {
  if (!detail) return detail;
  const order = applyActivityProjectCodeToOrder({ ...detail.order });
  if (order.activity_date) order.activity_date = jsonYmd(order.activity_date);
  const batches = (detail.batches || []).map((b) => ({
    ...b,
    return_date: jsonYmd(b.return_date),
    created_at: formatDateTimeSecond(b.created_at) || b.created_at,
  }));
  return { ...detail, order, batches };
}

async function queryOutboundReturnRemain(dbOrConn, orderId) {
  const [rows] = await dbOrConn.query(
    `
    SELECT ol.id AS outbound_line_id, ol.quantity AS shipped, it.name AS item_name,
      COALESCE((
        SELECT SUM(${RETURN_LINE_ACCOUNTED_SUM_SQL})
        FROM inv_return_lines rl WHERE rl.outbound_line_id = ol.id
      ), 0) AS accounted
    FROM inv_outbound_lines ol
    JOIN inv_items it ON it.id = ol.item_id
    WHERE ol.order_id = ?
  `,
    [orderId]
  );
  let qtyUnaccounted = 0;
  const pendingLines = [];
  (rows || []).forEach((r) => {
    const shipped = Number(r.shipped) || 0;
    const accounted = Number(r.accounted) || 0;
    const remaining = Math.max(0, shipped - accounted);
    if (remaining > 0) {
      qtyUnaccounted += remaining;
      pendingLines.push({
        outbound_line_id: r.outbound_line_id,
        item_name: r.item_name,
        shipped,
        accounted,
        remaining,
      });
    }
  });
  return { qty_unaccounted: qtyUnaccounted, pending_return_lines: pendingLines };
}

function attachOutboundReturnRemain(order, remain) {
  if (!order || !remain) return order;
  return {
    ...order,
    qty_unaccounted: remain.qty_unaccounted,
    pending_return_lines: remain.pending_return_lines,
  };
}

async function loadOrderDetail(dbOrConn, orderId) {
  // SELECT 顺序很关键：关联场次日期必须使用别名，避免覆盖 o.activity_date。
  const [orders] = await dbOrConn.query(
    `
    SELECT o.*,
           wh.region, wh.brand_id, bi.brand_code, bi.brand_name,
           act.project_code AS activity_project_code,
           act.activity_date AS activity_date_link,
           ayf.year AS activity_year_label
    FROM inv_outbound_orders o
    LEFT JOIN inv_warehouses wh ON wh.id = o.inv_warehouse_id
    LEFT JOIN brand_inventory bi ON bi.id = wh.brand_id
    LEFT JOIN activities act ON act.id = o.activity_id
    LEFT JOIN year_frames ayf ON ayf.id = act.year_frame_id
    WHERE o.id = ?
  `,
    [orderId]
  );
  if (!orders.length) return null;

  const order = orders[0];
  const [lines] = await dbOrConn.query(
    `
    SELECT ol.*, it.name AS item_name, it.dimensions AS item_dimensions,
           it.inv_warehouse_id,
           wh.region AS line_region,
           bi.brand_code AS line_brand_code
    FROM inv_outbound_lines ol
    JOIN inv_items it ON it.id = ol.item_id
    LEFT JOIN inv_warehouses wh ON wh.id = it.inv_warehouse_id
    LEFT JOIN brand_inventory bi ON bi.id = wh.brand_id
    WHERE ol.order_id = ?
    ORDER BY ol.id
  `,
    [orderId]
  );
  const [batches] = await dbOrConn.query(
    `
    SELECT rb.*, wh.region AS inbound_region, bi.brand_code AS inbound_brand_code, bi.brand_name AS inbound_brand_name
    FROM inv_return_batches rb
    LEFT JOIN inv_warehouses wh ON wh.id = rb.inbound_warehouse_id
    LEFT JOIN brand_inventory bi ON bi.id = wh.brand_id
    WHERE rb.outbound_order_id = ?
    ORDER BY rb.id DESC
  `,
    [orderId]
  );
  const batchIds = batches.map((batch) => batch.id);
  let returnLinesByBatch = {};
  if (batchIds.length) {
    const [returnLines] = await dbOrConn.query(
      `SELECT rl.* FROM inv_return_lines rl WHERE rl.batch_id IN (${batchIds.map(() => '?').join(',')})`,
      batchIds
    );
    returnLinesByBatch = returnLines.reduce((grouped, row) => {
      if (!grouped[row.batch_id]) grouped[row.batch_id] = [];
      grouped[row.batch_id].push(row);
      return grouped;
    }, {});
  }
  return {
    order,
    lines,
    batches: batches.map((batch) => ({
      ...batch,
      lines: returnLinesByBatch[batch.id] || [],
    })),
  };
}

/** 入库单台账对用户展示：活动出库 → 项目编号 + 场次辅助信息；非活动 → 手动填写的用途 */
function inboundReceiptDisplayLabels(row) {
  const standalone = String(row.link_mode || '') === 'standalone';
  if (standalone) {
    const main = String(row.purpose || '').trim();
    return { display_main: main || '—', display_sub: '' };
  }
  const pc = String(row.project_code || '').trim();
  const subParts = [];
  if (row.activity_city) subParts.push(String(row.activity_city).trim());
  if (row.activity_type) subParts.push(String(row.activity_type).trim());
  if (row.client_name) subParts.push(String(row.client_name).trim());
  return {
    display_main: pc || '—',
    display_sub: subParts.length ? subParts.join(' · ') : '',
  };
}

module.exports = {
  RETURN_LINE_ACCOUNTED_SUM_SQL,
  RETURN_LINE_ACCOUNTED_SUM_RL_SQL,
  attachOutboundReturnRemain,
  inboundReceiptDisplayLabels,
  loadOrderDetail,
  queryOutboundReturnRemain,
  serializeOrderDetailForJson,
};
