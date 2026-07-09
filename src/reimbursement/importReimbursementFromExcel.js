/**
 * 从 Excel 批量导入成本登记（盛融报销单 / 个人报销表）
 * - 有完整项目编号且匹配场次 → 活动成本，明细行带 project_code
 * - 仅年框编号 → 统筹成本（general），品牌列写年框编号
 */
const XLSX = require('xlsx');
const db = require('../config/database');
const { todayYmd } = require('../lib/businessTime');
const { projectCodeHasDateSuffix } = require('../lib/projectCode');
const { extractBrandFromProjectCode, brandsLabelFromRows } = require('../lib/brandFromProjectCode');
const { brandYearFrameCode, blockLabel, categoryLabel, REIMB_DETAIL_CATEGORY_OPTIONS } = require('./exportLabels');

const REIMB_DETAIL_META_PREFIX = '\n\n[REIMB_DETAIL_JSON]';
const COST_DETAIL_KEYS = [
  'supervisor', 'pg', 'parttime', 'bartender', 'photo', 'cloud_album_edit', 'performance', 'makeup',
  'travel_supervisor', 'travel_company',
  'structure', 'av', 'print', 'spray',
  'floral', 'payment', 'tasting', 'venue_fee', 'meal_fee', 'other_advance',
  'warehouse', 'express', 'logistics',
  'advance_offset',
];

const YEAR_FRAME_PATTERNS = [
  /^N230530-RM[\s-]*CLUB$/i,
  /^N220630-RC[\s-]*PHD$/i,
  /^N230901-RM[\s-]*X\.?O$/i,
];

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function cleanCell(v) {
  if (v == null) return '';
  return String(v)
    .replace(/^\uFEFF+/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function normalizeHeader(h) {
  return cleanCell(h).replace(/\s+/g, '');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseMonthNum(raw) {
  const s = cleanCell(raw);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\s*月?$/);
  if (m) {
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 12 ? n : null;
  }
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : null;
}

function normalizeProjectKey(s) {
  return cleanCell(s).toUpperCase().replace(/\s+/g, ' ');
}

function compactProjectKey(s) {
  return normalizeProjectKey(s)
    .replace(/[.\-]/g, '')
    .replace(/\s+/g, '');
}

function isYearFrameOnly(raw) {
  const compact = compactProjectKey(raw);
  if (!compact || !/^N\d{6}-(RM|RC)/i.test(compact)) return false;
  if (projectCodeHasDateSuffix(raw)) return false;
  return YEAR_FRAME_PATTERNS.some((re) => re.test(normalizeProjectKey(raw).replace(/\s+/g, ' ')))
    || YEAR_FRAME_PATTERNS.some((re) => re.test(compact.replace(/([A-Z])([A-Z])/g, '$1 $2')));
}

function yearFrameBrandLabel(raw) {
  const s = normalizeProjectKey(raw);
  if (/CLUB/i.test(s)) return 'N230530-RM Club';
  if (/PHD/i.test(s)) return 'N220630-RC PHD';
  if (/X\.?O/i.test(s)) return 'N230901-RM XO';
  const bucket = extractBrandFromProjectCode(s);
  return brandYearFrameCode(bucket) || s;
}

function findActivityByProjectRaw(raw, activities) {
  const rawNorm = normalizeProjectKey(raw);
  const rawCompact = compactProjectKey(raw);
  if (!rawNorm) return null;

  let prefixBest = null;
  for (const a of activities) {
    const pc = normalizeProjectKey(a.project_code);
    const pcCompact = compactProjectKey(a.project_code);
    if (!pc) continue;
    if (pc === rawNorm || pcCompact === rawCompact) return a;
    if (pc.startsWith(`${rawNorm} `) || pcCompact.startsWith(rawCompact)) {
      if (!prefixBest || pc.length < normalizeProjectKey(prefixBest.project_code).length) prefixBest = a;
    }
    if (rawNorm.length >= 10 && (pc.includes(rawNorm) || pcCompact.includes(rawCompact))) {
      if (!prefixBest) prefixBest = a;
    }
  }
  return prefixBest;
}

function classifyProjectCell(raw, activities) {
  const text = cleanCell(raw);
  if (!text || text === '—' || text === '-') {
    return { kind: 'general', project_code: '', brand: '内部', activity: null };
  }
  const act = findActivityByProjectRaw(text, activities);
  if (act) {
    return {
      kind: 'activity',
      project_code: String(act.project_code || '').trim(),
      brand: extractBrandFromProjectCode(act.project_code) || String(act.brand || '').trim() || '内部',
      activity: act,
    };
  }
  if (isYearFrameOnly(text) || (!projectCodeHasDateSuffix(text) && /^N\d{6}-(RM|RC)/i.test(text))) {
    const yf = yearFrameBrandLabel(text);
    return { kind: 'general', project_code: '', brand: yf, activity: null };
  }
  if (projectCodeHasDateSuffix(text)) {
    return {
      kind: 'activity',
      project_code: text,
      brand: extractBrandFromProjectCode(text) || '内部',
      activity: null,
      unmatched: true,
    };
  }
  return { kind: 'general', project_code: '', brand: '内部', activity: null };
}

function inferBlockCategory(desc) {
  const d = String(desc || '');
  if (/高铁|火车|机票|航班|酒店|打车|出租|滴滴|住宿|差旅|快车|出租/.test(d)) {
    return { block: 'travel', category: 'travel_company' };
  }
  if (/印刷|快印|喷绘|写真/.test(d)) return { block: 'print', category: 'print' };
  if (/快递|闪送/.test(d)) return { block: 'logistics', category: 'express' };
  if (/物流/.test(d)) return { block: 'logistics', category: 'logistics' };
  if (/花艺/.test(d)) return { block: 'purchase', category: 'floral' };
  if (/巧克力|核桃|品鉴|物料/.test(d)) return { block: 'purchase', category: 'tasting' };
  return { block: 'advance', category: 'other_advance' };
}

function parseAmount(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return round2(v);
  const s = cleanCell(v).replace(/[¥,，]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? round2(n) : 0;
}

function buildInvoiceDate(yearRaw, monthRaw) {
  const m = parseMonthNum(monthRaw);
  if (!m) return '';
  let y = parseInt(cleanCell(yearRaw), 10);
  if (!Number.isFinite(y) || y < 2000) y = new Date().getFullYear();
  return `${y}-${pad2(m)}-01`;
}

function rowsToCostDetails(rows) {
  const details = {};
  rows.forEach((row) => {
    if (!row.category) return;
    details[row.category] = round2((details[row.category] || 0) + round2(row.subtotal));
  });
  return details;
}

function remarksWithMeta(visible, meta) {
  const vis = String(visible || '').trim();
  return `${vis}${REIMB_DETAIL_META_PREFIX}${JSON.stringify(meta)}`;
}

const HEADER_MAP = {
  序号: 'seq',
  项目名称: 'project',
  项目编号: 'project',
  摘要: 'description',
  内容说明: 'description',
  费用所属期: 'cost_month',
  费用归属: 'cost_month',
  报销金额含税: 'amount',
  有无发票: 'invoice',
  发票: 'invoice',
  发票年份: 'invoice_year',
  发票月份: 'invoice_month',
  发票日期: 'invoice_date',
  发票号码: 'invoice_no',
  报销人: 'applicant',
  报销状态: 'claim_status',
  备注: 'remarks',
  板块: 'block',
  类别: 'category',
};

function mapHeaderRow(row) {
  const out = {};
  (row || []).forEach((cell, idx) => {
    const key = HEADER_MAP[normalizeHeader(cell)];
    if (key) out[key] = idx;
  });
  return out;
}

function hasRequiredHeaders(map) {
  return map.project != null && map.amount != null && (map.description != null || map.project != null);
}

function parseSheetMeta(rowsBeforeHeader) {
  const meta = { title: '', submitter: '', submitMonth: null };
  (rowsBeforeHeader || []).forEach((row) => {
    const line = (row || []).map(cleanCell).join(' ');
    if (!meta.title && /报销单/.test(line)) meta.title = line;
    const sub = line.match(/填报人\s*[:：]\s*([^\s,，]+)/);
    if (sub) meta.submitter = sub[1].trim();
    const sm = line.match(/提报月份\s*[:：]\s*(\d{1,2}\s*月?)/);
    if (sm) meta.submitMonth = parseMonthNum(sm[1]);
  });
  return meta;
}

function parseClaimStatusLabel(raw) {
  const s = cleanCell(raw);
  if (s === '已报销') return 'reimbursed';
  if (s === '已支付') return 'paid';
  if (s === '待支付') return 'submitted';
  if (s === '已驳回') return 'rejected';
  return 'draft';
}

function categoryKeyFromLabel(block, label) {
  const lab = cleanCell(label);
  if (!lab) return inferBlockCategory('');
  for (const [b, opts] of Object.entries(REIMB_DETAIL_CATEGORY_OPTIONS)) {
    const hit = opts.find(([, name]) => name === lab || name.replace(/\s/g, '') === lab.replace(/\s/g, ''));
    if (hit) return { block: b, category: hit[0] };
  }
  return inferBlockCategory(lab);
}

function parseExcelRows(matrix) {
  let headerRowIdx = -1;
  let colMap = null;
  for (let i = 0; i < matrix.length; i += 1) {
    const map = mapHeaderRow(matrix[i]);
    if (hasRequiredHeaders(map)) {
      headerRowIdx = i;
      colMap = map;
      break;
    }
  }
  if (headerRowIdx < 0 || !colMap) {
    throw new Error('未找到表头行（需包含「项目编号/项目名称」与「报销金额含税」列）');
  }

  const meta = parseSheetMeta(matrix.slice(0, headerRowIdx));
  const dataRows = [];
  const warnings = [];

  for (let i = headerRowIdx + 1; i < matrix.length; i += 1) {
    const row = matrix[i] || [];
    const get = (key) => (colMap[key] != null ? row[colMap[key]] : undefined);
    const amount = parseAmount(get('amount'));
    const description = cleanCell(get('description'));
    const projectRaw = cleanCell(get('project'));
    if (amount <= 0 && !description && !projectRaw) continue;

    let invoiceDate = '';
    const invDateCell = cleanCell(get('invoice_date'));
    if (/^\d{4}-\d{2}-\d{2}/.test(invDateCell)) invoiceDate = invDateCell.slice(0, 10);
    else invoiceDate = buildInvoiceDate(get('invoice_year'), get('invoice_month'));

    const costMonth = parseMonthNum(get('cost_month')) || parseMonthNum(get('invoice_month')) || meta.submitMonth;

    let blockCat;
    if (colMap.block != null || colMap.category != null) {
      blockCat = categoryKeyFromLabel(get('block'), get('category'));
    } else {
      blockCat = inferBlockCategory(description);
    }

    const invoiceRaw = cleanCell(get('invoice'));
    const hasInv = invoiceRaw ? invoiceRaw !== '无' : !!cleanCell(get('invoice_no'));

    dataRows.push({
      excelRow: i + 1,
      projectRaw,
      description,
      amount,
      invoice: hasInv ? '有' : '无',
      invoice_date: hasInv ? invoiceDate : '',
      invoice_no: cleanCell(get('invoice_no')),
      cost_month: costMonth,
      applicant: cleanCell(get('applicant')),
      claim_status: parseClaimStatusLabel(get('claim_status')),
      remarks: cleanCell(get('remarks')),
      block: blockCat.block,
      category: blockCat.category,
    });
  }

  if (!dataRows.length) throw new Error('未解析到有效数据行');
  return { meta, dataRows, warnings };
}

async function fiscalStartYearFromYearFrameId(yearFrameId, conn) {
  const [rows] = await conn.query('SELECT year FROM year_frames WHERE id = ? LIMIT 1', [yearFrameId]);
  const raw = rows[0]?.year || '';
  const yy = parseInt(String(raw).replace(/\D/g, ''), 10);
  if (Number.isFinite(yy)) return yy >= 100 ? yy : 2000 + yy;
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

function inferApplicationDate(submitMonth, fiscalStartYear) {
  const m = submitMonth;
  if (!m) return todayYmd();
  const y = m >= 4 ? fiscalStartYear : fiscalStartYear + 1;
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}-${pad2(m)}-${pad2(lastDay)}`;
}

function buildDetailLines(dataRows, activities, defaultCostMonth) {
  const lines = [];
  const warnings = [];
  dataRows.forEach((row) => {
    const cls = classifyProjectCell(row.projectRaw, activities);
    if (cls.unmatched) {
      warnings.push({ row: row.excelRow, message: `项目编号未匹配到场次：${row.projectRaw}` });
    }
    lines.push({
      kind: cls.kind,
      brand: cls.brand,
      project_code: cls.project_code,
      activity_id: cls.activity ? Number(cls.activity.id) : null,
      activity: cls.activity || null,
      unmatched: !!cls.unmatched,
      block: row.block,
      category: row.category,
      description: row.description,
      quantity: 1,
      unit_price: row.amount,
      subtotal: row.amount,
      cost_month: row.cost_month || defaultCostMonth,
      invoice: row.invoice,
      invoice_date: row.invoice_date,
      invoice_no: row.invoice_no,
      applicant: row.applicant,
      remarks: row.remarks,
      claim_status: row.claim_status,
    });
  });
  return { lines, warnings };
}

async function mergeReimbIntoActivity(conn, activityId, reimbCostDetails) {
  const [acts] = await conn.query(
    'SELECT id, cost_details, no_cost FROM activities WHERE id = ? FOR UPDATE',
    [activityId],
  );
  if (!acts.length) throw new Error('关联场次不存在');
  if (acts[0].no_cost === 1 || acts[0].no_cost === true) {
    throw new Error('场次已标记无成本，无法同步');
  }
  const base = typeof acts[0].cost_details === 'object' ? { ...acts[0].cost_details } : JSON.parse(acts[0].cost_details || '{}');
  COST_DETAIL_KEYS.forEach((k) => {
    base[k] = round2((base[k] || 0) + round2(reimbCostDetails[k]));
  });
  const total = round2(COST_DETAIL_KEYS.reduce((s, k) => s + round2(base[k]), 0));
  await conn.query('UPDATE activities SET cost_details = ?, total_cost = ? WHERE id = ?', [
    JSON.stringify(base),
    total,
    activityId,
  ]);
}

async function insertReimbursement(conn, {
  yearFrameId,
  payeeName,
  date,
  costModule,
  activityId,
  relatedProjectCode,
  city,
  brand,
  detailRows,
  visibleRemarks,
  syncToActivity,
}) {
  const costDetails = rowsToCostDetails(detailRows);
  const amount = round2(Object.values(costDetails).reduce((s, v) => s + round2(v), 0));
  if (amount <= 0) return null;

  const invoices = detailRows
    .filter((r) => r.invoice === '有' && r.invoice_no && r.invoice_date)
    .map((r) => ({
      invoice_content: r.description || '',
      invoice_no: r.invoice_no,
      invoice_date: r.invoice_date,
      invoice_kind: '普票',
    }));
  const hasInvoice = invoices.length > 0;
  const gross = round2(detailRows.reduce((s, r) => s + round2(r.subtotal), 0));
  const remarks = remarksWithMeta(visibleRemarks, {
    rows: detailRows.map(({ kind, activity_id, claim_status, ...rest }) => rest),
    use_advance: false,
    advance_amount: 0,
    gross_total: gross,
    payment_date: '',
  });

  const [result] = await conn.query(
    `INSERT INTO reimbursements (
      year_frame_id, activity_id, reimbursement_type, payment_type, cost_module, claim_status, city, brand, amount, date, related_project_code,
      payee_name, payment_method, payee_bank_name, payee_bank_account, payment_status,
      props, printing, express, other,
      cost_details, merged_into_activity, has_invoice, invoices, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'unpaid', 0, 0, 0, 0, ?, ?, ?, ?, ?)`,
    [
      yearFrameId,
      activityId || null,
      null,
      'personal_reimbursement',
      costModule,
      'draft',
      city || null,
      brand,
      amount,
      date,
      relatedProjectCode || null,
      payeeName || null,
      JSON.stringify(costDetails),
      syncToActivity ? 1 : 0,
      hasInvoice ? 1 : 0,
      hasInvoice ? JSON.stringify(invoices) : null,
      remarks,
    ],
  );

  if (syncToActivity && activityId) {
    await mergeReimbIntoActivity(conn, activityId, costDetails);
  }

  return { id: result.insertId, amount, lineCount: detailRows.length, cost_module: costModule };
}

/**
 * @param {Buffer} buffer
 * @param {{ yearFrameId: number, payeeName?: string, date?: string, syncActivity?: boolean }} options
 */
function enrichImportGroup(group, activities, options) {
  const detailRows = group.rows;
  const brand = brandsLabelFromRows(detailRows, '') || '内部';
  const brandVal = brand.length <= 30 ? brand : brand.split('，')[0];
  const amount = round2(detailRows.reduce((s, r) => s + round2(r.subtotal), 0));

  let activityId = null;
  let relatedProjectCode = null;
  let city = null;
  let syncToActivity = false;
  let multiActivity = false;

  if (group.costModule === 'activity') {
    const actIds = [...new Set(detailRows.map((r) => r.activity_id).filter(Boolean))];
    multiActivity = actIds.length > 1;
    if (actIds.length === 1) {
      activityId = actIds[0];
      const act = activities.find((a) => Number(a.id) === activityId);
      relatedProjectCode = act ? String(act.project_code || '').trim() : detailRows[0].project_code;
      city = act ? act.city : null;
      syncToActivity = options.syncActivity !== false;
    }
  }

  return {
    ...group,
    brand: brandVal,
    amount,
    activityId,
    relatedProjectCode,
    city,
    syncToActivity,
    multiActivity,
  };
}

function buildImportGroups(lines, activities, options) {
  const activityLines = lines.filter((l) => l.kind === 'activity');
  const generalLines = lines.filter((l) => l.kind === 'general');
  const rawGroups = [];
  if (activityLines.length) rawGroups.push({ costModule: 'activity', rows: activityLines });
  if (generalLines.length) rawGroups.push({ costModule: 'general', rows: generalLines });
  if (!rawGroups.length) throw new Error('没有可导入的费用行');
  return {
    activityLines,
    generalLines,
    groups: rawGroups.map((g) => enrichImportGroup(g, activities, options)),
  };
}

function previewRowStatus(dataRow, line, rowWarnings) {
  const msgs = (rowWarnings || []).filter((w) => w.row === dataRow.excelRow).map((w) => w.message);
  if (line.unmatched) {
    return { status: 'error', messages: msgs.length ? msgs : [`项目编号未匹配到场次：${dataRow.projectRaw}`] };
  }
  if (!cleanCell(dataRow.projectRaw) || dataRow.projectRaw === '—' || dataRow.projectRaw === '-') {
    return { status: 'warn', messages: msgs.length ? msgs : ['无项目编号，归入统筹成本'] };
  }
  if (msgs.length) return { status: 'warn', messages: msgs };
  return { status: 'ok', messages: [] };
}

function formatPreviewPayload({
  meta,
  dataRows,
  lines,
  warnings,
  groups,
  activityLines,
  generalLines,
  payeeName,
  applicationDate,
}) {
  const previewRows = dataRows.map((dataRow, idx) => {
    const line = lines[idx];
    const { status, messages } = previewRowStatus(dataRow, line, warnings);
    const targetType = line.kind === 'activity' ? 'activity' : 'general';
    let matchedProject = '';
    if (line.activity_id && line.project_code) {
      matchedProject = line.project_code;
    } else if (targetType === 'general' && line.brand && line.brand !== '内部') {
      matchedProject = line.brand;
    } else if (line.project_code) {
      matchedProject = line.project_code;
    }
    return {
      excelRow: dataRow.excelRow,
      projectRaw: dataRow.projectRaw,
      targetType,
      targetTypeLabel: targetType === 'activity' ? '活动成本' : '统筹成本',
      matchedProjectCode: matchedProject,
      activityId: line.activity_id,
      city: line.activity ? line.activity.city : null,
      brand: line.brand,
      blockLabel: blockLabel(line.block),
      categoryLabel: categoryLabel(line.block, line.category),
      description: dataRow.description,
      amount: dataRow.amount,
      costMonth: line.cost_month,
      invoice: dataRow.invoice,
      status,
      messages,
    };
  });

  const plannedRecords = groups.map((g) => ({
    costModule: g.costModule,
    costModuleLabel: g.costModule === 'general' ? '统筹成本' : '活动成本',
    lineCount: g.rows.length,
    amount: g.amount,
    brand: g.brand,
    relatedProjectCode: g.relatedProjectCode || null,
    activityId: g.activityId,
    city: g.city,
    syncToActivity: g.syncToActivity,
    multiActivity: g.multiActivity,
  }));

  const errorCount = previewRows.filter((r) => r.status === 'error').length;
  const warnCount = previewRows.filter((r) => r.status === 'warn').length;

  return {
    meta: {
      title: meta.title || '',
      submitMonth: meta.submitMonth,
      submitter: meta.submitter || '',
    },
    payeeName,
    applicationDate,
    summary: {
      totalRows: previewRows.length,
      activityLineCount: activityLines.length,
      generalLineCount: generalLines.length,
      plannedRecordCount: plannedRecords.length,
      totalAmount: round2(previewRows.reduce((s, r) => s + round2(r.amount), 0)),
      errorCount,
      warnCount,
      canImport: errorCount === 0,
    },
    plannedRecords,
    rows: previewRows,
    warnings,
    message: errorCount
      ? `预览完成：${previewRows.length} 行中有 ${errorCount} 行未匹配到场次，请核对后再导入`
      : `预览完成：将生成 ${plannedRecords.length} 条成本登记（活动 ${activityLines.length} 行 / 统筹 ${generalLines.length} 行）`,
  };
}

async function loadExcelImportContext(buffer, yearFrameId) {
  const yfId = Number(yearFrameId);
  if (!Number.isFinite(yfId)) throw new Error('缺少有效 yearFrameId');

  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Excel 无工作表');
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  const { meta, dataRows, warnings: parseWarnings } = parseExcelRows(matrix);

  const conn = await db.getConnection();
  try {
    const [activities] = await conn.query(
      `SELECT id, project_code, city, brand FROM activities
       WHERE year_frame_id = ? AND COALESCE(is_virtual, 0) = 0 AND project_code IS NOT NULL AND TRIM(project_code) <> ''`,
      [yfId],
    );
    const fiscalStart = await fiscalStartYearFromYearFrameId(yfId, conn);
    return {
      meta,
      dataRows,
      parseWarnings,
      activities,
      fiscalStart,
      defaultCostMonth: meta.submitMonth || new Date().getMonth() + 1,
    };
  } finally {
    conn.release();
  }
}

/**
 * 仅解析 Excel 并返回预览（不写库）
 */
async function previewReimbursementFromExcelBuffer(buffer, options = {}) {
  const yearFrameId = Number(options.yearFrameId);
  const ctx = await loadExcelImportContext(buffer, yearFrameId);
  const applicationDate = options.date || inferApplicationDate(ctx.meta.submitMonth, ctx.fiscalStart);
  const payeeName = cleanCell(options.payeeName) || ctx.meta.submitter || '导入收款方';
  const syncActivity = options.syncActivity !== false;

  const { lines, warnings: lineWarnings } = buildDetailLines(ctx.dataRows, ctx.activities, ctx.defaultCostMonth);
  const warnings = [...ctx.parseWarnings, ...lineWarnings];
  const { groups, activityLines, generalLines } = buildImportGroups(lines, ctx.activities, { syncActivity });

  return formatPreviewPayload({
    meta: ctx.meta,
    dataRows: ctx.dataRows,
    lines,
    warnings,
    groups,
    activityLines,
    generalLines,
    payeeName,
    applicationDate,
  });
}

async function importReimbursementFromExcelBuffer(buffer, options = {}) {
  const yearFrameId = Number(options.yearFrameId);
  const ctx = await loadExcelImportContext(buffer, yearFrameId);
  const applicationDate = options.date || inferApplicationDate(ctx.meta.submitMonth, ctx.fiscalStart);
  const payeeName = cleanCell(options.payeeName) || ctx.meta.submitter || '导入收款方';
  const syncActivity = options.syncActivity !== false;

  const { lines, warnings: lineWarnings } = buildDetailLines(ctx.dataRows, ctx.activities, ctx.defaultCostMonth);
  const warnings = [...ctx.parseWarnings, ...lineWarnings];
  const { groups, activityLines, generalLines } = buildImportGroups(lines, ctx.activities, { syncActivity });

  const conn = await db.getConnection();
  try {
    const created = [];
    await conn.beginTransaction();

    for (const group of groups) {
      const title = ctx.meta.title || `Excel导入 ${payeeName}`;
      const rec = await insertReimbursement(conn, {
        yearFrameId,
        payeeName,
        date: applicationDate,
        costModule: group.costModule,
        activityId: group.activityId,
        relatedProjectCode: group.relatedProjectCode,
        city: group.city,
        brand: group.brand,
        detailRows: group.rows,
        visibleRemarks: title,
        syncToActivity: group.syncToActivity,
      });
      if (rec) created.push(rec);
    }

    await conn.commit();

    return {
      createdCount: created.length,
      created,
      payeeName,
      applicationDate,
      warnings,
      activityLineCount: activityLines.length,
      generalLineCount: generalLines.length,
      message: `导入完成：${created.length} 条成本登记（活动 ${activityLines.length} 行 / 统筹 ${generalLines.length} 行）`,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  importReimbursementFromExcelBuffer,
  previewReimbursementFromExcelBuffer,
  classifyProjectCell,
  parseExcelRows,
};
