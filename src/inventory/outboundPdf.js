const { formatCnYmd, formatWarehouseLabel } = require('./formatters');
const { compactDateYYMMDD, extractProjectContent, safeFilePart } = require('./pdfFilename');

function buildOutboundPdfPayload(order, lines, opts = {}) {
  const lineWhMap = new Map();
  (lines || []).forEach((ln) => {
    const key = `${ln.line_brand_code || '—'}|${ln.line_region || '—'}`;
    if (!lineWhMap.has(key)) lineWhMap.set(key, []);
    lineWhMap.get(key).push(ln);
  });
  const whCount = lineWhMap.size;
  const shippedDateCn = formatCnYmd(order.shipped_at);

  const whNames = Array.from(lineWhMap.keys()).map((k) => {
    const [b, r] = String(k).split('|');
    return formatWarehouseLabel(b, r);
  });
  const warehouseLabel = whCount > 1
    ? `多仓（${whNames.join(' / ')}）`
    : formatWarehouseLabel(order.brand_code, order.region);
  const projectCodeLabel =
    order.link_mode === 'standalone'
      ? String(order.purpose || '').trim() || '—'
      : String(order.project_code || '').trim() || '—';

  const lineTableBody = [
    [
      { text: '序号', style: 'thCenter' },
      { text: '物品名称', style: 'th' },
      { text: '所属仓库', style: 'thCenter' },
      { text: '数量', style: 'thCenter' },
      { text: '规格/尺寸', style: 'th' },
      { text: '说明', style: 'thCenter' },
    ],
  ];
  (lines || []).forEach((ln, idx) => {
    lineTableBody.push([
      { text: String(idx + 1), style: 'tdCenter' },
      { text: String(ln.item_name || ''), style: 'tdLeft' },
      { text: formatWarehouseLabel(ln.line_brand_code, ln.line_region), style: 'tdCenter' },
      { text: String(ln.quantity || ''), style: 'tdCenter' },
      { text: String(ln.item_dimensions || '—'), style: 'tdLeft' },
      { text: String(ln.line_note || '—'), style: 'tdLeft' },
    ]);
  });

  const docDefinition = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: opts.hasSystemUnicodeFont ? 'unicode' : 'fangzhen', fontSize: 10, lineHeight: 1.2 },
    content: [
      { text: '物品出库单', style: 'title', alignment: 'center', margin: [0, 0, 0, 6] },
      { text: [{ text: '项目编号：', bold: true }, projectCodeLabel], margin: [0, 0, 0, 3] },
      {
        columns: [
          { width: 'auto', text: [{ text: '出库时间：', bold: true }, shippedDateCn] },
          { width: '*', text: [{ text: '所属仓库：', bold: true }, warehouseLabel] },
        ],
        columnGap: 16,
        margin: [0, 0, 0, 6],
      },
      { text: '收件信息', style: 'h2' },
      { text: [{ text: '城市：', bold: true }, order.recipient_city || '—'], margin: [0, 0, 0, 3] },
      {
        columns: [
          { width: 'auto', text: [{ text: '联系人：', bold: true }, order.contact_name || '—'] },
          { width: '*', text: [{ text: '联系电话：', bold: true }, order.contact_phone || '—'] },
        ],
        columnGap: 24,
        margin: [0, 0, 0, 3],
      },
      { text: [{ text: '地址：', bold: true }, order.recipient_address || '—'], margin: [0, 0, 0, 3] },
      { text: [{ text: '物流方式：', bold: true }, order.logistics_method || '—'], margin: [0, 0, 0, 6] },
      { text: '物品明细', style: 'h2' },
      {
        table: {
          widths: ['8%', '30%', '14%', '8%', '12%', '28%'],
          headerRows: 1,
          body: lineTableBody,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#888888',
          vLineColor: () => '#888888',
          paddingTop: () => 3,
          paddingBottom: () => 3,
          paddingLeft: () => 4,
          paddingRight: () => 4,
        },
      },
      ...(order.remarks ? [{ text: `备注：${order.remarks}`, margin: [0, 6, 0, 0] }] : []),
    ],
    styles: {
      title: { fontSize: 18, bold: true },
      h2: { fontSize: 11, bold: true, margin: [0, 6, 0, 3] },
      th: { bold: true, fontSize: 9, fillColor: '#f0f0f0' },
      thCenter: { bold: true, alignment: 'center', fontSize: 9, fillColor: '#f0f0f0' },
      tdLeft: { alignment: 'left', fontSize: 9, lineHeight: 1.2 },
      tdCenter: { alignment: 'center', fontSize: 9, lineHeight: 1.2 },
    },
  };

  const warehousePartSrc = whCount > 1 ? '多仓' : formatWarehouseLabel(order.brand_code, order.region);
  const warehousePart = safeFilePart(warehousePartSrc) || '未知仓库';
  const projectCodeTrim = String(order.project_code || '').trim();
  const isStandalone = order.link_mode === 'standalone' || !projectCodeTrim;
  let finalBaseName;
  if (isStandalone) {
    const dateSource =
      order.activity_date ||
      order.activity_date_link ||
      order.shipped_at ||
      order.created_at;
    const datePart = compactDateYYMMDD(dateSource) || '000000';
    const cityPart = safeFilePart(order.recipient_city) || '未知城市';
    finalBaseName = `${datePart}${cityPart}出库单（${warehousePart}）`;
  } else {
    const projectContentRaw = extractProjectContent(projectCodeTrim);
    const projectPart = safeFilePart(projectContentRaw) || safeFilePart(projectCodeTrim) || '未知项目';
    finalBaseName = `${projectPart}出库单（${warehousePart}）`;
  }

  return {
    docDefinition,
    filename: `${finalBaseName}.pdf`,
  };
}

module.exports = {
  buildOutboundPdfPayload,
};
