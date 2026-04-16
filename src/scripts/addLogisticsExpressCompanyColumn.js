/**
 * 若 logistics 表缺少 express_company 列则添加（快递公司）
 * 用法：npm run migrate:logistics-express-company
 */
require('dotenv').config();
const db = require('../config/database');

(async () => {
  try {
    await db.query(
      "ALTER TABLE logistics ADD COLUMN express_company VARCHAR(50) NULL COMMENT '快递公司' AFTER logistics_company"
    );
    console.log('已添加列 logistics.express_company');
  } catch (e) {
    const code = e && (e.code || e.errno);
    if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
      console.log('列 express_company 已存在，跳过');
    } else {
      console.error(e.message || e);
      process.exit(1);
    }
  }
  process.exit(0);
})();
