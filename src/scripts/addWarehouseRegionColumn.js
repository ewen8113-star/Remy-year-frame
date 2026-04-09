/**
 * 为已有数据库 warehouse 表添加 region 列（可重复执行，已存在则跳过）
 * 用法：npm run migrate:warehouse-region
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

async function main() {
  try {
    await db.query('ALTER TABLE warehouse ADD COLUMN region VARCHAR(32) NULL AFTER month');
    console.log('✅ 已添加 warehouse.region 列');
  } catch (e) {
    const code = e && e.code;
    const msg = e && e.message ? String(e.message) : '';
    if (code === 'ER_DUP_FIELDNAME' || msg.includes('Duplicate column')) {
      console.log('ℹ️  warehouse.region 已存在，跳过');
    } else {
      console.error('❌ 迁移失败:', msg);
      process.exit(1);
    }
  }
  process.exit(0);
}

main();
