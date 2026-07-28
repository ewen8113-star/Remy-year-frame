const db = require('../config/database');
const { extractBrandFromProjectCode } = require('../lib/brandFromProjectCode');

const SOURCE_TYPES = new Set(['warehouse', 'logistics', 'material_purchase', 'prop_repair', 'reimbursement']);
const SOURCE_TABLES = {
  warehouse: 'warehouse',
  logistics: 'logistics',
  material_purchase: 'material_purchases',
  prop_repair: 'prop_repairs',
  reimbursement: 'reimbursements',
};
const REIMB_DETAIL_META_MARKER = '[REIMB_DETAIL_JSON]';
const COST_MODULE_LABELS = {
  activity: '项目成本',
  warehouse: '仓储成本',
  logistics: '物流成本',
  prop_repair: '道具维修成本',
  material_purchase: '统筹成本',
  general: '内部成本',
};

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function normText(v) {
  return v == null ? '' : String(v).trim();
}

function visibleReimbursementRemarks(v) {
  const text = normText(v);
  const idx = text.indexOf(REIMB_DETAIL_META_MARKER);
  return idx >= 0 ? text.slice(0, idx).trim() : text;
}

function cleanDescription(v) {
  return visibleReimbursementRemarks(v).replace(/\s+/g, ' ').trim();
}

function dateOnly(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** MySQL DATE：支持 YYYY-MM-DD；YYYY-MM 取当月 1 日；账期 2026-04~2026-05 取首月 1 日 */
function normalizeDbDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const full = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (full) {
    return `${full[1]}-${String(parseInt(full[2], 10)).padStart(2, '0')}-${String(parseInt(full[3], 10)).padStart(2, '0')}`;
  }
  const ym = s.match(/^(\d{4})-(\d{1,2})(?:~|$)/);
  if (ym) {
    return `${ym[1]}-${String(parseInt(ym[2], 10)).padStart(2, '0')}-01`;
  }
  const d = dateOnly(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;
  return null;
}

function sourceDateForItem(row) {
  return normalizeDbDate(row?.source_date) || normalizeDbDate(row?.expense_ym) || null;
}

function roundMoney2(n) {
  return round2(n);
}

function normalizeSettlementYm(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return '';
  const mo = parseInt(m[2], 10);
  if (!Number.isFinite(mo) || mo < 1 || mo > 12) return '';
  return `${m[1]}-${String(mo).padStart(2, '0')}`;
}

function fiscalMonthToYm(fiscalStartYear, monthNum) {
  const m = parseInt(monthNum, 10);
  if (!Number.isFinite(m) || m < 1 || m > 12) return '';
  const y = m >= 4 ? fiscalStartYear : fiscalStartYear + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function warehouseMonthToExpenseYm(fiscalStartYear, monthRaw) {
  const ym = normalizeSettlementYm(monthRaw);
  if (ym) return ym;
  return fiscalMonthToYm(fiscalStartYear, monthRaw);
}

async function fiscalStartYearFromYearFrameId(yearFrameId, conn = db) {
  if (!Number.isFinite(yearFrameId)) {
    const now = new Date();
    return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  }
  const [rows] = await conn.query('SELECT year FROM year_frames WHERE id = ? LIMIT 1', [yearFrameId]);
  const raw = rows[0]?.year || '';
  const yy = parseInt(String(raw).replace(/\D/g, ''), 10);
  if (Number.isFinite(yy)) return yy >= 100 ? yy : 2000 + yy;
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

function readReimbDetailMeta(remarks) {
  const text = normText(remarks);
  const idx = text.indexOf(REIMB_DETAIL_META_MARKER);
  if (idx < 0) return {};
  try {
    const parsed = JSON.parse(text.slice(idx + REIMB_DETAIL_META_MARKER.length).trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function expenseMonthsFromReimbursement(row, fiscalStartYear) {
  const meta = readReimbDetailMeta(row.remarks);
  const detailRows = Array.isArray(meta.rows) ? meta.rows.filter(Boolean) : [];
  const yms = new Set();
  detailRows.forEach((line) => {
    const amt = roundMoney2(line.subtotal);
    if (amt <= 0) return;
    const ym = fiscalMonthToYm(fiscalStartYear, line.cost_month);
    if (ym) yms.add(ym);
  });
  if (!yms.size) {
    const d = dateOnly(row.source_date || row.date);
    if (d && d.length >= 7) yms.add(d.slice(0, 7));
  }
  return [...yms].sort();
}

function expenseMonthsFromSource(sourceType, row, fiscalStartYear) {
  if (sourceType === 'reimbursement') return expenseMonthsFromReimbursement(row, fiscalStartYear);
  if (sourceType === 'logistics') {
    const ym = normalizeSettlementYm(row.settlement_month);
    if (ym) return [ym];
    if (row.monthly_settlement === 1 || row.monthly_settlement === true) return [];
    const d = dateOnly(row.shipping_date || row.source_date);
    return d && d.length >= 7 ? [d.slice(0, 7)] : [];
  }
  if (sourceType === 'warehouse') {
    const ym = warehouseMonthToExpenseYm(fiscalStartYear, row.warehouse_month || row.month || row.source_date);
    return ym ? [ym] : [];
  }
  const d = dateOnly(row.source_date || row.purchase_date || row.repair_date || row.date);
  return d && d.length >= 7 ? [d.slice(0, 7)] : [];
}

function reimburseLineDescription(line, row, costModuleLabel) {
  const desc = normText(line.description);
  if (desc) return cleanDescription(desc);
  return cleanDescription(
    ['成本登记', costModuleLabel, visibleReimbursementRemarks(row.remarks)].filter(Boolean).join(' '),
  );
}

/** 品牌优先从项目编号推导（PHD / X.O / CLUB），避免明细行默认「内部」 */
function resolveCandidateBrand(lineBrand, projectCode, recordBrand) {
  const pc = normText(projectCode);
  const fromPc = extractBrandFromProjectCode(pc);
  if (fromPc) return fromPc;
  const fromLine = normText(lineBrand);
  if (fromLine && fromLine !== '内部') {
    const bucket = extractBrandFromProjectCode(fromLine);
    return bucket || fromLine;
  }
  const rec = normText(recordBrand);
  if (rec && rec !== '内部') {
    const bucket = extractBrandFromProjectCode(rec);
    return bucket || rec;
  }
  return fromLine || rec || '';
}

function buildReimbursementCandidates(row, fiscalStartYear, query) {
  const costModuleLabel = COST_MODULE_LABELS[row.cost_module] || normText(row.cost_module);
  const meta = readReimbDetailMeta(row.remarks);
  const detailRows = (Array.isArray(meta.rows) ? meta.rows.filter(Boolean) : [])
    .filter((line) => roundMoney2(line.subtotal) > 0);
  const base = {
    source_type: 'reimbursement',
    source_label: '成本登记',
    source_id: Number(row.source_id),
    payee_name: normText(row.payee_name),
    payment_status: row.payment_status || 'unpaid',
    source_date: sourceDateForItem({ source_date: row.source_date }),
    brand: normText(row.brand),
    project_code: normText(row.project_code),
    city: normText(row.city),
  };

  if (!detailRows.length) {
    const expenseYms = expenseMonthsFromReimbursement(row, fiscalStartYear);
    const item = {
      ...base,
      brand: resolveCandidateBrand(base.brand, base.project_code, ''),
      amount: round2(row.amount),
      description: cleanDescription(
        ['成本登记', costModuleLabel, visibleReimbursementRemarks(row.remarks)].filter(Boolean).join(' '),
      ),
      expense_yms: expenseYms,
      expense_ym: expenseYms[0] || '',
      candidate_key: `reimbursement:${row.source_id}`,
    };
    return candidateMatches(item, query) ? [item] : [];
  }

  const out = [];
  detailRows.forEach((line, idx) => {
    const ym = fiscalMonthToYm(fiscalStartYear, line.cost_month)
      || (dateOnly(row.source_date) || '').slice(0, 7)
      || '';
    const expenseYms = ym ? [ym] : [];
    const linePc = normText(line.project_code) || base.project_code;
    const item = {
      ...base,
      line_index: idx,
      brand: resolveCandidateBrand(line.brand, linePc, base.brand),
      project_code: linePc,
      amount: round2(line.subtotal),
      description: reimburseLineDescription(line, row, costModuleLabel),
      expense_yms: expenseYms,
      expense_ym: ym,
      source_date: sourceDateForItem({ source_date: row.source_date, expense_ym: ym }),
      candidate_key: `reimbursement:${row.source_id}:line:${idx}`,
    };
    if (candidateMatches(item, query)) out.push(item);
  });
  return out;
}

function candidateKeyFromInput(x) {
  if (normText(x.candidate_key)) return normText(x.candidate_key);
  if (String(x.source_type) === 'reimbursement' && Number.isFinite(Number(x.line_index))) {
    return `reimbursement:${Number(x.source_id)}:line:${Number(x.line_index)}`;
  }
  return `${x.source_type}:${Number(x.source_id)}`;
}

async function shouldMarkReimbursementPaid(sourceId, selectedRows, conn) {
  const selForSource = selectedRows.filter(
    (r) => r.source_type === 'reimbursement' && Number(r.source_id) === Number(sourceId),
  );
  if (!selForSource.length) return false;
  const [recRows] = await conn.query(
    'SELECT amount, remarks FROM reimbursements WHERE id = ? LIMIT 1',
    [sourceId],
  );
  if (!recRows.length) return false;
  const rec = recRows[0];
  const meta = readReimbDetailMeta(rec.remarks);
  const detailRows = (Array.isArray(meta.rows) ? meta.rows.filter(Boolean) : [])
    .filter((line) => roundMoney2(line.subtotal) > 0);
  const fullAmt = round2(rec.amount);
  const selAmt = round2(selForSource.reduce((s, row) => s + round2(row.amount), 0));
  if (!detailRows.length) {
    return selForSource.length === 1 && Math.abs(selAmt - fullAmt) < 0.02;
  }
  const selectedIndices = new Set(selForSource.map((r) => Number(r.line_index)));
  const allCovered = detailRows.every((_, idx) => selectedIndices.has(idx));
  return allCovered && Math.abs(selAmt - fullAmt) < 0.02;
}

function candidateMatches(row, q) {
  const keyword = normText(q.keyword).toLowerCase();
  if (q.payee) {
    const needle = normText(q.payee).toLowerCase();
    const hay = normText(row.payee_name).toLowerCase();
    if (!needle || !hay.includes(needle)) return false;
  }
  if (q.brand && normText(row.brand) !== normText(q.brand)) return false;
  if (q.sourceType && row.source_type !== q.sourceType) return false;
  if (q.projectCode && !normText(row.project_code).includes(normText(q.projectCode))) return false;
  if (q.expenseYm) {
    const yms = Array.isArray(row.expense_yms) ? row.expense_yms : [];
    if (!yms.includes(q.expenseYm)) return false;
  }
  if (q.dateFrom && row.source_date && row.source_date < q.dateFrom) return false;
  if (q.dateTo && row.source_date && row.source_date > q.dateTo) return false;
  if (!keyword) return true;
  return [
    row.payee_name,
    row.brand,
    row.project_code,
    row.city,
    row.description,
    row.source_label,
    row.source_id,
  ].some((x) => normText(x).toLowerCase().includes(keyword));
}

function sortCandidates(rows) {
  return rows.sort((a, b) => {
    const ad = a.source_date || '';
    const bd = b.source_date || '';
    if (ad !== bd) return bd.localeCompare(ad);
    return String(a.source_type).localeCompare(String(b.source_type)) || Number(b.source_id) - Number(a.source_id);
  });
}

async function fetchCandidates(query, conn = db) {
  const yearFrameId = parseInt(query.yearFrameId, 10);
  const fiscalStartYear = await fiscalStartYearFromYearFrameId(yearFrameId, conn);
  const payeeNeedle = normText(query.payee);
  const payeeLike = payeeNeedle ? `%${payeeNeedle}%` : null;
  const baseParams = [];
  const yearWhere = Number.isFinite(yearFrameId) ? ' AND {alias}.year_frame_id = ?' : '';
  if (Number.isFinite(yearFrameId)) baseParams.push(yearFrameId);
  const payeeWhere = payeeLike ? ' AND {alias}.payee_name LIKE ?' : '';

  const queries = [
    {
      type: 'warehouse',
      label: '仓储成本',
      sql: `
        SELECT w.id source_id, w.payee_name, COALESCE(w.payment_status, 'unpaid') payment_status,
               w.month source_date, w.month warehouse_month, w.brand, act.project_code project_code, NULL city,
               w.actual_cost amount,
               CONCAT('仓储 ', COALESCE(w.region, ''), ' ', COALESCE(w.wine_name, ''), ' ', COALESCE(w.remarks, '')) description
        FROM warehouse w
        LEFT JOIN activities act ON act.id = w.activity_id
        WHERE COALESCE(w.payment_status, 'unpaid') <> 'paid' AND COALESCE(w.actual_cost, 0) > 0
          AND (w.payment_order_id IS NULL OR w.payment_order_id = 0)
        ${yearWhere.replaceAll('{alias}', 'w')}${payeeWhere.replaceAll('{alias}', 'w')}
      `,
    },
    {
      type: 'logistics',
      label: '物流成本',
      sql: `
        SELECT l.id source_id, l.payee_name, COALESCE(l.payment_status, 'unpaid') payment_status,
               COALESCE(l.shipping_date, CONCAT(l.settlement_month, '-01')) source_date,
               l.shipping_date, l.settlement_month, l.monthly_settlement,
               l.brand, COALESCE(act.project_code, l.related_project_code) project_code, l.destination_city city,
               l.fee amount,
               CONCAT(COALESCE(l.logistics_company, ''), ' ', COALESCE(l.express_company, ''), ' ', COALESCE(l.tracking_number, ''), ' ', COALESCE(l.remarks, '')) description
        FROM logistics l
        LEFT JOIN activities act ON act.id = l.activity_id
        WHERE COALESCE(l.payment_status, 'unpaid') <> 'paid' AND COALESCE(l.fee, 0) > 0
          AND (l.payment_order_id IS NULL OR l.payment_order_id = 0)
        ${yearWhere.replaceAll('{alias}', 'l')}${payeeWhere.replaceAll('{alias}', 'l')}
      `,
    },
    {
      type: 'material_purchase',
      label: '物料采购',
      sql: `
        SELECT mp.id source_id, mp.payee_name, COALESCE(mp.payment_status, 'unpaid') payment_status,
               mp.purchase_date source_date, COALESCE(bi.brand_code, bi.brand_name) brand,
               act.project_code project_code, NULL city, mp.total_amount amount,
               CONCAT('物料采购 ', COALESCE(mp.remarks, '')) description
        FROM material_purchases mp
        LEFT JOIN brand_inventory bi ON bi.id = mp.brand_id
        LEFT JOIN activities act ON act.id = mp.activity_id
        WHERE COALESCE(mp.payment_status, 'unpaid') <> 'paid' AND COALESCE(mp.total_amount, 0) > 0
          AND (mp.payment_order_id IS NULL OR mp.payment_order_id = 0)
        ${yearWhere.replaceAll('{alias}', 'mp')}${payeeWhere.replaceAll('{alias}', 'mp')}
      `,
    },
    {
      type: 'prop_repair',
      label: '道具维修',
      sql: `
        SELECT pr.id source_id, pr.payee_name, COALESCE(pr.payment_status, 'unpaid') payment_status,
               pr.repair_date source_date, COALESCE(bi.brand_code, bi.brand_name) brand,
               act.project_code project_code, pr.region city, pr.total_amount amount,
               CONCAT('道具维修 ', COALESCE(pr.region, ''), ' ', COALESCE(pr.remarks, '')) description
        FROM prop_repairs pr
        LEFT JOIN brand_inventory bi ON bi.id = pr.brand_id
        LEFT JOIN activities act ON act.id = pr.activity_id
        WHERE COALESCE(pr.payment_status, 'unpaid') <> 'paid' AND COALESCE(pr.total_amount, 0) > 0
          AND (pr.payment_order_id IS NULL OR pr.payment_order_id = 0)
        ${yearWhere.replaceAll('{alias}', 'pr')}${payeeWhere.replaceAll('{alias}', 'pr')}
      `,
    },
    {
      type: 'reimbursement',
      label: '成本登记',
      sql: `
        SELECT r.id source_id, r.payee_name, COALESCE(r.payment_status, 'unpaid') payment_status,
               r.date source_date, r.brand, COALESCE(act.project_code, r.related_project_code) project_code,
               r.city, r.amount, r.cost_module, r.remarks,
               CONCAT('成本登记 ', COALESCE(r.cost_module, ''), ' ', COALESCE(r.remarks, '')) description
        FROM reimbursements r
        LEFT JOIN activities act ON act.id = r.activity_id
        WHERE COALESCE(r.payment_status, 'unpaid') <> 'paid' AND COALESCE(r.amount, 0) > 0
          AND (r.payment_order_id IS NULL OR r.payment_order_id = 0)
        ${yearWhere.replaceAll('{alias}', 'r')}${payeeWhere.replaceAll('{alias}', 'r')}
      `,
    },
  ];

  const all = [];
  for (const q of queries) {
    const qParams = [...baseParams];
    if (payeeLike) qParams.push(payeeLike);
    const [rows] = await conn.query(q.sql, qParams);
    rows.forEach((row) => {
      if (q.type === 'reimbursement') {
        buildReimbursementCandidates(row, fiscalStartYear, query).forEach((item) => all.push(item));
        return;
      }
      const costModuleLabel = COST_MODULE_LABELS[row.cost_module] || normText(row.cost_module);
      const reimbursementDesc = q.type === 'reimbursement'
        ? ['成本登记', costModuleLabel, visibleReimbursementRemarks(row.remarks)].filter(Boolean).join(' ')
        : row.description;
      const expenseYms = expenseMonthsFromSource(q.type, row, fiscalStartYear);
      const item = {
        source_type: q.type,
        source_label: q.label,
        source_id: Number(row.source_id),
        payee_name: normText(row.payee_name),
        payment_status: row.payment_status || 'unpaid',
        source_date: sourceDateForItem({ source_date: row.source_date, expense_ym: expenseYms[0] }),
        brand: normText(row.brand),
        project_code: normText(row.project_code),
        city: normText(row.city),
        amount: round2(row.amount),
        description: cleanDescription(reimbursementDesc),
        expense_yms: expenseYms,
        expense_ym: expenseYms[0] || '',
        candidate_key: `${q.type}:${row.source_id}`,
      };
      if (candidateMatches(item, query)) all.push(item);
    });
  }
  return sortCandidates(all);
}

async function fetchSelectedCandidates(items, yearFrameId, conn) {
  const wanted = new Set(
    (items || [])
      .filter((x) => SOURCE_TYPES.has(String(x.source_type)) && Number.isFinite(Number(x.source_id)))
      .map((x) => candidateKeyFromInput(x)),
  );
  const rows = await fetchCandidates({ yearFrameId }, conn);
  return rows.filter((row) => wanted.has(row.candidate_key || `${row.source_type}:${row.source_id}`));
}

function requireSamePayee(rows, explicitPayee) {
  const names = [...new Set(rows.map((x) => normText(x.payee_name)).filter(Boolean))];
  if (explicitPayee && names.some((x) => x !== explicitPayee)) {
    const e = new Error('所选记录收款方与付款单收款方不一致');
    e.statusCode = 400;
    throw e;
  }
  if (!explicitPayee && names.length !== 1) {
    const e = new Error('请选择同一收款方的记录；旧数据缺少收款方时请先补填');
    e.statusCode = 400;
    throw e;
  }
  return explicitPayee || names[0];
}

function consolidateSelectedItems(selected) {
  const map = new Map();
  (selected || []).forEach((row) => {
    const key = `${row.source_type}:${row.source_id}`;
    if (map.has(key)) {
      const existing = map.get(key);
      existing.amount = round2(existing.amount + round2(row.amount));
    } else {
      map.set(key, { ...row, amount: round2(row.amount) });
    }
  });
  return [...map.values()];
}

async function linkSourcesToOrder(orderId, selected, conn) {
  const seen = new Set();
  for (const row of selected) {
    const key = `${row.source_type}:${row.source_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const table = SOURCE_TABLES[row.source_type];
    if (!table) continue;
    const [ret] = await conn.query(
      `UPDATE ${table} SET payment_order_id = ?
       WHERE id = ? AND COALESCE(payment_status, 'unpaid') <> 'paid'
         AND (payment_order_id IS NULL OR payment_order_id = 0)`,
      [orderId, row.source_id],
    );
    if (!ret.affectedRows) {
      const e = new Error(`来源记录 ${row.source_type}#${row.source_id} 已被其它付款单占用或已支付`);
      e.statusCode = 400;
      throw e;
    }
  }
}

async function markOrderSourcesPaid(orderId, conn) {
  const [items] = await conn.query(
    'SELECT source_type, source_id FROM payment_order_items WHERE payment_order_id = ?',
    [orderId],
  );
  for (const item of items) {
    const table = SOURCE_TABLES[item.source_type];
    if (!table) continue;
    await conn.query(
      `UPDATE ${table} SET payment_status = 'paid', paid_at = NOW()
       WHERE id = ? AND payment_order_id = ? AND COALESCE(payment_status, 'unpaid') <> 'paid'`,
      [item.source_id, orderId],
    );
    if (item.source_type === 'reimbursement') {
      await conn.query(
        `UPDATE reimbursements SET claim_status = 'paid' WHERE id = ? AND payment_order_id = ?`,
        [item.source_id, orderId],
      );
    }
  }
}

async function rollbackOrderSourcesToUnpaid(orderId, items, conn) {
  for (const item of items) {
    const table = SOURCE_TABLES[item.source_type];
    if (!table) continue;
    await conn.query(
      `UPDATE ${table} SET payment_status = 'unpaid', payment_order_id = NULL, paid_at = NULL
       WHERE id = ? AND payment_order_id = ?`,
      [item.source_id, orderId],
    );
    if (item.source_type === 'reimbursement') {
      await conn.query(
        `UPDATE reimbursements SET claim_status = 'submitted' WHERE id = ? AND claim_status = 'paid'`,
        [item.source_id],
      );
    }
  }
}

module.exports = {
  COST_MODULE_LABELS,
  REIMB_DETAIL_META_MARKER,
  SOURCE_TABLES,
  SOURCE_TYPES,
  buildReimbursementCandidates,
  candidateKeyFromInput,
  candidateMatches,
  cleanDescription,
  consolidateSelectedItems,
  dateOnly,
  expenseMonthsFromReimbursement,
  expenseMonthsFromSource,
  fetchCandidates,
  fetchSelectedCandidates,
  fiscalMonthToYm,
  fiscalStartYearFromYearFrameId,
  linkSourcesToOrder,
  markOrderSourcesPaid,
  normText,
  normalizeDbDate,
  normalizeSettlementYm,
  readReimbDetailMeta,
  reimburseLineDescription,
  requireSamePayee,
  resolveCandidateBrand,
  rollbackOrderSourcesToUnpaid,
  round2,
  roundMoney2,
  shouldMarkReimbursementPaid,
  sortCandidates,
  sourceDateForItem,
  visibleReimbursementRemarks,
  warehouseMonthToExpenseYm,
};
