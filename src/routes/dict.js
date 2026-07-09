/**
 * 字典 / 通讯录路由：/api/dict
 *
 * 数据模型见 src/dict/ensureDictTables.js。
 * 与 lookup_options（表单下拉枚举值）解耦：
 *   - lookup_options：单值枚举（value+label），用于 select 下拉
 *   - dict_entries：多字段复用实体（联系人/供应商/收款人），用于业务表单一键填充
 *
 * 权限：GET 仅登录；POST/PUT/DELETE 由 server.js 的 requireWriteAccess 控制（admin）。
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { ensureDictTables } = require('../dict/ensureDictTables');
const { syncDictEntryNameReferences } = require('../dict/syncDictNameReferences');

router.use(async (req, res, next) => {
  try {
    await ensureDictTables(db);
    next();
  } catch (e) {
    res.status(500).json({ error: e.message || '字典表初始化失败' });
  }
});

/** 已知通讯录类别（前端 UI 内置，后端不强制校验，允许管理员自定义 category） */
const KNOWN_CATEGORIES = ['recipient', 'sender', 'supplier', 'payee', 'reimburser', 'personal_payee'];

/**
 * 安全解析 JSON：mysql2 在 JSON 列上通常返回对象，但若是字符串（驱动版本差异）也兜底解析。
 */
function parseContent(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw)) || {};
  } catch {
    return {};
  }
}

/** dict_categories.fields_schema：必须是数组 */
function parseFieldsSchema(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return [];
  try {
    const v = JSON.parse(String(raw));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 把行转成接口稳定结构：content 总是对象、pinned/is_active 总是布尔 */
function mapRow(r) {
  return {
    id: r.id,
    category: r.category,
    name: r.name,
    short_label: r.short_label || '',
    content: parseContent(r.content),
    tags: r.tags || '',
    pinned: !!r.pinned,
    use_count: Number(r.use_count || 0),
    last_used_at: r.last_used_at,
    is_active: !!r.is_active,
    remarks: r.remarks || '',
    created_by: r.created_by || '',
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** GET /api/dict —— 列表查询（按 category、关键字、是否含停用） */
router.get('/', async (req, res) => {
  try {
    const { category, q, includeInactive } = req.query;
    const clauses = [];
    const params = [];
    if (category) {
      clauses.push('category = ?');
      params.push(String(category).trim());
    }
    if (includeInactive !== '1' && includeInactive !== 'true') {
      clauses.push('is_active = 1');
    }
    const kw = String(q || '').trim();
    if (kw) {
      // 在 name / short_label / tags / content（JSON 文本） / remarks 内做 LIKE 模糊匹配
      clauses.push('(name LIKE ? OR short_label LIKE ? OR tags LIKE ? OR remarks LIKE ? OR CAST(content AS CHAR) LIKE ?)');
      const like = `%${kw}%`;
      params.push(like, like, like, like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `
      SELECT id, category, name, short_label, content, tags, pinned, use_count, last_used_at,
             is_active, remarks, created_by, created_at, updated_at
      FROM dict_entries
      ${where}
      ORDER BY pinned DESC, use_count DESC, last_used_at IS NULL, last_used_at DESC, id DESC
    `;
    const [rows] = await db.query(sql, params);
    res.json(rows.map(mapRow));
  } catch (e) {
    console.error('GET /api/dict 失败:', e);
    res.status(500).json({ error: e.message || '查询失败' });
  }
});

/** GET /api/dict/categories —— 已存在的所有 category（含数量统计），便于前端动态生成 Tab */
router.get('/categories', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT category,
              COUNT(*) AS total,
              SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active
       FROM dict_entries GROUP BY category`
    );
    const map = new Map();
    rows.forEach((r) => {
      map.set(r.category, { category: r.category, total: Number(r.total), active: Number(r.active) });
    });
    KNOWN_CATEGORIES.forEach((c) => {
      if (!map.has(c)) map.set(c, { category: c, total: 0, active: 0 });
    });
    res.json([...map.values()].sort((a, b) => {
      const ai = KNOWN_CATEGORIES.indexOf(a.category);
      const bi = KNOWN_CATEGORIES.indexOf(b.category);
      if (ai === bi) return a.category.localeCompare(b.category);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }));
  } catch (e) {
    console.error('GET /api/dict/categories 失败:', e);
    res.status(500).json({ error: e.message || '查询失败' });
  }
});

/* ===== 自定义类别管理（必须在 /:id 之前注册，否则 /custom-categories 会被当成 id）===== */

/** GET /api/dict/custom-categories */
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

/** GET /api/dict/:id —— 单条详情 */
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 id' });
    const [rows] = await db.query('SELECT * FROM dict_entries WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    res.json(mapRow(rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message || '查询失败' });
  }
});

/** 校验入参，返回标准化后的字段 */
function sanitizeBody(body) {
  const category = String(body.category || '').trim();
  const name = String(body.name || '').trim();
  const short_label = body.short_label == null ? null : String(body.short_label).trim().slice(0, 64) || null;
  const tags = body.tags == null ? null : String(body.tags).trim().slice(0, 255) || null;
  const remarks = body.remarks == null ? null : String(body.remarks).trim() || null;
  const pinned = body.pinned ? 1 : 0;
  const is_active = body.is_active === false || body.is_active === 0 || body.is_active === '0' ? 0 : 1;
  let content = body.content;
  if (content == null) content = {};
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      content = {};
    }
  }
  if (typeof content !== 'object' || Array.isArray(content)) content = {};
  return { category, name, short_label, tags, remarks, pinned, is_active, content };
}

/** POST /api/dict —— 新建 */
router.post('/', async (req, res) => {
  try {
    const v = sanitizeBody(req.body || {});
    if (!v.category) return res.status(400).json({ error: 'category 不能为空' });
    if (!v.name) return res.status(400).json({ error: 'name 不能为空' });
    const op = (req.session && req.session.user && req.session.user.username) || '';
    const [r] = await db.query(
      `INSERT INTO dict_entries (category, name, short_label, content, tags, pinned, is_active, remarks, created_by)
       VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?)`,
      [v.category, v.name, v.short_label, JSON.stringify(v.content), v.tags, v.pinned, v.is_active, v.remarks, op]
    );
    const [rows] = await db.query('SELECT * FROM dict_entries WHERE id = ?', [r.insertId]);
    res.status(201).json(mapRow(rows[0]));
  } catch (e) {
    console.error('POST /api/dict 失败:', e);
    res.status(500).json({ error: e.message || '新建失败' });
  }
});

/** PUT /api/dict/:id —— 更新 */
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 id' });
    const [beforeRows] = await db.query('SELECT * FROM dict_entries WHERE id = ?', [id]);
    if (!beforeRows.length) return res.status(404).json({ error: '记录不存在' });
    const beforeEntry = beforeRows[0];
    const body = req.body || {};
    const sets = [];
    const params = [];
    if (body.category !== undefined) { sets.push('category = ?'); params.push(String(body.category).trim()); }
    if (body.name !== undefined) { sets.push('name = ?'); params.push(String(body.name).trim()); }
    if (body.short_label !== undefined) { sets.push('short_label = ?'); params.push(String(body.short_label || '').trim() || null); }
    if (body.tags !== undefined) { sets.push('tags = ?'); params.push(String(body.tags || '').trim() || null); }
    if (body.remarks !== undefined) { sets.push('remarks = ?'); params.push(String(body.remarks || '').trim() || null); }
    if (body.pinned !== undefined) { sets.push('pinned = ?'); params.push(body.pinned ? 1 : 0); }
    if (body.is_active !== undefined) {
      sets.push('is_active = ?');
      params.push(body.is_active === false || body.is_active === 0 || body.is_active === '0' ? 0 : 1);
    }
    if (body.content !== undefined) {
      let c = body.content;
      if (typeof c === 'string') {
        try { c = JSON.parse(c); } catch { c = {}; }
      }
      if (typeof c !== 'object' || Array.isArray(c)) c = {};
      sets.push('content = CAST(? AS JSON)');
      params.push(JSON.stringify(c));
    }
    if (!sets.length) return res.status(400).json({ error: '无可更新字段' });
    params.push(id);
    await db.query(`UPDATE dict_entries SET ${sets.join(', ')} WHERE id = ?`, params);
    const [rows] = await db.query('SELECT * FROM dict_entries WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    const afterEntry = rows[0];
    let nameSync = { total: 0, byTable: {}, newName: '' };
    try {
      nameSync = await syncDictEntryNameReferences(db, beforeEntry, afterEntry);
      if (nameSync.total > 0) {
        console.log(
          `字典 #${id} 改名已同步业务记录 ${nameSync.total} 条 → ${nameSync.newName}`,
          nameSync.byTable
        );
      }
    } catch (syncErr) {
      console.error(`字典 #${id} 业务名称同步失败（字典已保存）:`, syncErr);
    }
    res.json({ ...mapRow(afterEntry), name_sync: nameSync });
  } catch (e) {
    console.error('PUT /api/dict/:id 失败:', e);
    res.status(500).json({ error: e.message || '更新失败' });
  }
});

/** DELETE /api/dict/:id —— 软删除（停用）；?hard=1 真删 */
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 id' });
    const hard = req.query.hard === '1' || req.query.hard === 'true';
    if (hard) {
      await db.query('DELETE FROM dict_entries WHERE id = ?', [id]);
    } else {
      await db.query('UPDATE dict_entries SET is_active = 0 WHERE id = ?', [id]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || '删除失败' });
  }
});

/** POST /api/dict/:id/touch —— 使用计数 +1（业务页面调用一条条目后回写） */
router.post('/:id/touch', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 id' });
    await db.query('UPDATE dict_entries SET use_count = use_count + 1, last_used_at = NOW() WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || '更新失败' });
  }
});

module.exports = router;
