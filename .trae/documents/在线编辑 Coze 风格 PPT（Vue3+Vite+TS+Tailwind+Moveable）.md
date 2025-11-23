## 总体思路

* 目标：实现“在线编辑 PPT”的前端界面，垂直渲染多页 HTML 幻灯片，点击选中某页后在该页中选择元素进行拖拽、缩放、调整大小，双击可编辑文本。

* 输入：AI 端返回的 PPT HTML 链接数组（已固定的 4 个链接）。

* 输出：在浏览器内直接编辑这些 HTML 页面中的元素，支持简单保存（下载）与重置。

## 关键技术与约束

* 跨域限制：直接用 `iframe src` 指向外域无法访问/编辑其 DOM（同源策略）。

* 解决方案：

  * 使用 `fetch(url)` 拉取 HTML 字符串。

  * 用 `iframe[srcdoc]` 注入拉取的 HTML，使其与父页面同源，便于 DOM 操作。

  * 在注入的 HTML `<head>` 开头插入 `<base href="原始页面目录">`，保证内部资源（CSS/图片）相对路径能正确加载（MDN `srcdoc` 相对路径解析规则）。

  * `iframe` 使用 `sandbox="allow-scripts allow-same-origin"`，仅允许脚本执行且保持同源，降低风险。

* 编辑能力：在 `iframe` 内部创建 Moveable 实例，定位到被选元素；双击进入文本编辑模式（设置 `contenteditable`）。

## 界面结构

* 顶层页面：左上工具栏（保存、重置）；主区垂直列表渲染 4 个幻灯片；每页上方显示页码与状态。

* 核心组件：

  1. `SlideEditor.vue`（每页一个）：负责拉取 HTML、注入 `srcdoc`、在 iframe 内初始化编辑脚本与 Moveable、处理选择/编辑事件。
  2. `PptEditor.vue`（容器）：接收链接数组，循环渲染 `SlideEditor`，管理全局状态（当前选中页、导出所有页 HTML）。
  3. `useIframeEditor.ts`（组合式函数）：封装“把 HTML 注入 srcdoc + 在 iframe 内挂载编辑能力”的逻辑。

## 交互细节

* 选页：点击某个 `SlideEditor` 外框 → 设为“活动页”，该页的元素可选中与编辑，其他页只读。

* 选元素：在活动页内点击任意元素（过滤掉编辑 UI 等）→ 高亮并显示 Moveable 控件。

* 拖拽/缩放/调整大小：使用 Moveable 的 `draggable/resizable/scalable/rotatable` 栈；把变更直接写回选中元素的内联样式。

* 文本编辑：双击元素 → 临时 `contenteditable=true` + `focus`；按 `Enter` 或失焦结束编辑。

* 保存：导出当前页或全部页的“已编辑 HTML”（序列化 `iframe.contentDocument.documentElement.outerHTML`），供下载。

* 重置：恢复初始 HTML（重新拉取或缓存初始字符串并覆盖）。

## 安全与兼容

* `sandbox` 控制：`allow-scripts allow-same-origin`，不开放表单提交、弹窗等高风险能力。

* 注入代码最小化：仅注入编辑脚本与样式；不执行原页面未知脚本（可移除 `script` 标签或在 `sandbox` 下阻断其访问父窗口）。

* 性能：多 `iframe` 垂直渲染，启用 `loading="lazy"` 避免首屏全部加载；编辑只对活动页初始化 Moveable，非活动页不创建实例。

## 代码设计（Vue3 + TS + Tailwind）

* 路由：单页，无需路由。

* 状态管理：以组件内部 `ref` 管理，必要时用 `provide/inject` 传递活动页标识。

* Tailwind：布局与高亮（如活动页边框 `ring-2 ring-indigo-500`）。

## 关键实现片段

* Ppt 链接：

```ts
const PPT_LINKS = [
  'https://space-static.coze.site/...slide_01.pptx.html?...',
  'https://space-static.coze.site/...slide_02.pptx.html?...',
  'https://space-static.coze.site/...slide_03.pptx.html?...',
  'https://space-static.coze.site/...slide_04.pptx.html?...',
];
```

* PptEditor.vue（容器渲染，简化版）：

```vue
<script setup lang="ts">
import { ref } from 'vue';
import SlideEditor from './SlideEditor.vue';

const links = ref(PPT_LINKS);
const activeIndex = ref<number | null>(0);

/** 切换活动页 */
function setActive(i: number) { activeIndex.value = i; }
</script>
<template>
  <div class="min-h-screen bg-gray-50">
    <header class="p-4 flex items-center gap-2 border-b bg-white">
      <button class="btn" @click="$emit('save-all')">保存全部</button>
      <button class="btn" @click="$emit('reset-all')">重置全部</button>
    </header>
    <main class="p-6 space-y-6">
      <SlideEditor
        v-for="(url, i) in links"
        :key="url"
        :url="url"
        :active="activeIndex === i"
        @click.native="setActive(i)"
      />
    </main>
  </div>
</template>
<style scoped>
.btn { @apply px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700; }
</style>
```

* SlideEditor.vue（核心，简化版骨架）：

```vue
<script setup lang="ts">
import { ref, onMounted, watch, onBeforeUnmount } from 'vue';
import { initIframeEditor, destroyIframeEditor, getIframeHtml } from './useIframeEditor';

const props = defineProps<{ url: string; active: boolean }>();
const iframeRef = ref<HTMLIFrameElement | null>(null);
const originalHtml = ref<string>('');

/** 拉取并注入 HTML */
async function loadHtml() {
  const res = await fetch(props.url);
  const html = await res.text();
  originalHtml.value = html;
  const baseHref = props.url.substring(0, props.url.lastIndexOf('/') + 1);
  const injected = html.replace('<head>', `<head><base href="${baseHref}">`);
  if (iframeRef.value) iframeRef.value.srcdoc = injected;
}

/** 激活时初始化编辑；非激活时销毁 */
watch(() => props.active, async (isActive) => {
  if (!iframeRef.value) return;
  if (isActive) {
    await initIframeEditor(iframeRef.value);
  } else {
    destroyIframeEditor(iframeRef.value);
  }
});

onMounted(loadHtml);
onBeforeUnmount(() => destroyIframeEditor(iframeRef.value));

/** 保存当前页（序列化 iframe HTML） */
async function save() {
  if (!iframeRef.value) return;
  const html = getIframeHtml(iframeRef.value);
  // 触发下载或上报
}

/** 重置当前页 */
function reset() {
  if (iframeRef.value) iframeRef.value.srcdoc = originalHtml.value;
}
</script>
<template>
  <section class="bg-white rounded-lg shadow border p-2" :class="props.active ? 'ring-2 ring-indigo-500' : ''">
    <div class="flex items-center justify-between mb-2">
      <span class="text-sm text-gray-500">可编辑页面</span>
      <div class="flex gap-2">
        <button class="btn" @click="save">保存</button>
        <button class="btn" @click="reset">重置</button>
      </div>
    </div>
    <iframe
      ref="iframeRef"
      class="w-full h-[720px] border"
      sandbox="allow-scripts allow-same-origin"
      loading="lazy"
    />
  </section>
</template>
```

* useIframeEditor.ts（把编辑能力注入到 iframe 内）：

```ts
// useIframeEditor.ts
// 以 UMD 方式在 iframe 内部使用 Moveable（通过注入 <script>）

/**
 * 在 iframe 内初始化编辑器：安装事件与 Moveable
 */
export async function initIframeEditor(frame: HTMLIFrameElement): Promise<void> {
  const doc = frame.contentDocument;
  if (!doc) return;

  // 插入 Moveable CDN（只插一次）
  if (!doc.querySelector('#__moveable_cdn')) {
    const script = doc.createElement('script');
    script.id = '__moveable_cdn';
    script.src = 'https://unpkg.com/moveable/dist/moveable.min.js';
    doc.head.appendChild(script);
    await new Promise<void>(resolve => script.onload = () => resolve());
  }

  // 插入基础样式（高亮选中元素）
  if (!doc.querySelector('#__editor_base_style')) {
    const style = doc.createElement('style');
    style.id = '__editor_base_style';
    style.textContent = `
      .__selected { outline: 2px solid #6366F1; outline-offset: 2px; }
      .__editing { cursor: text; }
      html, body { user-select: none; }
    `;
    doc.head.appendChild(style);
  }

  // 安装事件：点击选中、双击编辑
  const win = frame.contentWindow!;
  const state = (win as any).__editorState || ((win as any).__editorState = { moveable: null, target: null });

  /**
   * 选择目标元素
   */
  function selectTarget(el: HTMLElement) {
    if (state.target) state.target.classList.remove('__selected');
    state.target = el;
    el.classList.add('__selected');

    const MoveableCtor = (win as any).Moveable;
    if (!MoveableCtor) return;

    if (!state.moveable) {
      state.moveable = new MoveableCtor(doc.body, {
        target: el,
        draggable: true,
        resizable: true,
        scalable: true,
        rotatable: true,
        origin: false,
      });
      // 拖拽事件
      state.moveable.on('drag', ({ target, left, top }) => {
        target.style.position = 'absolute';
        target.style.left = `${left}px`;
        target.style.top = `${top}px`;
      });
      // 调整大小事件
      state.moveable.on('resize', ({ target, width, height, delta }) => {
        if (delta[0]) target.style.width = `${width}px`;
        if (delta[1]) target.style.height = `${height}px`;
      });
      // 缩放
      state.moveable.on('scale', ({ target, transform }) => {
        target.style.transform = transform;
      });
      // 旋转
      state.moveable.on('rotate', ({ target, transform }) => {
        target.style.transform = transform;
      });
    } else {
      state.moveable.target = el;
    }
  }

  /**
   * 进入/退出文本编辑
   */
  function toggleEdit(el: HTMLElement, editing: boolean) {
    if (editing) {
      el.classList.add('__editing');
      el.setAttribute('contenteditable', 'true');
      el.focus();
    } else {
      el.classList.remove('__editing');
      el.removeAttribute('contenteditable');
    }
  }

  /**
   * 安装全局事件（只安装一次）
   */
  if (!(win as any).__editorInstalled) {
    doc.addEventListener('pointerdown', (e) => {
      const el = e.target as HTMLElement;
      // 过滤编辑 UI 自身
      if (!el || el.closest('.moveable-control, .moveable-line')) return;
      selectTarget(el);
    });
    doc.addEventListener('dblclick', (e) => {
      const el = e.target as HTMLElement;
      if (!el) return;
      toggleEdit(el, true);
    });
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const el = state.target as HTMLElement;
        if (el) toggleEdit(el, false);
      }
      if (e.key === 'Enter') {
        const el = state.target as HTMLElement;
        if (el && el.isContentEditable) {
          e.preventDefault();
          toggleEdit(el, false);
        }
      }
    });
    (win as any).__editorInstalled = true;
  }
}

/**
 * 销毁 iframe 内编辑器
 */
export function destroyIframeEditor(frame: HTMLIFrameElement | null): void {
  if (!frame?.contentWindow) return;
  const win = frame.contentWindow as any;
  const state = win.__editorState;
  if (state?.moveable) { state.moveable.destroy(); win.__editorState.moveable = null; }
}

/**
 * 获取 iframe 当前完整 HTML（用于保存）
 */
export function getIframeHtml(frame: HTMLIFrameElement): string {
  const doc = frame.contentDocument!;
  return doc.documentElement.outerHTML;
}
```

## 验证策略

* 加载 4 个链接，确保资源能通过 `<base>` 解析并显示正确排版（如“财务表现”“用户画像”“无人机配送进展”“短期战略”等示例内容）。

* 选页：点击不同页边框切换活动页，高亮正确。

* 选元素：在活动页中点击任意块元素，出现 Moveable 控件并可拖拽/缩放/旋转；双击进入文本编辑，`Esc/Enter` 退出编辑。

* 导出：点击保存可看到生成的 HTML 字符串，后续可对接后端或直接触发下载。

## 交付项

* `PptEditor.vue` 容器页面

* `SlideEditor.vue` 单页编辑组件

* `useIframeEditor.ts` 组合式函数（TS，带函数级注释）

* Tailwind 样式类用于布局与高亮

## 后续可扩展

* 框选/多选（Selecto）与组移动

* 标尺与吸附线（Snappable）

* 左侧缩略图导航与页序管理

* JSON Schema 化保存（避免直接保存 HTML）

