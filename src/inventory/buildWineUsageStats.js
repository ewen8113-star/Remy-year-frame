const { jsonYmd, parseActivityDateInput, parseMonthRangeForSql } = require('./formatters');
const {
  fetchWineLabelDimensionsLookup,
  fetchWineRegistryForUsageStats,
  normalizeVolumeDisplay,
  orderWinesForUsageStats,
  sqlAggNum,
  wineVolumeSpecFromRow,
} = require('./wineHelpers');

async function buildWineUsageStats(db, query) {
  const yfRaw = query.yearFrameId ?? query.year_frame_id;
  const yfId = parseInt(yfRaw, 10);
  if (!Number.isFinite(yfId)) {
    const err = new Error('请选择年度');
    err.status = 400;
    throw err;
  }
  /** 与字典 activity_region 取值一致（含西南区、东区-婚宴等），不用仓库 INV_REGIONS 白名单 */
  const region = String(query.region || '').trim() || null;
  const belonging = String(query.belonging || '').trim() || null;
  const projectRaw = String(query.project_code || query.q || query.search || '').trim();
  const projectTerms = projectRaw ? projectRaw.split(/\s+/).filter(Boolean) : [];
  const dateFrom = parseActivityDateInput(query.date_from || query.dateFrom);
  const dateTo = parseActivityDateInput(query.date_to || query.dateTo);
  const monthRange = parseMonthRangeForSql(query.month);

  let sql = `
    SELECT
      COALESCE(act1.id, act2.id) AS activity_id,
      COALESCE(act1.region, act2.region) AS region,
      COALESCE(NULLIF(TRIM(act1.project_code), ''), NULLIF(TRIM(act2.project_code), ''), NULLIF(TRIM(o.project_code), '')) AS project_code,
      COALESCE(act1.belonging, act2.belonging) AS belonging,
      COALESCE(o.activity_date, act1.date, act2.date) AS activity_date,
      COALESCE(NULLIF(TRIM(i.wine_label), ''), TRIM(i.name)) AS wine_label,
      MAX(NULLIF(TRIM(i.dimensions), '')) AS item_dimensions,
      SUM(ol.quantity) AS qty
    FROM inv_outbound_lines ol
    INNER JOIN inv_outbound_orders o ON o.id = ol.order_id
    INNER JOIN inv_items i ON i.id = ol.item_id AND i.is_wine = 1
    LEFT JOIN activities act1 ON act1.id = o.activity_id
    LEFT JOIN activities act2 ON act2.id IS NULL
      AND o.activity_id IS NULL
      AND TRIM(COALESCE(o.project_code, '')) <> ''
      AND act2.project_code = o.project_code
      AND act2.year_frame_id = ?
    WHERE COALESCE(act1.id, act2.id) IS NOT NULL
      AND COALESCE(act1.year_frame_id, act2.year_frame_id) = ?
  `;
  const params = [yfId, yfId];

  if (region) {
    sql += ' AND COALESCE(act1.region, act2.region) = ?';
    params.push(region);
  }
  if (belonging) {
    sql += ' AND COALESCE(act1.belonging, act2.belonging) = ?';
    params.push(belonging);
  }
  if (projectTerms.length) {
    const projExpr =
      'COALESCE(NULLIF(TRIM(act1.project_code), \'\'), NULLIF(TRIM(act2.project_code), \'\'), NULLIF(TRIM(o.project_code), \'\'))';
    projectTerms.forEach(() => {
      sql += ` AND ${projExpr} LIKE ?`;
    });
    projectTerms.forEach((term) => params.push(`%${term}%`));
  }
  if (dateFrom) {
    sql += ' AND COALESCE(o.activity_date, act1.date, act2.date) >= ?';
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += ' AND COALESCE(o.activity_date, act1.date, act2.date) <= ?';
    params.push(dateTo);
  }
  if (monthRange) {
    sql += ' AND COALESCE(o.activity_date, act1.date, act2.date) >= ? AND COALESCE(o.activity_date, act1.date, act2.date) < ?';
    params.push(monthRange[0].slice(0, 10), monthRange[1].slice(0, 10));
  }

  sql += `
    GROUP BY
      COALESCE(act1.id, act2.id),
      COALESCE(act1.region, act2.region),
      COALESCE(NULLIF(TRIM(act1.project_code), ''), NULLIF(TRIM(act2.project_code), ''), NULLIF(TRIM(o.project_code), '')),
      COALESCE(act1.belonging, act2.belonging),
      COALESCE(o.activity_date, act1.date, act2.date),
      COALESCE(NULLIF(TRIM(i.wine_label), ''), TRIM(i.name))
    ORDER BY activity_date DESC, project_code, wine_label
  `;

  const [[aggRows], dimByWineLabel, wineRegistry] = await Promise.all([
    db.query(sql, params),
    fetchWineLabelDimensionsLookup(db),
    fetchWineRegistryForUsageStats(db),
  ]);
  const wineMetaMap = new Map();
  const rowMap = new Map();

  for (const r of aggRows || []) {
    const wl = String(r.wine_label || '').trim() || '—';
    const qty = sqlAggNum(r.qty);
    if (!wineMetaMap.has(wl)) {
      wineMetaMap.set(wl, { total: 0, specQty: new Map(), sampleDimensions: null });
    }
    const wm = wineMetaMap.get(wl);
    wm.total += qty;
    const spec = wineVolumeSpecFromRow(r.item_dimensions, wl);
    if (spec) wm.specQty.set(spec, (wm.specQty.get(spec) || 0) + qty);
    if (!wm.sampleDimensions && r.item_dimensions) wm.sampleDimensions = r.item_dimensions;

    const actId = Number(r.activity_id);
    if (!rowMap.has(actId)) {
      rowMap.set(actId, {
        activity_id: actId,
        region: r.region || '—',
        project_code: String(r.project_code || '').trim() || '—',
        belonging: r.belonging || '—',
        activity_date: jsonYmd(r.activity_date),
        quantities: {},
      });
    }
    const row = rowMap.get(actId);
    row.quantities[wl] = (row.quantities[wl] || 0) + qty;
  }

  const wines = [...wineMetaMap.entries()]
    .map(([label, wm]) => {
      let dominantSpec = '';
      let bestQ = -1;
      wm.specQty.forEach((q, spec) => {
        if (q > bestQ) {
          bestQ = q;
          dominantSpec = spec;
        }
      });
      const dimsHint =
        dominantSpec ||
        wm.sampleDimensions ||
        dimByWineLabel.get(label) ||
        null;
      const volume =
        normalizeVolumeDisplay(wineVolumeSpecFromRow(dimsHint, label)) ||
        normalizeVolumeDisplay(dominantSpec) ||
        normalizeVolumeDisplay(wineVolumeSpecFromRow(dimByWineLabel.get(label), label)) ||
        null;
      return {
        label,
        displayName: label,
        volume,
        total: wm.total,
      };
    });

  const winesOrdered = orderWinesForUsageStats(wines, wineRegistry);

  const rows = [...rowMap.values()].sort((a, b) => {
    const da = a.activity_date || '';
    const db = b.activity_date || '';
    if (da !== db) return db.localeCompare(da);
    return String(a.project_code).localeCompare(String(b.project_code), 'zh');
  });

  return {
    filters: {
      year_frame_id: yfId,
      region,
      belonging,
      project_code: projectRaw || null,
      date_from: dateFrom,
      date_to: dateTo,
      month: monthRange ? String(query.month || '').trim() : null,
    },
    wines: winesOrdered,
    rows,
    summary: {
      session_count: rows.length,
      wine_kind_count: winesOrdered.filter((w) => w.total > 0).length,
      wine_column_count: winesOrdered.length,
      total_bottles: winesOrdered.reduce((s, w) => s + w.total, 0),
    },
  };
}

module.exports = { buildWineUsageStats };
