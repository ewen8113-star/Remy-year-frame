async function invOpenInboundReceiptDetail(batchId) {
  const titleEl = document.getElementById('modalInvInboundTitle');
  const body = document.getElementById('modalInvInboundReceiptBody');
  if (titleEl) titleEl.textContent = `入库单 #${batchId}`;
  if (!body) return;
  body.innerHTML = '<div class="empty-state">加载中…</div>';
  openModal('modalInvInboundReceipt');
  try {
    const det = await api('GET', `/inventory/inbound-receipts/${batchId}`);
    const h = det.head;
    const lines = det.lines || [];
    const disp = det.display || {};
    const obId = h.outbound_order_id;
    const main = escapeHtml(disp.display_main || '—');
    const sub = disp.display_sub
      ? `<div class="inv-inbound-detail-sub">${escapeHtml(disp.display_sub)}</div>`
      : '';
    const lineRows = lines.length
      ? lines
          .map(
            (ln) => `<tr>
          <td>${escapeHtml(ln.item_name)}</td>
          <td>${escapeHtml(ln.item_dimensions || '—')}</td>
          <td>${ln.outbound_qty}</td>
          <td>${ln.qty_return}</td>
          <td>${ln.qty_empty_recovered}</td>
          <td>${ln.qty_customer_keep}</td>
          <td>${ln.qty_lost}</td>
          <td>${ln.qty_damaged}</td>
          <td>${ln.qty_consumed != null ? ln.qty_consumed : 0}</td>
        </tr>`,
          )
          .join('')
      : '<tr><td colspan="9" style="color:var(--text-muted)">无明细</td></tr>';
    const remHtml = h.batch_remarks != null && String(h.batch_remarks).trim()
      ? escapeHtml(String(h.batch_remarks))
      : '—';
    body.innerHTML = `
      <div class="modal-activity-form">
        <p class="modal-activity-lead">归还登记生成的入库凭证明细。下方「关联出库单」仅供系统内核对，日常请以项目编号 / 用途为准。</p>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">入库日期</label>
            <input class="form-control" value="${h.return_date ? escapeHtml(fmtDate(h.return_date)) : '—'}" readonly>
          </div>
          <div class="form-group">
            <label class="form-label">登记人</label>
            <input class="form-control" value="${escapeHtml(h.operator || '—')}" readonly>
          </div>
          <div class="form-group form-full">
            <label class="form-label">关联项目 / 用途</label>
            <input class="form-control" value="${main}" readonly>
            ${sub}
          </div>
          <div class="form-group">
            <label class="form-label">发货仓</label>
            <input class="form-control" value="${escapeHtml(h.brand_code)} ${escapeHtml(h.region)}" readonly>
          </div>
          <div class="form-group">
            <label class="form-label">关联出库单（系统）</label>
            <input class="form-control" value="#${obId}" readonly>
          </div>
          <div class="form-group form-full">
            <label class="form-label">归还备注</label>
            <div class="inv-inbound-remark-box">${remHtml}</div>
          </div>
        </div>
        <div class="table-wrapper" style="margin-top:14px;overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>物料</th><th>规格</th><th>出库数</th><th>归还</th><th>空瓶回收</th><th>留给客户</th><th>丢失</th><th>损坏</th><th>消耗</th>
              </tr>
            </thead>
            <tbody>${lineRows}</tbody>
          </table>
        </div>
      </div>`;
    renderLucideIcons();
  } catch (e) {
    body.innerHTML = `<div class="empty-state" style="color:var(--danger)">${escapeHtml(e.message || '加载失败')}</div>`;
  }
}

async function invOpenOutboundOrderDetail(orderId, opts) {
  opts = opts || {};
  const titleEl = document.getElementById('invOutboundGroupTitle');
  const body = document.getElementById('invOutboundGroupBody');
  if (titleEl) titleEl.textContent = opts.title || `出库单 #${orderId}`;
  if (!body) return;
  body.innerHTML = '<div class="empty-state">加载中…</div>';
  openModal('modalInvOutboundGroup');
  try {
    let logRow = opts.logisticsRow || null;
    if (!logRow && opts.logisticsId) {
      logRow = (logisticsState.data || []).find((l) => Number(l.id) === Number(opts.logisticsId)) || null;
      if (!logRow) {
        try {
          logRow = await api('GET', `/logistics/${opts.logisticsId}`);
        } catch (_) {
          logRow = null;
        }
      }
    }
    const det = await api('GET', `/inventory/outbound/${orderId}`);
    const ord = det.order;
    const lines = det.lines || [];
    const costSectionHtml = opts.logisticsId || opts.logisticsRow
      ? logisticsShipDetailCostSectionHtml(logRow)
      : '';
    const colHtml = '<colgroup><col style="width:25%"><col style="width:25%"><col style="width:15%"><col style="width:10%"><col style="width:25%"></colgroup>';
    const recipientCity = ord.recipient_city || '—';
    const contactName = ord.contact_name || '—';
    const contactPhone = ord.contact_phone || '—';
    const recipientAddr = ord.recipient_address || '—';
    const logisticsMethod = ord.logistics_method || '—';
    const trackingHtml = ord.tracking_number
      ? `<a href="https://www.sf-express.com/cn/sc/dynamic_function/waybill/#search/bill-number/${encodeURIComponent(String(ord.tracking_number))}" target="_blank" style="color:var(--accent);font-family:monospace;font-size:12px">${escapeHtml(ord.tracking_number)}</a>`
      : '<span style="color:var(--text-muted)">—</span>';
    const html = `
        <div class="inv-ob-shell">
          <div class="inv-ob-head-fixed">
            <div class="inv-ob-detail-head">出库单 #${ord.id} · ${ord.shipped_at ? String(ord.shipped_at).slice(0, 16) : '—'} · ${escapeHtml(invWarehouseFullLabel(ord))} · ${ord.status === 'closed' ? '已结清' : '待归还'}</div>
            <div class="activity-detail-grid logistics-ship-detail-grid" style="margin-bottom:8px">
              <section class="activity-detail-card">
                <h4>基础信息</h4>
                ${activityDetailRow('关联方式', ord.link_mode === 'standalone' ? '非项目出库' : '项目编号')}
                ${activityDetailRow(ord.link_mode === 'standalone' ? '用途说明' : '项目编号', ord.link_mode === 'standalone' ? (ord.purpose || '—') : (ord.project_code || '—'))}
                ${activityDetailRow('发货仓', invWarehouseFullLabel(ord))}
                ${activityDetailRow('状态', ord.status === 'closed' ? '已归还' : '出库中')}
              </section>
              <section class="activity-detail-card">
                <h4>收件信息</h4>
                ${activityDetailRow('收件城市', recipientCity)}
                ${activityDetailRow('联系人', contactName)}
                ${activityDetailRow('联系电话', contactPhone)}
                ${activityDetailRow('收件地址', recipientAddr)}
                ${activityDetailRow('公司名称', ord.logistics_supplier || '—')}
                ${activityDetailRow('物流方式', logisticsMethod)}
                ${activityDetailRowHtml('物流单号', trackingHtml)}
              </section>
              ${costSectionHtml}
            </div>
          </div>
          <div class="inv-ob-items-header">
            <span class="inv-ob-items-label">物品清单</span>
            <button type="button" class="btn btn-sm btn-secondary" onclick="invDownloadPdf(${ord.id})">PDF</button>
          </div>
          <table class="data-table inv-ob-head-table">
            ${colHtml}
            <thead><tr><th>物料</th><th>规格</th><th>所属仓</th><th>数量</th><th>行备注</th></tr></thead>
          </table>
          <div class="inv-ob-body-scroll">
            <table class="data-table">
              ${colHtml}
              <tbody>
                ${
                  lines.length
                    ? lines
                        .map(
                          (ln) => `<tr>
                  <td>${escapeHtml(ln.item_name)}</td>
                  <td>${escapeHtml(ln.item_dimensions || '—')}</td>
                  <td>${escapeHtml(ln.line_brand_code || '—')} ${escapeHtml(ln.line_region || '')}</td>
                  <td>${ln.quantity}</td>
                  <td>${escapeHtml(ln.line_note || '—')}</td>
                </tr>`,
                        )
                        .join('')
                    : '<tr><td colspan="5">无明细</td></tr>'
                }
              </tbody>
            </table>
          </div>
          ${logisticsShipDetailFooterHtml(opts.logisticsId)}
        </div>`;
    body.innerHTML = html;
    renderLucideIcons();
  } catch (e) {
    body.innerHTML = `<div class="empty-state" style="color:var(--danger)">${escapeHtml(e.message || '加载失败')}</div>`;
  }
}
