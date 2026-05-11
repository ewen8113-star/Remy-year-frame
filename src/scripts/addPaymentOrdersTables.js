/**
 * 付款申请单与统一付款状态字段（可重复执行）
 * - 不改动既有业务金额，旧记录默认未支付
 */
require('dotenv').config();
const db = require('../config/database');

const statements = [
  `CREATE TABLE IF NOT EXISTS payment_orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    year_frame_id INT NOT NULL,
    order_no VARCHAR(64) NULL UNIQUE,
    payee_name VARCHAR(120) NOT NULL,
    order_date DATE NOT NULL,
    payment_date DATE NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'paid',
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    remarks TEXT NULL,
    created_by VARCHAR(80) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_payment_orders_year (year_frame_id),
    INDEX idx_payment_orders_payee (payee_name),
    INDEX idx_payment_orders_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS payment_order_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    payment_order_id INT NOT NULL,
    source_type VARCHAR(32) NOT NULL,
    source_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    project_code VARCHAR(255) NULL,
    city VARCHAR(120) NULL,
    brand VARCHAR(60) NULL,
    description VARCHAR(500) NULL,
    source_date DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_payment_source (source_type, source_id),
    INDEX idx_payment_order_items_order (payment_order_id),
    CONSTRAINT fk_payment_order_items_order
      FOREIGN KEY (payment_order_id) REFERENCES payment_orders(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const paymentColumns = [
  ['warehouse', "ALTER TABLE warehouse ADD COLUMN payee_name VARCHAR(120) NULL COMMENT '收款方' AFTER allocation_note"],
  ['warehouse', "ALTER TABLE warehouse ADD COLUMN payment_status VARCHAR(24) NOT NULL DEFAULT 'unpaid' COMMENT '付款状态：unpaid/paid' AFTER payee_name"],
  ['warehouse', "ALTER TABLE warehouse ADD COLUMN payment_order_id INT NULL COMMENT '付款单ID' AFTER payment_status"],
  ['warehouse', "ALTER TABLE warehouse ADD COLUMN paid_at DATETIME NULL COMMENT '付款确认时间' AFTER payment_order_id"],
  ['logistics', "ALTER TABLE logistics ADD COLUMN payee_name VARCHAR(120) NULL COMMENT '收款方' AFTER allocation_note"],
  ['logistics', "ALTER TABLE logistics ADD COLUMN payment_status VARCHAR(24) NOT NULL DEFAULT 'unpaid' COMMENT '付款状态：unpaid/paid' AFTER payee_name"],
  ['logistics', "ALTER TABLE logistics ADD COLUMN payment_order_id INT NULL COMMENT '付款单ID' AFTER payment_status"],
  ['logistics', "ALTER TABLE logistics ADD COLUMN paid_at DATETIME NULL COMMENT '付款确认时间' AFTER payment_order_id"],
  ['material_purchases', "ALTER TABLE material_purchases ADD COLUMN payee_name VARCHAR(120) NULL COMMENT '收款方' AFTER allocation_note"],
  ['material_purchases', "ALTER TABLE material_purchases ADD COLUMN payment_status VARCHAR(24) NOT NULL DEFAULT 'unpaid' COMMENT '付款状态：unpaid/paid' AFTER payee_name"],
  ['material_purchases', "ALTER TABLE material_purchases ADD COLUMN payment_order_id INT NULL COMMENT '付款单ID' AFTER payment_status"],
  ['material_purchases', "ALTER TABLE material_purchases ADD COLUMN paid_at DATETIME NULL COMMENT '付款确认时间' AFTER payment_order_id"],
  ['prop_repairs', "ALTER TABLE prop_repairs ADD COLUMN payee_name VARCHAR(120) NULL COMMENT '收款方' AFTER allocation_note"],
  ['prop_repairs', "ALTER TABLE prop_repairs ADD COLUMN payment_status VARCHAR(24) NOT NULL DEFAULT 'unpaid' COMMENT '付款状态：unpaid/paid' AFTER payee_name"],
  ['prop_repairs', "ALTER TABLE prop_repairs ADD COLUMN payment_order_id INT NULL COMMENT '付款单ID' AFTER payment_status"],
  ['prop_repairs', "ALTER TABLE prop_repairs ADD COLUMN paid_at DATETIME NULL COMMENT '付款确认时间' AFTER payment_order_id"],
  ['reimbursements', "ALTER TABLE reimbursements ADD COLUMN payee_name VARCHAR(120) NULL COMMENT '收款方' AFTER brand"],
  ['reimbursements', "ALTER TABLE reimbursements ADD COLUMN payment_status VARCHAR(24) NOT NULL DEFAULT 'unpaid' COMMENT '付款状态：unpaid/paid' AFTER payee_name"],
  ['reimbursements', "ALTER TABLE reimbursements ADD COLUMN payment_order_id INT NULL COMMENT '付款单ID' AFTER payment_status"],
  ['reimbursements', "ALTER TABLE reimbursements ADD COLUMN paid_at DATETIME NULL COMMENT '付款确认时间' AFTER payment_order_id"],
];

(async () => {
  for (const sql of statements) {
    await db.query(sql);
    console.log('OK:', sql.split('\n')[0]);
  }

  for (const [, sql] of paymentColumns) {
    try {
      await db.query(sql);
      console.log('OK:', sql);
    } catch (e) {
      const code = e && (e.code || e.errno);
      if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
        console.log('跳过（列已存在）:', sql);
      } else {
        console.error(e.message || e);
        process.exit(1);
      }
    }
  }

  console.log('迁移完成：payment_orders 与付款状态字段');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
