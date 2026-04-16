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

-- 插入初始年框数据
INSERT INTO year_frames (year, name) VALUES
('25年度', '人头马25-26年度项目'),
('26年度', '人头马26-27年度项目');
