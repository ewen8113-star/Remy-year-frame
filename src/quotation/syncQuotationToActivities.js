/**
 * 报价保存后同步到场次 quoted_price；加载场次时从关联报价回填。
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

/**
 * 将一条报价的金额写入关联场次。
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {{ quote_mode?: string, activity_id?: number|null, total_amount?: number, linked_sessions?: unknown }} quotation
 */
async function syncQuotationToActivities(conn, quotation) {
  if (!quotation) return;
  const mode = String(quotation.quote_mode || 'single').toLowerCase();

  if (mode === 'multi') {
    const sessions = parseLinkedSessions(quotation.linked_sessions);
    for (const raw of sessions) {
      const aid = parseInt(raw.activity_id, 10);
      if (!Number.isFinite(aid)) continue;
      const row = mergeSessionWithTotals(raw);
      const price = roundMoney(row.row_total);
      await conn.query(
        'UPDATE activities SET quoted_price = ? WHERE id = ? AND COALESCE(is_virtual, 0) = 0',
        [price, aid]
      );
    }
    return;
  }

  const aid = parseInt(quotation.activity_id, 10);
  if (!Number.isFinite(aid)) return;
  const price = roundMoney(quotation.total_amount);
  await conn.query(
    'UPDATE activities SET quoted_price = ? WHERE id = ? AND COALESCE(is_virtual, 0) = 0',
    [price, aid]
  );
}

/**
 * 查找某场次最新关联报价金额（单场用 total_amount，多场用行合计）。
 */
async function resolveQuotedPriceForActivity(conn, activityId) {
  const aid = parseInt(activityId, 10);
  if (!Number.isFinite(aid)) return null;

  const [singleRows] = await conn.query(
    `SELECT total_amount, updated_at
     FROM quotations
     WHERE activity_id = ? AND COALESCE(quote_mode, 'single') <> 'multi'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [aid]
  );
  if (singleRows.length) {
    return roundMoney(singleRows[0].total_amount);
  }

  const [multiRows] = await conn.query(
    `SELECT linked_sessions, updated_at
     FROM quotations
     WHERE quote_mode = 'multi' AND linked_sessions IS NOT NULL
       AND (
         linked_sessions LIKE CONCAT('%"activity_id":', ?, '%')
         OR linked_sessions LIKE CONCAT('%"activity_id": ', ?, '%')
       )
     ORDER BY updated_at DESC, id DESC
     LIMIT 20`,
    [aid, aid]
  );
  for (const row of multiRows) {
    const sessions = parseLinkedSessions(row.linked_sessions);
    const hit = sessions.find((s) => Number(s.activity_id) === aid);
    if (hit) return roundMoney(mergeSessionWithTotals(hit).row_total);
  }
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

module.exports = {
  syncQuotationToActivities,
  resolveQuotedPriceForActivity,
  ensureActivityQuotedPriceFromQuotations,
};
