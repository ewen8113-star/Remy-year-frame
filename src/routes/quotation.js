const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { ensureQuotationTables } = require('../quotation/ensureQuotationTables');
const { applyEventTemplateItemDefaults } = require('../quotation/eventTemplateRows');
const { normalizeItemCategory } = require('../quotation/quotationItemCategories');
const { streamQuotationPdf, streamBundledQuotationPdf } = require('../quotation/buildQuotationPdf');
const {
  streamQuotationExcel,
  streamBundledQuotationExcel,
  streamBundledQuotationExcelWithLayout,
} = require('../quotation/buildQuotationExcel');
const {
  buildMultiSummaryItems,
  mergeSessionWithTotals,
  calcMultiGrandTotals,
  buildQuotationItemsFromMultiSessions,
} = require('../quotation/multiSummaryItems');
const { formatDateTimeMinute } = require('../lib/businessTime');
const { syncQuotationToActivities } = require('../quotation/syncQuotationToActivities');

const STATUSES = ['draft', 'submitted', 'approved', 'rejected'];

/** 从场次 executor + activity_type 推导报价 event_type */
function deriveEventTypeFromActivity(act) {
  if (!act) return null;
  const ex = String(act.executor || '').trim();
  const execution = ex === '无' || !ex ? '无' : '有';
  const kind = String(act.activity_type || '').trim() || '晚宴';
  return `${execution}执行${kind}`;
}

router.use(async (req, res, next) => {
  try {
    await ensureQuotationTables(db);
    next();
  } catch (e) {
    res.status(500).json({ error: e.message || '报价表初始化失败' });
  }
});

function roundMoney(v) {
  return Math.round((parseFloat(v) || 0) * 100) / 100;
}

function roundQty(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
}

function normalizeItemRow(raw, sortOrder = 0) {
  const qty = roundQty(raw.quantity);
  const price = roundQty(raw.unit_price);
  return {
    section_code: String(raw.section_code || '').trim(),
    section_name: String(raw.section_name || '').trim(),
    subsection_code: String(raw.subsection_code || '').trim(),
    subsection_name: String(raw.subsection_name || '').trim(),
    description: String(raw.description || '').trim(),
    item_category: normalizeItemCategory(raw.item_category),
    quantity: qty,
    unit: raw.unit != null ? String(raw.unit).trim() : '',
    unit_price: price,
    subtotal: roundMoney(qty * price),
    remarks: raw.remarks != null ? String(raw.remarks).trim() : null,
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : sortOrder,
    is_custom: raw.is_custom ? 1 : 0,
    is_template: raw.is_template === false || raw.is_custom ? 0 : 1,
  };
}

function defaultServiceRate(raw, quoteMode) {
  if (String(quoteMode || '').toLowerCase() === 'multi') return 0.1;
  const n = parseFloat(raw);
  if (Number.isFinite(n) && n >= 0.1 && n <= 0.15) return n;
  return 0.1;
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

function parseJsonArray(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw;
  if (Buffer.isBuffer(raw)) {
    try {
      const parsed = JSON.parse(raw.toString('utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeLinkedSessionRow(raw, sortOrder = 0) {
  const activityId = parseInt(raw.activity_id, 10);
  const base = {
    activity_id: Number.isFinite(activityId) ? activityId : null,
    project_code: String(raw.project_code || '').trim(),
    event_date: normalizeEventDate(raw.event_date),
    city: raw.city != null ? String(raw.city).trim() : '',
    customer_name: raw.customer_name != null ? String(raw.customer_name).trim() : '',
    event_type: raw.event_type != null ? String(raw.event_type).trim() : '',
    remarks: raw.remarks != null ? String(raw.remarks).trim() : '',
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : sortOrder,
  };
  return mergeSessionWithTotals({ ...raw, ...base });
}

async function resolveLinkedSessions(conn, sessions, yearFrameIdHint) {
  const rows = (sessions || []).map((s, i) => normalizeLinkedSessionRow(s, i));
  if (!rows.length) return { error: '请至少关联一场活动（项目编号）', status: 400 };

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.activity_id) {
      return { error: `第 ${i + 1} 行：请选择关联项目编号`, status: 400 };
    }
    const linked = await resolveLinkedActivity(conn, row.activity_id, yearFrameIdHint);
    if (linked.error) return { error: `第 ${i + 1} 行：${linked.error}`, status: linked.status || 400 };
    const { activity: act, projectCode } = linked;
    const incoming = (sessions || [])[i] || {};
    out.push(
      mergeSessionWithTotals({
        ...incoming,
        activity_id: act.id,
        project_code: projectCode,
        event_date: row.event_date || normalizeEventDate(act.activity_date),
        city: row.city || act.city || '',
        customer_name: row.customer_name || act.client_name || '',
        event_type: row.event_type || act.activity_type || '',
        remarks: row.remarks || (act.remarks != null ? String(act.remarks).trim() : ''),
        sort_order: i,
      })
    );
  }
  return { sessions: out };
}

/** 写入 quotations.project_code：单场用完整编号，多场用首条+场次数（避免 VARCHAR 超长） */
function projectCodesSummary(sessions) {
  const codes = (sessions || []).map((s) => String(s.project_code || '').trim()).filter(Boolean);
  if (!codes.length) return null;
  if (codes.length === 1) return codes[0];
  const first = codes[0];
  const suffix = ` 等${codes.length}场`;
  const maxLen = 480;
  if (first.length + suffix.length <= maxLen) return first + suffix;
  return first.slice(0, Math.max(1, maxLen - suffix.length)) + suffix;
}

const { toCalendarDateYmd } = require('../quotation/calendarDate');
const { renumberEventQuotationSections } = require('../quotation/quotationCodes');

function normalizeEventDate(raw) {
  const ymd = toCalendarDateYmd(raw);
  return ymd || null;
}

/** 单场报价展示/保存：有关联场次时以 activities.date 为准 */
function resolveQuotationDisplayEventDate(row) {
  const fromActivity = normalizeEventDate(row?.activity_date);
  const fromQuote = normalizeEventDate(row?.event_date);
  const aid = parseInt(row?.activity_id, 10);
  if (Number.isFinite(aid) && fromActivity) return fromActivity;
  return fromQuote || fromActivity || null;
}

/** 合并预览/导出：各场次 Sheet 按活动日期从早到晚（无日期排最后） */
function sortSingleQuotesByEventDateAsc(quotes) {
  return (quotes || []).slice().sort((a, b) => {
    const da = normalizeEventDate(a?.event_date) || '';
    const db = normalizeEventDate(b?.event_date) || '';
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    }
    return (Number(a?.id) || 0) - (Number(b?.id) || 0);
  });
}

async function resolveLinkedActivity(conn, activityId, yearFrameIdHint) {
  const aid = parseInt(activityId, 10);
  if (!Number.isFinite(aid)) return { error: '请选择关联场次（项目编号）', status: 400 };
  const [acts] = await conn.query(
    `SELECT id, year_frame_id, project_code, city, client_name, remarks, date AS activity_date, activity_type, brand
     FROM activities WHERE id = ? AND COALESCE(is_virtual, 0) = 0 LIMIT 1`,
    [aid]
  );
  if (!acts.length) return { error: '关联场次不存在或不可用', status: 404 };
  const act = acts[0];
  const pc = String(act.project_code || '').trim();
  if (!pc) return { error: '该场次未填写项目编号，请先在场次记录中补全', status: 400 };
  if (yearFrameIdHint != null && Number(act.year_frame_id) !== Number(yearFrameIdHint)) {
    return { error: '关联场次与当前财年不一致，请切换左侧财年或重新选择场次', status: 400 };
  }
  return { activity: act, projectCode: pc };
}

function calcTotalsFromItems(items, serviceRate, taxRate) {
  const subtotalExTax = roundMoney(
    (items || []).reduce((s, it) => s + (Number(it.subtotal) || roundMoney((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))), 0)
  );
  const sr = Math.min(0.15, Math.max(0.1, defaultServiceRate(serviceRate)));
  const tr = parseFloat(taxRate) || 0.06;
  const serviceCharge = roundMoney(subtotalExTax * sr);
  const taxAmount = roundMoney((subtotalExTax + serviceCharge) * tr);
  const totalAmount = roundMoney(subtotalExTax + serviceCharge + taxAmount);
  return { subtotalExTax, serviceCharge, taxAmount, totalAmount, serviceRate: sr, taxRate: tr };
}

async function generateQuotationNo(conn) {
  const bj = formatDateTimeMinute(new Date()) || '';
  const ymd = bj.slice(0, 10).replace(/-/g, '') || '00000000';
  const prefix = `QT-${ymd}`;
  const [rows] = await conn.query(
    'SELECT quotation_no FROM quotations WHERE quotation_no LIKE ? ORDER BY id DESC LIMIT 1',
    [`${prefix}-%`]
  );
  let seq = 1;
  if (rows.length) {
    const m = String(rows[0].quotation_no).match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

function templateItemKey(subsectionCode, description) {
  return `${String(subsectionCode || '').trim()}|${String(description || '').trim()}`;
}

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
  const linked_sessions = parseLinkedSessions(head.linked_sessions);
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

function extractQuotationNosFromSessions(row) {
  const sessions = parseLinkedSessions(row?.linked_sessions);
  const nos = [];
  sessions.forEach((s) => {
    const r = String(s?.remarks || '');
    const m = r.match(/(?:来自报价\s*)?(QT-\d{8}-\d{3})/i);
    if (m && m[1]) nos.push(String(m[1]).toUpperCase());
  });
  return nos;
}

function hasMergedSourceHints(row) {
  if (extractQuotationNosFromSessions(row).length > 0) return true;
  return parseLinkedSessions(row?.linked_sessions).some((s) => /来自报价/.test(String(s?.remarks || '')));
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

function isMergedExportQuote(row) {
  const mergedFromIds = parseJsonArray(row?.merged_from_quote_ids);
  if (mergedFromIds.length > 0) return true;
  if (hasMergedSourceHints(row)) return true;
  const name = String(row?.project_name || '').trim();
  return /合并/.test(name) || /等\s*\d+\s*场/.test(name);
}

function shouldTreatAsMergedBundle(row, mergedFromIds, singleQuotes) {
  if (!isMergedExportQuote(row)) return false;
  return Array.isArray(singleQuotes) && singleQuotes.length > 0;
}

router.get('/template-sections', async (req, res) => {
  try {
    const type = String(req.query.type || 'EVENT').toUpperCase();
    const [rows] = await db.query(
      `SELECT * FROM quotation_template_sections
       WHERE applicable_type = ? AND is_active = 1
       ORDER BY sort_order ASC, id ASC`,
      [type]
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message || '加载模版失败' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { yearFrameId, type, status, q } = req.query;
    let sql = `SELECT q.id, q.quotation_no, q.type, q.quote_mode, q.year_frame_id, q.activity_id,
      COALESCE(q.project_code, act.project_code) AS project_code,
      q.linked_sessions,
      q.project_name, q.client_brand, q.city, q.customer_name, q.event_date, q.event_type,
      q.total_amount, q.status, q.created_at, q.updated_at,
      act.activity_type AS activity_type_name,
      act.date AS activity_date
      FROM quotations q
      LEFT JOIN activities act ON act.id = q.activity_id
      WHERE 1=1`;
    const params = [];
    if (yearFrameId) {
      sql += ' AND q.year_frame_id = ?';
      params.push(parseInt(yearFrameId, 10));
    }
    if (type) {
      sql += ' AND q.type = ?';
      params.push(String(type).toUpperCase());
    }
    if (status) {
      sql += ' AND q.status = ?';
      params.push(String(status).toLowerCase());
    }
    if (q) {
      const like = `%${String(q).trim()}%`;
      sql += ` AND (q.quotation_no LIKE ? OR q.project_name LIKE ? OR q.customer_name LIKE ?
        OR q.city LIKE ? OR q.project_code LIKE ? OR act.project_code LIKE ?)`;
      params.push(like, like, like, like, like, like);
    }
    sql += ' ORDER BY q.id DESC';
    const [rows] = await db.query(sql, params);
    const normalized = rows.map((r) => ({
      ...r,
      quote_mode: r.quote_mode || 'single',
      linked_sessions: parseLinkedSessions(r.linked_sessions).map((s) => ({
        ...s,
        event_date: normalizeEventDate(s.event_date),
      })),
      event_date: resolveQuotationDisplayEventDate(r),
    }));
    // 隐藏已被多场报价覆盖的单场报价，避免列表重复展示
    const mergedActivityIds = new Set();
    normalized.forEach((r) => {
      if (String(r.quote_mode) !== 'multi') return;
      (r.linked_sessions || []).forEach((s) => {
        const aid = parseInt(s.activity_id, 10);
        if (Number.isFinite(aid)) mergedActivityIds.add(aid);
      });
    });
    const data = normalized.filter((r) => {
      if (String(r.quote_mode) === 'multi') return true;
      const aid = parseInt(r.activity_id, 10);
      if (!Number.isFinite(aid)) return true;
      return !mergedActivityIds.has(aid);
    });
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message || '列表加载失败' });
  }
});

router.post('/:id/export-pdf', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    const layoutByQuoteId =
      req.body?.layoutByQuoteId && typeof req.body.layoutByQuoteId === 'object'
        ? req.body.layoutByQuoteId
        : {};
    const pageOrientation =
      String(req.body?.pageOrientation || 'landscape').toLowerCase() === 'portrait'
        ? 'portrait'
        : 'landscape';
    if (String(row.quote_mode || 'single') === 'multi') {
      const mergedFromIds = parseJsonArray(row.merged_from_quote_ids);
      const singles = await loadSingleQuotesForMultiQuote(row);
      if (shouldTreatAsMergedBundle(row, mergedFromIds, singles) && singles.length) {
        await streamBundledQuotationPdf(res, row, singles, { layoutByQuoteId, pageOrientation });
        return;
      }
    }
    await streamQuotationPdf(res, row);
  } catch (e) {
    console.error('报价 PDF（自定义版式）导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'PDF 导出失败' });
  }
});

router.post('/:id/export-excel', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    const layoutByQuoteId =
      req.body?.layoutByQuoteId && typeof req.body.layoutByQuoteId === 'object'
        ? req.body.layoutByQuoteId
        : {};
    if (String(row.quote_mode || 'single') === 'multi') {
      const mergedFromIds = parseJsonArray(row.merged_from_quote_ids);
      const singles = await loadSingleQuotesForMultiQuote(row);
      if (shouldTreatAsMergedBundle(row, mergedFromIds, singles) && singles.length) {
        const baseName = `${row.project_name || row.quotation_no || '报价'}-summary`;
        await streamBundledQuotationExcelWithLayout(res, singles, baseName, layoutByQuoteId);
        return;
      }
    }
    await streamQuotationExcel(res, row);
  } catch (e) {
    console.error('报价 Excel（自定义版式）导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'Excel 导出失败' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    if (String(row.quote_mode || 'single') === 'multi') {
      const mergedFromIds = parseJsonArray(row.merged_from_quote_ids);
      const singles = await loadSingleQuotesForMultiQuote(row);
      if (shouldTreatAsMergedBundle(row, mergedFromIds, singles) && singles.length) {
        await streamBundledQuotationPdf(res, row, singles);
        return;
      }
    }
    await streamQuotationPdf(res, row);
  } catch (e) {
    console.error('报价 PDF 导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'PDF 导出失败' });
  }
});

router.get('/:id/excel', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    if (String(row.quote_mode || 'single') === 'multi') {
      const mergedFromIds = parseJsonArray(row.merged_from_quote_ids);
      const singles = await loadSingleQuotesForMultiQuote(row);
      if (shouldTreatAsMergedBundle(row, mergedFromIds, singles) && singles.length) {
        const baseName = `${row.project_name || row.quotation_no || '报价'}-summary`;
        await streamBundledQuotationExcel(res, singles, baseName);
        return;
      }
    }
    await streamQuotationExcel(res, row);
  } catch (e) {
    console.error('报价 Excel 导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'Excel 导出失败' });
  }
});

router.get('/:id/bundle-preview', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    if (String(row.quote_mode || 'single') !== 'multi') return res.json({ data: [] });
    const mergedFromIds = parseJsonArray(row.merged_from_quote_ids);
    const singles = await loadSingleQuotesForMultiQuote(row);
    if (!shouldTreatAsMergedBundle(row, mergedFromIds, singles)) return res.json({ data: [] });
    res.json({ data: singles || [] });
  } catch (e) {
    res.status(500).json({ error: e.message || '加载预览失败' });
  }
});

router.get('/bundle/export-excel', async (req, res) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((x) => parseInt(x, 10))
      .filter(Number.isFinite);
    const uniqIds = [...new Set(ids)];
    if (uniqIds.length < 2) return res.status(400).json({ error: '请至少选择 2 条报价导出汇总' });
    const quotes = await loadQuotationsByIds(uniqIds);
    if (quotes.length !== uniqIds.length) return res.status(404).json({ error: '部分报价不存在，导出已取消' });
    if (quotes.some((q) => String(q.quote_mode || 'single') !== 'single')) {
      return res.status(400).json({ error: '汇总导出仅支持单场报价，请取消多场报价后重试' });
    }
    const yearSet = new Set(quotes.map((q) => Number(q.year_frame_id)));
    if (yearSet.size > 1) return res.status(400).json({ error: '仅支持同一财年的报价合并导出' });
    const ordered = quotes.slice();
    const baseName = `${ordered[0].project_name || '报价'}-summary`;
    await streamBundledQuotationExcel(res, ordered, baseName);
  } catch (e) {
    console.error('报价汇总 Excel 导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || '汇总 Excel 导出失败' });
  }
});

router.post('/bundle/preview', async (req, res) => {
  try {
    let orderedIds = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x) => parseInt(x, 10)).filter(Number.isFinite)
      : [];
    if (!orderedIds.length && Array.isArray(req.body?.quotation_nos)) {
      const qtNos = req.body.quotation_nos
        .map((n) => String(n || '').trim().toUpperCase())
        .filter(Boolean);
      const quotesByNo = await loadSingleQuotesByQuotationNos(qtNos);
      orderedIds = quotesByNo.map((q) => Number(q.id)).filter(Number.isFinite);
    }
    const uniqIds = [...new Set(orderedIds)];
    if (!uniqIds.length) return res.status(400).json({ error: '请至少选择 1 条报价' });
    const quotes = sortSingleQuotesByEventDateAsc(await loadOrderedSingleQuotesByIds(orderedIds));
    if (quotes.length !== orderedIds.length) return res.status(404).json({ error: '部分报价不存在，请刷新后重试' });
    if (quotes.some((q) => String(q.quote_mode || 'single') !== 'single')) {
      return res.status(400).json({ error: '导出报价预览仅支持单场报价' });
    }
    const data = quotes.map((q) => ({
      id: q.id,
      activity_id: q.activity_id,
      quotation_no: q.quotation_no,
      project_name: q.project_name,
      project_code: q.project_code,
      client_brand: q.client_brand,
      client_contact: q.client_contact,
      city: q.city,
      customer_name: q.customer_name,
      event_date: q.event_date,
      event_type: q.event_type,
      total_amount: q.total_amount,
      subtotal_ex_tax: q.subtotal_ex_tax,
      service_charge: q.service_charge,
      tax_amount: q.tax_amount,
      service_rate: q.service_rate,
      tax_rate: q.tax_rate,
      items: q.items || [],
    }));
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message || '加载导出预览失败' });
  }
});

function buildPreviewBundleMultiStub(quotes, projectName) {
  const linked_sessions = quotes.map((q, i) =>
    mergeSessionWithTotals({
      activity_id: q.activity_id,
      project_code: q.project_code || '',
      event_date: normalizeEventDate(q.event_date),
      city: q.city || '',
      customer_name: q.customer_name || '',
      event_type: q.event_type || '',
      remarks: '',
      sort_order: i,
      fee_comm: Number(q.subtotal_ex_tax) || 0,
      fee_design: 0,
      fee_freight: 0,
      fee_print: 0,
      fee_photo: 0,
    })
  );
  return {
    quote_mode: 'multi',
    project_name: projectName || quotes[0]?.project_name || '合并报价',
    client_brand: quotes[0]?.client_brand || 'REMY COINTREAU',
    client_contact: quotes[0]?.client_contact || '',
    linked_sessions,
  };
}

router.post('/bundle/export-pdf', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x) => parseInt(x, 10)).filter(Number.isFinite)
      : [];
    const uniqIds = [...new Set(ids)];
    if (uniqIds.length < 1) return res.status(400).json({ error: '请至少选择 1 条报价导出' });
    const quotes = sortSingleQuotesByEventDateAsc(await loadQuotationsByIds(uniqIds));
    if (quotes.length !== uniqIds.length) return res.status(404).json({ error: '部分报价不存在，导出已取消' });
    if (quotes.some((q) => String(q.quote_mode || 'single') !== 'single')) {
      return res.status(400).json({ error: '仅支持单场报价导出' });
    }
    const yearSet = new Set(quotes.map((q) => Number(q.year_frame_id)));
    if (yearSet.size > 1) return res.status(400).json({ error: '仅支持同一财年的报价合并导出' });
    const projectName = String(req.body?.project_name || '').trim() || quotes[0]?.project_name || '合并报价';
    const multiStub = buildPreviewBundleMultiStub(quotes, projectName);
    const layoutByQuoteId =
      req.body?.layoutByQuoteId && typeof req.body.layoutByQuoteId === 'object'
        ? req.body.layoutByQuoteId
        : {};
    const pageOrientation =
      String(req.body?.pageOrientation || 'landscape').toLowerCase() === 'portrait'
        ? 'portrait'
        : 'landscape';
    await streamBundledQuotationPdf(res, multiStub, quotes, { layoutByQuoteId, pageOrientation });
  } catch (e) {
    console.error('报价汇总 PDF 导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || '汇总 PDF 导出失败' });
  }
});

router.post('/bundle/export-excel', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x) => parseInt(x, 10)).filter(Number.isFinite)
      : [];
    const uniqIds = [...new Set(ids)];
    if (uniqIds.length < 1) return res.status(400).json({ error: '请至少选择 1 条报价导出' });
    const quotes = sortSingleQuotesByEventDateAsc(await loadQuotationsByIds(uniqIds));
    if (quotes.length !== uniqIds.length) return res.status(404).json({ error: '部分报价不存在，导出已取消' });
    if (quotes.some((q) => String(q.quote_mode || 'single') !== 'single')) {
      return res.status(400).json({ error: '仅支持单场报价导出' });
    }
    const yearSet = new Set(quotes.map((q) => Number(q.year_frame_id)));
    if (yearSet.size > 1) return res.status(400).json({ error: '仅支持同一财年的报价合并导出' });
    const ordered = quotes;
    const baseName = `${ordered[0].project_name || '报价'}-summary`;
    const layoutByQuoteId = req.body?.layoutByQuoteId && typeof req.body.layoutByQuoteId === 'object'
      ? req.body.layoutByQuoteId
      : {};
    await streamBundledQuotationExcelWithLayout(res, ordered, baseName, layoutByQuoteId);
  } catch (e) {
    console.error('报价汇总 Excel（带版式）导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || '汇总 Excel 导出失败' });
  }
});

router.post('/bundle/create-merged', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x) => parseInt(x, 10)).filter(Number.isFinite)
      : [];
    const uniqIds = [...new Set(ids)];
    if (!uniqIds.length) return res.status(400).json({ error: '请至少选择 1 条报价' });
    const quotes = sortSingleQuotesByEventDateAsc(await loadQuotationsByIds(uniqIds));
    if (quotes.length !== uniqIds.length) return res.status(404).json({ error: '部分报价不存在，请刷新后重试' });
    if (quotes.some((q) => String(q.quote_mode || 'single') !== 'single')) {
      return res.status(400).json({ error: '仅支持单场报价合并生成' });
    }
    const yearSet = new Set(quotes.map((q) => Number(q.year_frame_id)));
    if (yearSet.size > 1) return res.status(400).json({ error: '仅支持同一财年的报价合并生成' });
    const targetYear = Number(quotes[0].year_frame_id);
    const projectName = String(req.body?.project_name || '').trim();
    if (!projectName) return res.status(400).json({ error: '请填写合并报价名称' });

    // 兼容历史单场报价：activity_id 为空时，按项目编号回查活动
    const sessions = [];
    for (let i = 0; i < quotes.length; i++) {
      const q = quotes[i];
      let activityId = Number(q.activity_id);
      if (!Number.isFinite(activityId)) {
        const code = String(q.project_code || '').trim();
        if (code) {
          const [rows] = await conn.query(
            `SELECT id
             FROM activities
             WHERE year_frame_id = ? AND project_code = ? AND COALESCE(is_virtual, 0) = 0
             ORDER BY id DESC
             LIMIT 1`,
            [targetYear, code]
          );
          if (rows.length) activityId = Number(rows[0].id);
        }
      }
      if (!Number.isFinite(activityId)) {
        return res.status(400).json({ error: `报价 ${q.quotation_no || q.id} 缺少关联场次，无法合并生成` });
      }
      sessions.push({
        activity_id: activityId,
        project_code: q.project_code || '',
        event_date: normalizeEventDate(q.event_date) || null,
        city: q.city || '',
        customer_name: q.customer_name || '',
        event_type: q.event_type || '',
        remarks: '',
        sort_order: i,
        fee_comm: Number(q.subtotal_ex_tax) || 0,
        fee_design: 0,
        fee_freight: 0,
        fee_print: 0,
        fee_photo: 0,
      });
    }

    await conn.beginTransaction();
    const resolved = await resolveLinkedSessions(conn, sessions, targetYear);
    if (resolved.error) {
      await conn.rollback();
      return res.status(resolved.status || 400).json({ error: resolved.error });
    }
    const linkedSessions = resolved.sessions;
    const totals = calcMultiGrandTotals(linkedSessions);
    const items = buildQuotationItemsFromMultiSessions(linkedSessions).map((it, i) => normalizeItemRow(it, i));
    const quotationNo = await generateQuotationNo(conn);
    const projectCode = projectCodesSummary(linkedSessions);
    const sourceIds = uniqIds.map((x) => Number(x)).filter(Number.isFinite);
    const [ins] = await conn.query(
      `INSERT INTO quotations (
        quotation_no, type, quote_mode, year_frame_id, activity_id, project_code, linked_sessions, merged_from_quote_ids,
        client_brand, client_contact, project_name,
        event_date, city, customer_name, event_type,
        service_rate, tax_rate,
        subtotal_ex_tax, service_charge, tax_amount, total_amount,
        status, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1)`,
      [
        quotationNo,
        'EVENT',
        'multi',
        targetYear,
        linkedSessions[0]?.activity_id || null,
        projectCode || null,
        JSON.stringify(linkedSessions),
        JSON.stringify(sourceIds),
        quotes[0]?.client_brand || 'REMY COINTREAU',
        quotes[0]?.client_contact || null,
        projectName,
        linkedSessions[0]?.event_date || null,
        linkedSessions[0]?.city || null,
        linkedSessions[0]?.customer_name || null,
        linkedSessions[0]?.event_type || null,
        totals.serviceRate,
        totals.taxRate,
        totals.subtotalExTax,
        totals.serviceCharge,
        totals.taxAmount,
        totals.totalAmount,
      ]
    );
    const qid = ins.insertId;
    for (const it of items) {
      await conn.query(
        `INSERT INTO quotation_items (
          quotation_id, section_code, section_name, subsection_code, subsection_name,
          description, item_category, quantity, unit, unit_price, subtotal, remarks, sort_order, is_custom, is_template
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          qid,
          it.section_code,
          it.section_name,
          it.subsection_code,
          it.subsection_name,
          it.description,
          it.item_category || '',
          it.quantity,
          it.unit,
          it.unit_price,
          it.subtotal,
          it.remarks,
          it.sort_order,
          it.is_custom,
          it.is_template,
        ]
      );
    }
    await syncQuotationToActivities(conn, {
      quote_mode: 'multi',
      activity_id: linkedSessions[0]?.activity_id || null,
      total_amount: totals.totalAmount,
      linked_sessions: linkedSessions,
    });
    await conn.commit();
    const data = await loadQuotation(qid);
    res.json({ data });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message || '合并生成失败' });
  } finally {
    conn.release();
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    res.json({ data: row });
  } catch (e) {
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

router.post('/', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const body = req.body || {};
    const type = String(body.type || 'EVENT').toUpperCase();
    if (type !== 'EVENT') {
      return res.status(400).json({ error: '当前仅支持活动场次报价（EVENT）' });
    }
    const quoteMode = String(body.quote_mode || 'single').toLowerCase() === 'multi' ? 'multi' : 'single';
    const mergedFromQuoteIds = Array.isArray(body.merged_from_quote_ids)
      ? body.merged_from_quote_ids.map((x) => parseInt(x, 10)).filter(Number.isFinite)
      : [];
    const yfHint = body.year_frame_id != null ? parseInt(body.year_frame_id, 10) : null;

    const templateIds = Array.isArray(body.template_item_ids)
      ? body.template_item_ids.map((x) => parseInt(x, 10)).filter(Number.isFinite)
      : [];
    let items = Array.isArray(body.items) ? body.items : [];

    if (!items.length) {
      if (quoteMode === 'multi') {
        items = buildMultiSummaryItems().map((it, i) => normalizeItemRow(it, i));
      } else {
        let tplRows;
        if (templateIds.length) {
          const [tpl] = await conn.query(
            `SELECT * FROM quotation_template_sections WHERE id IN (${templateIds.map(() => '?').join(',')}) ORDER BY sort_order`,
            templateIds
          );
          tplRows = tpl;
        } else {
          const [tpl] = await conn.query(
            `SELECT * FROM quotation_template_sections WHERE applicable_type = 'EVENT' AND is_active = 1 ORDER BY sort_order ASC, id ASC`
          );
          tplRows = tpl;
        }
        items = tplRows.map((t, i) =>
          normalizeItemRow(
            {
              section_code: t.section_code,
              section_name: t.section_name,
              subsection_code: t.subsection_code,
              subsection_name: t.subsection_name,
              description: t.description,
              item_category: t.item_category || '',
              quantity: 0,
              unit: t.default_unit,
              unit_price: t.default_unit_price,
              remarks: t.default_remarks,
              sort_order: t.sort_order || i,
              is_template: true,
            },
            i
          )
        );
      }
    } else {
      items = items.map((it, i) => normalizeItemRow(it, i));
    }
    if (items.length && String(body.type || 'EVENT').toUpperCase() === 'EVENT' && quoteMode !== 'multi') {
      items = renumberEventQuotationSections(items);
    }

    if (!items.length && quoteMode !== 'multi') {
      return res.status(400).json({ error: '请至少选择一项报价明细' });
    }

    let act;
    let projectCode;
    let linkedSessions = [];
    let yearFrameId;

    if (quoteMode === 'multi') {
      const incoming = parseLinkedSessions(body.linked_sessions);
      if (incoming.length) {
        const resolved = await resolveLinkedSessions(conn, incoming, yfHint);
        if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });
        linkedSessions = resolved.sessions;
      }
      yearFrameId = yfHint || (linkedSessions[0] && linkedSessions[0].activity_id
        ? (await resolveLinkedActivity(conn, linkedSessions[0].activity_id, null)).activity?.year_frame_id
        : null);
      if (!yearFrameId && yfHint == null) {
        return res.status(400).json({ error: '请先在左侧选择财年' });
      }
      act = linkedSessions.length
        ? { id: linkedSessions[0].activity_id, year_frame_id: yearFrameId }
        : { id: null, year_frame_id: yearFrameId };
      projectCode = projectCodesSummary(linkedSessions);
    } else {
      const linked = await resolveLinkedActivity(conn, body.activity_id, yfHint);
      if (linked.error) return res.status(linked.status || 400).json({ error: linked.error });
      act = linked.activity;
      projectCode = linked.projectCode;
      yearFrameId = act.year_frame_id;
    }

    const serviceRate = defaultServiceRate(body.service_rate, quoteMode);
    const taxRate = body.tax_rate != null ? body.tax_rate : 0.06;
    let totals;
    if (quoteMode === 'multi') {
      totals = linkedSessions.length ? calcMultiGrandTotals(linkedSessions) : calcMultiGrandTotals([]);
      items = linkedSessions.length
        ? buildQuotationItemsFromMultiSessions(linkedSessions).map((it, i) => normalizeItemRow(it, i))
        : [];
    } else {
      totals = calcTotalsFromItems(items, serviceRate, taxRate);
    }

    const firstSession = linkedSessions[0];
    const eventDate =
      quoteMode === 'multi'
        ? firstSession?.event_date || null
        : normalizeEventDate(act?.activity_date) ||
          normalizeEventDate(body.event_date) ||
          null;
    const cityVal =
      quoteMode === 'multi'
        ? firstSession?.city || null
        : body.city != null && String(body.city).trim()
          ? body.city
          : act.city || null;
    const customerVal =
      quoteMode === 'multi' ? firstSession?.customer_name || null : act.client_name || null;
    const eventTypeVal =
      quoteMode === 'multi'
        ? firstSession?.event_type || null
        : body.event_type || deriveEventTypeFromActivity(act) || null;

    await conn.beginTransaction();
    const quotationNo = await generateQuotationNo(conn);
    const [ins] = await conn.query(
      `INSERT INTO quotations (
        quotation_no, type, quote_mode, year_frame_id, activity_id, project_code, linked_sessions, merged_from_quote_ids,
        client_brand, client_contact, project_name,
        event_date, city, customer_name, event_type,
        service_rate, tax_rate,
        subtotal_ex_tax, service_charge, tax_amount, total_amount,
        status, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1)`,
      [
        quotationNo,
        type,
        quoteMode,
        yearFrameId,
        act.id,
        projectCode || null,
        linkedSessions.length ? JSON.stringify(linkedSessions) : null,
        mergedFromQuoteIds.length ? JSON.stringify(mergedFromQuoteIds) : null,
        body.client_brand || 'REMY COINTREAU',
        body.client_contact || null,
        body.project_name || (quoteMode === 'multi' ? '多场活动报价' : null),
        eventDate,
        cityVal,
        customerVal,
        eventTypeVal,
        totals.serviceRate,
        totals.taxRate,
        totals.subtotalExTax,
        totals.serviceCharge,
        totals.taxAmount,
        totals.totalAmount,
      ]
    );
    const qid = ins.insertId;
    for (const it of items) {
      await conn.query(
        `INSERT INTO quotation_items (
          quotation_id, section_code, section_name, subsection_code, subsection_name,
          description, item_category, quantity, unit, unit_price, subtotal, remarks, sort_order, is_custom, is_template
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          qid,
          it.section_code,
          it.section_name,
          it.subsection_code,
          it.subsection_name,
          it.description,
          it.item_category || '',
          it.quantity,
          it.unit,
          it.unit_price,
          it.subtotal,
          it.remarks,
          it.sort_order,
          it.is_custom,
          it.is_template,
        ]
      );
    }
    await syncQuotationToActivities(conn, {
      quote_mode: quoteMode,
      activity_id: act.id,
      total_amount: totals.totalAmount,
      linked_sessions: linkedSessions.length ? linkedSessions : null,
    });
    await conn.commit();
    const data = await loadQuotation(qid);
    res.json({ data });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message || '创建失败' });
  } finally {
    conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const body = req.body || {};
    const [exist] = await conn.query(
      'SELECT id, type, quote_mode, year_frame_id, activity_id FROM quotations WHERE id = ?',
      [id]
    );
    if (!exist.length) return res.status(404).json({ error: '报价不存在' });
    const quoteMode = exist[0].quote_mode || 'single';

    let items = Array.isArray(body.items) ? body.items.map((it, i) => normalizeItemRow(it, i)) : null;
    if (items && exist[0].type === 'EVENT' && quoteMode !== 'multi') {
      items = renumberEventQuotationSections(items);
    }
    const serviceRate = body.service_rate != null ? body.service_rate : undefined;
    const taxRate = body.tax_rate != null ? body.tax_rate : undefined;

    let linkedSessionsJson = null;
    let activityIdUpdate = body.activity_id != null ? parseInt(body.activity_id, 10) : null;
    let projectCodeUpdate = null;
    let eventDateUpdate = normalizeEventDate(body.event_date);
    let cityUpdate = body.city ?? null;
    let customerUpdate = body.customer_name ?? null;
    let eventTypeUpdate = body.event_type ?? null;

    let multiTotals = null;
    if (quoteMode === 'multi' && body.linked_sessions != null) {
      const resolved = await resolveLinkedSessions(conn, parseLinkedSessions(body.linked_sessions), exist[0].year_frame_id);
      if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });
      const sessions = resolved.sessions;
      linkedSessionsJson = JSON.stringify(sessions);
      activityIdUpdate = sessions[0]?.activity_id || null;
      projectCodeUpdate = projectCodesSummary(sessions);
      eventDateUpdate = sessions[0]?.event_date || null;
      cityUpdate = sessions[0]?.city || null;
      customerUpdate = sessions[0]?.customer_name || null;
      eventTypeUpdate = sessions[0]?.event_type || null;
      multiTotals = calcMultiGrandTotals(sessions);
      items = buildQuotationItemsFromMultiSessions(sessions).map((it, i) => normalizeItemRow(it, i));
    } else if (quoteMode !== 'multi' && exist[0].type === 'EVENT') {
      const aid =
        Number.isFinite(activityIdUpdate) && activityIdUpdate > 0
          ? activityIdUpdate
          : parseInt(exist[0].activity_id, 10);
      if (Number.isFinite(aid) && aid > 0) {
        const linked = await resolveLinkedActivity(conn, aid, exist[0].year_frame_id);
        if (!linked.error) {
          eventDateUpdate =
            normalizeEventDate(linked.activity.activity_date) || eventDateUpdate;
        }
      }
    }

    if (items) {
      const totals =
        multiTotals || calcTotalsFromItems(items, serviceRate ?? defaultServiceRate(null, quoteMode), taxRate ?? 0.06);
      await conn.beginTransaction();
      await conn.query(
        `UPDATE quotations SET
          client_brand = COALESCE(?, client_brand),
          client_contact = COALESCE(?, client_contact),
          project_name = COALESCE(?, project_name),
          event_date = COALESCE(?, event_date),
          city = COALESCE(?, city),
          customer_name = COALESCE(?, customer_name),
          event_type = COALESCE(?, event_type),
          activity_id = COALESCE(?, activity_id),
          project_code = COALESCE(?, project_code),
          linked_sessions = COALESCE(?, linked_sessions),
          service_rate = ?,
          tax_rate = ?,
          subtotal_ex_tax = ?,
          service_charge = ?,
          tax_amount = ?,
          total_amount = ?,
          status = COALESCE(?, status),
          version = version + 1
        WHERE id = ?`,
        [
          body.client_brand ?? null,
          body.client_contact ?? null,
          body.project_name ?? null,
          eventDateUpdate,
          cityUpdate,
          customerUpdate,
          eventTypeUpdate,
          activityIdUpdate,
          projectCodeUpdate,
          linkedSessionsJson,
          totals.serviceRate,
          totals.taxRate,
          totals.subtotalExTax,
          totals.serviceCharge,
          totals.taxAmount,
          totals.totalAmount,
          body.status && STATUSES.includes(body.status) ? body.status : null,
          id,
        ]
      );
      await conn.query('DELETE FROM quotation_items WHERE quotation_id = ?', [id]);
      for (const it of items) {
        await conn.query(
          `INSERT INTO quotation_items (
            quotation_id, section_code, section_name, subsection_code, subsection_name,
            description, item_category, quantity, unit, unit_price, subtotal, remarks, sort_order, is_custom, is_template
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            it.section_code,
            it.section_name,
            it.subsection_code,
            it.subsection_name,
            it.description,
            it.item_category || '',
            it.quantity,
            it.unit,
            it.unit_price,
            it.subtotal,
            it.remarks,
            it.sort_order,
            it.is_custom,
            it.is_template,
          ]
        );
      }
      const [qrows] = await conn.query(
        'SELECT quote_mode, activity_id, total_amount, linked_sessions FROM quotations WHERE id = ?',
        [id]
      );
      if (qrows[0]) await syncQuotationToActivities(conn, qrows[0]);
      await conn.commit();
    } else {
      await conn.query(
        `UPDATE quotations SET
          client_brand = COALESCE(?, client_brand),
          client_contact = COALESCE(?, client_contact),
          project_name = COALESCE(?, project_name),
          event_date = COALESCE(?, event_date),
          city = COALESCE(?, city),
          customer_name = COALESCE(?, customer_name),
          event_type = COALESCE(?, event_type),
          status = COALESCE(?, status)
        WHERE id = ?`,
        [
          body.client_brand ?? null,
          body.client_contact ?? null,
          body.project_name ?? null,
          normalizeEventDate(body.event_date),
          body.city ?? null,
          body.customer_name ?? null,
          body.event_type ?? null,
          body.status && STATUSES.includes(body.status) ? body.status : null,
          id,
        ]
      );
    }
    const data = await loadQuotation(id);
    res.json({ data });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message || '更新失败' });
  } finally {
    conn.release();
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [r] = await db.query('DELETE FROM quotations WHERE id = ?', [id]);
    if (!r.affectedRows) return res.status(404).json({ error: '报价不存在' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || '删除失败' });
  }
});

router.post('/:id/duplicate', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const id = parseInt(req.params.id, 10);
    const src = await loadQuotation(id);
    if (!src) return res.status(404).json({ error: '报价不存在' });
    const items = (src.items || []).map((it) => normalizeItemRow(it));
    await conn.beginTransaction();
    const quotationNo = await generateQuotationNo(conn);
    const [ins] = await conn.query(
      `INSERT INTO quotations (
        quotation_no, type, year_frame_id, activity_id,
        client_brand, client_contact, project_name,
        event_date, city, customer_name, event_type,
        service_rate, tax_rate,
        subtotal_ex_tax, service_charge, tax_amount, total_amount,
        status, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1)`,
      [
        quotationNo,
        src.type,
        src.year_frame_id,
        src.activity_id,
        src.client_brand,
        src.client_contact,
        src.project_name ? `${src.project_name}（副本）` : null,
        src.event_date,
        src.city,
        src.customer_name,
        src.event_type,
        src.service_rate,
        src.tax_rate,
        src.subtotal_ex_tax,
        src.service_charge,
        src.tax_amount,
        src.total_amount,
      ]
    );
    const qid = ins.insertId;
    for (const it of items) {
      await conn.query(
        `INSERT INTO quotation_items (
          quotation_id, section_code, section_name, subsection_code, subsection_name,
          description, item_category, quantity, unit, unit_price, subtotal, remarks, sort_order, is_custom, is_template
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          qid,
          it.section_code,
          it.section_name,
          it.subsection_code,
          it.subsection_name,
          it.description,
          it.item_category || '',
          it.quantity,
          it.unit,
          it.unit_price,
          it.subtotal,
          it.remarks,
          it.sort_order,
          it.is_custom,
          it.is_template,
        ]
      );
    }
    await conn.commit();
    const data = await loadQuotation(qid);
    res.json({ data });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message || '复制失败' });
  } finally {
    conn.release();
  }
});

module.exports = router;
