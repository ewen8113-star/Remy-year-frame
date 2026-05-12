# 工作交接（HANDOFF）

> **用法**：每天收工前更新本文件；第二天新开 Cursor 对话时，用 `@HANDOFF.md` 引用并说「按 HANDOFF 继续」。  
> 旧记录可剪切到文末「历史归档」或单独存档，保持上方始终是最新一次交接。

---

## 日期

- **交接日**：2026-05-12（周二）
- **下一工作日**：2026-05-13（周三，优先回归测试物料分析仪表盘在多张报销单 + 多 brand 桶下的金额/数量准确性，并确认导出功能是否需要纳入下一迭代）。

---

## 当天完成

- **2026-05-12 版本留痕（工作日志）**
  - **板块改名：物料采购 → 额外成本**
    - 侧边栏 / 顶部页面标题 / 顶部合计卡 / 列表标题 全部改名：
      - 侧边栏 "物料采购" → "额外成本"（`index.html`）
      - 顶部 page title 映射 `material: '额外成本'`（`navigate` 函数 title map）
      - 顶部合计卡 "物料采购合计（当前年框）" → "额外成本合计（当前年框）"
      - 列表标题 "采购记录" → "成本记录"
    - 新增页面顶部 banner 说明文字："额外成本：不计入具体场次的成本统计（物料采购 / 物流 / 道具维修 / 统筹支出等，按"成本归属 ≠ 活动成本"的报销与直接登记汇总）"
    - "新建物料采购" / 物料采购详情弹窗 / 报销 cost_module 下拉项的"物料采购"标签保持不变（这是数据登记/分类语义，不影响业务理解）。
  - **数据范围扩展**
    - 旧逻辑：仪表盘 + 5 桶卡仅取报销单 `cost_module='material_purchase'` 且 `block='purchase'` 的明细。
    - 新逻辑：取 `cost_module && cost_module ≠ 'activity'` 的所有报销单（含 material_purchase / logistics / prop_repair / general 等）的**全部 block 明细行**（不再限定 purchase）。原本被遗漏的"画面制作 · 印刷/快印"、"物流 · 快递/闪送"、"差旅"等支出现在都被统计。
    - 仪表盘明细行的 `category` key 改为 `block:category` 组合，避免跨 block 同名子类冲突；`categoryLabel` 改为 "区块 · 子类" 拼接（如 "画面制作 · 印刷/快印"）。
    - 类别下拉按 `REIMB_DETAIL_BLOCKS` 中的顺序排序（人员 / 差旅 / 舞美 / 画面 / 采购 / 物流 / 垫付），再按子类标签的中文 collation 排序。
    - 侧边栏 "物料采购" badge 计数同步扩展：`material_purchases` 表 + 报销单 `cost_module ≠ 'activity'` 的全部条数。
    - 仪表盘 / 列表派生函数 `materialPurchaseDetailRowsFromReimbursements` 与 `materialPurchaseRowsFromReimbursements` 都同步放宽过滤；后者派生的"采购明细 items"按 "区块 · 子类" 标签合成显示名。
    - 关键字检索从仅匹配 `description` 扩展到 `description | categoryLabel | blockLabel`，让 "印刷" 等关键字能直接命中"画面制作 · 印刷/快印"类别下的明细（虽然 description 字段写的是"打印费"）。
  - **仪表盘命名与小字调整**
    - 卡标题 "物料分析（报销明细）" → "成本分析"。
    - 财年小字 "2026-04 ~ 2027-03" → "26财年"（用 `${startYear.slice(-2)}财年`，鼠标 hover 通过 `title` 属性显示完整跨度 "2026-04 ~ 2027-03"）。
    - 仪表盘子表 "物料 Top N" 改名 "成本明细 Top N"；表头 "物料名称" → "项目名称"；命中明细表头同步调整。
    - 搜索框 placeholder 改为 "按物料/项目名称检索，如：腰果、印刷、快递..."。
  - **样式补强**
    - 新增 `.mp-hits-scroll / .mp-hits-table` 样式，命中明细表强制 `white-space:nowrap` + 横向滚动，避免窄屏下"画面制作·印刷/快印"被挤成竖排单字。
    - 项目名称列 `max-width: 220px + ellipsis + 鼠标 hover 显示完整文案`。
  - **物料采购品牌归桶（方案 B：明细行级）**
    - 新增 `detectBrandBucket()` —— 使用 `includes` 优先级匹配（PHD > X.O > CLUB > RC > 其他），解决「N220630-RC PHD」被旧前缀匹配错判为 RC 的问题；项目编码型字符串（`N230530-RM Club`、`Remy-RC` 等）也能正确识别。
    - `materialPurchaseBrandBucket()` 保留为旧名兼容包装，内部转发到 `detectBrandBucket`。
    - 新增 `materialPurchaseAggFiveBuckets()` —— 接受"明细行级"或"整条级"统一输入（`subtotal` 或 `total_amount`），输出 5 桶（PHD / X.O / CLUB / RC / 其他）；旧 `materialPurchaseAggFourBuckets()` 改为转发到 5 桶版本。
    - 顶部 5 桶卡数据源：`material_purchases` 表（直接登记，按整条 `brand_code/brand_name/brand` 归桶）+ `reimbursement` 表 `cost_module='material_purchase'` 的 `block='purchase'` 明细行（按 `row.brand` 归桶）。两者合并后落入对应桶。
    - 5 桶卡顺序调整为 PHD / X.O / CLUB / RC / 其他；颜色映射（accent / warning / blue / success / gray）。
  - **物料分析仪表盘（嵌入物料采购主页）**
    - 新增 `currentFiscalYearRange(now)` —— 当年 4 月 1 日 ~ 次年 3 月 31 日；提供 `inRange(dateStr)` 与 `monthsList()`（生成 12 个月连续标签）。
    - 新增 `materialPurchaseDetailRowsFromReimbursements(rows, { fiscalYear })` —— 扁平化报销明细行，只保留 `cost_module='material_purchase'` + `block='purchase'` 且小计 > 0 的行；按财年过滤；输出含 `brandBucket / category / categoryLabel / description / quantity / unitPrice / subtotal / month / reimbId / reimbDate` 的统计单元。
    - 新增 `aggregateMaterialDashboardData(detailRows, keyword)` —— 聚合概览（金额、笔数、数量、占比、张数）+ 月度 Map + 5 桶分布 + 类别分布 + Top 单品（按 description 聚合，金额降序）+ 命中明细。
    - UI：`materialDashboardSectionHtml()` + `materialDashboardMount()` + `materialDashboardRender()`；可折叠卡片 `📊 物料分析（报销明细）`，标题栏显示财年（如 `2026-04 ~ 2027-03`）+ 明细数 + 合计金额。
    - 筛选条：关键字搜索（防抖 220ms，input 焦点保持）+ 全部品牌桶下拉 + 全部类别下拉（动态从财年明细生成）+ Top N（5/10/20/50）。
    - 图表：Chart.js 月度走势柱图（12 月连续）+ 品牌占比 doughnut；销毁旧实例避免内存泄漏；按 `--text-secondary` CSS 变量自适应亮/暗主题。
    - 表格：品牌明细（5 桶 金额/明细数）+ 类别分布 + 物料 Top N + 关键字命中明细（前 50 条，可点击跳转到对应报销详情）。
    - `materialDashboardState`：`open / keyword / brand / category / detailRowsFY / fy / topLimit`，独立状态不污染 `materialPageState`。
    - 数据范围严格只取报销单录入数据（与活动成本数据分离，后者另做活动成本分析）；当前财年（26.04-27.03）外的数据不进仪表盘。
    - 导出功能本期未实现（按用户要求）。
  - **辅助工具**
    - 新增 `fmtNumber()` —— 数量格式化（整数无小数；含小数最多保留 2 位）。
    - `style.css` 末尾追加 `.mp-dash-card / .mp-dash-header / .mp-dash-chart` 样式与 ≤1024px 单列响应式。
- **2026-05-11 版本留痕（工作日志）**
  - **付款申请（报销登记）整体重构**
    - 行操作区从「编辑/删除」改为整行点击 → 详情弹窗（PDF 预览 / 编辑 / 删除）；PDF 预览模态 z-index 抬至 230 以覆盖详情。
    - 「报销登记」由弹窗改为列表下方内联展开，标题「报销登记 / 编辑报销登记 · #ID」；顶部工具栏改 Ghost 风格 Lucide 图标；上半部分压缩为密集 6 列 grid。
    - 「品牌」字段从 hero 移除，并入项目编号下拉（含 `N230530-RM Club / N220630-RC PHD / N230901-RM XO / 内部 / Remy-RC / 其他`），明细表格新增「品牌」列；勾选「同步项目成本」时自动隐藏品牌列、强制要求项目编号（红星 + 输入框高亮 + 校验失败抖动）。
    - 成本归属「非活动成本」改名「统筹成本（不同步场次）」；成本计入「项目成本」改名「活动成本」；项目编号下方提示文案移除。
    - 报销 PDF：无项目编号时按品牌映射对应年框编号；样式压缩，禁止换行。
  - **物品出库重构**
    - 表单：行 1 出库日期 / 活动日期 / 收件城市，行 2 联系人 / 联系电话 / 收件地址（grow）/ 智能填写；按 UI/UX `field-grouping` 分组。
    - 「智能填写」重写为剪贴板启发式解析：电话→姓名/公司→地址，识别顺序无关，自动判定城市。
    - 列表：新增搜索框（关键词检索，多关键字 AND，覆盖物品摘要/项目编号/用途/物流单号等）；缓存全量列表客户端过滤；删除单据时联动清理对应物流成本，新增「清理出库残留」管理员工具按钮（`POST /api/inventory/cleanup-orphan-logistics`）。
    - PDF 文件名规则：无项目编号 → `活动日期 + 收件城市 + 出库单（仓库名称）.pdf`；有项目编号 → `项目内容 + 出库单（仓库名称）.pdf`（项目内容 = 项目编号后空格之后的活动描述）。
    - 后端 `inv_outbound_orders` 表新增 `activity_date DATE` 字段（幂等迁移），并在列表 / 详情用 `COALESCE` 回退至活动表的 `activity_date`。
  - **仓库管理（库存）**
    - 新增「新建仓库」（admin only）按钮 + 卡片右上角铅笔编辑图标（鼠标 hover 修复，Lucide 替换后 SVG 与 i 双选择器）。
    - `inv_warehouses` 表幂等新增 `city VARCHAR(64)` 与 `remarks VARCHAR(500)` 字段；接口 `GET/POST/PUT /api/inventory/warehouses` 扩展。
    - 仓库标签统一用 `invWarehouseFullLabel`（前端）/ `formatWarehouseLabel`（后端），解决「南区仓库」在物流/PDF 显示为「X.O 南区」的口径不一致。
  - **物流编辑**：取消「费用」必填项，仅校验非负。
  - **侧边栏调整**：将「仓库管理」分组上移、「成本管理」分组下移；「系统」分组下新增「字典管理」入口（admin only）。
  - **字典管理（新模块）**
    - 后端：新表 `dict_entries`（单表 + JSON content + 类别索引），路由 `src/routes/dict.js`（GET 列表 / 类别统计 / 单条详情；POST/PUT/DELETE；`POST /:id/touch` 使用计数+1）；`src/dict/ensureDictTables.js` 幂等建表与补列。
    - 前端：左侧导航 = 通讯录（收件人 / 发件方 / 供应商 / 收款人 / 报销人员）+ 表单选项（年框编号 / 活动类型 / 时段 / 区域 / 归属 / 执行人员 / 状态），后者复用现有 `/api/lookups`；动态 schema 编辑弹窗按类别生成字段；置顶、停用、彻底删除、调用次数排序；样式 ~450 行（`.dict-*`），亮/暗主题与小屏单列适配。
  - **物料采购页改造（badge + 详情同步）**
    - 修复侧边栏「物料采购」badge 与列表不同步：合并 `material_purchases` 直接登记 + reimbursement 中 `cost_module='material_purchase'` 派生记录的计数。
    - 列表「操作」列移除（含「编辑报销 / 编辑 / 删除」），整行点击进详情；报销派生行 → `reimbursementOpenDetailModal`，直接登记 → 新建 `materialPurchaseOpenDetailModal` 复用同一 modal 容器，footer 按上下文派发（PDF 预览仅付款申请显示）。
    - 详情明细表脱离全局 `.reimb-detail-table { min-width: 1520px }` 的样式冲突：换专属类 `.reimb-ro-table` + 横向滚动 wrap `.reimb-ro-scroll`，单元格 `white-space: nowrap`，长字段（描述/备注）`max-width: 280px` 自动省略 + tooltip。
  - **影响文件**
    - 前端：`public/index.html`（侧边栏顺序 / 字典入口 / 物流弹窗费用必填移除）、`public/app.js`（约 +900 行：字典管理模块、物料采购详情、详情样式类替换、badge 同步、出库表单/搜索/智能填写、仓库 modal、报销内联表单等）、`public/style.css`（约 +500 行：字典样式 + 只读详情表 + 出库表单 grid + 搜索框 webkit decoration 重置 + 仓库卡片铅笔图标）。
    - 后端：`src/server.js`（注册 `/api/dict`）、`src/routes/dict.js`（新增）、`src/dict/ensureDictTables.js`（新增）、`src/routes/inventory.js`（`activity_date`、`extractProjectContent`、PDF 命名、`cleanup-orphan-logistics`、`formatWarehouseLabel`、仓库 city/remarks）、`src/inventory/ensureInventoryTables.js`（出库 `activity_date` 列 + 仓库补列）、`src/routes/reimbursement.js`（数据回读 / 品牌-年框映射相关）。
- **2026-04-25 版本留痕（工作日志）**
  - **新建/编辑出库弹窗字段错位修复**：重构出库弹窗首行布局并统一输入控件高度，修复项目编号长内容下的错位与挤压问题。
  - **项目编号下拉交互修复**：将原生 `datalist` 改为自定义下拉建议，统一箭头样式；补充失焦收起逻辑，修复“点击别处后下拉不消失”的问题。
  - **成本管理待填写为空的容错**：在活动成本页增加月份筛选兜底，若缓存筛选值已失效自动回退到“全部”，避免出现“有活动但待填写为 0”的误判。
- **2026-04-22 版本留痕（工作日志）**
  - **活动品牌大使保存链路加固**：前端 `saveActivity` 增加字段读取与 `trim`；后端 `POST/PUT /activities` 对 `brand_ambassador` 统一标准化（空串转 `null`），降低保存丢失风险。
  - **保存后回读校验**：活动保存后立即 `GET /activities/:id` 回读，并在 toast 显示「品牌大使：XXX/未填写」，便于当场确认。
  - **仓库物料详情浮窗图片展示修复**：物料详情主图与缩略图由 `object-fit: cover` 调整为 `contain`，确保图片完整显示、不再裁切。
  - **系统版本更新**：前端显示版本、`public/version.json` 与静态资源缓存参数同步升级到 `ver.2026.04.22.1`。
- **库存/归还/空瓶回收本轮优化（2026-04-20）**
  - **侧边栏拆分模块**：将「空瓶回收」从「库存数据」页底部拆出，作为「仓库管理」下独立菜单页面；保留四仓切换与列表/卡片视图。
  - **归还口径调整**：归还登记中仅 `空瓶回收` 计入空瓶库存；`归还/丢失/损坏/留给客户` 均作为去向登记，不再回加原物料库存。
  - **归还弹窗可用性**：`modalInvReturn` 宽度提升至 `1000px`，表格区支持横向滚动，避免字段被遮挡导致不可点。
  - **出库详情可追溯**：在「物品出库 -> 出库单详情」中新增
    - 物品使用情况（出库/归还/空瓶回收/留给客户/丢失/损坏）
    - 归还登记记录（日期、登记人、汇总、备注）
    以支持后续核对「留给客户」与备注信息。
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
  - **物料图片存储**：物理目录为项目根下 `**public/uploads/inventory/`**（`src/routes/inventory.js` 中 `uploadDir`）；上传接口返回的 URL 为 `**/uploads/inventory/<文件名>`**；数据库 `**inv_items.image_urls**`（JSON 数组）保存上述路径字符串。`.gitignore` 已忽略 `public/uploads/`，**备份与迁移服务器时请单独保留该目录**，勿当缓存随意清空。
- **双轨归集 · 列表补全（2026-04-19）**：物流、仓储成本、物料采购、道具维修列表增加 **关联项目**、**计入说明** 列；物料/维修/仓储接口 `JOIN activities` 返回 `activity_project_code`（物流沿用行内 `related_project_code` 与 `allocation_note`）。

---

## 当天未完成 / 进行中

- **入库单台账（2026-04-21）**
  - 已落地：`GET /inventory/inbound-receipts`、`GET /inventory/inbound-receipts/:batchId`；数据来自 `inv_return_batches` / `inv_return_lines`。
  - 「物品入库」页上方为台账列表（对用户展示项目编号/场次或非活动用途），详情中保留关联出库单号供核对。
  - 若后续需要采购/调拨入库，再评估独立 `inv_inbound_`* 表。
- **各模块录入/编辑**：新建/编辑弹窗侧此前已支持归集字段；若还需在列表加筛选/导出字段，可再开需求。
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

1. 调整出库单格式（打印/展示版式、字段顺序与视觉统一），并补一次全链路验收。
2. 各模块做一次 **「公共池 vs 已归集」** 与活动成本数字的交叉验收（列表与 `/cost/stats`）。
3. 场次报价明细 + 区域版 Excel 报价模板导出。
4. 「修改密码（本人）」与「管理员重置密码」。

---

## 给 AI 的一句话上下文（可选）

> 成本双轨后端与活动成本页已对齐；物资库存为 `/api/inventory`；物流/仓储/物料采购/道具维修列表已显示关联项目与计入说明；待报价导出、密码与生产验收。

---

## 历史归档（可选）

2026-04-16 交接摘要（报销/酒品/看板/活动成本等）

- 报销模块升级：品牌字段、关联活动联想、发票与列表优化、「计入活动成本」文案。
- 数据看板仅报价；成本集中到活动成本页；看板日期区间与双日历交互。
- 新建场次、活动详情用酒明细；酒品管理增强与归还流程；登录与权限中间件修复；日期减一天修复。
- 未完成：报价 Excel 导出、密码管理、生产部署。