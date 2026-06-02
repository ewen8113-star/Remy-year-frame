const {
  blockLabel,
  categoryLabel,
  claimStatusLabel,
  brandYearFrameCode,
  REIMB_DETAIL_CATEGORY_OPTIONS,
} = require('./exportLabels');
const {
  enrichDetailRowsWithMergeSources,
  lineProjectForRow,
  brandsLabelFromRows,
} = require('./enrichDetailRows');

const META_MARKER = '[REIMB_DETAIL_JSON]';

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function visibleRemarks(raw) {
  const text = raw != null ? String(raw) : '';
  const idx = text.indexOf(META_MARKER);
  return idx >= 0 ? text.slice(0, idx).trim() : text.trim();
}

function parseCostDetails(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function detailRowsFromCostDetails(r) {
  const parsed = parseCostDetails(r.cost_details);
  const invoices = Array.isArray(r.invoices) ? r.invoices : [];
  const hasInvoice = !!(r.has_invoice === 1 || r.has_invoice === true);
  return Object.entries(parsed)
    .filter(([key, value]) => key !== 'advance_offset' && round2(value) > 0)
    .map(([key, value], idx) => {
      const block =
        Object.keys(REIMB_DETAIL_CATEGORY_OPTIONS).find((b) =>
          (REIMB_DETAIL_CATEGORY_OPTIONS[b] || []).some(([cat]) => cat === key),
        ) || 'personnel';
      const amt = round2(value);
      const inv = invoices.length === 1 ? invoices[0] : invoices[idx] || null;
      return {
        brand: String(r.brand || '').trim(),
        block,
        category: key,
        quantity: 1,
        unit_price: amt,
        subtotal: amt,
        invoice: hasInvoice ? '有' : '无',
        invoice_no: inv?.invoice_no || '',
        invoice_date: inv?.invoice_date || '',
        description: inv?.invoice_content || '',
      };
    });
}

function readDetailMeta(raw) {
  const text = raw != null ? String(raw) : '';
  const idx = text.indexOf(META_MARKER);
  if (idx < 0) return { rows: [], advance_amount: 0, use_advance: false };
  try {
    const meta = JSON.parse(text.slice(idx + META_MARKER.length).trim()) || {};
    return {
      rows: Array.isArray(meta.rows) ? meta.rows : [],
      advance_amount: round2(meta.advance_amount),
      use_advance: !!meta.use_advance,
      payment_date: meta.payment_date || null,
    };
  } catch {
    return { rows: [], advance_amount: 0, use_advance: false };
  }
}

/**
 * @param {object} r reimbursements 表行（已序列化）
 */
function payloadFromReimbursementRecord(r) {
  const meta = readDetailMeta(r.remarks);
  const payee = String(r.payee_name || '').trim();
  const projectCode = String(r.related_project_code || '').trim();
  const brand = String(r.brand || '').trim();
  const metaRows = Array.isArray(meta.rows) ? meta.rows.filter(Boolean) : [];
  const rawRows = metaRows.length ? metaRows : detailRowsFromCostDetails(r);
  const enrichedRows = enrichDetailRowsWithMergeSources(rawRows, meta);
  const detailRows = enrichedRows.map((row) => {
    const lineProject =
      lineProjectForRow(row, projectCode, brand)
      || brandYearFrameCode(brand)
      || String(row.brand || '').trim()
      || '';
    return {
      ...row,
      block_label: blockLabel(row.block),
      category_label: categoryLabel(row.block, row.category),
      line_project: lineProject || '—',
      subtotal: round2(row.subtotal),
      invoice: row.invoice === '无' ? '无' : '有',
      applicant: String(row.applicant || payee || '').trim(),
    };
  });

  const gross = round2(detailRows.reduce((s, row) => s + round2(row.subtotal), 0));
  const amount = round2(r.amount);
  const brandsLabel = brandsLabelFromRows(detailRows, brand);

  return {
    id: r.id,
    date: r.date ? String(r.date).slice(0, 10) : '',
    remarks: visibleRemarks(r.remarks),
    brand: brandsLabel || brand || '按明细行归属',
    payee_name: payee || '—',
    project_code: projectCode,
    payment_type: r.payment_type || 'personal_reimbursement',
    cost_module: r.cost_module || 'activity',
    claim_status: r.claim_status || 'draft',
    claim_status_label: claimStatusLabel(r.claim_status),
    merged_into_activity: !!(r.merged_into_activity === 1 || r.merged_into_activity === true),
    advance_amount: round2(meta.advance_amount),
    amount,
    gross_total: gross > 0 ? gross : amount,
    detail_rows: detailRows,
    has_invoice: !!(r.has_invoice === 1 || r.has_invoice === true),
  };
}

module.exports = {
  payloadFromReimbursementRecord,
  readDetailMeta,
  visibleRemarks,
};
