const express = require('express');
const db = require('../config/database');
const {
  mergeReimbIntoActivity,
  normalizeClaimStatus,
  normalizeCostDetailsInput,
  normalizeCostModule,
  normalizeInvoices,
  normalizePaymentMethod,
  normalizePaymentStatus,
  normalizePaymentType,
  sumCostDetails,
} = require('./routeHelpers');

const router = express.Router();

router.post('/', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const {
      year_frame_id,
      activity_id,
      reimbursement_type,
      payment_type,
      cost_module,
      claim_status,
      city,
      brand,
      date,
      payee_name,
      payment_method,
      payee_bank_name,
      payee_bank_account,
      related_project_code,
      remarks,
      has_invoice,
      sync_to_activity,
    } = req.body;

    if (!year_frame_id) {
      return res.status(400).json({ error: '缺少 year_frame_id' });
    }
    if (!date) {
      return res.status(400).json({ error: '缺少 date' });
    }
    const brandVal = brand != null ? String(brand).trim() : '';
    const payeeName = payee_name != null ? String(payee_name).trim() : '';
    if (!brandVal) {
      return res.status(400).json({ error: '请选择品牌' });
    }
    if (brandVal.length > 30) {
      return res.status(400).json({ error: '品牌字段过长，请刷新页面后重新保存' });
    }

    const cost_details = normalizeCostDetailsInput(req.body);
    const amount = sumCostDetails(cost_details);
    const payStatus = normalizePaymentStatus(req.body.payment_status);

    const hi = !!(has_invoice === true || has_invoice === 1 || String(has_invoice) === '1');
    let invoices = normalizeInvoices(req.body);
    if (hi) {
      const valid = invoices.filter(
        (x) => x.invoice_no && x.invoice_date && (x.invoice_kind === '专票' || x.invoice_kind === '普票')
      );
      if (!valid.length) {
        return res.status(400).json({ error: '有发票时至少填写一行完整发票（号码、日期、专票/普票）' });
      }
      invoices = valid;
    } else {
      invoices = [];
    }

    const sync = !!(sync_to_activity === true || sync_to_activity === 1 || String(sync_to_activity) === '1');
    const actId = activity_id == null || activity_id === '' ? null : Number(activity_id);
    if (sync && !actId) {
      return res.status(400).json({ error: '勾选同步到场次成本时，必须选择关联场次' });
    }
    if (amount === 0) {
      return res.status(400).json({ error: '金额合计不能为 0' });
    }
    if (sync && amount <= 0) {
      return res.status(400).json({ error: '同步到场次时金额合计须大于 0' });
    }

    const paymentType = normalizePaymentType(payment_type);
    const costModule = normalizeCostModule(cost_module);
    const claimStatus = normalizeClaimStatus(claim_status);

    let act = null;
    if (actId) {
      const [acts] = await conn.query(
        'SELECT id, year_frame_id, project_code, city, brand FROM activities WHERE id = ?',
        [actId]
      );
      if (!acts.length) {
        return res.status(400).json({ error: '关联场次不存在' });
      }
      if (Number(acts[0].year_frame_id) !== Number(year_frame_id)) {
        return res.status(400).json({ error: '场次所属年框与当前报销年框不一致' });
      }
      act = acts[0];
    }
    const rpc = related_project_code != null && String(related_project_code).trim()
      ? String(related_project_code).trim()
      : (act ? (act.project_code || null) : null);
    const cityVal = city != null && String(city).trim()
      ? String(city).trim()
      : (act ? (act.city || null) : null);
    const payMethod = normalizePaymentMethod(payment_method);
    const payeeBankName =
      payee_bank_name != null && String(payee_bank_name).trim() ? String(payee_bank_name).trim() : null;
    const payeeBankAccount =
      payee_bank_account != null && String(payee_bank_account).trim() ? String(payee_bank_account).trim() : null;

    await conn.beginTransaction();

    const invoicesJson = invoices.length ? JSON.stringify(invoices) : null;
    const costJson = JSON.stringify(cost_details);

    const [result] = await conn.query(
      `INSERT INTO reimbursements (
        year_frame_id, activity_id, reimbursement_type, payment_type, cost_module, claim_status, city, brand, amount, date, related_project_code,
        payee_name, payment_method, payee_bank_name, payee_bank_account, payment_status,
        props, printing, express, other,
        cost_details, merged_into_activity, has_invoice, invoices, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?)`,
      [
        year_frame_id,
        actId,
        reimbursement_type || null,
        paymentType,
        costModule,
        claimStatus,
        cityVal,
        brandVal,
        amount,
        date,
        rpc,
        payeeName || null,
        payMethod,
        payMethod === 'bank_transfer' ? payeeBankName : null,
        payMethod === 'bank_transfer' ? payeeBankAccount : null,
        payStatus,
        costJson,
        sync ? 1 : 0,
        hi ? 1 : 0,
        invoicesJson,
        remarks || null,
      ]
    );

    const newId = result.insertId;

    if (sync && actId) {
      await mergeReimbIntoActivity(conn, actId, cost_details, {});
    }

    await conn.commit();
    res.json({ id: newId, message: '创建成功', merged_into_activity: sync ? 1 : 0 });
  } catch (error) {
    await conn.rollback();
    const code = error.statusCode || 500;
    res.status(code).json({ error: error.message || '创建失败' });
  } finally {
    conn.release();
  }
});

module.exports = router;
