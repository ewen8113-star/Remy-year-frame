# 人头马年框项目管理系统 - API 服务

## 项目结构

```
Remy Project/
├── src/
│   ├── server.js              # 服务器入口
│   ├── config/
│   │   └── database.js        # 数据库连接配置
│   └── routes/
│       ├── yearFrame.js      # 年框管理
│       ├── activity.js        # 活动场次
│       ├── warehouse.js       # 仓储记录
│       ├── logistics.js       # 物流记录
│       ├── reimbursement.js   # 报销记录
│       ├── dashboard.js       # 数据看板
│       └── backup.js          # 备份管理
├── backups/                   # 备份文件目录
├── .env                       # 环境变量配置
├── .env.example               # 环境变量模板
└── package.json
```

## API 接口

### 年框管理
- `GET /api/year-frames` - 获取所有年框
- `GET /api/year-frames/:id` - 获取年框详情
- `PUT /api/year-frames/:id` - 更新年框

### 活动场次
- `GET /api/activities` - 获取活动列表（支持筛选）
- `GET /api/activities/:id` - 获取活动详情
- `POST /api/activities` - 创建活动
- `PUT /api/activities/:id` - 更新活动
- `DELETE /api/activities/:id` - 删除活动
- `POST /api/activities/batch-update-status` - 批量更新状态

### 仓储管理
- `GET /api/warehouse` - 获取仓储列表
- `GET /api/warehouse/summary` - 按月统计
- `POST /api/warehouse` - 创建记录
- `POST /api/warehouse/batch-update-cost` - 批量更新成本
- `PUT /api/warehouse/:id` - 更新记录
- `DELETE /api/warehouse/:id` - 删除记录

### 物流管理
- `GET /api/logistics` - 获取物流列表
- `GET /api/logistics/summary` - 按公司统计
- `POST /api/logistics` - 创建记录
- `POST /api/logistics/batch-update-fee` - 批量更新费用
- `PUT /api/logistics/:id` - 更新记录
- `DELETE /api/logistics/:id` - 删除记录

### 报销管理
- `GET /api/reimbursements` - 获取报销列表
- `POST /api/reimbursements` - 创建记录
- `PUT /api/reimbursements/:id` - 更新记录
- `DELETE /api/reimbursements/:id` - 删除记录

### 数据看板
- `GET /api/dashboard` - 获取统计数据
- `GET /api/dashboard/by-city` - 按城市统计

### 备份管理
- `GET /api/backup` - 获取备份记录
- `POST /api/backup/export` - 导出数据备份
- `POST /api/backup/import` - 导入数据
- `GET /api/backup/download/:filename` - 下载备份文件

## 启动步骤

### 1. 配置数据库密码

编辑 `.env` 文件，填写你的 MySQL 密码：

```env
DB_PASSWORD=你的MySQL密码
```

### 2. 安装依赖

```bash
cd "Remy Project"
npm install
```

### 3. 启动服务

```bash
npm start
# 或开发模式（自动重启）
npm run dev
```

服务运行在 http://localhost:3088

## 前端连接

前端需要修改 API 地址，从 IndexedDB 改为调用后端 API：

```
http://localhost:3088/api/activities?yearFrameId=1
```

## 数据库

已在 MySQL 创建：
- 数据库名：`remy_year_frame`
- 初始数据：25年度、26年度两个年框
