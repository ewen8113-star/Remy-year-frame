/**
 * 为 prop_repairs 表添加 quoted_price 字段（可重复执行，已存在则跳过）
 * 用法：npm run migrate:prop-repairs-quoted-price
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

async function main() {
  try {
    await db.query('ALTER TABLE prop_repairs ADD COLUMN quoted_price DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER items');
    console.log('✅ 已添加 prop_repairs.quoted_price 列');
  } catch (e) {
    const code = e && e.code;
    const msg = e && e.message ? String(e.message) : '';
    if (code === 'ER_DUP_FIELDNAME' || msg.includes('Duplicate column')) {
      console.log('ℹ️  prop_repairs.quoted_price 已存在，跳过');
    } else {
      console.error('❌ 迁移失败:', msg);
      process.exit(1);
    }
  }
  process.exit(0);
}

main();
