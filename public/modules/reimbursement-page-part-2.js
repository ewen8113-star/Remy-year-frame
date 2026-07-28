function reimbBrandsLabelFromRows(rows, fallbackBrand) {
  const brands = new Set();
  (rows || []).forEach((row) => {
    const pc = String(row.project_code || row.line_project || '').trim();
    const fromPc = extractBrandFromProjectCode(pc);
    if (fromPc) brands.add(fromPc);
    else {
      const b = String(row.brand || '').trim();
      if (b && b !== '内部') brands.add(b);
    }
  });
  const fb = String(fallbackBrand || '').trim();
  if (!brands.size && fb && fb !== '内部') {
    fb.split(/[,，、/]+/).forEach((p) => {
      const t = p.trim();
      if (t) brands.add(t);
    });
  }
  if (!brands.size) return '';
  return [...brands]
    .sort((a, b) => {
      const ia = REIMB_BRAND_SORT_ORDER.indexOf(a);
      const ib = REIMB_BRAND_SORT_ORDER.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b, 'zh-CN');
    })
    .join('，');
}

/** 合并报销：按 merge_sources 为各行补回来源项目编号 */
function reimbEnrichDetailRowsWithMergeSources(rows, meta) {
  const list = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [];
  const sources = Array.isArray(meta?.merge_sources) ? meta.merge_sources : [];
  if (!sources.length) return list;
  if (!list.some((r) => reimbIsPlaceholderProjectCode(r.project_code || r.line_project))) return list;

  const enriched = [];
  let rowIdx = 0;
  sources.forEach((src) => {
    const srcMeta = reimbReadDetailMeta(src.remarks || '');
    const srcRows = Array.isArray(srcMeta.rows) ? srcMeta.rows.filter(Boolean) : [];
    const srcRowCount = srcRows.length || 1;
    const pc = String(src.related_project_code || '').trim();
    const pcBrand = extractBrandFromProjectCode(pc);
    for (let i = 0; i < srcRowCount && rowIdx < list.length; i += 1) {
      const row = list[rowIdx];
      const existingPc = String(row.project_code || row.line_project || '').trim();
      const usePc = reimbIsPlaceholderProjectCode(existingPc) ? pc : existingPc;
      enriched.push({
        ...row,
        project_code: usePc || row.project_code,
        brand: (!row.brand || row.brand === '内部') && pcBrand ? pcBrand : row.brand,
      });
      rowIdx += 1;
    }
  });
  while (rowIdx < list.length) {
    enriched.push(list[rowIdx]);
    rowIdx += 1;
  }
  return enriched.length ? enriched : list;
}

function reimbCostMonthFromDateStr(dateStr) {
  const d = String(dateStr || '').slice(0, 10);
  if (d.length >= 7) {
    const m = parseInt(d.slice(5, 7), 10);
    if (Number.isFinite(m) && m >= 1 && m <= 12) return m;
  }
  return null;
}

/** 从合并快照单条来源还原明细行（保留费用归属月、项目编号） */
function reimbMergeSourceDetailRows(src) {
  if (!src) return [];
  const pc = String(src.related_project_code || '').trim();
  const pcBrand = extractBrandFromProjectCode(pc);
  const stamp = (row) => ({
    ...row,
    project_code: String(row.project_code || row.line_project || '').trim() || pc,
    brand: (!row.brand || row.brand === '内部') && pcBrand ? pcBrand : row.brand,
  });

  if (Array.isArray(src.detail_rows) && src.detail_rows.length) {
    return src.detail_rows.filter(Boolean).map(stamp);
  }

  const srcMeta = reimbReadDetailMeta(src.remarks || '');
  if (Array.isArray(srcMeta.rows) && srcMeta.rows.length) {
    return srcMeta.rows.filter(Boolean).map(stamp);
  }

  return reimbDetailRowsFromCostDetails({
    cost_details: src.cost_details,
    brand: src.brand,
    has_invoice: src.has_invoice,
    invoices: src.invoices,
    date: src.date,
  }).map(stamp);
}

/** 合并记录：按 merge_sources 逐条展开，不按类别汇总 */
function reimbDetailRowsFromMergeSources(meta) {
  const sources = Array.isArray(meta?.merge_sources) ? meta.merge_sources : [];
  if (sources.length < 2) return [];
  const rows = [];
  sources.forEach((src) => {
    reimbMergeSourceDetailRows(src).forEach((row) => {
      const subtotal = roundMoney2(row.subtotal);
      const qty = roundMoney2(row.quantity);
      const price = roundMoney2(row.unit_price);
      if (subtotal <= 0 && qty * price <= 0) return;
      rows.push(row);
    });
  });
  return rows;
}

function reimbSortDetailRowsByProject(rows) {
  return [...(rows || [])].sort((a, b) => {
    const pa = String(a.project_code || '').localeCompare(String(b.project_code || ''), 'zh-CN');
    if (pa) return pa;
    const ma = parseInt(a.cost_month, 10) || 0;
    const mb = parseInt(b.cost_month, 10) || 0;
    if (ma !== mb) return ma - mb;
    return String(a.category || '').localeCompare(String(b.category || ''), 'zh-CN');
  });
}

/** remarks 无明细 JSON 时，从 cost_details / 发票字段还原行（兼容旧数据） */
function reimbDetailRowsFromCostDetails(r) {
  if (!r) return [];
  const parsed = reimbParseJsonObject(r.cost_details || {});
  const legacyBrand = r.brand ? reimbDetailBrandFromLegacyBrand(r.brand) : '';
  const invoices = Array.isArray(r.invoices) ? r.invoices : [];
  const hasInvoice = !!(r.has_invoice === 1 || r.has_invoice === true);
  return Object.entries(parsed)
    .filter(([key, value]) => key !== 'advance_offset' && roundMoney2(value) > 0)
    .map(([key, value], idx) => {
      const block =
        Object.keys(REIMB_DETAIL_CATEGORY_OPTIONS).find((b) =>
          (REIMB_DETAIL_CATEGORY_OPTIONS[b] || []).some(([cat]) => cat === key),
        ) || 'personnel';
      const amt = roundMoney2(value);
      const inv = invoices.length === 1 ? invoices[0] : invoices[idx] || null;
      return {
        brand: legacyBrand || '',
        block,
        category: key,
        quantity: 1,
        unit_price: amt,
        subtotal: amt,
        invoice: hasInvoice ? '有' : '无',
        cost_month: reimbCostMonthFromDateStr(r.date) ?? reimbDefaultCostMonth(),
        invoice_no: inv?.invoice_no || '',
        invoice_date: inv?.invoice_date || '',
        description: inv?.invoice_content || '',
      };
    });
}

/** 明细行：合并记录优先按 merge_sources 展开；否则 remarks JSON；缺失时从 cost_details 还原 */
function reimbResolveDetailRowsFromRecord(r, meta) {
  const m = meta || reimbReadDetailMeta(r?.remarks || '');
  const fromMerge = reimbDetailRowsFromMergeSources(m);
  if (fromMerge.length) return fromMerge;

  const metaRows = Array.isArray(m?.rows) ? m.rows.filter(Boolean) : [];
  const raw = metaRows.length ? metaRows : reimbDetailRowsFromCostDetails(r);
  return reimbEnrichDetailRowsWithMergeSources(raw, m);
}

const REIMB_PAYMENT_METHOD_OPTIONS = [
  { value: 'bank_transfer', label: '银行汇款' },
  { value: 'wechat_alipay', label: '微信/支付宝' },
  { value: 'platform', label: '平台' },
];

function reimbPaymentMethodLabel(v) {
  const hit = REIMB_PAYMENT_METHOD_OPTIONS.find((x) => x.value === v);
  return hit ? hit.label : v || '—';
}

function reimbPaymentMethodOptionsHtml(selected) {
  return REIMB_PAYMENT_METHOD_OPTIONS.map(
    (x) => `<option value="${x.value}" ${x.value === selected ? 'selected' : ''}>${escapeHtml(x.label)}</option>`,
  ).join('');
}

function reimbRefreshClaimStatusOptions() {
  const sel = document.getElementById('reimbClaimStatus');
  const paymentType = document.getElementById('reimbPaymentType')?.value || 'personal_reimbursement';
  if (!sel) return;
  const cur = sel.value || 'draft';
  const opts = reimbClaimStatusOptionsForRecord({ payment_type: paymentType });
  sel.innerHTML = opts
    .map((x) => `<option value="${x.value}" ${x.value === cur ? 'selected' : ''}>${escapeHtml(x.label)}</option>`)
    .join('');
  reimbClaimStatusChanged();
}
