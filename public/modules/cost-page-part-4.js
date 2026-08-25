function costDetailToggleCategory(key) {
  const actId = parseInt(document.getElementById('costDetailActId')?.value, 10);
  if (!Number.isFinite(actId)) return;
  window._costDetailExpandedKey = window._costDetailExpandedKey === key ? null : key;
  showCostDetailFromCost(actId, { keepExpand: true });
}

async function openCostEditFromDetail() {
  const raw = document.getElementById('costDetailActId')?.value;
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) {
    showToast('无法识别场次', 'warning');
    return;
  }
  closeModal();
  setTimeout(() => showCostFillFromCost(id), 100);
}

async function clearActivityCostRegistrationFromDetail() {
  const raw = document.getElementById('costDetailActId')?.value;
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) {
    showToast('无法识别场次', 'warning');
    return;
  }
  await clearActivityCostRegistration(id);
}

async function clearActivityCostRegistration(actId) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可删除成本登记', 'warning');
    return;
  }
  const id = parseInt(actId, 10);
  if (!Number.isFinite(id)) return;
  if (!confirm('确定清除本场已登记的成本？清除后该场次将回到「待填写成本」，不会删除场次本身。')) return;
  try {
    await api('PUT', `/activities/${id}`, { total_cost: 0, cost_details: {}, no_cost: 0 });
    showToast('已清除成本登记', 'success');
    closeModal();
    if (currentPage === 'cost') await renderCost();
    if (currentPage === 'activities') loadActivities();
  } catch (e) {
    showToast(e.message || '操作失败', 'error');
  }
}

async function showCostFillFromCost(actId) {
  try {
    const a = await api('GET', `/activities/${actId}`);
    const details = parseActivityCostDetails(a);
    const content = document.getElementById('costFillContent2');
    if (!content) {
      showToast('找不到成本弹窗，请强制刷新页面 (Cmd+Shift+R)', 'error');
      return;
    }
    const total = calcCostDetailsTotal(details);
    const markedNoCost = a && (a.no_cost === true || a.no_cost === 1 || String(a.no_cost) === '1');
    content.innerHTML = `
      <input type="hidden" id="costActId2" value="${actId}">
      <div style="margin-bottom:12px;padding:10px;background:var(--bg-input);border-radius:var(--radius-sm)">
        <div style="font-size:12px;color:var(--text-secondary)">${a.project_code||a.city+(a.activity_type||'')}</div>
        <div style="font-size:13px;color:var(--text-primary);margin-top:2px">报价：<span class="amount amount-revenue">${fmtMoney(a.quoted_price)}</span></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:10px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer">
        <input type="checkbox" id="costNoCostFlag2" ${markedNoCost ? 'checked' : ''} onchange="toggleCostNoCostMode('2')">
        <span style="font-size:13px;color:var(--text-primary)">该场次无成本（勾选后不计入待填写成本）</span>
      </label>
      ${renderCostDetailSections('cost-field2', details, 'updateCostTotal2()')}
      <div style="margin-top:14px;padding:12px;background:var(--accent-soft);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--text-secondary);font-size:13px">成本合计</span>
        <span class="amount" style="font-size:18px;font-weight:700;color:var(--accent)" id="costTotal2">${fmtMoney(total)}</span>
      </div>
    `;
    toggleCostNoCostMode('2');
    openModal('modalCostFill2');
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

function updateCostTotal2() {
  let total = 0;
  document.querySelectorAll('.cost-field2').forEach((el) => {
    total += roundMoney2(el.value);
  });
  total = roundMoney2(total);
  const el = document.getElementById('costTotal2');
  if (el) el.textContent = fmtMoney(total);
}

async function saveCostFromModal2() {
  const actId = document.getElementById('costActId2').value;
  const noCost = !!document.getElementById('costNoCostFlag2')?.checked;
  const details = noCost ? {} : collectCostDetails('cost-field2');
  const total = noCost ? 0 : roundMoney2(calcCostDetailsTotal(details));
  try {
    await api('PUT', `/activities/${actId}`, { total_cost: total, cost_details: details, no_cost: noCost ? 1 : 0 });
    showToast('成本已保存', 'success');
    closeModal();
    renderCost();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}
