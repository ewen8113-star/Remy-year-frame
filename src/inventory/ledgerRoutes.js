const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 台账月份下界/上界（与出库、入库单、空瓶追溯同一财年规则），用于下拉从「最早有记录」月份开始
router.get('/ledger-month-range', async (req, res) => {
  try {
    const yfRaw = req.query.yearFrameId ?? req.query.year_frame_id;
    const yfId = parseInt(yfRaw, 10);
    const fiscalClause = Number.isFinite(yfId)
      ? ` AND (
        (o.activity_id IS NOT NULL AND act.year_frame_id = ?)
        OR (o.link_mode = 'standalone' AND o.activity_id IS NULL)
        OR (
          o.activity_id IS NULL
          AND o.link_mode = 'activity'
          AND TRIM(COALESCE(o.project_code, '')) <> ''
          AND EXISTS (
            SELECT 1 FROM activities act_yf
            WHERE act_yf.project_code = o.project_code AND act_yf.year_frame_id = ?
          )
        )
      )`
      : '';
    const fiscalParams = Number.isFinite(yfId) ? [yfId, yfId] : [];

    const sqlOb = `
      SELECT
        MIN(COALESCE(o.shipped_at, o.created_at)) AS tmin,
        MAX(COALESCE(o.shipped_at, o.created_at)) AS tmax
      FROM inv_outbound_orders o
      LEFT JOIN activities act ON act.id = o.activity_id
      WHERE COALESCE(o.shipped_at, o.created_at) IS NOT NULL
      ${fiscalClause}
    `;
    const sqlRb = `
      SELECT
        MIN(rb.created_at) AS tmin,
        MAX(rb.created_at) AS tmax
      FROM inv_return_batches rb
      INNER JOIN inv_outbound_orders o ON o.id = rb.outbound_order_id
      LEFT JOIN activities act ON act.id = o.activity_id
      WHERE rb.created_at IS NOT NULL
      ${fiscalClause}
    `;

    const [[obRow]] = await db.query(sqlOb, fiscalParams);
    const [[rbRow]] = await db.query(sqlRb, fiscalParams);

    const toDate = (v) => {
      if (v == null) return null;
      const d = v instanceof Date ? v : new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const candidates = [toDate(obRow?.tmin), toDate(obRow?.tmax), toDate(rbRow?.tmin), toDate(rbRow?.tmax)].filter(Boolean);
    if (!candidates.length) {
      return res.json({ min_month: null, max_month: null });
    }

    const tmin = new Date(Math.min(...candidates.map((d) => d.getTime())));
    const tmax = new Date(Math.max(...candidates.map((d) => d.getTime())));

    const toYm = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let minMonth = toYm(tmin);
    let maxMonth = toYm(tmax);

    const now = new Date();
    const capYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (maxMonth > capYm) maxMonth = capYm;
    if (minMonth > maxMonth) {
      minMonth = maxMonth;
    }

    res.json({ min_month: minMonth, max_month: maxMonth });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载月份范围失败' });
  }
});

module.exports = router;
