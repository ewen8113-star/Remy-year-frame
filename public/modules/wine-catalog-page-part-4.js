async function showWineUsageModal(prefillUsageId = null) {
  const content = document.getElementById('wineUsageContent');
  if (!content) {
    showToast('找不到酒品归还弹窗，请刷新页面', 'error');
    return;
  }
  content.innerHTML = `<div style="color:var(--text-muted);padding:10px">加载中...</div>`;
  openModal('modalWineUsage');

  try {
    const qs = currentYearFrameId ? `?year_frame_id=${currentYearFrameId}` : '';
    const [usageRows, activityRows] = await Promise.all([
      api('GET', `/wine/usage${qs}`),
      api('GET', `/activities${currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : ''}`),
    ]);
    const validUsages = (usageRows || []).filter((r) => Number(r.quantity) > 0 && Number(r.activity_id) > 0);
    const actMap = new Map((activityRows || []).map((a) => [Number(a.id), a]));
    const projectRows = [];
    const seen = new Set();
    const projectToUsages = new Map();
    const projectCodeToActivityId = new Map();
    validUsages.forEach((r) => {
      const actId = Number(r.activity_id);
      if (!projectToUsages.has(actId)) projectToUsages.set(actId, []);
      projectToUsages.get(actId).push(r);
      if (!seen.has(actId)) {
        const act = actMap.get(actId) || {};
        const code = String(act.project_code || `#${actId}`);
        projectRows.push({
          activity_id: actId,
          project_code: code,
          city: act.city || '',
          activity_type: act.activity_type || '',
        });
        projectCodeToActivityId.set(code, actId);
        seen.add(actId);
      }
    });
    wineReturnDialogState = { usageRows: validUsages, projectRows, projectToUsages, projectCodeToActivityId };

    content.innerHTML = `
      <form id="wineUsageForm" style="display:flex;flex-direction:column;gap:12px">
        <input type="hidden" id="wineUsageId" value="">
        <div class="form-group">
          <label class="form-label">项目编号 <span class="required">*</span></label>
          <input type="text" class="form-control" id="wineReturnProject" list="wineReturnProjectList" placeholder="输入关键词并从下拉建议中选择项目编号" required>
          <datalist id="wineReturnProjectList"></datalist>
        </div>
        <div class="form-group">
          <label class="form-label">酒品 <span class="required">*</span></label>
          <select class="form-control" id="wineUseSel" required>
            <option value="">请先选择项目编号</option>
          </select>
        </div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="form-group">
            <label class="form-label">归还数量（瓶）<span class="required">*</span></label>
            <input type="number" class="form-control" id="wineUseQty" min="1" value="1" required>
          </div>
          <div class="form-group">
            <label class="form-label">归还说明</label>
            <input type="text" class="form-control" id="wineUseRemarks" placeholder="如：活动剩余未开封">
          </div>
        </div>
        <div id="wineUseWarning" style="display:none;padding:10px;background:#FEF3C7;border-radius:var(--radius-sm);font-size:13px;color:#92400E">
          请先选择项目和酒品
        </div>
      </form>
    `;

    const titleEl = document.querySelector('#modalWineUsage .modal-title');
    if (titleEl) titleEl.innerHTML = '<i data-lucide="rotate-ccw" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>酒品归还';

    const projectInput = document.getElementById('wineReturnProject');
    const usageSel = document.getElementById('wineUseSel');
    const qtyInput = document.getElementById('wineUseQty');
    if (projectInput) projectInput.oninput = () => renderWineReturnUsageOptions();
    if (usageSel) usageSel.onchange = () => updateWineReturnLimit();
    if (qtyInput) qtyInput.oninput = () => updateWineReturnLimit();

    renderWineReturnProjectOptions();
    if (prefillUsageId) {
      const target = validUsages.find((r) => Number(r.id) === Number(prefillUsageId));
      if (target && projectInput && usageSel) {
        const p = projectRows.find((x) => Number(x.activity_id) === Number(target.activity_id));
        projectInput.value = p ? p.project_code : '';
        renderWineReturnUsageOptions();
        usageSel.value = String(target.id);
        updateWineReturnLimit();
      }
    }
    renderLucideIcons();
  } catch (err) {
    content.innerHTML = `<div style="color:var(--danger)">加载失败: ${err.message}</div>`;
  }
}

async function confirmWineUsage() {
  const usageId = parseInt(document.getElementById('wineUseSel')?.value || '', 10);
  const qty = parseInt(document.getElementById('wineUseQty')?.value || '', 10) || 0;
  const max = parseInt(document.getElementById('wineUseSel')?.selectedOptions?.[0]?.dataset?.max || '0', 10) || 0;
  const remarks = document.getElementById('wineUseRemarks')?.value || '';
  if (!usageId) { showToast('请选择项目下的酒品', 'error'); return; }
  if (!qty || qty < 1 || qty > max) { showToast(`归还数量需在 1-${max} 之间`, 'error'); return; }

  try {
    await api('POST', `/wine/usage/${usageId}/return`, {
      quantity: qty,
      remarks,
      operator: getCurrentUserName(),
    });
    closeModal();
    showToast('酒品归还成功', 'success');
    await loadWineInventory();
    await loadWineRecords('returns');
  } catch (err) {
    showToast(err.message || '归还失败', 'error');
  }
}

async function deleteWineStockIn(id) {
  if (!confirm('确定删除这条入库记录？删除后会回滚库存。')) return;
  try {
    try {
      await api('DELETE', `/wine/stock-in/${id}`);
    } catch (err) {
      if (!String(err?.message || '').includes('(404)')) throw err;
      // 兼容某些环境不支持 DELETE 路由
      await api('POST', `/wine/stock-in/${id}/delete`, {});
    }
    showToast('入库记录已删除并回滚库存', 'success');
    await loadWineInventory();
    await loadWineRecords('stockIn');
  } catch (err) {
    showToast(err.message || '删除入库记录失败', 'error');
  }
}

async function deleteWineReturnLog(id) {
  if (!confirm('确定删除这条归还记录？删除后会回滚库存并恢复用酒数量。')) return;
  try {
    try {
      await api('DELETE', `/wine/returns/${id}`);
    } catch (err) {
      if (!String(err?.message || '').includes('(404)')) throw err;
      await api('POST', `/wine/returns/${id}/delete`, {});
    }
    showToast('归还记录已删除并完成回滚', 'success');
    await loadWineInventory();
    await loadWineRecords('returns');
  } catch (err) {
    showToast(err.message || '删除归还记录失败', 'error');
  }
}

async function deleteWineUsage(id) {
  if (!confirm('确定删除此使用记录？库存将自动回补。')) return;
  try {
    await api('DELETE', `/wine/usage/${id}`);
    showToast('已删除，库存已回补', 'success');
    loadWineRecords('usage');
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

/* =============================================
   品牌管理
   ============================================= */
