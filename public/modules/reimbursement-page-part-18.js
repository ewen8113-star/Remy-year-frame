function reimbursementCostStatExpenseMonths(sourceType, r) {
  if (sourceType === 'reimbursement') return reimbursementCostStatExpenseMonthsFromReimb(r);
  if (sourceType === 'logistics') {
    const ym = reimbursementNormalizeSettlementYm(r.settlement_month);
    if (ym) return [ym];
    const d = String(r.shipping_date || '').slice(0, 10);
    return d.length >= 7 ? [d.slice(0, 7)] : [];
  }
  if (sourceType === 'warehouse') {
    const ym = reimbursementWarehouseMonthToYm(r.month);
    return ym ? [ym] : [];
  }
  const d = String(r.purchase_date || r.repair_date || r.date || '').slice(0, 10);
  return d.length >= 7 ? [d.slice(0, 7)] : [];
}

function reimbursementCostStatExpenseYmLabel(yms) {
  const list = Array.isArray(yms) ? yms.filter(Boolean) : [];
  if (!list.length) return '—';
  if (list.length === 1) return list[0];
  return list.join('、');
}

function reimbursementCostStatBucketOptions(rows) {
  const set = new Set(['有项目编号', '无项目编号', '仓储费用']);
  (rows || []).forEach((r) => {
    const b = String(r.project_bucket || '').trim();
    if (b) set.add(b);
  });
  const order = ['有项目编号', '无项目编号', '仓储费用'];
  return [...set].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b, 'zh-CN');
  });
}

function reimbursementStatsFilterSourceRows() {
  const allRows = reimbursementBuildAllCostStatRows();
  const kw = reimbursementReadListFilterKeyword();
  return reimbursementFilterCostStatRows(allRows, kw);
}

function reimbursementApplyCostStatFilters(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const brand = String(reimbursementPageState.statsFilterBrand || '').trim();
  const bucket = String(reimbursementPageState.statsFilterBucket || '').trim();
  const month = String(reimbursementPageState.statsFilterMonth || '').trim();
  return list.filter((r) => {
    if (brand && String(r.brand || '').trim() !== brand) return false;
    if (bucket && String(r.project_bucket || '') !== bucket) return false;
    if (month) {
      const ym = String(r.expense_ym || '').trim();
      if (ym !== month) return false;
    }
    return true;
  });
}

function reimbursementStatsFilterBarHtml(sourceRows) {
  const brand = reimbursementPageState.statsFilterBrand || '';
  const bucket = reimbursementPageState.statsFilterBucket || '';
  const month = reimbursementPageState.statsFilterMonth || '';
  const kw = reimbursementReadListFilterKeyword();
  const brands = [...new Set((sourceRows || []).map((r) => String(r.brand || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const buckets = reimbursementCostStatBucketOptions(sourceRows);
  const brandOpts = ['<option value="">全部品牌</option>']
    .concat(brands.map((b) => `<option value="${escapeHtml(b)}"${b === brand ? ' selected' : ''}>${escapeHtml(b)}</option>`));
  const bucketOpts = ['<option value="">全部分类</option>']
    .concat(buckets.map((b) => `<option value="${escapeHtml(b)}"${b === bucket ? ' selected' : ''}>${escapeHtml(b)}</option>`));
  const hasExtra = !!(brand || bucket || month || kw);
  return `<div class="reimb-stats-filter-bar" role="search" aria-label="费用统计筛选">
    <label class="reimb-stats-filter-field">
      <span class="reimb-stats-filter-label">品牌</span>
      <select class="form-control reimb-stats-filter-control" id="reimbStatsFilterBrand" onchange="reimbursementStatsFilterChanged()">${brandOpts.join('')}</select>
    </label>
    <label class="reimb-stats-filter-field">
      <span class="reimb-stats-filter-label">分类</span>
      <select class="form-control reimb-stats-filter-control" id="reimbStatsFilterBucket" onchange="reimbursementStatsFilterChanged()">${bucketOpts.join('')}</select>
    </label>
    <label class="reimb-stats-filter-field">
      <span class="reimb-stats-filter-label">归属月</span>
      <input type="month" class="form-control reimb-stats-filter-control" id="reimbStatsFilterMonth" value="${escapeHtml(month)}" onchange="reimbursementStatsFilterChanged()">
    </label>
    <button type="button" class="btn btn-secondary btn-sm reimb-stats-filter-clear" onclick="reimbursementClearStatsFilters()"${hasExtra ? '' : ' disabled'}>清除筛选</button>
  </div>`;
}

function reimbursementStatsFilterChanged() {
  reimbursementPageState.statsFilterBrand = document.getElementById('reimbStatsFilterBrand')?.value || '';
  reimbursementPageState.statsFilterBucket = document.getElementById('reimbStatsFilterBucket')?.value || '';
  reimbursementPageState.statsFilterMonth = document.getElementById('reimbStatsFilterMonth')?.value || '';
  reimbursementPageState.statsCard = null;
  reimbursementClearStatsProjectExpansion();
  reimbursementRenderStatsBody();
}

function reimbursementClearStatsFilters() {
  reimbursementPageState.statsFilterBrand = '';
  reimbursementPageState.statsFilterBucket = '';
  reimbursementPageState.statsFilterMonth = '';
  reimbursementPageState.filterInput = '';
  reimbursementPageState.statsCard = null;
  reimbursementClearStatsProjectExpansion();
  reimbursementRenderListDom();
}

function reimbursementBuildCostStatsFilterDesc(kw, dataRows) {
  const parts = [];
  if (kw) parts.push(`关键词「${reimbursementPageState.filterInput || kw}」`);
  if (reimbursementPageState.statsFilterBrand) parts.push(`品牌「${reimbursementPageState.statsFilterBrand}」`);
  if (reimbursementPageState.statsFilterBucket) parts.push(`分类「${reimbursementPageState.statsFilterBucket}」`);
  if (reimbursementPageState.statsFilterMonth) parts.push(`归属月 ${reimbursementPageState.statsFilterMonth}`);
  if (!parts.length) return '当前未设置筛选（全部待统计费用；成本登记按明细行费用归属月拆分）';
  return `筛选 ${parts.join(' · ')} · 含成本登记 / 物流 / 仓储 / 物料 / 道具维修 · 共 ${dataRows.length} 笔（成本登记按明细行拆分）`;
}

function reimbursementBuildAllCostStatRows() {
  const out = [];
  const push = (row) => {
    if (!row || roundMoney2(row.amount) <= 0) return;
    out.push(row);
  };

  (reimbursementPageState.rows || []).forEach((r) => {
    reimbursementPushCostStatRowsFromReimbursement(r, push);
  });

  (reimbursementPageState.logistics || []).forEach((r) => {
    const pc = reimbursementCostStatProjectCode(r);
    const expenseYms = reimbursementCostStatExpenseMonths('logistics', r);
    push({
      key: `logistics:${r.id}`,
      source_type: 'logistics',
      source_label: '物流成本',
      amount: roundMoney2(r.fee),
      payee_name: String(r.payee_name || '').trim(),
      payment_status: r.payment_status || 'unpaid',
      project_code: pc,
      project_bucket: pc ? '有项目编号' : '无项目编号',
      brand: String(r.brand || '').trim(),
      city: String(r.destination_city || r.origin_city || '').trim(),
      remarks: String(r.remarks || '').trim(),
      line_description: reimbursementCostStatLogisticsDisplayText(r),
      module_label: '物流成本',
      party_label: '公司',
      expense_yms: expenseYms,
      expense_ym: expenseYms[0] || '',
    });
  });

  (reimbursementPageState.warehouse || []).forEach((r) => {
    if (r.no_actual_cost === true || r.no_actual_cost === 1 || String(r.no_actual_cost) === '1') return;
    const amt = roundMoney2(r.actual_cost);
    const pc = reimbursementCostStatProjectCode(r);
    const expenseYms = reimbursementCostStatExpenseMonths('warehouse', r);
    push({
      key: `warehouse:${r.id}`,
      source_type: 'warehouse',
      source_label: '仓储成本',
      amount: amt,
      payee_name: String(r.payee_name || '').trim(),
      payment_status: r.payment_status || 'unpaid',
      project_code: pc,
      project_bucket: '仓储费用',
      brand: String(r.brand || '').trim(),
      city: String(r.region || '').trim(),
      remarks: String(r.remarks || '').trim(),
      module_label: '仓储成本',
      party_label: '公司',
      expense_yms: expenseYms,
      expense_ym: expenseYms[0] || '',
    });
  });

  (reimbursementPageState.materialPurchases || []).forEach((r) => {
    const pc = reimbursementCostStatProjectCode(r);
    const expenseYms = reimbursementCostStatExpenseMonths('material_purchase', r);
    push({
      key: `material_purchase:${r.id}`,
      source_type: 'material_purchase',
      source_label: '物料采购',
      amount: roundMoney2(r.total_amount),
      payee_name: String(r.payee_name || '').trim(),
      payment_status: r.payment_status || 'unpaid',
      project_code: pc,
      project_bucket: pc ? '有项目编号' : '无项目编号',
      brand: String(r.brand_name || r.brand_code || '').trim(),
      city: '',
      remarks: String(r.remarks || '').trim(),
      module_label: '物料采购',
      party_label: '公司',
      expense_yms: expenseYms,
      expense_ym: expenseYms[0] || '',
    });
  });

  (reimbursementPageState.propRepairs || []).forEach((r) => {
    const pc = reimbursementCostStatProjectCode(r);
    const expenseYms = reimbursementCostStatExpenseMonths('prop_repair', r);
    push({
      key: `prop_repair:${r.id}`,
      source_type: 'prop_repair',
      source_label: '道具维修',
      amount: roundMoney2(r.total_amount),
      payee_name: String(r.payee_name || '').trim(),
      payment_status: r.payment_status || 'unpaid',
      project_code: pc,
      project_bucket: pc ? '有项目编号' : '无项目编号',
      brand: String(r.brand_name || r.brand_code || '').trim(),
      city: String(r.region || '').trim(),
      remarks: String(r.remarks || '').trim(),
      module_label: '道具维修',
      party_label: '公司',
      expense_yms: expenseYms,
      expense_ym: expenseYms[0] || '',
    });
  });

  return out;
}

function reimbursementCostStatRowMatchesKeyword(row, kw) {
  if (!kw) return true;
  const hay = [
    row.payee_name,
    row.project_code,
    row.source_label,
    row.source_type,
    row.module_label,
    row.party_label,
    row.brand,
    row.city,
    row.remarks,
    row.line_description,
    row.key,
  ].join(' ').toLowerCase();
  return hay.includes(kw);
}

function reimbursementFilterCostStatRows(rows, kw) {
  const list = Array.isArray(rows) ? rows : [];
  if (!kw) return list;
  return list.filter((r) => reimbursementCostStatRowMatchesKeyword(r, kw));
}

function reimbursementRowAmount(r) {
  return roundMoney2(r?.amount);
}
