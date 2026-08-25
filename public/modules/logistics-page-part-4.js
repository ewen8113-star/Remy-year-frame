async function deleteSelectedLogistics() {
  const ids = Array.from(logisticsState.selectedIds).filter(Number.isFinite);
  if (!ids.length) {
    showToast('请先勾选要删除的记录', 'warning');
    return;
  }
  if (!confirm(`确定删除选中的 ${ids.length} 条物流记录？`)) return;
  if (!confirm('再次确认：删除后不可恢复，是否继续？')) return;
  try {
    for (const id of ids) {
      await api('DELETE', `/logistics/${id}`);
    }
    logisticsState.selectedIds = new Set();
    showToast(`已删除 ${ids.length} 条记录`, 'success');
    await loadLogistics();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
    await loadLogistics();
  }
}

function filterLogistics() {
  loadLogistics();
}

function isMergedFlag(v) {
  return v === true || v === 1 || String(v) === '1';
}

/** 列表列：关联场次项目编号（activity JOIN 或物流冗余字段） */
function listActivityProjectHtml(r) {
  const pc =
    (r.activity_project_code != null && String(r.activity_project_code).trim()) ||
    (r.related_project_code != null && String(r.related_project_code).trim()) ||
    (r.project_code != null && String(r.project_code).trim()) ||
    '';
  if (!pc) return '<span style="color:var(--text-muted)">—</span>';
  return `<span class="project-code" style="font-size:12px">${escapeHtml(pc)}</span>`;
}

function listAllocationNoteHtml(note) {
  const t = String(note || '').trim();
  if (!t) return '<span style="color:var(--text-muted)">—</span>';
  const full = escapeHtml(t);
  const max = 28;
  const short = t.length > max ? `${escapeHtml(t.slice(0, max))}…` : full;
  return `<span style="font-size:12px;max-width:200px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle" title="${full}">${short}</span>`;
}

/** 列表/弹窗展示用：关联项目编号（兼容接口字段） */
function formatLogisticsRelatedProject(l) {
  const a =
    l.related_project_code != null && String(l.related_project_code).trim() !== ''
      ? String(l.related_project_code).trim()
      : l.project_code != null && String(l.project_code).trim() !== ''
        ? String(l.project_code).trim()
        : '';
  if (!a) return '—';
  return escapeHtml(a);
}

// 物流：关联项目编号索引（当前年度活动 project_code → activity.id）
const logisticsProjectIndex = {
  codes: new Set(),
  codeToId: new Map(),
};

async function ensureActivityProjectIndex() {
  let qs = '?sortBy=date&sortOrder=DESC&isVirtual=0';
  if (currentYearFrameId) qs += `&yearFrameId=${currentYearFrameId}`;
  const acts = await api('GET', `/activities${qs}`);
  const codes = (acts || [])
    .map((x) => ({ id: Number(x.id), code: (x.project_code || '').replace(/^\uFEFF/, '').trim() }))
    .filter((x) => x.code);
  logisticsProjectIndex.codes = new Set(codes.map((x) => x.code));
  logisticsProjectIndex.codeToId = new Map(codes.map((x) => [x.code, x.id]).filter(([, id]) => Number.isFinite(id)));
  return [...new Set(codes.map((x) => x.code))].sort();
}

/** 打开物流弹窗时填充「关联项目编号」下拉建议（当前年度活动 project_code） */
async function loadLogProjectDatalist() {
  const dl = document.getElementById('logProjectList');
  const warDl = document.getElementById('warProjectList');
  if (!dl && !warDl) return;
  try {
    const uniqSorted = await ensureActivityProjectIndex();
    const opts = uniqSorted.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
    if (dl) dl.innerHTML = opts;
    if (warDl) warDl.innerHTML = opts;
  } catch (_) {
    if (dl) dl.innerHTML = '';
    if (warDl) warDl.innerHTML = '';
    logisticsProjectIndex.codes = new Set();
    logisticsProjectIndex.codeToId = new Map();
  }
}

let supplierDictCache = [];

async function loadSupplierPayeeSelect(selectId, selectedName) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  try {
    const rows = await api('GET', '/dict?category=supplier');
    supplierDictCache = (Array.isArray(rows) ? rows : [])
      .filter((e) => e.is_active !== false && e.is_active !== 0)
      .map((e) => {
        const c = e.content || {};
        const name = String(c.company_name || e.name || '').trim();
        return { id: e.id, name };
      })
      .filter((x) => x.name);
  } catch (_) {
    supplierDictCache = [];
  }
  const want = String(selectedName || '').trim();
  const opts = ['<option value="">请选择供应商</option>'];
  let matched = false;
  supplierDictCache.forEach((e) => {
    const on = want && e.name === want;
    if (on) matched = true;
    opts.push(`<option value="${escapeHtml(e.name)}"${on ? ' selected' : ''}>${escapeHtml(e.name)}</option>`);
  });
  if (want && !matched) {
    opts.push(`<option value="${escapeHtml(want)}" selected>${escapeHtml(want)}（已保存）</option>`);
  }
  sel.innerHTML = opts.join('');
}

function supplierPayeeSelectChanged(selectId) {
  const sel = document.getElementById(selectId);
  const name = sel?.value?.trim() || '';
  const hit = supplierDictCache.find((e) => e.name === name);
  if (hit?.id) api('POST', `/dict/${hit.id}/touch`).catch(() => {});
}

async function loadLogPayeeSupplierSelect(selectedName) {
  await loadSupplierPayeeSelect('logPayeeSelect', selectedName);
}

function logPayeeSelectChanged() {
  supplierPayeeSelectChanged('logPayeeSelect');
}

function parseLogisticsFeePartInput(id) {
  const raw = document.getElementById(id)?.value;
  if (raw === '' || raw == null) return 0;
  return Math.max(0, roundMoney2(raw));
}

function logisticsFeePartsChanged() {
  const shipping = parseLogisticsFeePartInput('logShippingFee');
  const handling = parseLogisticsFeePartInput('logHandlingFee');
  const returnShipping = parseLogisticsFeePartInput('logReturnShippingFee');
  const returnHandling = parseLogisticsFeePartInput('logReturnHandlingFee');
  const total = roundMoney2(shipping + handling + returnShipping + returnHandling);
  const hint = document.getElementById('logFeeTotalHint');
  const val = document.getElementById('logFeeTotalValue');
  if (!hint || !val) return;
  if (shipping > 0 || handling > 0 || returnShipping > 0 || returnHandling > 0) {
    hint.style.display = '';
    val.textContent = fmtMoney(total);
  } else {
    hint.style.display = 'none';
  }
}

function logisticsFeeFieldsFromRow(item) {
  const shipping = roundMoney2(item?.shipping_fee);
  const handling = roundMoney2(item?.handling_fee);
  const returnShipping = roundMoney2(item?.return_shipping_fee);
  const returnHandling = roundMoney2(item?.return_handling_fee);
  const total = roundMoney2(item?.fee);
  const sum = roundMoney2(shipping + handling + returnShipping + returnHandling);
  if (sum > 0 && Math.abs(sum - total) < 0.01) {
    return { shipping, handling, returnShipping, returnHandling, total };
  }
  if (total > 0 && sum <= 0) {
    return { shipping: total, handling: 0, returnShipping: 0, returnHandling: 0, total };
  }
  return { shipping, handling, returnShipping, returnHandling, total: sum || total };
}

function logisticsFeeBreakdownFromRow(item) {
  return logisticsFeeFieldsFromRow(item);
}

function logisticsFeeCellHtml(row) {
  const { shipping, handling, returnShipping, returnHandling, total } = logisticsFeeBreakdownFromRow(row);
  if (total <= 0) return '—';
  const parts = [];
  if (shipping > 0) parts.push(`出货运费 ${fmtMoney(shipping)}`);
  if (handling > 0) parts.push(`出货操作费 ${fmtMoney(handling)}`);
  if (returnShipping > 0) parts.push(`回收运费 ${fmtMoney(returnShipping)}`);
  if (returnHandling > 0) parts.push(`回收操作费 ${fmtMoney(returnHandling)}`);
  if (parts.length > 1) {
    return `<span title="${escapeHtml(parts.join(' + '))}">${fmtMoney(total)}</span>`;
  }
  return fmtMoney(total);
}
