async function renderCost() {
  const container = document.getElementById('pageContainer');

  try {
    await ensureBelongingLabelMap();
    let qsAct = '?isVirtual=0';
    if (currentYearFrameId) qsAct += `&yearFrameId=${currentYearFrameId}`;
    const activities = await api('GET', `/activities${qsAct}`);

    const isMarkedNoCost = (a) => {
      const v = a && a.no_cost;
      return v === true || v === 1 || String(v) === '1';
    };

    const actsWithCost = activities.filter((a) => !isMarkedNoCost(a) && parseFloat(a.total_cost) > 0);
    const actsPendingCost = activities.filter((a) => !isMarkedNoCost(a) && !(parseFloat(a.total_cost) > 0));
    const actsMarkedNoCost = activities.filter((a) => isMarkedNoCost(a));

    const pendingKeys = uniqueCostYmKeys(actsPendingCost);
    const withCostKeys = uniqueCostYmKeys(actsWithCost);
    const noCostKeys = uniqueCostYmKeys(actsMarkedNoCost);

    if (costPendingYMFilter !== 'all' && !pendingKeys.includes(costPendingYMFilter)) {
      costPendingYMFilter = 'all';
      localStorage.setItem('remy_costPendingYMFilter', 'all');
      localStorage.setItem('remy_costNoCostYMFilter', 'all');
    }
    if (costWithCostYMFilter !== 'all' && !withCostKeys.includes(costWithCostYMFilter)) {
      costWithCostYMFilter = 'all';
      localStorage.setItem('remy_costWithCostYMFilter', 'all');
    }
    if (costMarkedNoCostYMFilter !== 'all' && !noCostKeys.includes(costMarkedNoCostYMFilter)) {
      costMarkedNoCostYMFilter = 'all';
      localStorage.setItem('remy_costMarkedNoCostYMFilter', 'all');
    }

    const filteredActsPending = applyCostYmFilter(actsPendingCost, costPendingYMFilter);
    const filteredActsWithCost = applyCostYmFilter(actsWithCost, costWithCostYMFilter);
    const filteredActsMarkedNoCost = applyCostYmFilter(actsMarkedNoCost, costMarkedNoCostYMFilter);

    container.innerHTML = `
      <!-- 待填写成本 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div style="flex:1">
            <div class="card-title"><i data-lucide="hourglass" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>待填写成本（${filteredActsPending.length}场）</div>
            <div class="card-sub">
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                ${renderCostYmFilterButtons('pending', pendingKeys, costPendingYMFilter)}
              </div>
              <div style="margin-top:8px">成本以本场登记为准；数据看板按场次已登记成本与各板块公共池汇总，不与报销列表重复加计。</div>
              <div style="margin-top:6px;font-size:12px;color:var(--text-secondary)">无成本：点击行内 <strong>「无成本」</strong> 按钮，确认后移入「无成本场次」。</div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="toggleCostSection('pending')">展开/收起</button>
        </div>
        <div id="pendingCostTable" style="${costSectionCollapsed.pending ? 'display:none' : ''}">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>项目编号</th>
                  <th>区域</th>
                  <th>归属</th>
                  <th>品牌</th>
                  <th>类型</th>
                  <th>报价</th>
                  <th>成本</th>
                  <th style="min-width:84px;text-align:center;white-space:nowrap" title="标记本场无成本">无成本</th>
                </tr>
              </thead>
              <tbody>
                ${filteredActsPending.slice(0,30).map(a => `
                  <tr onclick="showCostDetailFromCost(${a.id})" style="cursor:pointer">
                    <td>${fmtDateShort(a.date||a.activity_date)}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.project_code||''}">${a.project_code||'—'}</td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${a.region||'—'}</span></td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(formatActivityBelongingForTable(a))}</span></td>
                    <td><span class="badge badge-${brandColor(a.brand)}">${a.brand||'—'}</span></td>
                    <td><span class="badge badge-${typeColor(a.activity_type)}">${a.activity_type||'—'}</span></td>
                    <td class="amount amount-revenue">${fmtMoney(a.quoted_price)}</td>
                    <td class="amount amount-neutral">—</td>
                    <td style="text-align:center" onclick="event.stopPropagation()">
                      <button type="button" class="cost-no-cost-pill" title="标记本场无成本" aria-label="标记本场活动无成本发生" onclick="openActivityNoCostConfirm(${a.id})">无成本</button>
                    </td>
                  </tr>
                `).join('')}
                ${filteredActsPending.length > 30 ? `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:10px">还有 ${filteredActsPending.length-30} 条，请在场次记录中查看</td></tr>` : ''}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 无成本活动 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div style="flex:1">
            <div class="card-title"><i data-lucide="circle-minus" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>无成本场次（${filteredActsMarkedNoCost.length}场）</div>
            <div class="card-sub">
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                ${renderCostYmFilterButtons('noCost', noCostKeys, costMarkedNoCostYMFilter)}
              </div>
              <div style="margin-top:8px">此类场次不计入“待填写成本”</div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="toggleCostSection('noCost')">展开/收起</button>
        </div>
        <div id="noCostTable" style="${costSectionCollapsed.noCost ? 'display:none' : ''}">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>项目编号</th>
                  <th>区域</th>
                  <th>归属</th>
                  <th>品牌</th>
                  <th>类型</th>
                  <th>报价</th>
                  <th>成本</th>
                </tr>
              </thead>
              <tbody>
                ${filteredActsMarkedNoCost.map(a => `
                  <tr onclick="showCostDetailFromCost(${a.id})" style="cursor:pointer">
                    <td>${fmtDateShort(a.date||a.activity_date)}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.project_code||''}">${a.project_code||'—'}</td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${a.region||'—'}</span></td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(formatActivityBelongingForTable(a))}</span></td>
                    <td><span class="badge badge-${brandColor(a.brand)}">${a.brand||'—'}</span></td>
                    <td><span class="badge badge-${typeColor(a.activity_type)}">${a.activity_type||'—'}</span></td>
                    <td class="amount amount-revenue">${fmtMoney(a.quoted_price)}</td>
                    <td class="amount amount-neutral">无成本</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 已填成本活动 -->
      <div class="card">
        <div class="card-header">
          <div style="flex:1">
            <div class="card-title"><i data-lucide="circle-check-big" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>已填成本（${filteredActsWithCost.length}场）</div>
            <div class="card-sub">
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                ${renderCostYmFilterButtons('withCost', withCostKeys, costWithCostYMFilter)}
              </div>
              <div style="margin-top:8px">同一场次可多次计入成本（如多笔报销、付款申请）；不同费用栏目分别记录，相同栏目金额累加。此类场次不再显示「无成本」按钮，避免误操作清空成本。</div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="toggleCostSection('withCost')">展开/收起</button>
        </div>
        <div id="withCostTable" style="${costSectionCollapsed.withCost ? 'display:none' : ''}">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>项目编号</th>
                <th>区域</th>
                <th>归属</th>
                <th>品牌</th>
                <th>类型</th>
                <th>报价</th>
                <th>成本</th>
                <th>利润</th>
                <th style="white-space:nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              ${filteredActsWithCost.map(a => {
                const profit = (parseFloat(a.quoted_price)||0) - (parseFloat(a.total_cost)||0);
                return `
                  <tr onclick="showCostDetailFromCost(${a.id})" style="cursor:pointer">
                    <td>${fmtDateShort(a.date||a.activity_date)}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.project_code||''}">${a.project_code||'—'}</td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${a.region||'—'}</span></td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(formatActivityBelongingForTable(a))}</span></td>
                    <td><span class="badge badge-${brandColor(a.brand)}">${a.brand||'—'}</span></td>
                    <td><span class="badge badge-${typeColor(a.activity_type)}">${a.activity_type||'—'}</span></td>
                    <td class="amount amount-revenue">${fmtMoney(a.quoted_price)}</td>
                    <td class="amount amount-cost">${fmtMoney(a.total_cost)}</td>
                    <td class="amount ${profit>=0?'amount-revenue':'amount-cost'}">${fmtMoney(profit)}</td>
                    <td style="white-space:nowrap" onclick="event.stopPropagation()">
                      <button type="button" class="btn btn-secondary btn-sm" onclick="showCostFillFromCost(${a.id})">编辑</button>
                      <button type="button" class="btn btn-danger btn-sm" onclick="clearActivityCostRegistration(${a.id})">删除</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        </div>
      </div>
    `;
    renderLucideIcons();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${err.message}</div></div>`;
    renderLucideIcons();
  }
}
