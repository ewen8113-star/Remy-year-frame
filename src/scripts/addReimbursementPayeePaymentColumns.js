/**
 * 报销登记：付款方式 + 银行信息
 * 用法：npm run migrate:reimbursement-payee-payment
 */
require('dotenv').config();
const db = require('../config/database');

const statements = [
  "ALTER TABLE reimbursements ADD COLUMN payment_method VARCHAR(32) NULL COMMENT '付款方式：bank_transfer/wechat_alipay/platform' AFTER payee_name",
  "ALTER TABLE reimbursements ADD COLUMN payee_bank_name VARCHAR(200) NULL COMMENT '收款开户行' AFTER payment_method",
  "ALTER TABLE reimbursements ADD COLUMN payee_bank_account VARCHAR(64) NULL COMMENT '收款银行账号' AFTER payee_bank_name",
];

(async () => {
  for (const sql of statements) {
    try {
      await db.query(sql);
      console.log('OK:', sql.slice(0, 90) + '...');
    } catch (e) {
      const code = e && (e.code || e.errno);
      if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
        console.log('跳过（列已存在）:', sql.slice(0, 66));
      } else {
        console.error(e.message || e);
        process.exit(1);
      }
    }
  }
  console.log('迁移完成：reimbursements 付款方式/银行信息列');
  process.exit(0);
})();
