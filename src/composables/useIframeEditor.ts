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
  const state = win.__editorState || (win.__editorState = { moveable: null, target: null });

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
        rotatable: false,
        origin: false,
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
   * 安装全局事件（只安装一次）
   */
  if (!win.__editorInstalled) {
    doc.addEventListener("pointerdown", (e: Event) => {
      const el = e.target as HTMLElement;
      if (!el || el.closest(".moveable-control, .moveable-line")) return;
      selectTarget(el);
    });
    doc.addEventListener("dblclick", (e: Event) => {
      const el = e.target as HTMLElement;
      if (!el) return;
      toggleEdit(el, true);
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
export function fitIframeContent(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument;
  if (!doc) return;
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
}
