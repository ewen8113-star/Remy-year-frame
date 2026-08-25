const express = require('express');
const db = require('../config/database');
const {
  calcMultiGrandTotals,
  buildQuotationItemsFromMultiSessions,
} = require('./multiSummaryItems');
const { syncQuotationToActivities } = require('./syncQuotationToActivities');
const {
  calcTotalsFromItems,
  defaultServiceRate,
  normalizeEventDate,
  normalizeItemRow,
  parseLinkedSessions,
  projectCodesSummary,
} = require('./routeUtils');
const { loadQuotation } = require('./routeLoaders');
const { renumberEventQuotationSections } = require('./quotationCodes');
const {
  resolveLinkedActivity,
  resolveLinkedSessions,
} = require('./writeHelpers');

const router = express.Router();
const STATUSES = ['draft', 'submitted', 'approved', 'rejected'];

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

module.exports = router;
