async function syncActivityWineUsageRecords(activityId, activityBody) {
  if (!activityId) return;
  const yearFrameId = Number(activityBody?.year_frame_id || currentYearFrameId || 0);
  const usageDate = activityBody?.date || todayDateInputValue();
  const clientName = activityBody?.client_name || activityBody?.client || '';
  const desiredMap = parseWineDetails(activityBody?.wine_details);

  const usageRows = await api('GET', `/wine/usage?year_frame_id=${yearFrameId}`);
  const existing = (usageRows || []).filter((r) => Number(r.activity_id) === Number(activityId));
  const existingByCode = new Map(existing.map((r) => [String(r.wine_code || ''), r]));

  for (const [wineCode, detail] of Object.entries(desiredMap)) {
    const qty = parseInt(detail?.qty, 10) || 0;
    if (qty <= 0) continue;
    const payload = {
      year_frame_id: yearFrameId,
      activity_id: Number(activityId),
      wine_code: wineCode,
      wine_name: detail?.wine_name || wineCode,
      spec: detail?.spec || '',
      quantity: qty,
      usage_date: usageDate,
      client_name: clientName,
      remarks: '来自活动用酒明细同步',
    };
    const old = existingByCode.get(wineCode);
    if (old) {
      if ((parseInt(old.quantity, 10) || 0) !== qty || old.usage_date !== usageDate || (old.client_name || '') !== clientName) {
        await api('PUT', `/wine/usage/${old.id}`, payload);
      }
      existingByCode.delete(wineCode);
    } else {
      await api('POST', '/wine/usage', payload);
    }
  }

  // 活动表单删除了某酒品时，删除对应使用记录并回补库存
  for (const stale of existingByCode.values()) {
    await api('DELETE', `/wine/usage/${stale.id}`);
  }
}

async function saveActivity(event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  const id = document.getElementById('actId').value;
  const isVirt = document.getElementById('actIsVirtual')?.value === '1';
  const brandAmbassadorEl = document.getElementById('actBrandAmbassador');
  const brandAmbassadorVal = brandAmbassadorEl ? String(brandAmbassadorEl.value || '').trim() : '';
  const actDateEl = document.getElementById('actDate');
  const actDateVal = String(actDateEl?.value || '').trim() || null;
  if (!isVirt && !actDateVal) {
    showToast('请填写活动日期', 'warning');
    actDateEl?.focus();
    return;
  }
  const activityForm = document.getElementById('activityForm');
  if (activityForm && typeof activityForm.reportValidity === 'function' && !activityForm.reportValidity()) {
    return;
  }
  let projectCode = String(document.getElementById('actProjectCode').value || '').trim();
  if (!isVirt && actDateVal) {
    if (!projectCodeHasDateSuffix(projectCode)) {
      projectCode = repairProjectCodeDate(projectCode, actDateVal);
    }
    if (!projectCodeHasDateSuffix(projectCode)) {
      projectCode = buildProjectCode({
        yearFrameCode: document.getElementById('actYearFrameCode').value,
        date: actDateVal,
        city: document.getElementById('actCity').value,
        venue: document.getElementById('actVenue').value,
        client: document.getElementById('actClient').value,
        brand: document.getElementById('actBrandField').value,
        type: document.getElementById('actActivityType').value,
      });
    }
  }

  const body = {
    year_frame_id: currentYearFrameId,
    year_frame_code: document.getElementById('actYearFrameCode').value,
    project_code: projectCode,
    activity_type: document.getElementById('actActivityType').value,
    city: document.getElementById('actCity').value,
    brand: document.getElementById('actBrandField').value,
    date: actDateVal,
    client: document.getElementById('actClient').value,
    client_name: document.getElementById('actClient').value,
    region: document.getElementById('actRegion').value,
    belonging: (document.getElementById('actBelonging')?.value || '').trim() || null,
    period: document.getElementById('actPeriod').value,
    venue: document.getElementById('actVenue').value,
    quoted_price: roundMoney2(document.getElementById('actQuotedPrice').value),
    guest_count: parseInt(document.getElementById('actGuestCount').value) || null,
    executor: document.getElementById('actExecutor').value,
    brand_ambassador: brandAmbassadorVal || null,
    status: document.getElementById('actStatus').value,
    remarks: document.getElementById('actRemarks').value,
    cloud_album_url: normalizeCloudAlbumUrl(document.getElementById('actCloudAlbumUrl').value) || null,
    is_virtual: isVirt ? 1 : 0,
  };

  try {
    let activityId = id ? Number(id) : 0;
    let successMsg = '';
    if (id) {
      await api('PUT', `/activities/${id}`, body);
      successMsg = isVirt ? '虚拟场次已更新' : '活动已更新';
    } else {
      const created = await api('POST', '/activities', body);
      activityId = Number(created?.id || created?.data?.id || 0);
      // Defensive fallback: some environments may return message-only payload.
      if (!activityId && body.project_code) {
        const vq = body.is_virtual ? '&isVirtual=1' : '&isVirtual=0';
        const rows = await api(
          'GET',
          `/activities?yearFrameId=${encodeURIComponent(body.year_frame_id)}${vq}`
        );
        const matched = (rows || [])
          .filter((r) => String(r.project_code || '').trim() === String(body.project_code || '').trim())
          .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
        activityId = Number(matched?.id || 0);
      }
      successMsg = isVirt ? '虚拟场次已创建' : '活动已创建';
    }
    if (isVirt) {
      showToast(successMsg, 'success');
    } else {
      let ambassadorSavedLabel = '未填写';
      if (activityId > 0) {
        try {
          const latest = await api('GET', `/activities/${activityId}`);
          ambassadorSavedLabel = String(latest?.brand_ambassador || '').trim() || '未填写';
        } catch (_) {
          ambassadorSavedLabel = brandAmbassadorVal || '未填写';
        }
      }
      showToast(`${successMsg} · 品牌大使：${ambassadorSavedLabel}`, 'success');
    }
    closeModal();
    if (currentPage === 'virtual-activities') loadVirtualActivities();
    else if (currentPage === 'calendar' && typeof window._calYear === 'number') {
      await drawCalendar(window._calYear, window._calMonth);
    } else if (currentPage === 'activities') loadActivities();
    else loadActivities();
    void updateBadges();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

function pickActivityBelonging(a) {
  if (!a || typeof a !== 'object') return '';
  const v =
    a.belonging != null
      ? a.belonging
      : a.Belonging != null
        ? a.Belonging
        : a.activity_belonging != null
          ? a.activity_belonging
          : null;
  if (v == null) return '';
  return String(v).trim();
}

/**
 * 项目编号中常带 RC / RM 渠道段，历史导入未写 belonging 时用于展示与筛选（与回填脚本规则一致）
 */
function inferBelongingFromProjectCode(projectCode) {
  const s = projectCode == null ? '' : String(projectCode);
  if (!s) return '';
  if (s.includes('RM-CLUB') || s.includes('RM_CLUB')) return 'RM-CLUB婚宴';
  if (s.includes('RM-X.O')) return 'RM-X.O婚宴';
  if (s.includes('-RC-') || s.includes(' RC ')) return 'RC-On';
  return '';
}

/** 库内归属优先，否则按项目编号推断（与 lookup value 一致） */
function displayActivityBelongingValue(a) {
  const stored = pickActivityBelonging(a);
  if (stored) return stored;
  return inferBelongingFromProjectCode(a && a.project_code);
}

function belongingLabelForValue(raw) {
  const key = raw == null ? '' : String(raw).trim();
  if (!key) return '';
  return actBelongingLabelByValue[key] || key;
}

function formatActivityBelongingForTable(a) {
  const v = displayActivityBelongingValue(a);
  if (!v) return '—';
  return belongingLabelForValue(v);
}

async function ensureBelongingLabelMap() {
  if (Object.keys(actBelongingLabelByValue).length) return;
  try {
    const rows = await api('GET', '/lookups?category=activity_belonging');
    actBelongingLabelByValue = Object.fromEntries(
      (rows || []).map((r) => [String(r.value), String(r.label || r.value)])
    );
  } catch (_) {
    actBelongingLabelByValue = {};
  }
}

function activityDetailRow(label, valueText) {
  const t = valueText == null || valueText === '' ? '—' : String(valueText);
  return `<div class="activity-detail-row"><div class="activity-detail-k">${escapeHtml(label)}</div><div class="activity-detail-v">${escapeHtml(t)}</div></div>`;
}

function activityDetailRowHtml(label, innerHtml) {
  return `<div class="activity-detail-row"><div class="activity-detail-k">${escapeHtml(label)}</div><div class="activity-detail-v">${innerHtml}</div></div>`;
}

function mergeActivityBelongingFromListRow(detail, id) {
  if (pickActivityBelonging(detail)) return detail;
  const fromList =
    (activitiesState.data || []).find((x) => String(x.id) === String(id)) ||
    (virtualActivitiesState.data || []).find((x) => String(x.id) === String(id));
  if (!fromList) return detail;
  const listBel = displayActivityBelongingValue(fromList);
  if (!listBel) return detail;
  return { ...detail, belonging: listBel };
}
