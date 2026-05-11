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

/** 旧库在进程内曾跑过 ensure 且 _ensured=true 后，大段 CREATE 不会再跑；故 is_common 必须在 _ensured 短路之前补列。表尚未创建时跳过（由下方 CREATE 带列）。 */
let _invItemsCommonEnsured = false;
async function ensureInvItemsCommonColumn(db) {
  if (_invItemsCommonEnsured) return;
  try {
    const [tc] = await db.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inv_items'`
    );
    if (!Number(tc[0].c)) return;
    if (!(await columnExistsQuery(db, 'inv_items', 'is_common'))) {
      await db.query('ALTER TABLE inv_items ADD COLUMN is_common TINYINT(1) NOT NULL DEFAULT 0');
    }
    _invItemsCommonEnsured = true;
  } catch (e) {
    console.error('inv_items.is_common 补列失败:', e);
    throw e;
  }
}

let _invItemsStatsOverrideEnsured = false;
async function ensureInvItemsStatsOverrideColumns(db) {
  if (_invItemsStatsOverrideEnsured) return;
  try {
    const [tc] = await db.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inv_items'`
    );
    if (!Number(tc[0].c)) return;
    if (!(await columnExistsQuery(db, 'inv_items', 'stats_damaged_override'))) {
      await db.query('ALTER TABLE inv_items ADD COLUMN stats_damaged_override INT NULL');
    }
    if (!(await columnExistsQuery(db, 'inv_items', 'stats_lost_override'))) {
      await db.query('ALTER TABLE inv_items ADD COLUMN stats_lost_override INT NULL');
    }
    _invItemsStatsOverrideEnsured = true;
  } catch (e) {
    console.error('inv_items 统计覆盖列补列失败:', e);
    throw e;
  }
}

let _invReturnLinesCustomerKeepEnsured = false;
async function ensureInvReturnLinesCustomerKeepColumn(db) {
  if (_invReturnLinesCustomerKeepEnsured) return;
  try {
    const [tc] = await db.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inv_return_lines'`
    );
    if (!Number(tc[0].c)) return;
    if (!(await columnExistsQuery(db, 'inv_return_lines', 'qty_customer_keep'))) {
      try {
        await db.query('ALTER TABLE inv_return_lines ADD COLUMN qty_customer_keep INT NOT NULL DEFAULT 0');
      } catch (e) {
        if (!(e && (e.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(String(e.message || ''))))) {
          throw e;
        }
      }
    }
    _invReturnLinesCustomerKeepEnsured = true;
  } catch (e) {
    console.error('inv_return_lines.qty_customer_keep 补列失败:', e);
    throw e;
  }
}

let _invReturnLinesEmptyRecoveredEnsured = false;
async function ensureInvReturnLinesEmptyRecoveredColumn(db) {
  if (_invReturnLinesEmptyRecoveredEnsured) return;
  try {
    const [tc] = await db.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inv_return_lines'`
    );
    if (!Number(tc[0].c)) return;
    if (!(await columnExistsQuery(db, 'inv_return_lines', 'qty_empty_recovered'))) {
      try {
        await db.query('ALTER TABLE inv_return_lines ADD COLUMN qty_empty_recovered INT NOT NULL DEFAULT 0');
      } catch (e) {
        if (!(e && (e.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(String(e.message || ''))))) {
          throw e;
        }
      }
    }
    _invReturnLinesEmptyRecoveredEnsured = true;
  } catch (e) {
    console.error('inv_return_lines.qty_empty_recovered 补列失败:', e);
    throw e;
  }
}

let _invReturnLinesEmptyBottleItemIdEnsured = false;
async function ensureInvReturnLinesEmptyBottleItemIdColumn(db) {
  if (_invReturnLinesEmptyBottleItemIdEnsured) return;
  try {
    const [tc] = await db.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inv_return_lines'`
    );
    if (!Number(tc[0].c)) return;
    if (!(await columnExistsQuery(db, 'inv_return_lines', 'empty_bottle_item_id'))) {
      try {
        await db.query('ALTER TABLE inv_return_lines ADD COLUMN empty_bottle_item_id INT NULL');
      } catch (e) {
        if (!(e && (e.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(String(e.message || ''))))) {
          throw e;
        }
      }
    }
    _invReturnLinesEmptyBottleItemIdEnsured = true;
  } catch (e) {
    console.error('inv_return_lines.empty_bottle_item_id 补列失败:', e);
    throw e;
  }
}

let _invWarehousesCityEnsured = false;
async function ensureInvWarehousesCityColumn(db) {
  if (_invWarehousesCityEnsured) return;
  try {
    const [tc] = await db.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inv_warehouses'`
    );
    if (!Number(tc[0].c)) return;
    if (!(await columnExistsQuery(db, 'inv_warehouses', 'city'))) {
      try {
        await db.query('ALTER TABLE inv_warehouses ADD COLUMN city VARCHAR(64) NULL AFTER label');
      } catch (e) {
        if (!(e && (e.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(String(e.message || ''))))) {
          throw e;
        }
      }
    }
    _invWarehousesCityEnsured = true;
  } catch (e) {
    console.error('inv_warehouses.city 补列失败:', e);
    throw e;
  }
}

let _invWarehousesRemarksEnsured = false;
async function ensureInvWarehousesRemarksColumn(db) {
  if (_invWarehousesRemarksEnsured) return;
  try {
    const [tc] = await db.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inv_warehouses'`
    );
    if (!Number(tc[0].c)) return;
    if (!(await columnExistsQuery(db, 'inv_warehouses', 'remarks'))) {
      try {
        await db.query('ALTER TABLE inv_warehouses ADD COLUMN remarks VARCHAR(500) NULL AFTER city');
      } catch (e) {
        if (!(e && (e.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(String(e.message || ''))))) {
          throw e;
        }
      }
    }
    _invWarehousesRemarksEnsured = true;
  } catch (e) {
    console.error('inv_warehouses.remarks 补列失败:', e);
    throw e;
  }
}

let _invOutboundTrackingEnsured = false;
async function ensureInvOutboundTrackingColumn(db) {
  if (_invOutboundTrackingEnsured) return;
  try {
    const [tc] = await db.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inv_outbound_orders'`
    );
    if (!Number(tc[0].c)) return;
    if (!(await columnExistsQuery(db, 'inv_outbound_orders', 'tracking_number'))) {
      try {
        await db.query('ALTER TABLE inv_outbound_orders ADD COLUMN tracking_number VARCHAR(100) NULL AFTER logistics_method');
      } catch (e) {
        if (!(e && (e.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(String(e.message || ''))))) {
          throw e;
        }
      }
    }
    _invOutboundTrackingEnsured = true;
  } catch (e) {
    console.error('inv_outbound_orders.tracking_number 补列失败:', e);
    throw e;
  }
}

let _invOutboundActivityDateEnsured = false;
/**
 * 幂等补列：inv_outbound_orders.activity_date
 * 用于区分「出库日期」（实际发货日）与「活动日期」（关联场次的真实活动日期）。
 * PDF 文件名规则依赖此字段：无项目编号时按 YYMMDD(activity_date) + 城市 命名。
 */
async function ensureInvOutboundActivityDateColumn(db) {
  if (_invOutboundActivityDateEnsured) return;
  try {
    const [tc] = await db.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inv_outbound_orders'`
    );
    if (!Number(tc[0].c)) return;
    if (!(await columnExistsQuery(db, 'inv_outbound_orders', 'activity_date'))) {
      try {
        await db.query('ALTER TABLE inv_outbound_orders ADD COLUMN activity_date DATE NULL AFTER shipped_at');
      } catch (e) {
        if (!(e && (e.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(String(e.message || ''))))) {
          throw e;
        }
      }
    }
    _invOutboundActivityDateEnsured = true;
  } catch (e) {
    console.error('inv_outbound_orders.activity_date 补列失败:', e);
    throw e;
  }
}

async function ensureInventoryTables(db) {
  await ensureInvItemsCommonColumn(db);
  await ensureInvItemsStatsOverrideColumns(db);
  await ensureInvReturnLinesCustomerKeepColumn(db);
  await ensureInvReturnLinesEmptyRecoveredColumn(db);
  await ensureInvReturnLinesEmptyBottleItemIdColumn(db);
  await ensureInvOutboundTrackingColumn(db);
  await ensureInvOutboundActivityDateColumn(db);
  await ensureInvWarehousesCityColumn(db);
  await ensureInvWarehousesRemarksColumn(db);
  if (_ensured) return;
  if (_ensuring) return _ensuring;
  _ensuring = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_warehouses (
        id INT PRIMARY KEY AUTO_INCREMENT,
        brand_id INT NOT NULL,
        region VARCHAR(32) NOT NULL,
        label VARCHAR(128) NULL,
        city VARCHAR(64) NULL,
        remarks VARCHAR(500) NULL,
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
        stats_damaged_override INT NULL,
        stats_lost_override INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_inv_item_wh FOREIGN KEY (inv_warehouse_id) REFERENCES inv_warehouses(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_item_catalog (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(200) NOT NULL,
        dimensions VARCHAR(200) NULL,
        description TEXT NULL,
        image_urls LONGTEXT NULL,
        is_common TINYINT(1) NOT NULL DEFAULT 0,
        source_brands VARCHAR(200) NULL,
        source_regions VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_inv_item_catalog_name_dim (name, dimensions)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
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
        tracking_number VARCHAR(100) NULL,
        status ENUM('shipped','closed') NOT NULL DEFAULT 'shipped',
        shipped_at DATETIME NULL,
        activity_date DATE NULL,
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
        qty_customer_keep INT NOT NULL DEFAULT 0,
        qty_empty_recovered INT NOT NULL DEFAULT 0,
        empty_bottle_item_id INT NULL,
        CONSTRAINT fk_inv_rl_batch FOREIGN KEY (batch_id) REFERENCES inv_return_batches(id) ON DELETE CASCADE,
        CONSTRAINT fk_inv_rl_ol FOREIGN KEY (outbound_line_id) REFERENCES inv_outbound_lines(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS inv_inbound_records (
        id INT PRIMARY KEY AUTO_INCREMENT,
        inv_warehouse_id INT NOT NULL,
        inv_item_id INT NOT NULL,
        quantity INT NOT NULL DEFAULT 0,
        source VARCHAR(200),
        operator VARCHAR(100),
        remarks TEXT,
        inbound_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_inv_ir_wh FOREIGN KEY (inv_warehouse_id) REFERENCES inv_warehouses(id),
        CONSTRAINT fk_inv_ir_item FOREIGN KEY (inv_item_id) REFERENCES inv_items(id)
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
