const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { formatWarehouseLabel } = require('./formatters');
const {
  classifyWineItemRow,
  invItemWineKey,
  sqlAggNum,
  wineCatalogSpecLine,
  wineCatalogSpecLineUi,
} = require('./wineHelpers');
const { ensureWineCatalog } = require('../wine/ensureWineCatalog');

router.get('/', async (req, res) => {
  try {
    await ensureWineCatalog(db);
    const [catalogRows] = await db.query(
      'SELECT id, brand, name, category, volume_label FROM wine_catalog ORDER BY brand, name, id'
    );
    const catalogStrictKeys = new Set();
    const catalogUiKeys = new Set();
    const catalogNames = new Set();
    (catalogRows || []).forEach((c) => {
      const name = String(c.name || '').trim();
      if (name) catalogNames.add(name);
      catalogStrictKeys.add(invItemWineKey(c.name, wineCatalogSpecLine(c)));
      catalogUiKeys.add(invItemWineKey(c.name, wineCatalogSpecLineUi(c)));
    });

    const [itemRows] = await db.query(
      `
      SELECT i.id, i.inv_warehouse_id, i.name, i.dimensions, i.description, i.quantity_on_hand,
             i.is_common, i.is_wine, i.wine_label,
             w.region, w.label AS warehouse_label, w.city,
             b.brand_code, b.brand_name
      FROM inv_items i
      JOIN inv_warehouses w ON w.id = i.inv_warehouse_id
      LEFT JOIN brand_inventory b ON b.id = w.brand_id
      ORDER BY b.brand_code, w.region, i.name, i.id
      `
    );

    const whMap = new Map();
    let needsReviewTotal = 0;
    let specMismatchTotal = 0;
    let catalogOkTotal = 0;
    let suspectedTotal = 0;

    for (const row of itemRows || []) {
      const whId = Number(row.inv_warehouse_id);
      if (!whMap.has(whId)) {
        whMap.set(whId, {
          warehouse_id: whId,
          warehouse_label: formatWarehouseLabel(row.brand_code, row.region),
          region: row.region,
          brand_code: row.brand_code,
          brand_name: row.brand_name,
          city: row.city,
          warehouse_custom_label: row.warehouse_label,
          counts: {
            items_total: 0,
            suspected: 0,
            catalog_ok: 0,
            needs_review: 0,
            spec_mismatch: 0,
          },
          needs_review: [],
          spec_mismatch: [],
        });
      }
      const bucket = whMap.get(whId);
      bucket.counts.items_total += 1;
      const cls = classifyWineItemRow(row, catalogStrictKeys, catalogUiKeys, catalogNames);
      if (cls.suspected) {
        bucket.counts.suspected += 1;
        suspectedTotal += 1;
      }
      if (cls.catalogStatus === 'catalog_ok') {
        bucket.counts.catalog_ok += 1;
        catalogOkTotal += 1;
      }
      const entry = {
        id: row.id,
        name: row.name,
        dimensions: row.dimensions,
        description: row.description,
        quantity_on_hand: sqlAggNum(row.quantity_on_hand),
        is_common: Number(row.is_common) === 1,
        is_wine: Number(row.is_wine) === 1,
        wine_label: row.wine_label || null,
        catalog_status: cls.catalogStatus,
        suspected: cls.suspected,
        needs_review: cls.needsReview,
        catalog_status_label:
          cls.catalogStatus === 'catalog_ok'
            ? '已与目录一致'
            : cls.catalogStatus === 'catalog_spec_mismatch'
              ? '名称规格与目录不一致'
              : cls.catalogStatus === 'catalog_name_only'
                ? '名称在目录、规格未对齐'
                : '未在酒品目录',
      };
      if (cls.needsReview) {
        bucket.needs_review.push(entry);
        bucket.counts.needs_review += 1;
        needsReviewTotal += 1;
      }
      if (
        cls.catalogStatus === 'catalog_spec_mismatch' ||
        cls.catalogStatus === 'catalog_name_only'
      ) {
        bucket.spec_mismatch.push(entry);
        bucket.counts.spec_mismatch += 1;
        specMismatchTotal += 1;
      }
    }

    res.json({
      data: {
        summary: {
          catalog_count: catalogRows.length,
          warehouse_count: whMap.size,
          item_count: itemRows.length,
          suspected_count: suspectedTotal,
          catalog_ok_count: catalogOkTotal,
          needs_review_count: needsReviewTotal,
          spec_mismatch_count: specMismatchTotal,
        },
        rules: {
          catalog_match:
            '从酒品目录「添加酒品」入库时，规格字段仅保存目录中的容量（volume_label）；仓库筛「酒」若用「品类·容量」可能对不齐。',
          suspected:
            '名称/规格/说明含「数字+ml」或「毫升」，或名称含常见酒类词；名称含「空瓶」的库存行不计入疑似酒。',
        },
        warehouses: [...whMap.values()].filter(
          (w) => w.counts.needs_review > 0 || w.counts.spec_mismatch > 0 || w.counts.suspected > 0
        ),
        warehouses_all: [...whMap.values()],
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '酒品对照排查失败' });
  }
});

module.exports = router;
