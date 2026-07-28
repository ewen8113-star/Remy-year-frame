const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const db = require('../config/database');

const BACKUP_DIR = path.join(__dirname, '../../backups');
const DATE_BACKUP_DIR = path.join(__dirname, '../../Date Backup');
const PROJECT_ROOT = path.join(__dirname, '../../');
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'public/uploads');
const RESTORE_CONFIRM_PHRASE = '确认恢复';
const INSERT_BATCH_SIZE = 80;
const MAX_BACKUP_KEEP = 5;
const MAX_PRE_RESTORE_KEEP = 2;

// 确保备份目录存在
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}
if (!fs.existsSync(DATE_BACKUP_DIR)) {
  fs.mkdirSync(DATE_BACKUP_DIR, { recursive: true });
}

function tsStamp() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

function safeTableName(name) {
  return /^[a-zA-Z0-9_]+$/.test(String(name || ''));
}

function safeBackupFolderName(name) {
  return /^(full-backup|pre-restore)-[0-9]{8}-[0-9]{6}$/.test(String(name || ''));
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
  return { data: out, tableStats, totalRows };
}

function tryCopyUploads(destDir) {
  const copied = [];
  if (!fs.existsSync(UPLOADS_DIR)) return copied;
  const dirs = ['inventory', 'wine-catalog'];
  for (const d of dirs) {
    const src = path.join(UPLOADS_DIR, d);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(destDir, 'uploads', d);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    copied.push(dest);
  }
  return copied;
}

function restoreUploadsFromBackup(backupDir) {
  const restored = [];
  const srcRoot = path.join(backupDir, 'uploads');
  if (!fs.existsSync(srcRoot)) return restored;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  for (const d of ['inventory', 'wine-catalog']) {
    const src = path.join(srcRoot, d);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(UPLOADS_DIR, d);
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    restored.push(d);
  }
  return restored;
}

async function writeFullBackupSnapshot(folderNamePrefix = 'full-backup') {
  const stamp = tsStamp();
  const folderName = `${folderNamePrefix}-${stamp}`;
  const fullBackupDir = path.join(BACKUP_DIR, folderName);
  fs.mkdirSync(fullBackupDir, { recursive: true });

  const dumped = await dumpAllTables();
  const dbJsonPath = path.join(fullBackupDir, 'database-full.json');
  fs.writeFileSync(
    dbJsonPath,
    JSON.stringify(
      {
        backupType: folderNamePrefix === 'pre-restore' ? 'pre-restore' : 'full',
        exportTime: new Date().toISOString(),
        tableStats: dumped.tableStats,
        totalRows: dumped.totalRows,
        tables: dumped.data,
      },
      null,
      2,
    ),
    'utf8',
  );

  const copiedUploadDirs = tryCopyUploads(fullBackupDir);
  const manifest = {
    backupType: folderNamePrefix === 'pre-restore' ? 'pre-restore' : 'full',
    exportTime: new Date().toISOString(),
    folderName,
    folderPath: fullBackupDir,
    databaseFile: dbJsonPath,
    copiedUploadDirs,
    tableCount: dumped.tableStats.length,
    totalRows: dumped.totalRows,
  };
  fs.writeFileSync(path.join(fullBackupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  let archivePath = null;
  try {
    archivePath = path.join(BACKUP_DIR, `${folderName}.tar.gz`);
    execFileSync('tar', ['-czf', archivePath, '-C', BACKUP_DIR, folderName], { stdio: 'ignore' });
  } catch (_) {
    archivePath = null;
  }

  pruneOldBackups();

  return {
    folderName,
    fullBackupDir,
    archivePath,
    tableCount: dumped.tableStats.length,
    totalRows: dumped.totalRows,
    uploadsCopied: copiedUploadDirs.length > 0,
    tableStats: dumped.tableStats,
  };
}

function readBackupManifest(folderName) {
  if (!safeBackupFolderName(folderName)) {
    throw new Error('非法备份目录名');
  }
  const fullBackupDir = path.join(BACKUP_DIR, folderName);
  if (!fs.existsSync(fullBackupDir) || !fs.statSync(fullBackupDir).isDirectory()) {
    throw new Error('备份目录不存在');
  }
  const dbJsonPath = path.join(fullBackupDir, 'database-full.json');
  if (!fs.existsSync(dbJsonPath)) {
    throw new Error('备份缺少 database-full.json');
  }
  let manifest = null;
  const manifestPath = path.join(fullBackupDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_) {
      manifest = null;
    }
  }
  return { fullBackupDir, dbJsonPath, manifest };
}

function listBackupFolderNames(prefix) {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => {
      if (prefix === 'full-backup') return /^full-backup-[0-9]{8}-[0-9]{6}$/.test(name);
      if (prefix === 'pre-restore') return /^pre-restore-[0-9]{8}-[0-9]{6}$/.test(name);
      return safeBackupFolderName(name);
    })
    .filter((name) => {
      const p = path.join(BACKUP_DIR, name);
      try {
        return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'database-full.json'));
      } catch (_) {
        return false;
      }
    })
    .sort((a, b) => String(b).localeCompare(String(a)));
}

function buildBackupListItem(folderName) {
  const fullBackupDir = path.join(BACKUP_DIR, folderName);
  const manifestPath = path.join(fullBackupDir, 'manifest.json');
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_) {
      manifest = null;
    }
  }
  const archiveName = `${folderName}.tar.gz`;
  const archivePath = path.join(BACKUP_DIR, archiveName);
  const st = fs.statSync(fullBackupDir);
  return {
    folderName,
    backupType: manifest?.backupType || (folderName.startsWith('pre-restore-') ? 'pre-restore' : 'full'),
    exportTime: manifest?.exportTime || st.mtime.toISOString(),
    tableCount: manifest?.tableCount ?? null,
    totalRows: manifest?.totalRows ?? null,
    hasArchive: fs.existsSync(archivePath),
    hasUploads: fs.existsSync(path.join(fullBackupDir, 'uploads')),
    mtime: st.mtime.toISOString(),
  };
}

function listFullBackups() {
  // 列表只展示「全局备份」，最多 5 条；恢复前快照单独保留但不占列表
  return listBackupFolderNames('full-backup').slice(0, MAX_BACKUP_KEEP).map(buildBackupListItem);
}

function prunePrefix(prefix, keep) {
  const names = fs.existsSync(BACKUP_DIR)
    ? fs
        .readdirSync(BACKUP_DIR)
        .filter((name) => {
          if (prefix === 'full-backup') return /^full-backup-[0-9]{8}-[0-9]{6}$/.test(name);
          if (prefix === 'pre-restore') return /^pre-restore-[0-9]{8}-[0-9]{6}$/.test(name);
          return false;
        })
        .filter((name) => {
          const p = path.join(BACKUP_DIR, name);
          try {
            return fs.statSync(p).isDirectory();
          } catch (_) {
            return false;
          }
        })
        .sort((a, b) => String(b).localeCompare(String(a)))
    : [];

  const removed = [];
  for (const name of names.slice(Math.max(0, keep))) {
    const dir = path.join(BACKUP_DIR, name);
    const archive = path.join(BACKUP_DIR, `${name}.tar.gz`);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      if (fs.existsSync(archive)) fs.rmSync(archive, { force: true });
      removed.push(name);
    } catch (err) {
      console.warn('清理旧备份失败:', name, err && err.message ? err.message : err);
    }
  }
  return removed;
}

/** 全局备份保留最近 5 次；恢复前快照另保留最近 2 次 */
function pruneOldBackups() {
  const removed = [
    ...prunePrefix('full-backup', MAX_BACKUP_KEEP),
    ...prunePrefix('pre-restore', MAX_PRE_RESTORE_KEEP),
  ];

  // 清理无对应目录的残留压缩包
  try {
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      if (!/^(full-backup|pre-restore)-[0-9]{8}-[0-9]{6}\.tar\.gz$/.test(f)) continue;
      const base = f.replace(/\.tar\.gz$/, '');
      if (!fs.existsSync(path.join(BACKUP_DIR, base))) {
        fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
        removed.push(f);
      }
    }
  } catch (_) {
    /* ignore */
  }

  return { removed };
}

module.exports = {
  BACKUP_DIR,
  DATE_BACKUP_DIR,
  MAX_BACKUP_KEEP,
  RESTORE_CONFIRM_PHRASE,
  listFullBackups,
  pruneOldBackups,
  readBackupManifest,
  restoreUploadsFromBackup,
  writeFullBackupSnapshot,
};
