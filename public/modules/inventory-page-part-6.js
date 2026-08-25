function invBuildCommonRowsHtml(items, preset) {
  const P = preset || {};
  const whId = Number(inventoryPageState.warehouseId || 0);
  const key = String(whId || 'global');
  const q = String((inventoryPageState.outboundCommonSearchByWarehouse || {})[key] || '').trim().toLowerCase();
  const listFilter = inventoryPageState.outboundListFilter || 'common';
  const poolRaw = Array.isArray(items) ? items.slice() : [];
  let pool = poolRaw;
  if (listFilter === 'common') pool = poolRaw.filter(invItemIsCommon);
  else if (listFilter === 'uncommon') pool = poolRaw.filter((it) => !invItemIsCommon(it));

  let sortedPool;
  if (listFilter === 'common') {
    const orderIdsStored = ((inventoryPageState.outboundCommonOrderByWarehouse || {})[key] || [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));
    const allCommonIds = pool.map((it) => Number(it.id));
    const orderIds = [...orderIdsStored.filter((id) => allCommonIds.includes(id)), ...allCommonIds.filter((id) => !orderIdsStored.includes(id))];
    inventoryPageState.outboundCommonOrderByWarehouse[key] = orderIds;
    const rank = new Map(orderIds.map((id, idx) => [id, idx]));
    sortedPool = pool.slice().sort((a, b) => {
      const ra = rank.has(Number(a.id)) ? rank.get(Number(a.id)) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(Number(b.id)) ? rank.get(Number(b.id)) : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
    });
  } else {
    sortedPool = pool.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
  }

  const filteredItems = sortedPool.filter((it) => {
    if (!q) return true;
    const text = `${it.name || ''} ${it.dimensions || ''}`.toLowerCase();
    return text.includes(q);
  });

  if (!filteredItems.length) {
    const emptyMsg =
      listFilter === 'common'
        ? '暂无常用物料。可切换到「非常用」或请管理员将物料设为常用。'
        : listFilter === 'uncommon'
          ? '暂无非常用物料。可切换到「常用」查看常用列表。'
          : '暂无物料。';
    return `<tr><td colspan="6" style="color:var(--text-muted);font-size:13px">${emptyMsg}</td></tr>`;
  }
  return filteredItems
    .map((it) => {
      const id = it.id;
      const p = P[id] != null ? P[id] : P[String(id)];
      const qty = p && p.quantity != null ? Math.max(0, parseInt(p.quantity, 10) || 0) : 0;
      const checked = qty > 0;
      const note = p && p.line_note != null ? String(p.line_note) : '';
      return `
        <tr data-inv-common-row data-item-id="${id}" draggable="true" ondragstart="invCommonDragStart(event, ${id})" ondragover="invCommonDragOver(event)" ondrop="invCommonDrop(event, ${id})" ondragend="invCommonDragEnd(event)">
          <td class="inv-ob-col-select">
            <div class="inv-common-select-wrap">
              <input type="checkbox" id="invCommonCk_${id}" class="inv-outbound-common-ck" ${checked ? 'checked' : ''} onchange="invOnOutboundCommonCk(${id})">
            </div>
          </td>
          <td class="inv-ob-col-material">
            <div class="inv-ob-material-cell">
              <div class="inv-ob-item-thumb" aria-hidden="true">${invObItemThumbHtml(it)}</div>
              <div class="inv-ob-name-block">
                <div class="inv-ob-name-line">
                  <span class="inv-ob-name-text">${escapeHtml(it.name)}</span>
                </div>
                <div class="inv-ob-name-dim">${escapeHtml((it.dimensions || '—').slice(0, 40))}</div>
              </div>
            </div>
          </td>
          <td class="inv-ob-col-stock ${invStockClass(it)}">${it.quantity_on_hand}</td>
          <td class="inv-ob-col-qty">
            <input type="number" class="form-control form-control-sm" id="invCommonQty_${id}" min="0" step="1" value="${qty}" placeholder="0" onchange="invOnOutboundCommonQty(${id})">
          </td>
          <td class="inv-ob-col-note"><input type="text" class="form-control form-control-sm" id="invCommonNote_${id}" placeholder="行备注" value="${escapeHtml(note)}" oninput="invOnOutboundCommonNote(${id})"></td>
          <td class="inv-ob-col-sort"><span class="inv-common-drag-handle" title="按住拖动排序">···</span></td>
        </tr>`;
    })
    .join('');
}

function invBuildSelectedOutboundPreviewHtml() {
  const whMap = new Map((inventoryPageState.outboundWarehousesCache || []).map((w) => [Number(w.id), w]));
  const rows = [];
  Object.keys(inventoryPageState.outboundCommonByWarehouse || {}).forEach((k) => {
    const wid = Number(k);
    if (!Number.isFinite(wid)) return;
    const wh = whMap.get(wid);
    const preset = inventoryPageState.outboundCommonByWarehouse[wid] || {};
    Object.entries(preset).forEach(([itemId, p]) => {
      const qty = p && p.checked ? Math.max(0, parseInt(p.quantity, 10) || 0) : 0;
      if (qty < 1) return;
      const idKey = String(itemId);
      const meta =
        inventoryPageState.outboundItemMetaByWarehouse?.[wid]?.[idKey] ||
        inventoryPageState.outboundItemMetaByWarehouse?.[wid]?.[itemId] ||
        inventoryPageState.outboundEditLineMeta?.[wid]?.[idKey] ||
        inventoryPageState.outboundEditLineMeta?.[wid]?.[itemId] ||
        {};
      rows.push({
        warehouse: wh ? invWarehouseFullLabel(wh) : `仓库#${wid}`,
        name: meta.name || `物料#${idKey}`,
        dimensions: meta.dimensions || '—',
        quantity: qty,
        note: p && p.line_note ? String(p.line_note).trim() : '',
      });
    });
  });
  if (!rows.length) {
    return '<div class="empty-state" style="margin:0">暂未选择物品。请在左侧勾选并填写数量。</div>';
  }
  return `
    <div class="table-wrapper inv-ob-preview-table-wrap">
      <table class="data-table inv-outbound-table inv-ob-preview-table">
        <thead><tr><th>仓库</th><th>物料</th><th>规格</th><th style="width:84px">数量</th><th>备注</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>
                <td>${escapeHtml(row.warehouse)}</td>
                <td>${escapeHtml(row.name)}</td>
                <td>${escapeHtml(row.dimensions)}</td>
                <td>${row.quantity}</td>
                <td>${escapeHtml(row.note || '—')}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function invBuildExtraLineRowsHtml(items, lines) {
  const byId = new Map(items.map((it) => [String(it.id), it]));
  const itemDisplay = (it) => `${it.name} [#${it.id}] (余${it.quantity_on_hand})`;
  const selectedDisplay = (selId) => {
    const it = byId.get(String(selId || ''));
    return it ? itemDisplay(it) : '';
  };
  return lines
    .map(
      (ln, idx) => `
      <tr>
        <td>
          <input type="text" class="form-control form-control-sm" data-idx="${idx}" list="invExtraItemList" placeholder="输入关键词并下拉选择物料" value="${escapeHtml(selectedDisplay(ln.item_id))}" onchange="invPatchOutboundLineByDisplay(${idx}, this.value)">
        </td>
        <td style="width:88px"><input type="number" class="form-control form-control-sm" min="1" step="1" value="${ln.quantity || 1}" onchange="invPatchOutboundLine(${idx},'quantity',this.value)"></td>
        <td><input type="text" class="form-control form-control-sm" placeholder="说明" value="${escapeHtml(ln.line_note || '')}" onchange="invPatchOutboundLine(${idx},'line_note',this.value)"></td>
        <td style="width:56px"><button type="button" class="btn btn-xs btn-ghost" onclick="invRemoveOutboundRow(${idx})">删</button></td>
      </tr>`,
    )
    .join('');
}

/**
 * 智能填写解析：从一段任意顺序/格式的文本中识别出 { name, phone, address, city }。
 *
 * 设计目标：兼容用户从淘宝/京东/微信/聊天记录复制的多种顺序与噪声格式。
 *  - 11 位手机号（1[3-9]xxxxxxxxx）优先识别；其次 7-12 位带分隔符的固话
 *  - "姓名 + 公司"用以下启发式分辨：2-8 位纯中文 / 英文人名 / 含「公司/有限/集团/工作室」等
 *  - 「地址」候选：含「省/市/区/县/镇/街/道/路/弄/巷/号/楼/层/室/苑/园/栋/单元/大厦/广场/花园/小区」等关键字
 *    或长度 ≥ 8 的兜底
 *  - 噪声标签自动去除：「收件人」「电话」「地址」「联系人」「Tel」「Phone」「Address」等前后缀
 *
 * 不依赖姓名 → 电话 → 地址的固定顺序；多行/单行/逗号分隔均可处理。
 */
