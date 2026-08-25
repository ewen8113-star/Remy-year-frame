const db = require('../config/database');
const { syncYearFrameQuotedPricesFromQuotations } = require('../quotation/syncQuotationToActivities');
const {
  PG_COST_SQL,
  aggregateRegionRows,
  buildActivityFilters,
  buildActivityFinancialRows,
  buildCompareActivityFilters,
  buildWarehouseFilters,
  mapTrendRowsToActivityByMonth,
  normalizeDateOnly,
  parseCsv,
  queryFullCostBreakdown,
  queryWithoutPgFlags,
  ratio,
  round2,
} = require('./routeHelpers');

async function getDashboard(req, res) {
  try {
    if (req.query.yearFrameId) {
      await syncYearFrameQuotedPricesFromQuotations(db, parseInt(req.query.yearFrameId, 10));
    }
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
        revenue: '当前筛选场次的报价合计（来自活动报价模块同步至场次 quoted_price）',
        cost: '场次成本 + 仓储 + 物流 + 统筹 + 维修 + 报销（未重复计入场次的部分）',
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
}

module.exports = { getDashboard };
