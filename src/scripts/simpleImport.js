/**
 * 简单数据导入脚本 - 从旧版 seed.json 导入到 MySQL
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function importData() {
    console.log('开始导入数据...');
    
    // 读取旧版数据
    const seedPath = path.join(__dirname, '../../../remy-project-manager/data/seed.json');
    const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    
    console.log(`找到 ${seedData.activities.length} 条活动记录`);
    
    // 插入活动数据 - 使用实际的列名
    let imported = 0;
    for (const act of seedData.activities) {
        // 判断属于25还是26年度
        const year = parseInt(act.date.split('-')[0]);
        const yearFrameId = year >= 2026 ? 2 : 1;
        
        // 只导入真实活动类型 (晚宴/品鉴/培训/婚宴/宴会)
        const validTypes = ['晚宴', '品鉴', '培训', '婚宴', '宴会', '纯设计'];
        if (!validTypes.includes(act.activityType)) {
            continue; // 跳过仓储/物流费等非活动类型
        }
        
        const sql = `
            INSERT INTO activities (
                year_frame_id, year_frame_code, project_code, date, month, weekday,
                region, category, schedule, brand, city, client, activity_type,
                executor, quoted_price, total_cost, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        try {
            await pool.execute(sql, [
                yearFrameId,
                act.yearFrameCode || '',
                act.projectCode || '',
                act.date || null,
                act.month || '',
                act.weekday || '',
                act.region || '',
                act.category || '',
                act.schedule || '',
                act.brand || '',
                act.city || '',
                act.client || '',
                act.activityType || '晚宴',
                act.executor || '',
                act.quotedPrice || 0,
                act.totalCost || 0,
                'pending'
            ]);
            imported++;
            if (imported % 50 === 0) console.log(`已导入 ${imported} 条...`);
        } catch (e) {
            if (e.code !== 'ER_DUP_ENTRY') {
                console.log('导入错误:', act.projectCode?.substring(0, 30), '-', e.message.substring(0, 60));
            }
        }
    }
    
    console.log(`成功导入 ${imported} 条活动记录`);
    
    // 导入仓储数据 - 实际表结构
    if (seedData.warehouse && seedData.warehouse.length > 0) {
        console.log(`找到 ${seedData.warehouse.length} 条仓储记录`);
        let whImported = 0;
        for (const wh of seedData.warehouse) {
            const year = parseInt(wh.date?.split('-')[0] || '2025');
            const yearFrameId = year >= 2026 ? 2 : 1;
            
            try {
                await pool.execute(`
                    INSERT INTO warehouse (year_frame_id, month, wine_name, specifications, 
                        quantity, unit_price, quoted_price, actual_cost, remarks)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    yearFrameId,
                    wh.month || '',
                    wh.wineName || '',
                    wh.specification || '',
                    wh.quantity || 0,
                    wh.unitPrice || 0,
                    wh.quotedPrice || 0,
                    wh.actualCost || 0,
                    wh.notes || ''
                ]);
                whImported++;
            } catch (e) {
                if (e.code !== 'ER_DUP_ENTRY') console.log('仓储导入错误:', e.message.substring(0, 80));
            }
        }
        console.log(`仓储记录导入 ${whImported} 条`);
    }
    
    // 导入物流数据 - 实际表结构
    if (seedData.logistics && seedData.logistics.length > 0) {
        console.log(`找到 ${seedData.logistics.length} 条物流记录`);
        let lgImported = 0;
        for (const lg of seedData.logistics) {
            const year = parseInt(lg.date?.split('-')[0] || '2025');
            const yearFrameId = year >= 2026 ? 2 : 1;
            
            try {
                await pool.execute(`
                    INSERT INTO logistics (year_frame_id, logistics_company, tracking_number, 
                        origin_city, destination_city, shipping_date, fee, remarks)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    yearFrameId,
                    lg.logisticsCompany || '顺丰',
                    lg.trackingNo || lg.tracking_no || '',
                    lg.origin || '',
                    lg.destination || '',
                    lg.date || null,
                    lg.fee || 0,
                    lg.notes || ''
                ]);
                lgImported++;
            } catch (e) {
                if (e.code !== 'ER_DUP_ENTRY') console.log('物流导入错误:', e.message.substring(0, 80));
            }
        }
        console.log(`物流记录导入 ${lgImported} 条`);
    }
    
    // 关闭连接
    await pool.end();
    console.log('数据导入完成!');
}

importData().catch(e => {
    console.error('导入失败:', e);
    process.exit(1);
});
