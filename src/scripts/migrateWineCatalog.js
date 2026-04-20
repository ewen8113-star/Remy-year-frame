/**
 * 创建 wine_catalog 表，并清空旧酒品库存相关表（入库/使用/归还/库存明细）。
 * 运行: node src/scripts/migrateWineCatalog.js
 */
require('dotenv').config();
const db = require('../config/database');
const { ensureWineCatalog } = require('../wine/ensureWineCatalog');

async function run() {
  await ensureWineCatalog(db);
  console.log('✅ wine_catalog 表已就绪');

  const conn = await db.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    const tables = ['wine_return_logs', 'wine_usage', 'wine_stock_in', 'wine_inventory'];
    for (const t of tables) {
      try {
        await conn.query(`TRUNCATE TABLE ${t}`);
        console.log('✅ 已清空表:', t);
      } catch (e) {
        console.warn('⚠️ 跳过表', t, ':', e.message);
      }
    }
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
    console.log('✅ 迁移完成：旧酒品流水与库存已清空；请使用「酒品目录」维护主数据。');
  } finally {
    conn.release();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
