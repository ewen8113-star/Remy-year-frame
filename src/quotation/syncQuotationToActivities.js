/**
 * 报价保存后同步到场次 quoted_price；加载场次/看板时从关联报价回填。
 */
const { mergeSessionWithTotals } = require('./multiSummaryItems');

function roundMoney(v) {
  return Math.round((parseFloat(v) || 0) * 100) / 100;
}

function parseLinkedSessions(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return [raw];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseMergedIdList(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map((x) => parseInt(x, 10)).filter(Number.isFinite);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map((x) => parseInt(x, 10)).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

async function loadSupersededQuoteIds(conn, yearFrameId) {
  const yfId = parseInt(yearFrameId, 10);
  const sql = Number.isFinite(yfId)
    ? `SELECT merged_from_quote_ids FROM quotations
       WHERE quote_mode = 'multi' AND merged_from_quote_ids IS NOT NULL AND year_frame_id = ?`
    : `SELECT merged_from_quote_ids FROM quotations
       WHERE quote_mode = 'multi' AND merged_from_quote_ids IS NOT NULL`;
  const [rows] = await conn.query(sql, Number.isFinite(yfId) ? [yfId] : []);
  const set = new Set();
  rows.forEach((row) => {
    parseMergedIdList(row.merged_from_quote_ids).forEach((id) => set.add(id));
  });
  return set;
}

/**
 * 将一条报价的金额写入关联场次。
 * 同一活动可有多张单场报价（如采购 + 执行），按 activity_id 汇总 total_amount。
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {{ quote_mode?: string, activity_id?: number|null, total_amount?: number, linked_sessions?: unknown, year_frame_id?: number }} quotation
 */
async function syncQuotationToActivities(conn, quotation) {
  if (!quotation) return;
  const mode = String(quotation.quote_mode || 'single').toLowerCase();

  if (mode === 'multi') {
    const sessions = parseLinkedSessions(quotation.linked_sessions);
    const byAct = new Set();
    sessions.forEach((raw) => {
      const aid = parseInt(raw.activity_id, 10);
      if (Number.isFinite(aid)) byAct.add(aid);
    });
    for (const aid of byAct) {
      const price = await resolveQuotedPriceForActivity(conn, aid);
      if (price == null) continue;
      await conn.query(
        'UPDATE activities SET quoted_price = ? WHERE id = ? AND COALESCE(is_virtual, 0) = 0',
        [price, aid]
      );
    }
    return;
  }

  const aid = parseInt(quotation.activity_id, 10);
  if (!Number.isFinite(aid)) return;
  const price = await resolveQuotedPriceForActivity(conn, aid);
  if (price == null) return;
  await conn.query(
    'UPDATE activities SET quoted_price = ? WHERE id = ? AND COALESCE(is_virtual, 0) = 0',
    [price, aid]
  );
}

/**
 * 查找某场次最新关联报价金额（优先合并报价；排除已被合并取代的单场报价）。
 */
async function resolveQuotedPriceForActivity(conn, activityId) {
  const aid = parseInt(activityId, 10);
  if (!Number.isFinite(aid)) return null;

  const [actRows] = await conn.query(
    'SELECT year_frame_id FROM activities WHERE id = ? AND COALESCE(is_virtual, 0) = 0',
    [aid]
  );
  if (!actRows.length) return null;
  const yfId = actRows[0].year_frame_id;
  const superseded = await loadSupersededQuoteIds(conn, yfId);

  let bestMulti = null;
  const [multiRows] = await conn.query(
    `SELECT linked_sessions, updated_at
     FROM quotations
     WHERE quote_mode = 'multi' AND linked_sessions IS NOT NULL AND year_frame_id = ?
       AND (
         linked_sessions LIKE CONCAT('%"activity_id":', ?, '%')
         OR linked_sessions LIKE CONCAT('%"activity_id": ', ?, '%')
       )
     ORDER BY updated_at DESC, id DESC
     LIMIT 20`,
    [yfId, aid, aid]
  );
  multiRows.forEach((row) => {
    const sessions = parseLinkedSessions(row.linked_sessions).filter((s) => Number(s.activity_id) === aid);
    if (!sessions.length) return;
    const price = roundMoney(
      sessions.reduce((sum, s) => sum + roundMoney(mergeSessionWithTotals(s).row_total), 0)
    );
    if (!bestMulti || new Date(row.updated_at) > new Date(bestMulti.updated_at)) {
      bestMulti = { price, updated_at: row.updated_at };
    }
  });

  const supersededList = [...superseded];
  let singleSql = `SELECT total_amount, updated_at
     FROM quotations
     WHERE activity_id = ? AND year_frame_id = ? AND COALESCE(quote_mode, 'single') <> 'multi'`;
  const singleParams = [aid, yfId];
  if (supersededList.length) {
    singleSql += ` AND id NOT IN (${supersededList.map(() => '?').join(',')})`;
    singleParams.push(...supersededList);
  }
  singleSql += ' ORDER BY updated_at DESC, id DESC';
  const [singleRows] = await conn.query(singleSql, singleParams);
  const singleSum = singleRows.length
    ? roundMoney(singleRows.reduce((s, row) => s + roundMoney(row.total_amount), 0))
    : null;
  const bestSingleUpdated = singleRows.length ? singleRows[0].updated_at : null;

  if (bestMulti && singleSum != null) {
    // 若存在覆盖该场次的合并报价，优先合并报价口径
    if (new Date(bestMulti.updated_at) >= new Date(bestSingleUpdated || 0)) return bestMulti.price;
    return singleSum;
  }
  if (bestMulti) return bestMulti.price;
  if (singleSum != null) return singleSum;
  return null;
}

/**
 * 若场次报价与关联报价不一致，写回 activities.quoted_price。
 */
async function ensureActivityQuotedPriceFromQuotations(conn, activityId) {
  const price = await resolveQuotedPriceForActivity(conn, activityId);
  if (price == null) return null;
  await conn.query(
    'UPDATE activities SET quoted_price = ? WHERE id = ? AND COALESCE(is_virtual, 0) = 0',
    [price, activityId]
  );
  return price;
}

/**
 * 按年框批量回填场次 quoted_price（数据看板收入口径依赖此字段）。
 */
async function syncYearFrameQuotedPricesFromQuotations(conn, yearFrameId) {
  const yfId = parseInt(yearFrameId, 10);
  if (!Number.isFinite(yfId)) return { updated: 0, total: 0 };
  const [acts] = await conn.query(
    'SELECT id FROM activities WHERE year_frame_id = ? AND COALESCE(is_virtual, 0) = 0',
    [yfId]
  );
  let updated = 0;
  for (const row of acts) {
    const price = await resolveQuotedPriceForActivity(conn, row.id);
    if (price == null) continue;
    const [ret] = await conn.query(
      `UPDATE activities SET quoted_price = ?
       WHERE id = ? AND COALESCE(is_virtual, 0) = 0
         AND (quoted_price IS NULL OR ABS(COALESCE(quoted_price, 0) - ?) > 0.009)`,
      [price, row.id, price]
    );
    if (ret.affectedRows) updated += 1;
  }
  return { updated, total: acts.length };
}

/**
 * 当前年框按场次去重的有效报价合计（与数据看板场次报价口径一致）。
 */
async function sumYearFrameEffectiveQuotedPrices(conn, yearFrameId) {
  const yfId = parseInt(yearFrameId, 10);
  if (!Number.isFinite(yfId)) {
    return { effectiveTotal: 0, quotedActivityCount: 0, activityCount: 0 };
  }
  const [acts] = await conn.query(
    'SELECT id FROM activities WHERE year_frame_id = ? AND COALESCE(is_virtual, 0) = 0',
    [yfId]
  );
  let effectiveTotal = 0;
  let quotedActivityCount = 0;
  for (const row of acts) {
    const price = await resolveQuotedPriceForActivity(conn, row.id);
    if (price == null || price <= 0) continue;
    effectiveTotal += price;
    quotedActivityCount += 1;
  }
  return {
    effectiveTotal: roundMoney(effectiveTotal),
    quotedActivityCount,
    activityCount: acts.length,
  };
}

/**
 * 场次 project_code 变更时，同步关联报价与成本登记的项目编号。
 */
async function syncQuotationProjectCodesFromActivity(conn, activityId, projectCode) {
  const aid = parseInt(activityId, 10);
  const pc = String(projectCode || '').trim();
  if (!Number.isFinite(aid) || !pc) return;
  await conn.query('UPDATE quotations SET project_code = ? WHERE activity_id = ?', [pc, aid]);
  await conn.query(
    'UPDATE reimbursements SET related_project_code = ? WHERE activity_id = ?',
    [pc, aid]
  );
}

module.exports = {
  syncQuotationToActivities,
  syncQuotationProjectCodesFromActivity,
  resolveQuotedPriceForActivity,
  ensureActivityQuotedPriceFromQuotations,
  syncYearFrameQuotedPricesFromQuotations,
  sumYearFrameEffectiveQuotedPrices,
};
