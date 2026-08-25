const express = require('express');
const db = require('../config/database');
const { sumYearFrameEffectiveQuotedPrices } = require('./syncQuotationToActivities');
const {
  normalizeEventDate,
  parseLinkedSessions,
  resolveQuotationDisplayEventDate,
} = require('./routeUtils');

const router = express.Router();

router.get('/template-sections', async (req, res) => {
  try {
    const type = String(req.query.type || 'EVENT').toUpperCase();
    const [rows] = await db.query(
      `SELECT * FROM quotation_template_sections
       WHERE applicable_type = ? AND is_active = 1
       ORDER BY sort_order ASC, id ASC`,
      [type]
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message || '加载模版失败' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { yearFrameId, type, status, q } = req.query;
    let sql = `SELECT q.id, q.quotation_no, q.type, q.quote_mode, q.year_frame_id, q.activity_id,
      CASE
        WHEN q.activity_id IS NOT NULL AND act.project_code IS NOT NULL AND TRIM(act.project_code) <> ''
          THEN act.project_code
        ELSE q.project_code
      END AS project_code,
      q.linked_sessions,
      q.project_name, q.client_brand, q.city, q.customer_name, q.event_date, q.event_type,
      q.total_amount, q.status, q.created_at, q.updated_at,
      act.activity_type AS activity_type_name,
      act.date AS activity_date
      FROM quotations q
      LEFT JOIN activities act ON act.id = q.activity_id
      WHERE 1=1`;
    const params = [];
    if (yearFrameId) {
      sql += ' AND q.year_frame_id = ?';
      params.push(parseInt(yearFrameId, 10));
    }
    if (type) {
      sql += ' AND q.type = ?';
      params.push(String(type).toUpperCase());
    }
    if (status) {
      sql += ' AND q.status = ?';
      params.push(String(status).toLowerCase());
    }
    if (q) {
      const like = `%${String(q).trim()}%`;
      sql += ` AND (q.quotation_no LIKE ? OR q.project_name LIKE ? OR q.customer_name LIKE ?
        OR q.city LIKE ? OR q.project_code LIKE ? OR act.project_code LIKE ?)`;
      params.push(like, like, like, like, like, like);
    }
    sql += ' ORDER BY q.id DESC';
    const [rows] = await db.query(sql, params);
    const normalized = rows.map((r) => ({
      ...r,
      quote_mode: r.quote_mode || 'single',
      linked_sessions: parseLinkedSessions(r.linked_sessions).map((s) => ({
        ...s,
        event_date: normalizeEventDate(s.event_date),
      })),
      event_date: resolveQuotationDisplayEventDate(r),
    }));
    // 隐藏已被多场报价覆盖的单场报价，避免列表重复展示
    const mergedActivityIds = new Set();
    normalized.forEach((r) => {
      if (String(r.quote_mode) !== 'multi') return;
      (r.linked_sessions || []).forEach((s) => {
        const aid = parseInt(s.activity_id, 10);
        if (Number.isFinite(aid)) mergedActivityIds.add(aid);
      });
    });
    const data = normalized.filter((r) => {
      if (String(r.quote_mode) === 'multi') return true;
      const aid = parseInt(r.activity_id, 10);
      if (!Number.isFinite(aid)) return true;
      return !mergedActivityIds.has(aid);
    });
    let summary = null;
    if (yearFrameId) {
      summary = await sumYearFrameEffectiveQuotedPrices(db, parseInt(yearFrameId, 10));
    }
    res.json({ data, summary });
  } catch (e) {
    res.status(500).json({ error: e.message || '列表加载失败' });
  }
});

module.exports = router;
