const express = require('express');
const db = require('../config/database');
const { todayYmd } = require('../lib/businessTime');
const {
  projectCodeHasDateSuffix,
  repairProjectCodeDate,
} = require('../lib/projectCode');
const { resolveActivityStatusForWrite } = require('./routeHelpers');

const router = express.Router();

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM activities WHERE id = ?', [id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** 活动日期 >= 今天（北京时间）却标为已完成的场次改回待执行 */
router.post('/revert-future-completed', async (req, res) => {
  try {
    const { yearFrameId } = req.body || {};
    const today = todayYmd();
    const params = [today];
    let sql = `
      UPDATE activities
      SET status = 'pending'
      WHERE status = 'completed'
        AND COALESCE(is_virtual, 0) = 0
        AND date IS NOT NULL
        AND date >= ?
    `;
    if (yearFrameId) {
      sql += ' AND year_frame_id = ?';
      params.push(parseInt(yearFrameId, 10));
    }
    const [r] = await db.query(sql, params);
    res.json({
      updated: Number(r?.affectedRows || 0),
      message: `已将 ${Number(r?.affectedRows || 0)} 条未到期场次改回待执行`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 自动将过期未完成场次置为已完成（仅 pending -> completed，按北京时间「今天」）
router.post('/auto-complete-overdue', async (req, res) => {
  try {
    const { yearFrameId } = req.body || {};
    const today = todayYmd();
    const params = [today];
    let sql = `
      UPDATE activities
      SET status = 'completed'
      WHERE status = 'pending'
        AND COALESCE(is_virtual, 0) = 0
        AND date IS NOT NULL
        AND date < ?
    `;
    if (yearFrameId) {
      sql += ' AND year_frame_id = ?';
      params.push(parseInt(yearFrameId, 10));
    }
    const [r] = await db.query(sql, params);
    res.json({
      updated: Number(r?.affectedRows || 0),
      message: `已自动完成 ${Number(r?.affectedRows || 0)} 条过期场次`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** 为缺少年框后 YYMMDD 的项目编号补全活动日期 */
router.post('/repair-project-codes', async (req, res) => {
  try {
    const { yearFrameId } = req.body || {};
    const params = [];
    let sql = `
      SELECT id, project_code, date
      FROM activities
      WHERE COALESCE(is_virtual, 0) = 0
        AND date IS NOT NULL
        AND TRIM(COALESCE(project_code, '')) <> ''
        AND project_code NOT REGEXP '^[^ ]+ [0-9]{6}'
    `;
    if (yearFrameId) {
      sql += ' AND year_frame_id = ?';
      params.push(parseInt(yearFrameId, 10));
    }
    const [rows] = await db.query(sql, params);
    let updated = 0;
    for (const row of rows) {
      const next = repairProjectCodeDate(row.project_code, row.date);
      if (!next || next === row.project_code || !projectCodeHasDateSuffix(next)) continue;
      await db.query('UPDATE activities SET project_code = ? WHERE id = ?', [next, row.id]);
      updated += 1;
    }
    res.json({
      updated,
      scanned: rows.length,
      message: `已修复 ${updated} 条项目编号（共检出 ${rows.length} 条缺日期）`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量更新状态
router.post('/batch-update-status', async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请提供活动ID列表' });
    }
    if (status === undefined || status === null || String(status).trim() === '') {
      return res.status(400).json({ error: '请提供状态 status' });
    }
    const out = await resolveActivityStatusForWrite(status);
    if (!out.ok) {
      return res.status(400).json({
        error:
          out.message ||
          `无效的状态：${status}（请执行 npm run migrate:activity-status-to-varchar 或 migrate:activity-status-deferred 后重启 Node）`,
      });
    }

    const placeholders = ids.map(() => '?').join(',');
    await db.query(
      `UPDATE activities SET status = ? WHERE id IN (${placeholders})`,
      [out.value, ...ids]
    );

    res.json({ message: `成功更新 ${ids.length} 条记录` });
  } catch (error) {
    const msg = error && error.message ? String(error.message) : '';
    if (/Data truncated|Incorrect.*status|1265|1366/i.test(msg)) {
      return res.status(400).json({
        error:
          '无法保存状态：当前库 activities.status 列仍为 ENUM 且不含「延期」。请执行 npm run migrate:activity-status-to-varchar（推荐）或 migrate:activity-status-deferred，然后重启 Node。',
      });
    }
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
