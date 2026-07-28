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

router.post('/outbound', async (req, res) => {
  const conn = await db.getConnection();
  try {
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
      return res.status(400).json({ error: '关联场次出库请填写项目编号' });
    }
    if (lm === 'standalone' && !String(purpose || '').trim()) {
      return res.status(400).json({ error: '非项目出库请填写用途说明' });
    }
    const trackingNumber = tracking_number != null && String(tracking_number).trim() !== '' ? String(tracking_number).trim() : null;
    const shippedAtDb = parseOutboundShippedAtInput(shipped_at) || new Date();
    const activityDateDb = parseActivityDateInput(activity_date);

    await conn.beginTransaction();

    let resolvedActivityId = null;
    if (lm === 'activity') {
      try {
        resolvedActivityId = await resolveOutboundActivityId(conn, project_code, activity_id, year_frame_id);
      } catch (e) {
        await conn.rollback();
        return res.status(e.statusCode || 400).json({ error: e.message || '场次解析失败' });
      }
    }

    let headerWhId = Number.isFinite(whId) ? whId : null;
    if (!headerWhId) {
      const firstItemId = parseInt(lines[0]?.item_id, 10);
      if (Number.isFinite(firstItemId)) {
        const [it0] = await conn.query('SELECT inv_warehouse_id FROM inv_items WHERE id = ? LIMIT 1', [firstItemId]);
        if (it0.length) headerWhId = Number(it0[0].inv_warehouse_id);
      }
    }
    if (!headerWhId) throw new Error('无法识别仓库，请检查出库明细');

    const storedProjectCode = await canonicalOutboundProjectCode(conn, {
      link_mode: lm,
      project_code,
      activity_id: resolvedActivityId,
      activity_date: activityDateDb,
    });

    const [result] = await conn.query(
      `
      INSERT INTO inv_outbound_orders (
        inv_warehouse_id, activity_id, link_mode, project_code, purpose,
        recipient_city, recipient_address, contact_name, contact_phone, logistics_supplier, logistics_method, tracking_number,
        status, shipped_at, activity_date, operator, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shipped', ?, ?, ?, ?)
    `,
      [
        headerWhId,
        resolvedActivityId,
        lm,
        storedProjectCode,
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
        shippedAtDb,
        activityDateDb,
        op,
        remarks || null,
      ]
    );
    const orderId = result.insertId;

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
      if (onHand < qty) throw new Error(`「${itemId}」库存不足（当前 ${onHand}）`);
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
    res.status(500).json({ error: e.message || '出库失败' });
  } finally {
    conn.release();
  }
});

module.exports = router;
