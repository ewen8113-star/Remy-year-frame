/**
 * 活动表扩展：brand_ambassador（品牌大使）
 * 用法：npm run migrate:activity-brand-ambassador
 */
require('dotenv').config();
const db = require('../config/database');

(async () => {
  const sql = "ALTER TABLE activities ADD COLUMN brand_ambassador VARCHAR(64) NULL COMMENT '品牌大使' AFTER executor";
  try {
    await db.query(sql);
    console.log('迁移完成：activities.brand_ambassador');
    process.exit(0);
  } catch (e) {
    const code = e && (e.code || e.errno);
    if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
      console.log('跳过（brand_ambassador 列已存在）');
      process.exit(0);
    }
    console.error(e.message || e);
    process.exit(1);
  }
})();
