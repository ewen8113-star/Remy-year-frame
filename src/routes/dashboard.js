const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取数据看板
router.get('/', async (req, res) => {
  try {
    const { yearFrameId } = req.query;
    
    let whereClause = '1=1';
    const params = [];
    if (yearFrameId) {
      whereClause += ' AND year_frame_id = ?';
      params.push(yearFrameId);
    }
    
    // 1. 活动统计（按类型）
    const [activityByType] = await db.query(`
      SELECT 
        activity_type,
        COUNT(*) as count,
        SUM(quoted_price) as revenue,
        SUM(total_cost) as cost,
        SUM(quoted_price - total_cost) as profit
      FROM activities
      WHERE ${whereClause}
      GROUP BY activity_type
    `, params);
    
    // 2. 活动统计（按月）
    const [activityByMonth] = await db.query(`
      SELECT 
        DATE_FORMAT(date, '%Y-%m') as month,
        COUNT(*) as count,
        SUM(quoted_price) as revenue,
        SUM(total_cost) as cost
      FROM activities
      WHERE ${whereClause} AND date IS NOT NULL
      GROUP BY DATE_FORMAT(date, '%Y-%m')
      ORDER BY month DESC
      LIMIT 12
    `, params);
    
    // 3. 仓储统计
    const [warehouseStats] = await db.query(`
      SELECT 
        SUM(quoted_price) as revenue,
        SUM(actual_cost) as cost
      FROM warehouse
      WHERE ${whereClause}
    `, params);
    
    // 4. 物流统计
    const [logisticsStats] = await db.query(`
      SELECT SUM(fee) as cost
      FROM logistics
      WHERE ${whereClause}
    `, params);
    
    // 5. 报销统计
    const [reimbStats] = await db.query(`
      SELECT SUM(amount) as cost
      FROM reimbursements
      WHERE ${whereClause}
    `, params);
    
    // 6. 总计
    const totalRevenue = (activityByType.reduce((sum, a) => sum + parseFloat(a.revenue || 0), 0) + parseFloat(warehouseStats[0]?.revenue || 0));
    const totalCost = (
      activityByType.reduce((sum, a) => sum + parseFloat(a.cost || 0), 0) +
      parseFloat(warehouseStats[0]?.cost || 0) +
      parseFloat(logisticsStats[0]?.cost || 0) +
      parseFloat(reimbStats[0]?.cost || 0)
    );
    
    // 7. 最近活动
    const [recentActivities] = await db.query(`
      SELECT * FROM activities
      WHERE ${whereClause}
      ORDER BY date DESC
      LIMIT 10
    `, params);
    
    // 8. 按品牌统计
    const [activityByBrand] = await db.query(`
      SELECT 
        brand,
        COUNT(*) as count,
        SUM(quoted_price) as revenue
      FROM activities
      WHERE ${whereClause}
      GROUP BY brand
      ORDER BY revenue DESC
    `, params);
    
    res.json({
      summary: {
        totalRevenue,
        totalCost,
        profit: totalRevenue - totalCost,
        activityCount: activityByType.reduce((sum, a) => sum + parseInt(a.count), 0)
      },
      activityByType,
      activityByMonth,
      warehouse: warehouseStats[0],
      logistics: logisticsStats[0],
      reimbursements: reimbStats[0],
      recentActivities,
      activityByBrand
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 按城市统计
router.get('/by-city', async (req, res) => {
  try {
    const { yearFrameId } = req.query;
    
    let whereClause = '1=1';
    const params = [];
    if (yearFrameId) {
      whereClause += ' AND year_frame_id = ?';
      params.push(yearFrameId);
    }
    
    const [rows] = await db.query(`
      SELECT 
        city,
        COUNT(*) as count,
        SUM(quoted_price) as revenue,
        SUM(total_cost) as cost
      FROM activities
      WHERE ${whereClause}
      GROUP BY city
      ORDER BY revenue DESC
    `, params);
    
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
