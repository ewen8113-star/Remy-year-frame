const express = require('express');
const router = express.Router();
const db = require('../config/database');

const ALLOWED_TYPES = ['晚宴', '品鉴', '培训', '纯设计'];
const FISCAL_MONTH_LABELS = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'];

function parseCsv(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function pushIn(whereParts, params, column, values) {
  if (!values || !values.length) return;
  whereParts.push(`${column} IN (${values.map(() => '?').join(',')})`);
  params.push(...values);
}

function buildActivityFilters(query, opts = {}) {
  const where = ['a.activity_type IN (?, ?, ?, ?)'];
  const params = [...ALLOWED_TYPES];

  if (query.yearFrameId) {
    where.push('a.year_frame_id = ?');
    params.push(parseInt(query.yearFrameId, 10));
  }
  pushIn(where, params, 'a.brand', parseCsv(query.brands));
  if (!opts.ignoreRegions) {
    pushIn(where, params, 'a.region', parseCsv(query.regions));
  }
  pushIn(where, params, 'a.city', parseCsv(query.cities));
  pushIn(where, params, 'a.activity_type', parseCsv(query.activityTypes).filter((v) => ALLOWED_TYPES.includes(v)));
  pushIn(where, params, 'a.period', parseCsv(query.periods));

  const months = parseCsv(query.months).map((m) => parseInt(m, 10)).filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
  if (months.length) {
    where.push(`MONTH(a.date) IN (${months.map(() => '?').join(',')})`);
    params.push(...months);
  }

  const flags = parseCsv(query.executionFlags);
  if (flags.length === 1) {
    if (flags[0] === '有') {
      where.push("COALESCE(a.executor, '无') <> '无'");
    } else if (flags[0] === '无') {
      where.push("COALESCE(a.executor, '无') = '无'");
    }
  }

  return { whereClause: where.join(' AND '), params };
}

function buildWarehouseFilters(query) {
  const where = ['1=1'];
  const params = [];
  if (query.yearFrameId) {
    where.push('w.year_frame_id = ?');
    params.push(parseInt(query.yearFrameId, 10));
  }
  const months = parseCsv(query.months).map((m) => parseInt(m, 10)).filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
  if (months.length) {
    where.push(`w.month IN (${months.map(() => '?').join(',')})`);
    params.push(...months);
  }
  const regions = parseCsv(query.regions).map((r) => r.split('-')[0]);
  pushIn(where, params, 'w.region', [...new Set(regions)]);
  return { whereClause: where.join(' AND '), params };
}

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

// 获取数据看板（多维筛选联动）
router.get('/', async (req, res) => {
  try {
    const actFilter = buildActivityFilters(req.query);
    const whFilter = buildWarehouseFilters(req.query);

    const [summaryActivityRows] = await db.query(
      `SELECT COUNT(*) AS activity_count, COALESCE(SUM(a.quoted_price), 0) AS activity_revenue
       FROM activities a
       WHERE ${actFilter.whereClause}`,
      actFilter.params
    );

    const [summaryWarehouseRows] = await db.query(
      `SELECT COALESCE(SUM(w.quoted_price), 0) AS warehouse_revenue
       FROM warehouse w
       WHERE ${whFilter.whereClause}`,
      whFilter.params
    );

    const [activityByType] = await db.query(
      `SELECT a.activity_type, COUNT(*) AS count, COALESCE(SUM(a.quoted_price), 0) AS revenue
       FROM activities a
       WHERE ${actFilter.whereClause}
       GROUP BY a.activity_type
       ORDER BY count DESC`,
      actFilter.params
    );

    const [activityByBrand] = await db.query(
      `SELECT a.brand, COUNT(*) AS count, COALESCE(SUM(a.quoted_price), 0) AS revenue
       FROM activities a
       WHERE ${actFilter.whereClause}
       GROUP BY a.brand
       ORDER BY count DESC`,
      actFilter.params
    );

    const [activityByRegion] = await db.query(
      `SELECT a.region, COUNT(*) AS count, COALESCE(SUM(a.quoted_price), 0) AS revenue
       FROM activities a
       WHERE ${actFilter.whereClause}
       GROUP BY a.region
       ORDER BY count DESC`,
      actFilter.params
    );

    const [cityBreakdown] = await db.query(
      `SELECT a.region, a.city, COUNT(*) AS count, COALESCE(SUM(a.quoted_price), 0) AS revenue
       FROM activities a
       WHERE ${actFilter.whereClause}
       GROUP BY a.region, a.city
       ORDER BY a.region ASC, count DESC`,
      actFilter.params
    );

    const [trendRows] = await db.query(
      `SELECT
         CASE WHEN MONTH(a.date) >= 4 THEN MONTH(a.date) - 3 ELSE MONTH(a.date) + 9 END AS fiscal_month_index,
         MONTH(a.date) AS month_num,
         COUNT(*) AS count,
         COALESCE(SUM(a.quoted_price), 0) AS revenue
       FROM activities a
       WHERE ${actFilter.whereClause} AND a.date IS NOT NULL
       GROUP BY fiscal_month_index, month_num
       ORDER BY fiscal_month_index ASC`,
      actFilter.params
    );

    const trendMap = new Map(trendRows.map((r) => [Number(r.fiscal_month_index), r]));
    const activityByMonth = Array.from({ length: 12 }, (_, i) => {
      const idx = i + 1;
      const row = trendMap.get(idx);
      const monthNum = idx <= 9 ? idx + 3 : idx - 9;
      return {
        fiscalMonthIndex: idx,
        monthNum,
        monthLabel: FISCAL_MONTH_LABELS[i],
        count: row ? Number(row.count) : 0,
        revenue: row ? Number(row.revenue || 0) : 0,
      };
    });

    const [recentActivities] = await db.query(
      `SELECT a.*
       FROM activities a
       WHERE ${actFilter.whereClause}
       ORDER BY a.date DESC
       LIMIT 20`,
      actFilter.params
    );

    const selectedRegions = parseCsv(req.query.regions);
    let regionShare = null;
    if (selectedRegions.length === 1) {
      const noRegionFilter = buildActivityFilters(req.query, { ignoreRegions: true });
      const [nationalRows] = await db.query(
        `SELECT COUNT(*) AS c FROM activities a WHERE ${noRegionFilter.whereClause}`,
        noRegionFilter.params
      );
      const nationalCount = Number(nationalRows[0]?.c || 0);
      const regionCount = Number(summaryActivityRows[0]?.activity_count || 0);
      regionShare = {
        region: selectedRegions[0],
        regionCount,
        nationalCount,
        ratio: nationalCount > 0 ? regionCount / nationalCount : 0,
      };
    }

    const activityRevenue = Number(summaryActivityRows[0]?.activity_revenue || 0);
    const warehouseRevenue = Number(summaryWarehouseRows[0]?.warehouse_revenue || 0);
    const activityCount = Number(summaryActivityRows[0]?.activity_count || 0);

    res.json({
      summary: {
        activityCount,
        activityRevenue,
        warehouseRevenue,
        totalRevenue: activityRevenue + warehouseRevenue,
        regionShare,
      },
      activityByType,
      activityByBrand,
      activityByRegion,
      activityByMonth,
      cityBreakdown,
      recentActivities,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
