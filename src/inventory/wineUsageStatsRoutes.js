const express = require('express');
const db = require('../config/database');
const { buildWineUsageStats } = require('./buildWineUsageStats');
const { writeWineUsageStatsExcel } = require('./buildWineUsageStatsExcel');
const {
  defaultWineLabelFromCatalog,
  invItemWineKey,
  wineCatalogSpecLine,
} = require('./wineHelpers');
const { ensureWineCatalog } = require('../wine/ensureWineCatalog');

const router = express.Router();

router.get('/wine-usage-stats', async (req, res) => {
  try {
    const data = await buildWineUsageStats(db, req.query);
    res.json({ data });
  } catch (e) {
    const code = e.status || 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: e.message || '用酒统计加载失败' });
  }
});

router.post('/items/backfill-wine-tags', async (req, res) => {
  try {
    await ensureWineCatalog(db);
    const [catalogRows] = await db.query(
      'SELECT brand, name, category, volume_label FROM wine_catalog'
    );
    const keyToLabel = new Map();
    (catalogRows || []).forEach((catalogRow) => {
      keyToLabel.set(
        invItemWineKey(catalogRow.name, wineCatalogSpecLine(catalogRow)),
        defaultWineLabelFromCatalog(catalogRow)
      );
    });
    const [items] = await db.query(
      'SELECT id, name, dimensions FROM inv_items WHERE is_wine = 0 OR wine_label IS NULL OR wine_label = \'\''
    );
    let updated = 0;
    for (const item of items || []) {
      const label = keyToLabel.get(invItemWineKey(item.name, item.dimensions));
      if (!label) continue;
      await db.query('UPDATE inv_items SET is_wine = 1, wine_label = ? WHERE id = ?', [
        label,
        item.id,
      ]);
      updated += 1;
    }
    res.json({ ok: true, updated, catalog_keys: keyToLabel.size });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '批量标记失败' });
  }
});

router.get('/wine-usage-stats/excel', async (req, res) => {
  try {
    const data = await buildWineUsageStats(db, req.query);
    await writeWineUsageStatsExcel(res, data);
  } catch (e) {
    const code = e.status || 500;
    if (code >= 500) console.error(e);
    if (!res.headersSent) res.status(code).json({ error: e.message || 'Excel 导出失败' });
  }
});

module.exports = router;
