/**
 * 活动表单等下拉主数据：lookup_options
 * GET ?category= 仅返回 is_active=1（表单用）；?includeInactive=1 含停用（维护弹窗用）
 *
 * 使用 app 级路径注册（非 Router 挂载），避免部分环境下子应用挂载导致 GET /api/lookups 404。
 */
const db = require('../config/database');

async function handleList(req, res) {
  try {
    const { category, includeInactive } = req.query;
    if (!category || typeof category !== 'string') {
      return res.status(400).json({ error: '缺少参数 category' });
    }
    let sql =
      'SELECT id, category, value, label, sort_order, is_active FROM lookup_options WHERE category = ?';
    const params = [category.trim()];
    if (includeInactive !== '1' && includeInactive !== 'true') {
      sql += ' AND is_active = 1';
    }
    sql += ' ORDER BY sort_order ASC, id ASC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('lookups GET 失败:', err);
    res.status(500).json({ error: '获取选项失败', message: err.message });
  }
}

async function handlePost(req, res) {
  try {
    const { category, value, label, sort_order = 0 } = req.body || {};
    if (!category || !value || !label) {
      return res.status(400).json({ error: 'category、value、label 不能为空' });
    }
    const cat = String(category).trim();
    const val = String(value).trim();
    const lab = String(label).trim();
    const [result] = await db.query(
      'INSERT INTO lookup_options (category, value, label, sort_order, is_active) VALUES (?, ?, ?, ?, 1)',
      [cat, val, lab, parseInt(sort_order, 10) || 0]
    );
    const [rows] = await db.query('SELECT * FROM lookup_options WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: '该分类下已存在相同 value' });
    }
    console.error('lookups POST 失败:', err);
    res.status(500).json({ error: '新增选项失败', message: err.message });
  }
}

async function handlePut(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '无效 id' });
    const { label, sort_order, is_active } = req.body || {};
    const updates = [];
    const params = [];
    if (label !== undefined) {
      updates.push('label = ?');
      params.push(String(label).trim());
    }
    if (sort_order !== undefined) {
      updates.push('sort_order = ?');
      params.push(parseInt(sort_order, 10) || 0);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: '无有效字段可更新' });
    }
    params.push(id);
    await db.query(`UPDATE lookup_options SET ${updates.join(', ')} WHERE id = ?`, params);
    const [rows] = await db.query('SELECT * FROM lookup_options WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' });
    res.json(rows[0]);
  } catch (err) {
    console.error('lookups PUT 失败:', err);
    res.status(500).json({ error: '更新选项失败', message: err.message });
  }
}

async function handleDelete(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: '无效 id' });
    const [result] = await db.query('UPDATE lookup_options SET is_active = 0 WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({ error: '记录不存在' });
    res.json({ ok: true });
  } catch (err) {
    console.error('lookups DELETE 失败:', err);
    res.status(500).json({ error: '停用选项失败', message: err.message });
  }
}

/** 在 app 上注册完整路径（strategy B 注释仍见 migrate 脚本） */
function mountLookupRoutes(app) {
  app.get('/api/lookups', handleList);
  app.post('/api/lookups', handlePost);
  app.put('/api/lookups/:id', handlePut);
  app.delete('/api/lookups/:id', handleDelete);
}

module.exports = { mountLookupRoutes };
