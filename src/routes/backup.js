const express = require('express');
const router = express.Router();
const db = require('../config/database');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKUP_DIR = path.join(__dirname, '../../backups');
const PROJECT_ROOT = path.join(__dirname, '../../');
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'public/uploads');

// 确保备份目录存在
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

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

// 获取备份记录
router.get('/', async (req, res) => {
  try {
    const { yearFrameId } = req.query;
    
    let sql = 'SELECT * FROM backup_records WHERE 1=1';
    const params = [];
    
    if (yearFrameId) {
      sql += ' AND year_frame_id = ?';
      params.push(yearFrameId);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 全局备份：全表数据 + 上传文件
router.post('/full-export', async (req, res) => {
  try {
    const stamp = tsStamp();
    const folderName = `full-backup-${stamp}`;
    const fullBackupDir = path.join(BACKUP_DIR, folderName);
    fs.mkdirSync(fullBackupDir, { recursive: true });

    const dumped = await dumpAllTables();
    const dbJsonPath = path.join(fullBackupDir, 'database-full.json');
    fs.writeFileSync(
      dbJsonPath,
      JSON.stringify(
        {
          backupType: 'full',
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
      backupType: 'full',
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

    await db.query(
      `INSERT INTO backup_records (year_frame_id, backup_type, backup_file, record_count)
       VALUES (NULL, 'manual', ?, ?)`,
      [archivePath ? path.basename(archivePath) : folderName, dumped.totalRows],
    );

    res.json({
      message: '全局备份成功',
      backupDir: fullBackupDir,
      archivePath,
      tableCount: dumped.tableStats.length,
      totalRows: dumped.totalRows,
      uploadsCopied: copiedUploadDirs.length > 0,
      tableStats: dumped.tableStats,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '全局备份失败' });
  }
});

// 导出数据备份
router.post('/export', async (req, res) => {
  try {
    const { yearFrameId } = req.body;
    
    // 获取所有数据
    const [activities] = await db.query('SELECT * FROM activities WHERE year_frame_id = ?', [yearFrameId]);
    const [warehouse] = await db.query('SELECT * FROM warehouse WHERE year_frame_id = ?', [yearFrameId]);
    const [logistics] = await db.query('SELECT * FROM logistics WHERE year_frame_id = ?', [yearFrameId]);
    const [reimbursements] = await db.query('SELECT * FROM reimbursements WHERE year_frame_id = ?', [yearFrameId]);
    
    const backupData = {
      exportTime: new Date().toISOString(),
      yearFrameId,
      activities,
      warehouse,
      logistics,
      reimbursements
    };
    
    const filename = `backup_${yearFrameId}_${Date.now()}.json`;
    const filepath = path.join(BACKUP_DIR, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2), 'utf8');
    
    // 记录备份
    await db.query(`
      INSERT INTO backup_records (year_frame_id, backup_type, backup_file, record_count)
      VALUES (?, 'manual', ?, ?)
    `, [yearFrameId, filename, activities.length + warehouse.length + logistics.length + reimbursements.length]);
    
    res.json({ 
      message: '备份成功', 
      filename,
      path: filepath,
      count: activities.length + warehouse.length + logistics.length + reimbursements.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 导入数据
router.post('/import', async (req, res) => {
  try {
    const { yearFrameId, data } = req.body;
    
    if (!data) {
      return res.status(400).json({ error: '请提供导入数据' });
    }
    
    const { activities, warehouse, logistics, reimbursements } = data;
    
    // 导入活动
    if (activities && activities.length > 0) {
      for (const item of activities) {
        const { id, created_at, updated_at, ...rest } = item;
        await db.query(`
          INSERT INTO activities (year_frame_id, ${Object.keys(rest).join(',')})
          VALUES (?, ${Object.keys(rest).map(() => '?').join(',')})
        `, [yearFrameId, ...Object.values(rest)]);
      }
    }
    
    // 导入仓储
    if (warehouse && warehouse.length > 0) {
      for (const item of warehouse) {
        const { id, created_at, updated_at, ...rest } = item;
        await db.query(`
          INSERT INTO warehouse (year_frame_id, ${Object.keys(rest).join(',')})
          VALUES (?, ${Object.keys(rest).map(() => '?').join(',')})
        `, [yearFrameId, ...Object.values(rest)]);
      }
    }
    
    // 导入物流
    if (logistics && logistics.length > 0) {
      for (const item of logistics) {
        const { id, created_at, updated_at, ...rest } = item;
        await db.query(`
          INSERT INTO logistics (year_frame_id, ${Object.keys(rest).join(',')})
          VALUES (?, ${Object.keys(rest).map(() => '?').join(',')})
        `, [yearFrameId, ...Object.values(rest)]);
      }
    }
    
    // 导入报销
    if (reimbursements && reimbursements.length > 0) {
      for (const item of reimbursements) {
        const { id, created_at, updated_at, ...rest } = item;
        await db.query(`
          INSERT INTO reimbursements (year_frame_id, ${Object.keys(rest).join(',')})
          VALUES (?, ${Object.keys(rest).map(() => '?').join(',')})
        `, [yearFrameId, ...Object.values(rest)]);
      }
    }
    
    const totalCount = (activities?.length || 0) + (warehouse?.length || 0) + (logistics?.length || 0) + (reimbursements?.length || 0);
    
    res.json({ message: '导入成功', count: totalCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 读取备份文件
router.get('/download/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(BACKUP_DIR, filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }
    
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
