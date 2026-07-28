const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { wineCatalogUploadMulter } = require('./catalogUpload');
const { parseCatalogImageUrls } = require('./routeHelpers');

router.post('/upload', (req, res) => {
  wineCatalogUploadMulter.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '上传失败' });
    try {
      if (!req.file) return res.status(400).json({ error: '未选择文件' });
      const url = `/uploads/wine-catalog/${req.file.filename}`;
      res.json({ url, filename: req.file.filename });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || '上传失败' });
    }
  });
});

/** 酒品目录列表（无库存数量） */
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM wine_catalog ORDER BY sort_order DESC, brand, name, id'
    );
    res.json(
      rows.map((r) => ({
        ...r,
        image_urls: parseCatalogImageUrls(r),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '获取酒品目录失败' });
  }
});

/** 单条目录 */
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [rows] = await db.query('SELECT * FROM wine_catalog WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    const r = rows[0];
    res.json({ ...r, image_urls: parseCatalogImageUrls(r) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '获取失败' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { brand, name, category, volume_label, image_urls, sku_code, sort_order } = req.body;
    const n = String(name || '').trim();
    if (!n) return res.status(400).json({ error: '请填写酒品名称' });
    let urls = image_urls;
    if (urls != null && !Array.isArray(urls)) urls = [];
    const sku = sku_code != null && String(sku_code).trim() !== '' ? String(sku_code).trim() : null;
    const [ret] = await db.query(
      `INSERT INTO wine_catalog (brand, name, category, volume_label, image_urls, sku_code, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        String(brand || '').trim(),
        n,
        category != null ? String(category).trim() || null : null,
        volume_label != null ? String(volume_label).trim() || null : null,
        JSON.stringify(Array.isArray(urls) ? urls : []),
        sku,
        Number.isFinite(parseInt(sort_order, 10)) ? parseInt(sort_order, 10) : 0,
      ]
    );
    const [rows] = await db.query('SELECT * FROM wine_catalog WHERE id = ?', [ret.insertId]);
    const r = rows[0];
    res.json({ ...r, image_urls: parseCatalogImageUrls(r) });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'SKU 编码已存在' });
    }
    console.error(err);
    res.status(500).json({ error: err.message || '保存失败' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const { brand, name, category, volume_label, image_urls, sku_code, sort_order } = req.body;
    const n = name != null ? String(name).trim() : '';
    if (name !== undefined && !n) return res.status(400).json({ error: '名称不能为空' });
    const patches = [];
    const vals = [];
    if (brand !== undefined) {
      patches.push('brand = ?');
      vals.push(String(brand || '').trim());
    }
    if (name !== undefined) {
      patches.push('name = ?');
      vals.push(n);
    }
    if (category !== undefined) {
      patches.push('category = ?');
      vals.push(category != null ? String(category).trim() || null : null);
    }
    if (volume_label !== undefined) {
      patches.push('volume_label = ?');
      vals.push(volume_label != null ? String(volume_label).trim() || null : null);
    }
    if (image_urls !== undefined) {
      let arr = image_urls;
      if (arr != null && !Array.isArray(arr)) arr = [];
      patches.push('image_urls = ?');
      vals.push(JSON.stringify(Array.isArray(arr) ? arr : []));
    }
    if (sku_code !== undefined) {
      patches.push('sku_code = ?');
      vals.push(sku_code != null && String(sku_code).trim() !== '' ? String(sku_code).trim() : null);
    }
    if (sort_order !== undefined) {
      patches.push('sort_order = ?');
      vals.push(Number.isFinite(parseInt(sort_order, 10)) ? parseInt(sort_order, 10) : 0);
    }
    if (!patches.length) return res.status(400).json({ error: '无更新字段' });
    vals.push(id);
    await db.query(`UPDATE wine_catalog SET ${patches.join(', ')} WHERE id = ?`, vals);
    const [rows] = await db.query('SELECT * FROM wine_catalog WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    const r = rows[0];
    res.json({ ...r, image_urls: parseCatalogImageUrls(r) });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'SKU 编码已存在' });
    }
    console.error(err);
    res.status(500).json({ error: err.message || '更新失败' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [r] = await db.query('DELETE FROM wine_catalog WHERE id = ?', [id]);
    if (!r.affectedRows) return res.status(404).json({ error: '记录不存在' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '删除失败' });
  }
});

module.exports = router;
