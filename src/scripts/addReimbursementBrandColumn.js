/**
 * 报销表扩展：brand（可按品牌登记、无需关联场次）
 * 用法：npm run migrate:reimbursement-brand
 */
require('dotenv').config();
const db = require('../config/database');

(async () => {
  const sql = "ALTER TABLE reimbursements ADD COLUMN brand VARCHAR(30) NULL COMMENT '报销归属品牌' AFTER city";
  try {
    await db.query(sql);
    console.log('迁移完成：reimbursements.brand');
    process.exit(0);
  } catch (e) {
    const code = e && (e.code || e.errno);
    if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
      console.log('跳过（brand 列已存在）');
      process.exit(0);
    }
    console.error(e.message || e);
    process.exit(1);
  }
})();
