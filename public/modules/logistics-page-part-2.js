function logisticsDetailMoneyText(amount) {
  const n = roundMoney2(amount);
  return n > 0 ? fmtMoney(n) : '—';
}

function logisticsDetailShipDateText(row) {
  if (!row) return '—';
  const display = logisticsDisplayDate(row);
  if (display && display !== '—') return display;
  return row.shipping_date ? fmtDateShort(row.shipping_date) : '—';
}

function logisticsShipDetailCostSectionHtml(row) {
  const fees = row ? logisticsFeeFieldsFromRow(row) : null;
  const shipDate = logisticsDetailShipDateText(row);
  const returnDate = row?.return_date ? fmtDateShort(row.return_date) : '—';
  const payee = row?.payee_name ? escapeHtml(row.payee_name) : '—';
  return `
    <section class="activity-detail-card logistics-cost-detail-card logistics-cost-compact">
      <h4>物流成本</h4>
      <div class="logistics-cost-compact-table" role="table" aria-label="物流成本明细">
        <div class="logistics-cost-compact-head" role="row">
          <span role="columnheader"></span>
          <span role="columnheader">日期</span>
          <span role="columnheader">运费</span>
          <span role="columnheader">操作费</span>
        </div>
        <div class="logistics-cost-compact-row" role="row">
          <span class="logistics-cost-compact-label" role="rowheader">发货</span>
          <span role="cell">${escapeHtml(shipDate)}</span>
          <span class="amount" role="cell">${logisticsDetailMoneyText(fees?.shipping)}</span>
          <span class="amount" role="cell">${logisticsDetailMoneyText(fees?.handling)}</span>
        </div>
        <div class="logistics-cost-compact-row" role="row">
          <span class="logistics-cost-compact-label" role="rowheader">回收</span>
          <span role="cell">${escapeHtml(returnDate)}</span>
          <span class="amount" role="cell">${logisticsDetailMoneyText(fees?.returnShipping)}</span>
          <span class="amount" role="cell">${logisticsDetailMoneyText(fees?.returnHandling)}</span>
        </div>
        <div class="logistics-cost-compact-summary" role="row">
          <span class="logistics-cost-compact-label" role="rowheader">合计</span>
          <span class="logistics-cost-compact-total amount amount-cost" role="cell">${logisticsDetailMoneyText(fees?.total)}</span>
          <span class="logistics-cost-compact-payee" role="cell" title="${payee}">收款方 ${payee}</span>
        </div>
      </div>
    </section>`;
}

function logisticsShipDetailFooterHtml(logisticsId) {
  const lid = Number(logisticsId);
  if (!Number.isFinite(lid)) return '';
  return `<div class="inv-ob-detail-footer logistics-ship-detail-footer">
    <button type="button" class="btn btn-secondary btn-sm" onclick="closeModal()">关闭</button>
    <button type="button" class="btn btn-primary btn-sm" onclick="closeModal();showLogisticsModal(${lid})">编辑物流成本</button>
  </div>`;
}

function logisticsOpenManualShipDetail(row) {
  const titleEl = document.getElementById('invOutboundGroupTitle');
  const body = document.getElementById('invOutboundGroupBody');
  if (!body) return;
  if (titleEl) titleEl.textContent = `发货详情 · 物流 #${row.id}`;
  const shipRecvHtml = logisticsRouteCellHtml(row);
  const purposeText = logisticsPurposeText(row) || '—';
  body.innerHTML = `
    <div class="inv-ob-shell">
      <p class="form-hint" style="margin-top:0;margin-bottom:12px">该记录为手工登记物流，非出库单自动生成。</p>
      <div class="activity-detail-grid logistics-ship-detail-grid" style="margin-bottom:12px">
        <section class="activity-detail-card">
          <h4>物流信息</h4>
          ${activityDetailRow('单位', String(row.logistics_company || '').trim() || '—')}
          ${activityDetailRow('方式', String(row.express_company || '').trim() || '—')}
          ${activityDetailRow('单号', String(row.tracking_number || '').trim() || '—')}
          ${activityDetailRow('品牌', row.brand || '—')}
        </section>
        <section class="activity-detail-card">
          <h4>收发 / 用途</h4>
          ${activityDetailRowHtml('收发地址', shipRecvHtml === '—' ? '—' : shipRecvHtml)}
          ${activityDetailRow('用途说明', purposeText)}
        </section>
        ${logisticsShipDetailCostSectionHtml(row)}
      </div>
      ${logisticsShipDetailFooterHtml(row.id)}
    </div>`;
  openModal('modalInvOutboundGroup');
  renderLucideIcons();
}

function onLogisticsUnitChange() {
  const u = document.getElementById('logUnit')?.value || '快递';
  const sel = document.getElementById('logMethod');
  if (!sel) return;
  const methods = LOGISTICS_METHODS_BY_UNIT[u] || LOGISTICS_METHODS_BY_UNIT['快递'];
  sel.innerHTML = methods.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
}

function fillLogisticsUnitSelect(selected) {
  const sel = document.getElementById('logUnit');
  if (!sel) return;
  sel.innerHTML = LOGISTICS_UNITS.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
  if (selected && LOGISTICS_UNITS.includes(selected)) sel.value = selected;
}

function normalizeLogisticsUnitFromRow(item) {
  if (!item) return '快递';
  const u = String(item.logistics_company || '').trim();
  if (LOGISTICS_UNITS.includes(u)) return u;
  if (LOGISTICS_LEGACY_UNIT_MAP[u]) return LOGISTICS_LEGACY_UNIT_MAP[u];
  if (u.includes('东区')) return '东区仓库';
  if (u.includes('北区')) return '北区仓库';
  if (u.includes('南区')) return '南区仓库';
  const legacyExpress = new Set(LOGISTICS_METHODS_BY_UNIT['快递']);
  if (legacyExpress.has(u) && !String(item.express_company || '').trim()) return '快递';
  return '快递';
}

function normalizeLogisticsMethodFromRow(item, unit) {
  const ec = String(item.express_company || '').trim();
  if (ec) return ec;
  const u = String(item.logistics_company || '').trim();
  const legacyExpress = new Set(LOGISTICS_METHODS_BY_UNIT['快递']);
  if (unit === '快递' && legacyExpress.has(u)) return u;
  return (LOGISTICS_METHODS_BY_UNIT[unit] || LOGISTICS_METHODS_BY_UNIT['快递'])[0];
}

function logisticsRouteCellHtml(row) {
  const p = parseLogisticsAddrMeta(row?.remarks || '');
  const hasV2 =
    p.shipName ||
    p.shipPhone ||
    p.shipAddr ||
    p.recvName ||
    p.recvPhone ||
    p.recvAddr;
  if (hasV2) {
    const bits = [];
    const shipLine = [p.shipName, p.shipPhone].filter(Boolean).join(' ');
    const recvLine = [p.recvName, p.recvPhone].filter(Boolean).join(' ');
    if (shipLine) bits.push(`<span style="color:var(--text-secondary)">发</span> ${escapeHtml(shipLine)}`);
    if (p.shipAddr) bits.push(`<div style="font-size:11px;color:var(--text-muted)">${escapeHtml(p.shipAddr)}</div>`);
    if (recvLine) bits.push(`<span style="color:var(--text-secondary)">收</span> ${escapeHtml(recvLine)}`);
    if (p.recvAddr) bits.push(`<div style="font-size:11px;color:var(--text-muted)">${escapeHtml(p.recvAddr)}</div>`);
    return bits.length ? bits.join('') : '—';
  }
  if (p.sender || p.recipient || p.address) {
    const bits = [];
    if (p.sender) bits.push(`<span style="color:var(--text-secondary)">发</span> ${escapeHtml(p.sender)}`);
    if (p.recipient) bits.push(`<span style="color:var(--text-secondary)">收</span> ${escapeHtml(p.recipient)}`);
    const top = bits.length ? bits.join('<br/>') : '';
    const addr = p.address ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${escapeHtml(p.address)}</div>` : '';
    return top + addr || '—';
  }
  const a = String(row?.origin_city || '').trim();
  const b = String(row?.destination_city || '').trim();
  if (!a && !b) return '—';
  return `${escapeHtml(a)}→${escapeHtml(b)}`;
}

async function renderLogistics() {
  const container = document.getElementById('pageContainer');

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <input type="text" class="search-input" id="logSearch" placeholder="搜索单号/单位/方式/收发/用途..." oninput="filterLogistics()">
      </div>
      <div class="toolbar-right" style="display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-ghost btn-sm inv-admin-only" onclick="logisticsCleanupOrphanOutbound()" title="扫描并清理「出库单已删除但物流成本仍残留」的孤儿数据（按 [INV-OB:N] 标记识别）">清理出库残留</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="showLogisticsModal()">+ 新建物流</button>
      </div>
    </div>
    <div id="logTable"></div>
  `;

  await loadLogistics();
}

async function logisticsCleanupOrphanOutbound() {
  if (!hasWriteAccess()) {
    showToast('仅管理员可执行此操作', 'warning');
    return;
  }
  if (
    !window.confirm(
      '将扫描所有物流成本记录，删除「备注含 [INV-OB:N] 但对应出库单已不存在」的孤儿行。\n\n该操作幂等安全，且只清理由出库模块自动生成的物流；不会影响手填的物流记录。是否继续？',
    )
  ) {
    return;
  }
  try {
    const resp = await api('POST', '/inventory/cleanup-orphan-logistics');
    const cleaned = Number((resp && resp.cleaned) || 0);
    const scanned = Number((resp && resp.scanned) || 0);
    if (cleaned > 0) {
      showToast(`已清理 ${cleaned} 条残留物流（共扫描 ${scanned} 条带 INV-OB 标记）`, 'success');
    } else {
      showToast(`未发现残留物流（共扫描 ${scanned} 条带 INV-OB 标记，全部有对应出库单）`, 'info');
    }
    await loadLogistics();
  } catch (e) {
    showToast(e.message || '清理失败', 'error');
  }
}

/** 与物流表格一致：当前已加载数据 + 搜索框过滤后的可见行 */
function getLogisticsVisibleRows() {
  const search = (document.getElementById('logSearch')?.value || '').toLowerCase();
  let data = logisticsState.data || [];
  if (search) {
    data = data.filter((l) => {
      const p = parseLogisticsAddrMeta(l.remarks || '');
      const blob = [
        l.tracking_number,
        l.logistics_company,
        l.express_company,
        l.origin_city,
        l.destination_city,
        p.sender,
        p.recipient,
        p.address,
        p.shipName,
        p.shipPhone,
        p.shipAddr,
        p.recvName,
        p.recvPhone,
        p.recvAddr,
        p.purpose,
        logisticsPurposeText(l),
      ]
        .join(' ')
        .toLowerCase();
      return blob.includes(search);
    });
  }
  return sortLogisticsRows(data);
}

function logisticsSortDateValue(row) {
  const settlement = parseSettlementMonthValue(row && row.settlement_month);
  const hasSettlementMonth = !!(settlement.year && settlement.month);
  const isMonthly = isTruthyFlag(row && row.monthly_settlement);
  if (hasSettlementMonth && (isMonthly || !(row && row.shipping_date))) {
    return Date.UTC(parseInt(settlement.year, 10), parseInt(settlement.month, 10) - 1, 1);
  }
  const dt = new Date(row && row.shipping_date ? row.shipping_date : 0).getTime();
  return Number.isFinite(dt) ? dt : 0;
}

function sortLogisticsRows(rows) {
  const key = logisticsSortState.key;
  const dir = logisticsSortState.dir === 'asc' ? 1 : -1;
  const arr = Array.isArray(rows) ? rows.slice() : [];
  const cmpText = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN');
  arr.sort((a, b) => {
    let c = 0;
    if (key === 'shipping_date') {
      c = logisticsSortDateValue(a) - logisticsSortDateValue(b);
    } else if (key === 'brand') {
      c = cmpText(a.brand, b.brand);
      if (c === 0) c = cmpText(a.logistics_company, b.logistics_company);
    } else if (key === 'logistics_company') {
      c = cmpText(a.logistics_company, b.logistics_company);
      if (c === 0) c = cmpText(a.brand, b.brand);
    }
    if (c === 0) c = Number(a.id || 0) - Number(b.id || 0);
    return c * dir;
  });
  return arr;
}
