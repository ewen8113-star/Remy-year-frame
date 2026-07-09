/**
 * 一次性修复：驿捷 → 衡之捷 供应商名称
 * 将付款申请、仓储、物流等业务表中旧公司名同步为新名称。
 * 用法：npm run repair:dict-payee-yijie-hengzhijie
 */
require('dotenv').config();
const db = require('../config/database');
const { syncPayeeNameGlobally, canonicalDisplayName } = require('../dict/syncDictNameReferences');

const OLD_NAME = '上海驿捷供应链管理有限公司';

async function resolveNewNameFromDict() {
  const [rows] = await db.query(
    `SELECT * FROM dict_entries
     WHERE category = 'supplier'
       AND (name LIKE '%衡之捷%' OR name LIKE '%驿捷%'
            OR CAST(content AS CHAR) LIKE '%衡之捷%'
            OR CAST(content AS CHAR) LIKE '%驿捷%')
     ORDER BY updated_at DESC
     LIMIT 5`
  );
  for (const row of rows) {
    const name = canonicalDisplayName(row);
    if (name && name !== OLD_NAME && /衡之捷/.test(name)) return name;
  }
  return '上海衡之捷供应链管理有限公司';
}

async function main() {
  const newName = await resolveNewNameFromDict();
  if (!newName || newName === OLD_NAME) {
    console.log('未找到新名称，跳过。请确认字典中供应商已改为「衡之捷」。');
    process.exit(0);
  }
  console.log(`修复收款方名称：${OLD_NAME} → ${newName}`);
  const result = await syncPayeeNameGlobally(db, OLD_NAME, newName);
  console.log(`共更新 ${result.total} 条记录：`, result.byTable);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
