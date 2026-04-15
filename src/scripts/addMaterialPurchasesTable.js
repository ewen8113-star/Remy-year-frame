/**
 * 物料采购表 material_purchases（可重复执行）
 * 用法：npm run migrate:material-purchases
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

const DDL = `
CREATE TABLE IF NOT EXISTS material_purchases (
  id INT PRIMARY KEY AUTO_INCREMENT,
  year_frame_id INT NOT NULL COMMENT '所属年框',
  brand_id INT NOT NULL COMMENT '品牌ID',
  purchase_date DATE NOT NULL COMMENT '采购/报销日期',
  items JSON NOT NULL COMMENT '费用明细 [{name, amount}, ...]',
  total_amount DECIMAL(10,2) NOT NULL COMMENT '合计金额',
  remarks TEXT NULL COMMENT '备注',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mp_year_frame FOREIGN KEY (year_frame_id) REFERENCES year_frames(id),
  CONSTRAINT fk_mp_brand FOREIGN KEY (brand_id) REFERENCES brand_inventory(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function main() {
  try {
    await db.query(DDL);
    console.log('✅ material_purchases 表已就绪');
  } catch (e) {
    console.error('❌ 建表失败:', e.message);
    process.exit(1);
  }
  process.exit(0);
}

main();
