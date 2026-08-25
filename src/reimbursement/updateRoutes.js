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


// 更新报销记录
router.put('/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { id } = req.params;
    const [existing] = await conn.query('SELECT * FROM reimbursements WHERE id = ?', [id]);
    if (!existing.length) {
      return res.status(404).json({ error: '记录不存在' });
    }
    const ex = existing[0];
    const alreadyMerged = ex.merged_into_activity === 1 || ex.merged_into_activity === true;

    const {
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

    if (!date) {
      return res.status(400).json({ error: '缺少 date' });
    }

    const cost_details = normalizeCostDetailsInput(req.body);
    const amount = sumCostDetails(cost_details);

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
    const paymentType = normalizePaymentType(payment_type != null ? payment_type : ex.payment_type);
    const costModule = normalizeCostModule(cost_module != null ? cost_module : ex.cost_module);
    const claimStatus = normalizeClaimStatus(claim_status != null ? claim_status : ex.claim_status);
    const payStatus =
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'payment_status')
        ? normalizePaymentStatus(req.body.payment_status)
        : normalizePaymentStatus(ex.payment_status);
    const incomingActId = activity_id == null || activity_id === '' ? null : Number(activity_id);
    const actId = incomingActId == null ? (ex.activity_id ? Number(ex.activity_id) : null) : incomingActId;
    if (alreadyMerged) {
      if (!actId || Number(ex.activity_id) !== Number(actId)) {
        return res.status(400).json({ error: '已计入活动成本（场次）的记录不可更换/清空关联场次' });
      }
    } else if (sync && !actId) {
      return res.status(400).json({ error: '勾选同步到场次成本时，必须选择关联场次' });
    }

    if (amount === 0) {
      return res.status(400).json({ error: '金额合计不能为 0' });
    }
    if (sync && amount <= 0) {
      return res.status(400).json({ error: '同步到场次时金额合计须大于 0' });
    }

    let act = null;
    if (actId) {
      const [acts] = await conn.query(
        'SELECT id, year_frame_id, project_code, city, brand FROM activities WHERE id = ?',
        [actId]
      );
      if (!acts.length) {
        return res.status(400).json({ error: '关联场次不存在' });
      }
      if (Number(acts[0].year_frame_id) !== Number(ex.year_frame_id)) {
        return res.status(400).json({ error: '场次所属年框与报销记录年框不一致' });
      }
      act = acts[0];
    }
    const brandVal = brand != null ? String(brand).trim() : String(ex.brand || '').trim();
    const payeeName = payee_name != null ? String(payee_name).trim() : String(ex.payee_name || '').trim();
    if (!brandVal) {
      return res.status(400).json({ error: '请选择品牌' });
    }
    if (brandVal.length > 30) {
      return res.status(400).json({ error: '品牌字段过长，请刷新页面后重新保存' });
    }
    const rpc = related_project_code != null && String(related_project_code).trim()
      ? String(related_project_code).trim()
      : (act ? (act.project_code || ex.related_project_code) : ex.related_project_code);
    const cityVal = city != null && String(city).trim()
      ? String(city).trim()
      : (act ? (act.city || ex.city) : ex.city);
    const payMethod =
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'payment_method')
        ? normalizePaymentMethod(payment_method)
        : normalizePaymentMethod(ex.payment_method);
    const payeeBankName =
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'payee_bank_name')
        ? (payee_bank_name != null && String(payee_bank_name).trim() ? String(payee_bank_name).trim() : null)
        : (ex.payee_bank_name || null);
    const payeeBankAccount =
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'payee_bank_account')
        ? (payee_bank_account != null && String(payee_bank_account).trim() ? String(payee_bank_account).trim() : null)
        : (ex.payee_bank_account || null);

    await conn.beginTransaction();

    const mergedFlag = alreadyMerged ? 1 : (sync ? 1 : 0);
    const invoicesJson = invoices.length ? JSON.stringify(invoices) : null;
    const costJson = JSON.stringify(cost_details);

    await conn.query(
      `UPDATE reimbursements SET
        activity_id = ?,
        reimbursement_type = ?, payment_type = ?, cost_module = ?, claim_status = ?,
        city = ?, brand = ?, amount = ?,
        date = ?, related_project_code = ?,
        payee_name = ?, payment_method = ?, payee_bank_name = ?, payee_bank_account = ?, payment_status = ?,
        props = 0, printing = 0, express = 0, other = 0,
        cost_details = ?, merged_into_activity = ?, has_invoice = ?, invoices = ?,
        remarks = ?
      WHERE id = ?`,
      [
        actId,
        reimbursement_type || null,
        paymentType,
        costModule,
        claimStatus,
        cityVal || null,
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
        mergedFlag,
        hi ? 1 : 0,
        invoicesJson,
        remarks || null,
        id,
      ]
    );

    if (mergedFlag === 1 && actId) {
      const prevDetails = alreadyMerged ? ex.cost_details : {};
      await mergeReimbIntoActivity(conn, actId, cost_details, prevDetails);
    }

    await conn.commit();
    res.json({ message: '更新成功', merged_into_activity: mergedFlag });
  } catch (error) {
    await conn.rollback();
    const code = error.statusCode || 500;
    res.status(code).json({ error: error.message || '更新失败' });
  } finally {
    conn.release();
  }
});

module.exports = router;
