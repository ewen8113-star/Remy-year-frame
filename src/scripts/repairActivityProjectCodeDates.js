/**
 * 为 project_code 缺少年框后 YYMMDD 的场次补全活动日期段
 * 例：N220630-RC-PHD 上海得强PHD品鉴 + date 2026-05-28 → N220630-RC-PHD 260528上海得强PHD品鉴
 *
 * 用法：npm run repair:activity-project-code-dates
 * 可选：node src/scripts/repairActivityProjectCodeDates.js --dry-run
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');
const {
  projectCodeHasDateSuffix,
  repairProjectCodeDate,
} = require('../lib/projectCode');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const [rows] = await db.query(
    `SELECT id, project_code, date
     FROM activities
     WHERE COALESCE(is_virtual, 0) = 0
       AND date IS NOT NULL
       AND TRIM(COALESCE(project_code, '')) <> ''
       AND project_code NOT REGEXP '^[^ ]+ [0-9]{6}'`
  );

  let updated = 0;
  for (const row of rows) {
    const next = repairProjectCodeDate(row.project_code, row.date);
    if (!next || next === row.project_code || !projectCodeHasDateSuffix(next)) continue;
    console.log(`#${row.id}\n  原：${row.project_code}\n  新：${next}`);
    if (!dryRun) {
      await db.query('UPDATE activities SET project_code = ? WHERE id = ?', [next, row.id]);
    }
    updated += 1;
  }

  console.log(
    dryRun
      ? `\n[dry-run] 将更新 ${updated} 条（共检出 ${rows.length} 条缺日期编号）`
      : `\n✅ 已更新 ${updated} 条（共检出 ${rows.length} 条缺日期编号）`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
