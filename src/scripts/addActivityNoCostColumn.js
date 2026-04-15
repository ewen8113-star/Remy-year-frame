/**
 * 为 activities 表添加 no_cost 字段（可重复执行，已存在则跳过）
 * 用法：npm run migrate:activity-no-cost
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

async function main() {
  try {
    await db.query('ALTER TABLE activities ADD COLUMN no_cost TINYINT(1) NOT NULL DEFAULT 0 AFTER total_cost');
    console.log('✅ 已添加 activities.no_cost 列');
  } catch (e) {
    const code = e && e.code;
    const msg = e && e.message ? String(e.message) : '';
    if (code === 'ER_DUP_FIELDNAME' || msg.includes('Duplicate column')) {
      console.log('ℹ️  activities.no_cost 已存在，跳过');
    } else {
      console.error('❌ 迁移失败:', msg);
      process.exit(1);
    }
  }
  process.exit(0);
}

main();
