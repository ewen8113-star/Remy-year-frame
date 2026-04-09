const express = require('express');
const router = express.Router();
const db = require('../config/database');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '../../backups');

// 确保备份目录存在
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
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
