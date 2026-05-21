/**
 * 报价单表结构 + 活动场次模版种子（幂等）
 */
const EVENT_TEMPLATE_ROWS = [
  { section_code: '1', section_name: '物料制作费用', subsection_code: '1.01', subsection_name: '物料制作&采购', description: '菜单', default_unit: '项', default_unit_price: 8, default_remarks: '300铜版纸，专色印刷覆哑膜，双面打印', sort_order: 10 },
  { section_code: '1', section_name: '物料制作费用', subsection_code: '1.01', subsection_name: '物料制作&采购', description: '名卡', default_unit: '份', default_unit_price: 12, default_remarks: '', sort_order: 11 },
  { section_code: '1', section_name: '物料制作费用', subsection_code: '1.01', subsection_name: '物料制作&采购', description: '背板指示牌等 (KT 板)', default_unit: '项', default_unit_price: 100, default_remarks: '指示牌*1 :600*900mm 写真覆亚膜KT板', sort_order: 12 },
  { section_code: '1', section_name: '物料制作费用', subsection_code: '1.01', subsection_name: '物料制作&采购', description: '设计费', default_unit: '项', default_unit_price: 200, default_remarks: '', sort_order: 13 },
  { section_code: '1', section_name: '物料制作费用', subsection_code: '1.01', subsection_name: '物料制作&采购', description: '鲜花', default_unit: '份', default_unit_price: 500, default_remarks: '', sort_order: 14 },
  { section_code: '1', section_name: '物料制作费用', subsection_code: '1.01', subsection_name: '物料制作&采购', description: '品鉴物料', default_unit: '份', default_unit_price: 40, default_remarks: '', sort_order: 15 },
  { section_code: '2', section_name: '物流运输费用', subsection_code: '2.01', subsection_name: '物料运输', description: '陈列道具\n桌面陈列&\n品鉴杯子', default_unit: '公里/来回', default_unit_price: 7, default_remarks: '广州-深圳往返', sort_order: 20 },
  { section_code: '2', section_name: '物流运输费用', subsection_code: '2.01', subsection_name: '物料运输', description: '仓库理货费', default_unit: '次', default_unit_price: 100, default_remarks: '仓管人员出库理货&入库盘点', sort_order: 21 },
  { section_code: '2', section_name: '物流运输费用', subsection_code: '2.01', subsection_name: '物料运输', description: '空瓶回收', default_unit: '场', default_unit_price: 100, default_remarks: '宴会现场管理及回收', sort_order: 22 },
  { section_code: '3', section_name: '人员费用', subsection_code: '3.01', subsection_name: '执行人员', description: '督导', default_unit: '人次', default_unit_price: 800, default_remarks: '', sort_order: 30 },
  { section_code: '3', section_name: '人员费用', subsection_code: '3.01', subsection_name: '执行人员', description: '兼职', default_unit: '人次', default_unit_price: 600, default_remarks: '', sort_order: 31 },
  { section_code: '3', section_name: '人员费用', subsection_code: '3.01', subsection_name: '执行人员', description: '礼仪', default_unit: '人次', default_unit_price: 800, default_remarks: '', sort_order: 32 },
  { section_code: '3', section_name: '人员费用', subsection_code: '3.01', subsection_name: '执行人员', description: '清洗/熨烫', default_unit: '份', default_unit_price: 80, default_remarks: '桌布，礼仪服装', sort_order: 33 },
  { section_code: '3', section_name: '人员费用', subsection_code: '3.02', subsection_name: '人员差旅', description: '（高铁往返）', default_unit: '人', default_unit_price: 200, default_remarks: '按实结算，计费方式参照Logistics & Travel', sort_order: 34 },
  { section_code: '3', section_name: '人员费用', subsection_code: '3.02', subsection_name: '人员差旅', description: '住宿', default_unit: '人', default_unit_price: 350, default_remarks: '', sort_order: 35 },
  { section_code: '3', section_name: '人员费用', subsection_code: '3.02', subsection_name: '人员差旅', description: '餐补', default_unit: '人', default_unit_price: 100, default_remarks: '', sort_order: 36 },
  { section_code: '3', section_name: '人员费用', subsection_code: '3.03', subsection_name: '摄影摄像团队', description: '摄影师', default_unit: '人次', default_unit_price: 2500, default_remarks: '', sort_order: 37 },
  { section_code: '3', section_name: '人员费用', subsection_code: '3.03', subsection_name: '摄影摄像团队', description: '直播云相册', default_unit: '人次', default_unit_price: 1500, default_remarks: '', sort_order: 38 },
];

async function seedEventTemplate(db) {
  const [cnt] = await db.query(
    "SELECT COUNT(*) AS c FROM quotation_template_sections WHERE applicable_type = 'EVENT'"
  );
  if (Number(cnt[0].c) > 0) return;
  for (const row of EVENT_TEMPLATE_ROWS) {
    await db.query(
      `INSERT INTO quotation_template_sections (
        applicable_type, section_code, section_name, subsection_code, subsection_name,
        description, default_unit, default_unit_price, default_remarks, sort_order, is_active
      ) VALUES ('EVENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        row.section_code,
        row.section_name,
        row.subsection_code,
        row.subsection_name,
        row.description,
        row.default_unit,
        row.default_unit_price,
        row.default_remarks || null,
        row.sort_order,
      ]
    );
  }
}

/** 将种子数据中的默认单价写回模版表（修复曾被清零的 default_unit_price） */
async function syncEventTemplateDefaultPrices(db) {
  for (const row of EVENT_TEMPLATE_ROWS) {
    await db.query(
      `UPDATE quotation_template_sections SET
        section_code = ?, section_name = ?, subsection_name = ?,
        default_unit = ?, default_unit_price = ?, default_remarks = ?, sort_order = ?
      WHERE applicable_type = 'EVENT' AND subsection_code = ? AND description = ?`,
      [
        row.section_code,
        row.section_name,
        row.subsection_name,
        row.default_unit,
        row.default_unit_price,
        row.default_remarks || null,
        row.sort_order,
        row.subsection_code,
        row.description,
      ]
    );
  }
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

  try {
    await db.query(
      `ALTER TABLE quotations MODIFY COLUMN project_code VARCHAR(500) NULL COMMENT '关联场次项目编号（冗余；多场为摘要）'`
    );
  } catch (_) {
    /* 列宽已满足或权限不足时忽略 */
  }

  await seedEventTemplate(db);
  await syncEventTemplateDefaultPrices(db);
}

module.exports = { ensureQuotationTables, EVENT_TEMPLATE_ROWS, syncEventTemplateDefaultPrices };
