const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('admin'));

async function countActiveAdmins() {
  const [rows] = await db.query(
    "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1"
  );
  return Number(rows[0]?.c || 0);
}

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, username, role, is_active, last_login_at, created_at, updated_at
       FROM users ORDER BY id ASC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: '获取用户列表失败', message: e.message });
  }
});

router.put('/:id/role', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const role = String(req.body?.role || '').trim();
    if (!id) return res.status(400).json({ error: '无效用户ID' });
    if (!['admin', 'operator'].includes(role)) return res.status(400).json({ error: '角色必须是 admin 或 operator' });

    const [rows] = await db.query('SELECT id, role, is_active FROM users WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: '用户不存在' });
    const target = rows[0];
    const meId = Number(req.session?.user?.id || 0);
    if (meId && meId === id && role !== 'admin') {
      return res.status(400).json({ error: '不能将当前登录管理员降级，避免自锁' });
    }
    if (target.role === 'admin' && target.is_active === 1 && role !== 'admin') {
      const cnt = await countActiveAdmins();
      if (cnt <= 1) return res.status(400).json({ error: '系统至少需要保留一个启用中的管理员' });
    }
    await db.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    const [ret] = await db.query(
      'SELECT id, username, role, is_active, last_login_at, created_at, updated_at FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    res.json({ ok: true, user: ret[0] });
  } catch (e) {
    res.status(500).json({ error: '更新角色失败', message: e.message });
  }
});

router.put('/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const isActive = req.body?.is_active ? 1 : 0;
    if (!id) return res.status(400).json({ error: '无效用户ID' });
    const [rows] = await db.query('SELECT id, role, is_active FROM users WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: '用户不存在' });
    const target = rows[0];
    const meId = Number(req.session?.user?.id || 0);
    if (meId && meId === id && !isActive) {
      return res.status(400).json({ error: '不能停用当前登录管理员，避免自锁' });
    }
    if (target.role === 'admin' && target.is_active === 1 && !isActive) {
      const cnt = await countActiveAdmins();
      if (cnt <= 1) return res.status(400).json({ error: '系统至少需要保留一个启用中的管理员' });
    }
    await db.query('UPDATE users SET is_active = ? WHERE id = ?', [isActive, id]);
    const [ret] = await db.query(
      'SELECT id, username, role, is_active, last_login_at, created_at, updated_at FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    res.json({ ok: true, user: ret[0] });
  } catch (e) {
    res.status(500).json({ error: '更新状态失败', message: e.message });
  }
});

router.put('/:id/password', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const newPassword = String(req.body?.new_password || '');
    if (!id) return res.status(400).json({ error: '无效用户ID' });
    if (newPassword.length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
    const [rows] = await db.query('SELECT id FROM users WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: '用户不存在' });
    const hash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '重置密码失败', message: e.message });
  }
});

module.exports = router;
