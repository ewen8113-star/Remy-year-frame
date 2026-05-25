const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'remy_year_frame',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  // 与业务一致：读写 TIMESTAMP/DATETIME 按北京时间（上海）
  timezone: '+08:00',
  // DATE 列返回 YYYY-MM-DD 字符串，避免 JS Date/JSON ISO 在列表里差一天
  dateStrings: ['DATE'],
});

// 测试连接
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ MySQL 数据库连接成功');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ 数据库连接失败:', error.message);
    return false;
  }
}

// 添加 execute 别名以便兼容
pool.execute = pool.execute.bind(pool);
pool.query = pool.query.bind(pool);

// 导出 pool 并添加 execute 方法
module.exports = {
  execute: pool.execute.bind(pool),
  query: pool.query.bind(pool),
  getConnection: pool.getConnection.bind(pool),
  testConnection
};
