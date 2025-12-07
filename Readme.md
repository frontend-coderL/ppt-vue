
# AI PPT 在线编辑器技术方案调研

## 0. 背景与目标

后端通过 AI 生成 PPT，每页输出为独立 HTML 文件。前端需要：

1. 按 PPT 样式 **预览 / 演示**（16:9 画布，自适应容器缩放）。
2. 在此基础上提供 **所见即所得 WYSIWYG 在线编辑能力**：

   * 元素级变换：拖拽、缩放、旋转、对齐吸附。
   * 文本编辑：字体、字号、粗体/斜体、颜色、行高、列表等。
   * 视觉样式：背景、边框、圆角、阴影、透明度、层级。
   * 插入元素：文本框、图片、形状。
   * 布局辅助：对齐线、等距分布、网格、复制 / 粘贴、撤销 / 重做。
3. 二期再扩展：

   * 文本**片段级**编辑（非仅元素级）。
   * 图表插入与编辑。
   * 通过 IndexedDB 持久化最近 50 条操作历史。

技术栈：Vue 3 + TS + Moveable +（可选）Daybrush 生态（Selecto / InfiniteViewer / Guides）+ 富文本编辑器（Tiptap / ProseMirror 等）+ IndexedDB（建议 Dexie）。

---

## 1. 整体架构方案

### 1.1 前端整体结构

* **PPT 容器层（Vue 组件）**

  * 负责页面布局、滚动、多个 slide 的垂直排列。
  * 控制当前选中 slide / 元素、全局工具栏、缩放比例。
* **Slide 视图层（单页 PPT）**

  * 每页使用一个 `<iframe>` 渲染 AI 生成的 HTML。
  * 使用 `fetch` 拉取 HTML，再通过 `srcdoc` 注入（保证同源，可注入脚本）。
* **Iframe 内编辑运行时**

  * 在 iframe 内部挂载：

    * Moveable（元素选中 + 拖拽/缩放/旋转）。([GitHub][1])
    * 事件监听：`pointerdown / dblclick / selectionchange / keydown` 等。
    * 内部的“画布缩放”逻辑，而不是在外部直接 `transform: scale(...)` iframe。
  * 和父级通信：

    * 通过 `window.parent` 暴露少量桥接 API 或 `postMessage`（更通用）。
* **工具栏 / 属性面板（父页面）**

  * 根据当前选中元素类型（块元素 / 文本 / 图片 / 图表）动态切换工具栏内容。
  * 对样式/数据的修改通过桥接 API 下发到 iframe，落到真实 DOM 上。
* **状态与历史**

  * 在父页面维护：

    * 当前文档的“操作列表”以及“快照”（用于撤销/重做）。
    * IndexedDB 同步最近 50 条操作记录（后面展开）。

> 关键原则：**把 iframe 当作“渲染沙箱 + DOM 编辑目标”**，所有状态（撤销/重做、历史、UI 状态）尽量在父层统一管理。

---

## 2. 一期功能能力拆解 & 技术选型

### 2.1 PPT HTML 加载与缩放

#### 2.1.1 HTML 加载流程

1. 父组件 `onMounted`：

   * 调用后端接口，拿到每页 HTML 地址数组。
   * 通过 `fetch` 拉取 HTML 字符串。
2. 创建 iframe：

   * `<iframe :srcdoc="rawHtmlWithInjectedRuntime" ... />`
   * 在原始 HTML 中注入一段 `<script>`，内含：

     * Moveable 初始化。
     * 事件监听逻辑。
     * 与父窗口通信桥接函数。

#### 2.1.2 缩放方案（避免 Moveable 偏移）

> 你现在的问题是：**在父级直接对 iframe 用 `transform: scale(...)` 时，Moveable 控制点与实际坐标不一致**。

推荐方案：**不要缩放 iframe，本质上在 iframe 内部缩放 PPT 根节点，并配合 Moveable 的 `zoom` 属性**。

* 假设 PPT 的原始分辨率为 `1920x1080`：

  * 在 iframe 的 HTML 中约定一个根容器：

    ```html
    <div id="ppt-root" style="width:1920px;height:1080px;transform-origin:top left;"></div>
    ```
  * 把原 HTML body 内容 *全部搬到* `#ppt-root` 里面。
* 由父页面计算视口缩放比例 `scale = containerWidth / 1920`。
* 把 `scale` 传给 iframe 里 runtime（例如通过 `frame.contentWindow.__editorScale = scale` 或 `postMessage`）。
* iframe 内部应用：

  ```ts
  const root = doc.getElementById('ppt-root')!;
  root.style.transform = `scale(${scale})`;
  root.style.transformOrigin = 'top left'; // 保证缩放基于左上角:contentReference[oaicite:1]{index=1}
  moveable.zoom = scale; // 告诉 Moveable 当前缩放比例:contentReference[oaicite:2]{index=2}
  ```

Moveable 在最新版本中支持 `zoom` 用于在容器缩放时保持控制点大小与坐标计算正确。([GitHub][2])

**窗口/容器大小变化时：**

* 父组件监听 `resize`：

  * 重新计算 `scale`，通过桥接 API 通知 iframe。
* iframe 运行时更新：

  * 更新 `ppt-root` 的 `transform` 和 Moveable 的 `zoom`，无需重新挂载 Moveable。

> 这样可以解决你遇到的 **问题 1：iframe 缩放导致 Moveable 偏移**。

---

### 2.2 元素选中与变换（拖拽/缩放/旋转/吸附）

核心还是用 Moveable；它本身支持拖拽、缩放、旋转、对齐吸附等功能。([GitHub][1])

#### 2.2.1 选中策略（避免选到无意义的 inline 文本）

不直接让 Moveable 挂在 `document.body` 上“自动扫描”，而是：

1. 在 iframe 内监听 `pointerdown`：

   ```ts
   doc.addEventListener('pointerdown', (e) => {
     const target = findSelectableElement(e.target as HTMLElement);
     if (!target) {
       clearSelection();
       return;
     }
     selectTarget(target);
   });
   ```
2. `findSelectableElement` 策略：

   * 从事件源向上冒泡查找 **最近的可编辑元素**，规则：

     * 优先有 `data-editable="block|text|image|chart"` 的元素（由后台或预处理打标）。
     * 其次：`display` 为 `block`、`inline-block`、`flex`、`grid` 的元素。
     * 排除：

       * `display: inline` 且 `offsetWidth < 阈值` 或 `offsetHeight < 阈值` 的小 span。
       * 纯图标、装饰元素可以通过 `data-non-editable` 标记。
3. 一旦确定 `target`：

   * Moveable `target = selectedElement`。
   * 使用 `draggable`、`resizable`、`rotatable`、`snappable` 配置。

> 这解决你提到的 **问题 3：文本选中筛选，避免大量无意义 inline 文本被框选**。

#### 2.2.2 宽高与布局冲突（块元素/inline 元素）

你提到的 **问题 2：宽高受父级/inline 影响**，核心是：

* inline 元素改 `width/height` 没效果。
* 父级约束（flex/grid）可能让修改 `width/height` 结果被布局抵消。

解决思路：

1. **选中时动态包装 Editing Wrapper**（推荐）：

   * 选中任意元素 `el` 后：

     1. 获取 `el.getBoundingClientRect()`，在 `ppt-root` 上创建一个绝对定位的 wrapper：

        ```ts
        const wrapper = doc.createElement('div');
        wrapper.style.position = 'absolute';
        wrapper.style.left = rect.left - rootRect.left + 'px';
        wrapper.style.top = rect.top - rootRect.top + 'px';
        wrapper.style.width = rect.width + 'px';
        wrapper.style.height = rect.height + 'px';
        wrapper.style.transform = 'translate(0,0)';
        ```
     2. 把 `el` 移进 wrapper：

        ```ts
        el.parentNode.insertBefore(wrapper, el);
        wrapper.appendChild(el);
        ```
     3. 对 **wrapper** 使用 Moveable 的拖拽/缩放/旋转，把结果表现为：

        * `wrapper.style.left/top/width/height/transform`。
     4. 结束编辑时，把 wrapper 的几何信息回写到 `el` 的行内 style 或 class 上，再解除包装。
   * 优点：

     * 不依赖原有布局，避免 flex/grid/inline 造成的宽高问题。
     * undo/redo 时可以统一记录对 wrapper 或最终落地到 `el` 的样式变更。

2. **对块元素可以直接操作 width/height**：

   * 对于已经是 `position:absolute` 或 `fixed` 的元素，Moveable 的默认行为就足够。
   * 可以通过 `getComputedStyle(el).position` 判断是否要使用 wrapper 方案。

---

### 2.3 文本编辑（一阶段：元素级）

一期先实现 **元素级文本编辑**（双击某个文本块，整个块进入编辑态）：

#### 2.3.1 contenteditable in iframe

* HTML 的 `contenteditable` 属性允许 DOM 内联编辑。([MDN文档][3])
* 实现步骤：

  1. 当用户双击一个被判定为“文本块”的元素（如 `p`, `h1-h6`, `div[data-type=text]`）：

     * 添加 `contenteditable="true"`，并强制 `outline:none`。
     * 聚焦：`el.focus()`。
  2. 监听 iframe 内的 `selectionchange`：

     * 用于同步“当前是否在文本编辑中”、“是否有选区”等状态到父级。
  3. 监听 `blur` 或用户点击其他区域：

     * 移除 `contenteditable` 属性；
     * 将当前 innerHTML 通过桥接同步给父级状态管理。

> 一期工具栏可以先做到：**对整个文本元素设置样式**（font-family/size/weight/color/line-height/text-align 等），即在元素级别直接修改 style 或 class。

#### 2.3.2 文本工具栏与样式应用

* 工具栏（父页面）持有“当前文本样式配置”，例如：

  ```ts
  interface TextStylePayload {
    fontFamily?: string;
    fontSize?: string;
    fontWeight?: 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
    color?: string;
    lineHeight?: number;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    textDecoration?: 'none' | 'underline' | 'line-through';
    listType?: 'none' | 'ul' | 'ol';
  }
  ```

* 应用逻辑：

  * 父组件发指令：`applyTextStyle(targetId, payload)`。
  * iframe 运行时查找对应元素，**优先使用 class + CSS 变量**，减少内联 style 污染。
  * 例如：

    ```css
    [data-text-id] {
      --font-size: 16px;
      --font-weight: 400;
    }
    [data-text-id].text-bold {
      --font-weight: 700;
    }
    ```

---

### 2.4 视觉属性编辑（背景 / 边框 / 阴影 / 透明度 / 层级）

原则同上：属性编辑通过“操作命令”形式落到 DOM：

* 背景色 / 图：

  * `updateStyle(targetId, { backgroundColor: '#xxx', backgroundImage: 'url(...)' })`
* 边框：

  * `borderColor/borderWidth/borderRadius/borderStyle`（虚线等）。
* 阴影：

  * `boxShadow`。
* 透明度：

  * `opacity`。
* 层级：

  * 使用 `z-index` 或通过重新调整 DOM 顺序。

这些都可以抽象为统一的 **StyleUpdateOperation**：

```ts
interface StyleUpdateOperation {
  type: 'update-style';
  targetId: string;
  payload: Partial<CSSStyleDeclaration> | Record<string, string>;
}
```

---

### 2.5 插入元素：文本 / 图片 / 形状

#### 2.5.1 插入文本

1. 用户在父级工具栏点击“插入文本”，再点击 PPT 区域。
2. 父组件通过桥接 API 调用 iframe：

   * 创建一个 `div[data-type="text"]`：

     ```ts
     const el = doc.createElement('div');
     el.dataset.type = 'text';
     el.dataset.id = generateId();
     el.innerText = '双击编辑文本';
     el.style.position = 'absolute';
     el.style.left = x + 'px';
     el.style.top = y + 'px';
     doc.getElementById('ppt-root')!.appendChild(el);
     ```
3. 自动进入选中状态，Moveable target 绑定，支持拖拽 / 缩放。

#### 2.5.2 插入图片

* 图片来源：

  * URL：直接 `<img src="...">`。
  * 本地上传：父层完成上传 -> 得到 URL -> 下发给 iframe。
* 插入方式类似文本：

  ```ts
  const img = doc.createElement('img');
  img.src = imgUrl;
  img.dataset.type = 'image';
  img.style.position = 'absolute';
  // etc.
  ```

#### 2.5.3 插入形状（可选）

* 简单形状可以基于 `<div>` + border-radius / background + ::before/::after 实现；
* 若要更复杂，后续可考虑 `SVG` 或 `canvas`。

---

### 2.6 布局辅助：对齐线 / 网格 / 撤销/重做

Daybrush 生态中有几个可以组合使用的库：([GitHub][4])

* **Guides**：绘制标尺与对齐线。
* **InfiniteViewer**：无限画布滚动视图，与 Moveable、Selecto 兼容。
* **Selecto**：拖框多选（你现在暂时不需要）。

一期可以简化：

* 对齐线：

  * 直接使用 Moveable 的 `snappable`、`elementGuidelines`、`horizontalGuidelines`、`verticalGuidelines` 实现吸附与对齐线。([GitHub][5])
* 网格：

  * 在 `ppt-root` 下绘制背景网格（CSS background-image 或单独层）。

撤销 / 重做在下一小节统一讲。

---

### 2.7 撤销 / 重做与数据模型

推荐**命令式操作模型**：

1. 定义通用操作类型：

   ```ts
   type Operation =
     | StyleUpdateOperation
     | InsertElementOperation
     | RemoveElementOperation
     | TransformOperation
     | TextContentUpdateOperation
     | ZIndexUpdateOperation
     | ChartDataUpdateOperation
     // ...
   ```

2. 每次对 DOM 进行修改前：

   * 根据当前状态生成 `Operation` 和对立的 `inverseOperation`。
   * 推入 `undoStack`，清空 `redoStack`。

3. 撤销：

   * 从 `undoStack` 弹出 `op`，执行其 `inverseOperation`，推入 `redoStack`。

4. 重做：

   * 从 `redoStack` 弹出，再执行原操作。

> 这套模型是二期 IndexedDB 持久化的基础：IndexedDB 存的是“操作列表”而不是整页 HTML。

---

## 3. 二期能力设计

### 3.1 文本片段级编辑

这是你目前觉得“跨 iframe 比较复杂”的点，也是传统富文本编辑器解决得最好的地方。

**结论**：不要在原 HTML DOM 上直接发明轮子，尽量借助 **结构化富文本编辑器**（ProseMirror / Tiptap / Lexical 等）。([prosemirror.net][6])

#### 3.1.1 推荐方案：外层弹出富文本编辑器

流程：

1. 用户双击某个文本块，或选中一段文本后点击“高级编辑”：

   * iframe 运行时把该文本块的 innerHTML 通过桥接发给父层。
2. 父层弹出一个基于 **Tiptap + Vue 3** 的编辑器对话框：

   * Tiptap 是 ProseMirror 的 Vue 封装，支持 marks（粗体、斜体、颜色等）和嵌套节点，非常适合片段级编辑。([tiptap.dev][7])
3. 用户在弹框里进行各种富文本操作（包括选中片段加粗、改变颜色等）。
4. 保存时：

   * 将编辑后的 HTML（经必要的 sanitize）回写 iframe 中对应元素的 innerHTML。
   * 同时记录一个 `TextContentUpdateOperation`（包含旧 HTML 和新 HTML）进入历史栈。

优点：

* 所有富文本复杂度由 Tiptap/ProseMirror 负责，你只要处理“导入/导出 HTML + 映射到同一块 DOM”。
* 跨 iframe 问题被弱化：在片段编辑阶段，编辑是在父窗口进行。

> 如果你未来需要“**在原位置 inline 编辑且还有工具栏**”，可以考虑把一个 Tiptap 编辑器挂在 iframe 内，但对移动端兼容和选区同步会复杂许多，优先级可以放后。

---

### 3.2 图表编辑

当前问题 5：**如何识别图表 + 如何修改图表数据？**

图表本质是一个“带数据的可视化组件”，AI 生成 HTML 时如果只是单纯 `<img>` 或 `<canvas>`，前端是无法知道其数据结构的。

#### 3.2.1 建议制定 AI PPT HTML 规范（与后端协作）

约定：所有可编辑图表，都按统一结构输出，例如：

```html
<div
  data-type="chart"
  data-chart-id="chart-1"
  data-chart-lib="echarts"
>
  <script type="application/json" data-chart-option>
    { "xAxis": { ... }, "series": [ ... ] }
  </script>
  <div class="chart-container"></div>
</div>
```

* `data-type="chart"`：前端识别为“图表元素”。
* `<script type="application/json" data-chart-option>`：图表配置 JSON，前端可以安全解析。ECharts 本身就是通过配置对象描述图表。([Apache ECharts][8])
* `chart-container`：用于真正挂载 ECharts 的 div。

#### 3.2.2 选型：图表渲染库

* 优先选用 **ECharts**：

  * 适配国内使用习惯，文档丰富，配置式语法。([Apache ECharts][8])
* 或者 Highcharts / CanvasJS 等也可以生成可编辑图表（甚至支持拖拽数据点）。([CanvasJS][9])

#### 3.2.3 编辑交互设计

1. 选中 `data-type="chart"` 元素：

   * 工具栏切换到“图表编辑”面板。
2. 在父层展示一个简化的数据编辑界面（表格或表单），背后对应的是 `chartOption.dataset` 或 `series.data`。([Apache GitHub][10])
3. 用户修改数据后：

   * 将数据修改形成 `ChartDataUpdateOperation`（包含旧 option 与新 option 的 diff 或完整对象）。
   * 下发到 iframe：

     * 解析 `<script data-chart-option>` 的 JSON。
     * 更新 option。
     * 调用 `echartsInstance.setOption(updatedOption, true)` 重绘。
   * 也可选择只存储数据 diff，在 ECharts option 上 apply diff。

> 关键点：**图表必须在 HTML 里携带结构化配置**，否则编辑层无从下手。

---

### 3.3 IndexedDB 历史记录（最近 50 次操作）

IndexedDB 是浏览器的持久化数据库，比 localStorage 强得多，适合用来存储操作记录。([MDN文档][11])

#### 3.3.1 使用 Dexie 简化 IndexedDB

IndexedDB 原生 API 较繁琐，推荐使用 **Dexie** 作为封装，它提供简单的 Promise API，并对 Vue 等框架有较好的支持。([raymondcamden.com][12])

简单模型：

```ts
import Dexie, { Table } from 'dexie';

interface HistoryRecord {
  id?: number;
  docId: string;
  timestamp: number;
  op: Operation;
}

class HistoryDB extends Dexie {
  history!: Table<HistoryRecord, number>;

  constructor() {
    super('ai-ppt-history');
    this.version(1).stores({
      history: '++id, docId, timestamp',
    });
  }
}

export const historyDB = new HistoryDB();
```

使用策略：

* 每次执行操作时：

  * 向内存 `undoStack` 推入。
  * 同时向 `history` 表插入记录。
* 只保留最近 50 条：

  * 查询该 `docId` 下记录数量 > 50 时，删除最早的记录。
* 用户在“历史记录”侧栏中：

  * 可以浏览最近 50 条操作（时间 + 操作类型）。
  * 点击某条操作，可：

    * 回放到此操作之后的状态（需要做时间旅行，可能需要“从最初状态 + 重放操作”的方式生成，需要存一个“基准快照”）。
    * 或仅展示“对比”。

> 如果初期不做完整“时间旅行”，可以先只支持“撤销 / 重做”的栈在内存中，IndexedDB 仅作为“记录浏览”，将时间旅行放到更靠后迭代。

---

## 4. 你当前遇到的 5 个问题 & 方案汇总

### 4.1 问题 1：iframe 缩放导致 Moveable 偏移

**现状：** 父级对 `<iframe>` 直接 `transform: scale(...)`，Moveable 控制点位置与点击位置偏移。

**方案：**

1. **不要缩放 iframe，本质上缩放 iframe 内部的 `ppt-root` 容器**：

   * `ppt-root` 设定固定 PPT 分辨率（1920x1080）。
   * 父级计算好 `scale`，通过桥接传入 iframe。
2. iframe 内部：

   * 对 `ppt-root` 设置 `transform: scale(scale); transform-origin: top left;`。([MDN文档][13])
   * 同时设置 `moveable.zoom = scale;`，让 Moveable 知道缩放倍率。([GitHub][2])

这样 pointer 坐标 / DOM rect / Moveable rect 会在同一坐标系下，偏移问题基本解决。

---

### 4.2 问题 2：宽高受父级/inline 影响

**现状：** inline 元素改 width/height 无效，父级 flex/grid 导致改了 width/height 结果被布局重排。

**方案：**

* 对所有“可拖拽/缩放”的元素，在进入编辑态时 **用绝对定位 wrapper 包起来**：

  * wrapper 负责 `left/top/width/height/transform`。
  * 真正的元素被包裹在里面，不再直接参与原有流式布局。
* 完成编辑或保存时：

  * 将 wrapper 的几何信息抽象到一个“布局样式”（比如 `position:absolute; left;top;width;height`）落回元素本身。
  * 再把元素从 wrapper 中移出（或直接保留 wrapper 作为布局容器）。

---

### 4.3 问题 3：文本选中筛选

**现状：** Moveable 默认会“任意 DOM 都能选中”，但大部分 inline 文本不希望成为拖拽对象。

**方案：**

* 自己实现元素选中逻辑（按规则过滤），然后再把结果交给 Moveable：

  * 通过 `pointerdown` 事件，从 `e.target` 向上寻找满足条件的祖先元素：

    * 有 `data-editable` / `data-type` 标记的；
    * 或者 block / inline-block / flex / grid 元素；
    * 排除纯 inline、小尺寸装饰元素。
* Moveable 的 target 来源完全由你控制，从而保证选中的是“可编辑元素”，而不是任意 span。

---

### 4.4 问题 4：文本片段级编辑跨 iframe 复杂

**现状：** 希望实现“只加粗选中的几个字”这种能力，但直接在 iframe 中对 DOM 处理比较痛苦。

**推荐方案（分期）：**

1. **一期**：只支持“元素级文本样式编辑 + `contenteditable` 单块编辑”，实现快，满足大部分场景。
2. **二期**：外层弹出 Tiptap 富文本编辑器：

   * 双击文本块 => 父层弹出编辑器，对这块文本进行完整富文本编辑。
   * 保存时，把编辑结果 innerHTML 写回 iframe 对应节点。
   * Tiptap 基于 ProseMirror，天然支持片段级 marks（strong/em/color 等）。([tiptap.dev][7])

这样可以兼顾复杂度与能力上限。

---

### 4.5 问题 5：图表编辑与数据修改

**现状：** 不知道如何识别图表 & 更新其数据。

**方案：**

1. 与后端约定 **AI PPT HTML 图表输出规范**：

   * 所有图表容器带 `data-type="chart"`。
   * 内含 `<script type="application/json" data-chart-option>` 存放配置。
2. 前端识别图表：

   * 选中元素时检查 `dataset.type === 'chart'`。
3. 编辑：

   * 父层呈现数据编辑 UI，背后直接操作 chart option。
   * 更新时：

     * 将修改后的 option 通过桥接传回 iframe。
     * iframe 中用 ECharts / Chart.js 重新渲染。([Apache ECharts][8])
   * 同时生成 `ChartDataUpdateOperation` 进入历史栈。

---

## 5. 总结：一期落地建议与优先级

**一期必做：**

1. iframe + `srcdoc` + 注入编辑 runtime。
2. 内部 `ppt-root` 固定原始分辨率，使用内部 `scale+transform-origin+moveable.zoom` 方案。
3. Moveable + 自定义选中策略（过滤 inline）。
4. 绝对定位 wrapper 解决宽高 / 布局冲突。
5. 元素级文本编辑（contenteditable）+ 文本样式工具栏。
6. 基础视觉样式编辑（背景、边框、阴影、透明度、层级）。
7. 插入文本 / 图片元素。
8. 操作命令模型 + 内存撤销 / 重做。

**二期扩展：**

1. Tiptap 弹框式文本片段级编辑。
2. 图表规范 + 图表数据编辑 + ECharts 渲染。
3. Dexie + IndexedDB 持久化最近 50 条历史记录（主要用于历史浏览 / 快照回退）。

如果你愿意，下一步我可以帮你把 **iframe 编辑 runtime 的 TS 代码骨架** 和 **父层 Vue 组件的接口设计**写成一份“最小可用版本（MVP）”的示例，直接可以按它来拆分任务和写代码。

[1]: https://github.com/daybrush/moveable?utm_source=chatgpt.com "Moveable! Draggable! Resizable! Scalable! Rotatable! ..."
[2]: https://github.com/daybrush/moveable/issues/380?utm_source=chatgpt.com "The SnapDigit style was wrong when setting zoom #380"
[3]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/contenteditable?utm_source=chatgpt.com "HTML contenteditable global attribute - MDN Web Docs"
[4]: https://github.com/daybrush/daybrush?utm_source=chatgpt.com "daybrush/daybrush"
[5]: https://raw.githubusercontent.com/daybrush/moveable/master/CHANGELOG.md?utm_source=chatgpt.com "https://raw.githubusercontent.com/daybrush/moveabl..."
[6]: https://prosemirror.net/docs/ref/?utm_source=chatgpt.com "Reference manual"
[7]: https://tiptap.dev/docs/editor/getting-started/install/vue3?utm_source=chatgpt.com "Vue 3 | Tiptap Editor Docs"
[8]: https://echarts.apache.org/examples/en/index.html?utm_source=chatgpt.com "Examples - Apache ECharts"
[9]: https://canvasjs.com/javascript-charts/interactive-draggable-chart/?utm_source=chatgpt.com "JavaScript Charts & Graphs with Draggable Data Points"
[10]: https://apache.github.io/echarts-handbook/en/concepts/dataset/?utm_source=chatgpt.com "Dataset - Concepts - Handbook - Apache ECharts"
[11]: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB?utm_source=chatgpt.com "Using IndexedDB - Web APIs - MDN Web Docs"
[12]: https://www.raymondcamden.com/2022/08/18/investigating-indexeddb-wrapper-libraries-part-two?utm_source=chatgpt.com "Investigating IndexedDB Wrapper Libraries - Part Two"
[13]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-origin?utm_source=chatgpt.com "transform-origin - CSS - MDN Web Docs"
