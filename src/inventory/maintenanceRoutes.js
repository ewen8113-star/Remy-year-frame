const express = require('express');
const db = require('../config/database');

const router = express.Router();

/** 清理引用已删除出库单的物流孤儿记录；接口幂等。 */
router.post('/cleanup-orphan-logistics', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, remarks FROM logistics WHERE remarks LIKE '%[INV-OB:%'"
    );
    const referencedOrderIds = new Set();
    for (const row of rows) {
      const match = String(row.remarks || '').match(/\[INV-OB:(\d+)\]/);
      if (!match) continue;
      const orderId = parseInt(match[1], 10);
      if (Number.isFinite(orderId)) referencedOrderIds.add(orderId);
    }
    if (!referencedOrderIds.size) {
      return res.json({ ok: true, scanned: rows.length, cleaned: 0, orphan_ids: [] });
    }

    const orderIds = Array.from(referencedOrderIds);
    const [existingRows] = await db.query(
      `SELECT id FROM inv_outbound_orders WHERE id IN (${orderIds.map(() => '?').join(',')})`,
      orderIds
    );
    const existingOrderIds = new Set(existingRows.map((row) => Number(row.id)));
    const orphanIds = [];
    for (const row of rows) {
      const match = String(row.remarks || '').match(/\[INV-OB:(\d+)\]/);
      if (!match) continue;
      const orderId = parseInt(match[1], 10);
      if (Number.isFinite(orderId) && !existingOrderIds.has(orderId)) {
        orphanIds.push(row.id);
      }
    }
    if (orphanIds.length) {
      await db.query(
        `DELETE FROM logistics WHERE id IN (${orphanIds.map(() => '?').join(',')})`,
        orphanIds
      );
    }
    res.json({
      ok: true,
      scanned: rows.length,
      cleaned: orphanIds.length,
      orphan_ids: orphanIds,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '清理失败' });
  }
});

module.exports = router;
