const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { buildMultiPreviewTableData, isMultiQuote, fmtNum } = require('./multiPreviewTable');
const { groupItems, calcTotals, itemSubtotal } = require('./buildQuotationPdf');

const HEADER_FILL = 'FF948A54';
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
const SECTION_FILL = 'FFC4BD97';
const ALT_FILL = 'FFF9F9F9';
const BORDER_THIN = { style: 'thin', color: { argb: 'FFB0B0B0' } };
const ALL_BORDERS = {
  top: BORDER_THIN,
  left: BORDER_THIN,
  bottom: BORDER_THIN,
  right: BORDER_THIN,
};
const LOGO_PATH = path.join(__dirname, '../../public/logo.png');
const LOGO_PRINT_PATH = path.join(__dirname, '../../public/logo-print.png');

function buildExportBaseName(q) {
  const base =
    [q.project_name, q.quotation_no].filter(Boolean).join('-').trim() ||
    `quotation-${q.id || 'export'}`;
  return String(base)
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 80);
}

function buildExcelContentDisposition(q) {
  const displayName = buildExportBaseName(q);
  const asciiName = `quotation-${q.id || 'export'}.xlsx`;
  const encoded = encodeURIComponent(`${displayName || `quotation-${q.id}`}.xlsx`);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

function applyHeaderRowStyle(row) {
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = HEADER_FONT;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = ALL_BORDERS;
  });
}

function applyDataCellStyle(cell, { alignRight, alt }) {
  cell.border = ALL_BORDERS;
  cell.alignment = {
    vertical: 'middle',
    horizontal: alignRight ? 'right' : 'left',
    wrapText: true,
  };
  if (alt) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_FILL } };
  }
}

function writeSheetHeaderInfo(ws, q, startRow) {
  let r = startRow;
  const lines = [
    ['Client / Brand 客户/品牌', q.client_brand || ''],
    ['Attend to 客户方负责人', q.client_contact || ''],
    ['Project Name 项目名称', q.project_name || ''],
    ['Quotation No. 报价编号', q.quotation_no || ''],
  ];
  lines.forEach(([label, value]) => {
    const row = ws.getRow(r);
    ws.mergeCells(r, 1, r, 2);
    ws.mergeCells(r, 3, r, 7);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, size: 10 };
    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    row.getCell(3).value = value;
    row.getCell(3).font = { size: 10 };
    row.getCell(3).alignment = { vertical: 'middle', horizontal: 'left' };
    r += 1;
  });
  return r + 1;
}

function applyHeaderGridBorders(ws, rowStart, rowEnd, colEnd) {
  for (let r = rowStart; r <= rowEnd; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= colEnd; c++) {
      const cell = row.getCell(c);
      cell.border = ALL_BORDERS;
      if (c > 2 && cell.value == null) cell.value = '';
    }
  }
}

function resolveLogoPath() {
  const logo = fs.existsSync(LOGO_PRINT_PATH) ? LOGO_PRINT_PATH : LOGO_PATH;
  return fs.existsSync(logo) ? logo : null;
}

function getPngSize(buf) {
  if (!buf || buf.length < 24) return null;
  const sig = buf.slice(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function getJpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    const isSOF = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSOF && i + 8 < buf.length) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

function fitByAspect(size, maxWidth, maxHeight) {
  if (!size || !size.width || !size.height) return { width: maxWidth, height: maxHeight };
  const ratio = size.width / size.height;
  let width = maxWidth;
  let height = Math.round(width / ratio);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * ratio);
  }
  return { width, height };
}

function addLogoToSheet(workbook, ws, rowStart = 1, colStart = 7, maxWidth = 140, maxHeight = 56) {
  const logoPath = resolveLogoPath();
  if (!logoPath) return;
  const ext = path.extname(logoPath).toLowerCase() === '.jpg' ? 'jpeg' : 'png';
  const buf = fs.readFileSync(logoPath);
  const srcSize = ext === 'png' ? getPngSize(buf) : getJpegSize(buf);
  const fitted = fitByAspect(srcSize, maxWidth, maxHeight);
  const imageId = workbook.addImage({ filename: logoPath, extension: ext });
  ws.addImage(imageId, {
    tl: { col: colStart - 1, row: rowStart - 1 },
    ext: { width: fitted.width, height: fitted.height },
    editAs: 'oneCell',
  });
}

function addLogoToSheetRightAligned(workbook, ws, totalCols, rowStart = 1, maxWidth = 106, maxHeight = 40) {
  const colStart = Math.max(1, Number(totalCols) - 2);
  addLogoToSheet(workbook, ws, rowStart, colStart, maxWidth, maxHeight);
}

async function buildMultiQuoteWorkbook(q) {
  const layout = buildMultiPreviewTableData(q);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'remy-year-frame';
  wb.created = new Date();
  const ws = wb.addWorksheet('多场报价', {
    views: [{ state: 'frozen', ySplit: 6, xSplit: 0 }],
  });

  ws.columns = layout.headers.map((h, i) => ({
    key: `c${i}`,
    width: i === layout.remarksCol ? 18 : i >= layout.feeColStart && i <= layout.totalCol ? 11 : 12,
  }));

  let rowNum = writeSheetHeaderInfo(ws, q, 1);
  applyHeaderGridBorders(ws, 1, rowNum - 1, ws.columns.length);
  addLogoToSheetRightAligned(wb, ws, ws.columns.length, 1, 106, 40);
  const headerRow = ws.getRow(rowNum);
  layout.headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  applyHeaderRowStyle(headerRow);
  rowNum += 1;

  layout.dataRows.forEach((dr, idx) => {
    const row = ws.getRow(rowNum);
    const alt = idx % 2 === 1;
    dr.cells.forEach((val, ci) => {
      const cell = row.getCell(ci + 1);
      const isMoney = ci >= layout.feeColStart && ci <= layout.totalCol;
      if (isMoney) {
        cell.value = Number(val) || 0;
        cell.numFmt = '#,##0.00';
      } else {
        if (ci === layout.remarksCol) cell.value = '';
        else cell.value = val === '—' ? '' : val;
      }
      applyDataCellStyle(cell, { alignRight: isMoney, alt });
    });
    rowNum += 1;
  });

  const footerRow = ws.getRow(rowNum);
  const span = layout.spanBeforeTotals;
  ws.mergeCells(rowNum, 1, rowNum, span);
  footerRow.getCell(1).value = '多场含税总计';
  footerRow.getCell(1).font = { bold: true, size: 10 };
  footerRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'right' };
  for (let c = 1; c <= span; c++) {
    const cell = footerRow.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
    cell.border = ALL_BORDERS;
  }
  [layout.subtotalCol, layout.serviceCol, layout.taxCol, layout.totalCol].forEach((ci) => {
    const cell = footerRow.getCell(ci + 1);
    cell.value = Number(layout.footerCells[ci]) || 0;
    cell.numFmt = '#,##0.00';
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'right' };
    cell.border = ALL_BORDERS;
  });
  const remarksFooter = footerRow.getCell(layout.remarksCol + 1);
  remarksFooter.border = ALL_BORDERS;
  remarksFooter.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
  footerRow.height = 20;

  return wb;
}

async function buildSingleQuoteWorkbook(q) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'remy-year-frame';
  const ws = wb.addWorksheet('报价明细', { views: [{ state: 'frozen', ySplit: 6 }] });
  writeSingleQuoteSheet(wb, ws, q);
  return wb;
}

function writeSingleQuoteSheet(workbook, ws, q, options = {}) {

  const headers = ['内容 Item', '分类', '说明 Summary', '数量 Qty', '单位 Unit', '单价 Price', '单项小计 Subtotal', '备注 Remarks'];
  const defaultColumns = [
    { width: 10 },
    { width: 12 },
    { width: 28 },
    { width: 8 },
    { width: 8 },
    { width: 10 },
    { width: 12 },
    { width: 20 },
  ];
  const customWidths = Array.isArray(options.columnWidths) ? options.columnWidths : null;
  ws.columns = defaultColumns.map((col, i) => ({
    width: Number(customWidths && customWidths[i]) > 0 ? Number(customWidths[i]) : col.width,
  }));

  let rowNum = writeSheetHeaderInfo(ws, q, 1);
  applyHeaderGridBorders(ws, 1, rowNum - 1, ws.columns.length);
  addLogoToSheetRightAligned(workbook, ws, ws.columns.length, 1, 96, 38);
  const headerRow = ws.getRow(rowNum);
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  applyHeaderRowStyle(headerRow);
  rowNum += 1;

  const groups = groupItems(q.items);
  groups.forEach((sec) => {
    const secRow = ws.getRow(rowNum);
    secRow.getCell(1).value = `${sec.section_code}.${sec.section_name}`;
    ws.mergeCells(rowNum, 1, rowNum, 6);
    secRow.getCell(7).value = sec.sectionSubtotal;
    secRow.getCell(7).numFmt = '#,##0.00';
    for (let c = 1; c <= 8; c++) {
      const cell = secRow.getCell(c);
      cell.font = { bold: true, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
      cell.border = ALL_BORDERS;
      if (c === 7) cell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
    rowNum += 1;

    sec.subsections.forEach((sub) => {
      const start = rowNum;
      sub.items.forEach((it, idx) => {
        const row = ws.getRow(rowNum);
        row.getCell(1).value = idx === 0 ? sub.subsection_code : '';
        row.getCell(2).value = idx === 0 ? sub.subsection_name : '';
        row.getCell(3).value = it.description || '';
        row.getCell(4).value = parseFloat(it.quantity) || 0;
        row.getCell(5).value = it.unit || '';
        row.getCell(6).value = parseFloat(it.unit_price) || 0;
        row.getCell(6).numFmt = '#,##0.00';
        row.getCell(7).value = itemSubtotal(it);
        row.getCell(7).numFmt = '#,##0.00';
        row.getCell(8).value = it.remarks || '';
        row.eachCell((cell, col) => {
          applyDataCellStyle(cell, { alignRight: col >= 4 && col <= 7, alt: false });
        });
        rowNum += 1;
      });
      if (sub.items.length > 1) {
        ws.mergeCells(start, 1, rowNum - 1, 1);
        ws.mergeCells(start, 2, rowNum - 1, 2);
        ws.getCell(start, 1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        ws.getCell(start, 2).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      }
    });
  });

  const t = calcTotals(q.items, q.service_rate, q.tax_rate);
  const pct = Math.round(t.serviceRate * 100);
  const footers = [
    ['1. 不含税小计 Subtotal excluding Tax', t.subtotalExTax],
    [`2. 公司服务费 Service Charge(${pct}%)`, t.serviceCharge],
    ['3. 国家及地方政府税收(6%) Government Tax', t.taxAmount],
    ['4. 含税总计 TOTAL', t.totalAmount],
  ];
  footers.forEach(([label, val]) => {
    const row = ws.getRow(rowNum);
    row.getCell(1).value = label;
    ws.mergeCells(rowNum, 1, rowNum, 6);
    row.getCell(7).value = val;
    row.getCell(7).numFmt = '#,##0.00';
    for (let c = 1; c <= 8; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
      cell.border = ALL_BORDERS;
      if (c === 1 || c === 7) cell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
    rowNum += 1;
  });

  if (Number(options.defaultRowHeight) > 0) {
    ws.eachRow((row) => {
      row.height = Number(options.defaultRowHeight);
    });
  }
  const rowHeights = options.rowHeights && typeof options.rowHeights === 'object' ? options.rowHeights : {};
  Object.keys(rowHeights).forEach((k) => {
    const rn = Number(k);
    const h = Number(rowHeights[k]);
    if (Number.isFinite(rn) && rn >= 1 && Number.isFinite(h) && h > 0) {
      ws.getRow(rn).height = h;
    }
  });
  return ws;
}

function safeSheetName(name, fallback) {
  const raw = String(name || fallback || 'Sheet').replace(/[\\/*?:[\]]/g, ' ').trim();
  const short = raw.slice(0, 31);
  return short || fallback || 'Sheet';
}

function writeBundleSummarySheet(workbook, ws, rows) {
  ws.columns = [
    { width: 12 }, // 日期
    { width: 10 }, // 城市
    { width: 14 }, // 客户名称
    { width: 14 }, // 类型
    { width: 10 }, // 人员沟通费
    { width: 10 }, // 设计费
    { width: 10 }, // 往返运费
    { width: 10 }, // 印刷品
    { width: 12 }, // 摄影师&相册
    { width: 11 }, // 小计
    { width: 11 }, // 服务费
    { width: 10 }, // 税费
    { width: 11 }, // 合计
    { width: 14 }, // 备注
  ];
  const header = [
    '日期',
    '城市',
    '客户名称',
    '类型',
    '人员沟通费',
    '设计费',
    '往返运费',
    '印刷品',
    '摄影师&相册',
    '小计',
    '服务费10%',
    '税费6%',
    '合计',
    '备注',
  ];
  const headSource = rows[0] || {};
  let rowNum = writeSheetHeaderInfo(ws, headSource, 1);
  applyHeaderGridBorders(ws, 1, rowNum - 1, ws.columns.length);
  addLogoToSheetRightAligned(workbook, ws, ws.columns.length, 1, 106, 40);
  rowNum += 1;
  const head = ws.getRow(rowNum);
  header.forEach((h, i) => {
    head.getCell(i + 1).value = h;
  });
  applyHeaderRowStyle(head);
  rowNum += 1;
  let totalSub = 0;
  let totalSvc = 0;
  let totalTax = 0;
  let totalAmt = 0;
  rows.forEach((r, idx) => {
    const row = ws.getRow(rowNum);
    const alt = idx % 2 === 1;
    const vals = [
      r.event_date || '',
      r.city || '',
      r.customer_name || '',
      r.event_type || '',
      0,
      0,
      0,
      0,
      0,
    ];
    vals.forEach((val, i) => {
      const cell = row.getCell(i + 1);
      cell.value = val;
      applyDataCellStyle(cell, { alignRight: i >= 4, alt });
      if (i >= 4) cell.numFmt = '#,##0.00';
    });
    const sub = Number(r.subtotal_ex_tax) || 0;
    const svc = Number(r.service_charge) || 0;
    const tax = Number(r.tax_amount) || 0;
    const amtVal = Number(r.total_amount) || 0;
    totalSub += sub;
    totalSvc += svc;
    totalTax += tax;
    totalAmt += amtVal;
    [sub, svc, tax, amtVal].forEach((v, i) => {
      const c = row.getCell(10 + i);
      c.value = v;
      c.numFmt = '#,##0.00';
      applyDataCellStyle(c, { alignRight: true, alt });
    });
    const remark = row.getCell(14);
    remark.value = '';
    applyDataCellStyle(remark, { alignRight: false, alt });
    rowNum += 1;
  });
  const foot = ws.getRow(rowNum);
  ws.mergeCells(rowNum, 1, rowNum, 9);
  foot.getCell(1).value = '多场含税总计';
  foot.getCell(1).font = { bold: true, size: 10 };
  foot.getCell(1).alignment = { vertical: 'middle', horizontal: 'right' };
  for (let c = 1; c <= 9; c++) {
    const cell = foot.getCell(c);
    cell.border = ALL_BORDERS;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
  }
  [totalSub, totalSvc, totalTax, totalAmt].forEach((v, i) => {
    const c = foot.getCell(10 + i);
    c.value = v;
    c.numFmt = '#,##0.00';
    c.font = { bold: true, size: 10 };
    c.alignment = { vertical: 'middle', horizontal: 'right' };
    c.border = ALL_BORDERS;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
  });
  const remarkFoot = foot.getCell(14);
  remarkFoot.border = ALL_BORDERS;
  remarkFoot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
}

async function buildBundledSingleQuotesWorkbook(quotes) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'remy-year-frame';
  wb.created = new Date();
  const summarySheet = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 3 }] });
  writeBundleSummarySheet(wb, summarySheet, quotes);
  const used = new Set(['Summary']);
  quotes.forEach((q, idx) => {
    const base = safeSheetName(q.project_name || q.project_code, `场次${idx + 1}`);
    let name = base;
    let seq = 2;
    while (used.has(name)) {
      const suffix = `-${seq++}`;
      name = safeSheetName(base.slice(0, Math.max(1, 31 - suffix.length)) + suffix, `场次${idx + 1}`);
    }
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 6 }] });
    writeSingleQuoteSheet(wb, ws, q);
  });
  return wb;
}

async function buildBundledSingleQuotesWorkbookWithLayout(quotes, layoutByQuoteId = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'remy-year-frame';
  wb.created = new Date();
  const summarySheet = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 3 }] });
  writeBundleSummarySheet(wb, summarySheet, quotes);
  const used = new Set(['Summary']);
  quotes.forEach((q, idx) => {
    const base = safeSheetName(q.project_name || q.project_code, `场次${idx + 1}`);
    let name = base;
    let seq = 2;
    while (used.has(name)) {
      const suffix = `-${seq++}`;
      name = safeSheetName(base.slice(0, Math.max(1, 31 - suffix.length)) + suffix, `场次${idx + 1}`);
    }
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 6 }] });
    const options = layoutByQuoteId[String(q.id)] || {};
    writeSingleQuoteSheet(wb, ws, q, options);
  });
  return wb;
}

async function buildQuotationWorkbook(q) {
  if (isMultiQuote(q)) return buildMultiQuoteWorkbook(q);
  return buildSingleQuoteWorkbook(q);
}

async function streamQuotationExcel(res, q) {
  const wb = await buildQuotationWorkbook(q);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', buildExcelContentDisposition(q));
  await wb.xlsx.write(res);
}

async function streamBundledQuotationExcel(res, quotes, filenameBase) {
  const wb = await buildBundledSingleQuotesWorkbook(quotes);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  const safe = String(filenameBase || 'quotation-summary').replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
  const asciiName = 'quotation-summary.xlsx';
  const encoded = encodeURIComponent(`${safe || 'quotation-summary'}.xlsx`);
  res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`);
  await wb.xlsx.write(res);
}

async function streamBundledQuotationExcelWithLayout(res, quotes, filenameBase, layoutByQuoteId) {
  const wb = await buildBundledSingleQuotesWorkbookWithLayout(quotes, layoutByQuoteId);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  const safe = String(filenameBase || 'quotation-summary').replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
  const asciiName = 'quotation-summary.xlsx';
  const encoded = encodeURIComponent(`${safe || 'quotation-summary'}.xlsx`);
  res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`);
  await wb.xlsx.write(res);
}

module.exports = {
  buildQuotationWorkbook,
  buildBundledSingleQuotesWorkbook,
  streamQuotationExcel,
  streamBundledQuotationExcel,
  streamBundledQuotationExcelWithLayout,
  buildExcelContentDisposition,
};
