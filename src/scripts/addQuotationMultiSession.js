/**
 * 多场报价：quote_mode + linked_sessions
 * npm run migrate:quotation-multi
 */
require('dotenv').config();
const db = require('../config/database');
const { ensureQuotationTables } = require('../quotation/ensureQuotationTables');

async function ensureColumn(table, column, ddl) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (Number(rows[0].c) === 0) await db.query(ddl);
}

async function main() {
  await ensureQuotationTables(db);
  await ensureColumn(
    'quotations',
    'quote_mode',
    "ALTER TABLE quotations ADD COLUMN quote_mode VARCHAR(16) NOT NULL DEFAULT 'single' COMMENT 'single|multi' AFTER type"
  );
  await ensureColumn(
    'quotations',
    'linked_sessions',
    'ALTER TABLE quotations ADD COLUMN linked_sessions JSON NULL COMMENT \'多场关联场次\' AFTER project_code'
  );
  console.log('✅ quotations.quote_mode / linked_sessions 已就绪');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
