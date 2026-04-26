# 系统 UI 优化路线图

目标：基于 Pixso 组件库与样式体系，逐步优化当前系统（`public/index.html` + `public/app.js` + `public/style.css`）的视觉一致性与可维护性。

## Phase 1: 统一基础样式层（低风险）

- 将颜色、圆角、间距、阴影先抽成 CSS Variables（放在 `public/style.css` 顶部）。
- 根据 `ui/pixso-style-tokens.json` 建立命名规范（如 `--color-bg-surface`、`--color-text-primary`）。
- 先不改业务结构，只替换重复硬编码样式，保证视觉更稳定。

验收标准：

- 页面主背景、卡片、按钮、输入框、表头、状态色都改为 token 驱动。
- 同类控件不再出现多套近似颜色值。

## Phase 2: 组件级重构（中风险）

- 抽离通用组件样式：按钮、标签、表格、筛选栏、弹窗、表单项。
- 优先改造数据密集区域（看板/列表），复用 Pixso 图表相关主题色与图例规范。
- 新增统一交互状态（hover/active/disabled/focus）。

验收标准：

- 至少 5 类常用控件使用统一 class 体系。
- 主要业务页面可切换 Light/Dark（或预留主题开关能力）。

## Phase 3: 图表与可视化统一（中高价值）

- 依据 Pixso 的 `bar/line/pie/axis/legend/tooltip` 资产，建立图表主题配置。
- 如果你后续接入图表库（如 ECharts），统一系列色、坐标轴、提示框、图例样式。
- 将视觉规范沉淀为 `chartTheme` 配置对象，避免每个图表单独写样式。

验收标准：

- 所有图表的色板、字体、网格线与 tooltip 视觉一致。
- 新增图表页面可直接复用 theme 配置，零散调色显著减少。

## Phase 4: 长期治理（持续）

- 新增页面/模块必须先对齐 token，再开发业务功能。
- 每次 UI 改动同步更新 `ui/` 文档（资产盘点和 token 定义）。
- 逐步补全 Pixso Variables，打通「设计 -> 代码」自动映射。

---

## 与现有代码的对照入口

- 样式入口：`public/style.css`
- 页面骨架：`public/index.html`
- 组件渲染与交互：`public/app.js`

建议先从 `public/style.css` 的变量化开始，这是最小成本且回报最高的一步。