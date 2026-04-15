/**
 * 将 activity_status 下错误 value「done」改为「completed」，与 activities.status ENUM 一致。
 * 可重复执行（无 done 行时仅跳过）。
 *
 * 用法：npm run migrate:fix-activity-status-lookup
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

async function main() {
  const [rows] = await db.query(
    "SELECT id FROM lookup_options WHERE category = 'activity_status' AND value = 'done' LIMIT 1"
  );
  if (!rows.length) {
    console.log('ℹ️  无 activity_status/done 记录，跳过（可能已修复）');
    process.exit(0);
    return;
  }
  await db.query(
    "UPDATE lookup_options SET value = 'completed' WHERE category = 'activity_status' AND value = 'done'"
  );
  console.log('✅ 已将 lookup activity_status 的 done 更新为 completed');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
