async function reimbursementMergeRecordsByIds(ids) {
  const fullRecords = [];
  for (const id of ids) {
    const r = await api('GET', `/reimbursements/${id}`);
    fullRecords.push(r);
  }
  const allRows = [];
  let advanceTotal = 0;
  let useAdvance = false;
  const visibleRemarks = [];
  fullRecords.forEach((r) => {
    const meta = reimbReadDetailMeta(r.remarks || '');
    const pc = String(r.related_project_code || '').trim();
    const pcBrand = extractBrandFromProjectCode(pc);
    if (Array.isArray(meta.rows)) {
      meta.rows.forEach((row) => {
        if (!row) return;
        allRows.push({
          ...row,
          project_code: row.project_code || pc || '',
          brand: (!row.brand || row.brand === '内部') && pcBrand ? pcBrand : row.brand,
        });
      });
    }
    const adv = roundMoney2(meta.advance_amount);
    if (adv > 0) {
      useAdvance = true;
      advanceTotal = roundMoney2(advanceTotal + adv);
    }
    const visible = reimbVisibleRemarks(r.remarks || '').trim();
    if (visible) visibleRemarks.push(`#${r.id}：${visible}`);
  });
  if (!allRows.length) {
    throw new Error('选中记录没有可合并的费用明细');
  }

  const grossTotal = roundMoney2(allRows.reduce((s, row) => s + roundMoney2(row.subtotal), 0));
  const cost_details = reimbRowsToCostDetails(allRows, advanceTotal);
  if (calcCostDetailsTotal(cost_details) === 0) {
    throw new Error('合并后金额合计为 0，无法保存');
  }

  const dates = fullRecords.map((r) => String(r.date || '').slice(0, 10)).filter(Boolean).sort();
  const mergedDate = dates[0] || todayDateInputValue();
  const first = fullRecords[0] || {};
  const brand = reimbResolveRecordBrand(allRows, first.brand);
  const payment_type = first.payment_type || 'personal_reimbursement';
  const cost_module = first.cost_module || 'activity';
  const payee_name = String(first.payee_name || '').trim();
  const activityIds = [...new Set(fullRecords.map((r) => r.activity_id).filter((x) => x != null))];
  const projectCodes = [...new Set(fullRecords.map((r) => r.related_project_code).filter(Boolean))];
  const cities = [...new Set(fullRecords.map((r) => r.city).filter(Boolean))];
  const sameActivity = activityIds.length === 1;
  const samePc = projectCodes.length === 1;
  const sameCity = cities.length === 1;

  const invoices = allRows
    .filter((row) => row.invoice_no && row.invoice_date)
    .map((row) => ({
      invoice_content: row.description,
      invoice_no: row.invoice_no,
      invoice_date: row.invoice_date,
      invoice_kind: '普票',
    }));
  const has_invoice = invoices.length > 0;

  const userRemarksJoined = visibleRemarks.length
    ? `合并自 ${ids.map((x) => `#${x}`).join(' + ')}\n${visibleRemarks.join('\n')}`
    : `合并自 ${ids.map((x) => `#${x}`).join(' + ')}`;
  const mergeSources = fullRecords.map(reimbBuildMergeSourceSnapshot).filter(Boolean);
  const remarksWithMeta = reimbRemarksWithMeta(userRemarksJoined, {
    rows: allRows,
    use_advance: useAdvance,
    advance_amount: advanceTotal,
    gross_total: grossTotal,
    payment_date: '',
    merge_sources: mergeSources,
    merged_from_ids: [...ids].sort((a, b) => Number(a) - Number(b)),
    merged_at: new Date().toISOString(),
  });

  const body = {
    year_frame_id: currentYearFrameId,
    activity_id: sameActivity ? activityIds[0] : null,
    brand,
    date: mergedDate,
    payee_name,
    payment_status: 'unpaid',
    remarks: remarksWithMeta,
    payment_type,
    cost_module,
    claim_status: 'draft',
    has_invoice,
    invoices,
    cost_details,
    sync_to_activity: false,
    related_project_code: samePc ? projectCodes[0] : null,
    city: sameCity ? cities[0] : null,
  };

  const created = await api('POST', '/reimbursements', body);
  const newId = Number(created && created.id);
  if (!Number.isFinite(newId)) {
    throw new Error('合并后未返回新记录 ID');
  }

  let deleted = 0;
  const failures = [];
  for (const id of ids) {
    try {
      await api('DELETE', `/reimbursements/${id}`);
      deleted += 1;
    } catch (e) {
      failures.push(`#${id}: ${e.message || '删除失败'}`);
    }
  }
  if (failures.length) {
    throw new Error(`已新建合并记录 #${newId}，但以下原记录删除失败：\n${failures.join('\n')}\n请到列表手动删除。`);
  }
  return { newId, deleted };
}

function reimbursementBindStatsCardDelegation() {
  if (window._reimbStatsCardBound) return;
  window._reimbStatsCardBound = true;
  document.addEventListener('click', (e) => {
    const projRow = e.target.closest('[data-reimb-stats-project-row]');
    if (projRow && document.getElementById('reimbStatsBodyHost')) {
      const enc = projRow.getAttribute('data-reimb-stats-project-row');
      if (enc) reimbursementToggleStatsProjectCode(decodeURIComponent(enc));
      return;
    }
    const btn = e.target.closest('[data-reimb-stats-card]');
    if (!btn || !document.getElementById('reimbStatsBodyHost')) return;
    reimbursementSetStatsCard(btn.getAttribute('data-reimb-stats-card'));
  });
}

function reimbursementCostStatProjectCode(row) {
  return String(
    row?.related_project_code
    || row?.activity_project_code
    || row?.project_code
    || ''
  ).trim();
}

function reimbursementFiscalStartYear() {
  const yy = parseInt(String(currentYear || '').replace(/\D/g, ''), 10);
  return Number.isFinite(yy) ? (yy >= 100 ? yy : 2000 + yy) : new Date().getFullYear();
}

function reimbursementWarehouseMonthToYm(monthNum) {
  const m = parseInt(monthNum, 10);
  if (!Number.isFinite(m) || m < 1 || m > 12) return '';
  const fiscalY = reimbursementFiscalStartYear();
  const calYear = m >= 4 ? fiscalY : fiscalY + 1;
  return `${calYear}-${String(m).padStart(2, '0')}`;
}

function reimbursementNormalizeSettlementYm(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return '';
  const mo = parseInt(m[2], 10);
  if (!Number.isFinite(mo) || mo < 1 || mo > 12) return '';
  return `${m[1]}-${String(mo).padStart(2, '0')}`;
}

/** 费用归属月（1-12）→ YYYY-MM，按财年换算（4-12 属本财年，1-3 属次年） */
function reimbursementCostMonthToYm(costMonth) {
  const m = parseInt(costMonth, 10);
  if (!Number.isFinite(m) || m < 1 || m > 12) return '';
  const fiscalY = reimbursementFiscalStartYear();
  const calYear = m >= 4 ? fiscalY : fiscalY + 1;
  return `${calYear}-${String(m).padStart(2, '0')}`;
}

/** 成本登记：从明细行 cost_month 推导归属月（每行独立） */
function reimbursementCostStatExpenseMonthsFromReimb(r) {
  const meta = reimbReadDetailMeta(r.remarks);
  const detailRows = reimbResolveDetailRowsFromRecord(r, meta).filter((line) => roundMoney2(line.subtotal) > 0);
  const yms = new Set();
  detailRows.forEach((row) => {
    const ym = reimbursementCostMonthToYm(row.cost_month);
    if (ym) yms.add(ym);
  });
  if (!yms.size) {
    const dateStr = String(r.date || '').slice(0, 10);
    if (dateStr.length >= 7) yms.add(dateStr.slice(0, 7));
  }
  return [...yms];
}

function reimbursementCostStatResolveBrand(line, parent, projectCode) {
  const fromPc = extractBrandFromProjectCode(projectCode);
  const lineB = String(line?.brand || '').trim();
  if (lineB && lineB !== '内部') {
    const upper = lineB.toUpperCase();
    if (upper.includes('CLUB')) return 'CLUB';
    if (upper.includes('PHD')) return 'PHD';
    if (upper.includes('XO') || upper.includes('X.O')) return 'X.O';
    if (upper.includes('REMY')) return 'REMY';
    if (upper.includes('RC')) return 'RC';
    return lineB;
  }
  const parentB = String(parent?.brand || '').trim();
  if (parentB) return parentB;
  return fromPc || '';
}

function reimbursementCostStatLineRemarks(line) {
  const blockLabel = REIMB_DETAIL_BLOCKS.find((b) => b.value === line.block)?.label || line.block || '';
  const catLabel =
    (REIMB_DETAIL_CATEGORY_OPTIONS[line.block] || []).find(([v]) => v === line.category)?.[1] || line.category || '';
  return [blockLabel, catLabel, String(line.description || '').trim()].filter(Boolean).join(' · ');
}

/** 成本登记：按费用明细行拆分（每行独立金额 + 费用归属月） */
function reimbursementPushCostStatRowsFromReimbursement(r, push) {
  const pc = reimbursementCostStatProjectCode(r);
  const meta = reimbReadDetailMeta(r.remarks);
  const detailRows = reimbResolveDetailRowsFromRecord(r, meta).filter((line) => roundMoney2(line.subtotal) > 0);
  const base = {
    source_type: 'reimbursement',
    source_label: '成本登记',
    payee_name: String(r.payee_name || '').trim(),
    payment_status: r.payment_status || 'unpaid',
    project_code: pc,
    project_bucket: pc ? '有项目编号' : '无项目编号',
    city: String(r.city || '').trim(),
    module_label: reimbRecordCostAttributionLabel(r),
    party_label: reimbPayeePartyLabel(reimbPayeePartyFromPaymentType(r.payment_type || 'personal_reimbursement')),
    source_record_id: r.id,
  };

  if (detailRows.length) {
    detailRows.forEach((line, idx) => {
      const amt = roundMoney2(line.subtotal);
      if (amt <= 0) return;
      const ym = reimbursementCostMonthToYm(line.cost_month) || String(r.date || '').slice(0, 7);
      push({
        ...base,
        key: `reimbursement:${r.id}:line:${idx}`,
        amount: amt,
        brand: reimbursementCostStatResolveBrand(line, r, pc),
        line_description: String(line.description || '').trim(),
        remarks: reimbursementCostStatLineRemarks(line),
        expense_ym: ym,
        expense_yms: ym ? [ym] : [],
        cost_month: line.cost_month,
      });
    });
    return;
  }

  const dateYm = String(r.date || '').slice(0, 7);
  push({
    ...base,
    key: `reimbursement:${r.id}`,
    amount: roundMoney2(r.amount),
    brand: String(r.brand || '').trim() || extractBrandFromProjectCode(pc),
    remarks: reimbVisibleRemarks(r.remarks || ''),
    expense_ym: dateYm,
    expense_yms: dateYm ? [dateYm] : [],
  });
}
