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
  // 报销/付款申请按年框归属统计，不按看板日期区间过滤（申请日期可能跨财年边界）
  const rbCoordWhere = [...rbWhere, "COALESCE(r.cost_module, 'activity') <> 'activity'"];
  const rbActivityWhere = [...rbWhere, "COALESCE(r.cost_module, 'activity') = 'activity'"];

  const [
    [whRows],
    [logRows],
    [mpRows],
    [prRows],
    [rbRows],
    [rbCoordRows],
    [rbActivityRows],
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
      `SELECT COALESCE(SUM(r.amount), 0) AS amount, COUNT(*) AS cnt
       FROM reimbursements r WHERE ${rbCoordWhere.join(' AND ')}`,
      rbParams
    ),
    db.query(
      `SELECT COALESCE(SUM(r.amount), 0) AS amount, COUNT(*) AS cnt
       FROM reimbursements r WHERE ${rbActivityWhere.join(' AND ')}`,
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
       FROM reimbursements r WHERE ${rbCoordWhere.join(' AND ')} AND r.date IS NOT NULL
       GROUP BY DATE_FORMAT(r.date, '%Y-%m')`,
      rbParams
    ),
  ]);

  const whAmount = round2(whRows[0]?.amount);
  const logAmount = round2(logRows[0]?.amount);
  const mpAmount = round2(mpRows[0]?.amount);
  const prAmount = round2(prRows[0]?.amount);
  const rbCoordAmount = round2(rbCoordRows[0]?.amount);
  const rbActivityAmount = round2(rbActivityRows[0]?.amount);
  const coordinatedAmount = round2(mpAmount + rbCoordAmount);
  const coordinatedCount = Number(mpRows[0]?.cnt || 0) + Number(rbCoordRows[0]?.cnt || 0);
  const actAmount = round2(activityCost);

  const buckets = [
    { key: 'activity', label: '场次成本', amount: actAmount, count: activityCount || 0, hint: '当前筛选场次合计' },
    { key: 'warehouse', label: '仓储成本', amount: whAmount, count: Number(whRows[0]?.cnt || 0), hint: '仓储登记，未重复计入场次' },
    { key: 'logistics', label: '物流成本', amount: logAmount, count: Number(logRows[0]?.cnt || 0), hint: '物流登记（含月结月份）' },
    {
      key: 'material_purchase',
      label: '统筹成本',
      amount: coordinatedAmount,
      count: coordinatedCount,
      hint: '直接登记 + 不计入活动的报销（统筹/内部/物料等）',
    },
    { key: 'prop_repair', label: '道具维修', amount: prAmount, count: Number(prRows[0]?.cnt || 0), hint: '道具维修登记' },
    {
      key: 'reimbursement',
      label: '报销成本池',
      amount: rbActivityAmount,
      count: Number(rbActivityRows[0]?.cnt || 0),
      hint: '付款申请/报销中计入活动成本的部分',
    },
  ];
  const rbAmount = round2(rbRows[0]?.amount);
  const totalPoolCost = round2(whAmount + logAmount + mpAmount + prAmount + rbAmount);
  const totalFullCost = round2(actAmount + totalPoolCost);

  const reimbModuleLabels = {
    activity: '报销·场次',
    warehouse: '报销·仓储',
    logistics: '报销·物流',
    prop_repair: '报销·道具维修',
    material_purchase: '报销·统筹物料',
    general: '报销·统筹/内部',
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

module.exports = {
  ALLOWED_TYPES,
  FISCAL_MONTH_LABELS,
  PG_COST_SQL,
  aggregateRegionRows,
  buildActivityFilters,
  buildActivityFinancialRows,
  buildCompareActivityFilters,
  buildWarehouseFilters,
  mapTrendRowsToActivityByMonth,
  queryFullCostBreakdown,
  queryWithoutPgFlags,
  ratio,
  round2,
};
