/**
 * 为 activities 表补充 region、belonging（可重复执行）
 * 用法：npm run migrate:activity-region-belonging
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

async function tryAlter(sql, label) {
  try {
    await db.query(sql);
    console.log(`✅ ${label}`);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : '';
    if (e.code === 'ER_DUP_FIELDNAME' || msg.includes('Duplicate column')) {
      console.log(`ℹ️  ${label}：列已存在，跳过`);
    } else {
      console.error(`❌ ${label} 失败:`, msg);
      process.exit(1);
    }
  }
}

async function main() {
  await tryAlter(
    "ALTER TABLE activities ADD COLUMN region VARCHAR(64) NULL DEFAULT NULL AFTER period",
    'activities.region'
  );
  await tryAlter(
    "ALTER TABLE activities ADD COLUMN belonging VARCHAR(128) NULL DEFAULT NULL AFTER region",
    'activities.belonging'
  );
  process.exit(0);
}

main();
