/**
 * 将 activities.status 从 ENUM 改为 VARCHAR，避免各环境 ENUM 未同步导致「延期」无法保存。
 * 可重复执行：已是 varchar 时会跳过。
 *
 * 用法：npm run migrate:activity-status-to-varchar
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

async function main() {
  const [[row]] = await db.query(
    `SELECT COLUMN_TYPE AS t FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'status'`
  );
  const t = String(row?.t || '');
  if (/^varchar/i.test(t)) {
    console.log('ℹ️  activities.status 已是 VARCHAR，跳过');
    process.exit(0);
    return;
  }
  await db.query(
    `ALTER TABLE activities MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending'`
  );
  console.log('✅ activities.status 已改为 VARCHAR(32)，可保存 pending / deferred / completed / cancelled 等值');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
