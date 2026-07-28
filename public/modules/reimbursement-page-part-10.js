const REIMB_PRINT_COL_META = {
  idx: { header: '序号', th: 'sr-th-tight', td: 'sr-c sr-td-tight' },
  project: { header: '项目编号', th: 'sr-th-project', td: 'sr-project-code' },
  block: { header: '板块', th: 'sr-th-text', td: 'sr-wrap sr-td-text' },
  category: { header: '类别', th: 'sr-th-text', td: 'sr-wrap sr-td-text' },
  description: { header: '内容说明', th: 'sr-th-desc', td: 'sr-wrap sr-td-desc' },
  amount: { header: '报销金额含税', th: 'sr-th-money', td: 'sr-c sr-td-money' },
  cost_month: { header: '费用归属', th: 'sr-th-tight', td: 'sr-c sr-td-tight' },
  invoice: { header: '发票', th: 'sr-th-tight', td: 'sr-c sr-td-tight' },
  invoice_date: { header: '发票日期', th: 'sr-th-tight', td: 'sr-c sr-td-tight' },
  invoice_no: { header: '发票号码', th: 'sr-th-invno', td: 'sr-invoice-no' },
  payee: { header: '收款方信息', th: 'sr-th-text', td: 'sr-wrap sr-td-text' },
  status: { header: '报销状态', th: 'sr-th-text', td: 'sr-c sr-td-text' },
  remarks: { header: '备注', th: 'sr-th-desc', td: 'sr-remarks sr-td-desc' },
};

function reimbPrintResolveLineProject(row, ctx) {
  if (!row) return '';
  const rowPc = String(row.project_code || row.line_project || '').trim();
  if (rowPc && !reimbIsPlaceholderProjectCode(rowPc)) return rowPc;
  const rowBrand = String(row.brand || '').trim();
  const { projectBase, brand } = ctx;
  if (projectBase && !reimbIsPlaceholderProjectCode(projectBase)) return projectBase;
  return (
    (REIMB_DETAIL_BRAND_OPTIONS.includes(rowBrand) ? rowBrand : '')
    || reimbBrandYearFrameCodeForPdf(brand)
    || (rowBrand && rowBrand !== '内部' ? rowBrand : '')
    || '—'
  );
}

/** 扫描明细：无内容的可选列自动隐藏，把宽度让给项目编号等长字段 */
function reimbPrintBuildColumnPlan(detailRows, ctx) {
  const rows = (detailRows || []).filter(Boolean);
  const any = (fn) => rows.some(fn);
  const plan = ['idx', 'project', 'block', 'category'];
  if (any((r) => String(r.description || '').trim())) plan.push('description');
  plan.push('amount', 'cost_month', 'invoice');
  if (any((r) => r.invoice_date && String(r.invoice_date).trim())) plan.push('invoice_date');
  if (any((r) => r.invoice_no && String(r.invoice_no).trim())) plan.push('invoice_no');
  plan.push('payee', 'status');
  if (any((r) => String(r.remarks || '').trim())) plan.push('remarks');
  return plan;
}

/** 成本登记列表：项目编号展示（合并单无顶层编号时从快照汇总） */
function reimbListProjectCodeDisplay(r) {
  const pc = String(r?.related_project_code || '').trim();
  if (pc) return { text: pc, title: pc };
  const meta = reimbReadDetailMeta(r?.remarks || '');
  const sources = Array.isArray(meta.merge_sources) ? meta.merge_sources : [];
  const codes = [...new Set(sources.map((s) => String(s.related_project_code || '').trim()).filter(Boolean))];
  if (codes.length === 1) return { text: codes[0], title: codes[0] };
  if (codes.length > 1) return { text: `${codes.length} 个场次`, title: codes.join('\n') };
  return { text: '—', title: '' };
}

function reimbPrintPayeeInfoHtml(p) {
  const name = String(p?.payee_name || '').trim();
  if (!name || name === '—') return '';
  const party = reimbPayeePartyLabel(reimbPayeePartyFromPaymentType(p.payment_type));
  const method = String(p?.payment_method || '').trim();
  const bank = String(p?.payee_bank_name || '').trim();
  const acct = String(p?.payee_bank_account || '').trim();
  const title = p.payment_type === 'corporate_payment' ? '对公收款信息' : '个人收款信息';
  const parts = [
    `个人/公司：${escapeHtml(party)}`,
    `收款方信息：${escapeHtml(name)}`,
    `开户行：${escapeHtml(bank || '—')}`,
    `银行账号：${escapeHtml(acct || '—')}`,
  ];
  if (method && method !== 'bank_transfer') {
    parts.push(`付款方式：${escapeHtml(reimbPaymentMethodLabel(method))}`);
  }
  return `<div class="sr-payee-info"><strong>${title}：</strong>${parts.join('　')}</div>`;
}

/** 打印前：记录未存银行信息时，从字典补全 */
async function reimbEnrichPayloadPayeeFromDict(p) {
  if (!p || !String(p.payee_name || '').trim()) return p;
  const hasBank = String(p.payee_bank_name || '').trim() || String(p.payee_bank_account || '').trim();
  if (hasBank) return p;
  const name = String(p.payee_name).trim();
  try {
    if (p.payment_type === 'corporate_payment') {
      const rows = await api('GET', `/dict?category=supplier&q=${encodeURIComponent(name)}`);
      const list = Array.isArray(rows) ? rows : [];
      const hit = list.find((e) => {
        const c = e.content || {};
        return String(c.company_name || e.name || '').trim() === name;
      });
      if (!hit) return p;
      const c = hit.content || {};
      return {
        ...p,
        payment_method: p.payment_method || 'bank_transfer',
        payee_bank_name: p.payee_bank_name || c.bank_name || null,
        payee_bank_account: p.payee_bank_account || c.bank_account || null,
      };
    }
    const rows = await api('GET', `/dict?category=personal_payee&q=${encodeURIComponent(name)}`);
    const list = Array.isArray(rows) ? rows : [];
    const matches = list.filter((e) => {
      const c = e.content || {};
      return String(c.payee_name || e.name || '').trim() === name;
    });
    let hit =
      matches.find((m) => {
        const c = m.content || {};
        return c.payment_method === 'bank_transfer' && String(c.bank_account || '').trim();
      }) || matches[0];
    if (!hit) {
      const reimbRows = await api('GET', `/dict?category=reimburser&q=${encodeURIComponent(name)}`);
      const rlist = Array.isArray(reimbRows) ? reimbRows : [];
      hit = rlist.find((e) => {
        const c = e.content || {};
        return String(c.employee_name || e.name || '').trim() === name;
      });
      if (hit) {
        const c = hit.content || {};
        return {
          ...p,
          payment_method: p.payment_method || null,
          payee_bank_name: p.payee_bank_name || null,
          payee_bank_account: p.payee_bank_account || c.bank_card || null,
        };
      }
      return p;
    }
    const c = hit.content || {};
    return {
      ...p,
      payment_method: p.payment_method || c.payment_method || null,
      payee_bank_name: p.payee_bank_name || c.bank_name || null,
      payee_bank_account: p.payee_bank_account || c.bank_account || null,
    };
  } catch (_) {
    return p;
  }
}

function reimbPrintRenderCellHtml(colId, row, idx, ctx) {
  if (!row) return '';
  const blockLabel = REIMB_DETAIL_BLOCKS.find((x) => x.value === row.block)?.label || row.block || '';
  const catLabel =
    (REIMB_DETAIL_CATEGORY_OPTIONS[row.block] || []).find(([v]) => v === row.category)?.[1] || row.category || '';
  const inv = row.invoice === '无' ? '无' : '有';
  switch (colId) {
    case 'idx':
      return String(idx + 1);
    case 'project':
      return escapeHtml(reimbPrintResolveLineProject(row, ctx));
    case 'block':
      return escapeHtml(blockLabel);
    case 'category':
      return escapeHtml(catLabel);
    case 'description':
      return escapeHtml(row.description || '');
    case 'amount':
      return fmtMoney(row.subtotal || 0);
    case 'cost_month':
      return escapeHtml(reimbFormatCostMonth(row.cost_month) || '—');
    case 'invoice':
      return escapeHtml(inv);
    case 'invoice_date':
      return row.invoice_date ? escapeHtml(String(row.invoice_date).slice(0, 10)) : '';
    case 'invoice_no':
      return escapeHtml(row.invoice_no || '');
    case 'payee':
      return escapeHtml(ctx.payee || '');
    case 'status':
      return escapeHtml(ctx.statusLabel || '');
    case 'remarks':
      return escapeHtml(row.remarks || '');
    default:
      return '';
  }
}

function buildReimbursementPrintTableHeadHtml(colPlan) {
  const cols = colPlan || Object.keys(REIMB_PRINT_COL_META);
  const heads = cols
    .map((id) => {
      const m = REIMB_PRINT_COL_META[id] || { header: id, th: '' };
      return `<th class="${m.th}">${m.header}</th>`;
    })
    .join('');
  return `<thead><tr>${heads}</tr></thead>`;
}

function buildReimbursementPrintLineRowHtml(row, idx, ctx, colPlan) {
  const cols = colPlan || Object.keys(REIMB_PRINT_COL_META);
  const cells = cols
    .map((id) => {
      const m = REIMB_PRINT_COL_META[id] || { td: '' };
      const inner = row ? reimbPrintRenderCellHtml(id, row, idx, ctx) : '';
      return `<td class="${m.td}">${inner}</td>`;
    })
    .join('');
  return `<tr>${cells}</tr>`;
}

/**
 * 盛融报销单打印版式：A4 横版，行多时分页，备注列自动换行
 */
