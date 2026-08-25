const db = require('../config/database');
const { applyEventTemplateItemDefaults } = require('./eventTemplateRows');
const { hydrateLinkedSessionsFeesFromItems } = require('./multiSummaryItems');
const {
  extractQuotationNosFromSessions,
  normalizeEventDate,
  parseJsonArray,
  parseLinkedSessions,
  resolveQuotationDisplayEventDate,
  roundMoney,
  roundQty,
  sortSingleQuotesByEventDateAsc,
  templateItemKey,
} = require('./routeUtils');

/** 模版行单价为 0 时，用 quotation_template_sections.default_unit_price 回填（只读展示/导出） */
async function enrichItemsWithTemplateDefaults(items) {
  if (!Array.isArray(items) || !items.length) return items;
  const [tplRows] = await db.query(
    `SELECT subsection_code, description, default_unit, default_unit_price
     FROM quotation_template_sections WHERE applicable_type = 'EVENT' AND is_active = 1`
  );
  const map = new Map();
  const bySub = new Map();
  tplRows.forEach((t) => {
    map.set(templateItemKey(t.subsection_code, t.description), t);
    if (!bySub.has(t.subsection_code)) bySub.set(t.subsection_code, t);
  });
  return items.map((it) => {
    if (Number(it.is_custom) === 1) return it;
    const price = parseFloat(it.unit_price);
    if (Number.isFinite(price) && price > 0) return it;
    const tpl =
      map.get(templateItemKey(it.subsection_code, it.description)) ||
      bySub.get(String(it.subsection_code || '').trim());
    if (!tpl) return it;
    const def = parseFloat(tpl.default_unit_price);
    if (!Number.isFinite(def) || def <= 0) return it;
    const qty = roundQty(it.quantity);
    return {
      ...it,
      unit: it.unit || tpl.default_unit || it.unit,
      unit_price: def,
      subtotal: roundMoney(qty * def),
    };
  });
}

async function loadQuotation(id) {
  const [heads] = await db.query(
    `SELECT q.*,
            COALESCE(q.project_code, act.project_code) AS activity_project_code,
            act.activity_type AS activity_type_name,
            act.brand AS activity_brand,
            act.date AS activity_date
     FROM quotations q
     LEFT JOIN activities act ON act.id = q.activity_id
     WHERE q.id = ?`,
    [id]
  );
  if (!heads.length) return null;
  const [items] = await db.query(
    'SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order ASC, id ASC',
    [id]
  );
  const head = heads[0];
  let linked_sessions = parseLinkedSessions(head.linked_sessions);
  if (String(head.quote_mode || '').toLowerCase() === 'multi') {
    linked_sessions = hydrateLinkedSessionsFeesFromItems(linked_sessions, items);
  }
  const syncedItems = applyEventTemplateItemDefaults(items);
  const enrichedItems = await enrichItemsWithTemplateDefaults(syncedItems);
  const eventDate = resolveQuotationDisplayEventDate(head);
  return {
    ...head,
    event_date: eventDate,
    quote_mode: head.quote_mode || 'single',
    linked_sessions,
    merged_from_quote_ids: parseJsonArray(head.merged_from_quote_ids),
    items: enrichedItems,
  };
}

async function loadQuotationsByIds(ids) {
  const out = [];
  for (const id of ids) {
    const q = await loadQuotation(id);
    if (q) out.push(q);
  }
  return out;
}

async function loadOrderedSingleQuotesByIds(ids) {
  const loaded = await loadQuotationsByIds(ids);
  const map = new Map();
  loaded.forEach((q) => {
    if (String(q.quote_mode || 'single') !== 'single') return;
    map.set(Number(q.id), q);
  });
  return ids.map((id) => map.get(Number(id))).filter(Boolean);
}

async function loadSingleQuotesByQuotationNos(qtNos) {
  const orderedNos = qtNos.map((n) => String(n || '').trim().toUpperCase()).filter(Boolean);
  const unique = [...new Set(orderedNos)];
  if (!unique.length) return [];
  const [rows] = await db.query(
    `SELECT id, quotation_no FROM quotations
     WHERE quotation_no IN (${unique.map(() => '?').join(',')}) AND quote_mode = 'single'`,
    unique
  );
  const idByNo = new Map(rows.map((r) => [String(r.quotation_no).toUpperCase(), Number(r.id)]));
  const orderedIds = orderedNos.map((no) => idByNo.get(no)).filter(Number.isFinite);
  if (!orderedIds.length) return [];
  return loadOrderedSingleQuotesByIds(orderedIds);
}

async function loadSingleQuotesForMultiQuote(multiQuote) {
  const mergedIds = parseJsonArray(multiQuote?.merged_from_quote_ids)
    .map((x) => parseInt(x, 10))
    .filter(Number.isFinite);
  if (mergedIds.length) {
    const ordered = await loadOrderedSingleQuotesByIds(mergedIds);
    if (ordered.length) return sortSingleQuotesByEventDateAsc(ordered);
  }
  const qtNos = extractQuotationNosFromSessions(multiQuote);
  if (qtNos.length) {
    const byNo = await loadSingleQuotesByQuotationNos(qtNos);
    if (byNo.length) return sortSingleQuotesByEventDateAsc(byNo);
  }
  const sessions = parseLinkedSessions(multiQuote?.linked_sessions);
  const orderedActivityIds = sessions
    .map((s) => parseInt(s.activity_id, 10))
    .filter(Number.isFinite);
  if (!orderedActivityIds.length) return [];
  const uniqueIds = [...new Set(orderedActivityIds)];
  const [rows] = await db.query(
    `SELECT id, activity_id
     FROM quotations
     WHERE quote_mode = 'single' AND year_frame_id = ? AND activity_id IN (${uniqueIds.map(() => '?').join(',')})
     ORDER BY id DESC`,
    [multiQuote.year_frame_id, ...uniqueIds]
  );
  const latestByActivity = new Map();
  rows.forEach((r) => {
    const aid = Number(r.activity_id);
    if (!latestByActivity.has(aid)) latestByActivity.set(aid, Number(r.id));
  });
  const orderedQuoteIds = orderedActivityIds
    .map((aid) => latestByActivity.get(Number(aid)))
    .filter(Number.isFinite);
  if (!orderedQuoteIds.length) return [];
  return sortSingleQuotesByEventDateAsc(await loadOrderedSingleQuotesByIds(orderedQuoteIds));
}

module.exports = {
  loadOrderedSingleQuotesByIds,
  loadQuotation,
  loadQuotationsByIds,
  loadSingleQuotesByQuotationNos,
  loadSingleQuotesForMultiQuote,
  normalizeEventDate,
};
