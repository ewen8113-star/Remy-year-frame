# UI 设计资产目录

这个目录用于沉淀 Pixso 设计资产，并指导 `remy-year-frame` 的前端界面持续优化。

## 文件说明

- `pixso-inventory.md`：Pixso 文件盘点（组件、样式、页面分布、可用性）
- `pixso-style-tokens.json`：可直接用于前端实现的设计 Token 初稿（来源于 Pixso 样式统计）
- `system-ui-optimization-roadmap.md`：结合当前系统代码结构的 UI 改造分期方案

## 当前数据快照（2026-04-23）

- 组件总数：`996`
- 本地组件（local）：`996`
- 远程组件（remote）：`0`
- 本地样式（local）：`149`
- 远程样式（remote）：`0`
- 变量集（variable sets）：当前返回为空

## 使用方式

1. 先阅读 `pixso-inventory.md`，了解可复用的设计资产。
2. 在前端样式改造时，优先以 `pixso-style-tokens.json` 作为统一源。
3. 按 `system-ui-optimization-roadmap.md` 的阶段推进，避免一次性大改导致业务风险。