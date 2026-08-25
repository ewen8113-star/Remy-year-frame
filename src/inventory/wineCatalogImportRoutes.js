const express = require('express');
const db = require('../config/database');
const {
  defaultWineLabelFromCatalog,
  wineCatalogSpecLine,
} = require('./wineHelpers');
const { ensureWineCatalog } = require('../wine/ensureWineCatalog');

const router = express.Router();

router.post('/items/from-catalog', async (req, res) => {
  try {
    await ensureWineCatalog(db);
    const whId = parseInt(req.body?.inv_warehouse_id, 10);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!Number.isFinite(whId) || whId <= 0) {
      return res.status(400).json({ error: '缺少 inv_warehouse_id' });
    }
    if (!items.length) {
      return res.status(400).json({ error: '请选择至少一条酒品目录' });
    }
    const ids = [
      ...new Set(
        items
          .map((it) => parseInt(it?.catalog_id, 10))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];
    if (!ids.length) return res.status(400).json({ error: '目录项无效' });

    const [whRows] = await db.query('SELECT id FROM inv_warehouses WHERE id = ? LIMIT 1', [whId]);
    if (!whRows.length) return res.status(404).json({ error: '仓库不存在' });

    const ph = ids.map(() => '?').join(', ');
    const [catalogRows] = await db.query(
      `SELECT id, brand, name, category, volume_label, image_urls
       FROM wine_catalog
       WHERE id IN (${ph})`,
      ids,
    );
    const catalogById = new Map(catalogRows.map((r) => [Number(r.id), r]));

    let inserted = 0;
    let skippedExisting = 0;
    for (const raw of items) {
      const catalogId = parseInt(raw?.catalog_id, 10);
      if (!Number.isFinite(catalogId) || catalogId <= 0) continue;
      const c = catalogById.get(catalogId);
      if (!c) continue;
      const qRaw = parseInt(raw?.quantity, 10);
      const qty = Number.isFinite(qRaw) && qRaw > 0 ? qRaw : 0;
      const spec = wineCatalogSpecLine(c);
      const [exist] = await db.query(
        'SELECT id FROM inv_items WHERE inv_warehouse_id = ? AND name = ? AND COALESCE(dimensions, \'\') = COALESCE(?, \'\') LIMIT 1',
        [whId, String(c.name || '').trim(), spec || null],
      );
      if (exist.length) {
        skippedExisting += 1;
        continue;
      }
      let urls = [];
      try {
        const parsed = typeof c.image_urls === 'string' ? JSON.parse(c.image_urls) : c.image_urls;
        if (Array.isArray(parsed)) urls = parsed;
      } catch (_) {
        urls = [];
      }
      const wineLbl = defaultWineLabelFromCatalog(c);
      await db.query(
        `INSERT INTO inv_items (inv_warehouse_id, name, description, dimensions, initial_quantity, quantity_on_hand, alert_below, image_urls, is_common, is_wine, wine_label)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 1, ?)`,
        [
          whId,
          String(c.name || '').trim(),
          null,
          spec || null,
          qty,
          qty,
          JSON.stringify(urls),
          wineLbl || null,
        ],
      );
      inserted += 1;
    }

    res.json({
      ok: true,
      inserted,
      skipped_existing: skippedExisting,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '批量添加失败' });
  }
});

module.exports = router;
