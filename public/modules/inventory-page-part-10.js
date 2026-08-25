function invOnOutboundSearchInput(value) {
  const v = String(value == null ? '' : value);
  inventoryPageState.outboundSearch = v;
  const input = document.getElementById('invOutboundSearch');
  if (input && input.value !== v) input.value = v;
  invRefreshOutboundTable();
  const headActions = document.querySelector('.inv-out-page-head-actions .inv-ob-search');
  if (headActions) {
    const existed = headActions.querySelector('.inv-ob-search-clear');
    if (v && !existed) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inv-ob-search-clear';
      btn.setAttribute('aria-label', '清除搜索');
      btn.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
      btn.addEventListener('click', () => invOnOutboundSearchInput(''));
      headActions.appendChild(btn);
    } else if (!v && existed) {
      existed.remove();
    }
  }
  renderLucideIcons();
}

function invRenderOutboundOrderTable(orders, opts) {
  opts = opts || {};
  const q = String(opts.search || '').trim();
  if (!orders.length) {
    if (q) {
      return `<div class="empty-state" style="margin-top:8px">没有匹配「${escapeHtml(q)}」的出库单（当前年度共 ${Number(opts.total) || 0} 条）。</div>`;
    }
    return '<div class="empty-state" style="margin-top:8px">暂无物品出库记录，可点击「新建出库」创建。</div>';
  }
  const hintHtml = q
    ? `<div class="inv-ob-search-result-hint">已筛选出 <strong>${orders.length}</strong> / ${Number(opts.total) || orders.length} 条匹配「${escapeHtml(q)}」</div>`
    : '';
  return `
    ${hintHtml}
    <div class="table-wrapper">
      <table class="data-table inv-ob-order-table">
        <thead>
          <tr>
            <th>出库日期</th>
            <th>项目编号</th>
            <th>物流方式</th>
            <th>物流单号</th>
            <th>发货仓</th>
            <th>收件城市</th>
            <th style="min-width:220px">操作</th>
            <th class="inv-ob-col-status">状态</th>
          </tr>
        </thead>
        <tbody>
          ${orders
            .map((o) => {
              const proj =
                o.link_mode === 'standalone' ? escapeHtml(o.purpose || '—') : escapeHtml(o.project_code || '—');
              const shipDate = o.shipped_at ? fmtDate(o.shipped_at) : '—';
              const st = String(o.status || '').toLowerCase();
              const statusHtml =
                st === 'closed'
                  ? '<span class="badge badge-success">已归还</span>'
                  : '<span class="badge badge-warning">出库中</span>';
              const itemsSummary = String(o.items_summary || '').trim();
              const trTitle = itemsSummary ? ` title="${escapeHtml(itemsSummary)}"` : '';
              return `<tr${trTitle}>
            <td>${shipDate}</td>
            <td>${proj}</td>
            <td>${escapeHtml(o.logistics_method || '—')}</td>
            <td>${
              o.tracking_number
                ? `<a href="https://www.sf-express.com/cn/sc/dynamic_function/waybill/#search/bill-number/${encodeURIComponent(String(o.tracking_number))}" target="_blank" style="color:var(--accent);font-family:monospace;font-size:12px">${escapeHtml(o.tracking_number)}</a>`
                : '<span style="color:var(--text-muted)">—</span>'
            }</td>
            <td title="${escapeHtml((o.brand_code || '') + ' / ' + (o.region || ''))}">${escapeHtml(invWarehouseFullLabel(o))}</td>
            <td>${escapeHtml(o.recipient_city || '—')}</td>
            <td class="inv-ob-order-actions">
              <button type="button" class="btn btn-xs btn-secondary" onclick="event.stopPropagation();invOpenOutboundOrderDetail(${o.id})">出库单详情</button>
              <button type="button" class="btn btn-xs btn-ghost" onclick="event.stopPropagation();invOpenOutboundEditModal(${o.id})">编辑</button>
              <button type="button" class="btn btn-xs btn-ghost inv-admin-only" style="color:var(--danger)" onclick="event.stopPropagation();invDeleteOutboundOrder(${o.id})">删除</button>
            </td>
            <td class="inv-ob-col-status">${statusHtml}</td>
          </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function invRenderInboundLedgerTableRows(rows) {
  return (rows || [])
    .map((r) => {
      const isDirect = r._kind === 'direct';
      const main = escapeHtml(r.display_main || '—');
      const sub = !isDirect && r.display_sub
        ? `<div class="inv-inbound-ledger-sub">${escapeHtml(r.display_sub)}</div>`
        : '';
      const rem = r.batch_remarks != null ? String(r.batch_remarks) : '';
      const remShort = rem.length > 40 ? `${rem.slice(0, 40)}…` : rem;
      const sourceCol = isDirect ? (r.source ? escapeHtml(r.source) : '—') : '—';
      const sum = isDirect
        ? `入库 ×${r._qty || 0}`
        : `归${r.sum_qty_return} 空${r.sum_qty_empty_recovered} 留${r.sum_qty_customer_keep} 丢${r.sum_qty_lost} 损${r.sum_qty_damaged} 耗${r.sum_qty_consumed || 0}`;
      const detailBtn = isDirect
        ? `<div class="inv-row-actions">
            <button type="button" class="btn btn-xs btn-secondary" onclick="invOpenInboundEditModal(${r.batch_id})">编辑</button>
            <button type="button" class="btn btn-xs btn-danger" onclick="invDeleteInboundRecord(${r.batch_id})" title="删除并回退库存">删除</button>
          </div>`
        : `<button type="button" class="btn btn-xs btn-secondary" onclick="invOpenInboundReceiptDetail(${r.batch_id})">详情</button>`;
      const inboundSummary = String(r.items_summary || '').trim();
      const trTitle = inboundSummary ? ` title="${escapeHtml(inboundSummary)}"` : '';
      return `<tr${trTitle}>
      <td>${r.return_date ? escapeHtml(fmtDate(r.return_date)) : '—'}</td>
      <td><div class="inv-inbound-ledger-main">${main}</div>${sub}</td>
      <td>${escapeHtml(r.brand_code)} ${escapeHtml(r.region)}</td>
      <td style="font-size:12px;color:var(--text-secondary)">${sourceCol}</td>
      <td>${escapeHtml(r.operator || '—')}</td>
      <td style="font-size:12px;color:var(--text-secondary);white-space:nowrap">${sum}</td>
      <td style="max-width:160px;font-size:12px;color:var(--text-muted)" title="${escapeHtml(rem)}">${escapeHtml(remShort || '—')}</td>
      <td>${detailBtn}</td>
    </tr>`;
    })
    .join('');
}

function invRenderInboundLedgerTableOnly(rows) {
  return `
    <div class="table-wrapper inv-inbound-ledger-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>入库日期</th>
            <th>关联项目 / 用途</th>
            <th>仓库</th>
            <th>入库来源</th>
            <th>登记人</th>
            <th>汇总</th>
            <th>备注</th>
            <th style="min-width:72px"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? invRenderInboundLedgerTableRows(rows) : '<tr><td colspan="8" style="color:var(--text-muted)">暂无已入库记录</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function invRenderInboundLedgerHostContent() {
  const cache = inventoryPageState._inboundLedgerCache || [];
  const filtered = invFilterRowsByMonth(cache, inventoryPageState.inboundLedgerMonthFilter, invInboundLedgerDateKey);
  const pag = invPaginateSlice(filtered, inventoryPageState.inboundLedgerPage || 1, INV_INBOUND_PAGE_SIZE);
  inventoryPageState.inboundLedgerPage = pag.page;
  const batchCount = filtered.filter((r) => r && r._kind !== 'direct').length;
  const directCount = filtered.filter((r) => r && r._kind === 'direct').length;
  const monthHint =
    inventoryPageState.inboundLedgerMonthFilter !== 'all'
      ? ` · 月份 ${inventoryPageState.inboundLedgerMonthFilter}`
      : '';
  const summaryLine = `<div class="inv-inbound-summary">当前筛选共 <strong>${pag.total}</strong> 条 · 归还入库 ${batchCount} 条 · 直接入库 ${directCount} 条${monthHint} · 每页 ${INV_INBOUND_PAGE_SIZE} 条</div>`;
  if (!pag.total) {
    return `${summaryLine}<div class="empty-state" style="margin-top:8px">暂无已入库记录，可调整月份或左侧年度查看。</div>`;
  }
  return `${summaryLine}${invRenderInboundLedgerTableOnly(pag.rows)}${renderPagination(pag.page, pag.totalPages, pag.total, 'invGoInboundLedgerPage')}`;
}

function invRenderInboundPendingTableRows(orders) {
  return (orders || [])
    .map((o) => {
      const cityRaw = String(o.activity_city || o.recipient_city || '').trim();
      const cityCell = cityRaw ? escapeHtml(cityRaw) : '—';
      const projLine =
        o.link_mode === 'standalone'
          ? escapeHtml(o.purpose || '—')
          : escapeHtml(o.project_code || '—');
      const pendingSummary = String(o.items_summary || '').trim();
      const trTitle = pendingSummary ? ` title="${escapeHtml(pendingSummary)}"` : '';
      const rem = Number(o.qty_unaccounted) || 0;
      const hasBatch = Number(o.return_batch_count) > 0;
      let progressCell = '<span class="badge badge-warning">待登记</span>';
      if (rem > 0) {
        const progressTitle = hasBatch ? '已做过归还登记，但仍有数量未登记去向' : '尚未完成归还登记';
        progressCell = `<span class="badge badge-warning" title="${escapeHtml(progressTitle)}">${hasBatch ? '部分已登记' : '待登记'} · 余 ${rem}</span>`;
      }
      return `
      <tr${trTitle}>
        <td>#${o.id}</td>
        <td title="${escapeHtml((o.brand_code || '') + ' / ' + (o.region || ''))}">${escapeHtml(invWarehouseFullLabel(o))}</td>
        <td>${cityCell}</td>
        <td>${projLine}</td>
        <td>${o.shipped_at ? escapeHtml(fmtDate(o.shipped_at)) : '—'}</td>
        <td>${progressCell}</td>
        <td>
          <button type="button" class="btn btn-sm btn-primary" onclick="invOpenReturn(${o.id})">归还登记</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="invDownloadPdf(${o.id})">PDF</button>
        </td>
      </tr>`;
    })
    .join('');
}

function invRenderInboundPendingHostContent() {
  const cache = inventoryPageState._inboundPendingCache || [];
  const filtered = invFilterRowsByMonth(cache, inventoryPageState.inboundPendingMonthFilter, invInboundPendingDateKey);
  const pag = invPaginateSlice(filtered, inventoryPageState.inboundPendingPage || 1, INV_INBOUND_PAGE_SIZE);
  inventoryPageState.inboundPendingPage = pag.page;
  const monthHint =
    inventoryPageState.inboundPendingMonthFilter !== 'all'
      ? ` · 月份 ${inventoryPageState.inboundPendingMonthFilter}`
      : '';
  const summaryLine = `<div class="inv-inbound-summary">当前筛选共 <strong>${pag.total}</strong> 条${monthHint} · 每页 ${INV_INBOUND_PAGE_SIZE} 条</div>`;
  if (!pag.total) {
    return `${summaryLine}<div class="empty-state" style="margin-top:8px">暂无待入库单据，可调整月份筛选。</div>`;
  }
  return `${summaryLine}
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>单号</th><th>品牌/区</th><th>城市</th><th>项目编号 / 场次</th><th>出库时间</th><th>登记进度</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${invRenderInboundPendingTableRows(pag.rows)}
        </tbody>
      </table>
    </div>
    ${renderPagination(pag.page, pag.totalPages, pag.total, 'invGoInboundPendingPage')}`;
}

function invRenderInboundLedgerTable(rows) {
  return invRenderInboundLedgerTableOnly(rows);
}
