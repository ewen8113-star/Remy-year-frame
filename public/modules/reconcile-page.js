/* 临时对账页面：依赖 app.js 暴露的 api / escapeHtml / showToast / fmtMoney / roundMoney2 / ensureActivityProjectIndex / logisticsProjectIndex / currentYearFrameId */

/* =============================================
   页面：临时对账（物流入账 / 报销入账占位）
   ============================================= */
const RECONCILE_DEFAULT_PAYEE = '上海衡之捷供应链管理有限公司';

let reconcilePageState = {
  tab: 'logistics', // logistics | reimbursement
  batches: [],
  batchId: null,
  batch: null,
  lines: [],
  filter: 'all', // all | pending | suggested | confirmed | skipped
  search: '',
  preview: null,
  loading: false,
};

function reconcileStatusLabel(status) {
  const map = {
    draft: '草稿',
    ready: '待入库',
    committed: '已入库',
    cancelled: '已取消',
  };
  return map[status] || status || '—';
}

function reconcileLineStatusBadge(line) {
  if (line.allocation_type === 'skipped' || line.line_status === 'skipped') {
    return '<span class="recon-badge recon-badge--skip">跳过</span>';
  }
  if (line.line_status === 'confirmed') {
    if (line.allocation_type === 'activity') return '<span class="recon-badge recon-badge--activity">项目成本</span>';
    if (line.allocation_type === 'pooled') return '<span class="recon-badge recon-badge--pool">统筹</span>';
  }
  if (line.line_status === 'suggested') {
    if (line.allocation_type === 'activity') return '<span class="recon-badge recon-badge--suggest">建议·项目</span>';
    if (line.allocation_type === 'pooled') return '<span class="recon-badge recon-badge--suggest">建议·统筹</span>';
  }
  return '<span class="recon-badge recon-badge--pending">待分配</span>';
}

function reconcileMoney(n) {
  return fmtMoney(roundMoney2(n || 0));
}

async function renderReconcile() {
  const container = document.getElementById('pageContainer');
  if (!container) return;
  container.innerHTML = `
    <div class="reconcile-page">
      <div class="page-toolbar reimbursement-toolbar">
        <div class="reimb-tool-group" role="tablist" aria-label="临时对账类型">
          <button type="button" class="btn reimb-tool-btn reimb-tool-btn--tab" data-active="${reconcilePageState.tab === 'logistics' ? 'true' : 'false'}" onclick="reconcileSwitchTab('logistics')">物流入账</button>
          <button type="button" class="btn reimb-tool-btn reimb-tool-btn--tab" data-active="${reconcilePageState.tab === 'reimbursement' ? 'true' : 'false'}" onclick="reconcileSwitchTab('reimbursement')">报销入账</button>
        </div>
      </div>
      <div id="reconcileBody"></div>
    </div>
  `;
  if (reconcilePageState.tab === 'reimbursement') {
    document.getElementById('reconcileBody').innerHTML = `
      <div class="empty-state" style="padding:48px 24px">
        <p style="margin:0 0 8px;font-size:16px">报销入账临时区（二期）</p>
        <p style="margin:0;color:var(--text-secondary);font-size:13px">一期先做物流月结对账。报销可继续使用「付款申请 → 报销导入」，后续会升级为可编辑临时区。</p>
      </div>`;
    renderLucideIcons();
    return;
  }
  await reconcileLoadList();
}

function reconcileSwitchTab(tab) {
  reconcilePageState.tab = tab === 'reimbursement' ? 'reimbursement' : 'logistics';
  if (tab !== 'logistics') {
    reconcilePageState.batchId = null;
    reconcilePageState.batch = null;
    reconcilePageState.lines = [];
  }
  renderReconcile();
}

async function reconcileLoadList() {
  const host = document.getElementById('reconcileBody');
  if (!host) return;
  host.innerHTML = '<div class="empty-state"><div class="skeleton skeleton-card"></div></div>';
  try {
    const qs = currentYearFrameId ? `?type=logistics&yearFrameId=${currentYearFrameId}` : '?type=logistics';
    const res = await api('GET', `/reconcile/batches${qs}`);
    reconcilePageState.batches = (res && res.data) || [];
    if (reconcilePageState.batchId) {
      await reconcileOpenBatch(reconcilePageState.batchId, false);
      return;
    }
    reconcileRenderBatchList();
  } catch (e) {
    host.innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message || '加载失败')}</p></div>`;
  }
}
