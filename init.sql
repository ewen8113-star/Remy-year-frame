-- ===============================================
-- 人头马年框项目管理系统 - MySQL 数据库初始化脚本
-- ===============================================

-- 1. 年框项目表
CREATE TABLE IF NOT EXISTS year_frames (
    id INT PRIMARY KEY AUTO_INCREMENT,
    year VARCHAR(10) NOT NULL UNIQUE,
    name VARCHAR(100),
    total_budget DECIMAL(15,2),
    total_revenue DECIMAL(15,2),
    total_cost DECIMAL(15,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. 活动场次表
CREATE TABLE IF NOT EXISTS activities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    year_frame_id INT NOT NULL,
    year_frame_code VARCHAR(50),
    project_code VARCHAR(100),
    activity_type ENUM('晚宴','品鉴','培训','婚宴','宴会','纯设计') NOT NULL,
    city VARCHAR(50),
    brand VARCHAR(30),
    client_name VARCHAR(100),
    venue VARCHAR(200),
    activity_date DATE,
    guest_count INT,
    quoted_price DECIMAL(12,2),
    total_cost DECIMAL(12,2) DEFAULT 0,
    no_cost TINYINT(1) NOT NULL DEFAULT 0,
    executor VARCHAR(100),
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    remarks TEXT,
    wine_details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (year_frame_id) REFERENCES year_frames(id)
);

-- 3. 仓储记录表
CREATE TABLE IF NOT EXISTS warehouse (
    id INT PRIMARY KEY AUTO_INCREMENT,
    year_frame_id INT NOT NULL,
    activity_id INT NULL COMMENT '关联活动ID',
    merged_into_activity TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已计入活动成本',
    allocation_note VARCHAR(255) NULL COMMENT '计入说明',
    month VARCHAR(20),
    region VARCHAR(32),
    brand VARCHAR(20) NOT NULL DEFAULT 'PHD',
    wine_name VARCHAR(100),
    specifications VARCHAR(50),
    quantity INT,
    unit_price DECIMAL(10,2),
    quoted_price DECIMAL(12,2),
    actual_cost DECIMAL(12,2) DEFAULT 0,
    no_actual_cost TINYINT(1) NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (year_frame_id) REFERENCES year_frames(id)
);

-- 4. 物流记录表
CREATE TABLE IF NOT EXISTS logistics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    year_frame_id INT NOT NULL,
    activity_id INT NULL COMMENT '关联活动ID',
    merged_into_activity TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已计入活动成本',
    allocation_note VARCHAR(255) NULL COMMENT '计入说明',
    logistics_company VARCHAR(50),
    brand VARCHAR(20) NOT NULL DEFAULT 'PHD',
    express_company VARCHAR(50),
    tracking_number VARCHAR(100),
    settlement_month VARCHAR(16),
    special_car TINYINT(1) NOT NULL DEFAULT 0,
    monthly_settlement TINYINT(1) NOT NULL DEFAULT 0,
    origin_city VARCHAR(50),
    destination_city VARCHAR(50),
    shipping_date DATE,
    fee DECIMAL(10,2) DEFAULT 0,
    related_project_code VARCHAR(100),
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (year_frame_id) REFERENCES year_frames(id)
);

-- 5. 报销记录表（含 legacy 分项字段 + V2：场次、费用明细 JSON、计入标记、发票）
CREATE TABLE IF NOT EXISTS reimbursements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    year_frame_id INT NOT NULL,
    activity_id INT NULL COMMENT '关联活动ID',
    reimbursement_type VARCHAR(50),
    city VARCHAR(50),
    amount DECIMAL(10,2),
    date DATE,
    related_project_code VARCHAR(100),
    props DECIMAL(10,2),
    printing DECIMAL(10,2),
    express DECIMAL(10,2),
    other DECIMAL(10,2),
    cost_details LONGTEXT NULL COMMENT '与场次成本同结构的JSON',
    merged_into_activity TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已计入活动成本（场次）',
    has_invoice TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否有发票',
    invoices LONGTEXT NULL COMMENT '发票JSON数组',
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (year_frame_id) REFERENCES year_frames(id)
);

-- 6. 备份记录表
CREATE TABLE IF NOT EXISTS backup_records (
    id INT PRIMARY KEY AUTO_INCREMENT,
    year_frame_id INT NOT NULL,
    backup_type ENUM('auto','manual') DEFAULT 'manual',
    backup_file VARCHAR(255),
    record_count INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (year_frame_id) REFERENCES year_frames(id)
);

-- 7. 用户表（登录/权限）
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin','operator') NOT NULL DEFAULT 'operator',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    last_login_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 8. 道具维修表
CREATE TABLE IF NOT EXISTS prop_repairs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    year_frame_id INT NOT NULL,
    activity_id INT NULL COMMENT '关联活动ID',
    merged_into_activity TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已计入活动成本',
    allocation_note VARCHAR(255) NULL COMMENT '计入说明',
    brand_id INT NOT NULL,
    repair_date DATE NOT NULL,
    region VARCHAR(32) NOT NULL,
    items JSON NOT NULL,
    quoted_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    no_cost TINYINT(1) NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (year_frame_id) REFERENCES year_frames(id),
    FOREIGN KEY (brand_id) REFERENCES brand_inventory(id)
);

-- 9. 物料采购表
CREATE TABLE IF NOT EXISTS material_purchases (
    id INT PRIMARY KEY AUTO_INCREMENT,
    year_frame_id INT NOT NULL COMMENT '所属年框',
    activity_id INT NULL COMMENT '关联活动ID',
    merged_into_activity TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已计入活动成本',
    allocation_note VARCHAR(255) NULL COMMENT '计入说明',
    brand_id INT NOT NULL COMMENT '品牌ID',
    purchase_date DATE NOT NULL COMMENT '采购/报销日期',
    items JSON NOT NULL COMMENT '费用明细 [{name, amount}, ...]',
    total_amount DECIMAL(10,2) NOT NULL COMMENT '合计金额',
    remarks TEXT NULL COMMENT '备注',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_mp_year_frame FOREIGN KEY (year_frame_id) REFERENCES year_frames(id),
    CONSTRAINT fk_mp_brand FOREIGN KEY (brand_id) REFERENCES brand_inventory(id)
);

-- 10. 物资库存（库管）：物理仓 / 物料 / 出库 / 归还（全财年共用，不按 year_frame 隔离）
CREATE TABLE IF NOT EXISTS inv_warehouses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    brand_id INT NOT NULL,
    region VARCHAR(32) NOT NULL,
    label VARCHAR(128) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_inv_wh_global (brand_id, region),
    CONSTRAINT fk_inv_wh_brand FOREIGN KEY (brand_id) REFERENCES brand_inventory(id)
);

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
);

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
);

CREATE TABLE IF NOT EXISTS inv_outbound_lines (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    item_id INT NOT NULL,
    quantity INT NOT NULL,
    line_note VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_inv_ol_order FOREIGN KEY (order_id) REFERENCES inv_outbound_orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_inv_ol_item FOREIGN KEY (item_id) REFERENCES inv_items(id)
);

CREATE TABLE IF NOT EXISTS inv_return_batches (
    id INT PRIMARY KEY AUTO_INCREMENT,
    outbound_order_id INT NOT NULL,
    return_date DATE NOT NULL,
    operator VARCHAR(100),
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_inv_rb_ob FOREIGN KEY (outbound_order_id) REFERENCES inv_outbound_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inv_return_lines (
    id INT PRIMARY KEY AUTO_INCREMENT,
    batch_id INT NOT NULL,
    outbound_line_id INT NOT NULL,
    qty_return INT NOT NULL DEFAULT 0,
    qty_lost INT NOT NULL DEFAULT 0,
    qty_damaged INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_inv_rl_batch FOREIGN KEY (batch_id) REFERENCES inv_return_batches(id) ON DELETE CASCADE,
    CONSTRAINT fk_inv_rl_ol FOREIGN KEY (outbound_line_id) REFERENCES inv_outbound_lines(id) ON DELETE CASCADE
);

-- 插入初始年框数据
INSERT INTO year_frames (year, name) VALUES
('25年度', '人头马25-26年度项目'),
('26年度', '人头马26-27年度项目');
