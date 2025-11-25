# 技术方案文档 —— 基于 Vue3 的 iframe PPT 在线编辑器

## 1. 概述

本方案实现了一个 **基于 iframe 的在线 PPT 编辑器**，支持以下核心功能：

- 在 iframe 内加载 HTML 幻灯片。
- 对 iframe 内的 DOM 元素进行 **选中、移动、缩放、旋转、缩放手势** 操作。
- 对选中元素进行 **文本编辑、加粗、斜体、颜色修改**。
- 支持 **一次性文本插入模式**。
- 支持 **缩放适配 iframe 尺寸**，保证内容全局可视。
- 支持 **保存为 HTML 文件**，以及 **重置为原始内容**。

技术栈：

- **Vue 3 + Vite + TypeScript**
- **Moveable**：iframe 内 DOM 元素移动、缩放、旋转控制
- **ResizeObserver**：iframe 尺寸变化时自动适配内容缩放
- **原生 DOM + Range API**：文本选区与内联样式处理

---

## 2. 模块功能

### 2.1 iframe 编辑器初始化 `initIframeEditor`

**功能**：

- 向 iframe 注入 Moveable 库（仅注入一次）。
- 安装全局事件：
  - `pointerdown`：选中元素、支持一次性文本插入。
  - `dblclick`：进入内容可编辑状态。
  - `selectionchange`：记录文本选区。
  - `keydown`：
    - `Escape`：退出编辑模式。
    - `Enter`：提交文本编辑。
- 提供 `selectTarget`、`toggleEdit`、`getMaxZIndex` 等工具函数。
- 缓存状态在 `iframe.contentWindow.__editorState` 内，包括：
  - `moveable` 控制器实例
  - 当前选中元素 `target`
  - 待插入元素标记 `pendingInsert`
  - 当前缩放比例 `scaleX`, `scaleY`

**技术亮点**：

- 跨 iframe 事件管理与状态缓存。
- Moveable 与 DOM 结合实现拖拽缩放、旋转。
- 支持文本插入的精确坐标计算（考虑缩放比例）。

---

### 2.2 iframe 编辑器销毁 `destroyIframeEditor`

**功能**：

- 销毁 Moveable 实例，释放事件绑定与内存。

---

### 2.3 获取 iframe 内容 `getIframeHtml`

**功能**：

- 序列化当前 iframe DOM 为 HTML 字符串，用于保存。

---

### 2.4 内容自适应缩放 `fitIframeContent`

**功能**：

- 自动计算 iframe 内容宽高。
- 按比例缩放至 iframe 可视区域。
- 缓存缩放比例用于坐标映射。

**技术亮点**：

- 保证拖拽/插入操作坐标与缩放后的视觉位置一致。

---

### 2.5 文本样式操作

**方法**：

- `applyInlineStyle`：对选区或选中元素应用内联 CSS。
- `boldSelected` / `toggleBold`：加粗/取消加粗。
- `toggleItalic`：切换斜体。
- `setTextColor`：设置文本颜色。

**技术亮点**：

- 优先对 Range 选区应用 `span` 包裹样式。
- 对无法包裹的节点回退到父元素样式修改。

---

### 2.6 一次性文本插入模式 `armTextInsert`

**功能**：

- 激活模式后，下一次点击 iframe 内空白位置即可插入文本块。
- 插入文本自动被选中，并支持 Moveable 操作。
- 光标样式变化提示用户进入插入模式。

---

### 2.7 Vue 3 页面集成

**功能**：

- `iframeRef` 绑定 iframe。
- `props.url` 用于加载远程 HTML。
- 生命周期：
  - `onMounted`：加载 HTML 并初始化 ResizeObserver。
  - `onBeforeUnmount`：销毁编辑器与观察器。
- Watch `props.active`：激活或销毁编辑能力。
- 提供操作按钮：
  - 保存本页、加粗、插入文本、重置。

**技术亮点**：

- `ResizeObserver` + `fitIframeContent` 实现响应式内容适配。
- iframe `srcdoc` 注入 `<base>` 保证相对资源路径正确。

---

## 3. 已实现功能总结

| 功能           | 描述                               | 状态 |
| -------------- | ---------------------------------- | ---- |
| 加载远程 HTML  | 支持加载任意 HTML 幻灯片           | ✅   |
| Moveable 操作  | 拖拽、缩放、旋转、手势缩放         | ✅   |
| 文本编辑       | 双击文本编辑，可加粗/斜体/颜色修改 | ✅   |
| 一次性文本插入 | 点击插入文本块，自动选中           | ✅   |
| 缩放适配       | iframe 内内容自适应大小            | ✅   |
| 保存 & 重置    | 导出 HTML 文件 & 回滚原始内容      | ✅   |

---

## 4. 待探索功能（未来增强方向）

1. **多元素选择与组合**

   - 支持框选多个元素同时移动、缩放、旋转。
   - 类似 PowerPoint 的群组操作。

2. **文本富文本编辑**

   - 支持选区内局部加粗、斜体、颜色。
   - 支持字体、字号、对齐方式、行高等属性。
   - 可考虑集成 `Lexical` 或 `ProseMirror`。

3. **图形/图片插入**

   - 支持图片、矩形、圆形、线条等基础形状。
   - 支持拖拽、缩放、旋转。

4. **历史记录与撤销/重做**

   - Undo/Redo 操作。
   - 可结合 `immer` 或自定义命令栈实现。

5. **动画与过渡**

   - 支持元素入场动画。
   - 支持切页切换动画。

6. **多页管理**

   - PPT 页签管理。
   - 页间复制、删除、排序。

7. **协作功能**

   - 支持多人同时在线编辑。
   - WebSocket 或 WebRTC 数据同步。

8. **导出与分享**

   - PDF/图片导出。
   - 支持在线预览与分享链接。

9. **智能布局与 AI 助手**
   - AI 自动排版、文本摘要。
   - 一键美化幻灯片。

---

## 5. 技术风险与注意点

- iframe 跨域限制：目前要求 HTML 与脚本同源。
- Moveable 与复杂 DOM 树结合时，可能出现 transform 叠加或选区冲突。
- Range 操作对复杂文本节点存在包裹失败的情况，需要回退策略。
- 高性能考虑：大量元素的 Moveable 控制可能影响渲染性能。
