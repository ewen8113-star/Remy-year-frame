const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { ensureWineReturnTable } = require('./routeHelpers');

// 获取酒品使用记录
router.get('/', async (req, res) => {
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

// 记录酒品使用（从活动调用）
router.post('/', async (req, res) => {
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

    // 扣减库存：允许出现负库存（用于先申请后归还的业务场景）
    const [updateResult] = await conn.query(`
      UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?
    `, [quantity, wine_code]);
    if (updateResult.affectedRows === 0) {
      // 若库存记录不存在，创建后直接记为负库存
      await conn.query(
        `INSERT INTO wine_inventory (wine_code, wine_name, spec, quantity, unit_price)
         VALUES (?, ?, ?, ?, 0)`,
        [wine_code, wine_name || wine_code, spec || '', -Number(quantity || 0)]
      );
    }

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
router.delete('/:id', async (req, res) => {
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
router.put('/:id', async (req, res) => {
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
      const [upd] = await conn.query('UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?', [delta, wine_code]);
      if (upd.affectedRows === 0) {
        await conn.query(
          `INSERT INTO wine_inventory (wine_code, wine_name, spec, quantity, unit_price)
           VALUES (?, ?, ?, ?, 0)`,
          [wine_code, wine_name || wine_code, spec || '', -delta]
        );
      }
    } else {
      // 变更酒品：先回补旧酒品，再扣减新酒品
      await conn.query('UPDATE wine_inventory SET quantity = quantity + ? WHERE wine_code = ?', [old.quantity, old.wine_code]);
      const [upd] = await conn.query('UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?', [newQty, wine_code]);
      if (upd.affectedRows === 0) {
        await conn.query(
          `INSERT INTO wine_inventory (wine_code, wine_name, spec, quantity, unit_price)
           VALUES (?, ?, ?, ?, 0)`,
          [wine_code, wine_name || wine_code, spec || '', -newQty]
        );
      }
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

// 部分归还使用量：回补库存并减少使用记录数量
router.post('/:id/return', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await ensureWineReturnTable(db);
    await conn.beginTransaction();
    const { id } = req.params;
    const returnQty = parseInt(req.body?.quantity, 10) || 0;
    const returnRemark = String(req.body?.remarks || '').trim();
    if (returnQty <= 0) {
      await conn.rollback();
      return res.status(400).json({ error: '归还数量必须大于 0' });
    }

    const [rows] = await conn.query('SELECT * FROM wine_usage WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: '使用记录不存在' });
    }
    const old = rows[0];
    const oldQty = parseInt(old.quantity, 10) || 0;
    if (returnQty > oldQty) {
      await conn.rollback();
      return res.status(400).json({ error: '归还数量不能超过本条使用数量' });
    }

    const [upd] = await conn.query(
      'UPDATE wine_inventory SET quantity = quantity + ? WHERE wine_code = ?',
      [returnQty, old.wine_code]
    );
    if (upd.affectedRows === 0) {
      await conn.query(
        `INSERT INTO wine_inventory (wine_code, wine_name, spec, quantity, unit_price)
         VALUES (?, ?, ?, ?, 0)`,
        [old.wine_code, old.wine_name || old.wine_code, old.spec || '', returnQty]
      );
    }

    const remained = oldQty - returnQty;
    if (remained <= 0) {
      await conn.query('DELETE FROM wine_usage WHERE id = ?', [id]);
    } else {
      const mergedRemark = [old.remarks, returnRemark ? `归还${returnQty}瓶：${returnRemark}` : `归还${returnQty}瓶`]
        .filter(Boolean)
        .join('；');
      await conn.query(
        'UPDATE wine_usage SET quantity = ?, remarks = ? WHERE id = ?',
        [remained, mergedRemark, id]
      );
    }

    await conn.query(
      `INSERT INTO wine_return_logs
        (year_frame_id, usage_id, activity_id, wine_code, wine_name, spec, quantity, return_date, operator, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
      [
        old.year_frame_id || 1,
        old.id,
        old.activity_id || null,
        old.wine_code,
        old.wine_name || old.wine_code,
        old.spec || '',
        returnQty,
        String(req.body?.operator || '').trim() || null,
        returnRemark || null,
      ]
    );

    await conn.commit();
    return res.json({ message: `已归还 ${returnQty} 瓶并回补库存` });
  } catch (err) {
    await conn.rollback();
    console.error('归还酒品失败:', err);
    return res.status(500).json({ error: '归还酒品失败: ' + err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
