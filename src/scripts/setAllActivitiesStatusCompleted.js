/**
 * 将所有场次的 status 设为 completed（已完成）
 * 用法：npm run script:set-all-activities-completed
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

async function main() {
  const [r] = await db.query(`UPDATE activities SET status = 'completed'`);
  console.log(`✅ 已更新 ${r.affectedRows} 条场次，状态均为「已完成」(completed)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
