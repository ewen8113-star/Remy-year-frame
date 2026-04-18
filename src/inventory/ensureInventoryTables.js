/**
 * 物资库存表结构（与 migrate:inventory 一致），供迁移脚本与运行时首次访问自动创建。
 * image_urls 使用 LONGTEXT 以兼容无 JSON 类型的旧版 MySQL。
 */
let _ensured = false;
let _ensuring = null;

async function columnExistsQuery(db, table, col) {
  const [r] = await db.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0].c) > 0;
}

async function ensureInventoryTables(db) {
  if (_ensured) return;
  if (_ensuring) return _ensuring;
  _ensuring = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_warehouses (
        id INT PRIMARY KEY AUTO_INCREMENT,
        brand_id INT NOT NULL,
        region VARCHAR(32) NOT NULL,
        label VARCHAR(128) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_inv_wh_global (brand_id, region),
        CONSTRAINT fk_inv_wh_brand FOREIGN KEY (brand_id) REFERENCES brand_inventory(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_items (
        id INT PRIMARY KEY AUTO_INCREMENT,
        inv_warehouse_id INT NOT NULL,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        dimensions VARCHAR(200),
        initial_quantity INT NOT NULL DEFAULT 0,
        quantity_on_hand INT NOT NULL DEFAULT 0,
        alert_below INT NULL,
        image_urls LONGTEXT NULL,
        is_common TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_inv_item_wh FOREIGN KEY (inv_warehouse_id) REFERENCES inv_warehouses(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    if (!(await columnExistsQuery(db, 'inv_items', 'is_common'))) {
      await db.query(
        'ALTER TABLE inv_items ADD COLUMN is_common TINYINT(1) NOT NULL DEFAULT 0'
      );
    }
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_outbound_orders (
        id INT PRIMARY KEY AUTO_INCREMENT,
        inv_warehouse_id INT NOT NULL,
        activity_id INT NULL,
        link_mode ENUM('activity','standalone') NOT NULL DEFAULT 'activity',
        project_code VARCHAR(200) NULL,
        purpose TEXT NULL,
        recipient_city VARCHAR(100),
        recipient_address VARCHAR(500),
        contact_name VARCHAR(100),
        contact_phone VARCHAR(50),
        logistics_method VARCHAR(80),
        status ENUM('shipped','closed') NOT NULL DEFAULT 'shipped',
        shipped_at DATETIME NULL,
        operator VARCHAR(100),
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_inv_ob_wh FOREIGN KEY (inv_warehouse_id) REFERENCES inv_warehouses(id),
        CONSTRAINT fk_inv_ob_act FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_outbound_lines (
        id INT PRIMARY KEY AUTO_INCREMENT,
        order_id INT NOT NULL,
        item_id INT NOT NULL,
        quantity INT NOT NULL,
        line_note VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_inv_ol_order FOREIGN KEY (order_id) REFERENCES inv_outbound_orders(id) ON DELETE CASCADE,
        CONSTRAINT fk_inv_ol_item FOREIGN KEY (item_id) REFERENCES inv_items(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_return_batches (
        id INT PRIMARY KEY AUTO_INCREMENT,
        outbound_order_id INT NOT NULL,
        return_date DATE NOT NULL,
        operator VARCHAR(100),
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_inv_rb_ob FOREIGN KEY (outbound_order_id) REFERENCES inv_outbound_orders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_return_lines (
        id INT PRIMARY KEY AUTO_INCREMENT,
        batch_id INT NOT NULL,
        outbound_line_id INT NOT NULL,
        qty_return INT NOT NULL DEFAULT 0,
        qty_lost INT NOT NULL DEFAULT 0,
        qty_damaged INT NOT NULL DEFAULT 0,
        CONSTRAINT fk_inv_rl_batch FOREIGN KEY (batch_id) REFERENCES inv_return_batches(id) ON DELETE CASCADE,
        CONSTRAINT fk_inv_rl_ol FOREIGN KEY (outbound_line_id) REFERENCES inv_outbound_lines(id) ON DELETE CASCADE
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

module.exports = { ensureInventoryTables };
