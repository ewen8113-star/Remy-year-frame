const express = require('express');
const db = require('../config/database');
const {
  calcMultiGrandTotals,
  buildQuotationItemsFromMultiSessions,
} = require('./multiSummaryItems');
const { syncQuotationToActivities } = require('./syncQuotationToActivities');
const {
  normalizeEventDate,
  normalizeItemRow,
  projectCodesSummary,
  sortSingleQuotesByEventDateAsc,
} = require('./routeUtils');
const {
  loadQuotation,
  loadQuotationsByIds,
} = require('./routeLoaders');
const {
  generateQuotationNo,
  resolveLinkedSessions,
} = require('./writeHelpers');

const router = express.Router();

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
        fee_executor: 0,
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

module.exports = router;
