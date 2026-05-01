const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取所有年框
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM year_frames ORDER BY id');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取单个年框详情（含统计）
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 获取年框基本信息
    const [frames] = await db.query('SELECT * FROM year_frames WHERE id = ?', [id]);
    if (frames.length === 0) {
      return res.status(404).json({ error: '年框不存在' });
    }
    
    const frame = frames[0];
    
    // 统计活动数量和金额（不含虚拟场次）；虚拟场次报价合计单独列为预存口径
    const [activityStats] = await db.query(
      `
      SELECT 
        COUNT(*) as total,
        SUM(quoted_price) as total_revenue,
        SUM(total_cost) as total_cost
      FROM activities WHERE year_frame_id = ? AND COALESCE(is_virtual, 0) = 0
    `,
      [id]
    );
    const [virtualStats] = await db.query(
      `
      SELECT 
        COUNT(*) as virtual_count,
        COALESCE(SUM(quoted_price), 0) as virtual_prepaid_quote_total
      FROM activities WHERE year_frame_id = ? AND COALESCE(is_virtual, 0) = 1
    `,
      [id]
    );
    
    // 统计仓储金额
    const [warehouseStats] = await db.query(`
      SELECT 
        SUM(quoted_price) as total_revenue,
        SUM(actual_cost) as total_cost
      FROM warehouse WHERE year_frame_id = ?
    `, [id]);
    
    // 统计物流金额
    const [logisticsStats] = await db.query(`
      SELECT SUM(fee) as total_cost
      FROM logistics WHERE year_frame_id = ?
    `, [id]);
    
    // 统计报销金额
    const [reimbStats] = await db.query(`
      SELECT SUM(amount) as total_cost
      FROM reimbursements
      WHERE year_frame_id = ? AND COALESCE(merged_into_activity, 0) = 0
    `, [id]);
    
    res.json({
      ...frame,
      stats: {
        activities: activityStats[0],
        virtual_sessions: virtualStats[0],
        warehouse: warehouseStats[0],
        logistics: logisticsStats[0],
        reimbursements: reimbStats[0]
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新年框
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, total_budget, total_revenue, total_cost } = req.body;
    
    await db.query(`
      UPDATE year_frames 
      SET name = ?, total_budget = ?, total_revenue = ?, total_cost = ?
      WHERE id = ?
    `, [name, total_budget, total_revenue, total_cost, id]);
    
    res.json({ message: '更新成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
