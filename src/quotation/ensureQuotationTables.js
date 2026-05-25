/**
 * 报价单表结构 + 活动场次模版种子（幂等）
 */
const {
  EVENT_TEMPLATE_ROWS,
  EVENT_TEMPLATE_DESC_LEGACY,
  EVENT_TEMPLATE_DESC_SYNC_CODES,
  EVENT_TEMPLATE_BY_SUBSECTION,
  EVENT_TEMPLATE_SUBSECTION_LEGACY_MAP,
} = require('./eventTemplateRows');

async function seedEventTemplate(db) {
  const [cnt] = await db.query(
    "SELECT COUNT(*) AS c FROM quotation_template_sections WHERE applicable_type = 'EVENT'"
  );
  if (Number(cnt[0].c) > 0) return;
  for (const row of EVENT_TEMPLATE_ROWS) {
    await db.query(
      `INSERT INTO quotation_template_sections (
        applicable_type, section_code, section_name, subsection_code, subsection_name,
        description, item_category, default_unit, default_unit_price, default_remarks, sort_order, is_active
      ) VALUES ('EVENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        row.section_code,
        row.section_name,
        row.subsection_code,
        row.subsection_name,
        row.description,
        row.item_category || '',
        row.default_unit,
        row.default_unit_price,
        row.default_remarks || null,
        row.sort_order,
      ]
    );
  }
}

/** 同一 subsection_code 只保留一条活跃模版，其余停用 */
async function dedupeEventTemplateSections(db) {
  for (const row of EVENT_TEMPLATE_ROWS) {
    const [hits] = await db.query(
      `SELECT id, description FROM quotation_template_sections
       WHERE applicable_type = 'EVENT' AND subsection_code = ?
       ORDER BY (description = ?) DESC, id ASC`,
      [row.subsection_code, row.description]
    );
    if (!hits.length) continue;
    const keepId = hits[0].id;
    await db.query(
      `UPDATE quotation_template_sections SET
        section_code = ?, section_name = ?, subsection_name = ?, description = ?, item_category = ?,
        default_unit = ?, default_unit_price = ?, default_remarks = ?, sort_order = ?, is_active = 1
      WHERE id = ?`,
      [
        row.section_code,
        row.section_name,
        row.subsection_name,
        row.description,
        row.item_category || '',
        row.default_unit,
        row.default_unit_price,
        row.default_remarks || null,
        row.sort_order,
        keepId,
      ]
    );
    const dupIds = hits.slice(1).map((h) => h.id);
    if (dupIds.length) {
      await db.query(
        `UPDATE quotation_template_sections SET is_active = 0 WHERE id IN (${dupIds.map(() => '?').join(',')})`,
        dupIds
      );
    }
  }
}

/** 将种子数据写回模版表（单价/备注/排序；按 subsection_code 匹配） */
async function syncEventTemplateDefaultPrices(db) {
  for (const row of EVENT_TEMPLATE_ROWS) {
    const [hit] = await db.query(
      `SELECT id FROM quotation_template_sections
       WHERE applicable_type = 'EVENT' AND subsection_code = ? ORDER BY id ASC LIMIT 1`,
      [row.subsection_code]
    );
    if (hit.length) {
      await db.query(
        `UPDATE quotation_template_sections SET
          section_code = ?, section_name = ?, subsection_name = ?, description = ?, item_category = ?,
          default_unit = ?, default_unit_price = ?, default_remarks = ?, sort_order = ?, is_active = 1
        WHERE id = ?`,
        [
          row.section_code,
          row.section_name,
          row.subsection_name,
          row.description,
          row.item_category || '',
          row.default_unit,
          row.default_unit_price,
          row.default_remarks || null,
          row.sort_order,
          hit[0].id,
        ]
      );
    } else {
      await db.query(
        `INSERT INTO quotation_template_sections (
          applicable_type, section_code, section_name, subsection_code, subsection_name,
          description, item_category, default_unit, default_unit_price, default_remarks, sort_order, is_active
        ) VALUES ('EVENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          row.section_code,
          row.section_name,
          row.subsection_code,
          row.subsection_name,
          row.description,
          row.item_category || '',
          row.default_unit,
          row.default_unit_price,
          row.default_remarks || null,
          row.sort_order,
        ]
      );
    }
  }
}

/** 停用旧版 1/2/3 数字大板块模版，启用 A–E 结构 */
async function retireLegacyEventTemplateSections(db) {
  await db.query(
    `UPDATE quotation_template_sections SET is_active = 0
     WHERE applicable_type = 'EVENT' AND section_code IN ('1', '2', '3')`
  );
}

async function ensureQuotationColumn(db, table, column, ddl) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (Number(rows[0].c) === 0) await db.query(ddl);
}

async function ensureQuotationTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS quotations (
      id INT PRIMARY KEY AUTO_INCREMENT,
      quotation_no VARCHAR(32) NOT NULL,
      type ENUM('EVENT','REPAIR','WAREHOUSE') NOT NULL DEFAULT 'EVENT',
      year_frame_id INT NULL,
      activity_id INT NULL,
      project_code VARCHAR(200) NULL COMMENT '关联场次项目编号（冗余）',
      client_brand VARCHAR(200) NULL,
      client_contact VARCHAR(120) NULL,
      project_name VARCHAR(300) NULL,
      event_date DATE NULL,
      city VARCHAR(80) NULL,
      customer_name VARCHAR(200) NULL,
      event_type VARCHAR(80) NULL,
      service_rate DECIMAL(5,4) NOT NULL DEFAULT 0.1200,
      tax_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0600,
      subtotal_ex_tax DECIMAL(14,2) NOT NULL DEFAULT 0,
      service_charge DECIMAL(14,2) NOT NULL DEFAULT 0,
      tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_quotation_no (quotation_no),
      KEY idx_quotations_yf (year_frame_id),
      KEY idx_quotations_type_status (type, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS quotation_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      quotation_id INT NOT NULL,
      section_code VARCHAR(16) NOT NULL,
      section_name VARCHAR(120) NOT NULL,
      subsection_code VARCHAR(16) NOT NULL,
      subsection_name VARCHAR(120) NOT NULL,
      description VARCHAR(500) NOT NULL,
      quantity DECIMAL(14,4) NOT NULL DEFAULT 0,
      unit VARCHAR(40) NULL,
      unit_price DECIMAL(14,4) NOT NULL DEFAULT 0,
      subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
      remarks TEXT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_custom TINYINT(1) NOT NULL DEFAULT 0,
      is_template TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_qi_quotation FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
      KEY idx_qi_quotation (quotation_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS quotation_template_sections (
      id INT PRIMARY KEY AUTO_INCREMENT,
      applicable_type ENUM('EVENT','REPAIR','WAREHOUSE') NOT NULL DEFAULT 'EVENT',
      section_code VARCHAR(16) NOT NULL,
      section_name VARCHAR(120) NOT NULL,
      subsection_code VARCHAR(16) NOT NULL,
      subsection_name VARCHAR(120) NOT NULL,
      description VARCHAR(500) NOT NULL,
      default_unit VARCHAR(40) NULL,
      default_unit_price DECIMAL(14,4) NOT NULL DEFAULT 0,
      default_remarks TEXT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_qts_type (applicable_type, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureQuotationColumn(
    db,
    'quotations',
    'project_code',
    'ALTER TABLE quotations ADD COLUMN project_code VARCHAR(200) NULL COMMENT \'关联场次项目编号\' AFTER activity_id'
  );

  await ensureQuotationColumn(
    db,
    'quotations',
    'quote_mode',
    "ALTER TABLE quotations ADD COLUMN quote_mode VARCHAR(16) NOT NULL DEFAULT 'single' COMMENT 'single|multi' AFTER type"
  );

  await ensureQuotationColumn(
    db,
    'quotations',
    'linked_sessions',
    'ALTER TABLE quotations ADD COLUMN linked_sessions JSON NULL COMMENT \'多场关联场次\' AFTER project_code'
  );

  await ensureQuotationColumn(
    db,
    'quotations',
    'merged_from_quote_ids',
    'ALTER TABLE quotations ADD COLUMN merged_from_quote_ids JSON NULL COMMENT \'由哪些单场报价合并生成\' AFTER linked_sessions'
  );

  await ensureQuotationColumn(
    db,
    'quotation_items',
    'item_category',
    "ALTER TABLE quotation_items ADD COLUMN item_category VARCHAR(80) NOT NULL DEFAULT '' AFTER description"
  );
  await ensureQuotationColumn(
    db,
    'quotation_template_sections',
    'item_category',
    "ALTER TABLE quotation_template_sections ADD COLUMN item_category VARCHAR(80) NOT NULL DEFAULT '' AFTER description"
  );

  try {
    await db.query(
      `ALTER TABLE quotations MODIFY COLUMN project_code VARCHAR(500) NULL COMMENT '关联场次项目编号（冗余；多场为摘要）'`
    );
  } catch (_) {
    /* 列宽已满足或权限不足时忽略 */
  }

  await seedEventTemplate(db);
  await retireLegacyEventTemplateSections(db);
  await syncEventTemplateDefaultPrices(db);
  await dedupeEventTemplateSections(db);
  await syncEventTemplateItemDescriptions(db);
  await retireObsoleteEventSubsections(db);
  await syncEventTemplateStructureToItems(db);
  await syncQuotationEventDatesFromActivities(db);
}

/** 停用已迁入 F/G 的旧 E-5~E-9 模版行 */
async function retireObsoleteEventSubsections(db) {
  const legacyCodes = Object.keys(EVENT_TEMPLATE_SUBSECTION_LEGACY_MAP);
  if (!legacyCodes.length) return;
  await db.query(
    `UPDATE quotation_template_sections SET is_active = 0
     WHERE applicable_type = 'EVENT' AND subsection_code IN (${legacyCodes.map(() => '?').join(',')})`,
    legacyCodes
  );
}

/** 已有明细：E-5~E-9 → F/G；D-1 去掉模版默认备注「广州-深圳往返」 */
async function syncEventTemplateStructureToItems(db) {
  for (const [legacyCode, newCode] of Object.entries(EVENT_TEMPLATE_SUBSECTION_LEGACY_MAP)) {
    const row = EVENT_TEMPLATE_BY_SUBSECTION[newCode];
    if (!row) continue;
    await db.query(
      `UPDATE quotation_items qi
       INNER JOIN quotations q ON q.id = qi.quotation_id
       SET qi.section_code = ?, qi.section_name = ?, qi.subsection_code = ?,
           qi.item_category = ?, qi.sort_order = ?
       WHERE q.type = 'EVENT' AND qi.is_custom = 0 AND qi.subsection_code = ?`,
      [
        row.section_code,
        row.section_name,
        row.subsection_code,
        row.item_category || '',
        row.sort_order,
        legacyCode,
      ]
    );
  }
  const d1 = EVENT_TEMPLATE_BY_SUBSECTION['D-1'];
  if (d1) {
    await db.query(
      `UPDATE quotation_items qi
       INNER JOIN quotations q ON q.id = qi.quotation_id
       SET qi.remarks = ?
       WHERE q.type = 'EVENT' AND qi.is_custom = 0
         AND qi.subsection_code = 'D-1' AND qi.remarks = ?`,
      [d1.default_remarks || '', '广州-深圳往返']
    );
  }
}

/** 单场报价 event_date 与关联场次 activities.date 对齐（修复时区写入差一天） */
async function syncQuotationEventDatesFromActivities(db) {
  await db.query(
    `UPDATE quotations q
     INNER JOIN activities a ON a.id = q.activity_id
     SET q.event_date = a.date
     WHERE q.type = 'EVENT'
       AND COALESCE(q.quote_mode, 'single') = 'single'
       AND a.date IS NOT NULL`
  );
}

/** 将已有报价单中 B-1 / C-4 / C-5 的旧说明迁到当前模版文案 */
async function syncEventTemplateItemDescriptions(db) {
  for (const code of EVENT_TEMPLATE_DESC_SYNC_CODES) {
    const row = EVENT_TEMPLATE_BY_SUBSECTION[code];
    const legacy = EVENT_TEMPLATE_DESC_LEGACY[code];
    if (!row || !legacy?.length) continue;
    const placeholders = legacy.map(() => '?').join(', ');
    await db.query(
      `UPDATE quotation_items qi
       INNER JOIN quotations q ON q.id = qi.quotation_id
       SET qi.description = ?
       WHERE q.type = 'EVENT' AND qi.is_custom = 0
         AND qi.subsection_code = ?
         AND qi.description IN (${placeholders})`,
      [row.description, code, ...legacy]
    );
  }
}

module.exports = {
  ensureQuotationTables,
  EVENT_TEMPLATE_ROWS,
  syncEventTemplateDefaultPrices,
  dedupeEventTemplateSections,
  syncEventTemplateItemDescriptions,
  syncQuotationEventDatesFromActivities,
  retireLegacyEventTemplateSections,
};
