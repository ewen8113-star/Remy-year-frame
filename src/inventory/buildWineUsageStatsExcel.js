const ExcelJS = require('exceljs');
const { todayYmd } = require('../lib/businessTime');

const HEADER_FILL = 'FF948A54';
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
const ALT_FILL = 'FFF9F9F9';
const BORDER_THIN = { style: 'thin', color: { argb: 'FFB0B0B0' } };
const ALL_BORDERS = {
  top: BORDER_THIN,
  left: BORDER_THIN,
  bottom: BORDER_THIN,
  right: BORDER_THIN,
};

function wineUsageStatsFilterText(filters) {
  if (!filters) return '';
  return [
    filters.year_frame_id != null ? `年度 ID：${filters.year_frame_id}` : null,
    filters.region ? `区域：${filters.region}` : null,
    filters.belonging ? `归属：${filters.belonging}` : null,
    filters.project_code ? `项目编号含：${filters.project_code}` : null,
    filters.date_from ? `活动日起：${filters.date_from}` : null,
    filters.date_to ? `活动日止：${filters.date_to}` : null,
    filters.month ? `月份：${filters.month}` : null,
  ]
    .filter(Boolean)
    .join(' ｜ ');
}

function applyHeaderRowStyle(row) {
  row.height = 28;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = HEADER_FONT;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = ALL_BORDERS;
  });
}

function applyDataCellStyle(cell, { alignRight, alt, alignLeft }) {
  cell.border = ALL_BORDERS;
  cell.alignment = {
    vertical: 'middle',
    horizontal: alignRight ? 'right' : alignLeft ? 'left' : 'center',
    wrapText: true,
  };
  if (alt) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_FILL } };
  }
}

/**
 * @param {import('express').Response} res
 * @param {{ wines: {label:string,total:number}[], rows: object[], summary: object, filters: object }} data
 */
async function writeWineUsageStatsExcel(res, data) {
  const { wines = [], rows = [], summary = {}, filters = {} } = data;
  const wineLabels = wines.map((w) => w.label);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Remy Year Frame';
  const ws = wb.addWorksheet('用酒统计', {
    views: [{ state: 'frozen', ySplit: 5, xSplit: 3 }],
  });

  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 42;
  ws.getColumn(3).width = 14;
  for (let c = 4; c <= 3 + wineLabels.length; c += 1) {
    ws.getColumn(c).width = 14;
  }

  ws.mergeCells(1, 1, 1, Math.max(3 + wineLabels.length, 4));
  ws.getCell(1, 1).value = '用酒统计';
  ws.getCell(1, 1).font = { bold: true, size: 14 };

  ws.mergeCells(2, 1, 2, Math.max(3 + wineLabels.length, 4));
  ws.getCell(2, 1).value = `场次 ${summary.session_count ?? 0} · 固定列 ${summary.wine_column_count ?? wines.length} · 有出库 ${summary.wine_kind_count ?? 0} 种 · 合计 ${summary.total_bottles ?? 0} 瓶`;
  ws.getCell(2, 1).font = { size: 10 };

  const filterLine = wineUsageStatsFilterText(filters);
  if (filterLine) {
    ws.mergeCells(3, 1, 3, Math.max(3 + wineLabels.length, 4));
    ws.getCell(3, 1).value = filterLine;
    ws.getCell(3, 1).font = { size: 9, color: { argb: 'FF444444' } };
    ws.getCell(3, 1).alignment = { wrapText: true, vertical: 'top' };
  }

  const headerRowNum = 5;
  const headerRow = ws.getRow(headerRowNum);
  const headers = [
    '区域',
    '项目编号',
    '归属',
    ...wines.map((w) => {
      const name =
        w.isPlaceholder || String(w.label || '').startsWith('__slot__')
          ? w.displayName || w.label
          : w.label || w.displayName;
      const vol = w.volume ? String(w.volume) : '';
      const lines = [name];
      if (vol) lines.push(vol);
      lines.push(`(合计 ${w.total})`);
      return lines.join('\n');
    }),
  ];
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  applyHeaderRowStyle(headerRow);

  let dataRowNum = headerRowNum + 1;
  if (!rows.length) {
    const row = ws.getRow(dataRowNum);
    row.getCell(1).value = '当前筛选条件下暂无已标记酒类的出库记录';
    ws.mergeCells(dataRowNum, 1, dataRowNum, Math.max(3 + wineLabels.length, 4));
    dataRowNum += 1;
  } else {
    rows.forEach((r, idx) => {
      const row = ws.getRow(dataRowNum);
      row.getCell(1).value = r.region || '—';
      row.getCell(2).value = r.project_code || '—';
      row.getCell(3).value = r.belonging || '—';
      wineLabels.forEach((lbl, wi) => {
        const q = r.quantities && r.quantities[lbl];
        const cell = row.getCell(4 + wi);
        if (q > 0) {
          cell.value = q;
          cell.numFmt = '0';
        } else {
          cell.value = '—';
        }
        applyDataCellStyle(cell, { alignRight: q > 0, alt: idx % 2 === 1 });
      });
      applyDataCellStyle(row.getCell(1), { alt: idx % 2 === 1 });
      applyDataCellStyle(row.getCell(2), { alignLeft: true, alt: idx % 2 === 1 });
      applyDataCellStyle(row.getCell(3), { alt: idx % 2 === 1 });
      dataRowNum += 1;
    });

    const totalRow = ws.getRow(dataRowNum);
    totalRow.getCell(1).value = '合计';
    ws.mergeCells(dataRowNum, 1, dataRowNum, 3);
    totalRow.getCell(1).font = { bold: true };
    wineLabels.forEach((lbl, wi) => {
      const w = wines.find((x) => x.label === lbl);
      const cell = totalRow.getCell(4 + wi);
      cell.value = w ? w.total : 0;
      cell.numFmt = '0';
      cell.font = { bold: true };
      applyDataCellStyle(cell, { alignRight: true });
    });
    applyHeaderRowStyle(totalRow);
  }

  ws.getRow(4).height = 6;

  const fname = `用酒统计_${todayYmd()}.xlsx`;
  const filenameEnc = encodeURIComponent(fname);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="wine-usage-stats.xlsx"; filename*=UTF-8''${filenameEnc}`,
  );
  await wb.xlsx.write(res);
}

module.exports = { writeWineUsageStatsExcel };
