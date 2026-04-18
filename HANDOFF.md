# 工作交接（HANDOFF）

> **用法**：每天收工前更新本文件；第二天新开 Cursor 对话时，用 `@HANDOFF.md` 引用并说「按 HANDOFF 继续」。  
> 旧记录可剪切到文末「历史归档」或单独存档，保持上方始终是最新一次交接。

---

## 日期

- **交接日**：2026-04-18（周六）
- **下一工作日**：2026-04-19（周日）起继续；未结项见下方「当天未完成」。

---

## 当天完成

- **成本结构「双轨」改造（Phase 1 + Phase 2 后端/统计）**
  - **口径**：总成本 = **已归集活动成本**（`activities.total_cost` 等）+ **公共成本池**（各模块里 `merged_into_activity = 0` 的金额）；已归集记录不再进公共池汇总，避免重复计入。
  - **后端**
    - `src/routes/cost.js`：`/cost/stats` 在仓储、物流、报销未归集基础上，**补全物料采购、道具维修**的公共池合计，并返回 `materialCost` / `propRepairCost` 等字段。
    - `src/routes/logistics.js`：`/summary` 区分 `total_fee` / `pooled_fee` / `merged_fee`；写入支持 `activity_id`、`merged_into_activity`、`allocation_note`。
    - `src/routes/materialPurchase.js`、`src/routes/propRepair.js`：`/summary` 增加 `pooledTotal` / `mergedTotal`；写入支持归集字段。
  - **前端**（`public/app.js` 活动成本页）
    - 总成本卡片与分项卡片文案统一为「公共池 vs 已归集活动」；仓储/物流列表数据按未归集过滤；物料/维修展示 pooled vs merged。
  - **库表与迁移**
    - `init.sql`：补全 `material_purchases` 及归集相关列定义；`npm run migrate:cost-pool-merge` 可对已有库追加列。
    - `src/scripts/addMaterialPurchasesTable.js`、`addPropRepairsTable.js`：建表 DDL 与归集字段对齐。

- **物资库存（库管一期 + 迭代）**
  - **全财年共用**：仓库、物料、出库主数据不按 `year_frame_id` 隔离；`npm run migrate:inventory-global-fiscal` 升级已有库；详情/PDF 通过 `activity_id` 显示场次年度，无关联则文案「25/26 财年共用」。
  - **路由与表**：`src/routes/inventory.js`、`src/inventory/ensureInventoryTables.js`、`init.sql`；运行时自动建表/补列；`src/scripts/migrateInventoryGlobalFiscal.js`。
  - **新建出库 UX**：表单压缩为紧凑栅格；**常用物料**（`inv_items.is_common`）列表勾选 + 数量 + 行备注；**其他物料**单独表格追加；添加物料时可勾选常用；物料卡片可「设为常用/取消常用」。
  - **前端**：`public/app.js` 物资库存页、`public/style.css`（`.inv-outbound-*`、徽标等）、侧边栏与上传路径等与一期一致。

---

## 当天未完成 / 进行中

- **各模块录入/编辑 UI**：物流、物料、维修、仓储在界面上**显式展示**「关联活动 / 是否计入活动成本 / 归集说明」并与后端字段打通（后端已支持部分，前端表单需收尾）。
- **物资库存**：生产/已有库需执行 `migrate:inventory-global-fiscal`（若尚未执行）并重启 Node；验收切换 25/26 年度列表一致、项目匹配先选年度。
- 场次报价明细与按区域 Excel 报价模板导出尚未开始。
- 「修改密码（本人）/管理员重置密码」尚未实现。
- 生产服务器部署（Nginx + HTTPS + PM2）尚未实际上线。

---

## 重要结论与备忘

- 登录失败或新代码未生效时，优先检查端口占用；出现 `EADDRINUSE` 需先结束旧进程再启动。
- **双轨成本**：统计时务必区分「已归集进活动」与「仍在公共池」；`merged_into_activity = 1` 的金额只应体现在活动侧，不再与公共池相加。
- 报销、仓储、物流、物料采购、道具维修归集字段迁移脚本：`npm run migrate:cost-pool-merge`（可重复执行，已存在列会跳过）。
- **物资库存**：已有库若仍带 `year_frame_id` 仓/出库字段，执行 `npm run migrate:inventory-global-fiscal` 后重启；`is_common` 列由首次访问库存接口时 `ensure` 自动补。
- 编辑表单中的日期字段不能继续用 UTC 截断写法，否则会再次出现「日期减一天」的问题。
- 酒品管理当前允许负库存，库存值以流水重算结果为准。
- 品牌选项业务固定为 `RC`、`PHD`、`CLUB`、`X.O`，新增表单或筛选时应保持一致。

---

## 阻塞与依赖

- 无硬阻塞；本地 `npm run start` 可运行。

---

## 涉及文件与提交

- 成本双轨相关：`public/app.js`、`src/routes/cost.js`、`src/routes/logistics.js`、`src/routes/materialPurchase.js`、`src/routes/propRepair.js`、`init.sql`、`src/scripts/addCostPoolMergeColumns.js`、`src/scripts/addMaterialPurchasesTable.js`、`src/scripts/addPropRepairsTable.js`。
- 物资库存相关：`src/routes/inventory.js`、`src/inventory/ensureInventoryTables.js`、`src/server.js`（注册路由与上传）、`src/scripts/migrateInventoryGlobalFiscal.js`、`src/scripts/addInventoryTables.js`、`public/app.js`、`public/index.html`、`public/style.css`、`package.json`。
- **2026-04-18 收工**：已在本地 `git commit` 记录当日进度；个人数据/报价目录未纳入版本库。

---

## 下一步计划

1. 物流 / 物料 / 维修 / 仓储 **表单与列表**补全归集字段与文案，并做一次「归集后总成本不重复」的验收。
2. 场次报价明细 + 区域版 Excel 报价模板导出。
3. 「修改密码（本人）」与「管理员重置密码」。

---

## 给 AI 的一句话上下文（可选）

> 成本双轨后端与活动成本页已对齐；物资库存为独立 `/api/inventory`，全财年共用 + 常用物料出库；明日可继续各模块归集 UI、报价导出、密码与库管验收。

---

## 历史归档（可选）

<details>
<summary>2026-04-16 交接摘要（报销/酒品/看板/活动成本等）</summary>

- 报销模块升级：品牌字段、关联活动联想、发票与列表优化、「计入活动成本」文案。
- 数据看板仅报价；成本集中到活动成本页；看板日期区间与双日历交互。
- 新建场次、活动详情用酒明细；酒品管理增强与归还流程；登录与权限中间件修复；日期减一天修复。
- 未完成：报价 Excel 导出、密码管理、生产部署。

</details>
