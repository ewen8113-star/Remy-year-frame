const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取报销列表
router.get('/', async (req, res) => {
  try {
    const { yearFrameId, city } = req.query;
    
    let sql = `
      SELECT r.*, yf.year as year_frame_name
      FROM reimbursements r
      LEFT JOIN year_frames yf ON r.year_frame_id = yf.id
      WHERE 1=1
    `;
    const params = [];
    
    if (yearFrameId) {
      sql += ' AND r.year_frame_id = ?';
      params.push(yearFrameId);
    }
    if (city) {
      sql += ' AND r.city LIKE ?';
      params.push(`%${city}%`);
    }
    
    sql += ' ORDER BY r.date DESC';
    
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建报销记录
router.post('/', async (req, res) => {
  try {
    const { year_frame_id, reimbursement_type, city, amount, date, related_project_code, props, printing, express, other, remarks } = req.body;
    
    const totalAmount = amount || (props || 0) + (printing || 0) + (express || 0) + (other || 0);
    
    const [result] = await db.query(`
      INSERT INTO reimbursements (year_frame_id, reimbursement_type, city, amount, date, related_project_code, props, printing, express, other, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [year_frame_id, reimbursement_type, city, totalAmount, date, related_project_code, props || 0, printing || 0, express || 0, other || 0, remarks]);
    
    res.json({ id: result.insertId, message: '创建成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新报销记录
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reimbursement_type, city, amount, date, related_project_code, props, printing, express, other, remarks } = req.body;
    
    const totalAmount = amount || (props || 0) + (printing || 0) + (express || 0) + (other || 0);
    
    await db.query(`
      UPDATE reimbursements SET
        reimbursement_type = ?, city = ?, amount = ?,
        date = ?, related_project_code = ?,
        props = ?, printing = ?, express = ?, other = ?,
        remarks = ?
      WHERE id = ?
    `, [reimbursement_type, city, totalAmount, date, related_project_code, props || 0, printing || 0, express || 0, other || 0, remarks, id]);
    
    res.json({ message: '更新成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除报销记录
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM reimbursements WHERE id = ?', [id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
