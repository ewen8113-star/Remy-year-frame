const express = require('express');
const db = require('../config/database');
const {
  projectCodeHasDateSuffix,
  repairProjectCodeDate,
} = require('../lib/projectCode');

const router = express.Router();

/** 将出库单 project_code 与关联场次对齐，并补全缺 YYMMDD 的编号。 */
router.post('/outbound/repair-project-codes', async (req, res) => {
  try {
    const yearFrameRaw =
      req.body?.yearFrameId ?? req.body?.year_frame_id ?? req.query?.yearFrameId;
    const yearFrameId = parseInt(yearFrameRaw, 10);
    const yearFrameClause = Number.isFinite(yearFrameId) ? ' AND act.year_frame_id = ?' : '';
    const yearFrameParams = Number.isFinite(yearFrameId) ? [yearFrameId] : [];

    const [syncResult] = await db.query(
      `
      UPDATE inv_outbound_orders o
      INNER JOIN activities act ON act.id = o.activity_id
      SET o.project_code = act.project_code
      WHERE TRIM(COALESCE(act.project_code, '')) <> ''
        AND (o.project_code IS NULL OR TRIM(o.project_code) <> TRIM(act.project_code))
        ${yearFrameClause}
    `,
      yearFrameParams
    );
    const synced = Number(syncResult?.affectedRows || 0);

    let selectSql = `
      SELECT o.id, o.project_code, o.activity_id,
             COALESCE(o.activity_date, act.date) AS repair_date
      FROM inv_outbound_orders o
      LEFT JOIN activities act ON act.id = o.activity_id
      WHERE (o.link_mode = 'activity' OR o.activity_id IS NOT NULL)
        AND TRIM(COALESCE(o.project_code, '')) <> ''
        AND o.project_code NOT REGEXP '^[^ ]+ [0-9]{6}'
    `;
    const selectParams = [];
    if (Number.isFinite(yearFrameId)) {
      selectSql +=
        ' AND (act.year_frame_id = ? OR (o.activity_id IS NULL AND o.id IN (SELECT o2.id FROM inv_outbound_orders o2 INNER JOIN activities a2 ON a2.project_code = o2.project_code WHERE a2.year_frame_id = ?)))';
      selectParams.push(yearFrameId, yearFrameId);
    }
    const [rows] = await db.query(selectSql, selectParams);
    let repaired = 0;
    for (const row of rows) {
      const nextProjectCode = repairProjectCodeDate(row.project_code, row.repair_date);
      if (
        !nextProjectCode
        || nextProjectCode === row.project_code
        || !projectCodeHasDateSuffix(nextProjectCode)
      ) {
        continue;
      }
      await db.query('UPDATE inv_outbound_orders SET project_code = ? WHERE id = ?', [
        nextProjectCode,
        row.id,
      ]);
      repaired += 1;
    }

    res.json({
      synced,
      repaired,
      scanned: rows.length,
      message: `出库单：已与场次同步 ${synced} 条，补全日期 ${repaired} 条`,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '修复失败' });
  }
});

module.exports = router;
