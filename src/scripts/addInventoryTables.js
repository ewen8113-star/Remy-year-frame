/**
 * 物资库存（库管）相关表 — 可重复执行
 * 用法: npm run migrate:inventory
 */
require('dotenv').config();
const db = require('../config/database');
const { ensureInventoryTables } = require('../inventory/ensureInventoryTables');

async function run() {
  try {
    await ensureInventoryTables(db);
    console.log('✅ inv_* 表已就绪');
  } finally {
    process.exit(0);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
