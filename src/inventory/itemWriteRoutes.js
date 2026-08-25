const express = require('express');
const db = require('../config/database');
const { parseImageUrls } = require('./formatters');

const router = express.Router();

router.post('/items', async (req, res) => {
  try {
    const {
      inv_warehouse_id,
      name,
      description,
      dimensions,
      initial_quantity,
      alert_below,
      image_urls,
      is_common,
      is_wine,
      wine_label,
    } = req.body;
    const warehouseId = parseInt(inv_warehouse_id, 10);
    const initialQuantity = Math.max(0, parseInt(initial_quantity, 10) || 0);
    if (!Number.isFinite(warehouseId) || !String(name || '').trim()) {
      return res.status(400).json({ error: '请填写仓库与物品名称' });
    }
    const imageUrls = Array.isArray(image_urls) ? image_urls : [];
    const wineLabel = String(wine_label || '').trim() || null;
    const [result] = await db.query(
      `INSERT INTO inv_items (inv_warehouse_id, name, description, dimensions, initial_quantity, quantity_on_hand, alert_below, image_urls, is_common, is_wine, wine_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        warehouseId,
        String(name).trim(),
        description || null,
        dimensions || null,
        initialQuantity,
        initialQuantity,
        alert_below != null && alert_below !== '' ? parseInt(alert_below, 10) : null,
        JSON.stringify(imageUrls),
        Boolean(is_common) ? 1 : 0,
        Boolean(is_wine) ? 1 : 0,
        wineLabel,
      ]
    );
    const [rows] = await db.query('SELECT * FROM inv_items WHERE id = ?', [result.insertId]);
    const item = rows[0];
    res.json({ ...item, image_urls: parseImageUrls(item) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '保存失败' });
  }
});

router.put('/items/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const {
      name,
      description,
      dimensions,
      alert_below,
      image_urls,
      is_common,
      is_wine,
      wine_label,
      quantity_on_hand,
      stats_damaged_override,
      stats_lost_override,
    } = req.body;
    const patches = [];
    const values = [];
    if (quantity_on_hand !== undefined) {
      const quantity = parseInt(quantity_on_hand, 10);
      if (!Number.isFinite(quantity) || quantity < 0) {
        return res.status(400).json({ error: '当前库存须为非负整数' });
      }
      patches.push('quantity_on_hand = ?');
      values.push(quantity);
    }
    if (name != null) {
      patches.push('name = ?');
      values.push(String(name).trim());
    }
    if (description !== undefined) {
      patches.push('description = ?');
      values.push(description || null);
    }
    if (dimensions !== undefined) {
      patches.push('dimensions = ?');
      values.push(dimensions || null);
    }
    if (alert_below !== undefined) {
      patches.push('alert_below = ?');
      values.push(
        alert_below != null && alert_below !== '' ? parseInt(alert_below, 10) : null
      );
    }
    if (image_urls !== undefined) {
      patches.push('image_urls = ?');
      values.push(JSON.stringify(Array.isArray(image_urls) ? image_urls : []));
    }
    if (is_common !== undefined) {
      patches.push('is_common = ?');
      values.push(Boolean(is_common) ? 1 : 0);
    }
    if (is_wine !== undefined) {
      patches.push('is_wine = ?');
      values.push(Boolean(is_wine) ? 1 : 0);
    }
    if (wine_label !== undefined) {
      patches.push('wine_label = ?');
      values.push(String(wine_label || '').trim() || null);
    }
    if (stats_damaged_override !== undefined) {
      if (stats_damaged_override === null || stats_damaged_override === '') {
        patches.push('stats_damaged_override = NULL');
      } else {
        const value = parseInt(stats_damaged_override, 10);
        if (!Number.isFinite(value) || value < 0) {
          return res.status(400).json({ error: '损坏（累计）须为非负整数或留空' });
        }
        patches.push('stats_damaged_override = ?');
        values.push(value);
      }
    }
    if (stats_lost_override !== undefined) {
      if (stats_lost_override === null || stats_lost_override === '') {
        patches.push('stats_lost_override = NULL');
      } else {
        const value = parseInt(stats_lost_override, 10);
        if (!Number.isFinite(value) || value < 0) {
          return res.status(400).json({ error: '丢失（累计）须为非负整数或留空' });
        }
        patches.push('stats_lost_override = ?');
        values.push(value);
      }
    }
    if (!patches.length) return res.status(400).json({ error: '无更新字段' });
    values.push(id);
    await db.query(`UPDATE inv_items SET ${patches.join(', ')} WHERE id = ?`, values);
    const [rows] = await db.query('SELECT * FROM inv_items WHERE id = ?', [id]);
    const item = rows[0];
    res.json({ ...item, image_urls: parseImageUrls(item) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '更新失败' });
  }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    await db.query('DELETE FROM inv_items WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '删除失败' });
  }
});

module.exports = router;
