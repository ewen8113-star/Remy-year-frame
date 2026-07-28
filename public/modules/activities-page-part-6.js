async function showActivityDetail(id, opts = {}) {
  try {
    const raw = await api('GET', `/activities/${encodeURIComponent(id)}?cb=${Date.now()}`);
    const a = mergeActivityBelongingFromListRow(raw, id);
    const isVirt =
      !!(opts && opts.virtualContext) ||
      Number(a.is_virtual) === 1 ||
      a.is_virtual === true;
    await ensureBelongingLabelMap();
    const belRaw = displayActivityBelongingValue(a);
    const belLabel = belRaw ? belongingLabelForValue(belRaw) : '';
    const content = document.getElementById('activityDetailContent');
    if (!content) {
      showToast('找不到活动详情弹窗，请强制刷新页面 (Cmd+Shift+R)', 'error');
      return;
    }
    const guestLine =
      a.guest_count != null && Number(a.guest_count) > 0
        ? activityDetailRow('宾客人数', String(a.guest_count))
        : '';
    const costHtml =
      parseFloat(a.total_cost) > 0
        ? `<span class="amount amount-cost">${fmtMoney(a.total_cost)}</span>`
        : '<span class="amount amount-neutral">未填写</span>';
    const quotedExTaxHtml = isVirt
      ? activityDetailRowHtml(
          '不含税金额',
          `<span class="amount">${fmtMoney(quotedPriceExTax(a.quoted_price))}</span><span class="activity-detail-tax-hint">税 6%</span>`,
        )
      : '';

    const titleEl = document.getElementById('activityDetailModalTitle');
    if (titleEl) {
      const pc = a.project_code ? String(a.project_code).trim() : '';
      titleEl.textContent = isVirt
        ? pc
          ? `虚拟场次 · ${pc}`
          : '虚拟场次详情'
        : pc
          ? `活动详情 · ${pc}`
          : '活动详情';
    }

    content.innerHTML = `
      <div class="activity-detail">
        <div class="activity-detail-hero">
          <div class="activity-detail-hero-top">
            <div class="activity-detail-hero-code">${escapeHtml(a.project_code || '—')}</div>
            <div class="activity-detail-hero-date">${escapeHtml(fmtDate(a.date || a.activity_date))}</div>
          </div>
          <div class="activity-detail-hero-meta">
            ${isVirt ? `<span class="badge badge-blue">虚拟场次</span>` : ''}
            <span><strong style="color:var(--text-primary)">${escapeHtml(a.city || '—')}</strong></span>
            <span class="badge badge-${brandColor(a.brand)}">${escapeHtml(a.brand || '—')}</span>
            <span class="badge badge-${typeColor(a.activity_type)}">${escapeHtml(a.activity_type || '—')}</span>
            ${
              belRaw
                ? `<span class="badge badge-gray" title="归属">${escapeHtml(belLabel)}</span>`
                : '<span style="font-size:12px;color:var(--text-muted)">归属：—</span>'
            }
          </div>
        </div>

        <div class="activity-detail-grid">
          <section class="activity-detail-card">
            <h4>场次与场地</h4>
            ${activityDetailRow('时段', a.period || '日常')}
            ${activityDetailRow('区域', a.region)}
            ${activityDetailRow('归属', belRaw ? belLabel : '')}
            ${activityDetailRow('场地', a.venue)}
            ${activityDetailRow('客户', a.client || a.client_name)}
            ${activityDetailRowHtml('云相册', activityCloudAlbumButtonHtml(a.cloud_album_url, { detailLabel: true }))}
            ${guestLine}
          </section>
          <section class="activity-detail-card">
            <h4>费用与执行</h4>
            ${activityDetailRowHtml('报价', `<span class="amount amount-revenue">${fmtMoney(a.quoted_price)}</span>`)}
            ${quotedExTaxHtml}
            ${activityDetailRowHtml('成本', costHtml)}
            ${activityDetailRow('执行', a.executor || '无')}
            ${activityDetailRow('品牌大使', a.brand_ambassador || '')}
            ${activityDetailRowHtml('状态', statusBadge(a.status))}
          </section>
        </div>

        ${
          a.remarks
            ? `<div class="activity-detail-remarks activity-detail-block"><h4>备注</h4><p>${escapeHtml(a.remarks)}</p></div>`
            : ''
        }
        ${
          isVirt
            ? `<div class="activity-detail-block" style="margin-top:12px;font-size:12px;color:var(--text-secondary)">此为虚拟预估场次，不参与排期日历；报价计入上方「虚拟场次」页预存统计。</div>`
            : ''
        }
      </div>
    `;

    const editBtn = document.getElementById('detailEditBtn');
    if (editBtn) {
      editBtn.onclick = () => {
        closeModal();
        setTimeout(() => (isVirt ? showVirtualActivityModal(id) : showActivityModal(id)), 100);
      };
    }

    const outboundBtn = document.getElementById('detailOutboundBtn');
    if (outboundBtn) {
      if (isVirt || !hasWriteAccess()) {
        outboundBtn.style.display = 'none';
        outboundBtn.onclick = null;
      } else {
        outboundBtn.style.display = '';
        outboundBtn.onclick = () => {
          closeModal();
          setTimeout(() => invOpenOutboundModalForActivity(a), 100);
        };
      }
    }

    openModal('modalActivityDetail');
    renderLucideIcons();
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

// 成本填写弹窗
async function showCostFill(actId) {
  try {
    const a = await api('GET', `/activities/${actId}`);
    const details = parseActivityCostDetails(a);
    const cost = calcCostDetailsTotal(details);
    const markedNoCost = a && (a.no_cost === true || a.no_cost === 1 || String(a.no_cost) === '1');

    const content = document.getElementById('costFillContent');
    if (!content) {
      showToast('找不到成本弹窗，请强制刷新页面 (Cmd+Shift+R)', 'error');
      return;
    }
    content.innerHTML = `
      <input type="hidden" id="costActId" value="${actId}">
      <div style="margin-bottom:12px;padding:10px;background:var(--bg-input);border-radius:var(--radius-sm)">
        <div style="font-size:12px;color:var(--text-secondary)">${a.project_code||a.city+a.activity_type}</div>
        <div style="font-size:13px;color:var(--text-primary);margin-top:2px">当前成本：<span class="amount amount-cost">${cost>0?fmtMoney(cost):'未填写'}</span></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:10px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer">
        <input type="checkbox" id="costNoCostFlag" ${markedNoCost ? 'checked' : ''} onchange="toggleCostNoCostMode('1')">
        <span style="font-size:13px;color:var(--text-primary)">该场次无成本（勾选后不计入待填写成本）</span>
      </label>
      ${renderCostDetailSections('cost-field', details, 'updateCostTotal()')}
      <div style="margin-top:14px;padding:12px;background:var(--accent-soft);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--text-secondary);font-size:13px">成本合计</span>
        <span class="amount" style="font-size:18px;font-weight:700;color:var(--accent)" id="costTotal">${fmtMoney(cost)}</span>
      </div>
    `;

    toggleCostNoCostMode('1');
    openModal('modalCostFill');
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

function toggleCostNoCostMode(mode) {
  const checkboxId = mode === '2' ? 'costNoCostFlag2' : 'costNoCostFlag';
  const fieldClass = mode === '2' ? 'cost-field2' : 'cost-field';
  const checked = !!document.getElementById(checkboxId)?.checked;
  document.querySelectorAll(`.${fieldClass}`).forEach((el) => {
    el.disabled = checked;
    if (checked) el.value = '';
  });
  if (mode === '2') updateCostTotal2();
  else updateCostTotal();
}

function updateCostTotal() {
  let total = 0;
  document.querySelectorAll('.cost-field').forEach(el => {
    total += roundMoney2(el.value);
  });
  total = roundMoney2(total);
  const el = document.getElementById('costTotal');
  if (el) el.textContent = fmtMoney(total);
}

async function saveCostFromModal() {
  const actId = document.getElementById('costActId').value;
  const noCost = !!document.getElementById('costNoCostFlag')?.checked;
  const details = noCost ? {} : collectCostDetails('cost-field');
  const total = noCost ? 0 : roundMoney2(calcCostDetailsTotal(details));

  try {
    await api('PUT', `/activities/${actId}`, { total_cost: total, cost_details: details, no_cost: noCost ? 1 : 0 });
    showToast('成本已保存', 'success');
    closeModal();
    if (currentPage === 'activities') loadActivities();
    else if (currentPage === 'calendar' && typeof window._calYear === 'number') drawCalendar(window._calYear, window._calMonth);
    else if (currentPage === 'cost') renderCost();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

function fmtDateTime(v) {
  const p = beijingParts(v);
  if (!p) return v ? String(v) : '—';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`;
}
