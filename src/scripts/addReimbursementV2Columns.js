/**
 * 报销表扩展：activity_id、cost_details、merged_into_activity、has_invoice、invoices（JSON）
 * 用法：npm run migrate:reimbursement-v2
 */
require('dotenv').config();
const db = require('../config/database');

const statements = [
  "ALTER TABLE reimbursements ADD COLUMN activity_id INT NULL COMMENT '关联活动ID' AFTER year_frame_id",
  "ALTER TABLE reimbursements ADD COLUMN cost_details LONGTEXT NULL COMMENT '与场次成本同结构的JSON' AFTER amount",
  "ALTER TABLE reimbursements ADD COLUMN merged_into_activity TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已计入活动成本（场次）' AFTER cost_details",
  "ALTER TABLE reimbursements ADD COLUMN has_invoice TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否有发票' AFTER merged_into_activity",
  "ALTER TABLE reimbursements ADD COLUMN invoices LONGTEXT NULL COMMENT '发票JSON数组' AFTER has_invoice",
];

(async () => {
  for (const sql of statements) {
    try {
      await db.query(sql);
      console.log('OK:', sql.slice(0, 80) + '…');
    } catch (e) {
      const code = e && (e.code || e.errno);
      if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
        console.log('跳过（列已存在）:', sql.slice(0, 60));
      } else {
        console.error(e.message || e);
        process.exit(1);
      }
    }
  }
  console.log('迁移完成：reimbursements V2 列');
  process.exit(0);
})();
