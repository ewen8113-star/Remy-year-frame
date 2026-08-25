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

/** 从合并快照重建 remarks（新版 detail_rows 快照；旧版保留完整 remarks） */
function remarksFromMergeSnapshot(src) {
  const legacy = src && src.remarks != null ? String(src.remarks) : '';
  if (legacy.includes('[REIMB_DETAIL_JSON]')) return legacy || null;

  const rows = Array.isArray(src?.detail_rows) ? src.detail_rows.filter(Boolean) : [];
  if (!rows.length) return legacy || null;

  const visible = legacy.trim();
  const gross = round2(
    src.gross_total != null
      ? src.gross_total
      : rows.reduce((s, row) => s + round2(row.subtotal), 0),
  );
  const meta = {
    rows,
    use_advance: !!(src.use_advance === true || src.use_advance === 1),
    advance_amount: round2(src.advance_amount),
    gross_total: gross,
    payment_date: src.payment_date ? String(src.payment_date).slice(0, 10) : '',
  };
  return `${visible}${REIMB_DETAIL_META_PREFIX}${JSON.stringify(meta)}`;
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

module.exports = {
  CLAIM_STATUSES,
  COST_DETAIL_KEYS,
  COST_MODULES,
  PAYMENT_TYPES,
  PAYEE_PAYMENT_METHODS,
  REIMB_DETAIL_META_PREFIX,
  mergeCostDetailsIntoActivity,
  mergeReimbIntoActivity,
  normalizeClaimStatus,
  normalizeCostDetailsInput,
  normalizeCostModule,
  normalizeInvoices,
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
};
