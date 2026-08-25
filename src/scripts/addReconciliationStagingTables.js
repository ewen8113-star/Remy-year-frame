/**
 * 临时对账 staging 表（可重复执行）
 * 用法：npm run migrate:reconciliation-staging
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

const DDL_BATCHES = `
CREATE TABLE IF NOT EXISTS reconciliation_batches (
  id INT PRIMARY KEY AUTO_INCREMENT,
  year_frame_id INT NOT NULL COMMENT '所属年框',
  batch_type VARCHAR(32) NOT NULL COMMENT 'logistics / reimbursement',
  settlement_month VARCHAR(16) NOT NULL COMMENT '对账月份 YYYY-MM',
  payee_name VARCHAR(128) NULL COMMENT '默认收款方/供应商',
  source_filename VARCHAR(255) NULL COMMENT '上传文件名',
  status VARCHAR(32) NOT NULL DEFAULT 'draft' COMMENT 'draft / ready / committed / cancelled',
  summary_json JSON NULL COMMENT '汇总快照',
  note VARCHAR(512) NULL COMMENT '批次备注',
  created_by INT NULL,
  committed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_recon_batch_yf_type (year_frame_id, batch_type),
  INDEX idx_recon_batch_status (status),
  CONSTRAINT fk_recon_batch_yf FOREIGN KEY (year_frame_id) REFERENCES year_frames(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const DDL_LINES = `
CREATE TABLE IF NOT EXISTS reconciliation_lines (
  id INT PRIMARY KEY AUTO_INCREMENT,
  batch_id INT NOT NULL,
  line_no INT NOT NULL COMMENT '账单行序',
  excel_row INT NULL COMMENT 'Excel 行号',
  line_status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending / suggested / confirmed / skipped',
  allocation_type VARCHAR(32) NOT NULL DEFAULT 'unassigned' COMMENT 'unassigned / activity / pooled / skipped',
  raw_type VARCHAR(32) NULL COMMENT '发件/到货/收件',
  raw_date DATE NULL,
  raw_project VARCHAR(255) NULL COMMENT '供应商账单项目编号原文',
  raw_brand VARCHAR(64) NULL,
  raw_express VARCHAR(64) NULL,
  raw_tracking VARCHAR(128) NULL,
  raw_origin_city VARCHAR(64) NULL,
  raw_dest_city VARCHAR(64) NULL,
  ship_name VARCHAR(64) NULL,
  ship_phone VARCHAR(64) NULL,
  ship_addr VARCHAR(512) NULL,
  recv_name VARCHAR(64) NULL,
  recv_phone VARCHAR(64) NULL,
  recv_addr VARCHAR(512) NULL,
  weight_kg DECIMAL(12,3) NULL,
  shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  handling_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  return_shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  return_handling_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  insurance_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  cod_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  purpose VARCHAR(512) NULL COMMENT '用途/说明（关键信息）',
  brand VARCHAR(32) NULL,
  express_company VARCHAR(64) NULL,
  tracking_number VARCHAR(128) NULL,
  logistics_company VARCHAR(64) NULL DEFAULT '快递',
  shipping_date DATE NULL,
  return_date DATE NULL,
  related_project_code VARCHAR(255) NULL,
  activity_id INT NULL,
  suggested_project_code VARCHAR(255) NULL,
  suggested_activity_id INT NULL,
  skip_reason VARCHAR(255) NULL,
  raw_remarks TEXT NULL,
  raw_extra_json JSON NULL,
  committed_logistics_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_recon_line_batch (batch_id),
  INDEX idx_recon_line_status (line_status),
  CONSTRAINT fk_recon_line_batch FOREIGN KEY (batch_id) REFERENCES reconciliation_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function main() {
  try {
    await db.query(DDL_BATCHES);
    console.log('✅ reconciliation_batches 表已就绪');
    await db.query(DDL_LINES);
    console.log('✅ reconciliation_lines 表已就绪');
  } catch (e) {
    console.error('❌ 建表失败:', e.message);
    process.exit(1);
  }
  process.exit(0);
}

main();
