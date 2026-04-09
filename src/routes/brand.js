const express = require('express');
const router = express.Router();
const db = require('../config/database');

const COLORS = ['gray', 'blue', 'green', 'orange', 'purple', 'pink', 'red', 'cyan'];

// GET /api/brand - 获取所有品牌列表
router.get('/', async (req, res) => {
  try {
    const { active } = req.query;
    let sql = 'SELECT * FROM brand_inventory';
    let params = [];

    if (active === 'true') {
      sql += ' WHERE is_active = 1';
    }
    sql += ' ORDER BY sort_order ASC, id ASC';

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('获取品牌列表失败:', err);
    res.status(500).json({ error: '获取品牌列表失败', message: err.message });
  }
});

// GET /api/brand/:id - 获取单个品牌
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM brand_inventory WHERE id = ?',
      [parseInt(req.params.id)]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: '品牌不存在' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: '获取品牌失败', message: err.message });
  }
});

// POST /api/brand - 新增品牌
router.post('/', async (req, res) => {
  try {
    const { brand_code, brand_name, brand_color = 'gray', sort_order = 0 } = req.body;

    if (!brand_code || !brand_name) {
      return res.status(400).json({ error: '品牌编码和名称不能为空' });
    }

    // 检查编码是否已存在
    const [existing] = await db.query(
      'SELECT id FROM brand_inventory WHERE brand_code = ?',
      [brand_code.trim()]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: '品牌编码已存在' });
    }

    const [result] = await db.query(
      'INSERT INTO brand_inventory (brand_code, brand_name, brand_color, sort_order) VALUES (?, ?, ?, ?)',
      [brand_code.trim(), brand_name.trim(), brand_color, parseInt(sort_order) || 0]
    );

    const [newBrand] = await db.query(
      'SELECT * FROM brand_inventory WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json(newBrand[0]);
  } catch (err) {
    console.error('新增品牌失败:', err);
    res.status(500).json({ error: '新增品牌失败', message: err.message });
  }
});

// PUT /api/brand/:id - 更新品牌
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { brand_code, brand_name, brand_color, sort_order, is_active } = req.body;

    // 检查品牌是否存在
    const [existing] = await db.query(
      'SELECT * FROM brand_inventory WHERE id = ?',
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: '品牌不存在' });
    }

    // 如果修改编码，检查是否与其他品牌冲突
    if (brand_code && brand_code !== existing[0].brand_code) {
      const [conflict] = await db.query(
        'SELECT id FROM brand_inventory WHERE brand_code = ? AND id != ?',
        [brand_code.trim(), id]
      );
      if (conflict.length > 0) {
        return res.status(400).json({ error: '品牌编码已存在' });
      }
    }

    const updates = [];
    const params = [];

    if (brand_code !== undefined) {
      updates.push('brand_code = ?');
      params.push(brand_code.trim());
    }
    if (brand_name !== undefined) {
      updates.push('brand_name = ?');
      params.push(brand_name.trim());
    }
    if (brand_color !== undefined) {
      updates.push('brand_color = ?');
      params.push(brand_color);
    }
    if (sort_order !== undefined) {
      updates.push('sort_order = ?');
      params.push(parseInt(sort_order));
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '没有需要更新的字段' });
    }

    params.push(id);
    await db.query(
      `UPDATE brand_inventory SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const [updated] = await db.query(
      'SELECT * FROM brand_inventory WHERE id = ?',
      [id]
    );

    res.json(updated[0]);
  } catch (err) {
    console.error('更新品牌失败:', err);
    res.status(500).json({ error: '更新品牌失败', message: err.message });
  }
});

// DELETE /api/brand/:id - 删除品牌
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    // 检查品牌是否存在
    const [existing] = await db.query(
      'SELECT * FROM brand_inventory WHERE id = ?',
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: '品牌不存在' });
    }

    // 检查是否有活动关联此品牌
    const [activities] = await db.query(
      'SELECT COUNT(*) as cnt FROM activities WHERE brand = ? LIMIT 1',
      [existing[0].brand_code]
    );
    if (activities[0].cnt > 0) {
      // 软删除：只标记为不活跃
      await db.query(
        'UPDATE brand_inventory SET is_active = 0 WHERE id = ?',
        [id]
      );
      return res.json({
        message: '该品牌有活动关联，已标记为停用',
        soft_deleted: true,
        activity_count: activities[0].cnt
      });
    }

    // 硬删除
    await db.query('DELETE FROM brand_inventory WHERE id = ?', [id]);
    res.json({ message: '品牌已删除', soft_deleted: false });
  } catch (err) {
    console.error('删除品牌失败:', err);
    res.status(500).json({ error: '删除品牌失败', message: err.message });
  }
});

module.exports = router;
