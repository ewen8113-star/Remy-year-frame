function aqOnActivityPick(idStr) {
  const id = parseInt(idStr, 10);
  const f = activityQuotesState.createForm;
  if (!Number.isFinite(id)) {
    f.activity_id = null;
    f.project_code = '';
    f.event_type = '';
    aqUpdateCreateFormTypeHint(null);
    const hint = document.getElementById('aqActivityLinkHint');
    if (hint) {
      hint.textContent = '输入关键字并从下拉选择项目编号';
      hint.style.display = 'block';
    }
    const pcInpClear = document.getElementById(`aqPcInput-${AQ_CREATE_PC_KEY}`);
    if (pcInpClear) pcInpClear.value = '';
    return;
  }
  const act = activityQuotesState.createActivities.find((a) => Number(a.id) === id);
  if (!act) return;
  f.activity_id = id;
  f.project_code = String(act.project_code || '').trim();
  f.city = act.city || '';
  f.event_date = aqFormatActivityDate(act);
  aqSyncCreateFormEventTypeFromActivity(act);
  const autoName = [act.city, act.activity_type].filter(Boolean).join('');
  f.project_name = autoName ? `${autoName}报价` : f.project_code;
  const hint = document.getElementById('aqActivityLinkHint');
  if (hint) {
    const dateHint = f.event_date ? ` · 活动日期 ${escapeHtml(f.event_date)}` : '';
    hint.innerHTML = `已关联：<strong>${escapeHtml(f.project_code)}</strong>${dateHint}`;
    hint.style.display = 'block';
  }
  aqUpdateCreateFormTypeHint(act);
  const cityEl = document.getElementById('aqFCity');
  if (cityEl) cityEl.value = f.city || '';
  const pcInp = document.getElementById(`aqPcInput-${AQ_CREATE_PC_KEY}`);
  if (pcInp) pcInp.value = f.project_code || '';
}

function aqRenderCreateModal() {
  aqCloseAllProjectMenus();
  aqPurgeOrphanProjectMenus();
  const body = document.getElementById('modalActivityQuoteBody');
  if (!body) return;
  const f = activityQuotesState.createForm;
  const pickedAct = f.activity_id
    ? activityQuotesState.createActivities.find((a) => Number(a.id) === Number(f.activity_id))
    : null;
  const typeHint =
    pickedAct && f.event_type
      ? `报价类型：<strong>${escapeHtml(f.event_type)}</strong>（来自场次：${escapeHtml(aqFormatActivityTypeSource(pickedAct))}）`
      : '';
  const linkHint = f.activity_id
    ? `已关联：<strong>${escapeHtml(f.project_code || '')}</strong>${f.event_date ? ` · 活动日期 ${escapeHtml(f.event_date)}` : ''}`
    : '输入关键字并从下拉选择项目编号';
  body.innerHTML = `
    <p class="modal-activity-lead">须关联场次<strong>项目编号</strong>；类型（有无执行、活动形式）从场次自动读取，无需再选。创建后含全部预置明细，可在列表中点「编辑」调整。服务费默认 10%。</p>
    <div class="form-grid modal-activity-form">
      <div class="form-group aq-create-project-field" style="grid-column:1/-1">
        <label class="form-label">关联项目编号 *</label>
        <div class="aq-pc-combobox inv-project-combobox">
          <input type="text" class="form-control aq-pc-input" id="aqPcInput-${AQ_CREATE_PC_KEY}"
            value="${escapeHtml(f.project_code || '')}"
            placeholder="输入关键字并从下拉选择项目编号"
            autocomplete="off"
            onfocus="aqOpenProjectMenu('${AQ_CREATE_PC_KEY}')"
            onblur="aqOnProjectInputBlur('${AQ_CREATE_PC_KEY}')"
            oninput="aqOnProjectInput('${AQ_CREATE_PC_KEY}', this.value)"
            onkeydown="aqOnProjectInputKeydown(event, '${AQ_CREATE_PC_KEY}')">
          <button type="button" class="inv-project-trigger" onmousedown="event.preventDefault()" onclick="aqToggleProjectMenu('${AQ_CREATE_PC_KEY}')" aria-label="展开项目编号建议"></button>
          <div class="aq-pc-menu inv-project-menu" id="aqPcMenu-${AQ_CREATE_PC_KEY}" style="display:none"></div>
        </div>
        <p id="aqActivityLinkHint" class="form-hint" style="margin-top:6px${f.activity_id ? '' : ';display:none'}">${linkHint}</p>
        <p id="aqActivityTypeHint" class="form-hint aq-type-from-activity" style="margin-top:6px${typeHint ? '' : ';display:none'}">${typeHint}</p>
      </div>
      <div class="form-group"><label class="form-label">客户/品牌</label>
        <input class="form-control" id="aqFBrand" value="${escapeHtml(f.client_brand || '')}"></div>
      <div class="form-group"><label class="form-label">客户方负责人</label>
        <input class="form-control" id="aqFContact" value="${escapeHtml(f.client_contact || '')}" placeholder="选填"></div>
      <div class="form-group"><label class="form-label">报价单项目名称 *</label>
        <input class="form-control" id="aqFProject" value="${escapeHtml(f.project_name || '')}" placeholder="如 福州晚宴报价"></div>
      <div class="form-group"><label class="form-label">城市</label>
        <input class="form-control" id="aqFCity" value="${escapeHtml(f.city || '')}"></div>
      <div class="form-group"><label class="form-label">服务费率</label>
        <select class="form-control" id="aqFRate">${aqServiceRateOptionsHtml(f.service_rate)}</select></div>
    </div>`;
  document.getElementById('modalActivityQuoteFooter').innerHTML = `
    <button type="button" class="btn btn-secondary" onclick="aqCloseAllProjectMenus();closeModal()">取消</button>
    <button type="button" class="btn btn-primary" onclick="aqSubmitCreate()">创建报价</button>`;
  renderLucideIcons();
}

function aqReadCreateFormFromDom() {
  const f = activityQuotesState.createForm;
  f.client_brand = document.getElementById('aqFBrand')?.value?.trim() || f.client_brand;
  f.client_contact = document.getElementById('aqFContact')?.value?.trim() || '';
  f.project_name = document.getElementById('aqFProject')?.value?.trim() || '';
  f.city = document.getElementById('aqFCity')?.value?.trim() || '';
  const code = String(document.getElementById(`aqPcInput-${AQ_CREATE_PC_KEY}`)?.value || f.project_code || '').trim();
  f.project_code = code;
  const byCode = activityQuotesState.projectActivityByCode;
  const act = byCode && byCode.get ? byCode.get(code) : null;
  f.activity_id = act ? Number(act.id) : null;
  if (act) {
    f.event_date = aqFormatActivityDate(act);
    f.event_type = aqMapActivityEventType(act);
    f.city = act.city || f.city || '';
  } else {
    f.event_type = '';
  }
  f.service_rate = parseFloat(document.getElementById('aqFRate')?.value) || aqDefaultServiceRate();
}

async function aqSubmitCreate() {
  aqReadCreateFormFromDom();
  const f = activityQuotesState.createForm;
  if (!f.activity_id || !f.project_code) {
    showToast('请从下拉列表中选择有效的关联项目编号', 'warning');
    return;
  }
  if (!f.project_name) {
    showToast('请填写报价单项目名称', 'warning');
    return;
  }
  if (!f.event_type) {
    showToast('无法从场次读取报价类型，请重新选择场次', 'warning');
    return;
  }
  const ids = (activityQuotesState.templateSections || []).map((t) => t.id).filter(Boolean);
  if (!ids.length) {
    showToast('预置模版未加载，请刷新后重试', 'error');
    return;
  }
  try {
    await api('POST', '/quotations', {
      type: 'EVENT',
      year_frame_id: currentYearFrameId || null,
      activity_id: f.activity_id,
      client_brand: f.client_brand,
      client_contact: f.client_contact || null,
      project_name: f.project_name,
      event_date: f.event_date || null,
      city: f.city || null,
      event_type: f.event_type,
      service_rate: f.service_rate,
      template_item_ids: ids,
    });
    aqCloseAllProjectMenus();
    closeModal();
    showToast('报价已创建，预置明细已全部载入', 'success');
    activityQuotesState.editing = null;
    activityQuotesState.view = 'list';
    await renderActivityQuotes();
  } catch (e) {
    showToast(e.message || '创建失败', 'error');
  }
}

function aqBuildSavePayload(q) {
  const totals = aqCalcTotalsForQuote(q);
  const payload = {
    client_brand: q.client_brand,
    client_contact: q.client_contact,
    project_name: q.project_name,
    event_date: aqResolveQuoteEventDate(q) || null,
    city: q.city,
    customer_name: q.customer_name,
    event_type: q.event_type,
    service_rate: totals.serviceRate,
    tax_rate: totals.taxRate,
    items: (q.items || []).map((it, i) => ({
      section_code: it.section_code,
      section_name: it.section_name,
      subsection_code: it.subsection_code,
      subsection_name: it.subsection_name,
      description: it.description,
      item_category: it.item_category || '',
      quantity: it.quantity,
      unit: it.unit,
      unit_price: it.unit_price,
      remarks: it.remarks,
      sort_order: i,
      is_custom: it.is_custom ? 1 : 0,
      is_template: it.is_template ? 1 : 0,
    })),
  };
  if (aqIsMultiQuote(q)) {
    const sessions = (q.linked_sessions || [])
      .filter((s) => s && s.activity_id)
      .map((s, i) => {
        const calc = aqCalcSessionRow(s);
        const row = {
          activity_id: s.activity_id,
          project_code: s.project_code,
          event_date: aqNormalizeEventDate(s.event_date) || null,
          city: s.city || '',
          customer_name: s.customer_name || '',
          event_type: s.event_type || '',
          remarks: s.remarks != null ? String(s.remarks).trim() : '',
          sort_order: i,
        };
        AQ_MULTI_FEE_COLS.forEach((col) => {
          row[col.key] = aqParseFee(s, col.key);
        });
        return { ...row, ...calc };
      });
    payload.linked_sessions = sessions;
    payload.items = [];
    payload.service_rate = 0.1;
    payload.tax_rate = 0.06;
    if (sessions[0]) {
      payload.event_date = sessions[0].event_date;
      payload.city = sessions[0].city;
      payload.customer_name = sessions[0].customer_name;
      payload.event_type = sessions[0].event_type;
    }
  }
  return payload;
}

function aqOnQtHeaderFieldChange(field, value) {
  const q = activityQuotesState.editing;
  if (!q) return;
  const v = String(value ?? '').trim();
  if (field === 'client_brand') q.client_brand = v || 'REMY COINTREAU';
  else if (field === 'client_contact') q.client_contact = v;
  else if (field === 'project_name') {
    q.project_name = v;
    if (aqIsMultiQuote(q)) {
      activityQuotesState.multiProjectName = v;
      const toolbarInp = document.getElementById('aqMultiProjectName');
      if (toolbarInp && toolbarInp.value !== v) toolbarInp.value = v;
    }
  }
}

function aqReadQtHeaderFromDom() {
  const q = activityQuotesState.editing;
  if (!q) return;
  const brand = document.getElementById('aqQtHeaderBrand');
  const contact = document.getElementById('aqQtHeaderContact');
  const project = document.getElementById('aqQtHeaderProjectName');
  if (brand) q.client_brand = brand.value.trim() || q.client_brand;
  if (contact) q.client_contact = contact.value.trim();
  if (project) {
    q.project_name = project.value.trim();
    if (aqIsMultiQuote(q)) activityQuotesState.multiProjectName = q.project_name;
  }
}
