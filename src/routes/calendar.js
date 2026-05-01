/**
 * 排期日历路由
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取指定年月的活动日历
router.get('/', async (req, res) => {
    try {
        const { year, month, yearFrameId } = req.query;
        
        // strategy B：日历活动类型与 lookup_options（category=activity_type, is_active=1）一致，避免与表单维护分叉
        let query = `
            SELECT id, project_code, activity_type, city, brand, 
                   date as activity_date, quoted_price, executor, status
            FROM activities 
            WHERE COALESCE(is_virtual, 0) = 0
              AND LEFT(date, 7) = ? AND activity_type IN (
                SELECT value FROM lookup_options WHERE category = 'activity_type' AND is_active = 1
            )
        `;
        const params = [`${year}-${String(month).padStart(2, '0')}`];
        
        if (yearFrameId) {
            query += ' AND year_frame_id = ?';
            params.push(yearFrameId);
        }
        
        query += ' ORDER BY date ASC';
        
        const [rows] = await db.execute(query, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('获取日历数据失败:', error);
        res.status(500).json({ success: false, message: '获取日历数据失败' });
    }
});

// 获取单个活动的详细信息
router.get('/activity/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.execute(
            'SELECT * FROM activities WHERE id = ?',
            [id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '活动不存在' });
        }
        
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('获取活动详情失败:', error);
        res.status(500).json({ success: false, message: '获取活动详情失败' });
    }
});

module.exports = router;
