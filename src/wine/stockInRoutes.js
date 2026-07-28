const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取酒品入库记录
router.get('/', async (req, res) => {
  try {
    const { year_frame_id } = req.query;
    let sql = `
      SELECT id, year_frame_id, wine_code, wine_name, spec, quantity, supplier, batch_no,
             unit_price, total_amount, stock_in_date, operator, remarks, created_at
      FROM wine_stock_in
    `;
    const params = [];
    if (year_frame_id) {
      sql += ' WHERE year_frame_id = ?';
      params.push(year_frame_id);
    }
    sql += ' ORDER BY stock_in_date DESC, id DESC';

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('获取入库记录失败:', err);
    res.status(500).json({ error: '获取入库记录失败' });
  }
});

// 酒品入库
router.post('/', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const {
      year_frame_id,
      wine_code, wine_name, spec,
      quantity, unit_price = 0,
      supplier = '', batch_no = '',
      stock_in_date, operator = '', remarks = ''
    } = req.body;

    if (!year_frame_id || !wine_code || !quantity || !stock_in_date) {
      return res.status(400).json({ error: '缺少必填字段' });
    }

    const total_amount = quantity * unit_price;

    // 插入入库记录
    const [result] = await conn.query(`
      INSERT INTO wine_stock_in
        (year_frame_id, wine_code, wine_name, spec, quantity, supplier, batch_no,
         unit_price, total_amount, stock_in_date, operator, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [year_frame_id, wine_code, wine_name, spec, quantity, supplier, batch_no,
        unit_price, total_amount, stock_in_date, operator, remarks]);

    // 更新库存
    const [updateResult] = await conn.query(`
      UPDATE wine_inventory SET quantity = quantity + ? WHERE wine_code = ?
    `, [quantity, wine_code]);

    if (updateResult.affectedRows === 0) {
      // 如果库存记录不存在，插入新的
      await conn.query(`
        INSERT INTO wine_inventory (wine_code, wine_name, spec, quantity, unit_price)
        VALUES (?, ?, ?, ?, ?)
      `, [wine_code, wine_name, spec, quantity, unit_price]);
    }

    await conn.commit();
    res.json({ id: result.insertId, message: '入库成功' });
  } catch (err) {
    await conn.rollback();
    console.error('入库失败:', err);
    res.status(500).json({ error: '入库失败: ' + err.message });
  } finally {
    conn.release();
  }
});

// 批量酒品入库
router.post('/batch', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { year_frame_id, items = [], stock_in_date, operator = '', remarks = '' } = req.body;

    if (!year_frame_id || items.length === 0 || !stock_in_date) {
      return res.status(400).json({ error: '缺少必填字段' });
    }

    const results = [];
    for (const item of items) {
      const { wine_code, wine_name, spec, quantity, unit_price = 0, supplier = '', batch_no = '' } = item;
      if (!wine_code || !quantity) continue;

      const total_amount = quantity * unit_price;

      const [result] = await conn.query(`
        INSERT INTO wine_stock_in
          (year_frame_id, wine_code, wine_name, spec, quantity, supplier, batch_no,
           unit_price, total_amount, stock_in_date, operator, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [year_frame_id, wine_code, wine_name, spec, quantity, supplier, batch_no,
          unit_price, total_amount, stock_in_date, operator, remarks]);

      await conn.query(`
        UPDATE wine_inventory SET quantity = quantity + ? WHERE wine_code = ?
      `, [quantity, wine_code]);

      results.push({ wine_code, inserted_id: result.insertId });
    }

    await conn.commit();
    res.json({ message: '批量入库成功', count: results.length, items: results });
  } catch (err) {
    await conn.rollback();
    console.error('批量入库失败:', err);
    res.status(500).json({ error: '批量入库失败: ' + err.message });
  } finally {
    conn.release();
  }
});

// 删除酒品入库记录（回滚库存）
async function handleDeleteWineStockIn(req, res) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      await conn.rollback();
      return res.status(400).json({ error: '无效记录ID' });
    }

    const [rows] = await conn.query('SELECT * FROM wine_stock_in WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: '入库记录不存在' });
    }
    const row = rows[0];
    const qty = parseInt(row.quantity, 10) || 0;

    // 回滚库存（允许出现负库存，保持与当前业务口径一致）
    await conn.query('UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?', [qty, row.wine_code]);
    await conn.query('DELETE FROM wine_stock_in WHERE id = ?', [id]);

    await conn.commit();
    res.json({ message: '入库记录已删除并回滚库存' });
  } catch (err) {
    await conn.rollback();
    console.error('删除入库记录失败:', err);
    res.status(500).json({ error: '删除入库记录失败: ' + err.message });
  } finally {
    conn.release();
  }
}

router.delete('/:id', handleDeleteWineStockIn);
// 兼容某些环境对 DELETE 方法的限制
router.post('/:id/delete', handleDeleteWineStockIn);

module.exports = router;
