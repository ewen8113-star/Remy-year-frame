const express = require('express');
const db = require('../config/database');
const { parseReturnDateInput } = require('./formatters');
const {
  ensureEmptyBottleItem,
  ensureReturnItemInWarehouse,
} = require('./itemHelpers');
const {
  RETURN_LINE_ACCOUNTED_SUM_SQL,
  RETURN_LINE_ACCOUNTED_SUM_RL_SQL,
  attachOutboundReturnRemain,
  loadOrderDetail,
  queryOutboundReturnRemain,
  serializeOrderDetailForJson,
} = require('./outboundHelpers');

const router = express.Router();

router.delete('/outbound/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(orderId)) return res.status(400).json({ error: '无效 ID' });

    await conn.beginTransaction();
    const [ords] = await conn.query(
      'SELECT id, status FROM inv_outbound_orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (!ords.length) {
      await conn.rollback();
      return res.status(404).json({ error: '单据不存在' });
    }

    const [retRows] = await conn.query(
      `
      SELECT rl.qty_return, rl.qty_empty_recovered, rl.empty_bottle_item_id, rl.return_item_id, ol.item_id
      FROM inv_return_lines rl
      INNER JOIN inv_return_batches rb ON rb.id = rl.batch_id
      INNER JOIN inv_outbound_lines ol ON ol.id = rl.outbound_line_id
      WHERE rb.outbound_order_id = ?
    `,
      [orderId]
    );
    const itemCache = new Map();
    for (const row of retRows) {
      const itemId = parseInt(row.return_item_id, 10) || parseInt(row.item_id, 10);
      if (!Number.isFinite(itemId)) continue;
      const qr = Math.max(0, parseInt(row.qty_return, 10) || 0);
      const qe = Math.max(0, parseInt(row.qty_empty_recovered, 10) || 0);
      if (qr > 0) {
        const [srcLock] = await conn.query('SELECT id, quantity_on_hand FROM inv_items WHERE id = ? FOR UPDATE', [itemId]);
        if (!srcLock.length) throw new Error(`物料 #${itemId} 不存在，无法冲销归还入库`);
        const srcOnHand = Number(srcLock[0].quantity_on_hand);
        if (srcOnHand < qr) {
          throw new Error(`物料 #${itemId} 当前库存 ${srcOnHand}，不足以冲销归还入库 ${qr}`);
        }
        await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', [qr, itemId]);
      }
      if (qe > 0) {
        let emptyItemId = parseInt(row.empty_bottle_item_id, 10);
        // 优先按归还明细中实际记录的空瓶物料扣减，避免因名称/规格变更导致扣错条目
        if (!Number.isFinite(emptyItemId) || emptyItemId <= 0) {
          let src = itemCache.get(itemId);
          if (!src) {
            const [srcRows] = await conn.query(
              'SELECT id, inv_warehouse_id, name, dimensions FROM inv_items WHERE id = ? LIMIT 1',
              [itemId]
            );
            if (!srcRows.length) throw new Error(`物料 #${itemId} 不存在，无法冲销空瓶回收`);
            src = srcRows[0];
            itemCache.set(itemId, src);
          }
          emptyItemId = await ensureEmptyBottleItem(conn, src);
        }
        const [emptyLock] = await conn.query('SELECT id, quantity_on_hand FROM inv_items WHERE id = ? FOR UPDATE', [emptyItemId]);
        if (!emptyLock.length) throw new Error(`空瓶物料 #${emptyItemId} 不存在，无法冲销空瓶回收`);
        const emptyOnHand = Number(emptyLock[0].quantity_on_hand);
        if (emptyOnHand < qe) {
          throw new Error(`空瓶物料 #${emptyItemId} 当前库存 ${emptyOnHand}，不足以冲销空瓶回收 ${qe}`);
        }
        await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', [qe, emptyItemId]);
      }
    }

    await conn.query('DELETE FROM inv_return_batches WHERE outbound_order_id = ?', [orderId]);

    const [lines] = await conn.query(
      'SELECT item_id, quantity FROM inv_outbound_lines WHERE order_id = ?',
      [orderId]
    );
    for (const ln of lines) {
      const q = parseInt(ln.quantity, 10) || 0;
      if (q <= 0) continue;
      await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [q, ln.item_id]);
    }

    // 无项目编号 standalone 出库在物流成本中自动插入的行，与出库单绑定；删单时一并清除
    const [delLogiResult] = await conn.query(
      'DELETE FROM logistics WHERE remarks LIKE CONCAT("%[INV-OB:", ?, "]%")',
      [orderId]
    );
    const cleanedLogistics = (delLogiResult && delLogiResult.affectedRows) || 0;

    await conn.query('DELETE FROM inv_outbound_orders WHERE id = ?', [orderId]);
    await conn.commit();
    res.json({ ok: true, cleaned_logistics: cleanedLogistics });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message || '删除失败' });
  } finally {
    conn.release();
  }
});

router.post('/outbound/:id/returns', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const orderId = parseInt(req.params.id, 10);
    const { return_date, remarks, lines, inbound_warehouse_id } = req.body;
    const op = (req.session && req.session.user && req.session.user.username) || '';

    if (!Number.isFinite(orderId) || !Array.isArray(lines) || !lines.length) {
      return res.status(400).json({ error: '请填写归还明细' });
    }
    const rd = parseReturnDateInput(return_date);

    await conn.beginTransaction();

    const [ords] = await conn.query('SELECT id, status, inv_warehouse_id FROM inv_outbound_orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!ords.length) throw new Error('单据不存在');
    if (ords[0].status === 'closed') throw new Error('该单已结清');
    const inputInboundWhId = parseInt(inbound_warehouse_id, 10);
    // 批次级 inbound_warehouse_id 仅作台账备注；实际库存按各行物料所属出库仓归还
    const batchInboundWhId =
      Number.isFinite(inputInboundWhId) && inputInboundWhId > 0 ? inputInboundWhId : null;
    if (batchInboundWhId) {
      const [inboundWhRows] = await conn.query('SELECT id FROM inv_warehouses WHERE id = ? LIMIT 1', [batchInboundWhId]);
      if (!inboundWhRows.length) throw new Error('归还入库仓库不存在');
    }

    const hasQty = lines.some(
      (x) =>
        (parseInt(x.qty_return, 10) || 0) +
          (parseInt(x.qty_lost, 10) || 0) +
          (parseInt(x.qty_damaged, 10) || 0) +
          (parseInt(x.qty_consumed, 10) || 0) +
          (parseInt(x.qty_customer_keep, 10) || 0) +
          (parseInt(x.qty_empty_recovered, 10) || 0) >
        0
    );
    if (!hasQty) throw new Error('请至少在一行填写归还、丢失、损坏、消耗、空瓶回收或留给客户数量');

    const [batchIns] = await conn.query(
      'INSERT INTO inv_return_batches (outbound_order_id, return_date, inbound_warehouse_id, operator, remarks) VALUES (?, ?, ?, ?, ?)',
      [orderId, rd, batchInboundWhId, op, remarks || null]
    );
    const batchId = batchIns.insertId;

    for (const ln of lines) {
      const olId = parseInt(ln.outbound_line_id, 10);
      const qr = Math.max(0, parseInt(ln.qty_return, 10) || 0);
      const ql = Math.max(0, parseInt(ln.qty_lost, 10) || 0);
      const qd = Math.max(0, parseInt(ln.qty_damaged, 10) || 0);
      const qc = Math.max(0, parseInt(ln.qty_consumed, 10) || 0);
      const qk = Math.max(0, parseInt(ln.qty_customer_keep, 10) || 0);
      const qe = Math.max(0, parseInt(ln.qty_empty_recovered, 10) || 0);
      if (qr + ql + qd + qc + qk + qe === 0) continue;

      const [olRows] = await conn.query(
        `SELECT
           ol.id, ol.order_id, ol.item_id, ol.quantity,
           it.inv_warehouse_id, it.name, it.description, it.dimensions,
           it.alert_below, it.image_urls, it.is_common, it.is_wine, it.wine_label
         FROM inv_outbound_lines ol
         JOIN inv_items it ON it.id = ol.item_id
         WHERE ol.id = ? FOR UPDATE`,
        [olId]
      );
      if (!olRows.length || olRows[0].order_id !== orderId) throw new Error('无效出库明细行');
      const shipped = Number(olRows[0].quantity);
      const [prevRows] = await conn.query(
        `
        SELECT COALESCE(SUM(${RETURN_LINE_ACCOUNTED_SUM_RL_SQL}), 0) AS s
        FROM inv_return_lines rl
        JOIN inv_return_batches rb ON rb.id = rl.batch_id
        WHERE rl.outbound_line_id = ? AND rb.id <> ?
      `,
        [olId, batchId]
      );
      const already = Number(prevRows[0].s);
      if (qr + ql + qd + qc + qk + qe + already > shipped) {
        throw new Error(`明细行 #${olId} 归还+丢失+损坏+消耗+留客+空瓶回收 超过出库数量`);
      }

      let emptyBottleItemId = null;
      if (qe > 0) {
        emptyBottleItemId = await ensureEmptyBottleItem(conn, olRows[0]);
      }

      let returnItemId = Number(olRows[0].item_id);
      if (qr > 0) {
        const sourceWhId = Number(olRows[0].inv_warehouse_id);
        const lineOverrideWhId = parseInt(ln.inbound_warehouse_id, 10);
        const targetWhId =
          Number.isFinite(lineOverrideWhId) && lineOverrideWhId > 0
            ? lineOverrideWhId
            : Number.isFinite(batchInboundWhId) && batchInboundWhId > 0
              ? batchInboundWhId
              : sourceWhId;
        if (!Number.isFinite(targetWhId) || targetWhId <= 0) {
          throw new Error(`明细行 #${olId} 无法识别原出库仓库`);
        }
        const [targetWhRows] = await conn.query('SELECT id FROM inv_warehouses WHERE id = ? LIMIT 1', [targetWhId]);
        if (!targetWhRows.length) throw new Error(`明细行 #${olId} 归还入库仓库不存在`);
        if (targetWhId !== sourceWhId) {
          returnItemId = await ensureReturnItemInWarehouse(conn, olRows[0], targetWhId);
        }
      }

      await conn.query(
        'INSERT INTO inv_return_lines (batch_id, outbound_line_id, return_item_id, qty_return, qty_lost, qty_damaged, qty_consumed, qty_customer_keep, qty_empty_recovered, empty_bottle_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [batchId, olId, returnItemId, qr, ql, qd, qc, qk, qe, emptyBottleItemId]
      );

      if (qr > 0) {
        await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [qr, returnItemId]);
      }
      if (qe > 0 && emptyBottleItemId) {
        await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [qe, emptyBottleItemId]);
      }
    }

    const [linesOrder] = await conn.query('SELECT id, quantity FROM inv_outbound_lines WHERE order_id = ?', [orderId]);
    let allClosed = true;
    for (const ol of linesOrder) {
      const [sumRow] = await conn.query(
        `SELECT COALESCE(SUM(${RETURN_LINE_ACCOUNTED_SUM_SQL}), 0) AS s FROM inv_return_lines WHERE outbound_line_id = ?`,
        [ol.id]
      );
      const t = Number(sumRow[0].s);
      if (t < Number(ol.quantity)) allClosed = false;
    }
    if (allClosed) {
      await conn.query("UPDATE inv_outbound_orders SET status = 'closed' WHERE id = ?", [orderId]);
    }

    await conn.commit();
    const detail = await loadOrderDetail(db, orderId);
    const remain = await queryOutboundReturnRemain(db, orderId);
    if (detail && detail.order) detail.order = attachOutboundReturnRemain(detail.order, remain);
    res.json(serializeOrderDetailForJson(detail));
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message || '归还失败' });
  } finally {
    conn.release();
  }
});

module.exports = router;
