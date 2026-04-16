/**
 * 若 logistics 表缺少 monthly_settlement 列则添加（月结标识）
 * 用法：npm run migrate:logistics-monthly-settlement
 */
require('dotenv').config();
const db = require('../config/database');

(async () => {
  try {
    await db.query(
      "ALTER TABLE logistics ADD COLUMN monthly_settlement TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否月结' AFTER special_car"
    );
    console.log('已添加列 logistics.monthly_settlement');
  } catch (e) {
    const code = e && (e.code || e.errno);
    if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
      console.log('列 monthly_settlement 已存在，跳过');
    } else {
      console.error(e.message || e);
      process.exit(1);
    }
  }
  process.exit(0);
})();
