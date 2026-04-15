/**
 * activities.status 增加 ENUM 值 deferred（延期），并写入 lookup activity_status
 * 可重复执行：ENUM 已含 deferred 或 lookup 已存在时跳过
 *
 * 用法：npm run migrate:activity-status-deferred
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

async function tryAlterEnum() {
  try {
    await db.query(`
      ALTER TABLE activities
      MODIFY COLUMN status ENUM('pending','deferred','completed','cancelled')
      DEFAULT 'pending'
    `);
    console.log('✅ activities.status 已包含 deferred');
  } catch (e) {
    const msg = e && e.message ? String(e.message) : '';
    if (msg.includes('Duplicate') || msg.includes('deferred')) {
      console.log('ℹ️  ENUM 可能已含 deferred：', msg);
    } else if (msg.includes('Unknown column')) {
      console.error('❌', msg);
      process.exit(1);
    } else {
      // MySQL 8 若已是目标定义可能报不同错误，再检查一次
      const [cols] = await db.query("SHOW COLUMNS FROM activities LIKE 'status'");
      const t = cols[0] && String(cols[0].Type);
      if (t && t.includes('deferred')) {
        console.log('ℹ️  status 列已含 deferred，跳过 ALTER');
      } else {
        console.error('❌ ALTER 失败:', msg);
        process.exit(1);
      }
    }
  }
}

async function seedLookup() {
  await db.query(
    `INSERT IGNORE INTO lookup_options (category, value, label, sort_order, is_active)
     VALUES ('activity_status', 'deferred', '延期', 1, 1)`
  );
  await db.query(
    `UPDATE lookup_options SET sort_order = 2 WHERE category = 'activity_status' AND value = 'completed'`
  );
  await db.query(
    `UPDATE lookup_options SET sort_order = 3 WHERE category = 'activity_status' AND value = 'cancelled'`
  );
  console.log('✅ lookup activity_status：延期(deferred) 及排序已更新');
}

async function main() {
  await tryAlterEnum();
  await seedLookup();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
