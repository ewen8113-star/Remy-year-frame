function reconcileRenderBatchList() {
  const host = document.getElementById('reconcileBody');
  if (!host) return;
  const rows = reconcilePageState.batches || [];
  const table = rows.length
    ? `<div class="table-wrapper"><table class="data-table">
        <thead><tr>
          <th>对账月</th><th>收款方</th><th>来源文件</th><th>状态</th><th>明细</th><th>可导入金额</th><th>操作</th>
        </tr></thead>
        <tbody>${rows.map((b) => {
          const s = b.summary_json || {};
          return `<tr>
            <td>${escapeHtml(b.settlement_month || '—')}</td>
            <td>${escapeHtml(b.payee_name || '—')}</td>
            <td title="${escapeHtml(b.source_filename || '')}">${escapeHtml((b.source_filename || '—').slice(0, 36))}</td>
            <td>${escapeHtml(reconcileStatusLabel(b.status))}</td>
            <td>${Number(s.totalLines || 0)} 行</td>
            <td style="text-align:right">${reconcileMoney(s.importableFee)}</td>
            <td>
              <button type="button" class="btn btn-secondary btn-sm" onclick="reconcileOpenBatch(${b.id})">打开</button>
              ${b.status !== 'committed' ? `<button type="button" class="btn btn-ghost btn-sm" onclick="reconcileDeleteBatch(${b.id})">删除</button>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody></table></div>`
    : `<div class="empty-state"><p>暂无物流对账草稿。上传供应商月结账单开始核对。</p></div>`;

  host.innerHTML = `
    <div class="recon-list-header">
      <div>
        <h3 class="recon-section-title">物流入账临时区</h3>
        <p class="recon-hint">上传衡之捷/盛融物流账单 → 分配项目编号或纳入统筹 → 预览后正式写入物流成本 → 再到付款申请勾选供应商收款。</p>
      </div>
      <div class="recon-list-actions">
        <button type="button" class="btn btn-primary" onclick="reconcileTriggerUpload()">
          <i data-lucide="upload" style="width:14px;height:14px"></i> 上传物流账单
        </button>
        <input type="file" id="reconcileUploadFile" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style="display:none" onchange="reconcileOnFileSelected(event)">
      </div>
    </div>
    ${table}
  `;
  renderLucideIcons();
}

function reconcileTriggerUpload() {
  if (!currentYearFrameId) {
    showToast('请先选择年框', 'warning');
    return;
  }
  const inp = document.getElementById('reconcileUploadFile');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

async function reconcileOnFileSelected(ev) {
  const file = ev.target && ev.target.files && ev.target.files[0];
  if (!file) return;
  if (!currentYearFrameId) {
    showToast('请先选择年框', 'warning');
    return;
  }
  const fd = new FormData();
  fd.append('file', file);
  fd.append('yearFrameId', String(currentYearFrameId));
  fd.append('payeeName', RECONCILE_DEFAULT_PAYEE);
  showToast('正在解析账单…', 'info');
  try {
    const res = await fetch('/api/reconcile/logistics/upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || '上传失败');
    const data = payload.data || {};
    reconcilePageState.batch = data.batch;
    reconcilePageState.lines = data.lines || [];
    reconcilePageState.batchId = data.batch && data.batch.id;
    showToast(payload.message || '已进入临时区', 'success');
    await ensureActivityProjectIndex();
    reconcileRenderDetail();
  } catch (e) {
    showToast(e.message || '上传失败', 'error');
  }
}

async function reconcileOpenBatch(id, showLoading = true) {
  const host = document.getElementById('reconcileBody');
  if (showLoading && host) host.innerHTML = '<div class="empty-state"><div class="skeleton skeleton-card"></div></div>';
  try {
    const res = await api('GET', `/reconcile/batches/${id}`);
    const data = (res && res.data) || {};
    reconcilePageState.batchId = id;
    reconcilePageState.batch = data.batch;
    reconcilePageState.lines = data.lines || [];
    await ensureActivityProjectIndex();
    reconcileRenderDetail();
  } catch (e) {
    showToast(e.message || '打开失败', 'error');
    reconcilePageState.batchId = null;
    reconcileRenderBatchList();
  }
}

async function reconcileDeleteBatch(id) {
  if (!confirm('确认删除此对账草稿？不可恢复。')) return;
  try {
    await api('DELETE', `/reconcile/batches/${id}`);
    showToast('已删除', 'success');
    if (reconcilePageState.batchId === id) {
      reconcilePageState.batchId = null;
      reconcilePageState.batch = null;
      reconcilePageState.lines = [];
    }
    await reconcileLoadList();
  } catch (e) {
    showToast(e.message || '删除失败', 'error');
  }
}

function reconcileBackToList() {
  reconcilePageState.batchId = null;
  reconcilePageState.batch = null;
  reconcilePageState.lines = [];
  reconcilePageState.preview = null;
  reconcileRenderBatchList();
}

function reconcileFilteredLines() {
  const q = String(reconcilePageState.search || '').trim().toLowerCase();
  const f = reconcilePageState.filter || 'all';
  return (reconcilePageState.lines || []).filter((l) => {
    if (f === 'pending' && !(l.line_status === 'pending' || l.allocation_type === 'unassigned')) return false;
    if (f === 'suggested' && l.line_status !== 'suggested') return false;
    if (f === 'confirmed' && l.line_status !== 'confirmed') return false;
    if (f === 'skipped' && l.allocation_type !== 'skipped' && l.line_status !== 'skipped') return false;
    if (!q) return true;
    const blob = [
      l.raw_project, l.related_project_code, l.purpose, l.tracking_number,
      l.express_company, l.raw_type, l.recv_name, l.ship_name, l.skip_reason,
      l.raw_origin_city, l.raw_dest_city, l.ship_addr, l.recv_addr,
      l.ship_phone, l.recv_phone, l.raw_remarks,
    ].join(' ').toLowerCase();
    return blob.includes(q);
  });
}

/** 临时对账：拼一条可读的收发地址摘要（判断归属用） */
function reconcileAddrParty(city, name, phone, addr) {
  const c = String(city || '').trim();
  const n = String(name || '').replace(/[，,]+$/g, '').trim();
  const p = String(phone || '').trim();
  const a = String(addr || '')
    .replace(/^所在地区[：:]\s*/g, '')
    .replace(/详细地址[：:]\s*/g, '')
    .replace(/^地址[：:]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const head = [c, n].filter(Boolean).join(' · ');
  const contact = p ? ` ${p}` : '';
  const detail = a ? ` ${a}` : '';
  return `${head || '—'}${contact}${detail}`.trim();
}

function reconcileRouteHtml(l) {
  const fromFull = reconcileAddrParty(l.raw_origin_city, l.ship_name, l.ship_phone, l.ship_addr);
  const toFull = reconcileAddrParty(l.raw_dest_city, l.recv_name, l.recv_phone, l.recv_addr);
  const fromShort = reconcileAddrParty(l.raw_origin_city, l.ship_name, '', l.ship_addr);
  const toShort = reconcileAddrParty(l.raw_dest_city, l.recv_name, '', l.recv_addr);
  const tip = escapeHtml(`发：${fromFull}\n收：${toFull}`);
  return `<div class="recon-route" title="${tip}">
    <div class="recon-route-leg"><span class="recon-route-tag">发</span><span class="recon-route-text">${escapeHtml(fromShort)}</span></div>
    <div class="recon-route-leg"><span class="recon-route-tag recon-route-tag--to">收</span><span class="recon-route-text">${escapeHtml(toShort)}</span></div>
  </div>`;
}

function reconcileSummaryFromLines(lines) {
  const s = { total: lines.length, pending: 0, suggested: 0, confirmed: 0, skipped: 0, activityFee: 0, pooledFee: 0, totalFee: 0 };
  lines.forEach((l) => {
    if (l.allocation_type === 'skipped' || l.line_status === 'skipped') s.skipped += 1;
    else if (l.line_status === 'confirmed') s.confirmed += 1;
    else if (l.line_status === 'suggested') s.suggested += 1;
    else s.pending += 1;
    const fee = roundMoney2(l.fee);
    s.totalFee = roundMoney2(s.totalFee + fee);
    if (l.allocation_type === 'activity') s.activityFee = roundMoney2(s.activityFee + fee);
    if (l.allocation_type === 'pooled') s.pooledFee = roundMoney2(s.pooledFee + fee);
  });
  return s;
}

function reconcileProjectOptionsHtml(selected) {
  const codes = [...logisticsProjectIndex.codes].sort();
  const sel = String(selected || '').trim();
  return `<option value="">选择项目编号…</option>` + codes.map((c) =>
    `<option value="${escapeHtml(c)}" ${c === sel ? 'selected' : ''}>${escapeHtml(c)}</option>`
  ).join('');
}

function reconcileRenderDetail() {
  const host = document.getElementById('reconcileBody');
  const batch = reconcilePageState.batch;
  if (!host || !batch) return;
  const readonly = batch.status === 'committed';
  const summary = reconcileSummaryFromLines(reconcilePageState.lines);
  const lines = reconcileFilteredLines();
  const filter = reconcilePageState.filter;

  host.innerHTML = `
    <div class="recon-detail">
      <div class="recon-detail-bar">
        <button type="button" class="btn btn-ghost btn-sm" onclick="reconcileBackToList()">← 返回列表</button>
        <div class="recon-detail-meta">
          <label>对账月
            <input type="month" class="form-control" id="reconSettlementMonth" value="${escapeHtml((batch.settlement_month || '').slice(0, 7))}" ${readonly ? 'disabled' : ''} onchange="reconcileSaveBatchMeta()">
          </label>
          <label>收款方
            <input type="text" class="form-control" id="reconPayeeName" value="${escapeHtml(batch.payee_name || RECONCILE_DEFAULT_PAYEE)}" ${readonly ? 'disabled' : ''} onchange="reconcileSaveBatchMeta()" style="min-width:220px">
          </label>
          <span class="recon-status-pill">${escapeHtml(reconcileStatusLabel(batch.status))}</span>
        </div>
        <div class="recon-detail-actions">
          ${readonly ? '' : `
            <button type="button" class="btn btn-secondary btn-sm" onclick="reconcileAcceptSuggestions()">确认全部建议</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="reconcileBulkPool()">待处理→统筹</button>
            <button type="button" class="btn btn-primary btn-sm" onclick="reconcileCommit()">预览并正式入库</button>
          `}
        </div>
      </div>
      <div class="recon-summary-row">
        <span>共 ${summary.total} 行</span>
        <span>待分配 ${summary.pending}</span>
        <span>建议 ${summary.suggested}</span>
        <span>已确认 ${summary.confirmed}</span>
        <span>跳过 ${summary.skipped}</span>
        <span>项目成本 ${reconcileMoney(summary.activityFee)}</span>
        <span>统筹 ${reconcileMoney(summary.pooledFee)}</span>
        <span><strong>合计 ${reconcileMoney(summary.totalFee)}</strong></span>
      </div>
      <div class="recon-filter-row">
        <div class="reimb-tool-group">
          ${[['all','全部'],['pending','待分配'],['suggested','建议'],['confirmed','已确认'],['skipped','跳过']].map(([k,l]) =>
            `<button type="button" class="btn reimb-tool-btn reimb-tool-btn--tab" data-active="${filter === k ? 'true' : 'false'}" onclick="reconcileSetFilter('${k}')">${l}</button>`
          ).join('')}
        </div>
        <input type="text" class="form-control" placeholder="搜索城市/地址/项目/单号/说明…" value="${escapeHtml(reconcilePageState.search || '')}" oninput="reconcilePageState.search=this.value;reconcileRenderDetail()" style="max-width:320px;margin-left:auto">
      </div>
      <div class="table-wrapper recon-table-wrap">
        <table class="data-table recon-table">
          <thead>
            <tr>
              <th>#</th><th>状态</th><th>日期</th><th>类型</th><th>收发地址</th><th>原始项目</th><th>归属</th>
              <th>单号/方式</th><th style="text-align:right">金额</th><th>说明</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${lines.map((l) => reconcileLineRowHtml(l, readonly)).join('') || '<tr><td colspan="11" class="empty-state">无匹配明细</td></tr>'}
          </tbody>
        </table>
      </div>
      <p class="recon-hint">提示：请根据「收发地址」判断场次归属；天津仓储费会自动跳过。有项目编号计入项目成本，无编号纳入统筹。正式入库后到「付款申请」按收款方「衡之捷」勾选生成付款单。</p>
    </div>
  `;
}
