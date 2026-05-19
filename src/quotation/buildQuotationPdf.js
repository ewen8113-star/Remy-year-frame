const path = require('path');
const fs = require('fs');
const PdfPrinter = require('pdfmake/js/Printer').default;
const URLResolver = require('pdfmake/js/URLResolver').default;
const pdfVirtualFs = require('pdfmake/js/virtual-fs').default;
const robotoVfsMap = require('pdfmake/build/vfs_fonts.js');
const cnVfsMap = require('pdfmake-support-chinese-fonts/vfs_fonts').pdfMake.vfs;

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

function groupItems(items) {
  const sections = [];
  const secMap = new Map();
  (items || [])
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0))
    .forEach((it) => {
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
  return sections;
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

function buildTableBody(q) {
  const body = [
    [
      { text: '内容\nItem', style: 'th' },
      { text: '', style: 'th' },
      { text: '说明\nSummary', style: 'th' },
      { text: '数量\nQty', style: 'thC' },
      { text: '单位\nUnit', style: 'thC' },
      { text: '单价\nPrice', style: 'thR' },
      { text: '单项小计\nSubtotal', style: 'thR' },
      { text: '备注\nRemarks', style: 'th' },
    ],
  ];

  const groups = groupItems(q.items);
  groups.forEach((sec) => {
    body.push([
      {
        text: `${sec.section_code}.${sec.section_name}`,
        style: 'section',
        colSpan: 6,
        alignment: 'left',
      },
      '',
      '',
      '',
      '',
      '',
      { text: fmtNum(sec.sectionSubtotal), style: 'sectionR', alignment: 'right' },
      '',
    ]);
    sec.subsections.forEach((sub) => {
      sub.items.forEach((it, idx) => {
        const subCodeCell =
          idx === 0 ? { text: String(sub.subsection_code || ''), style: 'tdC' } : { text: '', style: 'tdC' };
        const subNameCell =
          idx === 0 ? { text: String(sub.subsection_name || ''), style: 'tdC' } : { text: '', style: 'tdC' };
        body.push([
          subCodeCell,
          subNameCell,
          { text: String(it.description || ''), style: 'tdL' },
          { text: fmtNum(it.quantity, 0), style: 'tdC' },
          { text: String(it.unit || ''), style: 'tdC' },
          { text: fmtNum(it.unit_price), style: 'tdR' },
          { text: fmtNum(itemSubtotal(it)), style: 'tdR' },
          { text: String(it.remarks || ''), style: 'tdL' },
        ]);
      });
    });
  });

  const t = calcTotals(q.items, q.service_rate, q.tax_rate);
  const pct = Math.round(t.serviceRate * 100);
  const pushFooter = (label, val) => {
    body.push([
      { text: label, style: 'footer', colSpan: 6, alignment: 'left' },
      '',
      '',
      '',
      '',
      '',
      { text: fmtNum(val), style: 'footerR', alignment: 'right' },
      '',
    ]);
  };
  pushFooter('1. 不含税小计 Subtotal excluding Tax', t.subtotalExTax);
  pushFooter(`2. 公司服务费 Service Charge(${pct}%)`, t.serviceCharge);
  pushFooter('3. 国家及地方政府税收(6%) Government Tax', t.taxAmount);
  pushFooter('4. 含税总计 TOTAL', t.totalAmount);

  return { body, totals: t };
}

function buildQuotationDocDefinition(q, opts = {}) {
  const { body } = buildTableBody(q);
  const headerStack = [
    labelLine('Client / Brand 客户/品牌：', q.client_brand),
    labelLine('Attend to 客户方负责人：', q.client_contact),
    labelLine('Project Name 项目名称：', q.project_name),
  ];

  const headerBlock = { width: '*', stack: headerStack };
  const logoPath = opts.skipLogo ? null : resolveLogoImage();
  const topRow = logoPath
    ? {
        columns: [
          headerBlock,
          {
            width: 100,
            image: logoPath,
            fit: [100, 50],
          },
        ],
        columnGap: 12,
        margin: [0, 0, 0, 8],
      }
    : { stack: headerStack, margin: [0, 0, 0, 8] };

  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 28, 28, 28],
    fonts: docDefinitionFonts,
    defaultStyle: { font: defaultFont, fontSize: 9, lineHeight: 1.15 },
    content: [
      topRow,
      {
        table: {
          widths: ['8%', '10%', '28%', '8%', '8%', '10%', '12%', '16%'],
          headerRows: 1,
          body,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#888888',
          vLineColor: () => '#888888',
          paddingTop: () => 2,
          paddingBottom: () => 2,
          paddingLeft: () => 3,
          paddingRight: () => 3,
        },
      },
    ],
    styles: {
      th: { bold: true, fillColor: '#948a54', color: '#ffffff', fontSize: 8 },
      thC: { bold: true, fillColor: '#948a54', color: '#ffffff', alignment: 'center', fontSize: 8 },
      thR: { bold: true, fillColor: '#948a54', color: '#ffffff', alignment: 'right', fontSize: 8 },
      section: { bold: true, fillColor: '#c4bd97', fontSize: 9 },
      sectionR: { bold: true, fillColor: '#c4bd97', fontSize: 9 },
      footer: { bold: true, fillColor: '#c4bd97', fontSize: 9 },
      footerR: { bold: true, fillColor: '#c4bd97', fontSize: 9 },
      tdL: { alignment: 'left', fontSize: 8 },
      tdC: { alignment: 'center', fontSize: 8 },
      tdR: { alignment: 'right', fontSize: 8 },
    },
  };
}

async function createPdfDocument(q) {
  ensurePdfVfs();
  const urlResolver = new URLResolver(pdfVirtualFs);
  const printer = new PdfPrinter(pdfPrinterFonts, pdfVirtualFs, urlResolver);
  try {
    return await printer.createPdfKitDocument(buildQuotationDocDefinition(q));
  } catch (e) {
    console.warn('报价 PDF（含 Logo）生成失败，重试无 Logo：', e.message);
    return await printer.createPdfKitDocument(buildQuotationDocDefinition(q, { skipLogo: true }));
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

async function streamQuotationPdf(res, q) {
  const pdfDoc = await createPdfDocument(q);

  return new Promise((resolve, reject) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', buildPdfContentDisposition(q));
    pdfDoc.on('error', reject);
    res.on('error', reject);
    pdfDoc.on('end', resolve);
    pdfDoc.pipe(res);
    pdfDoc.end();
  });
}

module.exports = { buildQuotationDocDefinition, streamQuotationPdf };
