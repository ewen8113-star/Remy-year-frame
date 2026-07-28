function projectCodeDateYYMMDD(raw) {
  const p = beijingParts(raw);
  if (!p) return '';
  const yy = String(p.year).slice(-2);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/** 年框前缀后的描述段是否以 6 位活动日期开头 */
function projectCodeHasDateSuffix(projectCode) {
  return /^\S+\s+\d{6}/.test(String(projectCode || '').trim());
}

function buildProjectCode({ yearFrameCode, date, city, venue, client, brand, type }) {
  const code = String(yearFrameCode || '').trim();
  const datePart = projectCodeDateYYMMDD(date);
  const suffix =
    `${normalizeProjectCodeCity(city)}` +
    `${normalizeProjectCodeToken(venue)}` +
    `${normalizeProjectCodeToken(client)}` +
    `${normalizeProjectCodeToken(brand)}` +
    `${normalizeProjectCodeToken(type)}`;
  if (!code) return datePart ? `${datePart}${suffix}` : suffix;
  if (!datePart) return `${code} ${suffix}`.trim();
  return `${code} ${datePart}${suffix}`.trim();
}

/** 为已有编号补上或替换 YYMMDD（空格后第一段 6 位数字） */
function repairProjectCodeDate(projectCode, date) {
  const s = String(projectCode || '').trim();
  const datePart = projectCodeDateYYMMDD(date);
  if (!s || !datePart) return s;
  const sp = s.indexOf(' ');
  if (sp < 0) return s;
  const prefix = s.slice(0, sp);
  let rest = s.slice(sp + 1).trim();
  if (/^\d{6}/.test(rest)) rest = datePart + rest.slice(6);
  else rest = datePart + rest;
  return `${prefix} ${rest}`.trim();
}

function genProjectCode() {
  syncActivityBrandFromYearFrameCode();
  const pc = buildProjectCode({
    yearFrameCode: document.getElementById('actYearFrameCode')?.value || '',
    date: document.getElementById('actDate')?.value || '',
    city: document.getElementById('actCity')?.value || '',
    venue: document.getElementById('actVenue')?.value || '',
    client: document.getElementById('actClient')?.value || '',
    brand: document.getElementById('actBrandField')?.value || '',
    type: document.getElementById('actActivityType')?.value || '',
  });
  const el = document.getElementById('actProjectCode');
  if (el) el.value = pc;
}

function detectActivityBrandByYearFrameCode(rawCode) {
  const normalized = String(rawCode || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!normalized) return '';
  if (normalized.includes('CLUB')) return 'CLUB';
  if (normalized.includes('PHD')) return 'PHD';
  if (normalized.includes('RC')) return 'RC';
  if (normalized.includes('XO')) return 'X.O';
  return '';
}

function syncActivityBrandFromYearFrameCode() {
  const yearFrameCode = document.getElementById('actYearFrameCode')?.value || '';
  const brandEl = document.getElementById('actBrandField');
  if (!brandEl) return;
  const detected = detectActivityBrandByYearFrameCode(yearFrameCode);
  if (detected && brandEl.value !== detected) {
    brandEl.value = detected;
    genProjectCode();
  }
}

// ----- 活动表单下拉（lookup_options /api/lookups）-----
const ACTIVITY_LOOKUP_DEFS = [
  { category: 'activity_year_frame_code', selectId: 'actYearFrameCode', allowEmpty: false },
  { category: 'activity_type', selectId: 'actActivityType', allowEmpty: false },
  { category: 'activity_period', selectId: 'actPeriod', allowEmpty: false },
  { category: 'activity_region', selectId: 'actRegion', allowEmpty: true, emptyLabel: '请选择' },
  { category: 'activity_belonging', selectId: 'actBelonging', allowEmpty: true, emptyLabel: '请选择' },
  { category: 'activity_executor', selectId: 'actExecutor', allowEmpty: false },
  { category: 'activity_status', selectId: 'actStatus', allowEmpty: false },
];

const LOOKUP_EDITOR_LABELS = {
  activity_year_frame_code: '编辑：年框编号',
  activity_type: '编辑：活动类型',
  activity_period: '编辑：时段',
  activity_region: '编辑：区域',
  activity_belonging: '编辑：归属',
  activity_executor: '编辑：执行人员',
  activity_status: '编辑：状态',
};

let _lookupEditCategory = '';

function populateLookupSelect(el, rows, def, rawDesired) {
  el.innerHTML = '';
  if (def.allowEmpty) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = def.emptyLabel || '请选择';
    el.appendChild(o);
  }
  const seen = new Set();
  (rows || []).forEach((r) => {
    if (!r || r.value == null) return;
    seen.add(String(r.value));
    const o = document.createElement('option');
    o.value = r.value;
    o.textContent = r.label || r.value;
    el.appendChild(o);
  });

  let desired;
  if (rawDesired !== undefined && rawDesired !== null && String(rawDesired) !== '') {
    desired = String(rawDesired);
  } else if (def.allowEmpty) {
    desired = '';
  } else if (rows && rows.length) {
    desired = String(rows[0].value);
  } else {
    desired = '';
  }

  if (desired !== '' && !seen.has(desired)) {
    const o = document.createElement('option');
    o.value = desired;
    o.textContent = `${desired}（未在列表中）`;
    el.appendChild(o);
  }

  el.value = desired;
  if (el.value !== desired && el.options.length) {
    el.selectedIndex = 0;
  }
}

async function fillActivityLookupSelects(valueMap = {}) {
  const pairs = await Promise.all(
    ACTIVITY_LOOKUP_DEFS.map(async (def) => {
      const rows = await api('GET', `/lookups?category=${encodeURIComponent(def.category)}`);
      return [def, rows];
    })
  );
  for (const [def, rows] of pairs) {
    const el = document.getElementById(def.selectId);
    if (!el) continue;
    const hasKey = Object.prototype.hasOwnProperty.call(valueMap, def.selectId);
    const raw = hasKey ? valueMap[def.selectId] : undefined;
    const nextRows = def.selectId === 'actStatus'
      ? (rows || []).filter((r) => String(r.value || '').trim() !== 'cancelled')
      : rows;
    populateLookupSelect(el, nextRows, def, raw);
  }
}

async function quickUpdateActivityStatus(id, status) {
  const next = String(status || '').trim();
  if (!['pending', 'deferred', 'completed'].includes(next)) return;
  try {
    await api('PUT', `/activities/${id}`, { status: next });
    const row = (activitiesState.data || []).find((x) => Number(x.id) === Number(id));
    if (row) row.status = next;
    showToast('状态已更新', 'success');
  } catch (err) {
    showToast('状态更新失败: ' + err.message, 'error');
    if (currentPage === 'virtual-activities') loadVirtualActivities();
    else loadActivities();
  }
}

function applyNewActivityLookupDefaults() {
  const p = document.getElementById('actPeriod');
  if (p && [...p.options].some((o) => o.value === '日常')) p.value = '日常';
  const ex = document.getElementById('actExecutor');
  if (ex && [...ex.options].some((o) => o.value === '无')) ex.value = '无';
  const st = document.getElementById('actStatus');
  if (st && [...st.options].some((o) => o.value === 'pending')) st.value = 'pending';
}

function getActivityLookupFormSnapshot() {
  return {
    actYearFrameCode: document.getElementById('actYearFrameCode')?.value,
    actActivityType: document.getElementById('actActivityType')?.value,
    actPeriod: document.getElementById('actPeriod')?.value,
    actRegion: document.getElementById('actRegion')?.value,
    actBelonging: document.getElementById('actBelonging')?.value,
    actExecutor: document.getElementById('actExecutor')?.value,
    actBrandAmbassador: document.getElementById('actBrandAmbassador')?.value,
    actStatus: document.getElementById('actStatus')?.value,
  };
}

async function refreshActivityLookupsBehindLookupModal() {
  try {
    await fillActivityLookupSelects(getActivityLookupFormSnapshot());
  } catch (e) {
    console.error(e);
  }
}

function lookupEditorRowHtml(r) {
  const active = r.is_active ? '启用' : '停用';
  return `<tr>
    <td><code style="font-size:12px">${escapeHtml(String(r.value))}</code></td>
    <td><input type="text" class="form-control lookup-edit-label" data-id="${r.id}" value="${escapeHtml(String(r.label || ''))}" style="font-size:13px;padding:4px 8px"></td>
    <td><input type="number" class="form-control lookup-edit-sort" data-id="${r.id}" value="${Number(r.sort_order) || 0}" style="font-size:13px;padding:4px 8px;width:64px"></td>
    <td style="font-size:12px;color:${r.is_active ? 'var(--success)' : 'var(--text-muted)'}">${active}</td>
    <td style="white-space:nowrap">
      <button type="button" class="btn btn-xs btn-ghost" onclick="saveLookupOptionRow(${r.id})">保存</button>
      ${r.is_active ? `<button type="button" class="btn btn-xs btn-ghost" onclick="deactivateLookupOption(${r.id})">停用</button>` : `<button type="button" class="btn btn-xs btn-ghost" onclick="reactivateLookupOption(${r.id})">启用</button>`}
    </td>
  </tr>`;
}

async function showLookupEditModal(category) {
  _lookupEditCategory = category;
  const title = document.getElementById('modalLookupTitle');
  if (title) title.textContent = LOOKUP_EDITOR_LABELS[category] || '编辑选项';
  const body = document.getElementById('lookupEditorContent');
  if (body) body.innerHTML = '<div style="padding:16px;color:var(--text-muted)">加载中...</div>';
  openModal('modalLookup');
  await renderLookupEditor(category);
}

async function renderLookupEditor(category) {
  const body = document.getElementById('lookupEditorContent');
  if (!body) return;
  try {
    const rows = await api('GET', `/lookups?category=${encodeURIComponent(category)}&includeInactive=1`);
    body.innerHTML = `
      <div style="margin-bottom:12px">
        <button type="button" class="btn btn-primary btn-sm" onclick="toggleLookupAddForm()">+ 新增选项</button>
      </div>
      <div id="lookupAddForm" style="display:none;margin-bottom:12px;padding:12px;background:var(--bg-primary);border-radius:var(--radius-sm)">
        <div class="form-grid" style="grid-template-columns:1fr 1fr 80px;gap:8px;margin-bottom:8px">
          <input type="text" id="lookupNewValue" class="form-control" placeholder="存储值（写入数据库）" style="font-size:13px">
          <input type="text" id="lookupNewLabel" class="form-control" placeholder="显示名称" style="font-size:13px">
          <input type="number" id="lookupNewSort" class="form-control" placeholder="排序" value="0" style="font-size:13px">
        </div>
        <button type="button" class="btn btn-primary btn-sm" onclick="confirmAddLookupOption()">保存</button>
      </div>
      <table class="data-table" style="font-size:13px">
        <thead><tr><th>值</th><th>显示</th><th>排序</th><th>状态</th><th></th></tr></thead>
        <tbody id="lookupEditorTbody">${rows.map((r) => lookupEditorRowHtml(r)).join('')}</tbody>
      </table>
    `;
  } catch (err) {
    body.innerHTML = `<div style="color:var(--danger);padding:12px">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}
