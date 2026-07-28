async function loadActivities() {
  const container = document.getElementById('actTable');
  if (!container) return;

  container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">加载中...</div>';

  try {
    const yf = currentYearFrameId || undefined;
    try {
      await api('POST', '/activities/repair-project-codes', { yearFrameId: yf });
    } catch (e) {
      console.warn('修复项目编号失败（忽略）', e);
    }
    try {
      await api('POST', '/activities/revert-future-completed', { yearFrameId: yf });
    } catch (e) {
      console.warn('纠正未到期已完成状态失败（忽略）', e);
    }
    try {
      await api('POST', '/activities/auto-complete-overdue', { yearFrameId: yf });
    } catch (e) {
      console.warn('自动完结过期场次失败（忽略，不阻断列表加载）', e);
    }

    let qs = `?sortBy=activity_date&sortOrder=${activitiesState.sortOrder}&isVirtual=0`;
    if (currentYearFrameId) qs += `&yearFrameId=${currentYearFrameId}`;
    if (activitiesState.type) qs += `&activityType=${activitiesState.type}`;
    if (activitiesState.brand) qs += `&brand=${encodeURIComponent(activitiesState.brand)}`;

    const data = await api('GET', `/activities${qs}`);

    // 前端搜索过滤
    let filtered = data;
    if (activitiesState.search) {
      const kw = activitiesState.search.toLowerCase();
      filtered = filtered.filter(a =>
        (a.city || '').toLowerCase().includes(kw) ||
        (a.client || '').toLowerCase().includes(kw) ||
        (a.client_name || '').toLowerCase().includes(kw) ||
        (a.project_code || '').toLowerCase().includes(kw) ||
        (a.venue || '').toLowerCase().includes(kw)
      );
    }

    // 年份筛选（业务日历 UTC+8，与列表日期显示一致）
    if (activitiesState.year) {
      filtered = filtered.filter((a) => {
        const ym = activityBusinessYm(a.date || a.activity_date);
        return ym && String(ym.year) === activitiesState.year;
      });
    }

    // 月份筛选（业务日历 UTC+8）
    if (activitiesState.month) {
      filtered = filtered.filter((a) => {
        const ym = activityBusinessYm(a.date || a.activity_date);
        return ym && String(ym.month) === activitiesState.month;
      });
    }
    // 时段筛选
    if (activitiesState.period) {
      filtered = filtered.filter(a => (a.period || '日常') === activitiesState.period);
    }
    // 区域筛选
    if (activitiesState.region) {
      filtered = filtered.filter(a => (a.region || '') === activitiesState.region);
    }
    if (activitiesState.belonging) {
      filtered = filtered.filter((a) => displayActivityBelongingValue(a) === activitiesState.belonging);
    }

    activitiesState.data = filtered;

    // 分页
    const pageSize = 50;
    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (activitiesState.page - 1) * pageSize;
    const pageData = filtered.slice(start, start + pageSize);

    // 按月分组
    const grouped = {};
    pageData.forEach(a => {
      const d = new Date(a.date || a.activity_date);
      const key = isNaN(d) ? '未知日期' : `${d.getFullYear()}年${d.getMonth()+1}月`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(a);
    });

    // 列表列顺序：日期、项目编号、时段、品牌、区域、归属、城市、客户、类型、执行、状态、操作（不展示报价/成本）
    let html = `<div class="table-wrapper act-table-scroll-wrap"><table class="data-table act-table-sticky-head">
      <thead><tr>
        <th>日期</th><th>项目编号</th><th>时段</th><th>品牌</th><th>区域</th><th>归属</th><th>城市</th><th>客户</th>
        <th>类型</th><th>执行</th><th>状态</th><th>操作</th>
      </tr></thead><tbody>`;

    Object.entries(grouped).forEach(([month, acts]) => {
      html += `<tr><td colspan="12" class="group-title">${month}（${acts.length}场）</td></tr>`;
      acts.forEach(a => {
        const rowDeferred = a.status === 'deferred';
        html += `
          <tr class="${rowDeferred ? 'activity-row-deferred' : ''}" onclick="showActivityDetail(${a.id})" style="cursor:pointer">
            <td>${fmtDateShort(a.date || a.activity_date)}</td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.project_code||''}">${a.project_code||'—'}</td>
            <td><span class="badge badge-gray">${a.period || '日常'}</span></td>
            <td><span class="badge badge-${brandColor(a.brand)}">${a.brand||'—'}</span></td>
            <td><span style="font-size:11px;color:var(--text-secondary)">${a.region||'—'}</span></td>
            <td><span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(formatActivityBelongingForTable(a))}</span></td>
            <td><strong>${a.city||'—'}</strong></td>
            <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${a.client||a.client_name||'—'}</td>
            <td><span class="badge badge-${typeColor(a.activity_type)}">${a.activity_type||'—'}</span></td>
            <td><span class="badge badge-${a.executor==='有'?'success':'gray'}">${a.executor||'无'}</span></td>
            <td style="white-space:nowrap" onclick="event.stopPropagation()">
              <select class="status-pill-select status-pill-${a.status || 'pending'}" onchange="quickUpdateActivityStatus(${a.id}, this.value); this.className='status-pill-select status-pill-' + this.value;">
                <option value="pending" ${(a.status || 'pending') === 'pending' ? 'selected' : ''}>待执行</option>
                <option value="deferred" ${a.status === 'deferred' ? 'selected' : ''}>延期</option>
                <option value="completed" ${a.status === 'completed' || a.status === 'done' ? 'selected' : ''}>已完成</option>
              </select>
            </td>
            <td onclick="event.stopPropagation()">
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                ${activityCloudAlbumButtonHtml(a.cloud_album_url)}
                <button class="btn btn-secondary btn-sm" onclick="showActivityModal(${a.id})">编辑</button>
                <button type="button" class="btn btn-danger btn-sm activity-row-remove-btn" onclick="openRemoveActivityDialog(${a.id})">删除</button>
              </div>
            </td>
          </tr>`;
      });
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
    renderLucideIcons();

    // 分页
    const pgEl = document.getElementById('actPagination');
    if (pgEl) {
      pgEl.innerHTML = renderPagination(activitiesState.page, totalPages, total, 'goActPage');
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${err.message}</div></div>`;
    renderLucideIcons();
  }
}

function openRemoveActivityDialog(activityId) {
  const id = Number(activityId);
  const hid = document.getElementById('removeActivityTargetId');
  if (hid) hid.value = Number.isFinite(id) && id > 0 ? String(id) : '';
  const hint = document.getElementById('removeActivityConfirmHint');
  if (hint) {
    const row = (activitiesState.data || []).find((x) => Number(x.id) === id);
    if (row) {
      const parts = [
        row.project_code && String(row.project_code).trim(),
        row.city && String(row.city).trim(),
        row.date || row.activity_date ? fmtDateShort(row.date || row.activity_date) : '',
      ].filter(Boolean);
      hint.textContent = parts.length ? parts.join(' · ') : `场次 ID：${id}`;
    } else {
      hint.textContent = Number.isFinite(id) && id > 0 ? `场次 ID：${id}` : '（未找到场次信息）';
    }
  }
  openModal('modalActivityDeleteConfirm');
  renderLucideIcons();
}

async function confirmRemoveActivityExecute() {
  const raw = document.getElementById('removeActivityTargetId')?.value;
  const id = parseInt(raw, 10);
  if (!raw || !Number.isFinite(id) || id <= 0) {
    closeModal();
    return;
  }
  await deleteActivity(id);
}

async function deleteActivity(id) {
  try {
    await api('DELETE', `/activities/${id}`);
    showToast('活动已删除', 'success');
    closeModal();
    if (currentPage === 'activities') loadActivities();
    else if (currentPage === 'virtual-activities') loadVirtualActivities();
    else if (currentPage === 'calendar' && typeof window._calYear === 'number') drawCalendar(window._calYear, window._calMonth);
    else if (currentPage === 'cost') renderCost();
    else loadActivities();
    void updateBadges();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

function goActPage(p) {
  activitiesState.page = p;
  loadActivities();
}

function openRemoveVirtualActivityDialog(activityId) {
  const hid = document.getElementById('removeActivityTargetId');
  if (hid) hid.value = String(activityId);
  const hint = document.getElementById('removeActivityConfirmHint');
  if (hint) {
    const row = (virtualActivitiesState.data || []).find((x) => Number(x.id) === Number(activityId));
    if (row) {
      const parts = [
        row.project_code && String(row.project_code).trim(),
        row.client || row.client_name,
        row.date || row.activity_date ? fmtDateShort(row.date || row.activity_date) : '',
      ].filter(Boolean);
      hint.textContent = parts.length ? `虚拟场次 · ${parts.join(' · ')}` : `虚拟场次 ID：${activityId}`;
    } else {
      hint.textContent = `虚拟场次 ID：${activityId}`;
    }
  }
  openModal('modalActivityDeleteConfirm');
  renderLucideIcons();
}

function showVirtualActivityDetail(id) {
  showActivityDetail(id, { virtualContext: true });
}

function renderPagination(current, total, count, fn) {
  if (total <= 1) return `<div class="pagination"><span>共 ${count} 条</span></div>`;
  let btns = '';
  btns += `<button class="page-btn" onclick="${fn}(${current-1})" ${current===1?'disabled':''}>‹</button>`;
  // 显示10页
  let start = Math.max(1, current - 4);
  let end = Math.min(total, current + 5);
  if (end - start < 9) {
    start = Math.max(1, end - 9);
  }
  for (let i = start; i <= end; i++) {
    btns += `<button class="page-btn ${i===current?'active':''}" onclick="${fn}(${i})">${i}</button>`;
  }
  btns += `<button class="page-btn" onclick="${fn}(${current+1})" ${current===total?'disabled':''}>›</button>`;
  return `<div class="pagination"><span>共 ${count} 条，第 ${current}/${total} 页</span><div class="page-btns">${btns}</div></div>`;
}

// 生成项目编号
function normalizeProjectCodeCity(raw) {
  // 城市仅保留中文，避免输入过程中的拼音/符号混入项目编号
  return String(raw || '')
    .replace(/\s+/g, '')
    .replace(/[^\u4e00-\u9fa5]/g, '')
    .trim();
}

function normalizeProjectCodeToken(raw) {
  // 统一去除空白，仅保留中英文、数字与常见分隔符
  return String(raw || '')
    .replace(/\s+/g, '')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9&.\-]/g, '')
    .trim();
}

/** 活动日期 → 项目编号中的 YYMMDD（北京时间，与出库 PDF 等规则一致） */
