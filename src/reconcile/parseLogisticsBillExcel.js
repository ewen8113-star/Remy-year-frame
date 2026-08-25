/**
 * 解析供应商物流对账单（盛融/衡之捷月结明细 .xls/.xlsx）
 * 兼容 4 月/5 月列差异；仓储费行自动跳过。
 */
const XLSX = require('xlsx');
const { projectCodeHasDateSuffix } = require('../lib/projectCode');
const { extractBrandFromProjectCode } = require('../lib/brandFromProjectCode');

const DEFAULT_PAYEE = '上海衡之捷供应链管理有限公司';

function cleanCell(v) {
  if (v == null) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v)
    .replace(/^\uFEFF+/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function normalizeHeader(h) {
  return cleanCell(h).replace(/\s+/g, '');
}

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function parseMoney(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return round2(Math.max(0, v));
  const s = cleanCell(v).replace(/[¥￥,，]/g, '');
  if (!s || s === '-' || s === '—') return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? round2(Math.max(0, n)) : 0;
}

function parseDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const s = cleanCell(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  }
  const md = s.match(/^(\d{1,2})\.(\d{1,2})\s*号?$/);
  if (md) return null;
  return null;
}

function canonicalizeBrand(raw) {
  const s = cleanCell(raw).toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (s.includes('CLUB')) return 'CLUB';
  if (s.includes('PHD')) return 'PHD';
  if (s.includes('X.O') || s === 'XO' || s.includes('XO')) return 'X.O';
  if (s.includes('REMY') || s.includes('VSOP')) return 'REMY';
  if (s.includes('RC')) return 'PHD';
  return '';
}

function normalizeExpress(raw) {
  const s = cleanCell(raw);
  if (!s) return '';
  if (/顺丰|SF/i.test(s)) return '顺丰';
  if (/京东|JD/i.test(s)) return '京东';
  if (/专车/.test(s)) return '专车';
  if (/物流/.test(s)) return '物流';
  if (/送货|车送|提回/.test(s)) return '送货';
  if (/货拉拉/.test(s)) return '货拉拉';
  return s.slice(0, 32);
}

function normalizeTracking(raw) {
  let s = cleanCell(raw).replace(/\s+/g, '');
  if (!s || s === '物流' || s === '专车' || s === '送货' || s === '车送' || s === '提回来') return '';
  s = s.replace(/^特快/, '').replace(/^空运/, '').replace(/^到付/, '');
  return s.slice(0, 64);
}

function inferLogisticsCompany(express) {
  if (/专车|物流|送货|货拉拉/.test(express || '')) return '物流';
  return '快递';
}

function shortGoods(rawRemarks) {
  const text = cleanCell(rawRemarks)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(PHD|X\.O|CLUB|REMY)\s/.test(l) && l !== '—' && !/^\d+$/.test(l))
    .slice(0, 3)
    .join('；');
  if (!text) return '';
  return text.length > 80 ? `${text.slice(0, 78)}…` : text;
}

function isNonProjectLabel(raw) {
  const s = cleanCell(raw);
  if (!s) return true;
  if (/^到货/.test(s)) return true;
  if (/客户|借用|调货|办公|happy\s*hour|Chevy|未知/i.test(s)) return true;
  if (!/N\d{6}/i.test(s) && !projectCodeHasDateSuffix(s)) return true;
  return false;
}

function buildPurpose({ rawType, rawProject, rawRemarks }) {
  const goods = shortGoods(rawRemarks);
  const proj = cleanCell(rawProject);
  const type = cleanCell(rawType);
  if (/到货|收件/.test(type)) {
    if (goods) return `到货操作：${goods}`;
    if (proj && isNonProjectLabel(proj)) return proj.replace(/[（(]未知[）)]/g, '').trim() || '到货操作';
    return '到货操作';
  }
  if (proj && isNonProjectLabel(proj)) {
    const label = proj.replace(/\s+/g, ' ').slice(0, 60);
    return goods ? `${label}；${goods}` : label;
  }
  if (goods) return goods;
  if (proj) return proj.slice(0, 60);
  return type || '物流';
}

function looksLikeWarehouseFee(cellsJoined) {
  return /仓储费|仓租|天津仓储/.test(cellsJoined);
}

function looksLikeTotalRow(cellsJoined, rowObj) {
  if (/合计|总计|小计/.test(cellsJoined)) return true;
  if (!rowObj.raw_type && !rowObj.raw_date && !rowObj.raw_tracking) return true;
  return false;
}

const HEADER_MAP = {
  序号: 'seq',
  类型: 'type',
  日期: 'date',
  下单人: 'orderer',
  项目编号: 'project',
  品牌: 'brand',
  快递公司: 'express',
  单号: 'tracking',
  发件城市: 'origin_city',
  发件人: 'ship_name',
  发件电话: 'ship_phone',
  发件地址: 'ship_addr',
  收件城市: 'dest_city',
  收件人: 'recv_name',
  收件电话: 'recv_phone',
  收件地址: 'recv_addr',
  '重量(kg)': 'weight',
  重量kg: 'weight',
  重量: 'weight',
  '运费(¥)': 'shipping_fee',
  运费: 'shipping_fee',
  '操作费(¥)': 'handling_fee',
  操作费: 'handling_fee',
  '保价(¥)': 'insurance',
  保价: 'insurance',
  '合计(¥)': 'total',
  合计: 'total',
  '备注（物品信息）': 'remarks',
  备注物品信息: 'remarks',
  备注: 'remarks',
  到付: 'cod',
  '备注/到付': 'cod_or_note',
};

function mapHeaders(headerRow) {
  const map = {};
  (headerRow || []).forEach((h, idx) => {
    const key = HEADER_MAP[normalizeHeader(h)] || HEADER_MAP[cleanCell(h)];
    if (key) map[key] = idx;
  });
  return map;
}

function cellAt(row, map, key) {
  if (map[key] == null) return null;
  return row[map[key]];
}

function findHeaderRow(matrix) {
  for (let i = 0; i < Math.min(8, matrix.length); i += 1) {
    const map = mapHeaders(matrix[i]);
    if (map.type != null && map.date != null && (map.shipping_fee != null || map.total != null)) {
      return { headerIndex: i, map };
    }
  }
  return null;
}

function pickSheet(workbook) {
  const names = workbook.SheetNames || [];
  for (const name of names) {
    const sheet = workbook.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    const hit = findHeaderRow(matrix);
    if (hit) return { name, matrix, ...hit };
  }
  const first = names[0];
  const sheet = workbook.Sheets[first];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  return { name: first, matrix, ...(findHeaderRow(matrix) || { headerIndex: -1, map: {} }) };
}

function normalizeProjectKey(s) {
  return cleanCell(s).toUpperCase().replace(/\s+/g, ' ');
}

function compactProjectKey(s) {
  return normalizeProjectKey(s).replace(/[.\-\s]/g, '');
}

function findActivityByProjectRaw(raw, activities) {
  const rawNorm = normalizeProjectKey(raw);
  const rawCompact = compactProjectKey(raw);
  if (!rawNorm || isNonProjectLabel(raw)) return null;

  let prefixBest = null;
  for (const a of activities) {
    const pc = normalizeProjectKey(a.project_code);
    const pcCompact = compactProjectKey(a.project_code);
    if (!pc) continue;
    if (pc === rawNorm || pcCompact === rawCompact) return a;
    if (pc.startsWith(`${rawNorm} `) || pcCompact.startsWith(rawCompact)) {
      if (!prefixBest || pc.length < normalizeProjectKey(prefixBest.project_code).length) prefixBest = a;
    }
    if (rawNorm.length >= 12 && (pc.includes(rawNorm) || pcCompact.includes(rawCompact))) {
      if (!prefixBest) prefixBest = a;
    }
  }
  return prefixBest;
}

function inferSettlementMonth(lines, filename) {
  const months = {};
  lines.forEach((l) => {
    if (!l.shipping_date) return;
    const ym = String(l.shipping_date).slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) months[ym] = (months[ym] || 0) + 1;
  });
  const best = Object.entries(months).sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  const m = String(filename || '').match(/(\d{1,2})\s*月/);
  if (m) {
    const now = new Date();
    let y = now.getFullYear();
    const mo = parseInt(m[1], 10);
    // 账单月份通常落在当前财年附近
    if (mo > now.getMonth() + 3) y -= 1;
    return `${y}-${String(mo).padStart(2, '0')}`;
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * @param {Buffer} buffer
 * @param {{ activities?: Array<{id:number,project_code:string,brand?:string}> }} options
 */
function parseLogisticsBillExcelBuffer(buffer, options = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const picked = pickSheet(workbook);
  if (picked.headerIndex < 0) {
    throw new Error('无法识别物流账单表头（需要「类型 / 日期 / 运费」等列）');
  }
  const { matrix, map, name: sheetName } = picked;
  const activities = Array.isArray(options.activities) ? options.activities : [];
  const lines = [];
  let lineNo = 0;

  for (let r = picked.headerIndex + 1; r < matrix.length; r += 1) {
    const row = matrix[r] || [];
    const cellsJoined = row.map((c) => cleanCell(c)).filter(Boolean).join(' ');
    if (!cellsJoined) continue;

    const rawType = cleanCell(cellAt(row, map, 'type'));
    const rawDate = parseDate(cellAt(row, map, 'date'));
    const rawProject = cleanCell(cellAt(row, map, 'project'));
    const rawBrand = cleanCell(cellAt(row, map, 'brand'));
    const rawExpress = cleanCell(cellAt(row, map, 'express'));
    const rawTracking = cleanCell(cellAt(row, map, 'tracking'));
    const shipFee = parseMoney(cellAt(row, map, 'shipping_fee'));
    const handleFee = parseMoney(cellAt(row, map, 'handling_fee'));
    const insurance = parseMoney(cellAt(row, map, 'insurance'));
    const total = parseMoney(cellAt(row, map, 'total'));
    const cod = parseMoney(cellAt(row, map, 'cod'));
    const remarks = cleanCell(cellAt(row, map, 'remarks'));
    const weightRaw = cellAt(row, map, 'weight');

    const draft = {
      raw_type: rawType,
      raw_date: rawDate,
      raw_tracking: rawTracking,
    };

    if (looksLikeWarehouseFee(cellsJoined) || looksLikeWarehouseFee(cleanCell(weightRaw))) {
      lineNo += 1;
      lines.push({
        line_no: lineNo,
        excel_row: r + 1,
        line_status: 'skipped',
        allocation_type: 'skipped',
        skip_reason: '仓储费（请在仓储成本按月生成，付款时另行勾选）',
        raw_type: rawType || null,
        raw_date: rawDate,
        raw_project: rawProject || cellsJoined.slice(0, 80),
        fee: total || shipFee || 0,
        purpose: '仓储费（跳过）',
        raw_remarks: remarks || cellsJoined.slice(0, 200),
      });
      continue;
    }

    if (looksLikeTotalRow(cellsJoined, draft)) continue;
    if (!rawType && !rawDate && shipFee <= 0 && handleFee <= 0 && total <= 0) continue;
    if (!/发件|到货|收件|寄件|退回/.test(rawType) && !rawDate) continue;

    const isReturn = /到货|收件|退回/.test(rawType);
    let shipping_fee = 0;
    let handling_fee = 0;
    let return_shipping_fee = 0;
    let return_handling_fee = 0;
    if (isReturn) {
      return_shipping_fee = shipFee;
      return_handling_fee = handleFee;
      if (shipFee <= 0 && handleFee <= 0 && total > 0) return_handling_fee = total;
    } else {
      shipping_fee = shipFee;
      handling_fee = handleFee;
      if (shipFee <= 0 && handleFee <= 0 && total > 0) shipping_fee = total;
    }
    // 到付并入运费侧
    if (cod > 0) {
      if (isReturn) return_shipping_fee = round2(return_shipping_fee + cod);
      else shipping_fee = round2(shipping_fee + cod);
    }
    const fee = round2(shipping_fee + handling_fee + return_shipping_fee + return_handling_fee);
    if (fee <= 0 && !rawTracking && !remarks) continue;

    const express = normalizeExpress(rawExpress) || normalizeExpress(rawTracking) || '顺丰';
    const tracking = normalizeTracking(rawTracking);
    const brand =
      canonicalizeBrand(rawBrand) ||
      extractBrandFromProjectCode(rawProject) ||
      'PHD';
    const purpose = buildPurpose({ rawType, rawProject, rawRemarks: remarks });
    const matched = findActivityByProjectRaw(rawProject, activities);

    let allocation_type = 'unassigned';
    let line_status = 'pending';
    let related_project_code = null;
    let activity_id = null;
    let suggested_project_code = null;
    let suggested_activity_id = null;

    if (matched) {
      suggested_project_code = String(matched.project_code || '').trim();
      suggested_activity_id = Number(matched.id) || null;
      related_project_code = suggested_project_code;
      activity_id = suggested_activity_id;
      allocation_type = 'activity';
      line_status = 'suggested';
    } else if (!rawProject || isNonProjectLabel(rawProject)) {
      // 无项目编号：默认建议纳入统筹，仍需人工确认
      allocation_type = 'pooled';
      line_status = 'suggested';
    }

    lineNo += 1;
    lines.push({
      line_no: lineNo,
      excel_row: r + 1,
      line_status,
      allocation_type,
      raw_type: rawType || null,
      raw_date: rawDate,
      raw_project: rawProject || null,
      raw_brand: rawBrand || null,
      raw_express: rawExpress || null,
      raw_tracking: rawTracking || null,
      raw_origin_city: cleanCell(cellAt(row, map, 'origin_city')) || null,
      raw_dest_city: cleanCell(cellAt(row, map, 'dest_city')) || null,
      ship_name: cleanCell(cellAt(row, map, 'ship_name')) || null,
      ship_phone: cleanCell(cellAt(row, map, 'ship_phone')) || null,
      ship_addr: cleanCell(cellAt(row, map, 'ship_addr')).replace(/\s+/g, ' ').slice(0, 500) || null,
      recv_name: cleanCell(cellAt(row, map, 'recv_name')) || null,
      recv_phone: cleanCell(cellAt(row, map, 'recv_phone')) || null,
      recv_addr: cleanCell(cellAt(row, map, 'recv_addr')).replace(/\s+/g, ' ').slice(0, 500) || null,
      weight_kg: (() => {
        const n = parseFloat(weightRaw);
        return Number.isFinite(n) ? round2(n) : null;
      })(),
      shipping_fee,
      handling_fee,
      return_shipping_fee,
      return_handling_fee,
      insurance_fee: insurance,
      cod_fee: cod,
      fee,
      purpose,
      brand,
      express_company: express,
      tracking_number: tracking || null,
      logistics_company: inferLogisticsCompany(express),
      shipping_date: rawDate,
      return_date: isReturn ? rawDate : null,
      related_project_code,
      activity_id,
      suggested_project_code,
      suggested_activity_id,
      skip_reason: null,
      raw_remarks: remarks || null,
      raw_extra_json: {
        sheet: sheetName,
        orderer: cleanCell(cellAt(row, map, 'orderer')) || null,
        total_cell: total,
      },
    });
  }

  if (!lines.length) {
    throw new Error('未解析到有效账单行，请确认文件格式');
  }

  const filename = options.filename || '';
  const settlement_month = options.settlementMonth || inferSettlementMonth(lines, filename);
  const summary = summarizeLines(lines);

  return {
    sheetName,
    settlement_month,
    payee_name: options.payeeName || DEFAULT_PAYEE,
    lines,
    summary,
  };
}

function summarizeLines(lines) {
  const summary = {
    totalLines: lines.length,
    pending: 0,
    suggested: 0,
    confirmed: 0,
    skipped: 0,
    activity: 0,
    pooled: 0,
    unassigned: 0,
    feeTotal: 0,
    importableFee: 0,
  };
  lines.forEach((l) => {
    const st = l.line_status || 'pending';
    const alloc = l.allocation_type || 'unassigned';
    if (st === 'skipped' || alloc === 'skipped') summary.skipped += 1;
    else if (st === 'confirmed') summary.confirmed += 1;
    else if (st === 'suggested') summary.suggested += 1;
    else summary.pending += 1;

    if (alloc === 'activity') summary.activity += 1;
    else if (alloc === 'pooled') summary.pooled += 1;
    else if (alloc === 'unassigned') summary.unassigned += 1;

    summary.feeTotal = round2(summary.feeTotal + (parseFloat(l.fee) || 0));
    if (alloc !== 'skipped') {
      summary.importableFee = round2(summary.importableFee + (parseFloat(l.fee) || 0));
    }
  });
  return summary;
}

function buildLogisticsAddrMeta(line) {
  const esc = (v) => String(v || '').replace(/\|/g, '｜').replace(/\n/g, ' ');
  const parts = [];
  if (line.ship_name) parts.push(`发件人:${esc(line.ship_name)}`);
  if (line.ship_phone) parts.push(`发件电话:${esc(line.ship_phone)}`);
  if (line.ship_addr) parts.push(`发件地址:${esc(line.ship_addr)}`);
  if (line.recv_name) parts.push(`收件人:${esc(line.recv_name)}`);
  if (line.recv_phone) parts.push(`收件电话:${esc(line.recv_phone)}`);
  if (line.recv_addr) parts.push(`收件地址:${esc(line.recv_addr)}`);
  if (line.purpose) parts.push(`用途:${esc(line.purpose)}`);
  return parts.length ? `[LOG_ADDR]${parts.join('|')}` : '';
}

module.exports = {
  DEFAULT_PAYEE,
  parseLogisticsBillExcelBuffer,
  summarizeLines,
  buildLogisticsAddrMeta,
  findActivityByProjectRaw,
  cleanCell,
};
