/**
 * 在 iframe 内初始化编辑器：安装事件与 Moveable
 */
/**
 * 在 iframe 内初始化编辑器：安装事件与 Moveable
 */
export async function initIframeEditor(frame: HTMLIFrameElement): Promise<void> {
  const doc = frame.contentDocument;
  if (!doc) return;

  // 插入 Moveable CDN（只插一次）
  if (!doc.querySelector("#__moveable_cdn")) {
    const script = doc.createElement("script");
    script.id = "__moveable_cdn";
    script.src = "https://unpkg.com/moveable/dist/moveable.min.js";
    doc.head.appendChild(script);
    await new Promise<void>((resolve) => (script.onload = () => resolve()));
  }

  const win = frame.contentWindow as any;
  const state = win.__editorState || (win.__editorState = { moveable: null, target: null, pendingInsert: null });

  /**
   * 选择目标元素
   */
  function selectTarget(el: HTMLElement) {
    state.target = el;

    const MoveableCtor = (win as any).Moveable;
    if (!MoveableCtor) return;

    if (!state.moveable) {
      state.moveable = new MoveableCtor(doc!.body, {
        target: el,
        draggable: true,
        resizable: true,
        scalable: true,
        rotatable: true,
        pinchable: true,
        origin: false,
        snappable: true,
        elementGuidelines: Array.from(doc!.body.children),
        snapThreshold: 5,
      });
      state.moveable.on("drag", ({ target, transform }: any) => {
        target.style.transform = transform;
      });
      state.moveable.on("resize", ({ target, width, height, delta }: any) => {
        if (delta[0]) target.style.width = `${width}px`;
        if (delta[1]) target.style.height = `${height}px`;
      });
      state.moveable.on("scale", ({ target, transform }: any) => {
        target.style.transform = transform;
      });
      state.moveable.on("rotate", ({ target, transform }: any) => {
        target.style.transform = transform;
      });
      state.moveable.on("pinch", ({ target, transform }: any) => {
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
      el.setAttribute("contenteditable", "true");
      el.focus();
    } else {
      el.removeAttribute("contenteditable");
    }
  }

  /**
   * 计算 body 下数值型 z-index 的最大值
   */
  function getMaxZIndex(): number {
    let max = 0;
    const children = Array.from(doc!.body.children) as HTMLElement[];
    for (const c of children) {
      const zi = getComputedStyle(c).zIndex;
      const n = parseInt(zi || "0", 10);
      if (!Number.isNaN(n)) max = Math.max(max, n);
    }
    return max;
  }

  /**
   * 安装全局事件（只安装一次）
   */
  if (!win.__editorInstalled) {
    doc.addEventListener(
      "pointerdown",
      (e: Event) => {
        const evt = e as MouseEvent;
        const el = evt.target as HTMLElement;
        const body = doc.body as HTMLElement;

        // 一次性文本插入模式
        if (state.pendingInsert === "text") {
          const rect = body.getBoundingClientRect();
          const scaleX = body.offsetWidth / rect.width || 1;
          const scaleY = body.offsetHeight / rect.height || 1;
          const x = (evt.clientX - rect.left) * scaleX;
          const y = (evt.clientY - rect.top) * scaleY;

          const newEl = doc.createElement("div");
          newEl.textContent = "双击可编辑";
          newEl.style.position = "absolute";
          newEl.style.left = `${x}px`;
          newEl.style.top = `${y}px`;
          newEl.style.fontSize = "16px";
          newEl.style.color = "#333";
          newEl.style.lineHeight = "1.4";
          newEl.style.pointerEvents = "auto";
          const maxZ = getMaxZIndex();
          newEl.style.zIndex = String((maxZ || 9998) + 1);
          body.appendChild(newEl);
          selectTarget(newEl);
          state.pendingInsert = null;
          body.style.cursor = "";
          return;
        }

        if (!el) return;
        if (el.closest(".moveable-control, .moveable-line")) {
          evt.stopPropagation();
          return;
        }
        selectTarget(el);
      },
      { capture: true }
    );
    doc.addEventListener("dblclick", (e: Event) => {
      const el = e.target as HTMLElement;
      if (!el) return;
      toggleEdit(el, true);
    });
    doc.addEventListener("selectionchange", () => {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0) {
        win.__editorState.selection = null;
        return;
      }
      try {
        win.__editorState.selection = sel.getRangeAt(0).cloneRange();
      } catch {
        win.__editorState.selection = null;
      }
    });
    doc.addEventListener("keydown", (e: any) => {
      if (e.key === "Escape") {
        const el = state.target as HTMLElement;
        if (el) toggleEdit(el, false);
      }
      if (e.key === "Enter") {
        const el = state.target as HTMLElement;
        if (el && el.isContentEditable) {
          e.preventDefault();
          toggleEdit(el, false);
        }
      }
    });
    win.__editorInstalled = true;
  }
}

/**
 * 销毁 iframe 内编辑器
 */
export function destroyIframeEditor(frame: HTMLIFrameElement | null): void {
  if (!frame?.contentWindow) return;
  const win = frame.contentWindow as any;
  const state = win.__editorState;
  if (state?.moveable) {
    state.moveable.destroy();
    win.__editorState.moveable = null;
  }
}

/**
 * 获取 iframe 当前完整 HTML（用于保存）
 */
export function getIframeHtml(frame: HTMLIFrameElement): string {
  const doc = frame.contentDocument!;
  return doc.documentElement.outerHTML;
}

/**
 * 使 iframe 内页面内容按比例缩放以完全适配 iframe 尺寸
 */
/**
 * 使 iframe 内页面内容按比例缩放以完全适配 iframe 尺寸
 */
export function fitIframeContent(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  const win = frame.contentWindow as any;
  const state = win.__editorState || (win.__editorState = { moveable: null, target: null, pendingInsert: null });
  const html = doc.documentElement as HTMLElement;
  const body = doc.body as HTMLElement;

  const contentWidth = Math.max(body.scrollWidth, html.scrollWidth);
  const contentHeight = Math.max(body.scrollHeight, html.scrollHeight);
  if (!contentWidth || !contentHeight) return;

  const viewportWidth = frame.clientWidth;
  const viewportHeight = frame.clientHeight;
  if (!viewportWidth || !viewportHeight) return;

  const scale = Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight);

  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.margin = "0";
  body.style.width = `${contentWidth}px`;
  body.style.height = `${contentHeight}px`;
  body.style.transformOrigin = "top left";
  body.style.transform = `scale(${scale})`;
  body.style.touchAction = "none";

  // 缓存缩放比例，供点击映射与交互使用
  state.scaleX = scale;
  state.scaleY = scale;
}

/**
 * 将当前选中元素的文本设置为加粗
 */
/**
 * 将当前选区或选中元素应用内联样式
 */
export function applyInlineStyle(frame: HTMLIFrameElement, style: Partial<CSSStyleDeclaration>): void {
  const doc = frame.contentDocument!;
  const win = frame.contentWindow as any;
  const state = win?.__editorState || {};
  const range: Range | null = state.selection || null;
  if (range && !range.collapsed) {
    const span = doc.createElement("span");
    Object.assign(span.style, style);
    try {
      range.surroundContents(span);
      return;
    } catch {
      // 回退：对父节点应用样式
      const common = range.commonAncestorContainer as HTMLElement;
      if (common && common.nodeType === 1) {
        Object.assign((common as HTMLElement).style, style);
        return;
      }
    }
  }
  const el = state?.target as HTMLElement | null;
  if (el) Object.assign(el.style, style);
}

/**
 * 将当前选中元素的文本设置为加粗（保留旧接口）
 */
export function boldSelected(frame: HTMLIFrameElement): void {
  applyInlineStyle(frame, { fontWeight: "700" });
}

/**
 * 切换加粗
 */
export function toggleBold(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument!;
  const win = frame.contentWindow as any;
  const state = win?.__editorState || {};
  const el = state?.target as HTMLElement | null;
  const current = el ? getComputedStyle(el).fontWeight : "normal";
  const next = current === "700" || current === "bold" ? "400" : "700";
  applyInlineStyle(frame, { fontWeight: next });
}

/**
 * 切换斜体
 */
export function toggleItalic(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument!;
  const win = frame.contentWindow as any;
  const state = win?.__editorState || {};
  const el = state?.target as HTMLElement | null;
  const current = el ? getComputedStyle(el).fontStyle : "normal";
  const next = current === "italic" ? "normal" : "italic";
  applyInlineStyle(frame, { fontStyle: next });
}

/**
 * 设置文本颜色
 */
export function setTextColor(frame: HTMLIFrameElement, color: string): void {
  applyInlineStyle(frame, { color });
}

/**
 * 进入一次性文本插入模式（激活页）
 */
export function armTextInsert(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  const win = frame.contentWindow as any;
  const state = win.__editorState || (win.__editorState = { moveable: null, target: null, pendingInsert: null });
  state.pendingInsert = "text";
  doc.body.style.cursor = "text";
}
