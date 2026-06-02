const ExcelJS = require('exceljs');
const { payloadFromReimbursementRecord } = require('./exportPayload');

const COL_COUNT = 13;
const HEADER_FILL = 'FFECECEC';
const TITLE_FONT = { bold: true, size: 16 };
const META_FONT = { size: 10 };
const HEADER_FONT = { bold: true, size: 9 };
const BORDER_THIN = { style: 'thin', color: { argb: 'FF000000' } };
const ALL_BORDERS = {
  top: BORDER_THIN,
  left: BORDER_THIN,
  bottom: BORDER_THIN,
  right: BORDER_THIN,
};

const HEADERS = [
  '序号',
  '项目编号',
  '板块',
  '类别',
  '内容说明',
  '报销金额含税',
  '费用归属',
  '发票',
  '发票日期',
  '发票号码',
  '收款方',
  '报销状态',
  '备注',
];

function applyBorderRange(ws, r1, c1, r2, c2) {
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      ws.getCell(r, c).border = ALL_BORDERS;
    }
  }
}

function styleHeaderRow(row) {
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = HEADER_FONT;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = ALL_BORDERS;
  });
}

function styleDataRow(row, { alt }) {
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.border = ALL_BORDERS;
    const isMoney = col === 6;
    const wrapCols = new Set([5, 13, 2]);
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: wrapCols.has(col),
    };
    if (col === 2 || col === 10) {
      cell.font = { size: col === 2 ? 10 : 9 };
    }
    if (isMoney) cell.numFmt = '¥#,##0.00';
    if (alt) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } };
    }
  });
}

/**
 * @param {import('express').Response} res
 * @param {object} record reimbursements 行
 */
async function writeReimbursementExcel(res, record) {
  const p = payloadFromReimbursementRecord(record);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Remy Year Frame';
  const ws = wb.addWorksheet('盛融报销单', {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    views: [{ state: 'frozen', ySplit: 5, xSplit: 0 }],
  });

  const widths = [5, 14, 7, 8, 17, 10, 6, 5, 8, 20, 8, 7, 14];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  ws.mergeCells(1, 1, 1, COL_COUNT);
  ws.getCell(1, 1).value = '盛融报销单';
  ws.getCell(1, 1).font = TITLE_FONT;
  ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  const dStr = p.date || '—';
  const monthLabel = dStr.length >= 7 ? `${parseInt(dStr.slice(5, 7), 10)}月` : '—';
  ws.mergeCells(2, 1, 2, COL_COUNT);
  ws.getCell(2, 1).value = `提报月份：${monthLabel}    申请日期：${dStr}    品牌：${p.brand}`;
  ws.getCell(2, 1).font = META_FONT;
  ws.getCell(2, 1).alignment = { vertical: 'middle', wrapText: true };
  ws.getRow(2).height = 18;

  if (p.remarks) {
    ws.mergeCells(3, 1, 3, COL_COUNT);
    ws.getCell(3, 1).value = `单据备注：${p.remarks}`;
    ws.getCell(3, 1).font = { size: 9, color: { argb: 'FF444444' } };
    ws.getCell(3, 1).alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(3).height = 16;
  }

  const headerRowNum = p.remarks ? 5 : 4;
  const headerRow = ws.getRow(headerRowNum);
  HEADERS.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(headerRow);

  const dataRows = p.detail_rows.length ? p.detail_rows : [];
  const minRows = dataRows.length >= 3 ? dataRows.length : 3;
  const payee = p.payee_name;

  let rowNum = headerRowNum + 1;
  for (let i = 0; i < minRows; i += 1) {
    const row = dataRows[i];
    const dataRow = ws.getRow(rowNum);
    if (row) {
      dataRow.getCell(1).value = i + 1;
      dataRow.getCell(2).value = row.line_project || '—';
      dataRow.getCell(3).value = row.block_label || '';
      dataRow.getCell(4).value = row.category_label || '';
      dataRow.getCell(5).value = row.description || '';
      dataRow.getCell(6).value = round2(row.subtotal);
      const cm = parseInt(row.cost_month, 10);
      dataRow.getCell(7).value = Number.isFinite(cm) && cm >= 1 && cm <= 12 ? `${cm}月` : '';
      dataRow.getCell(8).value = row.invoice || '无';
      dataRow.getCell(9).value = row.invoice_date ? String(row.invoice_date).slice(0, 10) : '';
      dataRow.getCell(10).value = row.invoice_no || '';
      dataRow.getCell(11).value = payee;
      dataRow.getCell(12).value = p.claim_status_label;
      dataRow.getCell(13).value = row.remarks || '';
    } else {
      dataRow.getCell(1).value = i + 1;
    }
    styleDataRow(dataRow, { alt: i % 2 === 1 });
    dataRow.height = 18;
    rowNum += 1;
  }

  const footerStart = rowNum + 1;
  ws.mergeCells(footerStart, 1, footerStart, 6);
  ws.getCell(footerStart, 1).value = `合计金额（含税）：${p.gross_total}`;
  ws.getCell(footerStart, 1).font = { bold: true, size: 10 };

  ws.mergeCells(footerStart, 7, footerStart, 9);
  ws.getCell(footerStart, 7).value = `备用金抵扣：${p.advance_amount > 0 ? p.advance_amount : '—'}`;
  ws.getCell(footerStart, 7).font = { bold: true, size: 10 };
  ws.getCell(footerStart, 7).numFmt = p.advance_amount > 0 ? '¥#,##0.00' : undefined;

  ws.mergeCells(footerStart + 1, 1, footerStart + 1, 6);
  ws.getCell(footerStart + 1, 1).value = `抵扣后应付：${p.amount}`;
  ws.getCell(footerStart + 1, 1).font = { bold: true, size: 10 };

  ws.mergeCells(footerStart + 1, 7, footerStart + 1, COL_COUNT);
  ws.getCell(footerStart + 1, 7).value = `填报人：${record.operator || record.payee_name || '—'}    已计入项目成本：${p.merged_into_activity ? '是' : '否'}`;
  ws.getCell(footerStart + 1, 7).font = { size: 10 };

  applyBorderRange(ws, headerRowNum, 1, rowNum - 1, COL_COUNT);

  const safeName = `盛融报销单_${p.id}_${dStr || 'export'}.xlsx`;
  const encoded = encodeURIComponent(safeName);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="reimbursement-${p.id}.xlsx"; filename*=UTF-8''${encoded}`,
  );
  await wb.xlsx.write(res);
}

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

module.exports = { writeReimbursementExcel, payloadFromReimbursementRecord };
