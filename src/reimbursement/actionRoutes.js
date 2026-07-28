const express = require('express');
const db = require('../config/database');
const {
  CLAIM_STATUSES,
  normalizeClaimStatus,
  normalizeCostModule,
  normalizePaymentMethod,
  normalizePaymentStatus,
  normalizePaymentType,
  parseJsonArray,
  parseJsonObject,
  readReimbDetailMeta,
  remarksFromMergeSnapshot,
  round2,
  serializeRow,
  sumCostDetails,
} = require('./routeHelpers');

const router = express.Router();

router.patch('/:id/claim-status', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [existing] = await conn.query('SELECT * FROM reimbursements WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ error: '记录不存在' });
    const ex = existing[0];
    if (String(ex.payment_type || '') !== 'personal_reimbursement') {
      return res.status(400).json({ error: '仅个人报销支持快捷状态修改' });
    }

    const rawStatus = String(req.body?.claim_status || '').trim();
    if (!CLAIM_STATUSES.includes(rawStatus)) {
      return res.status(400).json({ error: '无效状态' });
    }
    const claimStatus = rawStatus;

    let paymentStatus = normalizePaymentStatus(ex.payment_status);
    if (claimStatus === 'paid' || claimStatus === 'reimbursed') {
      paymentStatus = 'paid';
    } else if (claimStatus === 'draft' || claimStatus === 'submitted') {
      if (!ex.payment_order_id) paymentStatus = 'unpaid';
    }

    const metaPrefix = '\n\n[REIMB_DETAIL_JSON]';
    let remarks = ex.remarks != null ? String(ex.remarks) : '';
    const idx = remarks.indexOf(metaPrefix);
    let meta = {};
    if (idx >= 0) {
      try {
        meta = JSON.parse(remarks.slice(idx + metaPrefix.length).trim()) || {};
      } catch {
        meta = {};
      }
      remarks = remarks.slice(0, idx);
    }

    const incomingDate =
      req.body?.payment_date != null && String(req.body.payment_date).trim()
        ? String(req.body.payment_date).slice(0, 10)
        : '';
    if (claimStatus === 'paid' || claimStatus === 'reimbursed') {
      const paymentDate = incomingDate || (meta.payment_date ? String(meta.payment_date).slice(0, 10) : '');
      if (!paymentDate) {
        return res.status(400).json({ error: '状态为已支付或已报销时，请填写付款日期' });
      }
      meta.payment_date = paymentDate;
      remarks = `${remarks.trim()}${metaPrefix}${JSON.stringify(meta)}`;
    }

    await conn.query(
      `UPDATE reimbursements SET claim_status = ?, payment_status = ?, remarks = ? WHERE id = ?`,
      [claimStatus, paymentStatus, remarks || null, id]
    );
    const [rows] = await conn.query('SELECT * FROM reimbursements WHERE id = ?', [id]);
    res.json(serializeRow(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message || '更新失败' });
  } finally {
    conn.release();
  }
});

// 撤销合并：按合并快照恢复多条原记录，并删除合并结果
router.post('/:id/unmerge', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: '无效 ID' });
    }

    const [existing] = await conn.query('SELECT * FROM reimbursements WHERE id = ? FOR UPDATE', [id]);
    if (!existing.length) {
      return res.status(404).json({ error: '记录不存在' });
    }
    const ex = existing[0];

    if (ex.payment_order_id) {
      return res.status(400).json({ error: '已关联付款单，请先删除付款单后再撤销合并' });
    }
    if (normalizePaymentStatus(ex.payment_status) === 'paid') {
      return res.status(400).json({ error: '已支付记录不可撤销合并' });
    }
    const claimStatus = normalizeClaimStatus(ex.claim_status);
    if (claimStatus === 'paid' || claimStatus === 'reimbursed') {
      return res.status(400).json({ error: '状态为已支付/已报销时不可撤销合并' });
    }
    if (ex.merged_into_activity === 1 || ex.merged_into_activity === true) {
      return res.status(400).json({ error: '合并记录已计入场次成本，不可撤销；请先在编辑中取消场次同步' });
    }

    const meta = readReimbDetailMeta(ex.remarks);
    const sources = Array.isArray(meta.merge_sources) ? meta.merge_sources : [];
    if (sources.length < 2) {
      return res.status(400).json({
        error: '该记录不含可恢复的合并快照（可能是旧版合并数据，无法自动撤销）',
      });
    }

    await conn.beginTransaction();

    const restored = [];
    for (const src of sources) {
      const costDetails = parseJsonObject(src.cost_details);
      const amount = round2(src.amount != null ? src.amount : sumCostDetails(costDetails));
      const invoices = parseJsonArray(src.invoices);
      const invoicesJson = invoices.length ? JSON.stringify(invoices) : null;
      const mergedFlag = src.merged_into_activity === 1 || src.merged_into_activity === true ? 1 : 0;
      const hi = src.has_invoice === 1 || src.has_invoice === true ? 1 : 0;

      const [result] = await conn.query(
        `INSERT INTO reimbursements (
          year_frame_id, activity_id, reimbursement_type, payment_type, cost_module, claim_status,
          city, brand, payee_name, payment_method, payee_bank_name, payee_bank_account, payment_status, amount, date, related_project_code,
          props, printing, express, other,
          cost_details, merged_into_activity, has_invoice, invoices, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          src.year_frame_id,
          src.activity_id != null && src.activity_id !== '' ? Number(src.activity_id) : null,
          src.reimbursement_type || null,
          normalizePaymentType(src.payment_type),
          normalizeCostModule(src.cost_module),
          normalizeClaimStatus(src.claim_status),
          src.city || null,
          src.brand || null,
          src.payee_name || null,
          normalizePaymentMethod(src.payment_method),
          normalizePaymentMethod(src.payment_method) === 'bank_transfer' ? (src.payee_bank_name || null) : null,
          normalizePaymentMethod(src.payment_method) === 'bank_transfer' ? (src.payee_bank_account || null) : null,
          normalizePaymentStatus(src.payment_status),
          amount,
          src.date ? String(src.date).slice(0, 10) : ex.date,
          src.related_project_code || null,
          round2(src.props),
          round2(src.printing),
          round2(src.express),
          round2(src.other),
          JSON.stringify(costDetails),
          mergedFlag,
          hi,
          invoicesJson,
          remarksFromMergeSnapshot(src),
        ]
      );
      restored.push({
        source_id: src.source_id != null ? Number(src.source_id) : null,
        new_id: result.insertId,
      });
    }

    await conn.query('DELETE FROM reimbursements WHERE id = ?', [id]);
    await conn.commit();

    res.json({
      message: `已撤销合并，恢复 ${restored.length} 条记录`,
      deleted_id: id,
      restored,
    });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message || '撤销合并失败' });
  } finally {
    conn.release();
  }
});

// 删除报销记录
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      'SELECT merged_into_activity FROM reimbursements WHERE id = ?',
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: '记录不存在' });
    }
    await db.query('DELETE FROM reimbursements WHERE id = ?', [id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
