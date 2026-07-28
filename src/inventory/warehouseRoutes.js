const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { canonicalRegion } = require('./formatters');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT w.id, w.brand_id, w.region, w.label, w.city, w.remarks, w.created_at,
             bi.brand_code, bi.brand_name
      FROM inv_warehouses w
      JOIN brand_inventory bi ON bi.id = w.brand_id
      ORDER BY bi.id, w.region
    `
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '加载失败' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { brand_id, label, city, remarks } = req.body;
    const region = canonicalRegion(req.body.region);
    const bid = parseInt(brand_id, 10);
    if (!Number.isFinite(bid) || !region) {
      return res.status(400).json({ error: '请填写品牌与区域（东区/南区/北区/东南区）' });
    }
    const [result] = await db.query(
      'INSERT INTO inv_warehouses (brand_id, region, label, city, remarks) VALUES (?, ?, ?, ?, ?)',
      [
        bid,
        region,
        label ? String(label).trim() : null,
        city ? String(city).trim() : null,
        remarks ? String(remarks).trim() : null,
      ]
    );
    const [rows] = await db.query(
      `
      SELECT w.*, bi.brand_code, bi.brand_name FROM inv_warehouses w
      JOIN brand_inventory bi ON bi.id = w.brand_id WHERE w.id = ?
    `,
      [result.insertId]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '已存在相同品牌与区域的仓库' });
    console.error(e);
    res.status(500).json({ error: e.message || '创建失败' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const { brand_id, label, city, remarks } = req.body;
    const region = canonicalRegion(req.body.region);
    const bid = parseInt(brand_id, 10);
    if (!Number.isFinite(bid) || !region) {
      return res.status(400).json({ error: '请填写品牌与区域（东区/南区/北区/东南区）' });
    }
    await db.query(
      'UPDATE inv_warehouses SET brand_id = ?, region = ?, label = ?, city = ?, remarks = ? WHERE id = ?',
      [
        bid,
        region,
        label ? String(label).trim() : null,
        city ? String(city).trim() : null,
        remarks ? String(remarks).trim() : null,
        id,
      ]
    );
    const [rows] = await db.query(
      `SELECT w.*, bi.brand_code, bi.brand_name FROM inv_warehouses w
       JOIN brand_inventory bi ON bi.id = w.brand_id WHERE w.id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: '仓库不存在' });
    res.json(rows[0]);
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '已存在相同品牌与区域的仓库' });
    console.error(e);
    res.status(500).json({ error: e.message || '更新失败' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    await db.query('DELETE FROM inv_warehouses WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '删除失败' });
  }
});

module.exports = router;
