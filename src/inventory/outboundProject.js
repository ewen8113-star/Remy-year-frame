const {
  projectCodeHasDateSuffix,
  repairProjectCodeDate,
} = require('../lib/projectCode');

/**
 * 未带 activity_id 时，按 project_code 与可选 year_frame_id 解析场次。
 */
async function resolveOutboundActivityId(conn, projectCodeRaw, activityIdRaw, yearFrameIdRaw) {
  const projectCode = String(projectCodeRaw || '').trim();
  if (activityIdRaw != null && String(activityIdRaw).trim() !== '') {
    const activityId = parseInt(activityIdRaw, 10);
    if (Number.isFinite(activityId)) return activityId;
  }
  if (!projectCode) {
    const error = new Error('请填写项目编号或匹配场次');
    error.statusCode = 400;
    throw error;
  }

  const yearFrameId = parseInt(yearFrameIdRaw, 10);
  if (Number.isFinite(yearFrameId)) {
    const [rows] = await conn.query(
      'SELECT id FROM activities WHERE project_code = ? AND year_frame_id = ? LIMIT 1',
      [projectCode, yearFrameId]
    );
    if (!rows.length) {
      const error = new Error('当前年度下未找到与项目编号匹配的场次，请核对左侧年度或项目编号');
      error.statusCode = 400;
      throw error;
    }
    return rows[0].id;
  }

  const [rows] = await conn.query(
    'SELECT id, year_frame_id FROM activities WHERE project_code = ?',
    [projectCode]
  );
  if (!rows.length) {
    const error = new Error('未找到与项目编号匹配的场次');
    error.statusCode = 400;
    throw error;
  }
  if (rows.length > 1) {
    const error = new Error('该项目编号在多个年度存在，请先在左侧选择年度后再保存');
    error.statusCode = 400;
    throw error;
  }
  return rows[0].id;
}

/**
 * 已关联场次时使用场次项目编号；否则按活动日期补全 YYMMDD。
 */
async function canonicalOutboundProjectCode(conn, options) {
  const linkMode = options.link_mode === 'standalone' ? 'standalone' : 'activity';
  if (linkMode !== 'activity') return null;

  const activityId =
    options.activity_id != null && String(options.activity_id).trim() !== ''
      ? parseInt(options.activity_id, 10)
      : null;
  let activity = null;
  if (Number.isFinite(activityId)) {
    const [activities] = await conn.query(
      'SELECT project_code, date FROM activities WHERE id = ? LIMIT 1',
      [activityId]
    );
    activity = activities[0] || null;
    const activityProjectCode = String(activity?.project_code || '').trim();
    if (activityProjectCode) return activityProjectCode;
  }

  let projectCode = String(options.project_code || '').trim();
  const repairDate = options.activity_date || activity?.date || null;
  if (projectCode && repairDate && !projectCodeHasDateSuffix(projectCode)) {
    projectCode = repairProjectCodeDate(projectCode, repairDate);
  }
  return projectCode || null;
}

module.exports = {
  canonicalOutboundProjectCode,
  resolveOutboundActivityId,
};
