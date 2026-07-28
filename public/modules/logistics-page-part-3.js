function logisticsSortIndicator(key) {
  if (logisticsSortState.key !== key) return '';
  return logisticsSortState.dir === 'asc' ? ' ↑' : ' ↓';
}

function toggleLogisticsSort(key) {
  if (!['shipping_date', 'brand', 'logistics_company'].includes(key)) return;
  if (logisticsSortState.key === key) {
    logisticsSortState.dir = logisticsSortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    logisticsSortState.key = key;
    logisticsSortState.dir = 'asc';
  }
  loadLogistics();
}

function settlementYearOptions() {
  return ['2025', '2026', '2027'];
}

function settlementMonthOptions() {
  const options = [];
  for (let m = 1; m <= 12; m += 1) options.push(String(m));
  return options;
}

function parseSettlementMonthValue(v) {
  if (!v) return { year: '', month: '' };
  const text = String(v).trim();
  const m = text.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return { year: '', month: '' };
  return { year: m[1], month: String(Number(m[2])) };
}

function isTruthyFlag(v) {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

function logisticsDisplayDate(row) {
  if (!row) return '—';
  const settlement = parseSettlementMonthValue(row.settlement_month);
  const hasSettlementMonth = !!(settlement.year && settlement.month);
  const isMonthly = isTruthyFlag(row.monthly_settlement);
  if (hasSettlementMonth && (isMonthly || !row.shipping_date)) return `${settlement.year}-${settlement.month}`;
  return fmtDateShort(row.shipping_date);
}

function logisticsCompanyCellHtml(row) {
  const logisticsCompany = String(row?.logistics_company || '').trim();
  const expressCompany = String(row?.express_company || '').trim();
  const primary = logisticsCompany || expressCompany || '—';
  const showExpress = !isTruthyFlag(row?.special_car) && expressCompany && expressCompany !== primary;
  return `
    <span class="badge badge-blue">${escapeHtml(primary)}</span>
    ${showExpress ? `<span style="margin-left:6px;color:var(--text-secondary);font-size:12px">${escapeHtml(expressCompany)}</span>` : ''}
  `;
}

function logisticsTrackingCellHtml(row) {
  if (isTruthyFlag(row?.monthly_settlement)) {
    return `<span class="badge badge-green">月结${row?.settlement_month ? ` ${escapeHtml(row.settlement_month)}` : ''}</span>`;
  }
  if (row?.special_car) return '<span class="badge badge-accent">专车</span>';
  const trackingNumber = String(row?.tracking_number || '').trim();
  if (!trackingNumber) return '—';
  return `<a href="https://www.sf-express.com/cn/sc/dynamic_function/waybill/#search/bill-number/${encodeURIComponent(trackingNumber)}" target="_blank" style="color:var(--accent);font-family:monospace;font-size:12px">${escapeHtml(trackingNumber)}</a>`;
}

function logisticsPurposeText(row) {
  const p = parseLogisticsAddrMeta(row?.remarks || '');
  const purposeMeta = String(p.purpose || '').trim();
  const visibleRemarks = String(row?.remarks || '')
    .replace(/^\[LOG_ADDR\][^\n]*\n?/, '')
    .replace(/\s*\[INV-OB:\d+\]\s*/g, '')
    .replace(/[；;]\s*$/g, '')
    .trim();
  if (purposeMeta && visibleRemarks) return `${purposeMeta}\n${visibleRemarks}`;
  if (purposeMeta) return purposeMeta;
  if (visibleRemarks) return visibleRemarks;
  return String(row?.allocation_note || '').trim();
}

/** 费用统计等对外展示：去掉 [LOG_ADDR] 等内部标记，用简短业务描述 */
function reimbursementCostStatLogisticsDisplayText(row) {
  const parsed = parseLogisticsAddrMeta(row?.remarks || '');
  const purpose = String(parsed.purpose || '').trim();
  if (purpose) return purpose;

  const ship = String(parsed.shipAddr || parsed.shipName || '').trim();
  const recv = String(parsed.recvName || parsed.recvAddr || '').trim();
  if (ship && recv) return `${ship} → ${recv}`;
  if (recv) return recv;
  if (ship) return ship;

  const purposeText = logisticsPurposeText(row);
  if (purposeText) return purposeText.replace(/\s+/g, ' ').trim();

  const origin = String(row?.origin_city || '').trim();
  const dest = String(row?.destination_city || '').trim();
  if (origin && dest) return `${origin} → ${dest}`;
  if (dest) return dest;
  if (origin) return origin;

  if (isTruthyFlag(row?.monthly_settlement)) {
    const ym = reimbursementNormalizeSettlementYm(row?.settlement_month);
    return ym ? `月结 ${ym}` : '月结';
  }

  const tracking = String(row?.tracking_number || '').trim();
  if (tracking) return `运单 ${tracking}`;

  const company = String(row?.logistics_company || row?.express_company || '').trim();
  return company || '—';
}

function logisticsPurposeCellHtml(row) {
  const text = logisticsPurposeText(row);
  return text ? escapeHtml(text) : '—';
}

function initLogisticsSettlementMonthSelect() {
  const yearSel = document.getElementById('logSettlementYear');
  const monthSel = document.getElementById('logSettlementMonth');
  if (!yearSel || !monthSel) return;
  const years = settlementYearOptions();
  const months = settlementMonthOptions();
  yearSel.innerHTML = [
    '<option value="">请选择年份</option>',
    ...years.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`),
  ].join('');
  monthSel.innerHTML = [
    '<option value="">请选择月份</option>',
    ...months.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}月</option>`),
  ].join('');
}

async function loadLogistics() {
  const container = document.getElementById('logTable');
  if (!container) return;
  try {
    const qs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : '';
    const data = await api('GET', `/logistics${qs}`);
    const logisticsBrands = new Set(['PHD', 'X.O', 'CLUB', 'REMY']);
    const logisticsCompanies = new Set(['东区仓库（叶老板）', '南区仓库（天空）', '北区仓库（叶老板）']);
    const expressCompanies = new Set(['顺丰', '京东', '中通', '圆通', '其他']);
    logisticsState.data = (data || []).map((l) => {
      const row = { ...l };
      const lc = String(row.logistics_company || '').trim();
      const ec = String(row.express_company || '').trim();
      const brand = String(row.brand || '').trim();
      if (!logisticsCompanies.has(lc) && expressCompanies.has(lc) && !ec) {
        // 兼容旧数据：历史上快递公司写在 logistics_company 字段里
        row.express_company = lc;
      }
      row.brand = logisticsBrands.has(brand) ? brand : 'PHD';
      return row;
    });

    const filtered = getLogisticsVisibleRows();

    const idSetVisible = new Set(filtered.map((l) => Number(l.id)));
    const nextSel = new Set();
    logisticsState.selectedIds.forEach((id) => {
      if (idSetVisible.has(id)) nextSel.add(id);
    });
    logisticsState.selectedIds = nextSel;

    const totalFee = filtered.reduce((s,l) => s+(parseFloat(l.fee)||0), 0);

    container.innerHTML = `
      <div style="margin-bottom:12px;display:flex;gap:12px">
        <div class="stat-card blue" style="flex:0 0 160px;padding:14px">
          <div class="stat-label">共 ${filtered.length} 条</div>
          <div class="stat-value sm">${fmtMoney(totalFee)}</div>
          <div class="stat-sub">物流费用合计</div>
        </div>
      </div>
      <div class="table-wrapper log-table-scroll-wrap">
        <table class="log-table-sticky-head">
          <thead><tr>
              <th style="cursor:pointer;user-select:none" onclick="toggleLogisticsSort('shipping_date')" title="点击排序">日期${logisticsSortIndicator('shipping_date')}</th>
              <th style="cursor:pointer;user-select:none" onclick="toggleLogisticsSort('brand')" title="点击排序">品牌${logisticsSortIndicator('brand')}</th>
              <th style="cursor:pointer;user-select:none" onclick="toggleLogisticsSort('logistics_company')" title="点击排序">单位/方式${logisticsSortIndicator('logistics_company')}</th>
              <th>单号</th><th>收发/地址</th><th>用途说明</th><th>费用</th><th>付款状态</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${filtered.length ? filtered.map(l => {
              const lid = Number(l.id);
              const linkedOb = logisticsRowHasOutboundLink(l);
              const rowTitle = linkedOb ? '点击查看发货详情（关联出库单）' : '点击查看发货详情';
              return `
              <tr class="log-table-row" style="cursor:pointer" title="${rowTitle}" onclick="logisticsRowClick(event, ${lid})">
                <td>${logisticsDisplayDate(l)}</td>
                <td><span class="badge badge-purple">${escapeHtml(l.brand || 'PHD')}</span></td>
                <td>${logisticsCompanyCellHtml(l)}</td>
                <td>${logisticsTrackingCellHtml(l)}</td>
                <td style="font-size:12px;max-width:280px;white-space:normal;line-height:1.45">${logisticsRouteCellHtml(l)}</td>
                <td style="font-size:12px;max-width:260px;white-space:normal;line-height:1.45">${logisticsPurposeCellHtml(l)}</td>
                <td class="amount ${parseFloat(l.fee)>0?'amount-cost':'amount-neutral'}">${logisticsFeeCellHtml(l)}</td>
                <td>${paymentStatusHtml(l.payment_status, l.payment_order_id)}</td>
                <td>
                  <div style="display:flex;gap:4px">
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();showLogisticsModal(${l.id})">编辑</button>
                    <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteLogistics(${l.id})">删</button>
                  </div>
                </td>
              </tr>
            `;
            }).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:30px">暂无数据</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    updateLogisticsSelectUi();
    void updateBadges();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${err.message}</div></div>`;
    renderLucideIcons();
  }
}

function toggleLogisticsRowSelect(id, checked) {
  const n = Number(id);
  if (!Number.isFinite(n)) return;
  if (checked) logisticsState.selectedIds.add(n);
  else logisticsState.selectedIds.delete(n);
  updateLogisticsSelectUi();
}

function toggleLogisticsSelectAll(checked) {
  const filtered = getLogisticsVisibleRows();
  const ids = filtered.map((l) => Number(l.id)).filter(Number.isFinite);
  if (checked) ids.forEach((id) => logisticsState.selectedIds.add(id));
  else ids.forEach((id) => logisticsState.selectedIds.delete(id));
  document.querySelectorAll('.log-row-cb').forEach((cb) => {
    const id = Number(cb.getAttribute('data-log-id'));
    cb.checked = logisticsState.selectedIds.has(id);
  });
  updateLogisticsSelectUi();
}

function updateLogisticsSelectUi() {
  const allCb = document.getElementById('logSelectAll');
  const filtered = getLogisticsVisibleRows();
  if (allCb) {
    if (!filtered.length) {
      allCb.checked = false;
      allCb.indeterminate = false;
    } else {
      const ids = filtered.map((l) => Number(l.id));
      const selCount = ids.filter((id) => logisticsState.selectedIds.has(id)).length;
      allCb.checked = selCount === ids.length;
      allCb.indeterminate = selCount > 0 && selCount < ids.length;
    }
  }
  const btn = document.getElementById('logBatchDeleteBtn');
  if (btn) {
    const n = logisticsState.selectedIds.size;
    btn.disabled = n === 0;
    btn.textContent = n > 0 ? `一键删除（已选 ${n} 条）` : '一键删除';
  }
}
