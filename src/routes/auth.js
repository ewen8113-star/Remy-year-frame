const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function safeUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    is_active: row.is_active,
    last_login_at: row.last_login_at,
  };
}

router.post('/register', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }
    if (username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: '用户名长度需为 3-32 字符' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: '密码至少 8 位' });
    }
    const [exists] = await db.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    if (exists.length) return res.status(400).json({ error: '用户名已存在' });

    const hash = await bcrypt.hash(password, 12);
    const [ret] = await db.query(
      "INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, 'operator', 1)",
      [username, hash]
    );
    const [rows] = await db.query(
      'SELECT id, username, role, is_active, last_login_at FROM users WHERE id = ? LIMIT 1',
      [ret.insertId]
    );
    res.status(201).json({ ok: true, user: safeUser(rows[0]) });
  } catch (e) {
    res.status(500).json({ error: '注册失败', message: e.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }
    const [rows] = await db.query(
      'SELECT id, username, password_hash, role, is_active, last_login_at FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    if (!rows.length) return res.status(401).json({ error: '用户名或密码错误' });
    const user = rows[0];
    if (!user.is_active) return res.status(403).json({ error: '账号已停用，请联系管理员' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: '用户名或密码错误' });
    req.session.user = { id: user.id, username: user.username, role: user.role };
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    res.json({ ok: true, user: safeUser(user) });
  } catch (e) {
    res.status(500).json({ error: '登录失败', message: e.message });
  }
});

router.post('/logout', async (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

router.get('/me', async (req, res) => {
  try {
    const sUser = req.session?.user;
    if (!sUser || !sUser.id) return res.status(401).json({ error: '未登录' });
    const [rows] = await db.query(
      'SELECT id, username, role, is_active, last_login_at FROM users WHERE id = ? LIMIT 1',
      [sUser.id]
    );
    if (!rows.length || !rows[0].is_active) return res.status(401).json({ error: '登录已失效' });
    res.json({ ok: true, user: safeUser(rows[0]) });
  } catch (e) {
    res.status(500).json({ error: '获取登录态失败', message: e.message });
  }
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.current_password || '');
    const newPassword = String(req.body?.new_password || '');
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: '请填写当前密码与新密码' });
    }
    if (newPassword.length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
    const uid = Number(req.session.user.id);
    const [rows] = await db.query(
      'SELECT id, password_hash, is_active FROM users WHERE id = ? LIMIT 1',
      [uid]
    );
    if (!rows.length || !rows[0].is_active) return res.status(401).json({ error: '登录已失效' });
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(400).json({ error: '当前密码不正确' });
    const hash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, uid]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '修改密码失败', message: e.message });
  }
});

module.exports = router;
