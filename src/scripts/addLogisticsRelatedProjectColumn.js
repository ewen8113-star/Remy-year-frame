/**
 * 若 logistics 表缺少 related_project_code 列则添加（老库一键修复）
 * 用法：npm run migrate:logistics-project-code
 */
require('dotenv').config();
const db = require('../config/database');

(async () => {
  try {
    await db.query(
      "ALTER TABLE logistics ADD COLUMN related_project_code VARCHAR(512) NULL COMMENT '关联活动项目编号' AFTER fee"
    );
    console.log('已添加列 logistics.related_project_code');
  } catch (e) {
    const code = e && (e.code || e.errno);
    if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
      console.log('列 related_project_code 已存在，跳过');
    } else {
      console.error(e.message || e);
      process.exit(1);
    }
  }
  process.exit(0);
})();
