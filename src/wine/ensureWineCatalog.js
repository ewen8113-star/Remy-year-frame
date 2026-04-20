/**
 * 酒品目录表 wine_catalog：仅主数据（品牌、名称、类别、容量、图片），不含库存数量。
 */
let _ensured = false;
let _ensuring = null;

async function ensureWineCatalog(db) {
  if (_ensured) return;
  if (_ensuring) return _ensuring;
  _ensuring = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS wine_catalog (
        id INT PRIMARY KEY AUTO_INCREMENT,
        brand VARCHAR(64) NOT NULL DEFAULT '',
        name VARCHAR(200) NOT NULL,
        category VARCHAR(64) NULL,
        volume_label VARCHAR(64) NULL,
        image_urls LONGTEXT NULL,
        sku_code VARCHAR(64) NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_wine_catalog_sku (sku_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    _ensured = true;
  })();
  try {
    await _ensuring;
  } catch (e) {
    _ensuring = null;
    throw e;
  }
}

module.exports = { ensureWineCatalog };
