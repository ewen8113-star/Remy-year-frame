/**
 * 数据导入脚本 - 从旧版本导入数据到 MySQL
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function importData() {
    // 连接数据库
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'remy_year_frame'
    });

    try {
        // 读取旧版本数据
        const seedPath = '/Users/ewen/WorkBuddy/20260327214608/remy-project-manager/data/seed.json';
        const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

        console.log('开始导入数据...');
        console.log(`活动记录: ${seedData.activities?.length || 0} 条`);
        console.log(`仓储记录: ${seedData.warehouse?.length || 0} 条`);
        console.log(`物流记录: ${seedData.logistics?.length || 0} 条`);
        console.log(`报销记录: ${seedData.reimbursements?.length || 0} 条`);

        // 导入活动记录
        let actCount = 0;
        for (const act of (seedData.activities || [])) {
            // 判断年份
            const year = new Date(act.date).getFullYear();
            const yearFrameId = year >= 2026 ? 2 : 1; // 25年度=1, 26年度=2

            // 判断活动类型
            const validTypes = ['晚宴', '品鉴', '培训', '婚宴', '宴会'];
            if (!validTypes.includes(act.activityType)) continue;

            try {
                await connection.execute(`
                    INSERT INTO activities 
                    (year_frame_id, year_frame_code, project_code, activity_type, city, brand, 
                     client_name, activity_date, quoted_price, total_cost, executor, status, region)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    yearFrameId,
                    act.yearFrameCode || null,
                    act.projectCode || null,
                    act.activityType,
                    act.city || null,
                    act.brand || null,
                    act.client || null,
                    act.date || null,
                    act.quotedPrice || 0,
                    (act.totalCost || 0) + (act.actualCost || 0), // 合并成本
                    act.executor || null,
                    'pending',
                    act.region || null
                ]);
                actCount++;
            } catch (e) {
                // 忽略重复或错误
            }
        }
        console.log(`✅ 导入活动记录: ${actCount} 条`);

        // 导入仓储记录
        let whCount = 0;
        for (const w of (seedData.warehouse || [])) {
            try {
                await connection.execute(`
                    INSERT INTO warehouse 
                    (year_frame_id, month, wine_name, specifications, quantity, 
                     unit_price, quoted_price, actual_cost, remarks)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    1, // 默认25年度
                    w.month || w.yearMonth || null,
                    w.wineName || w.wine_name || null,
                    w.specs || w.specifications || null,
                    w.quantity || 0,
                    w.unitPrice || 0,
                    w.quotedPrice || 0,
                    w.actualCost || 0,
                    w.remarks || null
                ]);
                whCount++;
            } catch (e) {
                // 忽略
            }
        }
        console.log(`✅ 导入仓储记录: ${whCount} 条`);

        // 导入物流记录
        let logCount = 0;
        for (const l of (seedData.logistics || [])) {
            try {
                await connection.execute(`
                    INSERT INTO logistics 
                    (year_frame_id, logistics_company, tracking_number, origin_city, 
                     destination_city, shipping_date, fee, related_project_code, remarks)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    1, // 默认25年度
                    l.logisticsCompany || l.company || '顺丰',
                    l.trackingNo || l.tracking_number || null,
                    l.warehouse || l.origin || null,
                    l.city || l.destination || null,
                    l.date || null,
                    l.fee || 0,
                    l.projectCode || null,
                    l.remarks || null
                ]);
                logCount++;
            } catch (e) {
                // 忽略
            }
        }
        console.log(`✅ 导入物流记录: ${logCount} 条`);

        // 导入报销记录
        let reimbCount = 0;
        for (const r of (seedData.reimbursements || [])) {
            try {
                await connection.execute(`
                    INSERT INTO reimbursements 
                    (year_frame_id, reimbursement_type, city, amount, date, 
                     related_project_code, props, printing, express, other, remarks)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    1,
                    r.type || r.reimbursement_type || '一般报销',
                    r.city || null,
                    r.amount || 0,
                    r.date || null,
                    r.projectCode || null,
                    r.props || 0,
                    r.printing || 0,
                    r.express || 0,
                    r.other || 0,
                    r.remarks || null
                ]);
                reimbCount++;
            } catch (e) {
                // 忽略
            }
        }
        console.log(`✅ 导入报销记录: ${reimbCount} 条`);

        console.log('\n🎉 数据导入完成！');

    } finally {
        await connection.end();
    }
}

importData().catch(err => {
    console.error('导入失败:', err);
    process.exit(1);
});
