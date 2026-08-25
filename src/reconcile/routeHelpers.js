const db = require('../config/database');
const { summarizeLines } = require('./parseLogisticsBillExcel');

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function normalizeYm(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return '';
  const mo = parseInt(m[2], 10);
  if (!Number.isFinite(mo) || mo < 1 || mo > 12) return '';
  return `${m[1]}-${String(mo).padStart(2, '0')}`;
}

function parseJsonMaybe(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch (_) {
    return null;
  }
}

async function loadActivitiesForYearFrame(yearFrameId) {
  const [rows] = await db.query(
    `SELECT id, project_code, brand FROM activities
     WHERE year_frame_id = ? AND COALESCE(is_virtual, 0) = 0
     ORDER BY date DESC, id DESC`,
    [yearFrameId]
  );
  return rows || [];
}

function serializeBatch(row) {
  if (!row) return row;
  return {
    ...row,
    summary_json: parseJsonMaybe(row.summary_json) || {},
  };
}

function serializeLine(row) {
  if (!row) return row;
  return {
    ...row,
    raw_extra_json: parseJsonMaybe(row.raw_extra_json),
    shipping_fee: round2(row.shipping_fee),
    handling_fee: round2(row.handling_fee),
    return_shipping_fee: round2(row.return_shipping_fee),
    return_handling_fee: round2(row.return_handling_fee),
    insurance_fee: round2(row.insurance_fee),
    cod_fee: round2(row.cod_fee),
    fee: round2(row.fee),
  };
}

async function fetchBatch(id) {
  const nid = parseInt(id, 10);
  if (!Number.isFinite(nid)) return null;
  const [rows] = await db.query('SELECT * FROM reconciliation_batches WHERE id = ?', [nid]);
  return rows[0] ? serializeBatch(rows[0]) : null;
}

async function fetchLines(batchId) {
  const [rows] = await db.query(
    'SELECT * FROM reconciliation_lines WHERE batch_id = ? ORDER BY line_no ASC, id ASC',
    [batchId]
  );
  return (rows || []).map(serializeLine);
}

async function refreshBatchSummary(batchId, conn = db) {
  const [rows] = await conn.query('SELECT * FROM reconciliation_lines WHERE batch_id = ?', [batchId]);
  const summary = summarizeLines(rows.map(serializeLine));
  await conn.query('UPDATE reconciliation_batches SET summary_json = ? WHERE id = ?', [
    JSON.stringify(summary),
    batchId,
  ]);
  return summary;
}

function assertEditable(batch) {
  if (!batch) {
    const e = new Error('批次不存在');
    e.statusCode = 404;
    throw e;
  }
  if (batch.status === 'committed') {
    const e = new Error('批次已正式入库，不可再改');
    e.statusCode = 400;
    throw e;
  }
  if (batch.status === 'cancelled') {
    const e = new Error('批次已取消');
    e.statusCode = 400;
    throw e;
  }
}

function insertLineParams(batchId, line) {
  return [
    batchId,
    line.line_no,
    line.excel_row || null,
    line.line_status || 'pending',
    line.allocation_type || 'unassigned',
    line.raw_type || null,
    line.raw_date || null,
    line.raw_project || null,
    line.raw_brand || null,
    line.raw_express || null,
    line.raw_tracking || null,
    line.raw_origin_city || null,
    line.raw_dest_city || null,
    line.ship_name || null,
    line.ship_phone || null,
    line.ship_addr || null,
    line.recv_name || null,
    line.recv_phone || null,
    line.recv_addr || null,
    line.weight_kg != null ? line.weight_kg : null,
    round2(line.shipping_fee),
    round2(line.handling_fee),
    round2(line.return_shipping_fee),
    round2(line.return_handling_fee),
    round2(line.insurance_fee),
    round2(line.cod_fee),
    round2(line.fee),
    line.purpose || null,
    line.brand || null,
    line.express_company || null,
    line.tracking_number || null,
    line.logistics_company || '快递',
    line.shipping_date || null,
    line.return_date || null,
    line.related_project_code || null,
    line.activity_id || null,
    line.suggested_project_code || null,
    line.suggested_activity_id || null,
    line.skip_reason || null,
    line.raw_remarks || null,
    line.raw_extra_json ? JSON.stringify(line.raw_extra_json) : null,
  ];
}

const LINE_INSERT_SQL = `
  INSERT INTO reconciliation_lines (
    batch_id, line_no, excel_row, line_status, allocation_type,
    raw_type, raw_date, raw_project, raw_brand, raw_express, raw_tracking,
    raw_origin_city, raw_dest_city, ship_name, ship_phone, ship_addr,
    recv_name, recv_phone, recv_addr, weight_kg,
    shipping_fee, handling_fee, return_shipping_fee, return_handling_fee,
    insurance_fee, cod_fee, fee, purpose, brand, express_company, tracking_number,
    logistics_company, shipping_date, return_date, related_project_code, activity_id,
    suggested_project_code, suggested_activity_id, skip_reason, raw_remarks, raw_extra_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

module.exports = {
  LINE_INSERT_SQL,
  assertEditable,
  fetchBatch,
  fetchLines,
  insertLineParams,
  loadActivitiesForYearFrame,
  normalizeYm,
  refreshBatchSummary,
  round2,
  serializeBatch,
  serializeLine,
};
