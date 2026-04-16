const express = require('express');
const router = express.Router();
const db = require('../config/database');

const ALLOWED_TYPES = ['晚宴', '品鉴', '培训', '纯设计'];
const FISCAL_MONTH_LABELS = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'];

function parseCsv(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
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

function normalizeDateOnly(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseMonthRangeFromDates(startRaw, endRaw) {
  const start = normalizeDateOnly(startRaw);
  const end = normalizeDateOnly(endRaw);
  if (!start && !end) return [];
  const startDt = start ? new Date(`${start}T00:00:00`) : null;
  const endDt = end ? new Date(`${end}T00:00:00`) : null;
  if (startDt && endDt && start > end) return [];
  const rangeStart = startDt || new Date((endDt || new Date()).getFullYear(), 0, 1);
  const rangeEnd = endDt || new Date((startDt || new Date()).getFullYear(), 11, 31);
  const months = new Set();
  const cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  const endMonth = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
  while (cur <= endMonth) {
    months.add(cur.getMonth() + 1);
    cur.setMonth(cur.getMonth() + 1);
  }
  return [...months];
}

function buildActivityFilters(query, opts = {}) {
  const where = ['a.activity_type IN (?, ?, ?, ?)'];
  const params = [...ALLOWED_TYPES];

  if (query.yearFrameId) {
    where.push('a.year_frame_id = ?');
    params.push(parseInt(query.yearFrameId, 10));
  }
  const dateStart = normalizeDateOnly(query.dateStart);
  const dateEnd = normalizeDateOnly(query.dateEnd);
  if (dateStart) {
    where.push('a.date >= ?');
    params.push(dateStart);
  }
  if (dateEnd) {
    where.push('a.date <= ?');
    params.push(dateEnd);
  }
  pushIn(where, params, 'a.brand', parseCsv(query.brands));
  if (!opts.ignoreRegions) {
    pushIn(where, params, 'a.region', parseCsv(query.regions));
  }
  pushIn(where, params, 'a.city', parseCsv(query.cities));
  pushIn(where, params, 'a.activity_type', parseCsv(query.activityTypes).filter((v) => ALLOWED_TYPES.includes(v)));
  pushIn(where, params, 'a.period', parseCsv(query.periods));

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

/** 右侧对比区域：全国 = 去掉区域条件；否则仅替换为指定区域，其余与主查询一致 */
function buildCompareActivityFilters(query, compareRegionParam) {
  if (!compareRegionParam) return null;
  if (compareRegionParam === '全国') {
    return buildActivityFilters(query, { ignoreRegions: true });
  }
  const q = Object.assign({}, query);
  q.regions = compareRegionParam;
  return buildActivityFilters(q);
}

function mapTrendRowsToActivityByMonth(trendRows) {
  const trendMap = new Map(trendRows.map((r) => [Number(r.fiscal_month_index), r]));
  return Array.from({ length: 12 }, (_, i) => {
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
}

function buildWarehouseFilters(query) {
  const where = ['1=1'];
  const params = [];
  if (query.yearFrameId) {
    where.push('w.year_frame_id = ?');
    params.push(parseInt(query.yearFrameId, 10));
  }
  const months = parseMonthRangeFromDates(query.dateStart, query.dateEnd);
  if (months.length) {
    where.push(`(
      w.month IS NULL OR TRIM(w.month) = ''
      OR CAST(w.month AS UNSIGNED) IN (${months.map(() => '?').join(',')})
    )`);
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
    const [summaryPropRepairRows] = await db.query(
      `SELECT COALESCE(SUM(pr.quoted_price), 0) AS prop_repair_quoted
       FROM prop_repairs pr
       WHERE 1=1
         ${req.query.yearFrameId ? ' AND pr.year_frame_id = ?' : ''}
         ${normalizeDateOnly(req.query.dateStart) ? ' AND pr.repair_date >= ?' : ''}
         ${normalizeDateOnly(req.query.dateEnd) ? ' AND pr.repair_date <= ?' : ''}`,
      [
        ...(req.query.yearFrameId ? [parseInt(req.query.yearFrameId, 10)] : []),
        ...(normalizeDateOnly(req.query.dateStart) ? [normalizeDateOnly(req.query.dateStart)] : []),
        ...(normalizeDateOnly(req.query.dateEnd) ? [normalizeDateOnly(req.query.dateEnd)] : []),
      ]
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

    const activityByMonth = mapTrendRowsToActivityByMonth(trendRows);

    const [recentActivities] = await db.query(
      `SELECT a.*
       FROM activities a
       WHERE ${actFilter.whereClause}
       ORDER BY a.date DESC
       LIMIT 20`,
      actFilter.params
    );

    const selectedRegions = parseCsv(req.query.regions);
    const compareRegionParam = String(req.query.compareRegion || '').trim();
    const primaryTotalCount = Number(summaryActivityRows[0]?.activity_count || 0);
    const primaryLabel =
      selectedRegions.length === 1 ? selectedRegions[0] : selectedRegions.length > 1 ? '多区域' : '当前筛选';

    let regionShare = null;
    let regionNationalCompare = null;

    if (compareRegionParam) {
      let compareFilter = buildCompareActivityFilters(req.query, compareRegionParam);
      /** 左侧仅一个区域且与右侧对比区域相同时，与主查询共用同一套 WHERE，保证两侧计数与序列一致 */
      const selectedRegionSet = new Set(selectedRegions);
      const compareIsSameSingleRegionAsPrimary =
        compareRegionParam !== '全国' &&
        selectedRegionSet.size === 1 &&
        selectedRegionSet.has(compareRegionParam);
      if (compareFilter && compareIsSameSingleRegionAsPrimary) {
        compareFilter = {
          whereClause: actFilter.whereClause,
          params: actFilter.params.slice(),
        };
      }
      if (compareFilter) {
        const [compareSummaryRows] = await db.query(
          `SELECT COUNT(*) AS activity_count FROM activities a WHERE ${compareFilter.whereClause}`,
          compareFilter.params
        );
        const compareTotalCount = Number(compareSummaryRows[0]?.activity_count || 0);

        const [nationalTrendRows] = await db.query(
          `SELECT
             CASE WHEN MONTH(a.date) >= 4 THEN MONTH(a.date) - 3 ELSE MONTH(a.date) + 9 END AS fiscal_month_index,
             MONTH(a.date) AS month_num,
             COUNT(*) AS count,
             COALESCE(SUM(a.quoted_price), 0) AS revenue
           FROM activities a
           WHERE ${compareFilter.whereClause} AND a.date IS NOT NULL
           GROUP BY fiscal_month_index, month_num
           ORDER BY fiscal_month_index ASC`,
          compareFilter.params
        );
        const nationalActivityByMonth = mapTrendRowsToActivityByMonth(nationalTrendRows);

        const [nationalActivityByType] = await db.query(
          `SELECT a.activity_type, COUNT(*) AS count, COALESCE(SUM(a.quoted_price), 0) AS revenue
           FROM activities a
           WHERE ${compareFilter.whereClause}
           GROUP BY a.activity_type
           ORDER BY count DESC`,
          compareFilter.params
        );

        const [nationalActivityByBrand] = await db.query(
          `SELECT a.brand, COUNT(*) AS count, COALESCE(SUM(a.quoted_price), 0) AS revenue
           FROM activities a
           WHERE ${compareFilter.whereClause}
           GROUP BY a.brand
           ORDER BY count DESC`,
          compareFilter.params
        );

        const [nationalActivityByRegion] = await db.query(
          `SELECT a.region, COUNT(*) AS count, COALESCE(SUM(a.quoted_price), 0) AS revenue
           FROM activities a
           WHERE ${compareFilter.whereClause}
           GROUP BY a.region
           ORDER BY count DESC`,
          compareFilter.params
        );

        const compareLabel = compareRegionParam === '全国' ? '全国（同筛选）' : compareRegionParam;
        const compareMode = compareRegionParam === '全国' ? 'national' : 'regional';

        regionNationalCompare = {
          region: primaryLabel,
          compareLabel,
          compareMode,
          primaryTotalCount,
          compareTotalCount,
          nationalActivityByMonth,
          nationalActivityByType,
          nationalActivityByBrand,
          nationalActivityByRegion,
        };

        regionShare = {
          region: primaryLabel,
          primaryLabel,
          compareTarget: compareRegionParam,
          compareLabel,
          regionCount: primaryTotalCount,
          compareCount: compareTotalCount,
          ratio: compareTotalCount > 0 ? primaryTotalCount / compareTotalCount : 0,
          nationalActivityByMonth: compareRegionParam === '全国' ? nationalActivityByMonth : undefined,
          nationalActivityByType: compareRegionParam === '全国' ? nationalActivityByType : undefined,
          nationalActivityByBrand: compareRegionParam === '全国' ? nationalActivityByBrand : undefined,
          nationalActivityByRegion: compareRegionParam === '全国' ? nationalActivityByRegion : undefined,
        };
      }
    }

    const activityRevenue = Number(summaryActivityRows[0]?.activity_revenue || 0);
    const warehouseRevenue = Number(summaryWarehouseRows[0]?.warehouse_revenue || 0);
    const propRepairQuoted = Number(summaryPropRepairRows[0]?.prop_repair_quoted || 0);
    const activityCount = Number(summaryActivityRows[0]?.activity_count || 0);

    res.json({
      summary: {
        activityCount,
        activityRevenue,
        warehouseRevenue,
        totalRevenue: activityRevenue + warehouseRevenue + propRepairQuoted,
        propRepairQuoted,
        regionShare,
      },
      activityByType,
      activityByBrand,
      activityByRegion,
      activityByMonth,
      cityBreakdown,
      recentActivities,
      regionNationalCompare,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
