function parseCatalogImageUrls(row) {
  if (!row || row.image_urls == null) return [];
  try {
    const j = typeof row.image_urls === 'string' ? JSON.parse(row.image_urls) : row.image_urls;
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

let wineReturnTableReady = null;

function ensureWineReturnTable(db) {
  if (!wineReturnTableReady) {
    wineReturnTableReady = db.query(`
      CREATE TABLE IF NOT EXISTS wine_return_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        year_frame_id INT NOT NULL,
        usage_id INT NULL,
        activity_id INT NULL,
        wine_code VARCHAR(64) NOT NULL,
        wine_name VARCHAR(100) NOT NULL,
        spec VARCHAR(64) NULL,
        quantity INT NOT NULL,
        return_date DATE NOT NULL,
        operator VARCHAR(64) NULL,
        remarks TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }
  return wineReturnTableReady;
}

module.exports = {
  ensureWineReturnTable,
  parseCatalogImageUrls,
};
