const express = require('express');
const db = require('../config/database');
const { parseImageUrls } = require('./formatters');
const { itemCatalogUniqueKey } = require('./itemHelpers');

const router = express.Router();

/** 物品目录（全局主数据）：用于新仓库快速导入物料 */
router.get('/item-catalog', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, dimensions, description, image_urls, is_common, source_brands, source_regions, created_at, updated_at
       FROM inv_item_catalog
       ORDER BY is_common DESC, name ASC, id ASC`,
    );
    res.json(
      rows.map((r) => ({
        ...r,
        image_urls: parseImageUrls(r),
      })),
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '获取物品目录失败' });
  }
});

/** 从现有仓库物料同步生成目录（PHD/X.O/CLUB；X.O 限东区和东南区） */
router.post('/item-catalog/sync-from-warehouses', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT i.name, i.dimensions, i.description, i.image_urls, i.is_common, bi.brand_code, w.region
       FROM inv_items i
       INNER JOIN inv_warehouses w ON w.id = i.inv_warehouse_id
       INNER JOIN brand_inventory bi ON bi.id = w.brand_id
       WHERE (
          bi.brand_code IN ('PHD', 'CLUB')
          OR (bi.brand_code = 'X.O' AND w.region IN ('东区', '东南区'))
       )
       ORDER BY i.id ASC`,
    );
    const picked = Array.isArray(rows) ? rows : [];
    const byKey = new Map();
    for (const r of picked) {
      const name = String(r.name || '').trim();
      if (!name) continue;
      const dim = String(r.dimensions || '').trim();
      const key = itemCatalogUniqueKey(name, dim);
      if (!byKey.has(key)) {
        byKey.set(key, {
          name,
          dimensions: dim || null,
          description: String(r.description || '').trim() || null,
          image_urls: parseImageUrls(r),
          is_common: r.is_common ? 1 : 0,
          brands: new Set(),
          regions: new Set(),
        });
      }
      const cur = byKey.get(key);
      if (!cur.description && r.description) cur.description = String(r.description).trim();
      if ((!cur.image_urls || !cur.image_urls.length) && parseImageUrls(r).length) cur.image_urls = parseImageUrls(r);
      if (r.is_common) cur.is_common = 1;
      if (r.brand_code) cur.brands.add(String(r.brand_code).trim());
      if (r.region) cur.regions.add(String(r.region).trim());
    }

    let inserted = 0;
    let updated = 0;
    for (const v of byKey.values()) {
      const sourceBrands = [...v.brands].filter(Boolean).sort().join('、') || null;
      const sourceRegions = [...v.regions].filter(Boolean).sort().join('、') || null;
      const [exist] = await db.query(
        `SELECT id, source_brands, source_regions FROM inv_item_catalog
         WHERE name = ? AND COALESCE(dimensions, '') = COALESCE(?, '')
         LIMIT 1`,
        [v.name, v.dimensions || null],
      );
      if (exist.length) {
        const old = exist[0];
        const mergedBrands = [
          ...new Set([
            ...String(old.source_brands || '')
              .split('、')
              .map((x) => x.trim())
              .filter(Boolean),
            ...String(sourceBrands || '')
              .split('、')
              .map((x) => x.trim())
              .filter(Boolean),
          ]),
        ]
          .sort()
          .join('、') || null;
        const mergedRegions = [
          ...new Set([
            ...String(old.source_regions || '')
              .split('、')
              .map((x) => x.trim())
              .filter(Boolean),
            ...String(sourceRegions || '')
              .split('、')
              .map((x) => x.trim())
              .filter(Boolean),
          ]),
        ]
          .sort()
          .join('、') || null;
        await db.query(
          `UPDATE inv_item_catalog
           SET description = COALESCE(?, description),
               image_urls = CASE WHEN COALESCE(?, '') <> '' THEN ? ELSE image_urls END,
               is_common = GREATEST(COALESCE(is_common, 0), ?),
               source_brands = ?,
               source_regions = ?
           WHERE id = ?`,
          [
            v.description || null,
            JSON.stringify(v.image_urls || []),
            JSON.stringify(v.image_urls || []),
            v.is_common ? 1 : 0,
            mergedBrands,
            mergedRegions,
            old.id,
          ],
        );
        updated += 1;
      } else {
        await db.query(
          `INSERT INTO inv_item_catalog
           (name, dimensions, description, image_urls, is_common, source_brands, source_regions)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            v.name,
            v.dimensions || null,
            v.description || null,
            JSON.stringify(v.image_urls || []),
            v.is_common ? 1 : 0,
            sourceBrands,
            sourceRegions,
          ],
        );
        inserted += 1;
      }
    }

    res.json({ ok: true, total_source_rows: picked.length, unique_items: byKey.size, inserted, updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '同步物品目录失败' });
  }
});

/** 从物品目录添加到仓库：相同名称+规格不重复添加 */
router.post('/items/from-item-catalog', async (req, res) => {
  try {
    const whId = parseInt(req.body?.inv_warehouse_id, 10);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!Number.isFinite(whId) || whId <= 0) {
      return res.status(400).json({ error: '缺少 inv_warehouse_id' });
    }
    if (!items.length) {
      return res.status(400).json({ error: '请选择至少一条物品目录' });
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
      `SELECT id, name, dimensions, description, image_urls, is_common
       FROM inv_item_catalog
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
      const [exist] = await db.query(
        'SELECT id FROM inv_items WHERE inv_warehouse_id = ? AND name = ? AND COALESCE(dimensions, \'\') = COALESCE(?, \'\') LIMIT 1',
        [whId, String(c.name || '').trim(), c.dimensions || null],
      );
      if (exist.length) {
        skippedExisting += 1;
        continue;
      }
      await db.query(
        `INSERT INTO inv_items (inv_warehouse_id, name, description, dimensions, initial_quantity, quantity_on_hand, alert_below, image_urls, is_common)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          whId,
          String(c.name || '').trim(),
          c.description || null,
          c.dimensions || null,
          qty,
          qty,
          JSON.stringify(parseImageUrls(c)),
          c.is_common ? 1 : 0,
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

// ---------- 出库（创建即出库） ----------

module.exports = router;
