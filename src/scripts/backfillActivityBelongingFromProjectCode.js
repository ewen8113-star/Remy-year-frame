/**
 * 将 activities.belonging 为空的记录，按项目编号 project_code 推断并写入
 * （与 lookup activity_belonging 的 value 对齐）
 *
 * 规则顺序：RM-CLUB → RM-X.O → 含 -RC- 的场次默认 RC-On
 *
 * 用法：npm run migrate:backfill-activity-belonging
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

async function main() {
  const [r1] = await db.query(
    `UPDATE activities
     SET belonging = 'RM-CLUB婚宴'
     WHERE (belonging IS NULL OR TRIM(belonging) = '')
       AND (project_code LIKE '%RM-CLUB%' OR project_code LIKE '%RM_CLUB%')`
  );
  console.log(`✅ RM-CLUB婚宴: ${r1.affectedRows} 行`);

  const [r2] = await db.query(
    `UPDATE activities
     SET belonging = 'RM-X.O婚宴'
     WHERE (belonging IS NULL OR TRIM(belonging) = '')
       AND project_code LIKE '%RM-X.O%'`
  );
  console.log(`✅ RM-X.O婚宴: ${r2.affectedRows} 行`);

  const [r3] = await db.query(
    `UPDATE activities
     SET belonging = 'RC-On'
     WHERE (belonging IS NULL OR TRIM(belonging) = '')
       AND (project_code LIKE '%-RC-%' OR project_code LIKE '% RC %')`
  );
  console.log(`✅ RC-On（由项目编号含 RC 推断）: ${r3.affectedRows} 行`);

  const [[{ remaining }]] = await db.query(
    `SELECT COUNT(*) AS remaining FROM activities WHERE belonging IS NULL OR TRIM(belonging) = ''`
  );
  if (Number(remaining) > 0) {
    console.log(`ℹ️  仍有 ${remaining} 行未匹配规则，归属为空；请手工编辑或扩展本脚本。`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
