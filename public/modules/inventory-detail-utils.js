/* 库存物品详情的纯 HTML 构建函数。 */

function invUsageQtyCell(value) {
  return value != null && value !== '' ? escapeHtml(String(value)) : '—';
}

function invUsageProjectCell(code) {
  const text = String(code || '').trim();
  if (!text) return '<td class="col-project">—</td>';
  return `<td class="col-project" title="${escapeHtml(text)}">${escapeHtml(text)}</td>`;
}

function invUsageTableColgroup(isWine) {
  if (isWine) {
    return `<colgroup>
      <col class="col-w-project">
      <col class="col-w-date"><col class="col-w-qty col-group-out-end">
      <col class="col-w-date col-group-in-start"><col class="col-w-qty">
      <col class="col-w-qty col-group-rec-start"><col class="col-w-qty"><col class="col-w-qty"><col class="col-w-qty"><col class="col-w-qty">
    </colgroup>`;
  }
  return `<colgroup>
    <col class="col-w-project">
    <col class="col-w-date"><col class="col-w-qty col-group-out-end">
    <col class="col-w-date col-group-in-start"><col class="col-w-qty">
  </colgroup>`;
}

function invBuildItemActivityUsageTableHtml(usageRows, isWine) {
  const rows = Array.isArray(usageRows) ? usageRows : [];
  const title = isWine ? '关联场次用量与回收' : '关联场次用量';
  const hint = isWine
    ? '<p class="form-hint inv-item-usage-hint">酒类：空瓶回收、留给客户、丢失、损坏、消耗等按每次归还登记展示。</p>'
    : '';
  if (!rows.length) {
    return `<section class="inv-item-detail-usage inv-item-detail-usage--empty">
      <h4 class="inv-item-usage-head">${title}</h4>
      ${hint}
      <div class="inv-item-usage-empty">暂无关联场次的出库/入库记录</div>
    </section>`;
  }
  if (isWine) {
    const body = rows
      .map(
        (row) => `<tr>
          ${invUsageProjectCell(row.project_code)}
          <td class="col-date">${escapeHtml(row.outbound_date ? fmtDate(row.outbound_date) : '—')}</td>
          <td class="num col-group-out-end">${invUsageQtyCell(row.outbound_quantity)}</td>
          <td class="col-date col-group-in-start">${escapeHtml(row.inbound_date ? fmtDate(row.inbound_date) : '—')}</td>
          <td class="num">${invUsageQtyCell(row.inbound_quantity)}</td>
          <td class="num col-group-rec-start">${invUsageQtyCell(row.qty_empty_recovered)}</td>
          <td class="num">${invUsageQtyCell(row.qty_customer_keep)}</td>
          <td class="num">${invUsageQtyCell(row.qty_lost)}</td>
          <td class="num">${invUsageQtyCell(row.qty_damaged)}</td>
          <td class="num">${invUsageQtyCell(row.qty_consumed)}</td>
        </tr>`,
      )
      .join('');
    return `<section class="inv-item-detail-usage">
      <h4 class="inv-item-usage-head">${title}</h4>
      ${hint}
      <div class="inv-item-usage-table-scroll" tabindex="0" role="region" aria-label="关联场次明细列表">
        <table class="data-table inv-item-usage-table inv-item-usage-table--wine">
          ${invUsageTableColgroup(true)}
          <thead>
            <tr>
              <th class="col-project">项目编号</th>
              <th class="col-date" title="出库日期">出库日期</th>
              <th class="num col-group-out-end" title="出库数量">出库</th>
              <th class="col-date col-group-in-start" title="入库日期">入库日期</th>
              <th class="num" title="归还数量">归还</th>
              <th class="num col-group-rec-start" title="空瓶回收">空瓶</th>
              <th class="num" title="留给客户">留客</th>
              <th class="num" title="丢失">丢失</th>
              <th class="num" title="损坏">损坏</th>
              <th class="num" title="消耗">消耗</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
  }
  const body = rows
    .map(
      (row) => `<tr>
        ${invUsageProjectCell(row.project_code)}
        <td class="col-date">${escapeHtml(row.outbound_date ? fmtDate(row.outbound_date) : '—')}</td>
        <td class="num col-group-out-end">${invUsageQtyCell(row.outbound_quantity)}</td>
        <td class="col-date col-group-in-start">${escapeHtml(row.inbound_date ? fmtDate(row.inbound_date) : '—')}</td>
        <td class="num">${invUsageQtyCell(row.inbound_quantity)}</td>
      </tr>`,
    )
    .join('');
  return `<section class="inv-item-detail-usage">
    <h4 class="inv-item-usage-head">${title}</h4>
    <div class="inv-item-usage-table-scroll" tabindex="0" role="region" aria-label="关联场次明细列表">
      <table class="data-table inv-item-usage-table">
        ${invUsageTableColgroup(false)}
        <thead>
          <tr>
            <th class="col-project">项目编号</th>
            <th class="col-date">出库日期</th>
            <th class="num col-group-out-end">出库</th>
            <th class="col-date col-group-in-start">入库日期</th>
            <th class="num">入库</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </section>`;
}

function invBuildItemDetailMediaHtml(urls) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const main = list[0]
    ? `<img class="inv-item-detail-main-img" src="${escapeHtml(list[0])}" alt="">`
    : '<div class="inv-item-detail-main-img inv-item-detail-main-img--empty">暂无图片</div>';
  const thumbnails =
    list.length > 1
      ? `<div class="inv-item-detail-thumbs">${list
          .slice(1, 9)
          .map((url) => `<img src="${escapeHtml(url)}" alt="">`)
          .join('')}</div>`
      : '';
  return `${main}${thumbnails}`;
}

function invBuildItemDetailMetaHtml(item) {
  const wineValue = invItemIsWineTagged(item)
    ? `是 · ${escapeHtml(item.wine_label || item.name || '—')}`
    : '否';
  return `<dl class="inv-item-detail-meta">
    <div class="inv-item-detail-kv inv-item-detail-kv--name"><dt>名称</dt><dd>${escapeHtml(item.name || '—')}</dd></div>
    <div class="inv-item-detail-kv"><dt>规格</dt><dd>${escapeHtml(item.dimensions || '—')}</dd></div>
    <div class="inv-item-detail-kv"><dt>用酒</dt><dd>${wineValue}</dd></div>
    <div class="inv-item-detail-kv"><dt>库存</dt><dd><span class="${invStockClass(item)}">${escapeHtml(String(item.quantity_on_hand ?? 0))}</span></dd></div>
    <div class="inv-item-detail-kv"><dt>累计出库</dt><dd>${escapeHtml(String(invStatQty(item.total_outbound)))}</dd></div>
    <div class="inv-item-detail-kv"><dt>损坏/丢失</dt><dd>${escapeHtml(String(invStatQty(item.total_damaged)))} / ${escapeHtml(String(invStatQty(item.total_lost)))}</dd></div>
    <div class="inv-item-detail-kv inv-item-detail-kv--wide"><dt>备注</dt><dd>${escapeHtml(item.description || '—')}</dd></div>
  </dl>`;
}
