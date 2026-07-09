/**
 * 出库单 project_code 与场次表对齐，并补全缺 YYMMDD 的编号
 * 用法：npm run repair:outbound-project-codes
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');
const {
  projectCodeHasDateSuffix,
  repairProjectCodeDate,
} = require('../lib/projectCode');

async function main() {
  const [syncR] = await db.query(
    `
    UPDATE inv_outbound_orders o
    INNER JOIN activities act ON act.id = o.activity_id
    SET o.project_code = act.project_code
    WHERE TRIM(COALESCE(act.project_code, '')) <> ''
      AND (o.project_code IS NULL OR TRIM(o.project_code) <> TRIM(act.project_code))
  `
  );
  const synced = Number(syncR?.affectedRows || 0);

  const [rows] = await db.query(
    `
    SELECT o.id, o.project_code, COALESCE(o.activity_date, act.date, act.activity_date) AS repair_date
    FROM inv_outbound_orders o
    LEFT JOIN activities act ON act.id = o.activity_id
    WHERE (o.link_mode = 'activity' OR o.activity_id IS NOT NULL)
      AND TRIM(COALESCE(o.project_code, '')) <> ''
      AND o.project_code NOT REGEXP '^[^ ]+ [0-9]{6}'
  `
  );
  let repaired = 0;
  for (const row of rows) {
    const next = repairProjectCodeDate(row.project_code, row.repair_date);
    if (!next || next === row.project_code || !projectCodeHasDateSuffix(next)) continue;
    await db.query('UPDATE inv_outbound_orders SET project_code = ? WHERE id = ?', [next, row.id]);
    console.log(`#${row.id}: ${row.project_code} → ${next}`);
    repaired += 1;
  }

  console.log(`✅ 已与场次同步 ${synced} 条，补全日期 ${repaired} 条（检出 ${rows.length} 条）`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
