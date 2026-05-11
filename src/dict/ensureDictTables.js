/**
 * 字典 / 通讯录表自检（幂等）：在路由首次调用时创建。
 *
 * 通讯录 dict_entries：管理员维护的可复用条目，按 category 分类、content 用 JSON 存动态字段：
 *   - recipient: 收件人（联系人/电话/地址/城市）
 *   - sender:    发件方（仓库默认发件人）
 *   - supplier:  供应商（开票信息、税号、银行）
 *   - payee:     收款人（物流公司 / 快递公司等）
 *   - reimburser:报销人员（公司内部）
 *   - 也允许自定义 category（管理员新增）
 *
 * 表单下拉选项仍使用现有 lookup_options 表，不在此处建表。
 */

let _ensured = false;

async function columnExistsQuery(db, tableName, columnName) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(rows[0].c) > 0;
}

async function ensureDictTables(db) {
  if (_ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS dict_entries (
      id INT PRIMARY KEY AUTO_INCREMENT,
      category VARCHAR(32) NOT NULL,
      name VARCHAR(200) NOT NULL,
      short_label VARCHAR(64) NULL,
      content JSON NULL,
      tags VARCHAR(255) NULL,
      pinned TINYINT(1) NOT NULL DEFAULT 0,
      use_count INT NOT NULL DEFAULT 0,
      last_used_at DATETIME NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      remarks TEXT NULL,
      created_by VARCHAR(64) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_dict_cat (category),
      INDEX idx_dict_name (name),
      INDEX idx_dict_use (category, pinned DESC, use_count DESC, last_used_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  // 兼容性补列（迁移老库 / 防止 CREATE 跳过时缺字段）
  if (!(await columnExistsQuery(db, 'dict_entries', 'pinned'))) {
    try {
      await db.query('ALTER TABLE dict_entries ADD COLUMN pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER tags');
    } catch (e) {
      if (!/Duplicate column/i.test(String(e && e.message))) throw e;
    }
  }
  if (!(await columnExistsQuery(db, 'dict_entries', 'is_active'))) {
    try {
      await db.query('ALTER TABLE dict_entries ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER last_used_at');
    } catch (e) {
      if (!/Duplicate column/i.test(String(e && e.message))) throw e;
    }
  }
  _ensured = true;
}

module.exports = { ensureDictTables };
