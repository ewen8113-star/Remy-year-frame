const express = require('express');
const db = require('../config/database');
const {
  DEFAULT_PAYEE,
  summarizeLines,
  buildLogisticsAddrMeta,
} = require('./parseLogisticsBillExcel');
const { extractBrandFromProjectCode } = require('../lib/brandFromProjectCode');
const {
  assertEditable,
  fetchBatch,
  fetchLines,
  normalizeYm,
  refreshBatchSummary,
  round2,
} = require('./routeHelpers');

const router = express.Router();

router.post('/batches/:id/bulk-pool', async (req, res) => {
  try {
    const batch = await fetchBatch(req.params.id);
    assertEditable(batch);
    await db.query(
      `UPDATE reconciliation_lines
       SET allocation_type = 'pooled', line_status = 'confirmed',
           related_project_code = NULL, activity_id = NULL, skip_reason = NULL
       WHERE batch_id = ? AND allocation_type IN ('unassigned', 'pooled')
         AND line_status IN ('pending', 'suggested')`,
      [batch.id]
    );
    const summary = await refreshBatchSummary(batch.id);
    const lines = await fetchLines(batch.id);
    res.json({ data: { lines, summary, batch: await fetchBatch(batch.id) }, message: '已将待确认行纳入统筹' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// 批量：接受全部建议
router.post('/batches/:id/accept-suggestions', async (req, res) => {
  try {
    const batch = await fetchBatch(req.params.id);
    assertEditable(batch);
    await db.query(
      `UPDATE reconciliation_lines
       SET line_status = 'confirmed'
       WHERE batch_id = ? AND line_status = 'suggested'
         AND allocation_type IN ('activity', 'pooled')`,
      [batch.id]
    );
    const summary = await refreshBatchSummary(batch.id);
    res.json({
      data: { lines: await fetchLines(batch.id), summary, batch: await fetchBatch(batch.id) },
      message: '已确认全部建议归属',
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

function buildCommitPreview(batch, lines) {
  const importable = lines.filter((l) => l.allocation_type === 'activity' || l.allocation_type === 'pooled');
  const blocked = lines.filter(
    (l) => l.allocation_type === 'unassigned' || (l.line_status !== 'confirmed' && l.allocation_type !== 'skipped')
  );
  const activityLines = importable.filter((l) => l.allocation_type === 'activity');
  const pooledLines = importable.filter((l) => l.allocation_type === 'pooled');
  const skipped = lines.filter((l) => l.allocation_type === 'skipped');
  return {
    canCommit: blocked.length === 0 && importable.length > 0,
    blockedCount: blocked.length,
    importCount: importable.length,
    activityCount: activityLines.length,
    pooledCount: pooledLines.length,
    skippedCount: skipped.length,
    activityFee: round2(activityLines.reduce((s, l) => s + round2(l.fee), 0)),
    pooledFee: round2(pooledLines.reduce((s, l) => s + round2(l.fee), 0)),
    importFee: round2(importable.reduce((s, l) => s + round2(l.fee), 0)),
    payee_name: batch.payee_name || DEFAULT_PAYEE,
    settlement_month: batch.settlement_month,
  };
}

router.get('/batches/:id/preview', async (req, res) => {
  try {
    const batch = await fetchBatch(req.params.id);
    if (!batch) return res.status(404).json({ error: '批次不存在' });
    const lines = await fetchLines(batch.id);
    res.json({ data: { batch, preview: buildCommitPreview(batch, lines) } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 正式写入 logistics
router.post('/batches/:id/commit', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const batch = await fetchBatch(req.params.id);
    assertEditable(batch);
    if (batch.batch_type !== 'logistics') {
      return res.status(400).json({ error: '当前仅支持物流入账提交' });
    }
    const lines = await fetchLines(batch.id);
    const preview = buildCommitPreview(batch, lines);
    if (!preview.canCommit) {
      return res.status(400).json({
        error: preview.importCount === 0
          ? '没有可导入的明细'
          : `还有 ${preview.blockedCount} 行未确认归属，请先分配项目编号或纳入统筹`,
        data: { preview },
      });
    }

    const payee = batch.payee_name || DEFAULT_PAYEE;
    const settlementMonth = normalizeYm(batch.settlement_month);
    const createdIds = [];

    await conn.beginTransaction();
    for (const line of lines) {
      if (line.allocation_type === 'skipped') continue;
      if (line.allocation_type !== 'activity' && line.allocation_type !== 'pooled') continue;

      const isActivity = line.allocation_type === 'activity';
      const remarks = buildLogisticsAddrMeta(line) || null;
      const origin = [line.ship_name, line.ship_phone].filter(Boolean).join(' ') || line.raw_origin_city || null;
      const dest = [line.recv_name, line.recv_phone].filter(Boolean).join(' ') || line.raw_dest_city || null;
      const brand = line.brand || extractBrandFromProjectCode(line.related_project_code) || 'PHD';

      const [ins] = await conn.query(
        `INSERT INTO logistics (
          year_frame_id, activity_id, merged_into_activity, allocation_note, payee_name,
          logistics_company, brand, express_company, tracking_number, settlement_month,
          origin_city, destination_city, shipping_date, fee, shipping_fee, handling_fee,
          return_date, return_shipping_fee, return_handling_fee, related_project_code,
          remarks, special_car, monthly_settlement
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          batch.year_frame_id,
          isActivity ? line.activity_id : null,
          isActivity ? 1 : 0,
          isActivity ? '临时对账-计入项目成本' : '临时对账-纳入统筹成本',
          payee,
          line.logistics_company || '快递',
          brand,
          line.express_company || null,
          line.tracking_number || null,
          settlementMonth,
          origin,
          dest,
          line.shipping_date || `${settlementMonth}-01`,
          round2(line.fee),
          round2(line.shipping_fee),
          round2(line.handling_fee),
          line.return_date || null,
          round2(line.return_shipping_fee),
          round2(line.return_handling_fee),
          isActivity ? line.related_project_code : null,
          remarks,
          /专车/.test(line.express_company || '') ? 1 : 0,
          1,
        ]
      );
      createdIds.push(ins.insertId);
      await conn.query(
        'UPDATE reconciliation_lines SET committed_logistics_id = ?, line_status = ? WHERE id = ?',
        [ins.insertId, 'confirmed', line.id]
      );
    }

    const summary = summarizeLines(lines);
    summary.committedCount = createdIds.length;
    summary.committedAt = new Date().toISOString();
    await conn.query(
      `UPDATE reconciliation_batches
       SET status = 'committed', committed_at = NOW(), summary_json = ? WHERE id = ?`,
      [JSON.stringify(summary), batch.id]
    );
    await conn.commit();

    res.json({
      data: {
        batch: await fetchBatch(batch.id),
        createdIds,
        preview,
      },
      message: `已正式导入 ${createdIds.length} 条物流记录（项目成本 ${preview.activityCount} / 统筹 ${preview.pooledCount}）`,
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) { /* ignore */ }
    res.status(error.statusCode || 500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
