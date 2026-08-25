/* 物资库存/出入库页面模块：从 app.js 机械迁移，保持库存、出库、入库、空瓶和 PDF 逻辑。 */

/* =============================================
   页面：物资模块（档案 + 出入库）
   ============================================= */
const INV_REGION_OPTS = ['东区', '南区', '北区', '东南区'];
const INV_LOGISTICS_OPTS = ['顺丰', '京东', '中通', '圆通', '物流', '其他'];
/** 与 src/routes/inventory.js 中 uploadDir、返回的 url 一致；勿删物理目录 */
const INV_ITEM_IMAGE_STORAGE_HINT = `<p class="form-hint" style="margin:0 0 8px;font-size:12px;line-height:1.45;color:var(--text-secondary)">上传文件写入项目目录 <code style="font-size:11px">public/uploads/inventory/</code>（相对仓库根目录），对外 URL 形如 <code style="font-size:11px">/uploads/inventory/文件名</code>；数据库表 <code style="font-size:11px">inv_items.image_urls</code>（JSON）存完整路径。请勿手动删除该目录内文件，否则物料卡片与 PDF 会缺图。</p>`;

async function apiInventoryUpload(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API}/inventory/upload`, { method: 'POST', credentials: 'include', body: fd });
  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    data = {};
  }
  if (!res.ok) throw new Error(data.error || data.message || '上传失败');
  return data.url;
}

const INV_WINE_AUDIT_STATUS_LABEL = {
  catalog_ok: '已与目录一致',
  catalog_spec_mismatch: '规格与目录展示不一致',
  catalog_name_only: '名称在目录、规格未对齐',
  not_in_catalog: '未在酒品目录',
};

async function invOpenWineAuditModal() {
  openModal('modalInvWineAudit');
  const body = document.getElementById('invWineAuditBody');
  if (!body) return;
  body.innerHTML = '<div class="empty-state">正在对照各仓库物料与酒品目录…</div>';
  try {
    const res = await api('GET', '/inventory/wine-audit');
    invRenderWineAuditBody(res.data || res);
  } catch (e) {
    body.innerHTML = `<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message || '')}</div></div>`;
  }
  renderLucideIcons();
}

function invRenderWineAuditBody(payload) {
  const body = document.getElementById('invWineAuditBody');
  if (!body || !payload) return;
  const s = payload.summary || {};
  const rules = payload.rules || {};
  const rows = [];
  (payload.warehouses_all || payload.warehouses || []).forEach((wh) => {
    (wh.needs_review || []).forEach((it) => {
      rows.push({ wh, it, kind: 'needs_review' });
    });
  });
  const mismatchRows = [];
  (payload.warehouses_all || []).forEach((wh) => {
    (wh.spec_mismatch || []).forEach((it) => {
      if (!it.needs_review) mismatchRows.push({ wh, it });
    });
  });

  const rowHtml = (list, emptyMsg) => {
    if (!list.length) {
      return `<tr><td colspan="7" class="inv-wine-audit-empty">${escapeHtml(emptyMsg)}</td></tr>`;
    }
    return list
      .map(({ wh, it }) => {
        const spec = it.dimensions ? escapeHtml(String(it.dimensions)) : '—';
        const status =
          INV_WINE_AUDIT_STATUS_LABEL[it.catalog_status] || it.catalog_status_label || it.catalog_status;
        const wineTag = invItemIsWineTagged(it)
          ? `<span class="inv-badge-wine">已标记</span> ${escapeHtml(it.wine_label || it.name || '')}`
          : '<span style="color:var(--text-muted)">未标记</span>';
        return `<tr>
          <td>${escapeHtml(wh.warehouse_label || '—')}</td>
          <td><strong>${escapeHtml(it.name || '')}</strong></td>
          <td>${spec}</td>
          <td class="numeric">${escapeHtml(String(it.quantity_on_hand ?? 0))}</td>
          <td class="inv-wine-audit-tag-col">${wineTag}</td>
          <td><span class="inv-wine-audit-badge inv-wine-audit-badge--${escapeHtml(it.catalog_status)}">${escapeHtml(status)}</span></td>
          <td class="inv-wine-audit-hint">${it.is_common ? '常用物料 ' : ''}疑似酒类${it.catalog_status === 'not_in_catalog' ? '，建议核对是否应从酒品目录添加或补标签' : '，建议统一规格写法'}${invItemIsWineTagged(it) ? '' : ' · 可点「批量对齐目录标签」或到物料编辑勾选参与用酒统计'}</td>
        </tr>`;
      })
      .join('');
  };

  body.innerHTML = `
    <p class="form-hint inv-wine-audit-lead">用于不定期核对<strong>各仓库实物酒</strong>是否与<strong>酒品目录</strong>一致。下列「待核对」为疑似酒类且未与目录规格完全对齐的物料（含手工录入、物品目录导入等）。</p>
    <div class="inv-wine-audit-summary">
      <div class="inv-wine-audit-stat"><span class="k">酒品目录条数</span><span class="v">${s.catalog_count ?? 0}</span></div>
      <div class="inv-wine-audit-stat"><span class="k">仓库物料总数</span><span class="v">${s.item_count ?? 0}</span></div>
      <div class="inv-wine-audit-stat"><span class="k">疑似酒类</span><span class="v">${s.suspected_count ?? 0}</span></div>
      <div class="inv-wine-audit-stat"><span class="k">已与目录一致</span><span class="v">${s.catalog_ok_count ?? 0}</span></div>
      <div class="inv-wine-audit-stat inv-wine-audit-stat--warn"><span class="k">待核对</span><span class="v">${s.needs_review_count ?? 0}</span></div>
      <div class="inv-wine-audit-stat"><span class="k">仅规格不一致</span><span class="v">${s.spec_mismatch_count ?? 0}</span></div>
    </div>
    <details class="inv-wine-audit-rules">
      <summary>识别规则说明</summary>
      <ul>
        <li><strong>目录一致</strong>：${escapeHtml(rules.catalog_match || '')}</li>
        <li><strong>疑似酒类</strong>：${escapeHtml(rules.suspected || '')}</li>
        <li><strong>酒类标签</strong>：在物料编辑中勾选「参与用酒统计」并填写「酒类统计名」；从酒品目录添加的物料会自动标记。可在本页下方使用「批量对齐目录标签」。</li>
      </ul>
    </details>
    <h4 class="inv-wine-audit-section-title">待核对（疑似酒 · 未与目录完全对齐）· ${rows.length} 条</h4>
    <div class="table-wrapper inv-wine-audit-table-wrap">
      <table class="data-table inv-wine-audit-table">
        <thead><tr><th>仓库</th><th>物料名称</th><th>规格</th><th>库存</th><th>用酒标签</th><th>对照结果</th><th>说明</th></tr></thead>
        <tbody>${rowHtml(rows, '暂无待核对项，各仓疑似酒类均已与酒品目录对齐。')}</tbody>
      </table>
    </div>
    ${
      mismatchRows.length
        ? `<h4 class="inv-wine-audit-section-title">已在目录但规格写法不一致 · ${mismatchRows.length} 条</h4>
    <div class="table-wrapper inv-wine-audit-table-wrap">
      <table class="data-table inv-wine-audit-table">
        <thead><tr><th>仓库</th><th>物料名称</th><th>规格</th><th>库存</th><th>用酒标签</th><th>对照结果</th><th>说明</th></tr></thead>
        <tbody>${rowHtml(mismatchRows, '')}</tbody>
      </table>
    </div>`
        : ''
    }
    <div class="inv-wine-audit-actions">
      <button type="button" class="btn btn-secondary btn-sm" onclick="invBackfillWineTags()">批量对齐目录标签</button>
      <span class="form-hint">将名称+规格与酒品目录一致的物料自动标记为酒类并写入统计名</span>
    </div>`;
}

async function invBackfillWineTags() {
  try {
    const res = await api('POST', '/inventory/items/backfill-wine-tags');
    showToast(`已更新 ${res.updated ?? 0} 条物料的酒类标签`, 'success');
    invOpenWineAuditModal();
  } catch (e) {
    showToast(e.message || '批量标记失败', 'error');
  }
}

function invWineUsageStatsQueryString(download) {
  const yf = currentYearFrameId;
  const p = new URLSearchParams();
  p.set('yearFrameId', String(yf));
  if (wineUsageStatsState.region) p.set('region', wineUsageStatsState.region);
  if (wineUsageStatsState.belonging) p.set('belonging', wineUsageStatsState.belonging);
  if (wineUsageStatsState.projectCode) p.set('project_code', wineUsageStatsState.projectCode);
  if (wineUsageStatsState.dateFrom) p.set('date_from', wineUsageStatsState.dateFrom);
  if (wineUsageStatsState.dateTo) p.set('date_to', wineUsageStatsState.dateTo);
  if (wineUsageStatsState.month) p.set('month', wineUsageStatsState.month);
  if (download) p.set('download', '1');
  return p.toString();
}

function invRenderWineUsageStatsTable(payload) {
  const wines = payload?.wines || [];
  const rows = payload?.rows || [];
  const summary = payload?.summary || {};
  const filters = payload?.filters || {};
  const searchQ = String(filters.project_code || '').trim();
  const searchHint = searchQ
    ? `<div class="inv-ob-search-result-hint">项目编号关键词「${escapeHtml(searchQ)}」· 显示 <strong>${rows.length}</strong> 个场次</div>`
    : '';
  if (!wines.length) {
    return `${searchHint}<div class="empty-state inv-wine-stats-empty">用酒统计列加载失败，请刷新重试。</div>`;
  }
  const headCells = wines
    .map((w) => {
      const name =
        w.isPlaceholder || String(w.label || '').startsWith('__slot__')
          ? w.displayName || w.label
          : w.label || w.displayName;
      const vol = w.volume ? String(w.volume) : '';
      const normTail = (s) =>
        String(s || '')
          .toLowerCase()
          .replace(/\s+/g, '')
          .replace(/毫升/g, 'ml');
      const showVolLine =
        vol &&
        !normTail(name).endsWith(normTail(vol)) &&
        !normTail(name).includes(normTail(vol));
      const volLine = showVolLine
        ? `<span class="inv-wine-stats-wine-vol">${escapeHtml(vol)}</span>`
        : '';
      const title = vol && !showVolLine ? `${name} · ${vol}` : name;
      return `<th class="inv-wine-stats-wine-col" title="${escapeHtml(title)} · 合计 ${w.total} 瓶">
        <div class="inv-wine-stats-wine-head">
          <span class="inv-wine-stats-wine-name">${escapeHtml(name)}</span>
          ${volLine}
          <span class="inv-wine-stats-wine-total">合计 ${w.total}</span>
        </div>
      </th>`;
    })
    .join('');
  const bodyRows = rows
    .map((r) => {
      const cells = wines
        .map((w) => {
          const q = r.quantities[w.label];
          const txt = q > 0 ? String(q) : '—';
          return `<td class="inv-wine-stats-qty numeric">${escapeHtml(txt)}</td>`;
        })
        .join('');
      return `<tr>
        <td class="inv-wine-stats-fixed">${escapeHtml(r.region || '—')}</td>
        <td class="inv-wine-stats-fixed inv-wine-stats-proj">${escapeHtml(r.project_code || '—')}</td>
        <td class="inv-wine-stats-fixed">${escapeHtml(r.belonging || '—')}</td>
        ${cells}
      </tr>`;
    })
    .join('');
  return `
    ${searchHint}
    <p class="form-hint inv-wine-stats-summary">共 <strong>${summary.session_count ?? 0}</strong> 个场次 · 固定 <strong>${summary.wine_column_count ?? wines.length}</strong> 列酒品 · 本期有出库 <strong>${summary.wine_kind_count ?? 0}</strong> 种 · 合计 <strong>${summary.total_bottles ?? 0}</strong> 瓶</p>
    <div class="inv-wine-stats-table-wrap table-wrapper" id="invWineStatsPrintArea">
      <table class="data-table inv-wine-stats-table">
        <thead>
          <tr>
            <th class="inv-wine-stats-fixed">区域</th>
            <th class="inv-wine-stats-fixed">项目编号</th>
            <th class="inv-wine-stats-fixed">归属</th>
            ${headCells}
          </tr>
        </thead>
        <tbody>${bodyRows || '<tr><td colspan="' + (3 + wines.length) + '" class="inv-wine-stats-empty-cell">无匹配场次</td></tr>'}</tbody>
      </table>
    </div>`;
}

async function invLoadWineUsageStats() {
  const host = document.getElementById('invWineStatsTableHost');
  if (!host) return;
  host.innerHTML = '<div class="empty-state">加载中…</div>';
  try {
    const qs = invWineUsageStatsQueryString(false);
    const res = await api('GET', `/inventory/wine-usage-stats?${qs}`);
    const payload = res.data || res;
    wineUsageStatsState.lastPayload = payload;
    host.innerHTML = invRenderWineUsageStatsTable(payload);
  } catch (e) {
    host.innerHTML = `<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(e.message || '')}</div></div>`;
  }
}

function invWineStatsReadFiltersFromDom() {
  wineUsageStatsState.region = document.getElementById('invWineStatsRegion')?.value || '';
  wineUsageStatsState.belonging = document.getElementById('invWineStatsBelonging')?.value || '';
  wineUsageStatsState.projectCode = document.getElementById('invWineStatsSearch')?.value?.trim() || '';
  wineUsageStatsState.dateFrom = document.getElementById('invWineStatsDateFrom')?.value || '';
  wineUsageStatsState.dateTo = document.getElementById('invWineStatsDateTo')?.value || '';
  wineUsageStatsState.month = document.getElementById('invWineStatsMonth')?.value || '';
}

function invWineStatsApplyFilters() {
  invWineStatsReadFiltersFromDom();
  invLoadWineUsageStats();
}
