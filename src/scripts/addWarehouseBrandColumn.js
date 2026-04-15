/**
 * 为 warehouse 表添加 brand 列（PHD / X.O / CLUB），可重复执行。
 * 用法：npm run migrate:warehouse-brand
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

async function main() {
  try {
    await db.query(
      "ALTER TABLE warehouse ADD COLUMN brand VARCHAR(20) NOT NULL DEFAULT 'PHD'"
    );
    console.log('✅ 已添加 warehouse.brand 列');
  } catch (e) {
    const code = e && e.code;
    const msg = e && e.message ? String(e.message) : '';
    if (code === 'ER_DUP_FIELDNAME' || msg.includes('Duplicate column')) {
      console.log('ℹ️  warehouse.brand 已存在，跳过');
    } else {
      console.error('❌ 迁移失败:', msg);
      process.exit(1);
    }
  }
  process.exit(0);
}

main();
