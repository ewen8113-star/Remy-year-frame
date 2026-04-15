function requireAuth(req, res, next) {
  if (req.session?.user?.id) return next();
  return res.status(401).json({ error: '未登录' });
}

function requireRole(...roles) {
  const allowed = new Set((roles || []).filter(Boolean));
  return (req, res, next) => {
    const role = req.session?.user?.role;
    if (!role) return res.status(401).json({ error: '未登录' });
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
