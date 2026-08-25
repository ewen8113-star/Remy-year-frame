const express = require('express');
const db = require('../config/database');

const router = express.Router();

router.get('/stats', async (req, res) => {
    try {
        const { yearFrameId } = req.query;

        const actYf = yearFrameId ? ' AND a.year_frame_id = ?' : '';
        let params = yearFrameId ? [yearFrameId] : [];
        const whYf = yearFrameId ? ' AND year_frame_id = ?' : '';
        const logYf = yearFrameId ? ' AND year_frame_id = ?' : '';

        // 场次成本 - strategy B：活动类型与 lookup_options 对齐（category=activity_type）
        const [activities] = await db.execute(`
            SELECT COALESCE(SUM(a.total_cost), 0) as total_cost, COUNT(*) as count
            FROM activities a
            WHERE COALESCE(a.is_virtual, 0) = 0
              AND a.activity_type IN (
                SELECT value FROM lookup_options WHERE category = 'activity_type' AND is_active = 1
            )
            ${actYf}
        `, params);

        // 仓储成本
        const [warehouse] = await db.execute(`
            SELECT COALESCE(SUM(actual_cost), 0) as total_cost, COUNT(*) as count
            FROM warehouse
            WHERE COALESCE(merged_into_activity, 0) = 0
            ${whYf}
        `, yearFrameId ? [yearFrameId] : []);

        // 物流成本
        const [logistics] = await db.execute(`
            SELECT COALESCE(SUM(fee), 0) as total_cost, COUNT(*) as count
            FROM logistics
            WHERE COALESCE(merged_into_activity, 0) = 0
            ${logYf}
        `, yearFrameId ? [yearFrameId] : []);

        // 物料公共成本池（未计入）
        let materialQuery = `
            SELECT COALESCE(SUM(total_amount), 0) as total_cost, COUNT(*) as count
            FROM material_purchases
            WHERE COALESCE(merged_into_activity, 0) = 0
        `;
        if (yearFrameId) materialQuery += ' AND year_frame_id = ?';
        const [materialPurchases] = await db.execute(materialQuery, yearFrameId ? [yearFrameId] : []);

        // 维修公共成本池（未计入）
        let propRepairQuery = `
            SELECT COALESCE(SUM(total_amount), 0) as total_cost, COUNT(*) as count
            FROM prop_repairs
            WHERE COALESCE(merged_into_activity, 0) = 0
        `;
        if (yearFrameId) propRepairQuery += ' AND year_frame_id = ?';
        const [propRepairs] = await db.execute(propRepairQuery, yearFrameId ? [yearFrameId] : []);

        // 报销公共成本池 - 使用 amount 字段
        let reimbQuery = `
            SELECT COALESCE(SUM(amount), 0) as total_cost, COUNT(*) as count
            FROM reimbursements
            WHERE COALESCE(merged_into_activity, 0) = 0
        `;
        if (yearFrameId) reimbQuery += ' AND year_frame_id = ?';

        const [reimbursements] = await db.execute(reimbQuery, yearFrameId ? [yearFrameId] : []);

        const actCost = parseFloat(activities[0]?.total_cost || 0);
        const whCost = parseFloat(warehouse[0]?.total_cost || 0);
        const logCost = parseFloat(logistics[0]?.total_cost || 0);
        const materialCost = parseFloat(materialPurchases[0]?.total_cost || 0);
        const propRepairCost = parseFloat(propRepairs[0]?.total_cost || 0);
        const reimbCost = parseFloat(reimbursements[0]?.total_cost || 0);
        const totalCost = actCost + whCost + logCost + materialCost + propRepairCost + reimbCost;

        res.json({
            success: true,
            data: {
                total: totalCost,
                actCost, actCount: activities[0]?.count || 0,
                whCost, whCount: warehouse[0]?.count || 0,
                logCost, logCount: logistics[0]?.count || 0,
                materialCost, materialCount: materialPurchases[0]?.count || 0,
                propRepairCost, propRepairCount: propRepairs[0]?.count || 0,
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
            WHERE COALESCE(a.is_virtual, 0) = 0
              AND a.activity_type IN (
                SELECT value FROM lookup_options WHERE category = 'activity_type' AND is_active = 1
            )
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
