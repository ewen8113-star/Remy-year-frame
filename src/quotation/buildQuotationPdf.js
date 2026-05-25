const path = require('path');
const fs = require('fs');
const PdfPrinter = require('pdfmake/js/Printer').default;
const URLResolver = require('pdfmake/js/URLResolver').default;
const pdfVirtualFs = require('pdfmake/js/virtual-fs').default;
const robotoVfsMap = require('pdfmake/build/vfs_fonts.js');
const cnVfsMap = require('pdfmake-support-chinese-fonts/vfs_fonts').pdfMake.vfs;
const {
  buildMultiPreviewTableData,
  isMultiQuote,
  fmtNum: fmtNumMulti,
  sanitizeSessionRemarks,
} = require('./multiPreviewTable');
const { quoteSheetDisplayName, quoteSheetHeaderProjectName } = require('./quoteSheetLabel');

const LOGO_PATH = path.join(__dirname, '../../public/logo.png');
const LOGO_PRINT_PATH = path.join(__dirname, '../../public/logo-print.png');

const systemUnicodeFontPath = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
const hasSystemUnicodeFont = fs.existsSync(systemUnicodeFontPath);

let _vfsMerged = false;

function ensurePdfVfs() {
  if (_vfsMerged) return;
  [robotoVfsMap, cnVfsMap].forEach((map) => {
    Object.keys(map).forEach((name) => {
      pdfVirtualFs.writeFileSync(name, Buffer.from(map[name], 'base64'));
    });
  });
  _vfsMerged = true;
}

const fangzhenFontDef = {
  normal: 'fzhei-jt.TTF',
  bold: 'fzhei-jt.TTF',
  italics: 'fzhei-jt.TTF',
  bolditalics: 'fzhei-jt.TTF',
};

const pdfPrinterFonts = hasSystemUnicodeFont
  ? {
      unicode: {
        normal: systemUnicodeFontPath,
        bold: systemUnicodeFontPath,
        italics: systemUnicodeFontPath,
        bolditalics: systemUnicodeFontPath,
      },
      fangzhen: fangzhenFontDef,
    }
  : { fangzhen: fangzhenFontDef };

/** pdfmake 0.3：文档内 bold 样式须在 docDefinition.fonts 中声明 */
const docDefinitionFonts = hasSystemUnicodeFont
  ? {
      unicode: {
        normal: systemUnicodeFontPath,
        bold: systemUnicodeFontPath,
        italics: systemUnicodeFontPath,
        bolditalics: systemUnicodeFontPath,
      },
      fangzhen: fangzhenFontDef,
    }
  : { fangzhen: fangzhenFontDef };

const defaultFont = hasSystemUnicodeFont ? 'unicode' : 'fangzhen';

function roundMoney(v) {
  return Math.round((parseFloat(v) || 0) * 100) / 100;
}

function fmtNum(n, dec = 2) {
  const x = parseFloat(n);
  if (!Number.isFinite(x)) return '0.00';
  return x.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function itemSubtotal(it) {
  return roundMoney((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0));
}

const {
  compareQuotationCodes,
  formatSectionHeaderLabel,
} = require('./quotationCodes');

function sortGroupedQuotationSections(sections) {
  sections.sort((a, b) => compareQuotationCodes(a.section_code, b.section_code));
  sections.forEach((sec) => {
    sec.subsections.sort((a, b) => compareQuotationCodes(a.subsection_code, b.subsection_code));
    sec.subsections.forEach((sub) => {
      sub.items.sort(
        (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0)
      );
    });
  });
  return sections;
}

function groupItems(items) {
  const sections = [];
  const secMap = new Map();
  (items || []).forEach((it) => {
      const sk = `${it.section_code}|${it.section_name}`;
      if (!secMap.has(sk)) {
        const sec = {
          section_code: it.section_code,
          section_name: it.section_name,
          subsections: [],
          sectionSubtotal: 0,
        };
        secMap.set(sk, sec);
        sections.push(sec);
      }
      const sec = secMap.get(sk);
      let sub = sec.subsections.find((s) => s.subsection_code === it.subsection_code);
      if (!sub) {
        sub = { subsection_code: it.subsection_code, subsection_name: it.subsection_name, items: [] };
        sec.subsections.push(sub);
      }
      sub.items.push(it);
      sec.sectionSubtotal += itemSubtotal(it);
    });
  sections.forEach((s) => {
    s.sectionSubtotal = roundMoney(s.sectionSubtotal);
  });
  return sortGroupedQuotationSections(sections);
}

function calcTotals(items, serviceRate, taxRate) {
  const subtotalExTax = roundMoney((items || []).reduce((s, it) => s + itemSubtotal(it), 0));
  const sr = Math.min(0.15, Math.max(0.1, parseFloat(serviceRate) || 0.1));
  const tr = parseFloat(taxRate) || 0.06;
  const serviceCharge = roundMoney(subtotalExTax * sr);
  const taxAmount = roundMoney((subtotalExTax + serviceCharge) * tr);
  const totalAmount = roundMoney(subtotalExTax + serviceCharge + taxAmount);
  return { subtotalExTax, serviceCharge, taxAmount, totalAmount, serviceRate: sr };
}

function labelLine(label, value) {
  return {
    text: [{ text: String(label), bold: true }, String(value || '')],
    margin: [0, 0, 0, 2],
  };
}

function resolveLogoImage() {
  const logoPath = fs.existsSync(LOGO_PRINT_PATH) ? LOGO_PRINT_PATH : LOGO_PATH;
  if (!fs.existsSync(logoPath)) return null;
  try {
    return logoPath;
  } catch {
    return null;
  }
}

function buildMultiTableBodyFromData(tableData, stylePrefix = '') {
  const layout = tableData;
  const body = [
    layout.headers.map((h) => ({ text: h, style: `${stylePrefix}thC` })),
  ];

  layout.dataRows.forEach((dr, idx) => {
    body.push(
      dr.cells.map((cell, ci) => {
        const isMoney = ci >= layout.feeColStart && ci <= layout.totalCol && ci !== layout.remarksCol;
        const isRemarks = ci === layout.remarksCol;
        let text;
        if (isRemarks) {
          text = sanitizeSessionRemarks(dr.session?.remarks ?? cell);
        } else if (isMoney) {
          text = fmtNumMulti(cell);
        } else {
          text = String(cell);
          if (text === '—') text = '';
        }
        return {
          text,
          style: isRemarks || ci < layout.feeColStart ? `${stylePrefix}tdL` : `${stylePrefix}tdR`,
          fillColor: idx % 2 ? '#f9f9f9' : null,
        };
      })
    );
  });

  const span = layout.spanBeforeTotals;
  const fc = layout.footerCells;
  const footerRow = [
    { text: String(fc[0] || '多场含税总计'), style: `${stylePrefix}footer`, colSpan: span, alignment: 'right' },
    ...Array(Math.max(0, span - 1)).fill(''),
  ];
  (layout.columns?.totalColumns || []).forEach((col, i) => {
    footerRow.push({
      text: fmtNumMulti(fc[span + i]),
      style: `${stylePrefix}footerR`,
      alignment: 'right',
    });
  });
  footerRow.push({ text: '', style: `${stylePrefix}tdL` });
  body.push(footerRow);

  const moneyEnd = layout.totalCol;
  const widths = layout.headers.map((_, i) => {
    if (i === layout.remarksCol) return '8%';
    if (i === 0) return '9%';
    if (i === 1 || i === 2) return '8%';
    if (i === 3) return '10%';
    if (i >= layout.feeColStart && i <= moneyEnd) return '*';
    return 'auto';
  });

  return { body, widths, layout };
}

function buildMultiTableBody(q, stylePrefix = '', opts = {}) {
  const tableData = opts.summaryTable || buildMultiPreviewTableData(q);
  return buildMultiTableBodyFromData(tableData, stylePrefix);
}

function countSingleTableRows(q) {
  let n = 1;
  groupItems(q.items).forEach((sec) => {
    n += 1;
    sec.subsections.forEach((sub) => {
      n += Math.max(1, (sub.items || []).length);
    });
  });
  return n + 4;
}

/** 按行数估算字号，使表头+明细+合计尽量落在横向 A4 一页内 */
function compactPdfScale(rowCount) {
  const tableBudgetPt = 500;
  const headerRowPt = 11;
  const rowH = 7.2;
  const needed = headerRowPt + rowCount * rowH;
  let font = 6.2;
  let pad = 1;
  let rowHeight = rowH;
  if (needed > tableBudgetPt) {
    const ratio = tableBudgetPt / needed;
    font = Math.max(4.2, 6.2 * ratio);
    pad = Math.max(0.25, 1 * ratio);
    rowHeight = Math.max(5.5, rowH * ratio);
  }
  return {
    font: Math.round(font * 10) / 10,
    pad: Math.round(pad * 10) / 10,
    lh: 0.9,
    rowHeight: Math.round(rowHeight * 10) / 10,
    prefix: 'cp',
  };
}

function pdfThCell(text, style) {
  return { text, style, alignment: 'center', verticalAlignment: 'middle' };
}

function pdfMergeCell(text, style, rowSpan) {
  return { text, style, rowSpan, alignment: 'center', verticalAlignment: 'middle' };
}

/** 按最长备注估算列宽占比（偏保守，避免备注列过宽） */
function estimateRemarksColPercent(q) {
  let maxLen = 0;
  (q.items || []).forEach((it) => {
    const r = String(it.remarks || '').trim();
    const len = [...r].length;
    if (len > maxLen) maxLen = len;
  });
  if (!maxLen) return 10;
  return Math.min(20, Math.max(10, Math.ceil(maxLen * 0.55) + 6));
}

function widthsFromLayoutPercent(layout, fallbackWidths) {
  const cw = layout && layout.columnWidths;
  if (!Array.isArray(cw) || cw.length !== 8) return fallbackWidths;
  const nums = cw.map((x) => parseFloat(x)).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length !== 8) return fallbackWidths;
  const sum = nums.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return fallbackWidths;
  return nums.map((n) => `${((n / sum) * 100).toFixed(1)}%`);
}

function buildSingleTableWidths(q, opts = {}) {
  const compact = !!opts.compact;
  const bundleHeader = !!opts.headerSource;
  const fallback = !compact
    ? ['8%', '10%', '28%', '8%', '8%', '10%', '12%', '16%']
    : (() => {
        const remarksPct = estimateRemarksColPercent(q);
        const fixedSum = 5 + 7 + 6 + 6 + 8 + 9;
        const descPct = 100 - remarksPct - fixedSum;
        return ['5%', '7%', `${descPct}%`, '6%', '6%', '8%', '9%', `${remarksPct}%`];
      })();
  return widthsFromLayoutPercent(opts.layout, fallback);
}

function buildPdfStyles(compactScale) {
  if (!compactScale) {
    return {
      th: { bold: true, fillColor: '#948a54', color: '#ffffff', fontSize: 8, alignment: 'center' },
      thC: { bold: true, fillColor: '#948a54', color: '#ffffff', alignment: 'center', fontSize: 7 },
      thR: { bold: true, fillColor: '#948a54', color: '#ffffff', alignment: 'center', fontSize: 8 },
      section: { bold: true, fillColor: '#c4bd97', fontSize: 9 },
      sectionR: { bold: true, fillColor: '#c4bd97', fontSize: 9 },
      footer: { bold: true, fillColor: '#c4bd97', fontSize: 9 },
      footerR: { bold: true, fillColor: '#c4bd97', fontSize: 9 },
      tdL: { alignment: 'left', fontSize: 7 },
      tdC: { alignment: 'center', fontSize: 7, verticalAlignment: 'middle' },
      tdR: { alignment: 'right', fontSize: 7 },
    };
  }
  const f = compactScale.font;
  const p = `${compactScale.prefix}`;
  return {
    th: { bold: true, fillColor: '#948a54', color: '#ffffff', fontSize: f },
    thC: { bold: true, fillColor: '#948a54', color: '#ffffff', alignment: 'center', fontSize: f - 0.5 },
    thR: { bold: true, fillColor: '#948a54', color: '#ffffff', alignment: 'right', fontSize: f },
    section: { bold: true, fillColor: '#c4bd97', fontSize: f },
    sectionR: { bold: true, fillColor: '#c4bd97', fontSize: f },
    footer: { bold: true, fillColor: '#c4bd97', fontSize: f },
    footerR: { bold: true, fillColor: '#c4bd97', fontSize: f },
    tdL: { alignment: 'left', fontSize: f },
    tdC: { alignment: 'center', fontSize: f },
    tdR: { alignment: 'right', fontSize: f },
    [`${p}th`]: { bold: true, fillColor: '#948a54', color: '#ffffff', fontSize: f, alignment: 'center' },
    [`${p}thC`]: { bold: true, fillColor: '#948a54', color: '#ffffff', alignment: 'center', fontSize: f - 0.5 },
    [`${p}thR`]: { bold: true, fillColor: '#948a54', color: '#ffffff', alignment: 'center', fontSize: f - 0.5 },
    [`${p}section`]: { bold: true, fillColor: '#c4bd97', fontSize: f },
    [`${p}sectionR`]: { bold: true, fillColor: '#c4bd97', fontSize: f },
    [`${p}footer`]: { bold: true, fillColor: '#c4bd97', fontSize: f },
    [`${p}footerR`]: { bold: true, fillColor: '#c4bd97', fontSize: f },
    [`${p}tdL`]: { alignment: 'left', fontSize: f },
    [`${p}tdC`]: { alignment: 'center', fontSize: f, verticalAlignment: 'middle' },
    [`${p}tdR`]: { alignment: 'right', fontSize: f },
  };
}

function buildTableBody(q, opts = {}) {
  const compact = !!opts.compact;
  const bundleHeader = !!opts.headerSource;
  const scale = compact ? compactPdfScale(countSingleTableRows(q)) : null;
  const p = scale ? `${scale.prefix}` : '';
  const useShortHeader = compact && !bundleHeader;
  const thStyle = `${p}thC`;
  const body = useShortHeader
    ? [
        [
          pdfThCell('内容', `${p}thC`),
          pdfThCell('', `${p}thC`),
          pdfThCell('说明', `${p}thC`),
          pdfThCell('数量', thStyle),
          pdfThCell('单位', thStyle),
          pdfThCell('单价', thStyle),
          pdfThCell('小计', thStyle),
          pdfThCell('备注', thStyle),
        ],
      ]
    : [
        [
          pdfThCell('内容\nItem', thStyle),
          pdfThCell('分类', thStyle),
          pdfThCell('说明\nSummary', thStyle),
          pdfThCell('数量\nQty', thStyle),
          pdfThCell('单位\nUnit', thStyle),
          pdfThCell('单价\nPrice', thStyle),
          pdfThCell('单项小计\nSubtotal', thStyle),
          pdfThCell('备注\nRemarks', thStyle),
        ],
      ];

  const groups = groupItems(q.items);
  groups.forEach((sec) => {
    body.push([
      {
        text: formatSectionHeaderLabel(sec.section_code, sec.section_name),
        style: `${p}section`,
        colSpan: 6,
        alignment: 'left',
        verticalAlignment: 'middle',
      },
      '',
      '',
      '',
      '',
      '',
      {
        text: fmtNum(sec.sectionSubtotal),
        style: `${p}sectionR`,
        alignment: 'right',
        verticalAlignment: 'middle',
      },
      '',
    ]);
    sec.subsections.forEach((sub) => {
      const rowSpan = Math.max(1, (sub.items || []).length);
      sub.items.forEach((it, idx) => {
        const subCodeCell =
          idx === 0
            ? pdfMergeCell(String(sub.subsection_code || ''), `${p}tdC`, rowSpan)
            : { text: '', style: `${p}tdC` };
        const subNameCell = {
          text: String(it.item_category || sub.subsection_name || ''),
          style: `${p}tdC`,
        };
        const desc = String(it.description || '');
        const cellStyle = compact ? { fontSize: scale.font, lineHeight: scale.lh } : {};
        body.push([
          { ...subCodeCell, ...cellStyle },
          { ...subNameCell, ...cellStyle },
          { text: desc, style: `${p}tdL`, ...cellStyle },
          { text: fmtNum(it.quantity, 0), style: `${p}tdC`, ...cellStyle },
          { text: String(it.unit || ''), style: `${p}tdC`, ...cellStyle },
          { text: fmtNum(it.unit_price), style: `${p}tdR`, ...cellStyle },
          { text: fmtNum(itemSubtotal(it)), style: `${p}tdR`, ...cellStyle },
          { text: String(it.remarks || ''), style: `${p}tdL`, ...cellStyle },
        ]);
      });
    });
  });

  const t = calcTotals(q.items, q.service_rate, q.tax_rate);
  const pct = Math.round(t.serviceRate * 100);
  const pushFooter = (label, val) => {
    body.push([
      { text: label, style: `${p}footer`, colSpan: 6, alignment: 'right' },
      '',
      '',
      '',
      '',
      '',
      { text: fmtNum(val), style: `${p}footerR`, alignment: 'right' },
      '',
    ]);
  };
  if (compact) {
    pushFooter('1. 不含税小计', t.subtotalExTax);
    pushFooter(`2. 服务费(${pct}%)`, t.serviceCharge);
    pushFooter('3. 税费(6%)', t.taxAmount);
    pushFooter('4. 含税总计', t.totalAmount);
  } else {
    pushFooter('1. 不含税小计 Subtotal excluding Tax', t.subtotalExTax);
    pushFooter(`2. 公司服务费 Service Charge(${pct}%)`, t.serviceCharge);
    pushFooter('3. 国家及地方政府税收(6%) Government Tax', t.taxAmount);
    pushFooter('4. 含税总计 TOTAL', t.totalAmount);
  }

  const widths = buildSingleTableWidths(q, opts);
  const layoutRowH = Number(opts.layout?.defaultRowHeight);
  if (layoutRowH > 0 && scale) scale.rowHeight = layoutRowH;

  return { body, totals: t, widths, tableLayout: scale, bundleHeader };
}

function buildPdfTableLayout(pad = 2) {
  return {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#888888',
    vLineColor: () => '#888888',
    paddingTop: () => pad,
    paddingBottom: () => pad,
    paddingLeft: () => Math.max(1, pad),
    paddingRight: () => Math.max(1, pad),
  };
}

const PDF_STYLES = buildPdfStyles(null);

function buildQuotationContentParts(q, opts = {}) {
  const compact = !!opts.compact;
  const useSummaryHeader = opts.headerSource && typeof opts.headerSource === 'object';
  const headerQ = useSummaryHeader ? opts.headerSource : q;
  const summaryStyleHeader = useSummaryHeader || !compact;
  const projectNameLine =
    opts.headerProjectName != null && String(opts.headerProjectName).trim() !== ''
      ? String(opts.headerProjectName).trim()
      : String(headerQ.project_name || '').trim();
  const headerStack = [
    labelLine('Client / Brand 客户/品牌：', headerQ.client_brand),
    labelLine('Attend to 客户方负责人：', headerQ.client_contact),
    labelLine('Project Name 项目名称：', projectNameLine),
  ];

  const headerBlock = { width: '*', stack: headerStack };
  const logoPath = opts.skipLogo ? null : resolveLogoImage();
  const logoFit = opts.compactLogo ? [62, 28] : summaryStyleHeader ? [88, 40] : [100, 50];
  const headerMargin = summaryStyleHeader ? [0, 0, 0, 8] : [0, 0, 0, 2];
  const topRow = logoPath
    ? {
        columns: [
          headerBlock,
          {
            width: logoFit[0],
            image: logoPath,
            fit: logoFit,
          },
        ],
        columnGap: summaryStyleHeader ? 12 : 8,
        margin: headerMargin,
      }
    : { stack: headerStack, margin: headerMargin };

  const isMulti = isMultiQuote(q) || !!opts.summaryTable;
  const tablePart = isMulti
    ? (() => {
        const { body, widths } = buildMultiTableBody(q, '', opts);
        return {
          table: { widths, headerRows: 1, body },
          layout: buildPdfTableLayout(compact ? 1 : 2),
        };
      })()
    : (() => {
        const { body, widths, tableLayout: tblScale, bundleHeader } = buildTableBody(q, opts);
        const rowH = tblScale?.rowHeight;
        return {
          table: {
            widths,
            headerRows: 1,
            body,
            dontBreakRows: true,
            ...(compact && rowH
              ? {
                  heights: (i) => {
                    if (i === 0) return bundleHeader ? 18 : Math.min(11, rowH + 2);
                    return rowH;
                  },
                }
              : {}),
          },
          layout: buildPdfTableLayout(tblScale?.pad ?? (compact ? 0.8 : 2)),
        };
      })();

  return [topRow, tablePart];
}

function buildQuotationDocDefinition(q, opts = {}) {
  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 28, 28, 28],
    fonts: docDefinitionFonts,
    defaultStyle: { font: defaultFont, fontSize: 9, lineHeight: 1.15 },
    content: buildQuotationContentParts(q, opts),
    styles: PDF_STYLES,
  };
}

/** 合并导出：Summary（多场）+ 各单场明细，每场新页 */
function buildBundledQuotationDocDefinition(multiQuote, singles, opts = {}) {
  const layoutByQuoteId =
    opts.layoutByQuoteId && typeof opts.layoutByQuoteId === 'object' ? opts.layoutByQuoteId : {};
  const pageOrientation = opts.pageOrientation === 'portrait' ? 'portrait' : 'landscape';
  const styles = { ...PDF_STYLES };
  (singles || []).forEach((q) => {
    Object.assign(styles, buildPdfStyles(compactPdfScale(countSingleTableRows(q))));
  });

  const { buildBundleSummaryTableData } = require('./multiPreviewTable');
  const summaryTable = buildBundleSummaryTableData(singles);
  const content = [
    { text: 'Summary', style: 'section', margin: [0, 0, 0, 4] },
    ...buildQuotationContentParts(multiQuote, {
      layoutByQuoteId: opts.layoutByQuoteId,
      pageOrientation: opts.pageOrientation,
      compact: false,
      headerSource: multiQuote,
      summaryTable,
    }),
  ];
  (singles || []).forEach((q) => {
    const layout = layoutByQuoteId[String(q.id)] || {};
    content.push({ text: '', pageBreak: 'before' });
    content.push(
      ...buildQuotationContentParts(q, {
        compact: true,
        compactLogo: true,
        layout,
        headerProjectName: quoteSheetHeaderProjectName(q),
      })
    );
  });
  return {
    pageSize: 'A4',
    pageOrientation,
    pageMargins: [20, 20, 20, 20],
    fonts: docDefinitionFonts,
    defaultStyle: { font: defaultFont, fontSize: 8, lineHeight: 1.08 },
    content,
    styles,
  };
}

async function createPdfDocumentFromDefinition(docDef) {
  ensurePdfVfs();
  const urlResolver = new URLResolver(pdfVirtualFs);
  const printer = new PdfPrinter(pdfPrinterFonts, pdfVirtualFs, urlResolver);
  return printer.createPdfKitDocument(docDef);
}

async function createPdfDocument(q) {
  try {
    return await createPdfDocumentFromDefinition(buildQuotationDocDefinition(q));
  } catch (e) {
    console.warn('报价 PDF（含 Logo）生成失败，重试无 Logo：', e.message);
    return createPdfDocumentFromDefinition(buildQuotationDocDefinition(q, { skipLogo: true }));
  }
}

async function createBundledPdfDocument(multiQuote, singles, opts = {}) {
  try {
    return await createPdfDocumentFromDefinition(buildBundledQuotationDocDefinition(multiQuote, singles, opts));
  } catch (e) {
    console.warn('合并报价 PDF（含 Logo）生成失败，重试无 Logo：', e.message);
    return createPdfDocumentFromDefinition(
      buildBundledQuotationDocDefinition(multiQuote, singles, { ...opts, skipLogo: true })
    );
  }
}

function buildPdfContentDisposition(q) {
  const base =
    [q.project_name, q.quotation_no].filter(Boolean).join('-').trim() ||
    `quotation-${q.id || 'export'}`;
  const displayName = String(base)
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 80);
  // 与出库单一致：filename 仅 ASCII；中文名走 filename*（禁止在 filename="..." 里写中文）
  const asciiName = `quotation-${q.id || 'export'}.pdf`;
  const encoded = encodeURIComponent(`${displayName || `quotation-${q.id}`}.pdf`);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

function pipePdfToResponse(res, pdfDoc, contentDisposition) {
  return new Promise((resolve, reject) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition);
    pdfDoc.on('error', reject);
    res.on('error', reject);
    pdfDoc.on('end', resolve);
    pdfDoc.pipe(res);
    pdfDoc.end();
  });
}

async function streamQuotationPdf(res, q) {
  const pdfDoc = await createPdfDocument(q);
  return pipePdfToResponse(res, pdfDoc, buildPdfContentDisposition(q));
}

function buildBundledPdfContentDisposition(multiQuote) {
  const base =
    [multiQuote.project_name, multiQuote.quotation_no].filter(Boolean).join('-').trim() ||
    `quotation-${multiQuote.id || 'export'}`;
  const displayName = `${String(base).replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'quotation-summary'}-summary.pdf`;
  const asciiName = `quotation-summary-${multiQuote.id || 'export'}.pdf`;
  const encoded = encodeURIComponent(displayName);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

async function streamBundledQuotationPdf(res, multiQuote, singles, opts = {}) {
  const pdfDoc = await createBundledPdfDocument(multiQuote, singles, opts);
  return pipePdfToResponse(res, pdfDoc, buildBundledPdfContentDisposition(multiQuote));
}

module.exports = {
  buildQuotationDocDefinition,
  buildBundledQuotationDocDefinition,
  streamQuotationPdf,
  streamBundledQuotationPdf,
  groupItems,
  calcTotals,
  itemSubtotal,
};
