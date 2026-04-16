/**
 * 若 logistics 表缺少 special_car 列则添加（专车标识）
 * 用法：npm run migrate:logistics-special-car
 */
require('dotenv').config();
const db = require('../config/database');

(async () => {
  try {
    await db.query(
      "ALTER TABLE logistics ADD COLUMN special_car TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否专车（包车）' AFTER tracking_number"
    );
    console.log('已添加列 logistics.special_car');
  } catch (e) {
    const code = e && (e.code || e.errno);
    if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
      console.log('列 special_car 已存在，跳过');
    } else {
      console.error(e.message || e);
      process.exit(1);
    }
  }
  process.exit(0);
})();
