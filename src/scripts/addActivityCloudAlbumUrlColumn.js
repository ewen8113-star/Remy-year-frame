/**
 * 为 activities 表添加 cloud_album_url 字段（可重复执行，已存在则跳过）
 * 用法：npm run migrate:activity-cloud-album
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

async function main() {
  try {
    await db.query('ALTER TABLE activities ADD COLUMN cloud_album_url VARCHAR(1024) NULL AFTER remarks');
    console.log('✅ 已添加 activities.cloud_album_url 列');
  } catch (e) {
    const code = e && e.code;
    const msg = e && e.message ? String(e.message) : '';
    if (code === 'ER_DUP_FIELDNAME' || msg.includes('Duplicate column')) {
      console.log('ℹ️  activities.cloud_album_url 已存在，跳过');
    } else {
      console.error('❌ 迁移失败:', msg);
      process.exit(1);
    }
  }
  process.exit(0);
}

main();
