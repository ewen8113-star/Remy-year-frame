/**
 * 报销/付款中心扩展列：
 * - payment_type: personal_reimbursement / corporate_payment
 * - cost_module: activity / warehouse / logistics / prop_repair / general
 * - claim_status: draft / submitted / paid / rejected
 * 用法：npm run migrate:reimbursement-payment-center
 */
require('dotenv').config();
const db = require('../config/database');

const statements = [
  "ALTER TABLE reimbursements ADD COLUMN payment_type VARCHAR(32) NOT NULL DEFAULT 'personal_reimbursement' COMMENT '付款类型：个人报销/对公付款' AFTER reimbursement_type",
  "ALTER TABLE reimbursements ADD COLUMN cost_module VARCHAR(32) NOT NULL DEFAULT 'activity' COMMENT '成本模块：activity/warehouse/logistics/prop_repair/general' AFTER payment_type",
  "ALTER TABLE reimbursements ADD COLUMN claim_status VARCHAR(24) NOT NULL DEFAULT 'draft' COMMENT '付款申请状态：draft/submitted/paid/rejected' AFTER cost_module",
];

(async () => {
  for (const sql of statements) {
    try {
      await db.query(sql);
      console.log('OK:', sql.slice(0, 88) + '...');
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
  console.log('迁移完成：reimbursements 付款中心扩展列');
  process.exit(0);
})();
