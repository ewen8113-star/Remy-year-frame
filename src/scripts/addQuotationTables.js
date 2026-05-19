/**
 * 报价单表（可重复执行）
 * 用法：npm run migrate:quotations
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');
const { ensureQuotationTables } = require('../quotation/ensureQuotationTables');

async function main() {
  try {
    await ensureQuotationTables(db);
    console.log('✅ quotations / quotation_items / quotation_template_sections 已就绪');
  } catch (e) {
    console.error('❌ 建表失败:', e.message);
    process.exit(1);
  }
  process.exit(0);
}

main();
