const express = require('express');
const db = require('../config/database');
const { normalizeItemRow } = require('./routeUtils');
const { loadQuotation } = require('./routeLoaders');
const { generateQuotationNo } = require('./writeHelpers');

const router = express.Router();

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
