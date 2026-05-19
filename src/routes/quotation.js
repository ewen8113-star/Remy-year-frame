const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { ensureQuotationTables } = require('../quotation/ensureQuotationTables');
const { streamQuotationPdf } = require('../quotation/buildQuotationPdf');
const {
  buildMultiSummaryItems,
  mergeSessionWithTotals,
  calcMultiGrandTotals,
  buildQuotationItemsFromMultiSessions,
} = require('../quotation/multiSummaryItems');
const { formatDateTimeMinute } = require('../lib/businessTime');

const EVENT_TYPES = ['无执行晚宴', '有执行晚宴', '全系列执行晚宴', '12|15|18年品鉴'];
const STATUSES = ['draft', 'submitted', 'approved', 'rejected'];

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

function normalizeLinkedSessionRow(raw, sortOrder = 0) {
  const activityId = parseInt(raw.activity_id, 10);
  const base = {
    activity_id: Number.isFinite(activityId) ? activityId : null,
    project_code: String(raw.project_code || '').trim(),
    event_date: normalizeEventDate(raw.event_date),
    city: raw.city != null ? String(raw.city).trim() : '',
    customer_name: raw.customer_name != null ? String(raw.customer_name).trim() : '',
    event_type: raw.event_type != null ? String(raw.event_type).trim() : '',
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
        sort_order: i,
      })
    );
  }
  return { sessions: out };
}

function projectCodesSummary(sessions) {
  const codes = (sessions || []).map((s) => String(s.project_code || '').trim()).filter(Boolean);
  return codes.join('；');
}

function normalizeEventDate(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

async function resolveLinkedActivity(conn, activityId, yearFrameIdHint) {
  const aid = parseInt(activityId, 10);
  if (!Number.isFinite(aid)) return { error: '请选择关联场次（项目编号）', status: 400 };
  const [acts] = await conn.query(
    `SELECT id, year_frame_id, project_code, city, client_name, date AS activity_date, activity_type, brand
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

async function loadQuotation(id) {
  const [heads] = await db.query(
    `SELECT q.*,
            COALESCE(q.project_code, act.project_code) AS activity_project_code,
            act.activity_type AS activity_type_name,
            act.brand AS activity_brand
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
  return {
    ...head,
    event_date: normalizeEventDate(head.event_date),
    quote_mode: head.quote_mode || 'single',
    linked_sessions,
    items,
  };
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
      act.activity_type AS activity_type_name
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
    const data = rows.map((r) => ({
      ...r,
      quote_mode: r.quote_mode || 'single',
      linked_sessions: parseLinkedSessions(r.linked_sessions),
    }));
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message || '列表加载失败' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const row = await loadQuotation(id);
    if (!row) return res.status(404).json({ error: '报价不存在' });
    await streamQuotationPdf(res, row);
  } catch (e) {
    console.error('报价 PDF 导出失败:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'PDF 导出失败' });
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
        : normalizeEventDate(body.event_date) || normalizeEventDate(act.activity_date) || null;
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
        : body.event_type && EVENT_TYPES.includes(body.event_type)
          ? body.event_type
          : body.event_type || null;

    await conn.beginTransaction();
    const quotationNo = await generateQuotationNo(conn);
    const [ins] = await conn.query(
      `INSERT INTO quotations (
        quotation_no, type, quote_mode, year_frame_id, activity_id, project_code, linked_sessions,
        client_brand, client_contact, project_name,
        event_date, city, customer_name, event_type,
        service_rate, tax_rate,
        subtotal_ex_tax, service_charge, tax_amount, total_amount,
        status, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1)`,
      [
        quotationNo,
        type,
        quoteMode,
        yearFrameId,
        act.id,
        projectCode || null,
        linkedSessions.length ? JSON.stringify(linkedSessions) : null,
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
          description, quantity, unit, unit_price, subtotal, remarks, sort_order, is_custom, is_template
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          qid,
          it.section_code,
          it.section_name,
          it.subsection_code,
          it.subsection_name,
          it.description,
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
    const [exist] = await conn.query('SELECT id, type, quote_mode, year_frame_id FROM quotations WHERE id = ?', [id]);
    if (!exist.length) return res.status(404).json({ error: '报价不存在' });
    const quoteMode = exist[0].quote_mode || 'single';

    let items = Array.isArray(body.items) ? body.items.map((it, i) => normalizeItemRow(it, i)) : null;
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
            description, quantity, unit, unit_price, subtotal, remarks, sort_order, is_custom, is_template
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            it.section_code,
            it.section_name,
            it.subsection_code,
            it.subsection_name,
            it.description,
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
          description, quantity, unit, unit_price, subtotal, remarks, sort_order, is_custom, is_template
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          qid,
          it.section_code,
          it.section_name,
          it.subsection_code,
          it.subsection_name,
          it.description,
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
