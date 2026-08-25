function toggleLookupAddForm() {
  const f = document.getElementById('lookupAddForm');
  if (!f) return;
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function confirmAddLookupOption() {
  const category = _lookupEditCategory;
  const value = document.getElementById('lookupNewValue')?.value?.trim();
  const label = document.getElementById('lookupNewLabel')?.value?.trim();
  const sort_order = parseInt(document.getElementById('lookupNewSort')?.value, 10) || 0;
  if (!value || !label) {
    showToast('请填写存储值与显示名称', 'warning');
    return;
  }
  try {
    await api('POST', '/lookups', { category, value, label, sort_order });
    showToast('已新增', 'success');
    const form = document.getElementById('lookupAddForm');
    if (form) form.style.display = 'none';
    await renderLookupEditor(category);
    await refreshActivityLookupsBehindLookupModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveLookupOptionRow(id) {
  const category = _lookupEditCategory;
  const labelInp = document.querySelector(`.lookup-edit-label[data-id="${id}"]`);
  const sortInp = document.querySelector(`.lookup-edit-sort[data-id="${id}"]`);
  try {
    await api('PUT', `/lookups/${id}`, {
      label: labelInp?.value?.trim(),
      sort_order: parseInt(sortInp?.value, 10) || 0,
    });
    showToast('已保存', 'success');
    await renderLookupEditor(category);
    await refreshActivityLookupsBehindLookupModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deactivateLookupOption(id) {
  try {
    await api('DELETE', `/lookups/${id}`);
    showToast('已停用', 'success');
    await renderLookupEditor(_lookupEditCategory);
    await refreshActivityLookupsBehindLookupModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function reactivateLookupOption(id) {
  try {
    await api('PUT', `/lookups/${id}`, { is_active: 1 });
    await renderLookupEditor(_lookupEditCategory);
    await refreshActivityLookupsBehindLookupModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 打开新建/编辑弹窗；opts.virtual 为 true 时为虚拟场次（精简字段、默认东南区）
async function showActivityModal(id = null, opts = {}) {
  const modEl = document.getElementById('modalActivity');
  const leadEl = document.getElementById('modalActivityLead');
  const virtHidden = document.getElementById('actIsVirtual');
  if (virtHidden) virtHidden.value = '0';
  if (modEl) modEl.classList.remove('modal-activity--virtual');

  document.getElementById('modalActivityTitle').textContent = id ? '编辑活动' : '新建活动';
  if (leadEl && !id) {
    leadEl.innerHTML =
      '请填写场次信息；标注 <span class="required">*</span> 为必填。保存后可在场次记录中查看与筛选。';
  }

  document.getElementById('actId').value = id || '';

  let a = null;
  if (id) {
    try {
      a = await api('GET', `/activities/${id}`);
    } catch (err) {
      showToast('加载活动数据失败', 'error');
      return;
    }
  }

  let isVirtualModal = !!(opts && opts.virtual);
  if (a && (Number(a.is_virtual) === 1 || a.is_virtual === true)) {
    isVirtualModal = true;
  }

  const lookupSnap = a
    ? {
        actYearFrameCode: a.year_frame_code || '',
        actActivityType: a.activity_type || '',
        actPeriod: a.period || '日常',
        actRegion: a.region != null && a.region !== undefined ? a.region : '',
        actBelonging: displayActivityBelongingValue(a),
        actExecutor: a.executor != null && String(a.executor).trim() !== '' ? a.executor : '无',
        actBrandAmbassador: a.brand_ambassador || '',
        actStatus: a.status || 'pending',
      }
    : {};

  try {
    await fillActivityLookupSelects(lookupSnap);
  } catch (err) {
    const detail = err && err.message ? String(err.message) : String(err);
    showToast(
      `加载下拉选项失败：${detail}。若已执行迁移，请重启后端（结束旧 node 进程后重新 npm start），再硬刷新页面。`,
      'error'
    );
    console.error(err);
  }

  ['actCity', 'actBrandField', 'actDate', 'actClient', 'actVenue', 'actQuotedPrice', 'actGuestCount', 'actProjectCode', 'actRemarks', 'actCloudAlbumUrl', 'actBrandAmbassador'].forEach((fid) => {
    const el = document.getElementById(fid);
    if (el) el.value = '';
  });

  if (a) {
    document.getElementById('actCity').value = a.city || '';
    document.getElementById('actBrandField').value = a.brand || 'PHD';
    if (a.date || a.activity_date) {
      document.getElementById('actDate').value = toDateInputValue(a.date || a.activity_date);
    }
    document.getElementById('actClient').value = a.client || a.client_name || '';
    document.getElementById('actVenue').value = a.venue || '';
    document.getElementById('actQuotedPrice').value =
      a.quoted_price != null && a.quoted_price !== '' ? roundMoney2(a.quoted_price).toFixed(2) : '';
    document.getElementById('actGuestCount').value = a.guest_count || '';
    document.getElementById('actProjectCode').value = a.project_code || '';
    document.getElementById('actRemarks').value = a.remarks || '';
    document.getElementById('actCloudAlbumUrl').value = a.cloud_album_url || '';
    document.getElementById('actBrandAmbassador').value = a.brand_ambassador || '';
  } else {
    applyNewActivityLookupDefaults();
    document.getElementById('actBrandField').value = 'PHD';
    document.getElementById('actBrandAmbassador').value = '';
    genProjectCode();
  }

  syncActivityBrandFromYearFrameCode();

  if (isVirtualModal) {
    if (virtHidden) virtHidden.value = '1';
    if (modEl) modEl.classList.add('modal-activity--virtual');
    document.getElementById('modalActivityTitle').textContent = id ? '编辑虚拟场次' : '新建虚拟场次';
    if (leadEl) {
      leadEl.innerHTML =
        '<strong>虚拟场次</strong>用于报价预估与<strong>预存费用</strong>统计，<strong>不会出现在排期日历</strong>。当前业务为<strong>东南区</strong>客户；通过不同<strong>年框编号</strong>区分品牌条线（可多品牌）。';
    }
    const regEl = document.getElementById('actRegion');
    if (!id && regEl && [...regEl.options].some((o) => o.value === '东南区')) {
      regEl.value = '东南区';
    }
    const cityEl = document.getElementById('actCity');
    if (cityEl) cityEl.removeAttribute('required');
    const dateEl = document.getElementById('actDate');
    if (dateEl) dateEl.removeAttribute('required');
  } else {
    const cityEl = document.getElementById('actCity');
    if (cityEl) cityEl.setAttribute('required', 'required');
    const dateEl = document.getElementById('actDate');
    if (dateEl) dateEl.setAttribute('required', 'required');
  }

  openModal('modalActivity');
}

function showVirtualActivityModal(editId = null) {
  return showActivityModal(editId, { virtual: true });
}

function toggleWineSection() {
  const area = document.getElementById('wineSelectionArea');
  const icon = document.getElementById('wineToggleIcon');
  if (area.style.display === 'none') {
    area.style.display = 'block';
    icon.textContent = '▲';
  } else {
    area.style.display = 'none';
    icon.textContent = '▼';
  }
}

function wineCatalogSpecLine(c) {
  const parts = [c.category, c.volume_label].filter((x) => String(x || '').trim());
  return parts.length ? parts.join(' · ') : '—';
}

async function loadWineInventoryForForm() {
  try {
    const catalog = await api('GET', '/wine/catalog');
    const tbody = document.getElementById('wineSelectBody');
    if (!tbody) return;

    const specLine = (c) => wineCatalogSpecLine(c);
    tbody.innerHTML = catalog
      .map((c) => {
        const code = `cat_${c.id}`;
        const spec = specLine(c);
        return `
      <tr>
        <td>${escapeHtml(c.brand || '—')}</td>
        <td style="font-weight:500">${escapeHtml(c.name)}</td>
        <td style="color:var(--text-secondary)">${escapeHtml(spec)}</td>
        <td><input type="number" class="wine-qty-input" data-wine-code="${code}" data-wine-name="${escapeHtml(c.name)}" data-spec="${escapeHtml(spec)}" value="0" min="0" placeholder="0" style="width:70px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;text-align:right"></td>
      </tr>`;
      })
      .join('');

    document.getElementById('wineInventoryLoading').style.display = 'none';
    document.getElementById('wineSelectTable').style.display = 'table';

    // 如果是编辑模式，加载已有用酒数据
    const actId = document.getElementById('actId').value;
    if (actId) {
      const act = await api('GET', `/activities/${actId}`);
      const wineDetails = parseWineDetails(act.wine_details);
      Object.entries(wineDetails).forEach(([key, val]) => {
        if (val && val.qty > 0) {
          const input = tbody.querySelector(`[data-wine-code="${key}"]`);
          if (input) input.value = val.qty;
        }
      });
    }
  } catch (err) {
    document.getElementById('wineInventoryLoading').textContent = '加载失败，请重试';
    console.error('加载酒品库存失败:', err);
  }
}

// 收集表单中的用酒数据
function collectWineDetails() {
  const details = {};
  document.querySelectorAll('.wine-qty-input').forEach(input => {
    const qty = parseInt(input.value) || 0;
    if (qty > 0) {
      details[input.dataset.wineCode] = {
        wine_name: input.dataset.wineName,
        spec: input.dataset.spec,
        qty: qty
      };
    }
  });
  return details;
}
