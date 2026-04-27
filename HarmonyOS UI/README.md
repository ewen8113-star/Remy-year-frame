# HarmonyOS UI 设计基线（Pixso 社区库）

## 设计源

- 文件链接：`https://pixso.cn/app/design/BPLpWQ3LExXNnpBBHYLyzA?page-id=169%3A8794`
- 文件名：`HarmonyOS Component Library（来自社区）`
- 接入方式：通过 Pixso MCP 读取并固化为本项目 UI 规范基线

## 已读取资产概览

- 本地组件（Local Components）：`1111`
- 本地样式（Local Styles）：`385`
- 变量集（Variable Sets）：当前文件返回为空
- 目标页面：`169:8794`
- 已生成 ArkUI 页面代码块：`6` 个（含主页面与子模块）

## 规范使用范围

本目录中的规范用于约束本项目后续所有设计与实现，覆盖：

- 视觉规范（颜色、字体、圆角、阴影、层级）
- 组件规范（组件命名、状态、尺寸、变体）
- 交互规范（状态反馈、可点击区、焦点、禁用态、错误态、过渡）
- 多端适配（Phone / Foldable / Tablet / 2in1 等分级思路）

## 强制落地原则

1. 新增页面或模块时，优先复用本库中的组件语义与状态命名。
2. 存在 Light/Dark 主题时，必须保证两套主题行为一致，仅视觉 Token 切换。
3. 交互态至少覆盖：Normal / Hover / Focus / Pressed / Disabled / Error（按组件实际能力取子集）。
4. 输入类组件必须包含边界态：空态、输入中、校验错误、禁用态。
5. 搜索、列表、菜单、弹窗、标题栏等高频组件，优先遵循 HarmonyOS 组件库结构，不做随意重组。

## 与当前项目技术栈的对应关系

当前项目前端为原生 HTML/CSS/JS。采用本规范时：

- 组件语义与交互逻辑对齐 HarmonyOS 设计；
- 代码实现保持现有技术栈（不引入 React/Vue 等框架）；
- 使用 CSS 变量承接 Token，使用 `public/app.js` 承接交互状态机与事件逻辑。
