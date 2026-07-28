function invCaptureOutboundDraft() {
  if (!document.getElementById('invLinkMode')) return;
  const g = (id) => document.getElementById(id);
  const of = inventoryPageState.outboundForm;
  of.linkMode = g('invLinkMode')?.value || of.linkMode || 'activity';
  of.project_code = g('invProjectCode')?.value ?? '';
  of.purpose = g('invPurpose')?.value ?? '';
  of.activity_id = g('invActivityId')?.value ?? '';
  of.shipped_at = g('invObShipDate')?.value ?? '';
  of.activity_date = g('invObActivityDate')?.value ?? '';
  of.recipient_city = g('invRecvCity')?.value ?? '';
  of.recipient_address = g('invRecvAddr')?.value ?? '';
  of.contact_name = g('invContactName')?.value ?? '';
  of.contact_phone = g('invContactPhone')?.value ?? '';
  of.logistics_supplier = g('invLogisticsSupplier')?.value?.trim() ?? '';
  of.logistics_method = g('invLogistics')?.value || of.logistics_method || INV_LOGISTICS_OPTS[0];
  of.tracking_number = g('invTrackingNo')?.value ?? '';
  of.remarks = g('invObRemarks')?.value ?? '';
  of.hint_msg = g('invHintMsg')?.textContent ?? '';
  inventoryPageState.linkMode = of.linkMode;
}

function invEnsureTabForPage(invPage) {
  if (invPage === 'master') {
    inventoryPageState.tab = 'items';
  } else if (invPage === 'outbound') {
    inventoryPageState.tab = 'outbound';
  } else if (invPage === 'inbound') {
    inventoryPageState.tab = 'returns';
  }
}

async function invFillInvProjectDatalist() {
  if (!currentYearFrameId) return;
  try {
    const actList = await api('GET', `/activities?yearFrameId=${currentYearFrameId}&isVirtual=0`);
    invSetOutboundProjectOptions(actList);
  } catch (_) { /* ignore */ }
}

function invSetOutboundProjectOptions(actList) {
  const seen = new Set();
  const vals = Array.isArray(actList)
    ? actList
      .map((a) => String(a && a.project_code ? a.project_code : '').trim())
      .filter((v) => {
        if (!v || seen.has(v)) return false;
        seen.add(v);
        return true;
      })
    : [];
  inventoryPageState.outboundProjectOptions = vals;
  invRenderProjectSuggestionList(document.getElementById('invProjectCode')?.value || '');
}

function invRenderProjectSuggestionList(keyword) {
  const menu = document.getElementById('invProjectMenu');
  if (!menu) return;
  const q = String(keyword || '').trim().toLowerCase();
  const all = Array.isArray(inventoryPageState.outboundProjectOptions) ? inventoryPageState.outboundProjectOptions : [];
  const list = q ? all.filter((v) => v.toLowerCase().includes(q)) : all;
  const shown = list.slice(0, 80);
  if (!shown.length) {
    menu.innerHTML = '<div class="inv-project-menu-empty">无匹配项目编号</div>';
    return;
  }
  menu.innerHTML = shown
    .map((v) => `<button type="button" class="inv-project-option" data-value="${escapeHtml(v)}" onclick="invPickProjectSuggestionFromBtn(this)">${escapeHtml(v)}</button>`)
    .join('');
}

function invOpenProjectSuggestionList() {
  const menu = document.getElementById('invProjectMenu');
  if (!menu) return;
  if (!inventoryPageState.outboundProjectMenuBound) {
    document.addEventListener('click', (evt) => {
      const target = evt && evt.target;
      if (!target) return;
      const wrap = document.querySelector('.inv-project-combobox');
      if (!wrap) return;
      if (!wrap.contains(target)) invCloseProjectSuggestionList();
    });
    inventoryPageState.outboundProjectMenuBound = true;
  }
  invRenderProjectSuggestionList(document.getElementById('invProjectCode')?.value || '');
  menu.style.display = 'block';
}

function invCloseProjectSuggestionList() {
  const menu = document.getElementById('invProjectMenu');
  if (menu) menu.style.display = 'none';
}

function invToggleProjectSuggestionList() {
  const menu = document.getElementById('invProjectMenu');
  if (!menu) return;
  if (menu.style.display === 'block') invCloseProjectSuggestionList();
  else invOpenProjectSuggestionList();
}

function invOnProjectInput(value) {
  invOpenProjectSuggestionList();
  invRenderProjectSuggestionList(value);
}

function invOnProjectInputBlur() {
  // Delay close slightly so clicking suggestion options still works.
  window.setTimeout(() => {
    const wrap = document.querySelector('.inv-project-combobox');
    const active = document.activeElement;
    if (!wrap || !active || !wrap.contains(active)) invCloseProjectSuggestionList();
  }, 120);
}

function invHandleProjectInputKeydown(e) {
  if (!e) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    invCloseProjectSuggestionList();
    return;
  }
  if (e.key === 'Enter') {
    const first = document.querySelector('#invProjectMenu .inv-project-option');
    if (first) {
      e.preventDefault();
      first.click();
    }
  }
}

function invPickProjectSuggestionFromBtn(btn) {
  const val = btn ? String(btn.getAttribute('data-value') || '').trim() : '';
  const input = document.getElementById('invProjectCode');
  if (!input) return;
  input.value = val;
  inventoryPageState.outboundForm.project_code = val;
  invCloseProjectSuggestionList();
  void invApplyProjectHint();
}

function invSeedOutboundItemMetaFromItems(warehouseId, items) {
  const whNum = Number(warehouseId || 0);
  if (!whNum || !Array.isArray(items)) return;
  inventoryPageState.outboundItemMetaByWarehouse[whNum] =
    inventoryPageState.outboundItemMetaByWarehouse[whNum] || {};
  items.forEach((it) => {
    if (!it || it.id == null) return;
    const key = String(it.id);
    const prev = inventoryPageState.outboundItemMetaByWarehouse[whNum][key] || {};
    inventoryPageState.outboundItemMetaByWarehouse[whNum][key] = {
      name: String(it.name || '').trim() || prev.name || '',
      dimensions: String(it.dimensions || '').trim() || prev.dimensions || '',
    };
  });
}

function invBuildOutboundLineMetaFromDetailLines(lines, fallbackWhId) {
  const map = {};
  (lines || []).forEach((ln) => {
    const whNum = Number(ln.inv_warehouse_id || fallbackWhId || 0);
    const itemId = ln.item_id;
    if (!Number.isFinite(whNum) || itemId == null) return;
    const key = String(itemId);
    map[whNum] = map[whNum] || {};
    map[whNum][key] = {
      name: String(ln.item_name || '').trim(),
      dimensions: String(ln.item_dimensions || '').trim(),
    };
  });
  return map;
}

function invApplyOutboundEditLineMeta() {
  const bundle = inventoryPageState.outboundEditLineMeta;
  if (!bundle || typeof bundle !== 'object') return;
  Object.keys(bundle).forEach((whK) => {
    const whNum = Number(whK);
    if (!Number.isFinite(whNum)) return;
    inventoryPageState.outboundItemMetaByWarehouse[whNum] =
      inventoryPageState.outboundItemMetaByWarehouse[whNum] || {};
    const items = bundle[whK] || {};
    Object.keys(items).forEach((itemK) => {
      const m = items[itemK] || {};
      const prev = inventoryPageState.outboundItemMetaByWarehouse[whNum][itemK] || {};
      inventoryPageState.outboundItemMetaByWarehouse[whNum][itemK] = {
        name: String(m.name || '').trim() || prev.name || '',
        dimensions: String(m.dimensions || '').trim() || prev.dimensions || '',
      };
    });
  });
}

function invSetOutboundListFilter(mode) {
  if (mode !== 'common' && mode !== 'uncommon') return;
  invSaveCurrentWarehouseDraftFromModal();
  inventoryPageState.outboundListFilter = mode;
  const b1 = document.getElementById('invObFilterCommon');
  const b2 = document.getElementById('invObFilterUncommon');
  if (b1) {
    b1.classList.toggle('btn-primary', mode === 'common');
    b1.classList.toggle('btn-secondary', mode !== 'common');
  }
  if (b2) {
    b2.classList.toggle('btn-primary', mode === 'uncommon');
    b2.classList.toggle('btn-secondary', mode !== 'uncommon');
  }
  void invRefreshOutboundModalLineTables();
}
