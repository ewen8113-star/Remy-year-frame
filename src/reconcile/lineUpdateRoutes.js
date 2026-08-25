const express = require('express');
const db = require('../config/database');
const {
  buildLogisticsAddrMeta,
  findActivityByProjectRaw,
  cleanCell,
} = require('./parseLogisticsBillExcel');
const { extractBrandFromProjectCode } = require('../lib/brandFromProjectCode');
const {
  assertEditable,
  fetchBatch,
  loadActivitiesForYearFrame,
  refreshBatchSummary,
  round2,
  serializeLine,
} = require('./routeHelpers');

const router = express.Router();

router.patch('/lines/:id', async (req, res) => {
  try {
    const lineId = parseInt(req.params.id, 10);
    if (!Number.isFinite(lineId)) return res.status(400).json({ error: '无效行 ID' });
    const [rows] = await db.query('SELECT * FROM reconciliation_lines WHERE id = ?', [lineId]);
    const line = rows[0];
    if (!line) return res.status(404).json({ error: '明细不存在' });
    const batch = await fetchBatch(line.batch_id);
    assertEditable(batch);

    const body = req.body || {};
    let allocation_type = line.allocation_type;
    let line_status = line.line_status;
    let related_project_code = line.related_project_code;
    let activity_id = line.activity_id;
    let skip_reason = line.skip_reason;
    let purpose = line.purpose;
    let brand = line.brand;
    let express_company = line.express_company;
    let tracking_number = line.tracking_number;
    let logistics_company = line.logistics_company;
    let shipping_date = line.shipping_date;
    let return_date = line.return_date;
    let shipping_fee = round2(line.shipping_fee);
    let handling_fee = round2(line.handling_fee);
    let return_shipping_fee = round2(line.return_shipping_fee);
    let return_handling_fee = round2(line.return_handling_fee);

    if (body.purpose != null) purpose = cleanCell(body.purpose).slice(0, 500) || null;
    if (body.brand != null) brand = cleanCell(body.brand) || brand;
    if (body.express_company != null) express_company = cleanCell(body.express_company) || null;
    if (body.tracking_number != null) tracking_number = cleanCell(body.tracking_number) || null;
    if (body.logistics_company != null) logistics_company = cleanCell(body.logistics_company) || '快递';
    if (body.shipping_date != null) shipping_date = cleanCell(body.shipping_date).slice(0, 10) || null;
    if (body.return_date != null) return_date = cleanCell(body.return_date).slice(0, 10) || null;
    if (body.shipping_fee != null) shipping_fee = round2(body.shipping_fee);
    if (body.handling_fee != null) handling_fee = round2(body.handling_fee);
    if (body.return_shipping_fee != null) return_shipping_fee = round2(body.return_shipping_fee);
    if (body.return_handling_fee != null) return_handling_fee = round2(body.return_handling_fee);

    const action = cleanCell(body.action || body.allocation_type);

    if (action === 'skip' || action === 'skipped') {
      allocation_type = 'skipped';
      line_status = 'skipped';
      related_project_code = null;
      activity_id = null;
      skip_reason = cleanCell(body.skip_reason) || '手动跳过';
    } else if (action === 'pooled' || action === 'general') {
      allocation_type = 'pooled';
      line_status = 'confirmed';
      related_project_code = null;
      activity_id = null;
      skip_reason = null;
    } else if (action === 'activity' || body.related_project_code != null || body.activity_id != null) {
      const activities = await loadActivitiesForYearFrame(batch.year_frame_id);
      let act = null;
      if (body.activity_id != null && String(body.activity_id).trim() !== '') {
        const aid = parseInt(body.activity_id, 10);
        act = activities.find((a) => Number(a.id) === aid) || null;
      }
      const projectRaw = body.related_project_code != null ? cleanCell(body.related_project_code) : '';
      if (!act && projectRaw) act = findActivityByProjectRaw(projectRaw, activities);
      if (!act) {
        return res.status(400).json({ error: '未匹配到场次项目编号，请从下拉选择系统中的项目编号' });
      }
      allocation_type = 'activity';
      line_status = 'confirmed';
      related_project_code = String(act.project_code || '').trim();
      activity_id = Number(act.id);
      skip_reason = null;
      const fromPc = extractBrandFromProjectCode(related_project_code);
      if (fromPc) brand = fromPc;
    } else if (action === 'accept_suggestion') {
      if (line.allocation_type === 'activity' && line.suggested_activity_id) {
        allocation_type = 'activity';
        line_status = 'confirmed';
        related_project_code = line.suggested_project_code || line.related_project_code;
        activity_id = line.suggested_activity_id;
      } else if (line.allocation_type === 'pooled') {
        allocation_type = 'pooled';
        line_status = 'confirmed';
        related_project_code = null;
        activity_id = null;
      } else {
        return res.status(400).json({ error: '当前行无可确认的建议' });
      }
    }

    const fee = round2(shipping_fee + handling_fee + return_shipping_fee + return_handling_fee);

    await db.query(
      `UPDATE reconciliation_lines SET
        line_status = ?, allocation_type = ?, related_project_code = ?, activity_id = ?,
        skip_reason = ?, purpose = ?, brand = ?, express_company = ?, tracking_number = ?,
        logistics_company = ?, shipping_date = ?, return_date = ?,
        shipping_fee = ?, handling_fee = ?, return_shipping_fee = ?, return_handling_fee = ?, fee = ?
       WHERE id = ?`,
      [
        line_status,
        allocation_type,
        related_project_code,
        activity_id,
        skip_reason,
        purpose,
        brand,
        express_company,
        tracking_number,
        logistics_company,
        shipping_date,
        return_date,
        shipping_fee,
        handling_fee,
        return_shipping_fee,
        return_handling_fee,
        fee,
        lineId,
      ]
    );
    const summary = await refreshBatchSummary(line.batch_id);
    const [updated] = await db.query('SELECT * FROM reconciliation_lines WHERE id = ?', [lineId]);
    res.json({ data: { line: serializeLine(updated[0]), summary }, message: '已更新' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

module.exports = router;
