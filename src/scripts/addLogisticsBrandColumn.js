/**
 * 若 logistics 表缺少 brand 列则添加（物流品牌）
 * 用法：npm run migrate:logistics-brand
 */
require('dotenv').config();
const db = require('../config/database');

(async () => {
  try {
    await db.query(
      "ALTER TABLE logistics ADD COLUMN brand VARCHAR(20) NOT NULL DEFAULT 'PHD' COMMENT '物流品牌' AFTER logistics_company"
    );
    console.log('已添加列 logistics.brand');
  } catch (e) {
    const code = e && (e.code || e.errno);
    if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
      console.log('列 brand 已存在，跳过');
    } else {
      console.error(e.message || e);
      process.exit(1);
    }
  }
  process.exit(0);
})();
