/**
 * 创建 lookup_options 表并写入与历史表单一致的种子数据（可重复执行）
 * 用法：npm run migrate:lookup-options
 *
 * 报表 activity_type 过滤（calendar/cost）使用 strategy B：与 category=activity_type 且 is_active=1 的 value 对齐。
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

const DDL = `
CREATE TABLE IF NOT EXISTS lookup_options (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(64) NOT NULL,
  value VARCHAR(255) NOT NULL,
  label VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_lookup_cat_val (category, value),
  KEY idx_lookup_cat_active (category, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const SEED_ROWS = [
  // activity_year_frame_code
  ['activity_year_frame_code', 'N220630-RC-PHD', 'N220630-RC-PHD', 0],
  ['activity_year_frame_code', 'N230901-RM-X.O', 'N230901-RM-X.O', 1],
  ['activity_year_frame_code', 'N230530-RM-CLUB', 'N230530-RM-CLUB', 2],
  // activity_type（与导入脚本中的「纯设计」等兼容）
  ['activity_type', '晚宴', '晚宴', 0],
  ['activity_type', '品鉴', '品鉴', 1],
  ['activity_type', '培训', '培训', 2],
  ['activity_type', '婚宴', '婚宴', 3],
  ['activity_type', '宴会', '宴会', 4],
  ['activity_type', '纯设计', '纯设计', 5],
  // activity_period
  ['activity_period', '日常', '日常', 0],
  ['activity_period', '中秋', '中秋', 1],
  ['activity_period', 'CNY新春', 'CNY新春', 2],
  // activity_region
  ['activity_region', '东区', '东区', 0],
  ['activity_region', '北区', '北区', 1],
  ['activity_region', '南区', '南区', 2],
  ['activity_region', '西南区', '西南区', 3],
  ['activity_region', '东南区', '东南区', 4],
  ['activity_region', '内部', '内部', 5],
  ['activity_region', '东区-婚宴', '东区-婚宴', 6],
  // activity_belonging（场次归属）
  ['activity_belonging', 'RC-Off', 'RC-Off', 0],
  ['activity_belonging', 'RC-On', 'RC-On', 1],
  ['activity_belonging', 'RC-Training', 'RC-Training', 2],
  ['activity_belonging', 'RM-CLUB婚宴', 'RM-CLUB婚宴', 3],
  ['activity_belonging', 'RM-X.O婚宴', 'RM-X.O婚宴', 4],
  ['activity_belonging', '区域', '区域', 5],
  // activity_executor
  ['activity_executor', '无', '无', 0],
  ['activity_executor', '有', '有', 1],
  // activity_status（value 须与 activities.status ENUM 一致，含 deferred 延期）
  ['activity_status', 'pending', '待执行', 0],
  ['activity_status', 'deferred', '延期', 1],
  ['activity_status', 'completed', '已完成', 2],
  ['activity_status', 'cancelled', '已取消', 3],
];

async function main() {
  try {
    await db.query(DDL);
    console.log('✅ lookup_options 表已就绪');
  } catch (e) {
    console.error('❌ 建表失败:', e.message);
    process.exit(1);
  }

  const insertSql =
    'INSERT IGNORE INTO lookup_options (category, value, label, sort_order, is_active) VALUES (?, ?, ?, ?, 1)';
  for (const [cat, val, label, sort] of SEED_ROWS) {
    await db.query(insertSql, [cat, val, label, sort]);
  }
  console.log('✅ 种子数据已写入（INSERT IGNORE，已存在则跳过）');
  process.exit(0);
}

main();
