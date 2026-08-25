const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const {
  BACKUP_DIR,
  DATE_BACKUP_DIR,
} = require('./storage');

const router = express.Router();

router.post('/export', async (req, res) => {
  try {
    const yearFrameId = parseInt(req.body?.yearFrameId ?? req.body?.year_frame_id, 10);
    if (!Number.isFinite(yearFrameId) || yearFrameId <= 0) {
      return res.status(400).json({ error: '缺少有效的 yearFrameId' });
    }

    const [[yf]] = await db.query('SELECT id, year, name FROM year_frames WHERE id = ? LIMIT 1', [yearFrameId]);
    if (!yf) return res.status(400).json({ error: '年框不存在' });

    const [activities] = await db.query('SELECT * FROM activities WHERE year_frame_id = ? ORDER BY id', [yearFrameId]);
    const [warehouse] = await db.query('SELECT * FROM warehouse WHERE year_frame_id = ? ORDER BY id', [yearFrameId]);
    const [logistics] = await db.query('SELECT * FROM logistics WHERE year_frame_id = ? ORDER BY id', [yearFrameId]);
    const [reimbursements] = await db.query('SELECT * FROM reimbursements WHERE year_frame_id = ? ORDER BY id', [yearFrameId]);

    const counts = {
      activities: activities.length,
      warehouse: warehouse.length,
      logistics: logistics.length,
      reimbursements: reimbursements.length,
    };
    const totalCount = counts.activities + counts.warehouse + counts.logistics + counts.reimbursements;

    const backupData = {
      backupType: 'year-frame-json',
      exportTime: new Date().toISOString(),
      yearFrameId,
      yearFrame: yf,
      contents: [
        'activities（场次，含虚拟场次）',
        'warehouse（仓储）',
        'logistics（物流）',
        'reimbursements（报销）',
      ],
      counts,
      activities,
      warehouse,
      logistics,
      reimbursements,
    };

    if (!fs.existsSync(DATE_BACKUP_DIR)) {
      fs.mkdirSync(DATE_BACKUP_DIR, { recursive: true });
    }

    const yearLabel = String(yf.year || '').replace(/[^\d]/g, '') || String(yearFrameId);
    const day = new Date().toISOString().slice(0, 10);
    const filename = `remy-backup-${yearLabel}-${day}-${Date.now()}.json`;
    const filepath = path.join(DATE_BACKUP_DIR, filename);

    fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2), 'utf8');

    await db.query(
      `INSERT INTO backup_records (year_frame_id, backup_type, backup_file, record_count)
       VALUES (?, 'manual', ?, ?)`,
      [yearFrameId, filename, totalCount],
    );

    res.json({
      message: 'JSON 备份已保存',
      filename,
      path: filepath,
      directory: DATE_BACKUP_DIR,
      yearFrameId,
      yearFrame: yf,
      counts,
      count: totalCount,
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
        await db.query(
          `
          INSERT INTO activities (year_frame_id, ${Object.keys(rest).join(',')})
          VALUES (?, ${Object.keys(rest)
            .map(() => '?')
            .join(',')})
        `,
          [yearFrameId, ...Object.values(rest)],
        );
      }
    }

    // 导入仓储
    if (warehouse && warehouse.length > 0) {
      for (const item of warehouse) {
        const { id, created_at, updated_at, ...rest } = item;
        await db.query(
          `
          INSERT INTO warehouse (year_frame_id, ${Object.keys(rest).join(',')})
          VALUES (?, ${Object.keys(rest)
            .map(() => '?')
            .join(',')})
        `,
          [yearFrameId, ...Object.values(rest)],
        );
      }
    }

    // 导入物流
    if (logistics && logistics.length > 0) {
      for (const item of logistics) {
        const { id, created_at, updated_at, ...rest } = item;
        await db.query(
          `
          INSERT INTO logistics (year_frame_id, ${Object.keys(rest).join(',')})
          VALUES (?, ${Object.keys(rest)
            .map(() => '?')
            .join(',')})
        `,
          [yearFrameId, ...Object.values(rest)],
        );
      }
    }

    // 导入报销
    if (reimbursements && reimbursements.length > 0) {
      for (const item of reimbursements) {
        const { id, created_at, updated_at, ...rest } = item;
        await db.query(
          `
          INSERT INTO reimbursements (year_frame_id, ${Object.keys(rest).join(',')})
          VALUES (?, ${Object.keys(rest)
            .map(() => '?')
            .join(',')})
        `,
          [yearFrameId, ...Object.values(rest)],
        );
      }
    }

    const totalCount =
      (activities?.length || 0) + (warehouse?.length || 0) + (logistics?.length || 0) + (reimbursements?.length || 0);

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
