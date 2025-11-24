## 背景与目标
- 背景：AI 生成的 PPT 以 HTML 提供，前端需在线渲染与编辑；支持元素拖拽、调整大小、缩放、双击文本编辑。
- 新增目标：
  - 选中 DOM 元素可区分“文本”与“区块”。
  - 区块：设置背景色/背景图/圆角/边框/阴影/边距等。
  - 文本：选中文本片段，支持加粗、斜体、字体、文字颜色等。

## 现有架构与数据流（简）
- 技术栈：Vue3 + Vite + TS + TailwindCSS + Moveable（UMD）。
- 数据流：容器传入链接 → 每页拉取 HTML → 注入 `iframe[srcdoc]` → 插入 `<base>` 保证资源 → 在 iframe 内加载 Moveable → 活动页启用编辑。
- 文件参考：
  - 容器：`src/components/PptEditor.vue:26-63`
  - 每页：`src/components/SlideEditor.vue:12-19,24-33,42-52,57-59,78-83,87-90`
  - 编辑器：`src/composables/useIframeEditor.ts:4-15,35-66,70-79,84-109,102-129,115-123`

## 关键技术与同源策略
- `iframe[srcdoc]` 注入 HTML，结合 `sandbox="allow-scripts allow-same-origin"` 保持同源可编辑且安全。
- `<base href="原始目录">` 保证相对资源（CSS/图片）解析正确。
- `Moveable` 提供选择框与拖拽/调整大小/缩放（旋转已禁用）。
- `fitIframeContent` 按比例缩放内容，保证 16:9 且无滚动条。

## 新增功能设计
### 1. 选中元素类型识别
- 判定思路：
  - 若触发目标节点包含纯文本且无交互控件（`<img>`, `<svg>`等）且内联/块级文本占主导，则视为“文本”；
  - 其他情况为“区块”。
- 检测策略：
  - `el.childNodes` 遍历统计 `Text` 节点长度与元素子节点类型；
  - 结合 `display`（`getComputedStyle(el).display`）与 `contenteditable` 状态辅助判定。
- 集成位置：在 `selectTarget(el)` 后设置 `state.targetType = 'text' | 'block'`（`useIframeEditor.ts:35-66`）。

### 2. 区块样式编辑（背景/圆角/边框/阴影/边距）
- 交互与 UI：
  - 在父页面右侧/上方显示“区块样式面板”，响应当前活动页与选中元素；
  - 面板项：
    - 背景色：`el.style.backgroundColor`
    - 背景图：`el.style.backgroundImage = url(...)`；`backgroundSize: 'cover'`/`contain`；`backgroundPosition: 'center'`
    - 圆角：`el.style.borderRadius`
    - 边框：`el.style.border = '1px solid #...'`
    - 阴影：`el.style.boxShadow`
    - 边距：`el.style.margin`（必要时同时暴露 `padding`）
- 实现方式：
  - 在父页面维护一个“属性编辑器”组件，通过 `postMessage` 或直接访问 iframe 的 `contentWindow` 与 `state.target`；当前同源可直接访问。
  - 为避免样式冲突，优先写内联样式；必要时使用 CSS 变量注入 `<style>`。

### 3. 文本片段样式编辑（加粗/斜体/字体/颜色）
- 选区获取：在 iframe 内使用 `window.getSelection()` 与 `Range`；
  - 双击进入文本编辑（已实现），在编辑态下允许划词；
  - 若选区跨多个节点，需规范化选区。
- 样式应用：
  - 推荐方案：将选区内容 `extractContents()` 后包裹 `<span>` 并设置内联样式（如 `fontWeight`, `fontStyle`, `fontFamily`, `color`）。
  - 取消样式：检测包裹的 `<span>` 是否仅承担该样式，进行 `unwrap` 或合并；
  - 禁止使用已弃用的 `execCommand`，避免兼容性问题。
- 边界处理：
  - `Range.surroundContents()` 对部分选中非 Text 节点会抛错；建议使用 `extractContents() + createContextualFragment()` 再 `insertNode()`。
  - 连续多次包裹会产生嵌套 `<span>`，需在应用前合并现有样式。
- 集成位置：在 `useIframeEditor.ts` 中新增 `applyTextStyle(range, style)` 与 `removeTextStyle(range, style)` 工具；通过父页面面板触发。

### 4. 工具面板与状态桥接
- 状态源：`state.target` 与 `state.targetType`（iframe 内）。
- 桥接方式：
  - 方案 A（同源直访）：父组件持有 `iframeRef.contentWindow.__editorState` 的引用，直接读取/设置；
  - 方案 B（消息）：在 iframe 与父页面之间定义 `postMessage` 协议（如 `type: 'STYLE_APPLY'`），更安全但稍复杂。
- UI 建议：在父页面上方/右侧显示两个区块：
  - 当 `targetType='block'` 显示“区块样式面板”；
  - 当 `targetType='text'` 显示“文本样式面板”。

## 显示与适配
- 保持 16:9：`aspect-ratio` 控制 iframe 高宽比（`SlideEditor.vue:89`）。
- 完整显示：`fitIframeContent` 缩放内容适配；如需居中，可追加平移实现居中显示（后续迭代）。

## 安全与兼容
- `sandbox` 最小权限；不启用表单提交/弹窗；脚本仅注入 Moveable。
- 文本包裹仅新增 `<span>` 与内联样式，避免破坏结构；必要时提供“清除样式”功能。
- 背景图来源需校验 URL 或使用本地上传；跨域资源需允许匿名访问。

## 性能与可维护性
- 仅活动页启用 Moveable；
- 面板操作统一通过工具函数应用样式，避免散落逻辑；
- 适配与编辑分层：显示适配（缩放）与内容编辑（样式/布局）互不影响。

## 优点
- 同源编辑可靠；
- 适配完整无滚动条，视觉一致；
- 区块/文本分层编辑，满足常见 PPT 样式需求；
- Moveable 交互自然，降低学习成本。

## 缺点与权衡
- 文本片段编辑会引入包裹标签，复杂结构可能产生嵌套与合并负担；
- 写内联样式可能与原 CSS 冲突；
- 背景图/阴影等效果在缩放显示下需要注意像素密度差异；
- 多页/复杂 DOM 的 Moveable 事件可能带来性能开销。

## 可能问题与处理
- 选区跨节点：使用 `extractContents()` 与片段包裹，避免 `surroundContents` 异常；
- 样式合并：应用前对同类样式进行检查与去重，避免 `<span>` 过度嵌套；
- 背景图缩放：统一 `backgroundSize` 策略（cover/contain），提供用户选择；
- 还原样式：提供“清除样式”按钮，移除特定内联样式或解包 `<span>`。

## 扩展与迭代
- 群组编辑：Selecto+Moveable Group；
- 吸附/标尺：Snappable 与可视化对齐线；
- 居中缩放：在 `fitIframeContent` 中加入平移居中逻辑；
- 结构化保存：转为 JSON 结构（元素树/样式/变更），便于回放和协作；
- 协同编辑：CRDT 支持多人实时。 

## 验证点
- 正确识别“文本/区块”，面板动态切换；
- 区块样式编辑对显示与缩放无副作用；
- 文本片段加粗/斜体/字体/颜色能正确应用与撤销；
- 保存的 HTML 包含编辑后的样式与结构；
- 尺寸变化下内容等比缩放，无滚动条。