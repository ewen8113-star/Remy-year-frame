/**
 * 若 logistics 表缺少 settlement_month 列则添加（月结月份）
 * 用法：npm run migrate:logistics-settlement-month
 */
require('dotenv').config();
const db = require('../config/database');

(async () => {
  try {
    await db.query(
      "ALTER TABLE logistics ADD COLUMN settlement_month VARCHAR(16) NULL COMMENT '月结月份，如 2025-6' AFTER tracking_number"
    );
    console.log('已添加列 logistics.settlement_month');
  } catch (e) {
    const code = e && (e.code || e.errno);
    if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
      console.log('列 settlement_month 已存在，跳过');
    } else {
      console.error(e.message || e);
      process.exit(1);
    }
  }
  process.exit(0);
})();
