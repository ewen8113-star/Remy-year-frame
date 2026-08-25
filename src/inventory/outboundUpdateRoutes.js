const express = require('express');
const db = require('../config/database');
const {
  parseActivityDateInput,
  parseOutboundShippedAtInput,
} = require('./formatters');
const {
  canonicalOutboundProjectCode,
  resolveOutboundActivityId,
} = require('./outboundProject');
const {
  loadOrderDetail,
  serializeOrderDetailForJson,
} = require('./outboundHelpers');

const router = express.Router();

/** 更新出库单：头信息 + 明细行（与新建校验一致；先回冲旧行再扣新行；无归还记录且未结清） */
router.put('/outbound/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(orderId)) return res.status(400).json({ error: '无效 ID' });
    const {
      inv_warehouse_id,
      link_mode,
      project_code,
      purpose,
      activity_id,
      shipped_at,
      activity_date,
      recipient_city,
      recipient_address,
      contact_name,
      contact_phone,
      logistics_supplier,
      logistics_method,
      tracking_number,
      remarks,
      lines,
      year_frame_id,
    } = req.body;
    const whId = parseInt(inv_warehouse_id, 10);
    const lm = link_mode === 'standalone' ? 'standalone' : 'activity';
    const op = (req.session && req.session.user && req.session.user.username) || '';

    if (!Array.isArray(lines) || !lines.length) {
      return res.status(400).json({ error: '请填写出库明细' });
    }
    if (lm === 'activity' && !String(project_code || '').trim()) {
      return res.status(400).json({ error: '请填写项目编号' });
    }
    if (lm === 'standalone' && !String(purpose || '').trim()) {
      return res.status(400).json({ error: '请填写用途说明' });
    }
    const trackingNumber = tracking_number != null && String(tracking_number).trim() !== '' ? String(tracking_number).trim() : null;
    const shippedAtPut = parseOutboundShippedAtInput(shipped_at) || new Date();
    const activityDatePut = parseActivityDateInput(activity_date);

    await conn.beginTransaction();

    let resolvedActivityIdPut = null;
    if (lm === 'activity') {
      try {
        resolvedActivityIdPut = await resolveOutboundActivityId(conn, project_code, activity_id, year_frame_id);
      } catch (e) {
        await conn.rollback();
        return res.status(e.statusCode || 400).json({ error: e.message || '场次解析失败' });
      }
    }

    const [ords] = await conn.query(
      'SELECT id, status FROM inv_outbound_orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (!ords.length) {
      await conn.rollback();
      return res.status(404).json({ error: '单据不存在' });
    }
    if (ords[0].status === 'closed') {
      await conn.rollback();
      return res.status(400).json({ error: '已结清单据不可修改' });
    }
    const [rb] = await conn.query(
      'SELECT COUNT(*) AS c FROM inv_return_batches WHERE outbound_order_id = ?',
      [orderId]
    );
    if (Number(rb[0].c) > 0) {
      await conn.rollback();
      return res.status(400).json({ error: '已有归还记录，不可修改' });
    }

    const [oldLines] = await conn.query(
      'SELECT item_id, quantity FROM inv_outbound_lines WHERE order_id = ?',
      [orderId]
    );
    for (const ol of oldLines) {
      await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [
        ol.quantity,
        ol.item_id,
      ]);
    }
    await conn.query('DELETE FROM inv_outbound_lines WHERE order_id = ?', [orderId]);

    let headerWhId = Number.isFinite(whId) ? whId : null;
    if (!headerWhId) {
      const firstItemId = parseInt(lines[0]?.item_id, 10);
      if (Number.isFinite(firstItemId)) {
        const [it0] = await conn.query('SELECT inv_warehouse_id FROM inv_items WHERE id = ? LIMIT 1', [firstItemId]);
        if (it0.length) headerWhId = Number(it0[0].inv_warehouse_id);
      }
    }
    if (!headerWhId) throw new Error('无法识别仓库，请检查出库明细');

    const storedProjectCodePut = await canonicalOutboundProjectCode(conn, {
      link_mode: lm,
      project_code,
      activity_id: resolvedActivityIdPut,
      activity_date: activityDatePut,
    });

    await conn.query(
      `
      UPDATE inv_outbound_orders SET
        inv_warehouse_id = ?, activity_id = ?, link_mode = ?, project_code = ?, purpose = ?,
        recipient_city = ?, recipient_address = ?, contact_name = ?, contact_phone = ?,
        logistics_supplier = ?, logistics_method = ?, tracking_number = ?, remarks = ?, shipped_at = ?, activity_date = ?, operator = ?
      WHERE id = ?
    `,
      [
        headerWhId,
        resolvedActivityIdPut,
        lm,
        storedProjectCodePut,
        lm === 'standalone' ? String(purpose).trim() : null,
        recipient_city || null,
        recipient_address || null,
        contact_name || null,
        contact_phone || null,
        logistics_supplier != null && String(logistics_supplier).trim() !== ''
          ? String(logistics_supplier).trim()
          : null,
        logistics_method || null,
        trackingNumber,
        remarks || null,
        shippedAtPut,
        activityDatePut,
        op,
        orderId,
      ]
    );

    for (const ln of lines) {
      const itemId = parseInt(ln.item_id, 10);
      const qty = parseInt(ln.quantity, 10);
      const lineNote = ln.line_note || null;
      if (!Number.isFinite(itemId) || !Number.isFinite(qty) || qty <= 0) {
        throw new Error('明细行数量无效');
      }
      const [itRows] = await conn.query(
        'SELECT id, inv_warehouse_id, quantity_on_hand FROM inv_items WHERE id = ? FOR UPDATE',
        [itemId]
      );
      if (!itRows.length) throw new Error('物料不存在');
      const onHand = Number(itRows[0].quantity_on_hand);
      if (onHand < qty) throw new Error(`库存不足（当前 ${onHand}）`);
      await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', [qty, itemId]);
      await conn.query(
        'INSERT INTO inv_outbound_lines (order_id, item_id, quantity, line_note) VALUES (?, ?, ?, ?)',
        [orderId, itemId, qty, lineNote]
      );
    }

    await conn.commit();
    const detail = await loadOrderDetail(db, orderId);
    res.json(serializeOrderDetailForJson(detail));
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: e.message || '保存失败' });
  } finally {
    conn.release();
  }
});

module.exports = router;
