/**
 * 为 activities 增加 is_virtual：虚拟场次（仅报价/预存，不计入排期日历与看板统计）
 * 用法：npm run migrate:activity-is-virtual
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
    "ALTER TABLE activities ADD COLUMN is_virtual TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=虚拟场次(仅报价/预存)' AFTER status",
    'activities.is_virtual'
  );
  process.exit(0);
}

main();
