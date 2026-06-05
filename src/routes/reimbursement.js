const express = require('express');
const router = express.Router();
const db = require('../config/database');

const PAYMENT_TYPES = ['personal_reimbursement', 'corporate_payment'];
const COST_MODULES = ['activity', 'warehouse', 'logistics', 'prop_repair', 'material_purchase', 'general'];
const CLAIM_STATUSES = ['draft', 'submitted', 'paid', 'reimbursed', 'rejected'];

/** 报销申请保存的成本键：兼容活动成本字段，并补充付款申请明细专用类别 */
const COST_DETAIL_KEYS = [
  'supervisor', 'pg', 'parttime', 'bartender', 'photo', 'cloud_album_edit', 'performance', 'makeup',
  'travel_supervisor', 'travel_company',
  'structure', 'av', 'print', 'spray',
  'floral', 'payment', 'tasting', 'venue_fee', 'meal_fee', 'other_advance',
  'warehouse', 'express', 'logistics',
  'advance_offset',
];

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function sumCostDetails(details) {
  if (!details || typeof details !== 'object') return 0;
  return round2(COST_DETAIL_KEYS.reduce((s, k) => s + round2(details[k]), 0));
}

function parseJsonObject(v) {
  if (v == null) return {};
  if (typeof v === 'object' && !Array.isArray(v)) return { ...v };
  if (typeof v === 'string') {
    try {
      const o = JSON.parse(v);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseJsonArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }
  return [];
}

const REIMB_DETAIL_META_PREFIX = '\n\n[REIMB_DETAIL_JSON]';

function readReimbDetailMeta(remarks) {
  const s = String(remarks || '');
  const idx = s.indexOf(REIMB_DETAIL_META_PREFIX);
  if (idx < 0) return {};
  try {
    return JSON.parse(s.slice(idx + REIMB_DETAIL_META_PREFIX.length).trim()) || {};
  } catch {
    return {};
  }
}

/**
 * 将一条报销/付款申请的成本明细合并进场次 cost_details。
 * 不同栏目各自记录；同一栏目在已有金额上累加（更新时先扣本条旧值再加新值）。
 */
function mergeCostDetailsIntoActivity(activityDetails, reimbDetails, previousReimbDetails) {
  const base = parseJsonObject(activityDetails);
  const prev = parseJsonObject(previousReimbDetails);
  const next = parseJsonObject(reimbDetails);
  COST_DETAIL_KEYS.forEach((k) => {
    const cur = round2(base[k]);
    const before = round2(prev[k]);
    const after = round2(next[k]);
    base[k] = round2(cur - before + after);
  });
  return base;
}

function normalizeCostDetailsInput(body) {
  const raw = body && body.cost_details;
  const o = parseJsonObject(raw);
  const out = {};
  COST_DETAIL_KEYS.forEach((k) => {
    out[k] = round2(o[k]);
  });
  return out;
}

function normalizeInvoices(body) {
  const raw = body && body.invoices;
  const arr = Array.isArray(raw) ? raw : parseJsonArray(raw);
  return arr
    .map((row) => ({
      invoice_content: row && row.invoice_content != null ? String(row.invoice_content).trim() : '',
      invoice_no: row && row.invoice_no != null ? String(row.invoice_no).trim() : '',
      invoice_date: row && row.invoice_date != null ? String(row.invoice_date).slice(0, 10) : '',
      invoice_kind: row && (row.invoice_kind === '普票' || row.invoice_kind === '专票') ? row.invoice_kind : '',
    }))
    .filter((row) => row.invoice_content || row.invoice_no || row.invoice_date || row.invoice_kind);
}

function serializeRow(row) {
  if (!row) return row;
  const r = { ...row };
  r.cost_details = parseJsonObject(r.cost_details);
  r.invoices = parseJsonArray(r.invoices);
  r.merged_into_activity = r.merged_into_activity === 1 || r.merged_into_activity === true ? 1 : 0;
  r.has_invoice = r.has_invoice === 1 || r.has_invoice === true ? 1 : 0;
  r.payment_type = PAYMENT_TYPES.includes(String(r.payment_type || '')) ? String(r.payment_type) : 'personal_reimbursement';
  r.cost_module = COST_MODULES.includes(String(r.cost_module || '')) ? String(r.cost_module) : 'activity';
  r.claim_status = CLAIM_STATUSES.includes(String(r.claim_status || '')) ? String(r.claim_status) : 'draft';
  r.payment_status = normalizePaymentStatus(r.payment_status);
  r.payment_method = normalizePaymentMethod(r.payment_method);
  return r;
}

function normalizePaymentType(v) {
  const s = v == null ? '' : String(v).trim();
  return PAYMENT_TYPES.includes(s) ? s : 'personal_reimbursement';
}
function normalizeCostModule(v) {
  const s = v == null ? '' : String(v).trim();
  return COST_MODULES.includes(s) ? s : 'activity';
}
function normalizeClaimStatus(v) {
  const s = v == null ? '' : String(v).trim();
  return CLAIM_STATUSES.includes(s) ? s : 'draft';
}

function normalizePaymentStatus(v) {
  const s = String(v || '').toLowerCase();
  return s === 'paid' ? 'paid' : 'unpaid';
}

const PAYEE_PAYMENT_METHODS = ['bank_transfer', 'wechat_alipay', 'platform'];

function normalizePaymentMethod(v) {
  const s = v == null ? '' : String(v).trim();
  return PAYEE_PAYMENT_METHODS.includes(s) ? s : null;
}

async function mergeReimbIntoActivity(conn, activityId, reimbCostDetails, previousReimbDetails) {
  const [acts] = await conn.query(
    'SELECT id, year_frame_id, cost_details, no_cost FROM activities WHERE id = ? FOR UPDATE',
    [activityId]
  );
  if (!acts.length) {
    const e = new Error('关联场次不存在');
    e.statusCode = 400;
    throw e;
  }
  const act = acts[0];
  const noCost = act.no_cost === 1 || act.no_cost === true;
  if (noCost) {
    const e = new Error('该场次已标记为无成本，禁止同步报销到场次成本');
    e.statusCode = 400;
    throw e;
  }
  const merged = mergeCostDetailsIntoActivity(act.cost_details, reimbCostDetails, previousReimbDetails);
  const total = sumCostDetails(merged);
  await conn.query(
    'UPDATE activities SET cost_details = ?, total_cost = ? WHERE id = ?',
    [JSON.stringify(merged), total, activityId]
  );
}

// 获取报销列表
router.get('/', async (req, res) => {
  try {
    const { yearFrameId, city } = req.query;

    let sql = `
      SELECT r.*, yf.year as year_frame_name
      FROM reimbursements r
      LEFT JOIN year_frames yf ON r.year_frame_id = yf.id
      WHERE 1=1
    `;
    const params = [];

    if (yearFrameId) {
      sql += ' AND r.year_frame_id = ?';
      params.push(yearFrameId);
    }
    if (city) {
      sql += ' AND r.city LIKE ?';
      params.push(`%${city}%`);
    }

    sql += ' ORDER BY r.date DESC, r.id DESC';

    const [rows] = await db.query(sql, params);
    res.json(rows.map(serializeRow));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** 盛融报销单 Excel（保留表头/边框/列宽，A4 横向） */
router.get('/:id/excel', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [rows] = await db.query('SELECT * FROM reimbursements WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    const { writeReimbursementExcel } = require('../reimbursement/buildReimbursementExcel');
    await writeReimbursementExcel(res, serializeRow(rows[0]));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ error: error.message || '导出失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT r.*, yf.year as year_frame_name
       FROM reimbursements r
       LEFT JOIN year_frames yf ON r.year_frame_id = yf.id
       WHERE r.id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    res.json(serializeRow(rows[0]));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建报销记录
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

/** 个人报销：仅更新申请状态（及付款日期/付款状态） */
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
          src.remarks || null,
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
