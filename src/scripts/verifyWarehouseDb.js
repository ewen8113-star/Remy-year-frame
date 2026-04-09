/**
 * 校验 warehouse 表是否含 region 列及最近几条数据（结果写入项目根 .migration-verify.json）
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const db = require('../config/database');

(async () => {
  const out = {
    time: new Date().toISOString(),
    hasRegionColumn: false,
    columns: [],
    error: null,
    lastRows: [],
  };
  try {
    const [cols] = await db.query('SHOW COLUMNS FROM warehouse');
    out.columns = cols.map((c) => c.Field);
    out.hasRegionColumn = out.columns.includes('region');
    const [rows] = await db.query(
      'SELECT id, year_frame_id, month, region, quantity, unit_price, quoted_price FROM warehouse ORDER BY id DESC LIMIT 8'
    );
    out.lastRows = rows;
  } catch (e) {
    out.error = e.message || String(e);
  }
  const dest = path.join(__dirname, '../../.migration-verify.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.error ? 1 : 0);
})();
