function reimbursementComputeCostStats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let total = 0;
  let unpaidCount = 0;
  let unpaidTotal = 0;
  let paidCount = 0;
  let paidTotal = 0;
  let unpaidExclWarehouse = 0;
  const byPayee = new Map();
  const bySource = new Map();
  const byProject = new Map();

  const bump = (map, key, amt) => {
    const k = key || '—';
    const prev = map.get(k) || { count: 0, total: 0 };
    map.set(k, { count: prev.count + 1, total: roundMoney2(prev.total + amt) });
  };

  list.forEach((r) => {
    const amt = reimbursementRowAmount(r);
    total = roundMoney2(total + amt);
    const isPaid = String(r.payment_status || 'unpaid').toLowerCase() === 'paid';
    if (isPaid) {
      paidCount += 1;
      paidTotal = roundMoney2(paidTotal + amt);
    } else {
      unpaidCount += 1;
      unpaidTotal = roundMoney2(unpaidTotal + amt);
      if (r.source_type !== 'warehouse') unpaidExclWarehouse = roundMoney2(unpaidExclWarehouse + amt);
    }
    bump(byPayee, String(r.payee_name || '').trim() || '（未填收款方）', amt);
    bump(bySource, r.source_label || paymentSourceLabel(r.source_type), amt);
    bump(byProject, r.project_bucket || (r.project_code ? '有项目编号' : '无项目编号'), amt);
  });

  return {
    count: list.length,
    total,
    unpaidCount,
    unpaidTotal,
    paidCount,
    paidTotal,
    unpaidExclWarehouse,
    byPayee,
    bySource,
    byProject,
  };
}

function reimbursementStatsGroupRows(map, keyOrder) {
  const order = Array.isArray(keyOrder) ? keyOrder : null;
  const rows = [...(map || new Map()).entries()]
    .map(([key, v]) => ({ key, count: v.count, total: v.total }));
  if (order) {
    const rank = new Map(order.map((k, i) => [k, i]));
    rows.sort((a, b) => {
      const ra = rank.has(a.key) ? rank.get(a.key) : 999;
      const rb = rank.has(b.key) ? rank.get(b.key) : 999;
      if (ra !== rb) return ra - rb;
      return b.total - a.total || b.count - a.count;
    });
    return rows;
  }
  return rows.sort((a, b) => b.total - a.total || b.count - a.count || String(a.key).localeCompare(String(b.key), 'zh-CN'));
}

function reimbursementStatsGroupTableHtml(title, rows, emptyHint, keyColumnLabel) {
  const colLabel = keyColumnLabel || '分类';
  if (!rows.length) {
    return `<section class="reimb-stats-block"><h3 class="reimb-stats-block-title">${escapeHtml(title)}</h3><div class="reimb-stats-empty">${escapeHtml(emptyHint || '暂无数据')}</div></section>`;
  }
  const sumCount = rows.reduce((s, r) => s + r.count, 0);
  const sumTotal = roundMoney2(rows.reduce((s, r) => s + r.total, 0));
  return `<section class="reimb-stats-block">
    <h3 class="reimb-stats-block-title">${escapeHtml(title)}</h3>
    <div class="table-wrapper">
      <table class="data-table reimb-stats-table">
        <thead><tr><th>${escapeHtml(colLabel)}</th><th style="text-align:right">笔数</th><th style="text-align:right">金额</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="reimb-stats-key" title="${escapeHtml(r.key)}">${escapeHtml(r.key)}</td>
          <td style="text-align:right">${r.count}</td>
          <td class="amount" style="text-align:right">${fmtMoney(r.total)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr>
          <td>合计</td>
          <td style="text-align:right">${sumCount}</td>
          <td class="amount reimb-stats-total" style="text-align:right">${fmtMoney(sumTotal)}</td>
        </tr></tfoot>
      </table>
    </div>
  </section>`;
}

function reimbursementStatsBrandTableHtml(dataRows) {
  const map = new Map();
  (dataRows || []).forEach((r) => {
    const k = String(r.brand || '').trim() || '（未填品牌）';
    const prev = map.get(k) || { count: 0, total: 0 };
    const amt = reimbursementRowAmount(r);
    map.set(k, { count: prev.count + 1, total: roundMoney2(prev.total + amt) });
  });
  const rows = reimbursementStatsGroupRows(map);
  if (!rows.length) {
    return `<section class="reimb-stats-block"><h3 class="reimb-stats-block-title">按品牌</h3><div class="reimb-stats-empty">无品牌数据</div></section>`;
  }
  const sumCount = rows.reduce((s, r) => s + r.count, 0);
  const sumTotal = roundMoney2(rows.reduce((s, r) => s + r.total, 0));
  return `<section class="reimb-stats-block">
    <h3 class="reimb-stats-block-title">按品牌</h3>
    <div class="table-wrapper">
      <table class="data-table reimb-stats-table">
        <thead><tr><th>品牌</th><th>年框编号</th><th style="text-align:right">笔数</th><th style="text-align:right">金额</th></tr></thead>
        <tbody>${rows.map((r) => {
          const yfCode =
            reimbBrandYearFrameCodeForPdf(r.key) || (r.key === '内部' ? '内部' : '');
          return `<tr>
            <td><span class="badge badge-${brandColor(r.key)}">${escapeHtml(r.key)}</span></td>
            <td class="reimb-stats-key" title="${escapeHtml(yfCode || '')}">${escapeHtml(yfCode || '—')}</td>
            <td style="text-align:right">${r.count}</td>
            <td class="amount" style="text-align:right">${fmtMoney(r.total)}</td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot><tr>
          <td colspan="2">合计</td>
          <td style="text-align:right">${sumCount}</td>
          <td class="amount reimb-stats-total" style="text-align:right">${fmtMoney(sumTotal)}</td>
        </tr></tfoot>
      </table>
    </div>
  </section>`;
}

function reimbursementStatsProjectCodeKey(projectCode) {
  return String(projectCode || '').trim() || '（无项目编号）';
}

function reimbursementStatsProjectCodeGroups(dataRows) {
  const map = new Map();
  (dataRows || []).forEach((r) => {
    const k = reimbursementStatsProjectCodeKey(r.project_code);
    if (!map.has(k)) map.set(k, { key: k, lines: [], count: 0, total: 0 });
    const g = map.get(k);
    const amt = reimbursementRowAmount(r);
    g.lines.push(r);
    g.count += 1;
    g.total = roundMoney2(g.total + amt);
  });
  return [...map.values()].sort(
    (a, b) => b.total - a.total || b.count - a.count || String(a.key).localeCompare(String(b.key), 'zh-CN'),
  );
}

function reimbursementStatsProjectLineContent(r) {
  const desc = String(r.line_description || '').trim();
  if (desc) return desc;
  if (r.source_type === 'logistics') {
    return reimbursementCostStatLogisticsDisplayText({ remarks: r.remarks, destination_city: r.city });
  }
  if (r.source_type === 'reimbursement') return String(r.remarks || '').trim() || '—';
  const plain = String(r.remarks || '').trim();
  if (plain) return plain;
  return r.source_label || '—';
}

function reimbursementStatsProjectLineMonth(r) {
  if (r.cost_month != null && r.cost_month !== '') {
    const ym = r.expense_ym ? `（${r.expense_ym}）` : '';
    return `${reimbFormatCostMonth(r.cost_month)}${ym}`;
  }
  return r.expense_ym || '—';
}

function reimbursementStatsProjectCodeTableHtml(dataRows) {
  const groups = reimbursementStatsProjectCodeGroups(dataRows);
  if (!groups.length) {
    return `<section class="reimb-stats-block"><h3 class="reimb-stats-block-title">按项目编号</h3><div class="reimb-stats-empty">无项目编号数据</div></section>`;
  }
  const expanded = reimbursementPageState.statsExpandedProjectCodes || new Set();
  const sumCount = groups.reduce((s, g) => s + g.count, 0);
  const sumTotal = roundMoney2(groups.reduce((s, g) => s + g.total, 0));
  const bodyHtml = groups
    .map((g) => {
      const isOpen = expanded.has(g.key);
      const enc = encodeURIComponent(g.key);
      const chevron = isOpen ? '▾' : '▸';
      const detailRows = [...g.lines].sort(
        (a, b) => String(a.expense_ym || '').localeCompare(String(b.expense_ym || ''))
          || reimbursementRowAmount(b) - reimbursementRowAmount(a),
      );
      const detailHtml = isOpen
        ? `<tr class="reimb-stats-project-detail-row">
            <td colspan="3">
              <div class="reimb-stats-project-detail">
                <table class="data-table reimb-stats-table reimb-stats-project-lines">
                  <thead><tr>
                    <th>内容说明</th>
                    <th style="text-align:right;width:110px">小计</th>
                    <th style="text-align:right;width:120px">费用归属</th>
                  </tr></thead>
                  <tbody>${detailRows.map((line) => `<tr>
                    <td class="reimb-stats-key" title="${escapeHtml(reimbursementStatsProjectLineContent(line))}">${escapeHtml(reimbursementStatsProjectLineContent(line))}</td>
                    <td class="amount" style="text-align:right">${fmtMoney(reimbursementRowAmount(line))}</td>
                    <td style="text-align:right">${escapeHtml(reimbursementStatsProjectLineMonth(line))}</td>
                  </tr>`).join('')}</tbody>
                </table>
              </div>
            </td>
          </tr>`
        : '';
      return `<tr class="reimb-stats-project-row${isOpen ? ' reimb-stats-project-row--open' : ''}"
        data-reimb-stats-project-row="${enc}"
        role="button"
        tabindex="0"
        aria-expanded="${isOpen ? 'true' : 'false'}"
        title="点击展开费用明细">
        <td class="reimb-stats-key reimb-stats-project-code-cell" title="${escapeHtml(g.key)}">
          <span class="reimb-stats-project-chevron" aria-hidden="true">${chevron}</span>
          ${escapeHtml(g.key)}
        </td>
        <td style="text-align:right">${g.count}</td>
        <td class="amount" style="text-align:right">${fmtMoney(g.total)}</td>
      </tr>${detailHtml}`;
    })
    .join('');
  return `<section class="reimb-stats-block reimb-stats-block--project">
    <h3 class="reimb-stats-block-title">按项目编号 <span class="reimb-stats-block-hint">点击行展开明细</span></h3>
    <div class="table-wrapper">
      <table class="data-table reimb-stats-table reimb-stats-project-table">
        <thead><tr><th>项目编号</th><th style="text-align:right">笔数</th><th style="text-align:right">金额</th></tr></thead>
        <tbody>${bodyHtml}</tbody>
        <tfoot><tr>
          <td>合计</td>
          <td style="text-align:right">${sumCount}</td>
          <td class="amount reimb-stats-total" style="text-align:right">${fmtMoney(sumTotal)}</td>
        </tr></tfoot>
      </table>
    </div>
  </section>`;
}

function reimbursementClearStatsProjectExpansion() {
  if (!reimbursementPageState.statsExpandedProjectCodes) {
    reimbursementPageState.statsExpandedProjectCodes = new Set();
    return;
  }
  reimbursementPageState.statsExpandedProjectCodes.clear();
}

function reimbursementToggleStatsProjectCode(projectKey) {
  const k = String(projectKey || '').trim();
  if (!k) return;
  if (!reimbursementPageState.statsExpandedProjectCodes) {
    reimbursementPageState.statsExpandedProjectCodes = new Set();
  }
  const set = reimbursementPageState.statsExpandedProjectCodes;
  if (set.has(k)) set.delete(k);
  else set.add(k);
  reimbursementRenderStatsBody();
}

function reimbursementStatsRowsForFilter() {
  const sourceRows = reimbursementStatsFilterSourceRows();
  return reimbursementApplyCostStatFilters(sourceRows);
}
