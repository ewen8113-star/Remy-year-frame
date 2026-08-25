function renderWineRecordTabs(activeTab = 'stockIn') {
  const host = document.getElementById('wineRecordTabs');
  if (!host) return;
  const cls = (tab) => (tab === activeTab ? 'btn btn-primary btn-xs' : 'btn btn-secondary btn-xs');
  host.innerHTML = `
    <button class="${cls('stockIn')}" onclick="loadWineRecords('stockIn')">入库记录</button>
    <button class="${cls('usage')}" onclick="loadWineRecords('usage')">用酒记录</button>
    <button class="${cls('returns')}" onclick="loadWineRecords('returns')">归还记录</button>
  `;
}

async function loadWineRecords(tab) {
  renderWineRecordTabs(tab || 'stockIn');
  const content = document.getElementById('wineRecordsContent');
  content.innerHTML = `<div style="color:var(--text-muted);padding:20px;text-align:center">加载中...</div>`;

  try {
    const qs = currentYearFrameId ? `?year_frame_id=${currentYearFrameId}` : '';
    const activityRows = await api('GET', `/activities${currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : ''}`);
    const activityCodeMap = new Map((activityRows || []).map((a) => [Number(a.id), String(a.project_code || '').trim()]));
    const activityRefHtml = (activityId) => {
      const idNum = Number(activityId || 0);
      if (!idNum) return '—';
      const code = activityCodeMap.get(idNum) || `#${idNum}`;
      return `<a href="#" onclick="event.preventDefault();showActivityDetail(${idNum})">${escapeHtml(code)}</a>`;
    };
    const records =
      tab === 'stockIn'
        ? await api('GET', `/wine/stock-in${qs}`)
        : tab === 'returns'
          ? await api('GET', `/wine/returns${qs}`)
          : await api('GET', `/wine/usage${qs}`);

    if (records.length === 0) {
      const typeLabel = tab === 'stockIn' ? '入库' : tab === 'returns' ? '归还' : '使用';
      content.innerHTML = `<div style="color:var(--text-muted);padding:30px;text-align:center">暂无${typeLabel}记录</div>`;
      return;
    }

    if (tab === 'stockIn') {
      content.innerHTML = `
        <table class="data-table">
          <thead><tr><th>日期</th><th>酒品</th><th>规格</th><th>数量</th><th>金额</th><th>供应商</th><th>操作</th></tr></thead>
          <tbody>
            ${records.slice(0, 50).map(r => `
              <tr>
                <td>${fmtDate(r.stock_in_date)}</td>
                <td>${r.wine_name}</td>
                <td>${r.spec}</td>
                <td style="color:var(--success);font-weight:600">+${r.quantity}</td>
                <td>${fmtMoney(r.total_amount)}</td>
                <td style="color:var(--text-muted)">${r.supplier || '—'}</td>
                <td><button class="btn btn-danger btn-sm" onclick="deleteWineStockIn(${r.id})" title="删除入库记录"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      renderLucideIcons();
    } else if (tab === 'usage') {
      content.innerHTML = `
        <table class="data-table">
          <thead><tr><th>日期</th><th>酒品</th><th>规格</th><th>数量</th><th>客户</th><th>关联活动</th><th>操作</th></tr></thead>
          <tbody>
            ${records.slice(0, 50).map(r => `
              <tr>
                <td>${fmtDate(r.usage_date)}</td>
                <td>${r.wine_name}</td>
                <td>${r.spec}</td>
                <td style="color:var(--danger);font-weight:600">-${r.quantity}</td>
                <td>${r.client_name || '—'}</td>
                <td>${activityRefHtml(r.activity_id)}</td>
                <td>
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-primary btn-sm" onclick="showWineUsageModal(${r.id})" title="归还入库">归还</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteWineUsage(${r.id})" title="删除"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      renderLucideIcons();
    } else {
      content.innerHTML = `
        <table class="data-table">
          <thead><tr><th>日期</th><th>酒品</th><th>规格</th><th>归还数量</th><th>关联活动</th><th>备注</th><th>操作</th></tr></thead>
          <tbody>
            ${records.slice(0, 50).map(r => `
              <tr>
                <td>${fmtDate(r.return_date)}</td>
                <td>${r.wine_name}</td>
                <td>${r.spec || '—'}</td>
                <td style="color:var(--success);font-weight:600">+${r.quantity}</td>
                <td>${activityRefHtml(r.activity_id)}</td>
                <td style="color:var(--text-muted)">${escapeHtml(r.remarks || '—')}</td>
                <td><button class="btn btn-danger btn-sm" onclick="deleteWineReturnLog(${r.id})" title="删除归还记录"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      renderLucideIcons();
    }
  } catch (err) {
    if (tab === 'returns' && String(err?.message || '').includes('404')) {
      content.innerHTML = `<div style="color:var(--warning);padding:20px">归还记录接口未生效（404）。请重启后端服务后重试。</div>`;
      return;
    }
    content.innerHTML = `<div style="color:var(--danger);padding:20px">加载失败: ${err.message}</div>`;
  }
}

// 显示酒品入库弹窗
async function showWineStockInModal() {
  const content = document.getElementById('wineStockInContent');
  content.innerHTML = `<div style="color:var(--text-muted);padding:10px">加载中...</div>`;
  openModal('modalWineStockIn');

  try {
    const wines = await api('GET', '/wine/catalog');
    content.innerHTML = `
      <form id="wineStockInForm" style="display:flex;flex-direction:column;gap:12px">
        <div class="form-hint" style="margin:0 0 8px">以下入库仍写入<strong>旧全局库存表</strong>（wine_inventory），与「目录」并行；分仓库存上线后将切换为按仓入库。</div>
        <div class="form-group">
          <label class="form-label">酒品（目录）<span class="required">*</span></label>
          <select class="form-control" id="wineSel" required>
            <option value="">请选择酒品</option>
            ${wines
              .map((w) => {
                const code = `cat_${w.id}`;
                const spec = wineCatalogSpecLine(w);
                const label = `${w.brand ? `${w.brand} · ` : ''}${w.name}（${spec}）`;
                return `<option value="${code}" data-name="${escapeHtml(w.name)}" data-spec="${escapeHtml(spec)}">${escapeHtml(label)}</option>`;
              })
              .join('')}
          </select>
        </div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="form-group">
            <label class="form-label">入库数量（瓶）<span class="required">*</span></label>
            <input type="number" class="form-control" id="wineQty" min="1" value="1" required>
          </div>
          <div class="form-group">
            <label class="form-label">入库日期 <span class="required">*</span></label>
            <input type="date" class="form-control" id="wineDate" value="${todayDateInputValue()}" required>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">供应商</label>
          <select class="form-control" id="wineSupplier">
            <option value="">请选择</option>
            <option value="东区">东区</option>
            <option value="南区">南区</option>
            <option value="东南区">东南区</option>
            <option value="总部培训">总部培训</option>
            <option value="其他">其他</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">备注</label>
          <input type="text" class="form-control" id="wineRemarks" placeholder="批次号/备注...">
        </div>
        <div style="padding:10px;background:var(--bg-primary);border-radius:var(--radius-sm);font-size:13px;color:var(--text-muted)">
          <i data-lucide="lightbulb" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"></i>入库后将自动更新酒品库存
        </div>
      </form>
    `;
    renderLucideIcons();
  } catch (err) {
    content.innerHTML = `<div style="color:var(--danger)">加载失败: ${err.message}</div>`;
  }
}

async function confirmWineStockIn() {
  const sel = document.getElementById('wineSel');
  const opt = sel.options[sel.selectedIndex];
  if (!sel.value) { showToast('请选择酒品', 'error'); return; }

  const body = {
    year_frame_id: currentYearFrameId,
    wine_code: sel.value,
    wine_name: opt.dataset.name,
    spec: opt.dataset.spec,
    quantity: parseInt(document.getElementById('wineQty').value) || 0,
    stock_in_date: document.getElementById('wineDate').value,
    supplier: document.getElementById('wineSupplier').value,
    remarks: document.getElementById('wineRemarks').value,
  };

  if (!body.stock_in_date || !body.quantity) { showToast('请填写必填项', 'error'); return; }

  try {
    await api('POST', '/wine/stock-in', body);
    closeModal();
    showToast('入库成功', 'success');
    if (document.getElementById('wineCatalogListHost')) await loadWineCatalogPage();
    updateBadges();
  } catch (err) {
    showToast('入库失败: ' + err.message, 'error');
  }
}

let wineReturnDialogState = {
  usageRows: [],
  projectRows: [],
  projectToUsages: new Map(),
  projectCodeToActivityId: new Map(),
};

function renderWineReturnProjectOptions() {
  const dl = document.getElementById('wineReturnProjectList');
  if (!dl) return;
  const rows = (wineReturnDialogState.projectRows || []);
  dl.innerHTML = rows
    .map((p) => `<option value="${escapeHtml(p.project_code || `#${p.activity_id}`)}"></option>`)
    .join('');
}

function renderWineReturnUsageOptions() {
  const projectInput = document.getElementById('wineReturnProject');
  const usageSel = document.getElementById('wineUseSel');
  const maxText = document.getElementById('wineUseWarning');
  if (!projectInput || !usageSel || !maxText) return;
  const projectCode = String(projectInput.value || '').trim();
  const actId = Number(wineReturnDialogState.projectCodeToActivityId.get(projectCode) || 0);
  const rows = actId ? (wineReturnDialogState.projectToUsages.get(actId) || []) : [];
  usageSel.innerHTML = `<option value="">请选择酒品</option>` + rows
    .map((r) => `<option value="${r.id}" data-max="${r.quantity || 0}" data-wine="${escapeHtml(r.wine_name || '')}">${escapeHtml(r.wine_name || '—')} ${escapeHtml(r.spec || '')}（可归还: ${r.quantity || 0} 瓶）</option>`)
    .join('');
  if (projectCode && !actId) {
    maxText.style.display = 'block';
    maxText.textContent = '项目编号无效，请从下拉建议中选择';
    return;
  }
  maxText.style.display = 'none';
}

function updateWineReturnLimit() {
  const usageSel = document.getElementById('wineUseSel');
  const qtyInput = document.getElementById('wineUseQty');
  const maxText = document.getElementById('wineUseWarning');
  if (!usageSel || !qtyInput || !maxText) return;
  const opt = usageSel.options[usageSel.selectedIndex];
  if (!opt || !opt.value) {
    maxText.style.display = 'none';
    return;
  }
  const max = parseInt(opt.dataset.max || '0', 10) || 0;
  qtyInput.max = String(max || 1);
  if (!qtyInput.value || Number(qtyInput.value) > max) qtyInput.value = String(max || 1);
  maxText.style.display = 'block';
  maxText.textContent = `当前酒品最多可归还 ${max} 瓶`;
}

// 显示酒品归还弹窗（项目编号输入 + datalist 建议）
