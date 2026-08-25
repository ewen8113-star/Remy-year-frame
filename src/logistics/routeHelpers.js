const db = require('../config/database');

const LOGISTICS_BRANDS = new Set(['PHD', 'X.O', 'CLUB', 'REMY']);

const LOGISTICS_ROW_SQL = `
  SELECT l.*, yf.year as year_frame_name
  FROM logistics l
  LEFT JOIN year_frames yf ON l.year_frame_id = yf.id
  WHERE l.id = ?
`;

/** 请求体中的关联项目编号：兼容 camelCase / project_code，去 BOM、trim */
function parseRelatedProjectCodeFromBody(body) {
  if (!body) return null;
  const raw =
    body.related_project_code != null
      ? body.related_project_code
      : body.relatedProjectCode != null
        ? body.relatedProjectCode
        : body.project_code != null
          ? body.project_code
          : null;
  if (raw == null) return null;
  const s = String(raw).replace(/^\uFEFF/, '').trim();
  return s || null;
}

function serializeLogisticsRow(row) {
  if (!row) return row;
  const out = { ...row };
  const textKeys = [
    'related_project_code',
    'project_code',
    'remarks',
    'tracking_number',
    'origin_city',
    'destination_city',
    'logistics_company',
    'express_company',
    'settlement_month',
    'brand',
    'payee_name',
    'payment_status',
  ];
  textKeys.forEach((k) => {
    if (out[k] != null && Buffer.isBuffer(out[k])) out[k] = out[k].toString('utf8');
  });
  ['fee', 'shipping_fee', 'handling_fee', 'return_shipping_fee', 'return_handling_fee'].forEach((k) => {
    if (out[k] != null && out[k] !== '') out[k] = roundMoney(out[k]);
  });
  if (out.return_date != null && out.return_date !== '') {
    const d = out.return_date;
    out.return_date = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  }
  if (out.related_project_code != null) {
    out.related_project_code = String(out.related_project_code).replace(/^\uFEFF/, '').trim() || null;
  }
  if (
    (out.related_project_code == null || out.related_project_code === '') &&
    out.project_code != null &&
    out.project_code !== ''
  ) {
    const pc = String(out.project_code).replace(/^\uFEFF/, '').trim();
    out.related_project_code = pc || null;
  }
  return out;
}

function parseInventoryOutboundIdFromRemarks(remarks) {
  const m = String(remarks || '').match(/\[INV-OB:(\d+)\]/);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  return Number.isFinite(id) ? id : null;
}

async function enrichLogisticsRowsWithOutboundTracking(rows) {
  const serializedRows = (rows || []).map(serializeLogisticsRow);
  const outboundIds = [
    ...new Set(
      serializedRows
        .filter((row) => !String(row.tracking_number || '').trim())
        .map((row) => parseInventoryOutboundIdFromRemarks(row.remarks))
        .filter(Number.isFinite)
    ),
  ];
  if (!outboundIds.length) return serializedRows;

  const [orders] = await db.query(
    `SELECT id, tracking_number FROM inv_outbound_orders WHERE id IN (${outboundIds.map(() => '?').join(',')})`,
    outboundIds
  );
  const trackingByOutboundId = new Map(
    orders
      .map((row) => [Number(row.id), row.tracking_number != null ? String(row.tracking_number).trim() : ''])
      .filter(([, trackingNumber]) => trackingNumber)
  );
  if (!trackingByOutboundId.size) return serializedRows;

  return serializedRows.map((row) => {
    if (String(row.tracking_number || '').trim()) return row;
    const outboundId = parseInventoryOutboundIdFromRemarks(row.remarks);
    const trackingNumber = trackingByOutboundId.get(outboundId);
    return trackingNumber ? { ...row, tracking_number: trackingNumber } : row;
  });
}

function canonicalBrand(brand) {
  const v = String(brand || '').trim();
  return LOGISTICS_BRANDS.has(v) ? v : 'PHD';
}

function roundMoney(v) {
  return Math.round((parseFloat(v) || 0) * 100) / 100;
}

function parseOptionalLogisticsMoney(raw) {
  if (raw == null || raw === '') return 0;
  const n = roundMoney(Math.max(0, parseFloat(raw)));
  return Number.isFinite(n) ? n : 0;
}

function parseReturnDateFromBody(body) {
  const raw = body && body.return_date;
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** 解析出货/回收运费与操作费；fee 为四项之和（兼容旧客户端只传 fee） */
function parseLogisticsFees(body) {
  const src = body || {};
  const hasBreakdown =
    Object.prototype.hasOwnProperty.call(src, 'shipping_fee') ||
    Object.prototype.hasOwnProperty.call(src, 'handling_fee') ||
    Object.prototype.hasOwnProperty.call(src, 'return_shipping_fee') ||
    Object.prototype.hasOwnProperty.call(src, 'return_handling_fee');
  if (hasBreakdown) {
    const shipping = parseOptionalLogisticsMoney(src.shipping_fee);
    const handling = parseOptionalLogisticsMoney(src.handling_fee);
    const returnShipping = parseOptionalLogisticsMoney(src.return_shipping_fee);
    const returnHandling = parseOptionalLogisticsMoney(src.return_handling_fee);
    return {
      shipping_fee: shipping,
      handling_fee: handling,
      return_shipping_fee: returnShipping,
      return_handling_fee: returnHandling,
      fee: roundMoney(shipping + handling + returnShipping + returnHandling),
    };
  }
  const feeNum = src.fee != null && src.fee !== '' ? parseFloat(src.fee) : 0;
  const fee = Number.isFinite(feeNum) ? roundMoney(Math.max(0, feeNum)) : 0;
  return {
    shipping_fee: fee,
    handling_fee: 0,
    return_shipping_fee: 0,
    return_handling_fee: 0,
    fee,
  };
}

async function fetchLogisticsRowById(id) {
  const nid = parseInt(id, 10);
  if (!Number.isFinite(nid)) return null;
  const [rows] = await db.query(LOGISTICS_ROW_SQL, [nid]);
  const enrichedRows = await enrichLogisticsRowsWithOutboundTracking(rows);
  return enrichedRows.length ? enrichedRows[0] : null;
}

module.exports = {
  canonicalBrand,
  enrichLogisticsRowsWithOutboundTracking,
  fetchLogisticsRowById,
  parseLogisticsFees,
  parseRelatedProjectCodeFromBody,
  parseReturnDateFromBody,
};
