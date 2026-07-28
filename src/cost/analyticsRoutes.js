const express = require('express');
const db = require('../config/database');

const router = express.Router();

router.get('/analytics/workforce', async (req, res) => {
    try {
        const { yearFrameId } = req.query;
        let query = `
            SELECT id, region, no_cost, total_cost, cost_details
            FROM activities
            WHERE COALESCE(is_virtual, 0) = 0
        `;
        const params = [];
        if (yearFrameId) {
            query += ' AND year_frame_id = ?';
            params.push(yearFrameId);
        }
        const [rows] = await db.execute(query, params);

        const humanKeys = ['supervisor', 'pg', 'parttime', 'bartender', 'performance'];
        const byItem = {
            supervisor: 0,
            pg: 0,
            parttime: 0,
            bartender: 0,
            performance: 0,
        };
        const byRegion = {};
        let validActivityCount = 0;

        const toNum = (v) => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
        };

        rows.forEach((r) => {
            const noCost = r.no_cost === 1 || r.no_cost === true || String(r.no_cost) === '1';
            if (noCost) return;
            validActivityCount += 1;

            const region = String(r.region || '未分区');
            let details = {};
            if (r.cost_details && typeof r.cost_details === 'string') {
                try { details = JSON.parse(r.cost_details); } catch (_) { details = {}; }
            } else if (r.cost_details && typeof r.cost_details === 'object') {
                details = r.cost_details;
            }
            if (!byRegion[region]) {
                byRegion[region] = { activityCount: 0, humanCost: 0, supervisor: 0, pg: 0, parttime: 0, bartender: 0, performance: 0 };
            }
            byRegion[region].activityCount += 1;

            let regionHuman = 0;
            humanKeys.forEach((k) => {
                const val = toNum(details[k]);
                byItem[k] += val;
                byRegion[region][k] += val;
                regionHuman += val;
            });
            byRegion[region].humanCost += regionHuman;
        });

        Object.keys(byItem).forEach((k) => {
            byItem[k] = Math.round(byItem[k] * 100) / 100;
        });
        const regionRows = Object.keys(byRegion).map((region) => ({
            region,
            ...byRegion[region],
            humanCost: Math.round(byRegion[region].humanCost * 100) / 100,
        }));
        regionRows.sort((a, b) => b.humanCost - a.humanCost);

        res.json({
            success: true,
            data: {
                activityCount: validActivityCount,
                byItem,
                byRegion: regionRows,
                topRegion: regionRows[0] || null,
                lowRegion: regionRows.length ? regionRows[regionRows.length - 1] : null,
            },
        });
    } catch (error) {
        console.error('获取人力分析失败:', error);
        res.status(500).json({ success: false, message: '获取人力分析失败' });
    }
});

/**
 * 场次外成本聚合（供将来「数据看板」等使用；前端独立页已下线）
 * 口径：未关联 activity_id 且未合并进场次的板块记录 + 无场次的报销登记
 */
router.get('/off-activity-dashboard', async (req, res) => {
    try {
        const yfRaw = req.query.yearFrameId;
        const yearFrameId = yfRaw != null && String(yfRaw).trim() !== '' ? parseInt(yfRaw, 10) : NaN;
        const yfLog = Number.isFinite(yearFrameId) ? ' AND logistics.year_frame_id = ?' : '';
        const yfWh = Number.isFinite(yearFrameId) ? ' AND warehouse.year_frame_id = ?' : '';
        const yfMp = Number.isFinite(yearFrameId) ? ' AND mp.year_frame_id = ?' : '';
        const yfPr = Number.isFinite(yearFrameId) ? ' AND pr.year_frame_id = ?' : '';
        const yfRe = Number.isFinite(yearFrameId) ? ' AND reimbursements.year_frame_id = ?' : '';
        const params = Number.isFinite(yearFrameId) ? [yearFrameId] : [];

        const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

        const [logRows] = await db.execute(
            `SELECT 'logistics' AS src, logistics.id, logistics.brand AS brand_code, logistics.fee AS amount,
                    logistics.shipping_date AS src_date,
                    TRIM(CONCAT(COALESCE(logistics.logistics_company,''),' ',COALESCE(logistics.express_company,''))) AS summary
             FROM logistics
             WHERE COALESCE(logistics.merged_into_activity,0)=0 AND logistics.activity_id IS NULL ${yfLog}`,
            params
        );
        const [whRows] = await db.execute(
            `SELECT 'warehouse' AS src, warehouse.id, warehouse.brand AS brand_code, warehouse.actual_cost AS amount,
                    warehouse.created_at AS src_date,
                    TRIM(CONCAT(COALESCE(warehouse.region,''),' ',COALESCE(warehouse.month,''),' ',COALESCE(warehouse.remarks,''))) AS summary
             FROM warehouse
             WHERE COALESCE(warehouse.merged_into_activity,0)=0 AND warehouse.activity_id IS NULL ${yfWh}`,
            params
        );
        const [mpRows] = await db.execute(
            `SELECT 'material_purchase' AS src, mp.id,
                    COALESCE(bi.brand_code, bi.brand_name) AS brand_code, mp.total_amount AS amount,
                    mp.purchase_date AS src_date, COALESCE(mp.remarks,'') AS summary
             FROM material_purchases mp
             LEFT JOIN brand_inventory bi ON bi.id = mp.brand_id
             WHERE COALESCE(mp.merged_into_activity,0)=0 AND mp.activity_id IS NULL ${yfMp}`,
            params
        );
        const [prRows] = await db.execute(
            `SELECT 'prop_repair' AS src, pr.id,
                    COALESCE(bi.brand_code, bi.brand_name) AS brand_code, pr.total_amount AS amount,
                    pr.repair_date AS src_date, CONCAT(COALESCE(pr.region,''),' 道具维修') AS summary
             FROM prop_repairs pr
             LEFT JOIN brand_inventory bi ON bi.id = pr.brand_id
             WHERE COALESCE(pr.merged_into_activity,0)=0 AND pr.activity_id IS NULL
               AND COALESCE(pr.no_cost,0)=0 ${yfPr}`,
            params
        );
        const [reRows] = await db.execute(
            `SELECT 'reimbursement' AS src, reimbursements.id, reimbursements.brand AS brand_code,
                    reimbursements.amount, reimbursements.date AS src_date,
                    TRIM(reimbursements.remarks) AS summary
             FROM reimbursements
             WHERE COALESCE(reimbursements.merged_into_activity,0)=0 AND reimbursements.activity_id IS NULL ${yfRe}`,
            params
        );

        const all = []
            .concat(logRows || [], whRows || [], mpRows || [], prRows || [], reRows || [])
            .map((r) => {
                const brand = String(r.brand_code || '其他').trim() || '其他';
                const amount = round2(r.amount);
                const d = r.src_date;
                const dateStr = d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10);
                return {
                    source: r.src,
                    id: r.id,
                    brand,
                    amount,
                    date: dateStr,
                    summary: String(r.summary || '').trim().slice(0, 200),
                };
            })
            .filter((r) => r.amount !== 0);

        const byBrand = new Map();
        let grandTotal = 0;
        all.forEach((r) => {
            grandTotal = round2(grandTotal + r.amount);
            if (!byBrand.has(r.brand)) byBrand.set(r.brand, { brand: r.brand, total: 0, lines: [] });
            const g = byBrand.get(r.brand);
            g.total = round2(g.total + r.amount);
            g.lines.push({
                source: r.source,
                id: r.id,
                amount: r.amount,
                date: r.date,
                summary: r.summary,
            });
        });

        const brands = [...byBrand.values()].sort((a, b) => b.total - a.total);
        res.json({
            data: {
                grandTotal,
                brands,
                lineCount: all.length,
            },
        });
    } catch (error) {
        console.error('场次外成本仪表盘失败:', error);
        res.status(500).json({ error: error.message || '加载失败' });
    }
});

module.exports = router;
