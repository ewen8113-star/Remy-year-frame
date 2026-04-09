/**
 * 成本管理路由
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取成本统计数据
router.get('/stats', async (req, res) => {
    try {
        const { yearFrameId } = req.query;
        
        let yfCondition = yearFrameId ? ' AND yf.id = ?' : '';
        let params = yearFrameId ? [yearFrameId] : [];
        
        // 场次成本 - 只统计活动
        const [activities] = await db.execute(`
            SELECT COALESCE(SUM(a.total_cost), 0) as total_cost, COUNT(*) as count
            FROM activities a
            WHERE a.activity_type IN ('晚宴', '品鉴', '培训', '婚宴', '宴会')
            ${yfCondition}
        `, params);
        
        // 仓储成本
        const [warehouse] = await db.execute(`
            SELECT COALESCE(SUM(actual_cost), 0) as total_cost, COUNT(*) as count
            FROM warehouse
            WHERE 1=1
            ${yfCondition}
        `, params);
        
        // 物流成本
        const [logistics] = await db.execute(`
            SELECT COALESCE(SUM(fee), 0) as total_cost, COUNT(*) as count
            FROM logistics
            WHERE 1=1
            ${yfCondition}
        `, params);
        
        // 报销成本 - 使用 amount 字段
        let reimbQuery = `
            SELECT COALESCE(SUM(amount), 0) as total_cost, COUNT(*) as count
            FROM reimbursements
            WHERE 1=1
        `;
        if (yearFrameId) reimbQuery += ' AND year_frame_id = ?';
        
        const [reimbursements] = await db.execute(reimbQuery, yearFrameId ? [yearFrameId] : []);
        
        const actCost = parseFloat(activities[0]?.total_cost || 0);
        const whCost = parseFloat(warehouse[0]?.total_cost || 0);
        const logCost = parseFloat(logistics[0]?.total_cost || 0);
        const reimbCost = parseFloat(reimbursements[0]?.total_cost || 0);
        const totalCost = actCost + whCost + logCost + reimbCost;
        
        res.json({
            success: true,
            data: {
                total: totalCost,
                actCost, actCount: activities[0]?.count || 0,
                whCost, whCount: warehouse[0]?.count || 0,
                logCost, logCount: logistics[0]?.count || 0,
                reimbCost, reimbCount: reimbursements[0]?.count || 0
            }
        });
    } catch (error) {
        console.error('获取成本统计失败:', error);
        res.status(500).json({ success: false, message: '获取成本统计失败' });
    }
});

// 获取场次成本明细
router.get('/activities', async (req, res) => {
    try {
        const { yearFrameId } = req.query;
        
        let query = `
            SELECT a.id, a.project_code, a.activity_type, a.city, a.region,
                   a.date as activity_date, a.quoted_price, a.total_cost, a.status
            FROM activities a
            WHERE a.activity_type IN ('晚宴', '品鉴', '培训', '婚宴', '宴会')
        `;
        let params = [];
        
        if (yearFrameId) {
            query += ' AND a.year_frame_id = ?';
            params.push(yearFrameId);
        }
        
        query += ' ORDER BY a.date DESC';
        
        const [rows] = await db.execute(query, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('获取场次成本明细失败:', error);
        res.status(500).json({ success: false, message: '获取场次成本明细失败' });
    }
});

// 获取仓储明细
router.get('/warehouse', async (req, res) => {
    try {
        const { yearFrameId } = req.query;
        
        let query = 'SELECT * FROM warehouse WHERE 1=1';
        let params = [];
        
        if (yearFrameId) {
            query += ' AND year_frame_id = ?';
            params.push(yearFrameId);
        }
        
        query += ' ORDER BY id DESC';
        
        const [rows] = await db.execute(query, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('获取仓储明细失败:', error);
        res.status(500).json({ success: false, message: '获取仓储明细失败' });
    }
});

// 获取物流明细
router.get('/logistics', async (req, res) => {
    try {
        const { yearFrameId } = req.query;
        
        let query = 'SELECT * FROM logistics WHERE 1=1';
        let params = [];
        
        if (yearFrameId) {
            query += ' AND year_frame_id = ?';
            params.push(yearFrameId);
        }
        
        query += ' ORDER BY id DESC';
        
        const [rows] = await db.execute(query, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('获取物流明细失败:', error);
        res.status(500).json({ success: false, message: '获取物流明细失败' });
    }
});

module.exports = router;
