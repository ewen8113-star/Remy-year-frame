const express = require('express');
const db = require('../config/database');
const { ALLOWED_TYPES, FISCAL_MONTH_LABELS } = require('./routeHelpers');

const router = express.Router();

router.get('/options', async (req, res) => {
  try {
    const activityBase = ['activity_type IN (?, ?, ?, ?)'];
    const params = [...ALLOWED_TYPES];
    if (req.query.yearFrameId) {
      activityBase.push('year_frame_id = ?');
      params.push(parseInt(req.query.yearFrameId, 10));
    }
    const where = activityBase.join(' AND ');

    const [brands] = await db.query(`SELECT DISTINCT brand FROM activities WHERE ${where} ORDER BY brand ASC`, params);
    const [regions] = await db.query(`SELECT DISTINCT region FROM activities WHERE ${where} ORDER BY region ASC`, params);
    const [cities] = await db.query(`SELECT DISTINCT city FROM activities WHERE ${where} ORDER BY city ASC`, params);
    const [periods] = await db.query(`SELECT DISTINCT period FROM activities WHERE ${where} ORDER BY period ASC`, params);

    const regionValues = regions.map((r) => r.region).filter(Boolean);
    if (!regionValues.includes('东区-婚宴')) regionValues.push('东区-婚宴');

    res.json({
      brands: brands.map((r) => r.brand).filter(Boolean),
      regions: regionValues,
      cities: cities.map((r) => r.city).filter(Boolean),
      activityTypes: ALLOWED_TYPES,
      executionFlags: ['有', '无'],
      pgFlags: ['有', '无'],
      periods: periods.map((r) => r.period).filter(Boolean),
      fiscalMonths: FISCAL_MONTH_LABELS.map((label, idx) => {
        const monthNum = idx < 9 ? idx + 4 : idx - 8;
        return { value: String(monthNum), label };
      }),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
