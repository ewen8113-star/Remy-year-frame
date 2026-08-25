const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { ensureWineReturnTable } = require('./routeHelpers');

// 获取酒品归还记录
router.get('/', async (req, res) => {
  try {
    await ensureWineReturnTable(db);
    const { year_frame_id } = req.query;
    let sql = `
      SELECT id, year_frame_id, usage_id, activity_id, wine_code, wine_name, spec, quantity,
             return_date, operator, remarks, created_at
      FROM wine_return_logs
    `;
    const params = [];
    if (year_frame_id) {
      sql += ' WHERE year_frame_id = ?';
      params.push(year_frame_id);
    }
    sql += ' ORDER BY return_date DESC, id DESC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('获取归还记录失败:', err);
    res.status(500).json({ error: '获取归还记录失败' });
  }
});

// 删除归还记录（回滚归还动作：库存减回、用酒数量补回）
async function handleDeleteWineReturn(req, res) {
  const conn = await db.getConnection();
  try {
    await ensureWineReturnTable(db);
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      await conn.rollback();
      return res.status(400).json({ error: '无效记录ID' });
    }

    const [rows] = await conn.query('SELECT * FROM wine_return_logs WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: '归还记录不存在' });
    }
    const row = rows[0];
    const qty = parseInt(row.quantity, 10) || 0;
    if (qty <= 0) {
      await conn.rollback();
      return res.status(400).json({ error: '归还数量异常，无法删除' });
    }

    // 1) 回滚库存增加：减回已归还数量
    const [invUpd] = await conn.query(
      'UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?',
      [qty, row.wine_code]
    );
    if (invUpd.affectedRows === 0) {
      await conn.query(
        `INSERT INTO wine_inventory (wine_code, wine_name, spec, quantity, unit_price)
         VALUES (?, ?, ?, ?, 0)`,
        [row.wine_code, row.wine_name || row.wine_code, row.spec || '', -qty]
      );
    }

    // 2) 补回用酒记录数量（若原记录已删，则重建一条）
    let usagePatched = false;
    if (row.usage_id) {
      const [usageUpd] = await conn.query(
        'UPDATE wine_usage SET quantity = quantity + ? WHERE id = ? AND wine_code = ?',
        [qty, row.usage_id, row.wine_code]
      );
      usagePatched = usageUpd.affectedRows > 0;
    }
    if (!usagePatched) {
      await conn.query(
        `INSERT INTO wine_usage
          (year_frame_id, activity_id, wine_code, wine_name, spec, quantity, usage_date, client_name, operator, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
        [
          row.year_frame_id || 1,
          row.activity_id || null,
          row.wine_code,
          row.wine_name || row.wine_code,
          row.spec || '',
          qty,
          row.return_date || new Date(),
          String(req.body?.operator || '').trim() || null,
          `由删除归还记录 #${id} 自动恢复`,
        ]
      );
    }

    await conn.query('DELETE FROM wine_return_logs WHERE id = ?', [id]);
    await conn.commit();
    return res.json({ message: '归还记录已删除并回滚库存/用酒数据' });
  } catch (err) {
    await conn.rollback();
    console.error('删除归还记录失败:', err);
    return res.status(500).json({ error: '删除归还记录失败: ' + err.message });
  } finally {
    conn.release();
  }
}

router.delete('/:id', handleDeleteWineReturn);
router.post('/:id/delete', handleDeleteWineReturn);

module.exports = router;
