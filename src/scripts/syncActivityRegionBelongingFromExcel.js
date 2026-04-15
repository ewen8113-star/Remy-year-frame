/**
 * 从「活动数据.xlsx」的「场次信息」表读取「区域」「归属」，按「项目编号」矫正 activities 表。
 *
 * 用法：
 *   npm run script:sync-activity-region-belonging-excel
 *   npm run script:sync-activity-region-belonging-excel -- /path/to/活动数据.xlsx
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const db = require('../config/database');

function cellStr(v) {
  if (v == null || v === '') return '';
  let s = String(v).trim();
  s = s.replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

function cellOrNull(v) {
  const s = cellStr(v);
  if (!s || s === '—' || s === '-') return null;
  return s;
}

/** 与库内 project_code 对齐：合并连续空白为单个空格 */
function normalizeProjectCodeKey(s) {
  return cellStr(s).replace(/\s+/g, ' ').trim();
}

async function main() {
  const argPath = process.argv[2];
  const defaultPath = path.join(__dirname, '../../活动数据.xlsx');
  const xlsxPath = argPath ? path.resolve(argPath) : defaultPath;

  if (!fs.existsSync(xlsxPath)) {
    console.error('找不到 Excel 文件:', xlsxPath);
    process.exit(1);
  }

  const wb = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheetName = wb.SheetNames.includes('场次信息') ? '场次信息' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.error('工作簿中无可用工作表');
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });

  const [actRows] = await db.query('SELECT project_code FROM activities');
  const normToCanonical = new Map();
  for (const a of actRows) {
    const canon = String(a.project_code || '').trim();
    if (!canon) continue;
    const k = normalizeProjectCodeKey(canon);
    if (!normToCanonical.has(k)) normToCanonical.set(k, canon);
  }

  /** 同一规范化项目编号多行时后者覆盖前者 */
  const byNorm = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const pc = cellStr(row['项目编号']);
    if (!pc) continue;
    const k = normalizeProjectCodeKey(pc);
    if (!k) continue;
    byNorm.set(k, {
      region: cellOrNull(row['区域']),
      belonging: cellOrNull(row['归属']),
    });
  }

  let updated = 0;
  let notFound = 0;
  const samplesMissing = [];

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const [normKey, { region, belonging }] of byNorm) {
      const canonical = normToCanonical.get(normKey);
      if (!canonical) {
        notFound++;
        if (samplesMissing.length < 25) samplesMissing.push(normKey);
        continue;
      }
      const [r] = await conn.query(
        'UPDATE activities SET region = ?, belonging = ? WHERE project_code = ?',
        [region, belonging, canonical]
      );
      if (r.affectedRows > 0) updated += r.affectedRows;
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  console.log('✅ 已从 Excel 同步区域 / 归属');
  console.log(`   文件: ${xlsxPath}`);
  console.log(`   工作表: ${sheetName}`);
  console.log(`   解析到有效项目编号（去重后）: ${byNorm.size} 条`);
  console.log(`   数据库更新行数: ${updated}`);
  console.log(`   未匹配项目编号（库中无此 project_code）: ${notFound}`);
  if (samplesMissing.length) {
    console.log('   未匹配示例（前若干条）:', samplesMissing.join(' | '));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
