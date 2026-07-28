function aqSyncCreateProjectInputHints(code) {
  const f = activityQuotesState.createForm;
  if (!f) return;
  const byCode = activityQuotesState.projectActivityByCode;
  const act = byCode && byCode.get ? byCode.get(String(code || '').trim()) : null;
  if (act) {
    aqOnActivityPick(String(act.id));
    return;
  }
  f.activity_id = null;
  f.event_type = '';
  aqUpdateCreateFormTypeHint(null);
  const hint = document.getElementById('aqActivityLinkHint');
  if (hint) {
    if (!code) {
      hint.textContent = '输入关键字并从下拉选择项目编号';
      hint.style.display = 'block';
    } else {
      hint.style.display = 'none';
    }
  }
}

function aqEnsureProjectMenuGlobalClose() {
  if (activityQuotesState.projectMenuBound) return;
  document.addEventListener('click', (evt) => {
    const t = evt && evt.target;
    if (t && t.closest && (t.closest('.aq-pc-combobox') || t.closest('.aq-pc-menu'))) return;
    aqCloseAllProjectMenus();
  });
  const reposition = () => {
    const idx = activityQuotesState.openProjectMenuIdx;
    if (idx != null) aqPositionProjectMenu(idx);
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  activityQuotesState.projectMenuBound = true;
}

const AQ_PROJECT_MENU_Z = 10100;

function aqPortalProjectMenu(menu, input) {
  if (!menu || !input) return;
  const home = input.closest('.aq-pc-combobox');
  if (!home) return;
  menu.dataset.aqPcAnchorInputId = input.id;
  if (!menu._aqPcHome) menu._aqPcHome = home;
  if (menu.parentElement !== document.body) document.body.appendChild(menu);
  menu.classList.add('aq-pc-menu-portal');
}

function aqRestoreProjectMenu(menu) {
  if (!menu) return;
  menu.style.display = 'none';
  menu.classList.remove('aq-pc-menu-portal');
  const home = menu._aqPcHome;
  if (home && home.isConnected) {
    try {
      home.appendChild(menu);
    } catch (_) {
      menu.remove();
    }
  } else if (menu.parentElement === document.body) {
    menu.remove();
  }
  delete menu._aqPcHome;
}

function aqPurgeOrphanProjectMenus() {
  document.querySelectorAll('body > .aq-pc-menu').forEach((el) => el.remove());
}

function aqCloseAllProjectMenus() {
  activityQuotesState.openProjectMenuIdx = null;
  document.querySelectorAll('.aq-pc-menu').forEach((el) => aqRestoreProjectMenu(el));
}

function aqPositionProjectMenu(sessionIdx) {
  const menu = document.getElementById(`aqPcMenu-${sessionIdx}`);
  const input = document.getElementById(`aqPcInput-${sessionIdx}`);
  if (!menu || !input) return;
  aqPortalProjectMenu(menu, input);
  const r = input.getBoundingClientRect();
  const top = Math.round(r.bottom + 4);
  menu.style.position = 'fixed';
  menu.style.left = `${Math.round(r.left)}px`;
  menu.style.top = `${top}px`;
  menu.style.width = `${Math.max(Math.round(r.width), 260)}px`;
  menu.style.zIndex = String(AQ_PROJECT_MENU_Z);
  menu.style.maxHeight = `min(280px, calc(100vh - ${top + 8}px))`;
}

function aqRenderProjectMenu(sessionIdx, keyword) {
  const menu = document.getElementById(`aqPcMenu-${sessionIdx}`);
  if (!menu) return;
  const isCreate = sessionIdx === AQ_CREATE_PC_KEY;
  const pool = isCreate
    ? (activityQuotesState.createActivities || [])
    : aqGetFilteredActivitiesForPicker();
  if (!pool.length) {
    menu.innerHTML = '<div class="inv-project-menu-empty">当前财年暂无可选项目编号，请先在场次记录中填写</div>';
    return;
  }
  const shown = isCreate
    ? aqFilterProjectPickerOptionsForCreate(keyword)
    : aqFilterProjectPickerOptions(keyword);
  if (!shown.length) {
    menu.innerHTML = '<div class="inv-project-menu-empty">无匹配项目编号</div>';
    return;
  }
  const idxArg = isCreate ? `'${AQ_CREATE_PC_KEY}'` : sessionIdx;
  menu.innerHTML = shown
    .map(
      (row) =>
        `<button type="button" class="inv-project-option" data-value="${escapeHtml(row.code)}" onclick="aqPickProjectCode(${idxArg}, this.getAttribute('data-value'))">${escapeHtml(row.label)}</button>`
    )
    .join('');
}

function aqPickProjectCode(sessionIdx, code) {
  if (sessionIdx === AQ_CREATE_PC_KEY) {
    aqApplyProjectCodeToCreate(code);
    aqCloseAllProjectMenus();
    return;
  }
  aqApplyProjectCodeToSession(sessionIdx, code, true);
  aqCloseAllProjectMenus();
}

function aqApplyProjectCodeToCreate(code) {
  const byCode = activityQuotesState.projectActivityByCode;
  const act = byCode && byCode.get ? byCode.get(String(code || '').trim()) : null;
  if (!act) {
    showToast('请从下拉列表中选择有效的项目编号', 'warning');
    return;
  }
  aqOnActivityPick(String(act.id));
  const input = document.getElementById(`aqPcInput-${AQ_CREATE_PC_KEY}`);
  if (input) input.value = String(act.project_code || '').trim();
}

function aqOpenProjectMenu(sessionIdx) {
  aqEnsureProjectMenuGlobalClose();
  aqCloseAllProjectMenus();
  const menu = document.getElementById(`aqPcMenu-${sessionIdx}`);
  if (!menu) return;
  const input = document.getElementById(`aqPcInput-${sessionIdx}`);
  aqRenderProjectMenu(sessionIdx, input ? input.value : '');
  menu.style.display = 'block';
  activityQuotesState.openProjectMenuIdx = sessionIdx;
  aqPositionProjectMenu(sessionIdx);
}

function aqToggleProjectMenu(sessionIdx) {
  const menu = document.getElementById(`aqPcMenu-${sessionIdx}`);
  if (!menu) return;
  if (menu.style.display === 'block') aqCloseAllProjectMenus();
  else aqOpenProjectMenu(sessionIdx);
}

function aqOnProjectInput(sessionIdx, value) {
  const v = String(value || '').trim();
  if (sessionIdx === AQ_CREATE_PC_KEY) {
    const f = activityQuotesState.createForm;
    if (f) {
      f.project_code = v;
      aqSyncCreateProjectInputHints(v);
    }
  } else {
    const q = activityQuotesState.editing;
    if (q && q.linked_sessions && q.linked_sessions[sessionIdx]) {
      q.linked_sessions[sessionIdx].project_code = v;
    }
  }
  aqOpenProjectMenu(sessionIdx);
  aqRenderProjectMenu(sessionIdx, value);
  aqPositionProjectMenu(sessionIdx);
}

function aqOnProjectInputBlur(sessionIdx) {
  window.setTimeout(() => {
    const wrap = document.querySelector(`#aqPcInput-${sessionIdx}`)?.closest('.aq-pc-combobox');
    const active = document.activeElement;
    if (wrap && active && wrap.contains(active)) return;
    aqCloseAllProjectMenus();
    const input = document.getElementById(`aqPcInput-${sessionIdx}`);
    const code = input ? String(input.value || '').trim() : '';
    if (sessionIdx === AQ_CREATE_PC_KEY) {
      if (!code) {
        aqOnActivityPick('');
        return;
      }
      const byCode = activityQuotesState.projectActivityByCode;
      if (byCode && byCode.has(code)) aqApplyProjectCodeToCreate(code);
      return;
    }
    if (!code) {
      const q = activityQuotesState.editing;
      if (q && q.linked_sessions) q.linked_sessions[sessionIdx] = aqEmptyMultiSession();
      return;
    }
    const byCode = activityQuotesState.projectActivityByCode;
    if (byCode && byCode.has(code)) aqApplyProjectCodeToSession(sessionIdx, code, false);
  }, 120);
}

function aqOnProjectInputKeydown(evt, sessionIdx) {
  if (!evt) return;
  if (evt.key === 'Escape') {
    aqCloseAllProjectMenus();
    return;
  }
  if (evt.key === 'ArrowDown') {
    evt.preventDefault();
    aqOpenProjectMenu(sessionIdx);
    return;
  }
  if (evt.key === 'Enter') {
    const first = document.querySelector(`#aqPcMenu-${sessionIdx} .inv-project-option`);
    if (first) {
      evt.preventDefault();
      const code = first.getAttribute('data-value');
      if (code) aqPickProjectCode(sessionIdx, code);
    }
  }
}

function aqApplyProjectCodeToSession(sessionIdx, code, refresh) {
  const q = activityQuotesState.editing;
  if (!q || !Array.isArray(q.linked_sessions)) return;
  const byCode = activityQuotesState.projectActivityByCode;
  const act = byCode && byCode.get ? byCode.get(String(code || '').trim()) : null;
  if (!act) {
    showToast('请从下拉列表中选择有效的项目编号', 'warning');
    return;
  }
  if (!aqActivityMatchesMultiFilter(act)) {
    showToast('该场次不在当前区域/归属筛选范围内，请调整筛选后再选', 'warning');
    return;
  }
  const prev = q.linked_sessions[sessionIdx] || aqEmptyMultiSession();
  q.linked_sessions[sessionIdx] = {
    activity_id: act.id,
    project_code: String(act.project_code || '').trim(),
    event_date: aqFormatActivityDate(act),
    city: act.city || '',
    customer_name: act.client_name || act.client || '',
    event_type: aqMapActivityEventType(act),
    remarks: act.remarks != null ? String(act.remarks).trim() : prev.remarks || '',
    sort_order: sessionIdx,
    fee_comm: prev.fee_comm || 0,
    fee_executor: prev.fee_executor || 0,
    fee_design: prev.fee_design || 0,
    fee_freight: prev.fee_freight || 0,
    fee_print: prev.fee_print || 0,
    fee_photo: prev.fee_photo || 0,
  };
  if (refresh !== false) aqRefreshMultiSessionRow(sessionIdx);
  aqMarkMultiDirty();
}

function aqOnMultiProjectCodeInput(sessionIdx, value) {
  const q = activityQuotesState.editing;
  if (!q || !q.linked_sessions || !q.linked_sessions[sessionIdx]) return;
  q.linked_sessions[sessionIdx].project_code = String(value || '').trim();
}

function aqOnMultiProjectCodeChange(sessionIdx, value) {
  const code = String(value || '').replace(/^\uFEFF/, '').trim();
  const byCode = activityQuotesState.projectActivityByCode;
  if (!byCode || typeof byCode.get !== 'function' || !byCode.has(code)) {
    if (code) showToast('请从下拉建议中选择有效的项目编号', 'warning');
    return;
  }
  aqApplyProjectCodeToSession(sessionIdx, code, true);
}

/** 仅刷新场次表某一行的只读列，避免重绘输入框打断输入 */
