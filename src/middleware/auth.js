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

function requireWriteAccess(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  return requireRole('admin')(req, res, next);
}

module.exports = { requireAuth, requireRole, requireWriteAccess };
