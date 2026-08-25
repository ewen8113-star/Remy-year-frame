const express = require('express');
const router = express.Router();
const db = require('../config/database');

const {
  consolidateSelectedItems,
  dateOnly,
  fetchCandidates,
  fetchSelectedCandidates,
  normText,
  requireSamePayee,
  round2,
  sourceDateForItem,
  linkSourcesToOrder,
  markOrderSourcesPaid,
  rollbackOrderSourcesToUnpaid,
} = require('../paymentOrder/routeHelpers');

router.get('/candidates', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const rows = await fetchCandidates(req.query);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message || '加载待付款记录失败' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { yearFrameId } = req.query;
    const params = [];
    let sql = `
      SELECT po.*, COUNT(poi.id) item_count
      FROM payment_orders po
      LEFT JOIN payment_order_items poi ON poi.payment_order_id = po.id
      WHERE 1=1
    `;
    if (yearFrameId) {
      sql += ' AND po.year_frame_id = ?';
      params.push(parseInt(yearFrameId, 10));
    }
    sql += ' GROUP BY po.id ORDER BY po.created_at DESC, po.id DESC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message || '加载付款单失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [orders] = await db.query('SELECT * FROM payment_orders WHERE id = ?', [id]);
    if (!orders.length) return res.status(404).json({ error: '付款单不存在' });
    const [items] = await db.query('SELECT * FROM payment_order_items WHERE payment_order_id = ? ORDER BY id ASC', [id]);
    res.json({ ...orders[0], items });
  } catch (e) {
    res.status(500).json({ error: e.message || '加载付款单详情失败' });
  }
});

router.post('/', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const yearFrameId = parseInt(req.body.year_frame_id, 10);
    const orderDate = dateOnly(req.body.order_date) || dateOnly(new Date().toISOString());
    const explicitPayee = normText(req.body.payee_name);
    const selectedInput = Array.isArray(req.body.items) ? req.body.items : [];
    if (!Number.isFinite(yearFrameId)) return res.status(400).json({ error: '缺少年框' });
    if (!selectedInput.length) return res.status(400).json({ error: '请选择付款明细' });

    await conn.beginTransaction();
    const selectedRaw = await fetchSelectedCandidates(selectedInput, yearFrameId, conn);
    if (selectedRaw.length !== selectedInput.length) {
      const e = new Error('部分记录不存在、已支付或已归属其它付款单，请刷新后重试');
      e.statusCode = 400;
      throw e;
    }
    const selected = consolidateSelectedItems(selectedRaw);
    selected.forEach((row) => {
      if (!normText(row.payee_name)) {
        const e = new Error('所选记录存在空收款方，请先补填收款方');
        e.statusCode = 400;
        throw e;
      }
    });
    const payeeName = requireSamePayee(selectedRaw, explicitPayee);
    const total = round2(selectedRaw.reduce((s, row) => s + round2(row.amount), 0));
    if (total <= 0) {
      const e = new Error('付款金额须大于 0');
      e.statusCode = 400;
      throw e;
    }

    const createdBy = req.session?.user?.username || null;
    const [ret] = await conn.query(
      `INSERT INTO payment_orders (year_frame_id, payee_name, order_date, payment_date, status, total_amount, remarks, created_by)
       VALUES (?, ?, ?, NULL, 'unpaid', ?, ?, ?)`,
      [yearFrameId, payeeName, orderDate, total, normText(req.body.remarks) || null, createdBy]
    );
    const orderId = ret.insertId;
    const orderNo = `PAY-${String(yearFrameId).padStart(2, '0')}-${String(orderId).padStart(5, '0')}`;
    await conn.query('UPDATE payment_orders SET order_no = ? WHERE id = ?', [orderNo, orderId]);

    for (const row of selected) {
      await conn.query(
        `INSERT INTO payment_order_items
          (payment_order_id, source_type, source_id, amount, project_code, city, brand, description, source_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          row.source_type,
          row.source_id,
          row.amount,
          row.project_code || null,
          row.city || null,
          row.brand || null,
          row.description || null,
          sourceDateForItem(row),
        ]
      );
    }

    await linkSourcesToOrder(orderId, selected, conn);

    await conn.commit();
    const [orders] = await db.query('SELECT * FROM payment_orders WHERE id = ?', [orderId]);
    const [items] = await db.query('SELECT * FROM payment_order_items WHERE payment_order_id = ? ORDER BY id ASC', [orderId]);
    res.status(201).json({ ...orders[0], items });
  } catch (e) {
    await conn.rollback();
    res.status(e.statusCode || 500).json({ error: e.message || '创建付款单失败' });
  } finally {
    conn.release();
  }
});

router.post('/:id/pay', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const paymentDate = dateOnly(req.body.payment_date) || dateOnly(new Date().toISOString());
    await conn.beginTransaction();
    const [orders] = await conn.query('SELECT * FROM payment_orders WHERE id = ? FOR UPDATE', [id]);
    if (!orders.length) {
      const e = new Error('付款单不存在');
      e.statusCode = 404;
      throw e;
    }
    const order = orders[0];
    if (String(order.status || '').toLowerCase() === 'paid') {
      const e = new Error('付款单已是已支付状态');
      e.statusCode = 400;
      throw e;
    }
    await conn.query(
      `UPDATE payment_orders SET status = 'paid', payment_date = ?, updated_at = NOW() WHERE id = ?`,
      [paymentDate, id],
    );
    await markOrderSourcesPaid(id, conn);
    await conn.commit();
    const [updated] = await db.query('SELECT * FROM payment_orders WHERE id = ?', [id]);
    const [items] = await db.query('SELECT * FROM payment_order_items WHERE payment_order_id = ? ORDER BY id ASC', [id]);
    res.json({ ...updated[0], items });
  } catch (e) {
    await conn.rollback();
    res.status(e.statusCode || 500).json({ error: e.message || '确认支付失败' });
  } finally {
    conn.release();
  }
});

/**
 * 删除付款单：先把所有 items 对应来源表回退到 unpaid，再删除明细 + 主单。
 * 仅回退 payment_order_id 仍指向本单的源记录，避免影响之后已被重新归属到其它付款单的记录。
 */
router.delete('/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [orders] = await conn.query('SELECT id FROM payment_orders WHERE id = ?', [id]);
    if (!orders.length) return res.status(404).json({ error: '付款单不存在' });
    const [items] = await conn.query(
      'SELECT id, source_type, source_id FROM payment_order_items WHERE payment_order_id = ?',
      [id]
    );

    await conn.beginTransaction();
    await rollbackOrderSourcesToUnpaid(id, items, conn);
    await conn.query('DELETE FROM payment_order_items WHERE payment_order_id = ?', [id]);
    await conn.query('DELETE FROM payment_orders WHERE id = ?', [id]);
    await conn.commit();
    res.json({ message: '付款单已删除；已回退所属成本记录为未支付' });
  } catch (e) {
    await conn.rollback();
    res.status(e.statusCode || 500).json({ error: e.message || '删除付款单失败' });
  } finally {
    conn.release();
  }
});

module.exports = router;
