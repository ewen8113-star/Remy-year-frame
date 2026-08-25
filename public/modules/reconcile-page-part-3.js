function reconcileLineRowHtml(l, readonly) {
  const fee = reconcileMoney(l.fee);
  const track = escapeHtml([l.express_company, l.tracking_number].filter(Boolean).join(' / ') || '—');
  const alloc = l.allocation_type === 'activity'
    ? escapeHtml(l.related_project_code || '—')
    : (l.allocation_type === 'pooled' ? '统筹成本' : (l.allocation_type === 'skipped' ? (l.skip_reason || '跳过') : '—'));
  const actions = readonly
    ? '—'
    : (l.allocation_type === 'skipped'
      ? `<button type="button" class="btn btn-ghost btn-sm" onclick="reconcileUnskipLine(${l.id})">恢复</button>`
      : `<div class="recon-line-actions">
          <select class="form-control recon-project-select" id="reconProj_${l.id}" onchange="reconcileAssignActivity(${l.id}, this.value)">
            ${reconcileProjectOptionsHtml(l.related_project_code || l.suggested_project_code || '')}
          </select>
          <button type="button" class="btn btn-secondary btn-sm" onclick="reconcileSetPooled(${l.id})">统筹</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="reconcileSkipLine(${l.id})">跳过</button>
          ${l.line_status === 'suggested' ? `<button type="button" class="btn btn-primary btn-sm" onclick="reconcileAcceptOne(${l.id})">确认</button>` : ''}
        </div>`);
  return `<tr class="${l.allocation_type === 'skipped' ? 'recon-row--skip' : ''}">
    <td>${l.line_no || ''}</td>
    <td>${reconcileLineStatusBadge(l)}</td>
    <td>${escapeHtml((l.shipping_date || l.raw_date || '').toString().slice(0, 10))}</td>
    <td>${escapeHtml(l.raw_type || '—')}</td>
    <td class="recon-route-cell">${reconcileRouteHtml(l)}</td>
    <td title="${escapeHtml(l.raw_project || '')}">${escapeHtml((l.raw_project || '—').slice(0, 28))}</td>
    <td title="${escapeHtml(alloc)}">${escapeHtml(String(alloc).slice(0, 36))}</td>
    <td title="${track}">${track.slice(0, 28)}</td>
    <td style="text-align:right">${fee}</td>
    <td class="recon-purpose-cell" title="${escapeHtml(l.purpose || '')}">
      ${readonly ? escapeHtml(l.purpose || '—') : `<input type="text" class="form-control recon-purpose-input" value="${escapeHtml(l.purpose || '')}" onchange="reconcileUpdatePurpose(${l.id}, this.value)">`}
    </td>
    <td>${actions}</td>
  </tr>`;
}

function reconcileSetFilter(f) {
  reconcilePageState.filter = f || 'all';
  reconcileRenderDetail();
}

async function reconcileSaveBatchMeta() {
  const batch = reconcilePageState.batch;
  if (!batch || batch.status === 'committed') return;
  const ym = document.getElementById('reconSettlementMonth')?.value || '';
  const payee = document.getElementById('reconPayeeName')?.value?.trim() || RECONCILE_DEFAULT_PAYEE;
  try {
    const res = await api('PATCH', `/reconcile/batches/${batch.id}`, {
      settlement_month: ym,
      payee_name: payee,
    });
    reconcilePageState.batch = (res && res.data) || batch;
    showToast('批次信息已保存', 'success');
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

async function reconcilePatchLine(id, body) {
  const res = await api('PATCH', `/reconcile/lines/${id}`, body);
  const line = res && res.data && res.data.line;
  if (line) {
    const idx = reconcilePageState.lines.findIndex((x) => Number(x.id) === Number(id));
    if (idx >= 0) reconcilePageState.lines[idx] = line;
    if (res.data.summary && reconcilePageState.batch) {
      reconcilePageState.batch.summary_json = res.data.summary;
    }
  }
  reconcileRenderDetail();
  return res;
}

async function reconcileAssignActivity(id, projectCode) {
  if (!projectCode) return;
  try {
    await reconcilePatchLine(id, { action: 'activity', related_project_code: projectCode });
    showToast('已计入项目成本', 'success');
  } catch (e) {
    showToast(e.message || '分配失败', 'error');
  }
}

async function reconcileSetPooled(id) {
  try {
    await reconcilePatchLine(id, { action: 'pooled' });
    showToast('已纳入统筹成本', 'success');
  } catch (e) {
    showToast(e.message || '操作失败', 'error');
  }
}

async function reconcileSkipLine(id) {
  try {
    await reconcilePatchLine(id, { action: 'skip', skip_reason: '手动跳过' });
  } catch (e) {
    showToast(e.message || '操作失败', 'error');
  }
}

async function reconcileUnskipLine(id) {
  try {
    await reconcilePatchLine(id, { action: 'pooled' });
  } catch (e) {
    showToast(e.message || '操作失败', 'error');
  }
}

async function reconcileAcceptOne(id) {
  try {
    await reconcilePatchLine(id, { action: 'accept_suggestion' });
  } catch (e) {
    showToast(e.message || '确认失败', 'error');
  }
}

async function reconcileUpdatePurpose(id, purpose) {
  try {
    await reconcilePatchLine(id, { purpose });
  } catch (e) {
    showToast(e.message || '保存说明失败', 'error');
  }
}

async function reconcileAcceptSuggestions() {
  const batch = reconcilePageState.batch;
  if (!batch) return;
  try {
    const res = await api('POST', `/reconcile/batches/${batch.id}/accept-suggestions`);
    reconcilePageState.lines = (res.data && res.data.lines) || reconcilePageState.lines;
    reconcilePageState.batch = (res.data && res.data.batch) || batch;
    showToast(res.message || '已确认建议', 'success');
    reconcileRenderDetail();
  } catch (e) {
    showToast(e.message || '操作失败', 'error');
  }
}

async function reconcileBulkPool() {
  if (!confirm('将所有「待分配 / 建议统筹」行确认为纳入统筹成本？')) return;
  const batch = reconcilePageState.batch;
  if (!batch) return;
  try {
    const res = await api('POST', `/reconcile/batches/${batch.id}/bulk-pool`);
    reconcilePageState.lines = (res.data && res.data.lines) || reconcilePageState.lines;
    reconcilePageState.batch = (res.data && res.data.batch) || batch;
    showToast(res.message || '已纳入统筹', 'success');
    reconcileRenderDetail();
  } catch (e) {
    showToast(e.message || '操作失败', 'error');
  }
}

async function reconcileCommit() {
  const batch = reconcilePageState.batch;
  if (!batch) return;
  try {
    const prev = await api('GET', `/reconcile/batches/${batch.id}/preview`);
    const preview = prev.data && prev.data.preview;
    if (!preview) throw new Error('预览失败');
    if (!preview.canCommit) {
      showToast(`还有 ${preview.blockedCount} 行未确认归属`, 'warning');
      return;
    }
    const ok = confirm(
      `确认正式入库？\n\n收款方：${preview.payee_name}\n对账月：${preview.settlement_month}\n项目成本：${preview.activityCount} 条 / ${fmtMoney(preview.activityFee)}\n统筹成本：${preview.pooledCount} 条 / ${fmtMoney(preview.pooledFee)}\n跳过：${preview.skippedCount} 条\n合计导入：${preview.importCount} 条 / ${fmtMoney(preview.importFee)}`
    );
    if (!ok) return;
    const res = await api('POST', `/reconcile/batches/${batch.id}/commit`);
    showToast(res.message || '入库成功', 'success');
    reconcilePageState.batch = (res.data && res.data.batch) || batch;
    await reconcileOpenBatch(batch.id, false);
    if (typeof updateBadges === 'function') void updateBadges();
  } catch (e) {
    showToast(e.message || '入库失败', 'error');
  }
}
