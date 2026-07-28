/* 付款申请/成本登记页面模块：从 app.js 机械迁移，保持原有登记、付款单、导入和统计逻辑。 */

/* =============================================
  页面：付款申请（场次 + 费用明细 + 发票 + 同步到场次成本）
   ============================================= */
function reimbActivityLine(a) {
  if (!a) return '—';
  const pc = (a.project_code || '').trim() || '—';
  const d = fmtDateShort(a.date || a.activity_date);
  return `${d} · ${escapeHtml(pc)} · ${escapeHtml(a.city || '—')} · ${escapeHtml(a.activity_type || '')}`;
}

function reimbRenderActivityPicker() {
  const acts = reimbursementPageState.activities || [];
  const rows = acts
    .map((a) => ({ id: Number(a.id), code: String(a.project_code || '').replace(/^\uFEFF/, '').trim() }))
    .filter((x) => Number.isFinite(x.id) && x.id > 0 && x.code);
  reimbursementActivityIndex.codes = new Set(rows.map((x) => x.code));
  reimbursementActivityIndex.idToCode = new Map(rows.map((x) => [x.id, x.code]));
  reimbursementActivityIndex.codeToId = new Map();
  rows.forEach((x) => {
    if (!reimbursementActivityIndex.codeToId.has(x.code)) reimbursementActivityIndex.codeToId.set(x.code, x.id);
  });
}

function reimbGetProjectCodeOptions() {
  const acts = reimbursementPageState.activities || [];
  const seen = new Set();
  const rows = [];
  acts.forEach((a) => {
    const code = String(a.project_code || '').replace(/^\uFEFF/, '').trim();
    const id = Number(a.id);
    if (!code || !Number.isFinite(id) || id <= 0 || seen.has(code)) return;
    seen.add(code);
    rows.push({ id, code, activity: a });
  });
  return rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-CN'));
}

function reimbFilterProjectOptions(keyword) {
  const q = String(keyword || '').trim().toLowerCase();
  const all = reimbGetProjectCodeOptions();
  if (!q) return all;
  return all.filter(({ code, activity: a }) => {
    const city = String(a.city || '').toLowerCase();
    const type = String(a.activity_type || '').toLowerCase();
    const pc = code.toLowerCase();
    return pc.includes(q) || city.includes(q) || type.includes(q);
  });
}

function reimbRenderProjectSuggestionList(keyword) {
  const menu = document.getElementById('reimbProjectMenu');
  if (!menu) return;
  const list = reimbFilterProjectOptions(keyword);
  const shown = list.slice(0, 80);
  if (!shown.length) {
    menu.innerHTML = '<div class="inv-project-menu-empty">无匹配项目编号</div>';
    return;
  }
  menu.innerHTML = shown
    .map(({ code, activity: a }) => `<button type="button" class="inv-project-option" data-value="${escapeHtml(code)}" onclick="reimbPickProjectSuggestionFromBtn(this)">${reimbActivityLine(a)}</button>`)
    .join('');
}

function reimbPortalProjectMenu(menu, input) {
  if (!menu || !input) return;
  const home = input.closest('.reimb-project-combobox');
  if (!home) return;
  if (!menu._reimbPcHome) menu._reimbPcHome = home;
  if (menu.parentElement !== document.body) document.body.appendChild(menu);
  menu.classList.add('aq-pc-menu-portal');
}

function reimbRestoreProjectMenu(menu) {
  if (!menu) return;
  menu.style.display = 'none';
  menu.classList.remove('aq-pc-menu-portal');
  menu.style.position = '';
  menu.style.left = '';
  menu.style.top = '';
  menu.style.width = '';
  menu.style.zIndex = '';
  const home = menu._reimbPcHome;
  if (home && home.isConnected) {
    try {
      home.appendChild(menu);
    } catch (_) {
      menu.remove();
    }
  } else if (menu.parentElement === document.body) {
    menu.remove();
  }
  delete menu._reimbPcHome;
}

function reimbPositionProjectMenu() {
  const menu = document.getElementById('reimbProjectMenu');
  const input = document.getElementById('reimbProjectCode');
  if (!menu || !input) return;
  reimbPortalProjectMenu(menu, input);
  const r = input.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${Math.round(r.left)}px`;
  menu.style.top = `${Math.round(r.bottom + 4)}px`;
  menu.style.width = `${Math.max(Math.round(r.width), 320)}px`;
  menu.style.zIndex = String(REIMB_PROJECT_MENU_Z);
}

function reimbEnsureProjectMenuGlobalClose() {
  if (reimbursementProjectMenuBound) return;
  document.addEventListener('click', (evt) => {
    const t = evt && evt.target;
    if (t && t.closest && (t.closest('.reimb-project-combobox') || t.closest('#reimbProjectMenu'))) return;
    reimbCloseProjectSuggestionList();
  });
  const reposition = () => {
    const menu = document.getElementById('reimbProjectMenu');
    if (menu && menu.style.display === 'block') reimbPositionProjectMenu();
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  reimbursementProjectMenuBound = true;
}

function reimbOpenProjectSuggestionList() {
  const menu = document.getElementById('reimbProjectMenu');
  if (!menu) return;
  reimbEnsureProjectMenuGlobalClose();
  reimbRenderProjectSuggestionList(document.getElementById('reimbProjectCode')?.value || '');
  menu.style.display = 'block';
  reimbPositionProjectMenu();
}

function reimbCloseProjectSuggestionList() {
  const menu = document.getElementById('reimbProjectMenu');
  if (menu) reimbRestoreProjectMenu(menu);
}

function reimbOnProjectInput(value) {
  reimbProjectInputChanged();
  reimbRenderProjectSuggestionList(value);
  const menu = document.getElementById('reimbProjectMenu');
  if (!menu) return;
  reimbEnsureProjectMenuGlobalClose();
  menu.style.display = 'block';
  reimbPositionProjectMenu();
}

function reimbOnProjectInputBlur() {
  window.setTimeout(() => {
    const wrap = document.querySelector('.reimb-project-combobox');
    const active = document.activeElement;
    if (wrap && active && wrap.contains(active)) return;
    const menu = document.getElementById('reimbProjectMenu');
    if (menu && active && menu.contains(active)) return;
    reimbCloseProjectSuggestionList();
  }, 120);
}

function reimbHandleProjectInputKeydown(e) {
  if (!e) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    reimbCloseProjectSuggestionList();
    return;
  }
  if (e.key === 'Enter') {
    const menu = document.getElementById('reimbProjectMenu');
    const first = menu?.querySelector('.inv-project-option');
    if (first && menu.style.display === 'block') {
      e.preventDefault();
      first.click();
    }
  }
}

function reimbPickProjectSuggestionFromBtn(btn) {
  const val = btn ? String(btn.getAttribute('data-value') || '').trim() : '';
  const input = document.getElementById('reimbProjectCode');
  if (!input) return;
  input.value = val;
  reimbProjectInputChanged();
  reimbCloseProjectSuggestionList();
}

function reimbSelectActivity(id) {
  const idNum = Number(id);
  const a = (reimbursementPageState.activities || []).find((x) => Number(x.id) === idNum);
  const hid = document.getElementById('reimbActivityId');
  const input = document.getElementById('reimbProjectCode');
  if (hid) hid.value = a ? String(a.id) : '';
  if (input) input.value = a ? (a.project_code || '') : '';
  if (a && a.brand) {
    const mapped = reimbDetailBrandFromLegacyBrand(a.brand);
    if (mapped) reimbDetailDefaultBrand = mapped;
  }
}

function reimbProjectInputChanged() {
  const input = document.getElementById('reimbProjectCode');
  const hid = document.getElementById('reimbActivityId');
  const code = (input?.value || '').replace(/^\uFEFF/, '').trim();
  const id = code ? reimbursementActivityIndex.codeToId.get(code) : null;
  if (hid) hid.value = id ? String(id) : '';
  if (id) {
    const a = (reimbursementPageState.activities || []).find((x) => Number(x.id) === Number(id));
    if (a && a.brand) {
      const mapped = reimbDetailBrandFromLegacyBrand(a.brand);
      if (mapped) reimbDetailDefaultBrand = mapped;
    }
  }
}

function reimbVisibleRemarks(raw) {
  const s = String(raw || '');
  const idx = s.indexOf(REIMB_DETAIL_META_PREFIX);
  return idx >= 0 ? s.slice(0, idx).trim() : s.trim();
}

function reimbReadDetailMeta(raw) {
  const s = String(raw || '');
  const idx = s.indexOf(REIMB_DETAIL_META_PREFIX);
  if (idx < 0) return {};
  try {
    return JSON.parse(s.slice(idx + REIMB_DETAIL_META_PREFIX.length).trim()) || {};
  } catch {
    return {};
  }
}

function reimbParseJsonObject(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function reimbRemarksWithMeta(remarks, meta) {
  const visible = String(remarks || '').trim();
  return `${visible}${REIMB_DETAIL_META_PREFIX}${JSON.stringify(meta)}`;
}

/** 从项目编号提取品牌线（PHD / X.O / CLUB 等） */
function extractBrandFromProjectCode(projectCodeRaw) {
  const s = String(projectCodeRaw || '').toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (s.includes('CLUB')) return 'CLUB';
  if (s.includes('PHD')) return 'PHD';
  if (s.includes('X.O') || s.includes('XO')) return 'X.O';
  if (s.includes('REMY')) return 'REMY';
  if (s.includes('RC')) return 'RC';
  return '';
}

const REIMB_BRAND_SORT_ORDER = ['PHD', 'X.O', 'CLUB', 'REMY', 'RC'];

function reimbIsPlaceholderProjectCode(pc) {
  const s = String(pc || '').trim();
  return !s || s === '—' || s === '内部';
}

/** 汇总明细行品牌（多场次合并时用顿号连接） */
