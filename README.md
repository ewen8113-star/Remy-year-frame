# 人头马年框项目管理系统 - API 服务

## 项目结构

```
remy-year-frame/
├── public/                    # 管理后台静态页（由 Express 托管，默认走同源 /api）
│   ├── index.html
│   ├── app.js
│   └── style.css
├── src/
│   ├── server.js              # 服务器入口
│   ├── config/
│   │   └── database.js        # 数据库连接配置
│   └── routes/
│       ├── yearFrame.js       # 年框管理
│       ├── activity.js        # 活动场次
│       ├── warehouse.js       # 仓储记录
│       ├── logistics.js       # 物流记录
│       ├── reimbursement.js   # 报销记录
│       ├── dashboard.js       # 数据看板
│       ├── backup.js          # 备份管理
│       ├── calendar.js        # 排期日历
│       ├── cost.js            # 成本管理聚合
│       ├── wine.js            # 客户用酒
│       └── brand.js           # 品牌字典
├── migrations/                # SQL 迁移片段（按需执行）
├── backups/                   # 备份文件目录
├── init.sql                   # 初始化 schema 参考
├── .env                       # 环境变量配置（本地创建）
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

### 排期日历

- `GET /api/calendar?year=2026&month=4&yearFrameId=` - 指定年月的活动列表（`yearFrameId` 可选）
- `GET /api/calendar/activity/:id` - 单个活动详情

### 成本管理

- `GET /api/cost/stats` - 成本统计
- `GET /api/cost/activities` - 活动成本相关列表
- `GET /api/cost/warehouse` - 仓储成本视图
- `GET /api/cost/logistics` - 物流成本视图

### 客户用酒

- `GET /api/wine` - 酒款目录
- `GET /api/wine/stock-in` - 入库记录
- `GET /api/wine/usage` - 领用记录
- `POST /api/wine/stock-in` - 新建入库
- `POST /api/wine/stock-in/batch` - 批量入库
- `POST /api/wine/usage` - 新建领用
- `PUT /api/wine/usage/:id` - 更新领用
- `DELETE /api/wine/usage/:id` - 删除领用
- `PUT /api/wine/:wine_code` - 更新酒款信息

### 品牌字典

- `GET /api/brand` - 品牌列表
- `GET /api/brand/:id` - 品牌详情
- `POST /api/brand` - 创建品牌
- `PUT /api/brand/:id` - 更新品牌
- `DELETE /api/brand/:id` - 删除品牌

### 健康检查

- `GET /api/health` - 服务与数据库连接状态

### 认证

- `POST /api/auth/register` - 注册（body: `username`, `password`；默认角色 `operator`）
- `POST /api/auth/login` - 登录（body: `username`, `password`）
- `POST /api/auth/logout` - 退出登录
- `GET /api/auth/me` - 当前登录用户
- 说明：除 `/api/auth/*` 与 `/api/health` 外，其余 API 均需登录。
- 权限：`admin` 可读写；`operator` 默认只读（写操作返回 403）。

### 用户管理（仅 admin）

- `GET /api/users` - 获取用户列表
- `PUT /api/users/:id/role` - 修改角色（`admin` / `operator`）
- `PUT /api/users/:id/status` - 启用/停用用户
- 安全约束：
  - 不允许将系统最后一个启用中的 `admin` 降级或停用
  - 不允许当前登录管理员自降级或自停用（避免自锁）

## 启动步骤

### 1. 配置数据库密码

编辑 `.env` 文件，填写你的 MySQL 密码：

```env
DB_PASSWORD=你的MySQL密码
```

### 2. 安装依赖

```bash
cd remy-year-frame
npm install
```

### 3. 初始化登录与管理员

```bash
npm run migrate:users-auth
```

### 4. 启动服务

```bash
npm start
# 或开发模式（自动重启）
npm run dev
```

服务运行在 [http://localhost:3088（端口可由环境变量](http://localhost:3088（端口可由环境变量) `PORT` 修改）。

首次访问会跳转到 `http://localhost:3088/login.html`。未登录用户可访问 `http://localhost:3088/register.html` 自助注册普通账号，由管理员在“系统 > 用户管理”中提权。

## 前端

`public/` 下的页面由 Node 服务托管：浏览器访问根路径即可，前端默认请求同源 `/api`。若用 `file://` 打开 HTML，可在控制台设置 `localStorage.remy_apiBase` 指向完整 API 根地址（如 `http://127.0.0.1:3088/api`），详见 `public/app.js` 顶部说明。

## 数据库

已在 MySQL 创建：

- 数据库名：`remy_year_frame`
- 初始数据：25年度、26年度两个年框

