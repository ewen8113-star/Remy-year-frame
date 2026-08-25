const express = require('express');
const db = require('../config/database');
const { parseReturnDateInput } = require('./formatters');

const router = express.Router();

/** 物料入库：增加仓库物品库存并记录入库来源。 */
router.post('/inbound', async (req, res) => {
  try {
    const {
      inv_warehouse_id,
      inv_item_id,
      quantity,
      items,
      source,
      remarks,
      inbound_date,
    } = req.body;
    const warehouseId = parseInt(inv_warehouse_id, 10);
    if (!Number.isFinite(warehouseId)) {
      return res.status(400).json({ error: '请选择有效仓库' });
    }
    const inboundDate = parseReturnDateInput(inbound_date);
    const operator = req.session?.user?.display_name || req.session?.user?.username || '系统';
    const itemList =
      Array.isArray(items) && items.length
        ? items
        : inv_item_id != null
          ? [{ inv_item_id, quantity }]
          : [];
    if (!itemList.length) return res.status(400).json({ error: '请至少选择一个物品' });

    const ids = [];
    for (const item of itemList) {
      const itemId = parseInt(item.inv_item_id, 10);
      const itemQuantity = parseInt(item.quantity, 10);
      if (!Number.isFinite(itemId) || !Number.isFinite(itemQuantity) || itemQuantity <= 0) {
        continue;
      }
      const [itemRows] = await db.query(
        'SELECT id FROM inv_items WHERE id = ? AND inv_warehouse_id = ? LIMIT 1',
        [itemId, warehouseId]
      );
      if (!itemRows.length) continue;
      await db.query(
        'UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?',
        [itemQuantity, itemId]
      );
      const [result] = await db.query(
        'INSERT INTO inv_inbound_records (inv_warehouse_id, inv_item_id, quantity, source, operator, remarks, inbound_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          warehouseId,
          itemId,
          itemQuantity,
          source || null,
          operator,
          remarks || null,
          inboundDate,
        ]
      );
      ids.push(result.insertId);
    }
    if (!ids.length) return res.status(400).json({ error: '没有有效的物品被入库' });
    res.json({ data: { ids, count: ids.length } });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message || '入库失败' });
  }
});

/** 物料入库记录列表。 */
router.get('/inbound', async (req, res) => {
  try {
    const warehouseId = parseInt(req.query.inv_warehouse_id, 10);
    let sql = `
      SELECT r.id, r.inv_warehouse_id, r.inv_item_id, r.quantity, r.source, r.operator, r.remarks, r.inbound_date, r.created_at,
             i.name AS item_name, i.dimensions AS item_dimensions,
             wh.region, bi.brand_code
      FROM inv_inbound_records r
      JOIN inv_items i ON i.id = r.inv_item_id
      JOIN inv_warehouses wh ON wh.id = r.inv_warehouse_id
      LEFT JOIN brand_inventory bi ON bi.id = wh.brand_id
    `;
    const params = [];
    if (Number.isFinite(warehouseId)) {
      sql += ' WHERE r.inv_warehouse_id = ?';
      params.push(warehouseId);
    }
    sql += ' ORDER BY r.created_at DESC LIMIT 50';
    const [rows] = await db.query(sql, params);
    res.json({ data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

/** 编辑物料入库记录的台账信息（不改库存数量）。 */
router.put('/inbound/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效ID' });
    const { source, remarks, inbound_date } = req.body || {};
    const inboundDate = inbound_date || null;
    const [[record]] = await db.query(
      'SELECT id FROM inv_inbound_records WHERE id = ? LIMIT 1',
      [id]
    );
    if (!record) return res.status(404).json({ error: '记录不存在' });
    await db.query(
      'UPDATE inv_inbound_records SET source = ?, remarks = ?, inbound_date = COALESCE(?, inbound_date) WHERE id = ?',
      [source || null, remarks || null, inboundDate, id]
    );
    res.json({ data: { id } });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message || '更新失败' });
  }
});

/** 删除物料入库记录并回退库存。 */
router.delete('/inbound/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效ID' });
    const [[record]] = await db.query(
      'SELECT inv_item_id, quantity FROM inv_inbound_records WHERE id = ? LIMIT 1',
      [id]
    );
    if (!record) return res.status(404).json({ error: '记录不存在' });
    await db.query(
      'UPDATE inv_items SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?',
      [record.quantity, record.inv_item_id]
    );
    await db.query('DELETE FROM inv_inbound_records WHERE id = ?', [id]);
    res.json({ data: { id } });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message || '删除失败' });
  }
});

module.exports = router;
