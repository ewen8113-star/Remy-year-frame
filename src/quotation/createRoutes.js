const express = require('express');
const db = require('../config/database');
const {
  buildMultiSummaryItems,
  calcMultiGrandTotals,
  buildQuotationItemsFromMultiSessions,
} = require('./multiSummaryItems');
const { syncQuotationToActivities } = require('./syncQuotationToActivities');
const {
  calcTotalsFromItems,
  defaultServiceRate,
  deriveEventTypeFromActivity,
  normalizeEventDate,
  normalizeItemRow,
  parseLinkedSessions,
  projectCodesSummary,
} = require('./routeUtils');
const { loadQuotation } = require('./routeLoaders');
const { renumberEventQuotationSections } = require('./quotationCodes');
const {
  generateQuotationNo,
  resolveLinkedActivity,
  resolveLinkedSessions,
} = require('./writeHelpers');

const router = express.Router();

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

module.exports = router;
