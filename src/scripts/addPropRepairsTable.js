/**
 * 道具维修表 prop_repairs（可重复执行）
 * 用法：npm run migrate:prop-repairs
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

const DDL = `
CREATE TABLE IF NOT EXISTS prop_repairs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  year_frame_id INT NOT NULL COMMENT '所属年框',
  brand_id INT NOT NULL COMMENT '品牌ID',
  repair_date DATE NOT NULL COMMENT '维修日期',
  region VARCHAR(32) NOT NULL COMMENT '区域',
  items JSON NOT NULL COMMENT '维修明细 [{name, amount}, ...]',
  quoted_price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '报价金额',
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '合计金额',
  no_cost TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否无成本',
  remarks TEXT NULL COMMENT '备注',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pr_year_frame FOREIGN KEY (year_frame_id) REFERENCES year_frames(id),
  CONSTRAINT fk_pr_brand FOREIGN KEY (brand_id) REFERENCES brand_inventory(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function main() {
  try {
    await db.query(DDL);
    console.log('✅ prop_repairs 表已就绪');
  } catch (e) {
    console.error('❌ 建表失败:', e.message);
    process.exit(1);
  }
  process.exit(0);
}

main();
