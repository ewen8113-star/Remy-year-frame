const express = require('express');
const router = express.Router();
const db = require('../config/database');

const ALLOWED_TYPES = ['晚宴', '品鉴', '培训', '纯设计'];
const FISCAL_MONTH_LABELS = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'];
const COST_DETAIL_KEYS = [
  'supervisor', 'pg', 'parttime', 'bartender', 'photo', 'cloud_album_edit', 'performance', 'makeup',
  'travel_supervisor', 'travel_company',
  'structure', 'av', 'print', 'spray',
  'floral', 'floral_design', 'payment', 'tasting', 'venue_fee', 'meal_fee', 'other_advance',
  'warehouse', 'express', 'logistics',
  'advance_offset',
];
const COST_BUCKET_KEYS = {
  logistics: ['warehouse', 'express', 'logistics'],
  personnel: ['supervisor', 'pg', 'parttime', 'bartender', 'photo', 'cloud_album_edit', 'performance', 'makeup', 'travel_supervisor', 'travel_company'],
  procurement: ['structure', 'av', 'print', 'spray', 'floral', 'floral_design', 'tasting', 'venue_fee', 'meal_fee', 'other_advance'],
  other: ['payment', 'advance_offset'],
};
/** cost_details JSON 中 PG 礼仪成本 > 0 */
const PG_COST_SQL = `COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(a.cost_details, '$.pg')) AS DECIMAL(18,4)), 0) > 0`;

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
  const where = ['a.activity_type IN (?, ?, ?, ?)', 'COALESCE(a.is_virtual, 0) = 0'];
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

  const pgFlags = parseCsv(query.pgFlags);
  if (pgFlags.length === 1) {
    if (pgFlags[0] === '有') {
      where.push(PG_COST_SQL);
    } else if (pgFlags[0] === '无') {
      where.push(`NOT (${PG_COST_SQL})`);
    }
  }

  return { whereClause: where.join(' AND '), params };
}

function queryWithoutPgFlags(query) {
  const q = Object.assign({}, query);
  delete q.pgFlags;
  return q;
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

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function ratio(numerator, denominator) {
  const den = Number(denominator || 0);
  if (den <= 0) return 0;
  return Number(numerator || 0) / den;
}

function parseCostDetails(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function sumKeys(obj, keys) {
  return round2((keys || []).reduce((s, key) => s + (parseFloat(obj[key]) || 0), 0));
}

function buildActivityFinancialRows(rows) {
  return (rows || []).map((r) => {
    const costDetails = parseCostDetails(r.cost_details);
    const logisticsCost = sumKeys(costDetails, COST_BUCKET_KEYS.logistics);
    const personnelCost = sumKeys(costDetails, COST_BUCKET_KEYS.personnel);
    const procurementCost = sumKeys(costDetails, COST_BUCKET_KEYS.procurement);
    const detailsKnown = COST_DETAIL_KEYS.some((k) => (parseFloat(costDetails[k]) || 0) > 0);
    const totalCost = round2(r.total_cost || 0);
    const baselineCost = round2(logisticsCost + personnelCost + procurementCost);
    // 总成本以库表 total_cost 为准；「其他」= 总成本 − 已拆分三类，避免漏计 payment / advance_offset 等
    const otherCost = detailsKnown ? round2(Math.max(0, totalCost - baselineCost)) : totalCost;
    const mergedTotalCost = totalCost;
    const revenue = round2(r.quoted_price || 0);
    const grossProfit = round2(revenue - mergedTotalCost);
    return {
      id: Number(r.id),
      projectCode: r.project_code || '',
      activityName: r.client_name || r.client || r.activity_type || '未命名活动',
      activityType: r.activity_type || '',
      date: r.date || null,
      period: r.period || '日常',
      region: r.region || '未分区',
      city: r.city || '未分城市',
      brand: r.brand || '',
      executor: r.executor || '',
      quotedPrice: revenue,
      logisticsCost,
      personnelCost,
      procurementCost,
      otherCost,
      totalCost: mergedTotalCost,
      grossProfit,
      grossMarginRate: ratio(grossProfit, revenue),
    };
  });
}

function aggregateRegionRows(rows, keyBuilder) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const key = keyBuilder(row);
    const cur = map.get(key) || { sessions: 0, revenue: 0, cost: 0 };
    cur.sessions += 1;
    cur.revenue = round2(cur.revenue + row.quotedPrice);
    cur.cost = round2(cur.cost + row.totalCost);
    map.set(key, cur);
  });
  return map;
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

/** 财年起始公历年（4 月 1 日所在年），优先从 dateStart 推断 */
function fiscalStartYearFromQuery(query) {
  const start = normalizeDateOnly(query.dateStart);
  if (start) {
    const y = parseInt(start.slice(0, 4), 10);
    const m = parseInt(start.slice(5, 7), 10);
    if (Number.isFinite(y) && Number.isFinite(m)) return m >= 4 ? y : y - 1;
  }
  const end = normalizeDateOnly(query.dateEnd);
  if (end) {
    const y = parseInt(end.slice(0, 4), 10);
    const m = parseInt(end.slice(5, 7), 10);
    if (Number.isFinite(y) && Number.isFinite(m)) return m >= 4 ? y : y - 1;
  }
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

/** 仓储 month(1-12) → YYYY-MM */
function warehouseMonthToYm(fiscalStartYear, monthNum) {
  const m = parseInt(monthNum, 10);
  if (!Number.isFinite(m) || m < 1 || m > 12) return '';
  const y = m >= 4 ? fiscalStartYear : fiscalStartYear + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function buildPoolBaseFilters(alias, query) {
  const prefix = alias ? `${alias}.` : '';
  const where = [`COALESCE(${prefix}merged_into_activity, 0) = 0`];
  const params = [];
  if (query.yearFrameId) {
    where.push(`${prefix}year_frame_id = ?`);
    params.push(parseInt(query.yearFrameId, 10));
  }
  return { where, params };
}

function pushPoolDateRange(where, params, column, query) {
  const start = normalizeDateOnly(query.dateStart);
  const end = normalizeDateOnly(query.dateEnd);
  if (start) {
    where.push(`${column} >= ?`);
    params.push(start);
  }
  if (end) {
    where.push(`${column} <= ?`);
    params.push(end);
  }
}

/** settlement_month 规范为 YYYY-MM，便于与财年月度区间比较 */
const LOGISTICS_SETTLEMENT_YM_SQL = `CONCAT(
  SUBSTRING_INDEX(TRIM(l.settlement_month), '-', 1),
  '-',
  LPAD(SUBSTRING_INDEX(TRIM(l.settlement_month), '-', -1), 2, '0')
)`;

function fiscalYmBoundsFromQuery(query) {
  const start = normalizeDateOnly(query.dateStart);
  const end = normalizeDateOnly(query.dateEnd);
  return {
    ymStart: start ? start.slice(0, 7) : '',
    ymEnd: end ? end.slice(0, 7) : '',
    dateStart: start,
    dateEnd: end,
  };
}

/** 物流：有发货日用发货日；月结/无发货日用 settlement_month */
function pushLogisticsDateRange(where, params, query) {
  const { ymStart, ymEnd, dateStart, dateEnd } = fiscalYmBoundsFromQuery(query);
  if (!dateStart && !dateEnd && !ymStart && !ymEnd) return;
  const parts = [];
  const p = [];
  if (dateStart && dateEnd) {
    parts.push('(l.shipping_date IS NOT NULL AND l.shipping_date >= ? AND l.shipping_date <= ?)');
    p.push(dateStart, dateEnd);
  } else if (dateStart) {
    parts.push('(l.shipping_date IS NOT NULL AND l.shipping_date >= ?)');
    p.push(dateStart);
  } else if (dateEnd) {
    parts.push('(l.shipping_date IS NOT NULL AND l.shipping_date <= ?)');
    p.push(dateEnd);
  }
  if (ymStart && ymEnd) {
    parts.push(`(
      (l.shipping_date IS NULL OR TRIM(COALESCE(l.shipping_date, '')) = '')
      AND l.settlement_month IS NOT NULL AND TRIM(l.settlement_month) <> ''
      AND ${LOGISTICS_SETTLEMENT_YM_SQL} >= ? AND ${LOGISTICS_SETTLEMENT_YM_SQL} <= ?
    )`);
    p.push(ymStart, ymEnd);
  }
  if (!parts.length) return;
  where.push(`(${parts.join(' OR ')})`);
  params.push(...p);
}

function pushPoolBrands(where, params, column, query) {
  const brands = parseCsv(query.brands);
  pushIn(where, params, column, brands);
}

function pushPoolRegions(where, params, column, query) {
  const regions = [...new Set(parseCsv(query.regions).map((r) => r.split('-')[0]))];
  pushIn(where, params, column, regions);
}

/** 全链路成本池（与成本管理口径一致：merged_into_activity=0 的公共池 + 场次 total_cost） */
async function queryFullCostBreakdown(query, activityCost, activityCount) {
  const fiscalStartYear = fiscalStartYearFromQuery(query);
  const whMonths = parseMonthRangeFromDates(query.dateStart, query.dateEnd);

  const whBase = buildPoolBaseFilters('w', query);
  const whWhere = [...whBase.where, 'COALESCE(w.no_actual_cost, 0) = 0'];
  const whParams = [...whBase.params];
  if (whMonths.length) {
    whWhere.push(`(
      w.month IS NULL OR TRIM(w.month) = ''
      OR CAST(w.month AS UNSIGNED) IN (${whMonths.map(() => '?').join(',')})
    )`);
    whParams.push(...whMonths);
  }
  pushPoolRegions(whWhere, whParams, 'w.region', query);
  pushPoolBrands(whWhere, whParams, 'w.brand', query);

  const logBase = buildPoolBaseFilters('l', query);
  const logWhere = [...logBase.where];
  const logParams = [...logBase.params];
  pushLogisticsDateRange(logWhere, logParams, query);
  pushPoolBrands(logWhere, logParams, 'l.brand', query);

  const mpBase = buildPoolBaseFilters('mp', query);
  const mpWhere = [...mpBase.where];
  const mpParams = [...mpBase.params];
  pushPoolDateRange(mpWhere, mpParams, 'mp.purchase_date', query);
  const mpBrands = parseCsv(query.brands);
  let mpJoin = '';
  if (mpBrands.length) {
    mpJoin = ' INNER JOIN brand_inventory bi ON bi.id = mp.brand_id ';
    mpWhere.push(`bi.brand_code IN (${mpBrands.map(() => '?').join(',')})`);
    mpParams.push(...mpBrands);
  }

  const prBase = buildPoolBaseFilters('pr', query);
  const prWhere = [...prBase.where, 'COALESCE(pr.no_cost, 0) = 0'];
  const prParams = [...prBase.params];
  pushPoolRegions(prWhere, prParams, 'pr.region', query);
  if (mpBrands.length) {
    prWhere.push(`pr.brand_id IN (SELECT id FROM brand_inventory WHERE brand_code IN (${mpBrands.map(() => '?').join(',')}))`);
    prParams.push(...mpBrands);
  }

  const rbBase = buildPoolBaseFilters('r', query);
  const rbWhere = [...rbBase.where];
  const rbParams = [...rbBase.params];

  const [
    [whRows],
    [logRows],
    [mpRows],
    [prRows],
    [rbRows],
    [rbModuleRows],
    [whMonthRows],
    [logMonthRows],
    [mpMonthRows],
    [prMonthRows],
    [rbMonthRows],
  ] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(w.actual_cost), 0) AS amount, COUNT(*) AS cnt
       FROM warehouse w WHERE ${whWhere.join(' AND ')}`,
      whParams
    ),
    db.query(
      `SELECT COALESCE(SUM(l.fee), 0) AS amount, COUNT(*) AS cnt
       FROM logistics l WHERE ${logWhere.join(' AND ')}`,
      logParams
    ),
    db.query(
      `SELECT COALESCE(SUM(mp.total_amount), 0) AS amount, COUNT(*) AS cnt
       FROM material_purchases mp ${mpJoin} WHERE ${mpWhere.join(' AND ')}`,
      mpParams
    ),
    db.query(
      `SELECT COALESCE(SUM(pr.total_amount), 0) AS amount, COUNT(*) AS cnt
       FROM prop_repairs pr WHERE ${prWhere.join(' AND ')}`,
      prParams
    ),
    db.query(
      `SELECT COALESCE(SUM(r.amount), 0) AS amount, COUNT(*) AS cnt
       FROM reimbursements r WHERE ${rbWhere.join(' AND ')}`,
      rbParams
    ),
    db.query(
      `SELECT COALESCE(r.cost_module, 'general') AS cost_module,
              COALESCE(SUM(r.amount), 0) AS amount, COUNT(*) AS cnt
       FROM reimbursements r WHERE ${rbWhere.join(' AND ')}
       GROUP BY COALESCE(r.cost_module, 'general')
       ORDER BY amount DESC`,
      rbParams
    ),
    db.query(
      `SELECT w.month AS m, COALESCE(SUM(w.actual_cost), 0) AS amount
       FROM warehouse w WHERE ${whWhere.join(' AND ')} AND w.month IS NOT NULL AND TRIM(w.month) <> ''
       GROUP BY w.month`,
      whParams
    ),
    db.query(
      `SELECT ym, COALESCE(SUM(fee), 0) AS amount FROM (
         SELECT l.fee,
           CASE
             WHEN l.shipping_date IS NOT NULL THEN DATE_FORMAT(l.shipping_date, '%Y-%m')
             WHEN l.settlement_month IS NOT NULL AND TRIM(l.settlement_month) <> '' THEN ${LOGISTICS_SETTLEMENT_YM_SQL}
             ELSE NULL
           END AS ym
         FROM logistics l WHERE ${logWhere.join(' AND ')}
       ) t WHERE ym IS NOT NULL GROUP BY ym`,
      logParams
    ),
    db.query(
      `SELECT DATE_FORMAT(mp.purchase_date, '%Y-%m') AS ym, COALESCE(SUM(mp.total_amount), 0) AS amount
       FROM material_purchases mp ${mpJoin} WHERE ${mpWhere.join(' AND ')} AND mp.purchase_date IS NOT NULL
       GROUP BY DATE_FORMAT(mp.purchase_date, '%Y-%m')`,
      mpParams
    ),
    db.query(
      `SELECT DATE_FORMAT(pr.repair_date, '%Y-%m') AS ym, COALESCE(SUM(pr.total_amount), 0) AS amount
       FROM prop_repairs pr WHERE ${prWhere.join(' AND ')} AND pr.repair_date IS NOT NULL
       GROUP BY DATE_FORMAT(pr.repair_date, '%Y-%m')`,
      prParams
    ),
    db.query(
      `SELECT DATE_FORMAT(r.date, '%Y-%m') AS ym, COALESCE(SUM(r.amount), 0) AS amount
       FROM reimbursements r WHERE ${rbWhere.join(' AND ')} AND r.date IS NOT NULL
       GROUP BY DATE_FORMAT(r.date, '%Y-%m')`,
      rbParams
    ),
  ]);

  const whAmount = round2(whRows[0]?.amount);
  const logAmount = round2(logRows[0]?.amount);
  const mpAmount = round2(mpRows[0]?.amount);
  const prAmount = round2(prRows[0]?.amount);
  const rbAmount = round2(rbRows[0]?.amount);
  const actAmount = round2(activityCost);

  const buckets = [
    { key: 'activity', label: '场次成本', amount: actAmount, count: activityCount || 0, hint: '当前筛选场次合计' },
    { key: 'warehouse', label: '仓储成本', amount: whAmount, count: Number(whRows[0]?.cnt || 0), hint: '仓储登记，未重复计入场次' },
    { key: 'logistics', label: '物流成本', amount: logAmount, count: Number(logRows[0]?.cnt || 0), hint: '物流登记（含月结月份）' },
    { key: 'material_purchase', label: '物料/额外成本', amount: mpAmount, count: Number(mpRows[0]?.cnt || 0), hint: '物料采购登记' },
    { key: 'prop_repair', label: '道具维修', amount: prAmount, count: Number(prRows[0]?.cnt || 0), hint: '道具维修登记' },
    { key: 'reimbursement', label: '报销成本池', amount: rbAmount, count: Number(rbRows[0]?.cnt || 0), hint: '付款申请/报销，按年框汇总' },
  ];
  const totalPoolCost = round2(whAmount + logAmount + mpAmount + prAmount + rbAmount);
  const totalFullCost = round2(actAmount + totalPoolCost);

  const reimbModuleLabels = {
    activity: '报销·场次',
    warehouse: '报销·仓储',
    logistics: '报销·物流',
    prop_repair: '报销·道具维修',
    material_purchase: '报销·物料',
    general: '报销·内部/统筹',
  };
  const reimbByModule = (rbModuleRows || []).map((row) => ({
    module: row.cost_module || 'general',
    label: reimbModuleLabels[row.cost_module] || `报销·${row.cost_module || '其他'}`,
    amount: round2(row.amount),
    count: Number(row.cnt || 0),
    ratio: 0,
  }));
  const rbTotalForRatio = reimbByModule.reduce((s, r) => s + r.amount, 0);
  reimbByModule.forEach((r) => {
    r.ratio = ratio(r.amount, rbTotalForRatio);
  });

  const poolMonthlyMap = new Map();
  const addPoolMonth = (ym, amount) => {
    if (!ym) return;
    poolMonthlyMap.set(ym, round2((poolMonthlyMap.get(ym) || 0) + (parseFloat(amount) || 0)));
  };
  (whMonthRows || []).forEach((row) => addPoolMonth(warehouseMonthToYm(fiscalStartYear, row.m), row.amount));
  (logMonthRows || []).forEach((row) => addPoolMonth(row.ym, row.amount));
  (mpMonthRows || []).forEach((row) => addPoolMonth(row.ym, row.amount));
  (prMonthRows || []).forEach((row) => addPoolMonth(row.ym, row.amount));
  (rbMonthRows || []).forEach((row) => addPoolMonth(row.ym, row.amount));

  return {
    buckets: buckets.map((b) => ({ ...b, ratio: ratio(b.amount, totalFullCost) })),
    reimbByModule,
    totalPoolCost,
    totalFullCost,
    poolMonthlyMap,
  };
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

// 获取数据看板（多维筛选联动）
router.get('/', async (req, res) => {
  try {
    const actFilter = buildActivityFilters(req.query);
    const pgCountFilter = buildActivityFilters(queryWithoutPgFlags(req.query));
    const [pgSessionRows] = await db.query(
      `SELECT COUNT(*) AS pg_sessions FROM activities a WHERE ${pgCountFilter.whereClause} AND ${PG_COST_SQL}`,
      pgCountFilter.params
    );
    const pgSessionsInScope = Number(pgSessionRows[0]?.pg_sessions || 0);
    const whFilter = buildWarehouseFilters(req.query);
    const [activityFinancialSourceRows] = await db.query(
      `SELECT
        a.id, a.project_code, a.activity_type, a.client_name, a.client, a.date, a.period,
        a.region, a.city, a.brand, a.executor,
        COALESCE(a.quoted_price, 0) AS quoted_price,
        COALESCE(a.total_cost, 0) AS total_cost,
        a.cost_details
       FROM activities a
       WHERE ${actFilter.whereClause}
       ORDER BY a.date DESC`,
      actFilter.params
    );
    const detailRows = buildActivityFinancialRows(activityFinancialSourceRows);

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
    const detailRevenue = round2(detailRows.reduce((s, r) => s + r.quotedPrice, 0));
    const detailCost = round2(detailRows.reduce((s, r) => s + r.totalCost, 0));
    const logisticsCost = round2(detailRows.reduce((s, r) => s + r.logisticsCost, 0));
    const personnelCost = round2(detailRows.reduce((s, r) => s + r.personnelCost, 0));
    const procurementCost = round2(detailRows.reduce((s, r) => s + r.procurementCost, 0));
    const otherCost = round2(detailRows.reduce((s, r) => s + r.otherCost, 0));
    const grossProfit = round2(detailRevenue - detailCost);

    const regionSummaryMap = aggregateRegionRows(detailRows, (row) => row.region);
    const regionSummary = [...regionSummaryMap.entries()]
      .map(([region, val]) => {
        const gp = round2(val.revenue - val.cost);
        return {
          region,
          sessions: val.sessions,
          revenue: round2(val.revenue),
          cost: round2(val.cost),
          grossProfit: gp,
          grossMarginRate: ratio(gp, val.revenue),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const regionCityMap = aggregateRegionRows(detailRows, (row) => `${row.region}__${row.city}`);
    const regionCityBreakdown = [...regionCityMap.entries()]
      .map(([key, val]) => {
        const [region, city] = key.split('__');
        const gp = round2(val.revenue - val.cost);
        return {
          region,
          city,
          sessions: val.sessions,
          revenue: round2(val.revenue),
          cost: round2(val.cost),
          grossProfit: gp,
          grossMarginRate: ratio(gp, val.revenue),
        };
      })
      .sort((a, b) => {
        if (a.region === b.region) return b.revenue - a.revenue;
        return String(a.region).localeCompare(String(b.region), 'zh-CN');
      });

    const monthlySummaryMap = new Map();
    detailRows.forEach((row) => {
      if (!row.date) return;
      const dt = new Date(row.date);
      if (Number.isNaN(dt.getTime())) return;
      const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      const cur = monthlySummaryMap.get(ym) || { sessions: 0, revenue: 0, cost: 0 };
      cur.sessions += 1;
      cur.revenue = round2(cur.revenue + row.quotedPrice);
      cur.cost = round2(cur.cost + row.totalCost);
      monthlySummaryMap.set(ym, cur);
    });
    const trendByMonth = [...monthlySummaryMap.entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([month, val]) => {
        const gp = round2(val.revenue - val.cost);
        return {
          month,
          sessions: val.sessions,
          revenue: round2(val.revenue),
          cost: round2(val.cost),
          grossProfit: gp,
          grossMarginRate: ratio(gp, val.revenue),
        };
      });

    const costCompositionRaw = [
      { costType: '物流成本', amount: logisticsCost },
      { costType: '人员成本', amount: personnelCost },
      { costType: '采购成本', amount: procurementCost },
      { costType: '其他成本', amount: otherCost },
    ];
    const costComposition = costCompositionRaw.map((item) => ({
      ...item,
      ratio: ratio(item.amount, detailCost),
    }));

    const fullCost = await queryFullCostBreakdown(req.query, detailCost, detailRows.length);
    const grossProfitFull = round2(detailRevenue - fullCost.totalFullCost);
    const trendByMonthFull = trendByMonth.map((row) => {
      const poolAdd = fullCost.poolMonthlyMap.get(row.month) || 0;
      const fullCostMonth = round2(row.cost + poolAdd);
      const gp = round2(row.revenue - fullCostMonth);
      return {
        ...row,
        activityCost: row.cost,
        poolCost: round2(poolAdd),
        cost: fullCostMonth,
        grossProfit: gp,
        grossMarginRate: ratio(gp, row.revenue),
      };
    });

    res.json({
      summary: {
        activityCount,
        activityRevenue,
        warehouseRevenue,
        totalRevenue: activityRevenue + warehouseRevenue + propRepairQuoted,
        propRepairQuoted,
        regionShare,
      },
      overview: {
        totalSessions: detailRows.length,
        pgSessions: pgSessionsInScope,
        totalRevenue: detailRevenue,
        activityCost: detailCost,
        poolCost: fullCost.totalPoolCost,
        totalCost: fullCost.totalFullCost,
        grossProfit: grossProfitFull,
        grossMarginRate: ratio(grossProfitFull, detailRevenue),
        /** @deprecated 与 activityCost 相同，保留兼容 */
        sessionOnlyCost: detailCost,
        sessionOnlyGrossProfit: grossProfit,
        sessionOnlyGrossMarginRate: ratio(grossProfit, detailRevenue),
      },
      metricDefinition: {
        revenue: '当前筛选场次的报价合计',
        cost: '场次成本 + 仓储 + 物流 + 物料 + 维修 + 报销（未重复计入场次的部分）',
        grossMarginRate: '毛利 = 收入 − 总成本；毛利率 = 毛利 ÷ 收入',
        activityCostDetail: '场次内按物流、人员、采购等分项汇总',
      },
      costBreakdown: fullCost.buckets,
      reimbCostByModule: fullCost.reimbByModule,
      regionSummary,
      trendByMonth,
      trendByMonthFull,
      costComposition,
      regionCityBreakdown,
      detailRows,
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
