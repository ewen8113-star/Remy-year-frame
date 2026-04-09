/**
 * 从旧版 IndexedDB 数据导入 MySQL
 * 用法：node src/scripts/importFromJSON.js <json文件路径> <年框ID>
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const mysql = require('mysql2/promise');

async function importData() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('用法: node importFromJSON.js <json文件路径> <年框ID>');
    console.log('示例: node importFromJSON.js ../../seed.json 1');
    process.exit(1);
  }
  
  const jsonPath = path.resolve(args[0]);
  const yearFrameId = parseInt(args[1]);
  
  if (!fs.existsSync(jsonPath)) {
    console.error('文件不存在:', jsonPath);
    process.exit(1);
  }
  
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'remy_year_frame',
    waitForConnections: true,
    connectionLimit: 10
  });
  
  console.log('开始导入数据到年框ID:', yearFrameId);
  
  try {
    const connection = await pool.getConnection();
    console.log('数据库连接成功');
    
    // 导入活动
    if (data.activities && data.activities.length > 0) {
      console.log(`导入 ${data.activities.length} 条活动记录...`);
      
      for (const activity of data.activities) {
        await connection.query(`
          INSERT INTO activities (
            year_frame_id, year_frame_code, project_code, activity_type,
            city, brand, client_name, venue, activity_date, guest_count,
            quoted_price, total_cost, executor, status, remarks, wine_details
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          yearFrameId,
          activity.yearFrameCode || activity.year_frame_code,
          activity.projectCode || activity.project_code,
          activity.activityType || activity.activity_type,
          activity.city,
          activity.brand,
          activity.clientName || activity.client_name,
          activity.venue,
          activity.activityDate || activity.activity_date,
          activity.guestCount || activity.guest_count,
          activity.quotedPrice || activity.quoted_price,
          activity.totalCost || activity.total_cost || 0,
          activity.executor,
          activity.status || 'pending',
          activity.remarks,
          JSON.stringify(activity.wineDetails || activity.wine_details || {})
        ]);
      }
      console.log('活动记录导入完成');
    }
    
    // 导入仓储
    if (data.warehouse && data.warehouse.length > 0) {
      console.log(`导入 ${data.warehouse.length} 条仓储记录...`);
      
      for (const item of data.warehouse) {
        await connection.query(`
          INSERT INTO warehouse (
            year_frame_id, month, wine_name, specifications,
            quantity, unit_price, quoted_price, actual_cost, remarks
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          yearFrameId,
          item.month,
          item.wineName || item.wine_name,
          item.specifications,
          item.quantity,
          item.unitPrice || item.unit_price,
          item.quotedPrice || item.quoted_price,
          item.actualCost || item.actual_cost || 0,
          item.remarks
        ]);
      }
      console.log('仓储记录导入完成');
    }
    
    // 导入物流
    if (data.logistics && data.logistics.length > 0) {
      console.log(`导入 ${data.logistics.length} 条物流记录...`);
      
      for (const item of data.logistics) {
        await connection.query(`
          INSERT INTO logistics (
            year_frame_id, logistics_company, tracking_number,
            origin_city, destination_city, shipping_date, fee, related_project_code, remarks
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          yearFrameId,
          item.logisticsCompany || item.logistics_company,
          item.trackingNumber || item.tracking_number,
          item.originCity || item.origin_city,
          item.destinationCity || item.destination_city,
          item.shippingDate || item.shipping_date,
          item.fee || 0,
          item.relatedProjectCode || item.related_project_code,
          item.remarks
        ]);
      }
      console.log('物流记录导入完成');
    }
    
    // 导入报销
    if (data.reimbursements && data.reimbursements.length > 0) {
      console.log(`导入 ${data.reimbursements.length} 条报销记录...`);
      
      for (const item of data.reimbursements) {
        await connection.query(`
          INSERT INTO reimbursements (
            year_frame_id, reimbursement_type, city, amount,
            date, related_project_code, props, printing, express, other, remarks
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          yearFrameId,
          item.reimbursementType || item.reimbursement_type,
          item.city,
          item.amount,
          item.date,
          item.relatedProjectCode || item.related_project_code,
          item.props || 0,
          item.printing || 0,
          item.express || 0,
          item.other || 0,
          item.remarks
        ]);
      }
      console.log('报销记录导入完成');
    }
    
    console.log('数据导入全部完成！');
    
    connection.release();
  } catch (error) {
    console.error('导入失败:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

importData();
