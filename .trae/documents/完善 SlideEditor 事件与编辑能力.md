## 总体目标
- 使指针事件更稳健（不与 Moveable 等叠加层冲突）。
- 提高缩放与点击映射的兼容性与性能。
- 扩展文本编辑能力（光标/选择范围、加粗/斜体/颜色）。
- 增强 Moveable 功能（吸附、对齐线、旋转、双指缩放）。
- 优化 iframe[srcdoc] 注入的时机，避免状态丢失。

## 变更概览
- 文件：`src/composables/useIframeEditor.ts`（主要逻辑调整与能力扩展）。
- 文件：`src/components/SlideEditor.vue`（初始化/重置逻辑在 load 后执行，避免状态丢失）。

## 指针事件（pointerdown）
- 将全局监听改为捕获阶段：把 `doc.addEventListener("pointerdown", ...)` 改为 `{ capture: true }`，优先拦截并决定是否向下游传播。
  - 参考位置：`src/composables/useIframeEditor.ts:83-132`。
- 在命中 Moveable 控制点/吸附线时执行 `stopPropagation()` 并返回，彻底隔离后续逻辑。
  - 现有判断：`.moveable-control, .moveable-line`，在捕获阶段直接阻断。
- 保持 `dblclick`、`keydown` 常规冒泡即可，避免过度拦截（`src/composables/useIframeEditor.ts:133-151`）。

## 点击位置映射与缩放计算
- 移除对 `getComputedStyle(body).transform` 解析 matrix/matrix3d 的依赖。
- 统一用 `getBoundingClientRect()` 做点击映射：
  - 计算比例：`scaleX = body.offsetWidth / rect.width`，`scaleY = body.offsetHeight / rect.height`。
  - 映射坐标：`x = (clientX - rect.left) * scaleX`，`y = (clientY - rect.top) * scaleY`。
- 这样无论 CSS 使用何种写法（matrix、matrix3d、其他复合变换），都能正确映射。
  - 替换位置：一次性文本插入逻辑 `src/composables/useIframeEditor.ts:88-111`。

## 性能优化
- 减少每次点击的样式解析：改用一次 `getBoundingClientRect()` + 读取 `offsetWidth/offsetHeight`。
- 将最近一次计算得到的 `scaleX/scaleY` 缓存在 `win.__editorState` 中，
  - 在 `fitIframeContent` 调整缩放后更新缓存（参考 `src/composables/useIframeEditor.ts:179-202`）。
- 可选：对高频指针事件（如拖动）使用 `requestAnimationFrame` 节流，但 `pointerdown` 本身触发频率较低，可不做节流。

## 文本元素编辑扩展
- 进入编辑时记录并维护选区：在 `dblclick` 进入 `contenteditable` 后监听 `selectionchange`，把最近的 `Range` 保存到 `win.__editorState.selection`。
  - 参考进入编辑处：`src/composables/useIframeEditor.ts:133-137`。
- 新增接口：
  - `toggleBold(frame)`：针对选区或当前元素切换加粗。
  - `toggleItalic(frame)`：切换斜体。
  - `setTextColor(frame, color)`：设置选区（或元素）的文本颜色。
- 应用样式策略：
  - 优先对同一文本节点内的选区使用 `Range.surroundContents(<span style=...>)`；
  - 跨节点复杂选区回退为对选区父元素应用样式或使用内联 `span` 分片包裹（保证稳定性）。
- 保留现有 `Escape/Enter` 退出编辑逻辑（`src/composables/useIframeEditor.ts:138-150`）。

## Moveable 功能增强
- 构造器选项补充：`snappable: true`、`elementGuidelines: body.children`（或过滤出可对齐元素）、`rotatable: true`、`pinchable: true`。
  - 更新位置：Moveable 初始化 `src/composables/useIframeEditor.ts:29-37`。
- 事件处理：
  - `rotate`: 应用 `transform` 里的旋转。
  - `pinch`: 合并缩放/旋转（需要在 iframe 内设置 `body.style.touchAction = "none"`）。
- 吸附阈值与性能：设置合理的 `snapThreshold`，并在元素很多时限制 `elementGuidelines` 的数量（按类或层级筛选）。

## iframe srcdoc 注入与状态
- 避免无意义的重载：注入前比较 `injected` 与 `iframeRef.value.srcdoc`，一致则跳过。
- 所有依赖 iframe 内容的初始化（`fitIframeContent`、必要时的 `initIframeEditor`）都在 `load` 事件回调内执行：
  - 已有 `fitIframeContent` 的 `load` 监听（`src/components/SlideEditor.vue:27-33`），保留并扩展为在激活页时也调用 `initIframeEditor`。
- 在 `reset()` 时同样绑定一次性 `load` 回调，确保重置后完成缩放与编辑器重建（参考 `src/components/SlideEditor.vue:82-84`）。
- 解释：`srcdoc` 会触发 `load`，iframe 内部状态（含 Moveable）会被重置；在 `load` 完成后统一重建可避免状态丢失的感知。

## 代码风格与注释
- 所有新增/修改的函数均添加函数级注释，保持与现有风格一致（TS；简洁命名；模块内状态挂载到 `win.__editorState`）。
- 不引入新的外部依赖（沿用现有 CDN 的 Moveable 与原生 API）。

## 验证与回归测试
- 手动验证：
  - 指针点击不被 Moveable 控制点拦截；普通元素点击能正确选中。
  - 16:9 iframe 内缩放后，文本插入坐标映射准确。
  - 文本双击进入编辑，执行加粗/斜体/颜色时选区不丢失。
  - Moveable 的拖拽/缩放/旋转与吸附在元素较多时仍流畅。
  - `reset()` 后自动缩放与编辑器重建，功能可用。
- 代码级验证：
  - 关键逻辑位置添加 `console.assert`（仅开发期）验证 `scaleX/scaleY` 与坐标映射；确认 `__editorState` 缓存更新时机正确。

## 关联代码参考
- `src/composables/useIframeEditor.ts:83-132`（pointerdown 监听与插入坐标映射）。
- `src/composables/useIframeEditor.ts:29-47`（Moveable 初始化与事件）。
- `src/composables/useIframeEditor.ts:179-202`（fitIframeContent 缩放）。
- `src/components/SlideEditor.vue:20-40`（注入与 load 回调）。
- `src/components/SlideEditor.vue:45-55`（激活态初始化/销毁）。
- `src/components/SlideEditor.vue:82-84`（reset 行为）。

请确认以上方案，确认后我将按该方案逐步修改并验证。