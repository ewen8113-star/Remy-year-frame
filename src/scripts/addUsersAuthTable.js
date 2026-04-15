/**
 * 创建 users 表并初始化管理员账号（可重复执行）
 * 用法：npm run migrate:users-auth
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const db = require('../config/database');

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','operator') NOT NULL DEFAULT 'operator',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function main() {
  await db.query(DDL);
  console.log('✅ users 表已就绪');

  const username = String(process.env.ADMIN_USERNAME || 'admin').trim();
  const password = String(process.env.ADMIN_PASSWORD || 'admin123456').trim();
  if (!username || !password) {
    console.log('ℹ️ ADMIN_USERNAME / ADMIN_PASSWORD 为空，跳过初始化管理员');
    process.exit(0);
  }

  const [rows] = await db.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
  if (rows.length) {
    console.log(`ℹ️ 管理员账号已存在：${username}`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);
  await db.query(
    "INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, 'admin', 1)",
    [username, hash]
  );
  console.log(`✅ 已初始化管理员账号：${username}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ 迁移失败:', e && e.message ? e.message : e);
  process.exit(1);
});
