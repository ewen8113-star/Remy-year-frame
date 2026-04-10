const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取活动列表
router.get('/', async (req, res) => {
  try {
    const { yearFrameId, activityType, city, brand, status, sortBy = 'date', sortOrder = 'DESC' } = req.query;
    
    let sql = `
      SELECT a.*, yf.year as year_frame_name
      FROM activities a
      LEFT JOIN year_frames yf ON a.year_frame_id = yf.id
      WHERE 1=1
    `;
    const params = [];
    
    if (yearFrameId) {
      sql += ' AND a.year_frame_id = ?';
      params.push(yearFrameId);
    }
    if (activityType) {
      sql += ' AND a.activity_type = ?';
      params.push(activityType);
    }
    if (city) {
      sql += ' AND a.city LIKE ?';
      params.push(`%${city}%`);
    }
    if (brand) {
      sql += ' AND a.brand = ?';
      params.push(brand);
    }
    if (status) {
      sql += ' AND a.status = ?';
      params.push(status);
    }
    
    // 排序
    const validSortColumns = ['date', 'city', 'brand', 'quoted_price', 'total_cost', 'created_at'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'date';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    sql += ` ORDER BY a.${sortColumn} ${order}`;
    
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取单个活动
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(`
      SELECT a.*, yf.year as year_frame_name
      FROM activities a
      LEFT JOIN year_frames yf ON a.year_frame_id = yf.id
      WHERE a.id = ?
    `, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: '活动不存在' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建活动
router.post('/', async (req, res) => {
  try {
    const {
      year_frame_id, year_frame_code, project_code, activity_type,
      city, brand, client, client_name, venue, date, period, guest_count,
      quoted_price, executor, remarks, wine_details
    } = req.body;
    
    const [result] = await db.query(`
      INSERT INTO activities (
        year_frame_id, year_frame_code, project_code, activity_type,
        city, brand, client, client_name, venue, date, period, guest_count,
        quoted_price, executor, remarks, wine_details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      year_frame_id, year_frame_code, project_code, activity_type,
      city, brand, client, client_name, venue, date, period || '日常', guest_count,
      quoted_price, executor, remarks, JSON.stringify(wine_details || {})
    ]);
    
    res.json({ id: result.insertId, message: '创建成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新活动
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowedFields = [
      'year_frame_code',
      'project_code',
      'activity_type',
      'city',
      'brand',
      'client',
      'client_name',
      'venue',
      'date',
      'period',
      'guest_count',
      'quoted_price',
      'total_cost',
      'executor',
      'status',
      'remarks',
      'wine_details',
      'cost_details'
    ];

    const keys = Object.keys(req.body || {}).filter(
      (k) => allowedFields.includes(k) && req.body[k] !== undefined
    );

    if (keys.length === 0) {
      return res.status(400).json({ error: '没有可更新的字段' });
    }

    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    const params = keys.map((k) => {
      if (k === 'wine_details' || k === 'cost_details') return JSON.stringify(req.body[k] || {});
      return req.body[k];
    });

    params.push(id);

    await db.query(`UPDATE activities SET ${setClause} WHERE id = ?`, params);

    res.json({ message: '更新成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除活动
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM activities WHERE id = ?', [id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量更新状态
router.post('/batch-update-status', async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请提供活动ID列表' });
    }
    
    const placeholders = ids.map(() => '?').join(',');
    await db.query(
      `UPDATE activities SET status = ? WHERE id IN (${placeholders})`,
      [status, ...ids]
    );
    
    res.json({ message: `成功更新 ${ids.length} 条记录` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
