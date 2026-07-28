async function reimbUpsertPersonalPayeeDict(payeeName, paymentMethod, bankName, bankAccount) {
  if (!payeeName || !paymentMethod) return;
  try {
    const suppliers = await api('GET', '/dict?category=supplier');
    if (reimbIsCompanyPayeeName(payeeName, reimbBuildSupplierNameSet(suppliers))) return;
  } catch (_) {
    if (reimbLooksLikeCompanyName(payeeName)) return;
  }
  const content = {
    payee_name: payeeName,
    payment_method: paymentMethod,
    bank_name: paymentMethod === 'bank_transfer' ? bankName || '' : '',
    bank_account: paymentMethod === 'bank_transfer' ? bankAccount || '' : '',
  };
  try {
    const rows = await api('GET', `/dict?category=personal_payee&q=${encodeURIComponent(payeeName)}`);
    const list = Array.isArray(rows) ? rows : [];
    const existing = list.find((e) => {
      const c = e.content || {};
      if (String(c.payee_name || e.name || '').trim() !== payeeName) return false;
      if (String(c.payment_method || '') !== paymentMethod) return false;
      if (paymentMethod === 'bank_transfer') {
        return String(c.bank_account || '').trim() === String(bankAccount || '').trim();
      }
      return true;
    });
    if (existing) {
      await api('PUT', `/dict/${existing.id}`, {
        category: 'personal_payee',
        name: payeeName,
        content,
        is_active: true,
      });
      await api('POST', `/dict/${existing.id}/touch`);
    } else {
      await api('POST', '/dict', {
        category: 'personal_payee',
        name: payeeName,
        content,
      });
    }
  } catch (_) {
    /* 字典写入失败不阻断保存 */
  }
}

/** 合并结果是否含可撤销的快照（新版合并会写入 merge_sources） */
function reimbCanUnmerge(r) {
  if (!r) return false;
  if (String(r.payment_status || 'unpaid').toLowerCase() === 'paid') return false;
  if (r.payment_order_id) return false;
  const claim = String(r.claim_status || 'draft');
  if (claim === 'paid' || claim === 'reimbursed') return false;
  if (r.merged_into_activity === 1 || r.merged_into_activity === true) return false;
  const meta = reimbReadDetailMeta(r.remarks || '');
  return Array.isArray(meta.merge_sources) && meta.merge_sources.length >= 2;
}

/** 保存合并前各条记录的完整快照，供撤销合并时恢复（仅存 detail_rows，避免 remarks 嵌套过大） */
function reimbBuildMergeSourceSnapshot(r) {
  if (!r) return null;
  const meta = reimbReadDetailMeta(r.remarks || '');
  const pc = String(r.related_project_code || '').trim();
  const pcBrand = extractBrandFromProjectCode(pc);
  let detail_rows = Array.isArray(meta.rows) ? meta.rows.filter(Boolean) : [];
  if (!detail_rows.length) {
    detail_rows = reimbDetailRowsFromCostDetails(r);
  }
  detail_rows = detail_rows.map((row) => ({
    ...row,
    project_code: String(row.project_code || row.line_project || '').trim() || pc,
    brand: (!row.brand || row.brand === '内部') && pcBrand ? pcBrand : row.brand,
  }));
  return {
    source_id: r.id,
    year_frame_id: r.year_frame_id,
    activity_id: r.activity_id,
    reimbursement_type: r.reimbursement_type,
    payment_type: r.payment_type || 'personal_reimbursement',
    cost_module: r.cost_module || 'activity',
    claim_status: r.claim_status || 'draft',
    city: r.city,
    brand: r.brand,
    payee_name: r.payee_name,
    payment_method: r.payment_method || null,
    payee_bank_name: r.payee_bank_name || null,
    payee_bank_account: r.payee_bank_account || null,
    payment_status: r.payment_status || 'unpaid',
    amount: r.amount,
    cost_details: reimbParseJsonObject(r.cost_details),
    merged_into_activity: r.merged_into_activity === 1 || r.merged_into_activity === true ? 1 : 0,
    has_invoice: r.has_invoice === 1 || r.has_invoice === true ? 1 : 0,
    invoices: Array.isArray(r.invoices) ? r.invoices : [],
    date: r.date ? String(r.date).slice(0, 10) : '',
    related_project_code: r.related_project_code,
    props: r.props,
    printing: r.printing,
    express: r.express,
    other: r.other,
    remarks: reimbVisibleRemarks(r.remarks || ''),
    detail_rows,
    use_advance: !!meta.use_advance,
    advance_amount: roundMoney2(meta.advance_amount),
    gross_total: roundMoney2(meta.gross_total),
    payment_date: meta.payment_date || '',
  };
}

function reimbCategoryOptionsHtml(block, selected) {
  const opts = REIMB_DETAIL_CATEGORY_OPTIONS[block] || [];
  return opts
    .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
}

function reimbBlockOptionsHtml(selected) {
  return REIMB_DETAIL_BLOCKS
    .map((x) => `<option value="${x.value}" ${x.value === selected ? 'selected' : ''}>${x.label}</option>`)
    .join('');
}

let reimbDetailDefaultBrand = '内部';

function reimbBrandOptionsHtml(selected) {
  return REIMB_DETAIL_BRAND_OPTIONS
    .map((v) => `<option value="${escapeHtml(v)}" ${v === selected ? 'selected' : ''}>${escapeHtml(v)}</option>`)
    .join('');
}

function reimbNewDetailRowData(row, index) {
  const block = row?.block || 'personnel';
  const firstCategory = (REIMB_DETAIL_CATEGORY_OPTIONS[block] || [])[0]?.[0] || '';
  const rawBrand = row?.brand;
  const pcBrand = extractBrandFromProjectCode(row?.project_code || row?.line_project || '');
  const brand =
    typeof rawBrand === 'string' && rawBrand.trim() && rawBrand.trim() !== '内部'
      ? rawBrand.trim()
      : pcBrand || reimbDetailDefaultBrand || REIMB_DETAIL_BRAND_OPTIONS[3] || '内部';
  return {
    brand,
    project_code: row?.project_code || row?.line_project || '',
    block,
    category: row?.category || firstCategory,
    description: row?.description || '',
    quantity: row?.quantity || '',
    unit_price: row?.unit_price || '',
    invoice: row?.invoice || '有',
    invoice_date: row?.invoice_date || '',
    invoice_no: row?.invoice_no || '',
    cost_month: row?.cost_month != null && row?.cost_month !== '' ? parseInt(row.cost_month, 10) : reimbDefaultCostMonth(),
    applicant: row?.applicant || getCurrentUserName(),
    remarks: row?.remarks || '',
    _index: index,
  };
}

/** 报销明细单价：=178.8+167.2 回车求值（仅数字与 + - * / 括号） */
function reimbEvalPriceFormula(raw) {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('=')) return null;
  const expr = s.slice(1).trim().replace(/,/g, '');
  if (!expr || !/^[\d+\-*/().\s]+$/.test(expr)) return null;
  let result;
  try {
    result = Function('"use strict"; return (' + expr + ')')();
  } catch {
    return null;
  }
  if (!Number.isFinite(result)) return null;
  return roundMoney2(result);
}

function reimbReadLinePrice(inputEl) {
  const raw = String(inputEl?.value ?? '').trim();
  const fromFormula = reimbEvalPriceFormula(raw);
  if (fromFormula != null) return fromFormula;
  return roundMoney2(raw);
}

function reimbCommitLinePrice(inputEl, silent) {
  if (!inputEl) return false;
  const evaluated = reimbEvalPriceFormula(inputEl.value);
  if (evaluated == null) return false;
  inputEl.value = roundMoney2(evaluated).toFixed(2);
  reimbUpdateDetailTotals();
  if (!silent) showToast(`单价：${inputEl.value}`, 'success');
  return true;
}

function reimbLinePriceKeydown(ev) {
  if (ev.key !== 'Enter' || !ev.target?.classList?.contains('reimb-line-price')) return;
  const raw = String(ev.target.value || '').trim();
  if (!raw.startsWith('=')) return;
  ev.preventDefault();
  if (!reimbCommitLinePrice(ev.target, true)) {
    showToast('算式无效，示例：=178.8+167.2', 'warning');
  }
}

function reimbLinePriceBlur(ev) {
  const el = ev.target;
  if (!el?.classList?.contains('reimb-line-price')) return;
  if (String(el.value || '').trim().startsWith('=')) reimbCommitLinePrice(el, true);
}

function reimbDetailRowHtml(row, index) {
  const r = reimbNewDetailRowData(row, index);
  const pcAttr = escapeHtml(r.project_code || '');
  return `
    <tr class="reimb-detail-row" data-project-code="${pcAttr}">
      <td class="reimb-row-no">${index + 1}</td>
      <td class="reimb-col-brand"><select class="form-control reimb-line-brand" title="按品牌分摊年框">${reimbBrandOptionsHtml(r.brand)}</select></td>
      <td><select class="form-control reimb-line-block" onchange="reimbDetailBlockChanged(this)">${reimbBlockOptionsHtml(r.block)}</select></td>
      <td><select class="form-control reimb-line-category">${reimbCategoryOptionsHtml(r.block, r.category)}</select></td>
      <td><input type="text" class="form-control reimb-line-desc" value="${escapeHtml(r.description)}"></td>
      <td><input type="number" class="form-control reimb-line-qty" min="0" step="0.01" value="${escapeHtml(r.quantity)}" oninput="reimbUpdateDetailTotals()"></td>
      <td><input type="text" inputmode="decimal" class="form-control reimb-line-price" title="支持 =178.8+167.2 后回车求和" placeholder="=178+167" value="${escapeHtml(r.unit_price)}" oninput="reimbUpdateDetailTotals()" onkeydown="reimbLinePriceKeydown(event)" onblur="reimbLinePriceBlur(event)"></td>
      <td class="amount reimb-line-subtotal">¥0.00</td>
      <td class="reimb-col-cost-month"><select class="form-control reimb-line-cost-month" title="费用归属月份">${reimbCostMonthOptionsHtml(r.cost_month)}</select></td>
      <td>
        <select class="form-control reimb-line-invoice">
          <option value="有" ${r.invoice !== '无' ? 'selected' : ''}>有</option>
          <option value="无" ${r.invoice === '无' ? 'selected' : ''}>无</option>
        </select>
      </td>
      <td><input type="date" class="form-control reimb-line-invoice-date" value="${escapeHtml(r.invoice_date)}"></td>
      <td><input type="text" class="form-control reimb-line-invoice-no" value="${escapeHtml(r.invoice_no)}"></td>
      <td><input type="text" class="form-control reimb-line-applicant" value="${escapeHtml(r.applicant)}"></td>
      <td><input type="text" class="form-control reimb-line-remarks" value="${escapeHtml(r.remarks)}"></td>
      <td><button type="button" class="btn btn-secondary btn-sm" onclick="reimbRemoveDetailRow(this)">删</button></td>
    </tr>`;
}

function reimbAppendDetailRow(row = null) {
  const body = document.getElementById('reimbDetailRows');
  if (!body) return;
  body.insertAdjacentHTML('beforeend', reimbDetailRowHtml(row, body.querySelectorAll('.reimb-detail-row').length));
  reimbRenumberDetailRows();
  reimbUpdateDetailTotals();
}

function reimbRemoveDetailRow(btn) {
  const row = btn?.closest?.('.reimb-detail-row');
  if (row) row.remove();
  const body = document.getElementById('reimbDetailRows');
  if (body && !body.querySelector('.reimb-detail-row')) {
    for (let i = 0; i < 3; i += 1) reimbAppendDetailRow(null);
  }
  reimbRenumberDetailRows();
  reimbUpdateDetailTotals();
}

function reimbRenumberDetailRows() {
  document.querySelectorAll('#reimbDetailRows .reimb-detail-row').forEach((row, idx) => {
    const no = row.querySelector('.reimb-row-no');
    if (no) no.textContent = String(idx + 1);
  });
}

function reimbDetailBlockChanged(sel) {
  const row = sel?.closest?.('.reimb-detail-row');
  const cat = row?.querySelector?.('.reimb-line-category');
  if (!cat) return;
  cat.innerHTML = reimbCategoryOptionsHtml(sel.value, '');
}
