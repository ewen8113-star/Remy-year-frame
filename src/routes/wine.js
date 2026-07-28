const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { ensureWineCatalog } = require('../wine/ensureWineCatalog');
const catalogRoutes = require('../wine/catalogRoutes');
const stockInRoutes = require('../wine/stockInRoutes');
const usageRoutes = require('../wine/usageRoutes');
const returnRoutes = require('../wine/returnRoutes');

router.use(async (req, res, next) => {
  try {
    await ensureWineCatalog(db);
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '酒品目录表初始化失败' });
  }
});

router.use('/catalog', catalogRoutes);
router.use('/stock-in', stockInRoutes);
router.use('/usage', usageRoutes);
router.use('/returns', returnRoutes);

// 获取当前酒品库存列表（旧全局库存；新流程以酒品目录 + 分仓为准）
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
