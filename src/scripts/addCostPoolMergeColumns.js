/**
 * 为成本公共池模块增加计入字段：
 * - activity_id（可选关联活动）
 * - merged_into_activity（是否已计入活动成本）
 * - allocation_note（计入/分摊说明）
 *
 * 用法：npm run migrate:cost-pool-merge
 */
require('dotenv').config();
const db = require('../config/database');

const stmts = [
  "ALTER TABLE warehouse ADD COLUMN activity_id INT NULL COMMENT '关联活动ID' AFTER year_frame_id",
  "ALTER TABLE warehouse ADD COLUMN merged_into_activity TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已计入活动成本' AFTER activity_id",
  "ALTER TABLE warehouse ADD COLUMN allocation_note VARCHAR(255) NULL COMMENT '计入说明' AFTER merged_into_activity",

  "ALTER TABLE logistics ADD COLUMN activity_id INT NULL COMMENT '关联活动ID' AFTER year_frame_id",
  "ALTER TABLE logistics ADD COLUMN merged_into_activity TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已计入活动成本' AFTER activity_id",
  "ALTER TABLE logistics ADD COLUMN allocation_note VARCHAR(255) NULL COMMENT '计入说明' AFTER merged_into_activity",

  "ALTER TABLE material_purchases ADD COLUMN activity_id INT NULL COMMENT '关联活动ID' AFTER year_frame_id",
  "ALTER TABLE material_purchases ADD COLUMN merged_into_activity TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已计入活动成本' AFTER activity_id",
  "ALTER TABLE material_purchases ADD COLUMN allocation_note VARCHAR(255) NULL COMMENT '计入说明' AFTER merged_into_activity",

  "ALTER TABLE prop_repairs ADD COLUMN activity_id INT NULL COMMENT '关联活动ID' AFTER year_frame_id",
  "ALTER TABLE prop_repairs ADD COLUMN merged_into_activity TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已计入活动成本' AFTER activity_id",
  "ALTER TABLE prop_repairs ADD COLUMN allocation_note VARCHAR(255) NULL COMMENT '计入说明' AFTER merged_into_activity",
];

(async () => {
  for (const sql of stmts) {
    try {
      await db.query(sql);
      console.log('OK:', sql.slice(0, 90) + '...');
    } catch (e) {
      const code = e && (e.code || e.errno);
      if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
        console.log('跳过（列已存在）:', sql.slice(0, 70));
      } else if (code === 'ER_NO_SUCH_TABLE' || code === 1146) {
        console.log('跳过（表不存在）:', sql.slice(0, 70));
      } else {
        console.error(e.message || e);
        process.exit(1);
      }
    }
  }
  console.log('迁移完成：成本公共池计入字段');
  process.exit(0);
})();

