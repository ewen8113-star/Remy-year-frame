const express = require('express');
const path = require('path');
const db = require('../config/database');
const {
  MAX_BACKUP_KEEP,
  RESTORE_CONFIRM_PHRASE,
  listFullBackups,
  pruneOldBackups,
  readBackupManifest,
  restoreUploadsFromBackup,
  writeFullBackupSnapshot,
} = require('./storage');
const { restoreDatabaseFromJson } = require('./restore');

const router = express.Router();



async function resolveYearFrameId(raw) {
  let yearFrameId = parseInt(raw, 10);
  if (!Number.isFinite(yearFrameId) || yearFrameId <= 0) {
    const [yfRows] = await db.query('SELECT id FROM year_frames ORDER BY id DESC LIMIT 1');
    yearFrameId = yfRows[0]?.id ? Number(yfRows[0].id) : NaN;
  }
  return yearFrameId;
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

// 全局备份列表（目录扫描）
router.get('/full-list', async (req, res) => {
  try {
    pruneOldBackups();
    res.json({
      data: listFullBackups(),
      confirmPhrase: RESTORE_CONFIRM_PHRASE,
      maxKeep: MAX_BACKUP_KEEP,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '读取备份列表失败' });
  }
});

// 全局备份：全表数据 + 上传文件
router.post('/full-export', async (req, res) => {
  try {
    const snap = await writeFullBackupSnapshot('full-backup');

    const yearFrameId = await resolveYearFrameId(req.body?.yearFrameId ?? req.body?.year_frame_id);
    if (!Number.isFinite(yearFrameId) || yearFrameId <= 0) {
      return res.status(400).json({ error: '无可用年框，无法记录备份' });
    }

    await db.query(
      `INSERT INTO backup_records (year_frame_id, backup_type, backup_file, record_count)
       VALUES (?, 'manual', ?, ?)`,
      [yearFrameId, snap.archivePath ? path.basename(snap.archivePath) : snap.folderName, snap.totalRows],
    );

    res.json({
      message: '全局备份成功',
      backupDir: snap.fullBackupDir,
      archivePath: snap.archivePath,
      tableCount: snap.tableCount,
      totalRows: snap.totalRows,
      uploadsCopied: snap.uploadsCopied,
      tableStats: snap.tableStats,
      yearFrameId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '全局备份失败' });
  }
});

// 从全局备份恢复（危险操作：覆盖当前库）
router.post('/full-restore', async (req, res) => {
  try {
    const folderName = String(req.body?.folderName || '').trim();
    const confirmPhrase = String(req.body?.confirmPhrase || '').trim();
    if (!folderName) return res.status(400).json({ error: '请指定备份目录 folderName' });
    if (confirmPhrase !== RESTORE_CONFIRM_PHRASE) {
      return res.status(400).json({ error: `请输入确认语：${RESTORE_CONFIRM_PHRASE}` });
    }

    const { fullBackupDir, dbJsonPath } = readBackupManifest(folderName);

    // 恢复前自动快照，方便回滚
    const pre = await writeFullBackupSnapshot('pre-restore');

    const dbResult = await restoreDatabaseFromJson(dbJsonPath);
    const uploadsRestored = restoreUploadsFromBackup(fullBackupDir);

    const yearFrameId = await resolveYearFrameId(req.body?.yearFrameId ?? req.body?.year_frame_id);
    if (Number.isFinite(yearFrameId) && yearFrameId > 0) {
      await db.query(
        `INSERT INTO backup_records (year_frame_id, backup_type, backup_file, record_count)
         VALUES (?, 'manual', ?, ?)`,
        [yearFrameId, `restore-from:${folderName}`, dbResult.totalRows],
      );
    }

    res.json({
      message: '全局恢复成功',
      restoredFrom: folderName,
      preRestoreSnapshot: pre.folderName,
      preRestoreArchive: pre.archivePath,
      tableCount: dbResult.tableCount,
      totalRows: dbResult.totalRows,
      uploadsRestored,
      skippedTables: dbResult.skipped,
      tableStats: dbResult.restored,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '全局恢复失败' });
  }
});

module.exports = router;
