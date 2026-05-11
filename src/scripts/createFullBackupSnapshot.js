/**
 * 一次性执行全局备份（全表 + 上传目录）
 * 输出到项目根 backups/full-backup-YYYYMMDD-HHMMSS
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const db = require('../config/database');

const PROJECT_ROOT = path.join(__dirname, '../../');
const BACKUP_DIR = path.join(PROJECT_ROOT, 'backups');
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'public/uploads');

function tsStamp() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

function safeTableName(name) {
  return /^[a-zA-Z0-9_]+$/.test(String(name || ''));
}

async function dumpAllTables() {
  const [tableRows] = await db.query(
    `SELECT TABLE_NAME AS table_name
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
  );
  const out = {};
  const tableStats = [];
  let totalRows = 0;
  for (const tr of tableRows) {
    const table = String(tr.table_name || '').trim();
    if (!safeTableName(table)) continue;
    const [rows] = await db.query(`SELECT * FROM \`${table}\``);
    out[table] = rows;
    tableStats.push({ table, rows: Array.isArray(rows) ? rows.length : 0 });
    totalRows += Array.isArray(rows) ? rows.length : 0;
  }
  return { out, tableStats, totalRows };
}

function copyUploads(backupDir) {
  const copied = [];
  if (!fs.existsSync(UPLOADS_DIR)) return copied;
  for (const d of ['inventory', 'wine-catalog']) {
    const src = path.join(UPLOADS_DIR, d);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(backupDir, 'uploads', d);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    copied.push(dest);
  }
  return copied;
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const folderName = `full-backup-${tsStamp()}`;
  const backupDir = path.join(BACKUP_DIR, folderName);
  fs.mkdirSync(backupDir, { recursive: true });

  const dumped = await dumpAllTables();
  const dbFile = path.join(backupDir, 'database-full.json');
  fs.writeFileSync(
    dbFile,
    JSON.stringify(
      {
        backupType: 'full',
        exportTime: new Date().toISOString(),
        tableStats: dumped.tableStats,
        totalRows: dumped.totalRows,
        tables: dumped.out,
      },
      null,
      2,
    ),
    'utf8',
  );

  const copiedUploadDirs = copyUploads(backupDir);

  const manifest = {
    backupType: 'full',
    exportTime: new Date().toISOString(),
    folderName,
    backupDir,
    databaseFile: dbFile,
    copiedUploadDirs,
    tableCount: dumped.tableStats.length,
    totalRows: dumped.totalRows,
  };
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  let archivePath = null;
  try {
    archivePath = path.join(BACKUP_DIR, `${folderName}.tar.gz`);
    execFileSync('tar', ['-czf', archivePath, '-C', BACKUP_DIR, folderName], { stdio: 'ignore' });
  } catch (_) {
    archivePath = null;
  }

  console.log(JSON.stringify({ ok: true, backupDir, archivePath, tableCount: dumped.tableStats.length, totalRows: dumped.totalRows }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

