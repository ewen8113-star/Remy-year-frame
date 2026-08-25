async function reimbFetchPayeeInfoEntries(partyType) {
  if (partyType === 'company') {
    const rows = await api('GET', '/dict?category=supplier');
    return (Array.isArray(rows) ? rows : [])
      .filter((e) => e.is_active !== false && e.is_active !== 0)
      .map((e) => {
        const c = e.content || {};
        const name = String(c.company_name || e.name || '').trim();
        return {
          id: `supplier:${e.id}`,
          dictId: e.id,
          label: name,
          name,
          bank_name: String(c.bank_name || '').trim(),
          bank_account: String(c.bank_account || '').trim(),
          payment_method: 'bank_transfer',
          source: 'supplier',
        };
      })
      .filter((x) => x.name);
  }
  const [commonPayees, personalPayees, reimbursers, suppliers] = await Promise.all([
    api('GET', '/dict?category=payee'),
    api('GET', '/dict?category=personal_payee'),
    api('GET', '/dict?category=reimburser'),
    api('GET', '/dict?category=supplier'),
  ]);
  const supplierNames = reimbBuildSupplierNameSet(suppliers);
  const out = [];
  const seen = new Set();
  const push = (entry) => {
    const name = reimbNormalizePayeeName(entry.name);
    if (!name || seen.has(name) || reimbIsCompanyPayeeName(name, supplierNames)) return;
    seen.add(name);
    out.push({ ...entry, name, label: entry.label || name });
  };

  (Array.isArray(commonPayees) ? commonPayees : [])
    .filter((e) => e.is_active !== false && e.is_active !== 0)
    .forEach((e) => {
      const c = e.content || {};
      const name = reimbNormalizePayeeName(c.company_name || e.name);
      push({
        id: `payee:${e.id}`,
        dictId: e.id,
        name,
        bank_name: String(c.bank_name || '').trim(),
        bank_account: String(c.bank_account || '').trim(),
        payment_method: 'bank_transfer',
        source: 'payee',
      });
    });

  (Array.isArray(reimbursers) ? reimbursers : [])
    .filter((e) => e.is_active !== false && e.is_active !== 0)
    .forEach((e) => {
      const c = e.content || {};
      const name = reimbNormalizePayeeName(c.employee_name || e.name);
      const dept = String(c.department || '').trim();
      push({
        id: `reimburser:${e.id}`,
        dictId: e.id,
        name,
        label: dept ? `${name} · ${dept}` : name,
        bank_name: '',
        bank_account: String(c.bank_card || '').trim(),
        payment_method: '',
        source: 'reimburser',
      });
    });

  (Array.isArray(personalPayees) ? personalPayees : [])
    .filter((e) => e.is_active !== false && e.is_active !== 0)
    .forEach((e) => {
      const c = e.content || {};
      const name = reimbNormalizePayeeName(c.payee_name || e.name);
      push({
        id: `personal_payee:${e.id}`,
        dictId: e.id,
        name,
        bank_name: String(c.bank_name || '').trim(),
        bank_account: String(c.bank_account || '').trim(),
        payment_method: String(c.payment_method || '').trim(),
        source: 'personal_payee',
      });
    });

  return out;
}

function reimbRenderPayeeInfoOptions(entries, selectedName) {
  const sel = document.getElementById('reimbPayeeInfo');
  if (!sel) return;
  const want = String(selectedName || '').trim();
  const opts = ['<option value="">请选择</option>'];
  let matched = '';
  const party = document.getElementById('reimbPayeePartyType')?.value || 'personal';
  const appendOption = (e) => {
    const on = want && e.name === want;
    if (on) matched = e.id;
    opts.push(
      `<option value="${escapeHtml(e.id)}"${on ? ' selected' : ''}>${escapeHtml(e.label || e.name)}</option>`,
    );
  };
  if (party === 'personal') {
    const groups = [
      { source: 'payee', label: '常用收款人' },
      { source: 'reimburser', label: '公司成员' },
      { source: 'personal_payee', label: '历史收款人' },
    ];
    groups.forEach((g) => {
      const list = (entries || []).filter((e) => e.source === g.source);
      if (!list.length) return;
      opts.push(`<optgroup label="${escapeHtml(g.label)}">`);
      list.forEach(appendOption);
      opts.push('</optgroup>');
    });
  } else {
    (entries || []).forEach(appendOption);
  }
  if (want && !matched) {
    opts.push(`<option value="__custom__" selected>${escapeHtml(want)}（已保存）</option>`);
  }
  sel.innerHTML = opts.join('');
}

function reimbApplyPayeeInfoEntry(entry) {
  const nameEl = document.getElementById('reimbPayeeName');
  const methodEl = document.getElementById('reimbPaymentMethod');
  const bankEl = document.getElementById('reimbPayeeBankName');
  const acctEl = document.getElementById('reimbPayeeBankAccount');
  if (!entry) {
    if (nameEl) nameEl.value = '';
    reimbPaymentMethodChanged();
    return;
  }
  if (nameEl) nameEl.value = entry.name || '';
  if (methodEl && entry.payment_method) methodEl.value = entry.payment_method;
  if (bankEl && entry.bank_name) bankEl.value = entry.bank_name;
  if (acctEl && entry.bank_account) acctEl.value = entry.bank_account;
  reimbPaymentMethodChanged();
  if (entry.dictId) api('POST', `/dict/${entry.dictId}/touch`).catch(() => {});
}

function reimbPayeeInfoChanged() {
  const sel = document.getElementById('reimbPayeeInfo');
  const val = sel?.value || '';
  if (!val || val === '__custom__') {
    if (val === '__custom__') return;
    reimbApplyPayeeInfoEntry(null);
    return;
  }
  const hit = reimbPayeeInfoCache.find((e) => e.id === val);
  reimbApplyPayeeInfoEntry(hit || null);
}

async function reimbPayeePartyTypeChanged(preferredName) {
  const party = document.getElementById('reimbPayeePartyType')?.value || 'personal';
  const paymentTypeEl = document.getElementById('reimbPaymentType');
  if (paymentTypeEl) paymentTypeEl.value = reimbPaymentTypeFromPayeeParty(party);
  reimbRefreshClaimStatusOptions();
  const sel = document.getElementById('reimbPayeeInfo');
  if (sel) sel.innerHTML = '<option value="">加载中…</option>';
  try {
    reimbPayeeInfoCache = await reimbFetchPayeeInfoEntries(party);
    reimbRenderPayeeInfoOptions(
      reimbPayeeInfoCache,
      preferredName || document.getElementById('reimbPayeeName')?.value,
    );
    reimbPayeeInfoChanged();
  } catch (e) {
    if (sel) sel.innerHTML = '<option value="">加载失败</option>';
    showToast(e.message || '加载收款方信息失败', 'error');
  }
}

function reimbPaymentMethodChanged() {
  const method = document.getElementById('reimbPaymentMethod')?.value || '';
  const showBank = method === 'bank_transfer';
  const bankNameWrap = document.getElementById('reimbPayeeBankNameWrap');
  const bankAcctWrap = document.getElementById('reimbPayeeBankAccountWrap');
  if (bankNameWrap) bankNameWrap.style.display = showBank ? '' : 'none';
  if (bankAcctWrap) bankAcctWrap.style.display = showBank ? '' : 'none';
  if (!showBank) {
    reimbHidePayeeAccountPicker();
    return;
  }
  const party = document.getElementById('reimbPayeePartyType')?.value || 'personal';
  if (party === 'personal') reimbTryFillPayeeFromDict();
}

function reimbHidePayeeAccountPicker() {
  const wrap = document.getElementById('reimbPayeeAccountPickerWrap');
  const picker = document.getElementById('reimbPayeeAccountPicker');
  if (wrap) wrap.style.display = 'none';
  if (picker) picker.innerHTML = '';
}

function reimbFillPayeeBankFromDict(entry) {
  const c = entry?.content || {};
  const bank = document.getElementById('reimbPayeeBankName');
  const acct = document.getElementById('reimbPayeeBankAccount');
  if (bank && c.bank_name) bank.value = c.bank_name;
  if (acct && c.bank_account) acct.value = c.bank_account;
  reimbHidePayeeAccountPicker();
}

function reimbShowPayeeAccountPicker(entries) {
  const wrap = document.getElementById('reimbPayeeAccountPickerWrap');
  const picker = document.getElementById('reimbPayeeAccountPicker');
  if (!wrap || !picker) return;
  picker.innerHTML = entries
    .map((e) => {
      const c = e.content || {};
      const label = `${c.bank_name || '—'} · ${c.bank_account || ''}`;
      return `<button type="button" class="btn btn-secondary btn-sm reimb-payee-pick-btn" data-entry-id="${e.id}">${escapeHtml(label)}</button>`;
    })
    .join('');
  wrap.style.display = 'block';
  picker.querySelectorAll('.reimb-payee-pick-btn').forEach((btn) => {
    btn.onclick = () => {
      const id = Number(btn.dataset.entryId);
      const entry = entries.find((x) => Number(x.id) === id);
      if (entry) {
        reimbFillPayeeBankFromDict(entry);
        api('POST', `/dict/${entry.id}/touch`).catch(() => {});
      }
    };
  });
}

async function reimbTryFillPayeeFromDict() {
  const name = document.getElementById('reimbPayeeName')?.value?.trim();
  const method = document.getElementById('reimbPaymentMethod')?.value || '';
  if (!name || !method) {
    reimbHidePayeeAccountPicker();
    return;
  }
  if (method !== 'bank_transfer') {
    reimbHidePayeeAccountPicker();
    return;
  }
  try {
    const rows = await api('GET', `/dict?category=personal_payee&q=${encodeURIComponent(name)}`);
    const list = Array.isArray(rows) ? rows : [];
    const matches = list.filter((e) => {
      const c = e.content || {};
      const pn = String(c.payee_name || e.name || '').trim();
      return pn === name && String(c.payment_method || '') === method;
    });
    if (matches.length === 1) {
      reimbFillPayeeBankFromDict(matches[0]);
      api('POST', `/dict/${matches[0].id}/touch`).catch(() => {});
    } else if (matches.length > 1) {
      reimbShowPayeeAccountPicker(matches);
    } else {
      reimbHidePayeeAccountPicker();
    }
  } catch (_) {
    reimbHidePayeeAccountPicker();
  }
}
