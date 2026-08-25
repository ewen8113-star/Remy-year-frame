function invRenderItemsPanel(items, viewMode) {
  const mode = viewMode || inventoryPageState.itemsViewMode || 'cards';
  if (!items.length) {
    return '<div class="empty-state inv-items-empty">暂无物料，请先添加或切换仓库</div>';
  }

  if (mode === 'list') {
    const rows = items
      .map((it) => {
        const commonBadge = invItemIsCommon(it) ? '<span class="inv-badge-common">常用</span>' : '';
        const wineBadge = invWineBadgeHtml(it);
        const to = invStatQty(it.total_outbound);
        const tdmg = invStatQty(it.total_damaged);
        const tlost = invStatQty(it.total_lost);
        return `<tr class="inv-item-clickable-row" data-item-id="${it.id}" onclick="invOpenItemDetail(${it.id})">
          <td class="inv-items-col-thumb"><div class="inv-list-thumb">${invItemImageInnerHtml(it)}</div></td>
          <td class="inv-items-col-name">
            <div class="inv-list-name">${escapeHtml(it.name)} ${commonBadge}${wineBadge}</div>
          </td>
          <td class="inv-items-col-spec">${escapeHtml(it.dimensions || '—')}</td>
          <td class="inv-items-col-stat" title="归还登记中损坏合计">${tdmg}</td>
          <td class="inv-items-col-stat" title="归还登记中丢失合计">${tlost}</td>
          <td class="inv-items-col-stat" title="该物品在本仓库累计出库数量">${to}</td>
          <td class="inv-items-col-qty"><span class="${invStockClass(it)}">${it.quantity_on_hand} <span class="inv-stock-hint">(${invStockLabel(it)})</span></span></td>
          <td class="inv-items-col-actions">${invItemActionsHtml(it)}</td>
        </tr>`;
      })
      .join('');
    return `
      <div class="table-wrapper inv-items-table-wrap">
        <table class="data-table inv-items-list-table">
          <thead>
            <tr>
              <th class="inv-items-col-thumb">图片</th>
              <th class="inv-items-col-name">物品名称</th>
              <th class="inv-items-col-spec">规格</th>
              <th class="inv-items-col-stat" title="归还登记中损坏数量合计">损坏</th>
              <th class="inv-items-col-stat" title="归还登记中丢失数量合计">丢失</th>
              <th class="inv-items-col-stat" title="各出库单中该物料数量之和，与当前库存、丢失覆盖无关">累计出库</th>
              <th class="inv-items-col-qty">库存</th>
              <th class="inv-items-col-actions">操作</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  if (mode === 'thumbnails') {
    const tiles = items
      .map((it) => {
        const commonBadge = invItemIsCommon(it) ? '<span class="inv-badge-common">常用</span>' : '';
        const wineBadge = invWineBadgeHtml(it);
        return `
        <div class="inv-thumb-tile inv-item-clickable-card" data-item-id="${it.id}" onclick="invOpenItemDetail(${it.id})">
          <div class="inv-thumb-tile-img">${invItemImageInnerHtml(it)}</div>
          <div class="inv-thumb-tile-body">
            <div class="inv-thumb-tile-title">${escapeHtml(it.name)} ${commonBadge}${wineBadge}</div>
            <div class="inv-thumb-tile-meta">
              <span class="${invStockClass(it)}">库存 ${it.quantity_on_hand}</span>
              ${invItemActionsHtml(it)}
            </div>
          </div>
        </div>`;
      })
      .join('');
    return `<div class="inv-thumb-grid">${tiles}</div>`;
  }

  /* cards (default) */
  return `
    <div class="inv-card-grid">
      ${items
        .map((it) => {
          const img = (it.image_urls && it.image_urls[0]) ? `<img src="${escapeHtml(it.image_urls[0])}" alt="">` : '<span style="color:var(--text-muted);font-size:12px">无图</span>';
          const commonBadge = invItemIsCommon(it) ? '<span class="inv-badge-common">常用</span>' : '';
          const wineBadge = invWineBadgeHtml(it);
          return `
          <div class="inv-item-card inv-item-clickable-card" data-item-id="${it.id}" onclick="invOpenItemDetail(${it.id})">
            <div class="inv-item-card-img">${img}</div>
            <div style="padding:12px">
              <div style="font-weight:700;font-size:14px;margin-bottom:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">${escapeHtml(it.name)} ${commonBadge}${wineBadge}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${escapeHtml(it.dimensions || '—')} ｜ ${escapeHtml((it.description || '').slice(0, 80))}${(it.description || '').length > 80 ? '…' : ''}</div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                <span class="${invStockClass(it)}">库存 ${it.quantity_on_hand} <span style="font-size:11px;font-weight:500">(${invStockLabel(it)})</span></span>
                ${invItemActionsHtml(it)}
              </div>
            </div>
          </div>`;
        })
        .join('')}
    </div>`;
}

/** 空瓶回收：按仓库分区，仅展示名称与库存；点击名称查看追溯（不做物料卡片/编辑） */
function invRenderEmptyBottleWarehouseSections(groups) {
  const arr = Array.isArray(groups) ? groups : [];
  if (!arr.length) {
    return '<div class="inv-empty-bottle-root"><div class="empty-state">暂无空瓶回收数据</div></div>';
  }
  const total = arr.reduce((s, g) => s + (parseInt(g.total_empty_bottles, 10) || 0), 0);
  return `
    <div class="inv-empty-bottle-root">
      <p class="form-hint inv-empty-bottle-lead">按仓库查看空瓶名称与当前库存；点击名称可查看<strong>项目编号、回收时间（入库登记时间）、数量</strong>追溯明细。各仓合计：<strong>${total}</strong></p>
      ${arr
        .map((g) => {
          const whLabel = `${g.brand_code || ''} · ${g.region || ''}`;
          const rows = Array.isArray(g.rows) ? g.rows : [];
          const sub = parseInt(g.total_empty_bottles, 10) || 0;
          const rowsHtml = rows.length
            ? rows
                .map(
                  (r) => `
            <button type="button" class="inv-empty-bottle-name-row" onclick="invOpenEmptyBottleTraceModal(${Number(r.item_id)})">
              <span class="inv-empty-bottle-name">${escapeHtml(r.name || '')}</span>
              <span class="inv-empty-bottle-qty">库存 <strong>${parseInt(r.quantity_on_hand, 10) || 0}</strong></span>
              <span class="inv-empty-bottle-go" aria-hidden="true">追溯 →</span>
            </button>`,
                )
                .join('')
            : '<div class="empty-state inv-empty-bottle-wh-empty">该仓库暂无空瓶物料</div>';
          return `
        <section class="inv-empty-bottle-wh-section">
          <div class="inv-empty-bottle-wh-head">
            <h3 class="inv-empty-bottle-wh-title">${escapeHtml(whLabel)}</h3>
            <span class="form-hint" style="margin:0">小计 ${sub}</span>
          </div>
          <div class="inv-empty-bottle-wh-body">${rowsHtml}</div>
        </section>`;
        })
        .join('')}
    </div>`;
}

async function invOpenEmptyBottleTraceModal(itemId) {
  const id = parseInt(itemId, 10);
  if (!Number.isFinite(id) || id <= 0) return;
  const body = document.getElementById('modalInvEmptyBottleBody');
  const title = document.getElementById('modalInvEmptyBottleTitle');
  if (!body) return;
  if (title) title.textContent = '空瓶回收追溯';
  body.innerHTML = '<div class="empty-state">加载中...</div>';
  openModal('modalInvEmptyBottleTrace');
  try {
    const data = await api('GET', `/inventory/empty-bottles/items/${id}/trace`);
    const it = data.item || {};
    if (title) title.textContent = it.name ? `空瓶追溯 · ${it.name}` : '空瓶回收追溯';
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const tableRows = lines
      .map((ln) => {
        const time = ln.inbound_recorded_at ? fmtDateTime(ln.inbound_recorded_at) : '—';
        const proj = escapeHtml(ln.display_main || '—');
        const sub = ln.display_sub
          ? `<div class="form-hint" style="margin-top:4px">${escapeHtml(ln.display_sub)}</div>`
          : '';
        const src =
          ln.source_material_name && String(ln.source_material_name).trim()
            ? `<div class="form-hint" style="margin-top:4px">来源出库物料：${escapeHtml(String(ln.source_material_name).trim())}</div>`
            : '';
        return `<tr>
        <td>${proj}${sub}${src}</td>
        <td>${time}</td>
        <td>${ln.qty_empty_recovered != null ? escapeHtml(String(ln.qty_empty_recovered)) : '0'}</td>
      </tr>`;
      })
      .join('');
    body.innerHTML = `
      <p class="form-hint" style="margin-top:0;margin-bottom:12px">回收时间为<strong>提交入库登记</strong>时的系统时间（与「物品入库」台账一致）。</p>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>项目编号 / 关联</th><th>回收时间（入库登记）</th><th>空瓶数量</th></tr></thead>
          <tbody>${
            lines.length
              ? tableRows
              : '<tr><td colspan="3" style="color:var(--text-muted);padding:16px;text-align:center">暂无回收登记明细（历史数据可能仅能通过物料名称关联）</td></tr>'
          }</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    body.innerHTML = `<div class="empty-state" style="color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
  renderLucideIcons();
}

/** 兼容旧入口：空瓶回收已并入「库存管理」与仓库同排卡片 */
async function renderEmptyBottleRecovery() {
  navigate('inv-empty');
}

async function invOpenItemDetail(itemId) {
  const id = parseInt(itemId, 10);
  if (!Number.isFinite(id) || id <= 0) return;
  const body = document.getElementById('invItemDetailModalBody');
  const title = document.getElementById('invItemDetailTitle');
  if (!body) return;
  if (title) title.textContent = '物品详情';
  body.innerHTML = '<div class="inv-item-detail-loading">加载中...</div>';
  openModal('modalInvItemDetail');
  try {
    const [it, usageResp] = await Promise.all([
      api('GET', `/inventory/items/${id}`),
      api('GET', `/inventory/items/${id}/activity-usage`).catch(() => ({ data: [] })),
    ]);
    const usageRows = Array.isArray(usageResp?.data) ? usageResp.data : [];
    const usageIsWine = !!(usageResp?.is_wine || invItemIsWineTagged(it));
    const urls = Array.isArray(it.image_urls) ? it.image_urls.filter(Boolean) : [];
    const usageTable = invBuildItemActivityUsageTableHtml(usageRows, usageIsWine);
    body.innerHTML = `
      <div class="inv-item-detail-shell">
        <div class="inv-item-detail-top">
          <div class="inv-item-detail-media">${invBuildItemDetailMediaHtml(urls)}</div>
          ${invBuildItemDetailMetaHtml(it)}
        </div>
        ${usageTable}
      </div>
    `;
    if (title) title.textContent = it.name ? `物品详情 · ${it.name}` : '物品详情';
  } catch (e) {
    body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escapeHtml(e.message || '')}</div>`;
  }
}

function invMergeOutboundLines(parts) {
  const m = new Map();
  for (const l of parts) {
    const id = l.item_id;
    if (!id || !Number.isFinite(id)) continue;
    const qty = Math.max(0, parseInt(l.quantity, 10) || 0);
    if (qty < 1) continue;
    const note = String(l.line_note || '').trim();
    const prev = m.get(id);
    if (!prev) {
      m.set(id, { item_id: id, quantity: qty, line_note: note || null });
    } else {
      prev.quantity += qty;
      const merged = [prev.line_note, note].filter(Boolean).join('；');
      prev.line_note = merged || null;
    }
  }
  return [...m.values()];
}

function invCollectCommonOutboundLines() {
  const lines = [];
  const rows = document.querySelectorAll('[data-inv-common-row]');
  rows.forEach((row) => {
    const id = parseInt(row.getAttribute('data-item-id'), 10);
    if (!Number.isFinite(id)) return;
    const ck = document.getElementById(`invCommonCk_${id}`);
    const qtyEl = document.getElementById(`invCommonQty_${id}`);
    const noteEl = document.getElementById(`invCommonNote_${id}`);
    if (!ck || !ck.checked) return;
    const qty = Math.max(0, parseInt(qtyEl && qtyEl.value, 10) || 0);
    if (qty < 1) return;
    const note = noteEl && noteEl.value ? String(noteEl.value).trim() : '';
    lines.push({ item_id: id, quantity: qty, line_note: note || null });
  });
  return lines;
}

/** 在重绘物资页面前调用：若当前 DOM 仍是「新建出库」表单，把已填内容写入 outboundForm，避免整页替换后丢失 */
