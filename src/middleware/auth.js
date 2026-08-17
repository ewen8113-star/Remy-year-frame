const db = require('../config/database');

function requireAuth(req, res, next) {
  if (req.session?.user?.id) return next();
  return res.status(401).json({ error: '未登录' });
}

function requireRole(...roles) {
  const allowed = new Set((roles || []).filter(Boolean));
  return async (req, res, next) => {
    const userId = Number(req.session?.user?.id || 0);
    if (!userId) return res.status(401).json({ error: '未登录' });

    let role = String(req.session?.user?.role || '').trim().toLowerCase();
    // Always trust DB as source of truth, so role/status updates take effect immediately.
    const [rows] = await db.query(
      'SELECT role, is_active FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    if (!rows.length || !rows[0].is_active) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: '登录已失效' });
    }
    role = String(rows[0].role || '').trim().toLowerCase();
    if (req.session?.user) req.session.user.role = role;

    if (!allowed.has(role)) return res.status(403).json({ error: '权限不足' });
    return next();
  };
}

function requestPathCandidates(req) {
  const strip = (u) => String(u || '').split('?')[0];
  return [
    strip(req.originalUrl),
    strip(req.url),
    String(req.path || ''),
    `${req.baseUrl || ''}${req.path || ''}`,
  ];
}

/**
 * operator 可写范围：报销成本登记（含导入/合并/状态），以及保存报销时回写个人收款方。
 * 同时匹配 originalUrl 与挂载后的 path，避免 Express 中间件路径剥离导致误判。
 */
function isOperatorAllowedWrite(req) {
  const method = String(req.method || '').toUpperCase();
  const paths = requestPathCandidates(req);
  const hit = (re) => paths.some((u) => re.test(u));
  if (hit(/\/reimbursements(\/|$)/)) return true;
  if (method === 'POST' && hit(/\/dict\/\d+\/touch$/)) return true;
  if (method === 'PUT' && hit(/\/dict\/\d+$/)) return true;
  if (method === 'POST' && hit(/\/dict\/?$/)) return true;
  return false;
}

function requireWriteAccess(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  if (isOperatorAllowedWrite(req)) {
    return requireRole('admin', 'operator')(req, res, next);
  }
  return requireRole('admin')(req, res, next);
}

module.exports = { requireAuth, requireRole, requireWriteAccess };
