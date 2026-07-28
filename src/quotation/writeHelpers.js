const { formatDateTimeMinute } = require('../lib/businessTime');
const { mergeSessionWithTotals } = require('./multiSummaryItems');
const {
  normalizeEventDate,
  normalizeLinkedSessionRow,
} = require('./routeUtils');

async function resolveLinkedSessions(conn, sessions, yearFrameIdHint) {
  const rows = (sessions || []).map((s, i) => normalizeLinkedSessionRow(s, i));
  if (!rows.length) return { error: '请至少关联一场活动（项目编号）', status: 400 };

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.activity_id) {
      return { error: `第 ${i + 1} 行：请选择关联项目编号`, status: 400 };
    }
    const linked = await resolveLinkedActivity(conn, row.activity_id, yearFrameIdHint);
    if (linked.error) return { error: `第 ${i + 1} 行：${linked.error}`, status: linked.status || 400 };
    const { activity: act, projectCode } = linked;
    const incoming = (sessions || [])[i] || {};
    out.push(
      mergeSessionWithTotals({
        ...incoming,
        activity_id: act.id,
        project_code: projectCode,
        event_date: row.event_date || normalizeEventDate(act.activity_date),
        city: row.city || act.city || '',
        customer_name: row.customer_name || act.client_name || '',
        event_type: row.event_type || act.activity_type || '',
        remarks: row.remarks || (act.remarks != null ? String(act.remarks).trim() : ''),
        sort_order: i,
      })
    );
  }
  return { sessions: out };
}

const { renumberEventQuotationSections } = require('../quotation/quotationCodes');

async function resolveLinkedActivity(conn, activityId, yearFrameIdHint) {
  const aid = parseInt(activityId, 10);
  if (!Number.isFinite(aid)) return { error: '请选择关联场次（项目编号）', status: 400 };
  const [acts] = await conn.query(
    `SELECT id, year_frame_id, project_code, city, client_name, remarks, date AS activity_date, activity_type, brand
     FROM activities WHERE id = ? AND COALESCE(is_virtual, 0) = 0 LIMIT 1`,
    [aid]
  );
  if (!acts.length) return { error: '关联场次不存在或不可用', status: 404 };
  const act = acts[0];
  const pc = String(act.project_code || '').trim();
  if (!pc) return { error: '该场次未填写项目编号，请先在场次记录中补全', status: 400 };
  if (yearFrameIdHint != null && Number(act.year_frame_id) !== Number(yearFrameIdHint)) {
    return { error: '关联场次与当前财年不一致，请切换左侧财年或重新选择场次', status: 400 };
  }
  return { activity: act, projectCode: pc };
}

async function generateQuotationNo(conn) {
  const bj = formatDateTimeMinute(new Date()) || '';
  const ymd = bj.slice(0, 10).replace(/-/g, '') || '00000000';
  const prefix = `QT-${ymd}`;
  const [rows] = await conn.query(
    'SELECT quotation_no FROM quotations WHERE quotation_no LIKE ? ORDER BY id DESC LIMIT 1',
    [`${prefix}-%`]
  );
  let seq = 1;
  if (rows.length) {
    const m = String(rows[0].quotation_no).match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

module.exports = {
  generateQuotationNo,
  resolveLinkedActivity,
  resolveLinkedSessions,
};
