const express = require('express');
const db = require('../config/database');
const { serializeRow } = require('./routeHelpers');

const router = express.Router();

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

    sql += ' ORDER BY r.date DESC, r.id DESC';

    const [rows] = await db.query(sql, params);
    res.json(rows.map(serializeRow));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** 盛融报销单 Excel（保留表头/边框/列宽，A4 横向） */
router.get('/:id/excel', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [rows] = await db.query('SELECT * FROM reimbursements WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    const { writeReimbursementExcel } = require('../reimbursement/buildReimbursementExcel');
    await writeReimbursementExcel(res, serializeRow(rows[0]));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ error: error.message || '导出失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT r.*, yf.year as year_frame_name
       FROM reimbursements r
       LEFT JOIN year_frames yf ON r.year_frame_id = yf.id
       WHERE r.id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    res.json(serializeRow(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
