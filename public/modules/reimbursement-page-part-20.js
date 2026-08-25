function reimbursementFilterRowsByStatsCard(rows, cardKey) {
  const list = Array.isArray(rows) ? rows : [];
  if (!cardKey || cardKey === 'all' || cardKey === 'total') return list;
  if (cardKey === 'unpaid') {
    return list.filter((r) => String(r.payment_status || 'unpaid').toLowerCase() !== 'paid');
  }
  if (cardKey === 'unpaid_excl_wh') {
    return list.filter(
      (r) => String(r.payment_status || 'unpaid').toLowerCase() !== 'paid' && r.source_type !== 'warehouse',
    );
  }
  if (cardKey === 'paid') {
    return list.filter((r) => String(r.payment_status || 'unpaid').toLowerCase() === 'paid');
  }
  return list;
}

function reimbursementStatsCardLabel(cardKey) {
  const map = {
    all: '全部明细',
    total: '金额合计明细',
    unpaid: '未支付明细',
    unpaid_excl_wh: '未支付明细（不含仓储）',
    paid: '已支付明细',
  };
  return map[cardKey] || '明细';
}

function reimbursementStatsDetailTableHtml(rows, title) {
  if (!rows.length) {
    return `<section class="reimb-stats-detail">
      <h3 class="reimb-stats-detail-title">${escapeHtml(title)}</h3>
      <div class="reimb-stats-empty">暂无匹配记录</div>
    </section>`;
  }
  const sum = roundMoney2(rows.reduce((s, r) => s + reimbursementRowAmount(r), 0));
  const sorted = [...rows].sort((a, b) => {
    const da = String(a.payee_name || '');
    const db = String(b.payee_name || '');
    return da.localeCompare(db, 'zh-CN') || reimbursementRowAmount(b) - reimbursementRowAmount(a);
  });
  return `<section class="reimb-stats-detail">
    <h3 class="reimb-stats-detail-title">${escapeHtml(title)} <span class="reimb-stats-detail-meta">${rows.length} 笔 · ${fmtMoney(sum)}</span></h3>
    <div class="table-wrapper reimb-stats-detail-wrap">
      <table class="data-table reimb-stats-table reimb-stats-detail-table">
        <thead><tr>
          <th>板块</th>
          <th>收款方</th>
          <th>品牌</th>
          <th>归属月</th>
          <th>项目编号</th>
          <th>分类</th>
          <th style="text-align:right">金额</th>
          <th>状态</th>
          <th>备注</th>
        </tr></thead>
        <tbody>${sorted.map((r) => {
          const paid = String(r.payment_status || 'unpaid').toLowerCase() === 'paid';
          const remarks = String(r.line_description || '').trim()
            || (r.source_type === 'logistics'
              ? reimbursementCostStatLogisticsDisplayText({ remarks: r.remarks, destination_city: r.city })
              : [r.city, r.remarks].filter(Boolean).join(' · '));
          const ymLabel = r.cost_month != null && r.cost_month !== ''
            ? `${reimbFormatCostMonth(r.cost_month)}（${r.expense_ym || '—'}）`
            : reimbursementCostStatExpenseYmLabel(r.expense_yms);
          return `<tr>
            <td>${escapeHtml(r.source_label || '—')}</td>
            <td class="reimb-stats-key" title="${escapeHtml(r.payee_name || '')}">${escapeHtml(r.payee_name || '—')}</td>
            <td>${r.brand ? `<span class="badge badge-${brandColor(r.brand)}">${escapeHtml(r.brand)}</span>` : '—'}</td>
            <td>${escapeHtml(ymLabel)}</td>
            <td class="reimb-stats-key reimb-stats-project-code" title="${escapeHtml(r.project_code || '')}">${escapeHtml(r.project_code || '—')}</td>
            <td>${escapeHtml(r.project_bucket || '—')}</td>
            <td class="amount" style="text-align:right">${fmtMoney(reimbursementRowAmount(r))}</td>
            <td><span class="badge ${paid ? 'badge-success' : 'badge-warning'}">${paid ? '已支付' : '未支付'}</span></td>
            <td class="reimb-stats-key" title="${escapeHtml(remarks)}">${escapeHtml(remarks || '—')}</td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot><tr>
          <td colspan="6">合计</td>
          <td class="amount reimb-stats-total" style="text-align:right">${fmtMoney(sum)}</td>
          <td colspan="2">${rows.length} 笔</td>
        </tr></tfoot>
      </table>
    </div>
  </section>`;
}

function reimbursementStatsSummaryCardHtml(cardKey, label, valueHtml, active) {
  return `<button type="button" class="reimb-stats-card${active ? ' reimb-stats-card--active' : ''}"
    data-reimb-stats-card="${escapeHtml(cardKey)}"
    aria-pressed="${active ? 'true' : 'false'}"
    title="点击查看${escapeHtml(label)}">
    <span class="reimb-stats-card-label">${escapeHtml(label)}</span>
    <strong class="reimb-stats-card-value">${valueHtml}</strong>
  </button>`;
}

function reimbursementBuildCostStatsBodyHtml(vm) {
  const kw = reimbursementReadListFilterKeyword();
  const sourceRows = reimbursementStatsFilterSourceRows();
  const dataRows = reimbursementApplyCostStatFilters(sourceRows);
  const stats = reimbursementComputeCostStats(dataRows);
  const filterDesc = reimbursementBuildCostStatsFilterDesc(kw, dataRows);
  const activeCard = reimbursementPageState.statsCard || null;
  const detailRows = activeCard ? reimbursementFilterRowsByStatsCard(dataRows, activeCard) : [];

  const byPayee = reimbursementStatsGroupRows(stats.byPayee);
  const byProject = reimbursementStatsGroupRows(stats.byProject, ['有项目编号', '无项目编号', '仓储费用']);

  return `
    ${reimbursementStatsFilterBarHtml(sourceRows)}
    <p class="reimb-stats-scope">${escapeHtml(filterDesc)}</p>
    <div class="reimb-stats-summary" role="group" aria-label="费用汇总">
      ${reimbursementStatsSummaryCardHtml('all', '笔数', String(stats.count), activeCard === 'all')}
      ${reimbursementStatsSummaryCardHtml('total', '金额合计', `<span class="amount">${fmtMoney(stats.total)}</span>`, activeCard === 'total')}
      ${reimbursementStatsSummaryCardHtml('unpaid', '未支付', `${stats.unpaidCount} 笔 · <span class="amount">${fmtMoney(stats.unpaidTotal)}</span>`, activeCard === 'unpaid')}
      ${reimbursementStatsSummaryCardHtml('unpaid_excl_wh', '未支付（不含仓储）', `<span class="amount">${fmtMoney(stats.unpaidExclWarehouse)}</span>`, activeCard === 'unpaid_excl_wh')}
      ${reimbursementStatsSummaryCardHtml('paid', '已支付', `${stats.paidCount} 笔 · <span class="amount">${fmtMoney(stats.paidTotal)}</span>`, activeCard === 'paid')}
    </div>
    ${activeCard ? reimbursementStatsDetailTableHtml(detailRows, reimbursementStatsCardLabel(activeCard)) : ''}
    <div class="reimb-stats-grid">
      ${reimbursementStatsBrandTableHtml(dataRows)}
      ${reimbursementStatsProjectCodeTableHtml(dataRows)}
      ${reimbursementStatsGroupTableHtml('按分类', byProject, '无分类数据', '分类')}
      ${reimbursementStatsGroupTableHtml('按收款方', byPayee, '无收款方数据', '收款方')}
    </div>`;
}

function reimbursementRenderStatsBody() {
  const host = document.getElementById('reimbStatsBodyHost');
  if (!host) return;
  host.innerHTML = reimbursementBuildCostStatsBodyHtml(reimbursementBuildListVm());
}

function reimbursementSetStatsCard(cardKey) {
  const key = String(cardKey || '').trim();
  if (!key) return;
  reimbursementPageState.statsCard = reimbursementPageState.statsCard === key ? null : key;
  reimbursementRenderStatsBody();
}

function reimbursementReadListFilterKeyword() {
  const el = document.getElementById('reimbListFilter');
  if (_reimbListFilterComposing) {
    return (reimbursementPageState.filterInput || '').trim().toLowerCase();
  }
  const live = el ? el.value : (reimbursementPageState.filterInput || '');
  if (el && !el.isComposing) reimbursementPageState.filterInput = live;
  return String(live).trim().toLowerCase();
}

function reimbursementBuildListVm() {
  const view = reimbursementPageState.view || 'registrations';
  const rows = reimbursementPageState.rows || [];
  const orders = reimbursementPageState.paymentOrders || [];
  reimbursementSelectionPrune();
  const selectedIds = reimbursementPageState.selectedIds || new Set();
  const selectedCount = selectedIds.size;
  const kw = reimbursementReadListFilterKeyword();
  const filtered = reimbursementFilterRegistrationRows(rows, kw);
  const ordersFiltered = orders.filter((o) => {
    if (!kw) return true;
    return [o.order_no, o.payee_name, o.remarks, o.status, o.id].some((x) => String(x || '').toLowerCase().includes(kw));
  });
  const orderMap = new Map((orders || []).map((o) => [Number(o.id), o]));
  const listRowsHtml =
    view === 'payment_orders'
      ? reimbursementBuildPaymentOrdersTableHtml(ordersFiltered)
      : '';

  const registrationRowsHtml = (list) => reimbursementBuildRegistrationListHtml(list, orderMap);
  const unpaidReg = filtered.filter((r) => String(r.payment_status || 'unpaid').toLowerCase() !== 'paid');
  const paidReg = filtered.filter((r) => String(r.payment_status || 'unpaid').toLowerCase() === 'paid');
  const eligibleVisible = filtered.filter(reimbursementSelectionEligible);
  const allEligibleChecked =
    eligibleVisible.length > 0 && eligibleVisible.every((r) => selectedIds.has(Number(r.id)));
  const headerSelectChecked = allEligibleChecked ? 'checked' : '';
  const headerSelectIndeterminate = !allEligibleChecked && eligibleVisible.some((r) => selectedIds.has(Number(r.id)));
  const canMerge = selectedCount >= 2;
  const tableHtml = view === 'payment_orders'
    ? `<div class="table-wrapper reimb-po-table-scroll act-table-scroll-wrap">
              <table class="data-table act-table-sticky-head reimb-po-table">
              <thead>
                <tr><th>付款单号</th><th>申请日期</th><th>付款日期</th><th>收款方信息</th><th style="text-align:left">金额</th><th>状态</th><th>明细数</th><th>备注</th><th>操作</th></tr>
              </thead>
              <tbody>${listRowsHtml}</tbody>
            </table>
            </div>`
    : `<table class="data-table reimbursement-registration-table reimbursement-table-compact">
              <thead>
                <tr>
                  <th class="reimb-select-cell" style="width:36px;text-align:center">
                    <input type="checkbox" id="reimbSelectAll" ${headerSelectChecked} ${eligibleVisible.length ? '' : 'disabled'} title="全选当前未支付记录" onclick="reimbursementToggleSelectAll(this.checked)">
                  </th>
                  <th>日期</th>
                  <th>个人/公司</th>
                  <th>成本归属</th>
                  <th>项目编号</th>
                  <th>合并场次</th>
                  <th style="text-align:left">金额</th>
                  <th>状态</th>
                  <th>付款状态</th>
                  <th>收款方信息</th>
                  <th>备注</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${
                  !filtered.length
                    ? '<tr><td colspan="12" style="text-align:center;color:var(--text-muted);padding:24px">暂无记录</td></tr>'
                    : `${unpaidReg.length ? `<tr><td colspan="12" style="padding:8px 12px;font-size:12px;font-weight:600;color:var(--text-secondary);background:var(--bg-input)">未支付 · ${unpaidReg.length} 笔（点击行展开明细）</td></tr>` : ''}
                ${registrationRowsHtml(unpaidReg)}
                ${paidReg.length ? `<tr><td colspan="12" style="padding:8px 12px;font-size:12px;font-weight:600;color:var(--text-secondary);background:var(--bg-input)">已支付 · ${paidReg.length} 笔</td></tr>` : ''}
                ${registrationRowsHtml(paidReg)}`
                }
              </tbody>
            </table>`;
  const emptyHtml = view === 'registrations' && !filtered.length
    ? '<div class="empty-state" style="padding:24px"><div class="empty-title">暂无付款申请记录</div></div>'
    : '';
  const mergeBtnTitle = canMerge
    ? '将选中的成本登记合并为一条新记录（可在详情中撤销合并）'
    : '请至少勾选 2 条同收款方、同板块的未支付记录';
  return {
    view,
    filtered,
    selectedCount,
    canMerge,
    headerSelectIndeterminate,
    tableHtml,
    emptyHtml,
    mergeBtnTitle,
  };
}

function reimbursementRenderListTableOnly() {
  const vm = reimbursementBuildListVm();
  if (vm.view === 'cost_stats') {
    reimbursementRenderStatsBody();
    return true;
  }
  const wrap = document.getElementById('reimbListTableWrap');
  if (!wrap) return false;
  wrap.innerHTML = vm.tableHtml;
  const emptyHost = document.getElementById('reimbListEmptyHost');
  if (emptyHost) emptyHost.innerHTML = vm.emptyHtml;
  if (vm.view !== 'registrations') return true;
  const headerCb = document.getElementById('reimbSelectAll');
  if (headerCb) headerCb.indeterminate = !!vm.headerSelectIndeterminate;
  return true;
}
