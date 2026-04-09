const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取当前酒品库存列表
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, wine_code, wine_name, spec, quantity, unit_price, created_at, updated_at
      FROM wine_inventory
      ORDER BY wine_name, spec
    `);
    res.json(rows);
  } catch (err) {
    console.error('获取酒品库存失败:', err);
    res.status(500).json({ error: '获取酒品库存失败' });
  }
});

// 获取酒品入库记录
router.get('/stock-in', async (req, res) => {
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

// 获取酒品使用记录
router.get('/usage', async (req, res) => {
  try {
    const { year_frame_id } = req.query;
    let sql = `
      SELECT id, year_frame_id, activity_id, wine_code, wine_name, spec, quantity,
             usage_date, client_name, operator, remarks, created_at
      FROM wine_usage
    `;
    const params = [];
    if (year_frame_id) {
      sql += ' WHERE year_frame_id = ?';
      params.push(year_frame_id);
    }
    sql += ' ORDER BY usage_date DESC, id DESC';
    
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('获取使用记录失败:', err);
    res.status(500).json({ error: '获取使用记录失败' });
  }
});

// 酒品入库
router.post('/stock-in', async (req, res) => {
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
router.post('/stock-in/batch', async (req, res) => {
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

// 记录酒品使用（从活动调用）
router.post('/usage', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    
    const {
      year_frame_id,
      activity_id = null,
      wine_code, wine_name, spec,
      quantity,
      usage_date,
      client_name = '',
      operator = '',
      remarks = ''
    } = req.body;
    
    if (!year_frame_id || !wine_code || !quantity || !usage_date) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    
    // 扣减库存
    const [invRows] = await conn.query(
      'SELECT quantity FROM wine_inventory WHERE wine_code = ?',
      [wine_code]
    );
    
    if (invRows.length === 0 || invRows[0].quantity < quantity) {
      await conn.rollback();
      return res.status(400).json({ error: '库存不足，无法使用' });
    }
    
    await conn.query(`
      UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?
    `, [quantity, wine_code]);
    
    // 插入使用记录
    const [result] = await conn.query(`
      INSERT INTO wine_usage 
        (year_frame_id, activity_id, wine_code, wine_name, spec, quantity, 
         usage_date, client_name, operator, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [year_frame_id, activity_id, wine_code, wine_name, spec, quantity,
        usage_date, client_name, operator, remarks]);
    
    await conn.commit();
    res.json({ id: result.insertId, message: '使用记录已保存' });
  } catch (err) {
    await conn.rollback();
    console.error('记录使用失败:', err);
    res.status(500).json({ error: '记录使用失败: ' + err.message });
  } finally {
    conn.release();
  }
});

// 删除使用记录（退货/回补库存）
router.delete('/usage/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    
    const { id } = req.params;
    
    // 获取使用记录
    const [rows] = await conn.query('SELECT * FROM wine_usage WHERE id = ?', [id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: '记录不存在' });
    }
    
    const record = rows[0];
    
    // 回补库存
    await conn.query(`
      UPDATE wine_inventory SET quantity = quantity + ? WHERE wine_code = ?
    `, [record.quantity, record.wine_code]);
    
    // 删除记录
    await conn.query('DELETE FROM wine_usage WHERE id = ?', [id]);
    
    await conn.commit();
    res.json({ message: '已删除并回补库存' });
  } catch (err) {
    await conn.rollback();
    console.error('删除失败:', err);
    res.status(500).json({ error: '删除失败: ' + err.message });
  } finally {
    conn.release();
  }
});

// 修改使用记录（按差量修正库存）
router.put('/usage/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { id } = req.params;
    const {
      year_frame_id,
      activity_id = null,
      wine_code, wine_name, spec,
      quantity,
      usage_date,
      client_name = '',
      operator = '',
      remarks = ''
    } = req.body;

    if (!year_frame_id || !wine_code || !quantity || !usage_date) {
      await conn.rollback();
      return res.status(400).json({ error: '缺少必填字段' });
    }

    const newQty = parseInt(quantity, 10) || 0;
    if (newQty <= 0) {
      await conn.rollback();
      return res.status(400).json({ error: '使用数量必须大于 0' });
    }

    const [oldRows] = await conn.query('SELECT * FROM wine_usage WHERE id = ?', [id]);
    if (oldRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: '记录不存在' });
    }
    const old = oldRows[0];

    if (old.wine_code === wine_code) {
      // 同酒品：按增量扣减/回补库存
      const delta = newQty - (parseInt(old.quantity, 10) || 0);
      if (delta > 0) {
        const [invRows] = await conn.query('SELECT quantity FROM wine_inventory WHERE wine_code = ? FOR UPDATE', [wine_code]);
        const curQty = invRows.length ? (parseInt(invRows[0].quantity, 10) || 0) : 0;
        if (curQty < delta) {
          await conn.rollback();
          return res.status(400).json({ error: '库存不足，无法增加使用数量' });
        }
      }
      await conn.query('UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?', [delta, wine_code]);
    } else {
      // 变更酒品：先回补旧酒品，再扣减新酒品
      await conn.query('UPDATE wine_inventory SET quantity = quantity + ? WHERE wine_code = ?', [old.quantity, old.wine_code]);

      const [newInvRows] = await conn.query('SELECT quantity FROM wine_inventory WHERE wine_code = ? FOR UPDATE', [wine_code]);
      const newInvQty = newInvRows.length ? (parseInt(newInvRows[0].quantity, 10) || 0) : 0;
      if (newInvQty < newQty) {
        await conn.rollback();
        return res.status(400).json({ error: '库存不足，无法更换为该酒品' });
      }
      await conn.query('UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?', [newQty, wine_code]);
    }

    await conn.query(`
      UPDATE wine_usage SET
        year_frame_id = ?, activity_id = ?, wine_code = ?, wine_name = ?, spec = ?,
        quantity = ?, usage_date = ?, client_name = ?, operator = ?, remarks = ?
      WHERE id = ?
    `, [
      year_frame_id,
      activity_id,
      wine_code,
      wine_name,
      spec,
      newQty,
      usage_date,
      client_name,
      operator,
      remarks,
      id
    ]);

    await conn.commit();
    res.json({ message: '使用记录已更新' });
  } catch (err) {
    await conn.rollback();
    console.error('更新使用记录失败:', err);
    res.status(500).json({ error: '更新失败: ' + err.message });
  } finally {
    conn.release();
  }
});

// 更新库存（手动调整）
router.put('/:wine_code', async (req, res) => {
  try {
    const { wine_code } = req.params;
    const { quantity, unit_price } = req.body;
    
    const updates = [];
    const params = [];
    if (quantity !== undefined) { updates.push('quantity = ?'); params.push(quantity); }
    if (unit_price !== undefined) { updates.push('unit_price = ?'); params.push(unit_price); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有需要更新的字段' });
    }
    
    params.push(wine_code);
    await db.query(`UPDATE wine_inventory SET ${updates.join(', ')} WHERE wine_code = ?`, params);
    
    res.json({ message: '更新成功' });
  } catch (err) {
    console.error('更新失败:', err);
    res.status(500).json({ error: '更新失败' });
  }
});

module.exports = router;
