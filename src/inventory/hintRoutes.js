const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { hintRegionFromActivityRegion } = require('./formatters');

async function resolveBrandId(brandRaw) {
  const s = String(brandRaw || '').trim();
  if (!s) return null;
  const up = s.toUpperCase().replace(/\s/g, '');
  const tryCodes = [];
  if (up.includes('CLUB')) tryCodes.push('CLUB');
  else if (up.includes('PHD')) tryCodes.push('PHD');
  else if (up.includes('XO') || up.includes('X.O')) tryCodes.push('X.O');
  else if (up.includes('REMY')) tryCodes.push('REMY');
  else if (up.includes('RC')) tryCodes.push('RC');
  else tryCodes.push(s);
  for (const c of tryCodes) {
    const [rows] = await db.query('SELECT id FROM brand_inventory WHERE brand_code = ? LIMIT 1', [c]);
    if (rows.length) return rows[0].id;
  }
  const [rows2] = await db.query('SELECT id FROM brand_inventory WHERE brand_name LIKE ? LIMIT 1', [`%${s}%`]);
  return rows2.length ? rows2[0].id : null;
}

// 项目编号 → 建议仓库
router.get('/project', async (req, res) => {
  try {
    const yfid = parseInt(req.query.year_frame_id, 10);
    const project_code = String(req.query.project_code || '').trim();
    if (!Number.isFinite(yfid) || !project_code) {
      return res.json({ activity_id: null, brand_id: null, suggested_warehouse_id: null, activity_region: null });
    }
    const [acts] = await db.query(
      'SELECT id, brand, region FROM activities WHERE year_frame_id = ? AND project_code = ? LIMIT 1',
      [yfid, project_code]
    );
    if (!acts.length) {
      return res.json({ activity_id: null, brand_id: null, suggested_warehouse_id: null, activity_region: null, message: '未找到匹配场次' });
    }
    const a = acts[0];
    const brand_id = await resolveBrandId(a.brand);
    const hr = hintRegionFromActivityRegion(a.region);
    let suggested_warehouse_id = null;
    if (brand_id && hr) {
      const [wh] = await db.query(
        'SELECT id FROM inv_warehouses WHERE brand_id = ? AND region = ? LIMIT 1',
        [brand_id, hr]
      );
      if (wh.length) suggested_warehouse_id = wh[0].id;
    }
    res.json({
      activity_id: a.id,
      brand_id,
      suggested_warehouse_id,
      activity_region: a.region,
      hint_region: hr,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '解析失败' });
  }
});

module.exports = router;
