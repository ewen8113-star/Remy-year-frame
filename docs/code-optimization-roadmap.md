# 系统代码优化路线

目标：在不影响现有业务数据和日常使用的前提下，分步骤降低维护成本。

## 当前体量

- `public/app.js`：约 1400 行，已从主业务巨型文件收敛为全局入口、共享状态和业务级公共函数
- `public/style.css`：仅保留兼容说明，实际样式已分层拆到 `public/styles/`
- `src/routes/inventory.js`：约 2080 行，已抽出出库/台账 helper、仓库子路由、酒品审计子路由、上传子路由、项目提示子路由、台账子路由、库存格式化、PDF 运行时、图片上传配置、酒类 helper、用酒统计构建、出库 PDF payload、物料辅助函数
- `src/routes/quotation.js`：约 1135 行，已抽出报价路由工具函数和读取 loader
- `src/routes/dashboard.js`：约 425 行，已抽出看板筛选、汇总和成本池 helper
- `src/routes/reimbursement.js`：约 680 行，已抽出报销规范化、序列化和同步场次成本 helper
- `src/routes/paymentOrder.js`：约 208 行，已抽出付款候选、付款来源绑定和回退 helper
- `src/routes/wine.js`：约 60 行，已抽出酒品目录、入库、用酒、归还子路由，以及酒品目录上传和酒品路由基础 helper

## 验证基线

每次优化后至少执行：

```bash
npm run check:js
curl -s http://localhost:3088/api/health
```

如果改了 PM2 或启动配置，再执行：

```bash
npm run service:status
```

## 优化顺序

### 1. 建立检查基线

状态：已完成

- `npm run check:js` 执行全量 JS 语法检查
- `npm run check:js` 同时加载全部后端路由，校验 Express Router 导出
- 后续所有拆分先保证语法和路由模块加载检查通过

### 2. 前端按页面拆分

优先从低耦合页面开始，不先动核心活动记录：

0. `dashboard` 数据看板：已拆到 `public/modules/dashboard-page.js`
1. `activities` 场次记录：已拆到 `public/modules/activities-page.js`
2. `virtual-activities` 虚拟场次：已拆到 `public/modules/virtual-activities-page.js`
3. `material` 统筹成本 / 物料采购：已拆到 `public/modules/material-purchases-page.js`
4. `prop-repair` 道具维修：已拆到 `public/modules/prop-repair-page.js`
5. `warehouse` 仓储成本：已拆到 `public/modules/warehouse-page.js`
6. `users` 用户管理：已拆到 `public/modules/users-page.js`
7. `backup` 数据备份：已拆到 `public/modules/backup-page.js`
8. `reconcile` 临时对账：已拆到 `public/modules/reconcile-page.js`
9. `dict` 字典管理：已拆到 `public/modules/dict-page.js`
10. `calendar` 排期日历：已拆到 `public/modules/calendar-page.js`
11. `logistics` 物流成本：已拆到 `public/modules/logistics-page.js`
12. `cost` 活动成本：已拆到 `public/modules/cost-page.js`
13. `wine-catalog` 酒品目录：已拆到 `public/modules/wine-catalog-page.js`
14. `reimbursement` 付款申请 / 成本登记：已拆到 `public/modules/reimbursement-page.js`
    - 付款单筛选、选择和说明辅助函数已抽到 `public/modules/payment-order-utils.js`
15. `inventory` 库存管理：已拆到 `public/modules/inventory-page.js`
16. `inventory-utils` 库存通用展示工具：已拆到 `public/modules/inventory-utils.js`
    - 收件城市识别与地址前缀规范化已并入该工具模块
    - 出库搜索、月份分组和分页计算已并入该工具模块
17. `inventory-detail-utils` 物品详情与关联场次表格：已拆到 `public/modules/inventory-detail-utils.js`

拆分方式：

- 保留全局 `app.js` 作为兼容入口
- 先把单页面渲染函数和辅助函数抽到 `public/modules/*.js`
- 每次只拆一个页面
- 拆完后用实际页面点开验证

### 3. 前端公共工具抽离

适合抽离的内容：

- API 请求封装（已抽到 `public/modules/api-client.js`）
- 日期 / 财年工具（已抽到 `public/modules/core-utils.js`）
- 金额格式化（已抽到 `public/modules/core-utils.js`）
- Toast 工具（已抽到 `public/modules/ui-feedback.js`）
- Modal 工具（弹窗栈与遮罩已抽到 `public/modules/ui-modal.js`；业务清理由主入口回调）
- HTML / JavaScript 字符串转义（已抽到 `public/modules/core-utils.js`）
- 通用状态 Badge 和颜色格式化（已抽到 `public/modules/ui-formatters.js`）
- 表格空状态（现有结构均含页面语义，出现稳定重复模式后再抽）

要求：

- 只抽无业务状态的纯工具函数
- 不改变函数输出
- 不同时改 UI 和数据逻辑

### 4. CSS 分层

拆分顺序：

1. `base.css`：变量、基础排版、按钮、表单
2. `layout.css`：侧边栏、顶部栏、页面容器
3. `components.css`：卡片、表格、弹窗、toast
4. `pages/*.css`：页面专属样式

当前已拆：

- `public/styles/inventory.css`：库存、出入库、酒品统计等库存相关样式
- `public/styles/reimbursement.css`：付款申请、报销/成本登记、导入预览相关样式
- `public/styles/activity-quotes.css`：活动报价、报价单模板、报价打印预览相关样式
- `public/styles/base.css`：主题变量、基础重置、全局交互基线
- `public/styles/layout.css`：侧边栏、顶部栏、主内容区、页面容器
- `public/styles/components.css`：通用卡片、表格、按钮、筛选栏、弹窗、表单、分页
- `public/styles/harmony-compact.css`：HarmonyOS 紧凑化与最终覆盖层
- `public/styles/auth.css`：登录 / 注册页样式
- `public/styles/dashboard.css`：数据看板页面样式
- `public/styles/calendar.css`：排期日历页面样式
- `public/styles/activities.css`：场次记录基础样式
- `public/styles/virtual-activities.css`：虚拟场次页面样式
- `public/styles/logistics.css`：物流成本页面与物流详情样式
- `public/styles/warehouse.css`：仓储成本页面样式
- `public/styles/dict.css`：字典管理页面样式
- `public/styles/material-cost.css`：额外成本分析与命中明细样式
- `public/styles/reconcile.css`：临时对账页面样式

要求：

- 先拆文件，不改视觉
- 每次拆完对比关键页面：场次记录、付款申请、库存管理、仓储成本

### 5. 后端路由拆分

优先处理超大路由：

1. `src/routes/inventory.js`
   - 已抽 `src/inventory/outboundHelpers.js`
   - 已抽 `src/inventory/warehouseRoutes.js`
   - 已抽 `src/inventory/wineAuditRoutes.js`
   - 已抽 `src/inventory/uploadRoutes.js`
   - 已抽 `src/inventory/hintRoutes.js`
   - 已抽 `src/inventory/ledgerRoutes.js`
   - 已抽 `src/inventory/formatters.js`
   - 已抽 `src/inventory/pdfRuntime.js`
   - 已抽 `src/inventory/imageUpload.js`
   - 已抽 `src/inventory/pdfFilename.js`
   - 已抽 `src/inventory/wineHelpers.js`
   - 已抽 `src/inventory/buildWineUsageStats.js`
   - 已抽 `src/inventory/outboundPdf.js`
   - 已抽 `src/inventory/itemHelpers.js`
   - 已抽 `src/inventory/wineUsageStatsRoutes.js`
   - 已抽 `src/inventory/outboundProject.js`
   - 出库详情加载器已并入 `src/inventory/outboundHelpers.js`
   - 已抽 `src/inventory/outboundPdfRoutes.js`
   - 已抽 `src/inventory/outboundRepairRoutes.js`
   - 已抽 `src/inventory/inboundRoutes.js`
   - 已抽 `src/inventory/inboundReceiptRoutes.js`
   - 已抽 `src/inventory/emptyBottleRoutes.js`
   - 已抽 `src/inventory/itemUsageRoutes.js`
   - 已抽 `src/inventory/itemReadRoutes.js`
   - 已抽 `src/inventory/outboundReadRoutes.js`
   - 已抽 `src/inventory/maintenanceRoutes.js`
   - 已抽 `src/inventory/itemWriteRoutes.js`
   - 已抽 `src/inventory/itemCatalogRoutes.js`
   - 已抽 `src/inventory/outboundReturnRoutes.js`
   - 已抽 `src/inventory/wineCatalogImportRoutes.js`
   - 已抽 `src/inventory/outboundCreateRoutes.js`
   - 已抽 `src/inventory/outboundUpdateRoutes.js`
2. `src/routes/quotation.js`
   - 已抽 `src/quotation/routeUtils.js`
   - 已抽 `src/quotation/routeLoaders.js`
   - 已抽 `src/quotation/exportRoutes.js`
   - 已抽 `src/quotation/readRoutes.js`
   - 已抽 `src/quotation/bundleExportRoutes.js`
   - 已抽 `src/quotation/writeHelpers.js`
   - 已抽 `src/quotation/bundleCreateRoutes.js`
   - 已抽 `src/quotation/detailActionRoutes.js`
   - 已抽 `src/quotation/createRoutes.js`
   - 已抽 `src/quotation/updateRoutes.js`
3. `src/routes/dashboard.js`
   - 已抽 `src/dashboard/routeHelpers.js`
4. `src/routes/reimbursement.js`
   - 已抽 `src/reimbursement/routeHelpers.js`
5. `src/routes/paymentOrder.js`
   - 已抽 `src/paymentOrder/routeHelpers.js`
6. `src/routes/wine.js`
   - 已抽 `src/wine/routeHelpers.js`
   - 已抽 `src/wine/catalogUpload.js`
   - 已抽 `src/wine/catalogRoutes.js`
   - 已抽 `src/wine/stockInRoutes.js`
   - 已抽 `src/wine/usageRoutes.js`
   - 已抽 `src/wine/returnRoutes.js`
7. `src/routes/backup.js`
   - 已抽 `src/backup/storage.js`
   - 已抽 `src/backup/restore.js`
   - 已抽 `src/backup/fullBackupRoutes.js`
   - 已抽 `src/backup/legacyBackupRoutes.js`
8. `src/routes/reimbursement.js`
   - 已抽 `src/reimbursement/importRoutes.js`
   - 已抽 `src/reimbursement/readRoutes.js`
   - 已抽 `src/reimbursement/actionRoutes.js`
   - 已抽 `src/reimbursement/createRoutes.js`
   - 已抽 `src/reimbursement/updateRoutes.js`
9. `src/routes/reconcile.js`
   - 已抽 `src/reconcile/routeHelpers.js`
   - 已抽 `src/reconcile/readRoutes.js`
   - 已抽 `src/reconcile/batchRoutes.js`
   - 已抽 `src/reconcile/lineUpdateRoutes.js`
   - 已抽 `src/reconcile/commitRoutes.js`
10. `src/routes/activity.js`
   - 已抽 `src/activity/routeHelpers.js`
   - 已抽 `src/activity/maintenanceRoutes.js`
   - 已抽 `src/activity/readRoutes.js`
11. `src/routes/cost.js`
   - 已抽 `src/cost/summaryRoutes.js`
   - 已抽 `src/cost/analyticsRoutes.js`
12. `src/routes/logistics.js`
   - 已抽 `src/logistics/routeHelpers.js`
13. `src/routes/dict.js`
   - 已抽 `src/dict/routeHelpers.js`
   - 已抽 `src/dict/categoryRoutes.js`
14. `src/routes/dashboard.js`
   - 已抽 `src/dashboard/optionsRoutes.js`
   - 已抽 `src/dashboard/dataHandler.js`

## 前端大文件拆分

以下原始脚本均已按顶层声明与页面职责拆分，拆分后的 `public/**/*.js` 单文件不超过 300 行：

- `public/app.js`
- `public/activity-quotes.js`
- `public/modules/activities-page.js`
- `public/modules/cost-page.js`
- `public/modules/dashboard-page.js`
- `public/modules/dict-page.js`
- `public/modules/inventory-page.js`
- `public/modules/logistics-page.js`
- `public/modules/material-purchases-page.js`
- `public/modules/prop-repair-page.js`
- `public/modules/reconcile-page.js`
- `public/modules/reimbursement-page.js`
- `public/modules/warehouse-page.js`
- `public/modules/wine-catalog-page.js`

拆分方式：

- 先抽纯查询构造、字段映射、格式化函数
- 再按子资源拆 router
- 不在拆分过程中改 SQL 语义

## 暂不做

- 不把项目直接迁移到 React/Vite
- 不一次性改数据库结构
- 不重做 UI 设计系统
- 不引入 TypeScript
- 不引入大型新依赖
