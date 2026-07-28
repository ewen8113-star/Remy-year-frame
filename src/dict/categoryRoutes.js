const express = require('express');
const db = require('../config/database');
const { parseFieldsSchema } = require('./routeHelpers');

const router = express.Router();

router.get('/custom-categories', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM dict_categories ORDER BY sort_order, id'
    );
    res.json(rows.map((r) => ({
      ...r,
      fields_schema: parseFieldsSchema(r.fields_schema),
      is_builtin: !!r.is_builtin,
      is_active: !!r.is_active,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

/** POST /api/dict/custom-categories */
router.post('/custom-categories', async (req, res) => {
  try {
    const { code, label, icon, description, fields_schema, is_builtin } = req.body || {};
    const c = String(code || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!c) return res.status(400).json({ error: 'code 不能为空（仅小写英文+数字+下划线）' });
    if (!label || !String(label).trim()) return res.status(400).json({ error: 'label 不能为空' });
    const builtin = is_builtin ? 1 : 0;
    if (!builtin && KNOWN_CATEGORIES.includes(c)) return res.status(400).json({ error: '该 code 与系统内置类别冲突' });
    let schema = fields_schema;
    if (typeof schema === 'string') { try { schema = JSON.parse(schema); } catch { schema = []; } }
    if (!Array.isArray(schema)) schema = [];
    const schemaJson = JSON.stringify(schema);
    const trimLabel = String(label).trim();
    const trimIcon = icon || 'tag';
    const trimDesc = description || null;
    const [[existing]] = await db.query(
      'SELECT id FROM dict_categories WHERE code = ? LIMIT 1',
      [c]
    );
    if (existing) {
      if (!builtin) {
        return res.status(400).json({ error: '该 code 已存在' });
      }
      await db.query(
        `UPDATE dict_categories SET label = ?, icon = ?, description = ?, fields_schema = CAST(? AS JSON),
          is_builtin = 1, is_active = 1 WHERE id = ?`,
        [trimLabel, trimIcon, trimDesc, schemaJson, existing.id]
      );
      const [rows] = await db.query('SELECT * FROM dict_categories WHERE id = ?', [existing.id]);
      return res.status(200).json({
        ...rows[0],
        fields_schema: parseFieldsSchema(rows[0].fields_schema),
        is_builtin: !!rows[0].is_builtin,
        is_active: !!rows[0].is_active,
      });
    }
    const [r] = await db.query(
      `INSERT INTO dict_categories (code, label, icon, description, fields_schema, is_builtin, is_active)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, 1)`,
      [c, trimLabel, trimIcon, trimDesc, schemaJson, builtin]
    );
    const [rows] = await db.query('SELECT * FROM dict_categories WHERE id = ?', [r.insertId]);
    res.status(201).json({
      ...rows[0],
      fields_schema: parseFieldsSchema(rows[0].fields_schema),
      is_builtin: !!rows[0].is_builtin,
      is_active: !!rows[0].is_active,
    });
  } catch (e) {
    if (/Duplicate entry/i.test(String(e.message))) return res.status(400).json({ error: '该 code 已存在' });
    res.status(500).json({ error: e.message || '创建失败' });
  }
});

/** PUT /api/dict/custom-categories/:id */
router.put('/custom-categories/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 id' });
    const body = req.body || {};
    const sets = [];
    const params = [];
    if (body.label !== undefined) { sets.push('label = ?'); params.push(String(body.label).trim()); }
    if (body.icon !== undefined) { sets.push('icon = ?'); params.push(String(body.icon || 'tag').trim()); }
    if (body.description !== undefined) { sets.push('description = ?'); params.push(body.description || null); }
    if (body.is_active !== undefined) {
      sets.push('is_active = ?');
      params.push(body.is_active === false || body.is_active === 0 ? 0 : 1);
    }
    if (body.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(parseInt(body.sort_order, 10) || 0); }
    if (body.fields_schema !== undefined) {
      let schema = body.fields_schema;
      if (typeof schema === 'string') { try { schema = JSON.parse(schema); } catch { schema = []; } }
      if (!Array.isArray(schema)) schema = [];
      sets.push('fields_schema = CAST(? AS JSON)');
      params.push(JSON.stringify(schema));
    }
    if (!sets.length) return res.status(400).json({ error: '无可更新字段' });
    params.push(id);
    await db.query(`UPDATE dict_categories SET ${sets.join(', ')} WHERE id = ?`, params);
    const [rows] = await db.query('SELECT * FROM dict_categories WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    res.json({
      ...rows[0],
      fields_schema: parseFieldsSchema(rows[0].fields_schema),
      is_builtin: !!rows[0].is_builtin,
      is_active: !!rows[0].is_active,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || '更新失败' });
  }
});

/** DELETE /api/dict/custom-categories/:id（仅非内置可删） */
router.delete('/custom-categories/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 id' });
    const [[row]] = await db.query('SELECT is_builtin, code FROM dict_categories WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    if (row.is_builtin) return res.status(403).json({ error: '系统内置类别不可删除，只能停用' });
    await db.query('DELETE FROM dict_entries WHERE category = ?', [row.code]);
    await db.query('DELETE FROM dict_categories WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || '删除失败' });
  }
});

module.exports = router;
