/**
 * 在 iframe 内初始化编辑器：安装事件与 Subjx
 */
export async function initIframeEditor(frame: HTMLIFrameElement): Promise<void> {
  const doc = frame.contentDocument;
  if (!doc) return;

  // 插入 Subjx CDN 与样式（只插一次）
  if (!doc.querySelector("#__subjx_cdn")) {
    const link = doc.createElement("link");
    link.id = "__subjx_css";
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/subjx/dist/style/subjx.css";
    doc.head.appendChild(link);

    const script = doc.createElement("script");
    script.id = "__subjx_cdn";
    script.src = "https://unpkg.com/subjx/dist/js/subjx.js";
    doc.head.appendChild(script);
    await new Promise<void>((resolve) => (script.onload = () => resolve()));
  }

  const win = frame.contentWindow as any;
  const state = win.__editorState || (win.__editorState = { subjx: null, target: null, controls: null });

  /**
   * 创建并返回缩放包裹容器（用于对齐 Subjx 控件与被缩放内容）
   */
  function ensureScaleWrapper(): HTMLElement {
    let wrapper = doc?.getElementById("__ppt_scale_root") as HTMLElement | null;
    if (!wrapper) {
      wrapper = doc!.createElement("div");
      wrapper.id = "__ppt_scale_root";
      wrapper.style.position = "relative";
      wrapper.style.left = "0";
      wrapper.style.top = "0";
      wrapper.style.transformOrigin = "top left";
      // 将 body 内现有子节点搬迁到 wrapper
      const children = Array.from(doc!.body.childNodes);
      children.forEach((node) => wrapper!.appendChild(node));
      doc!.body.appendChild(wrapper);
      // 保证 body 作为视口容器
      doc!.body.style.margin = "0";
      doc!.body.style.overflow = "hidden";
    }
    return wrapper;
  }
  const scaleWrapper = ensureScaleWrapper();

  /**
   * 选择目标元素
   */
  function selectTarget(el: HTMLElement) {
    state.target = el;

    const subjxFn = (win as any).subjx || (win as any).Subjx;
    if (!subjxFn) return;

    if (!state.subjx) {
      state.subjx = subjxFn(el).drag({
        draggable: true,
        resizable: true,
        rotatable: false,
        scalable: true,
        container: scaleWrapper,
        controlsContainer: scaleWrapper,
        onMove({ transform }: any) {
          el.style.transform = transform;
          try {
            state.subjx?.fitControlsToSize?.();
          } catch {}
        },
        onResize({ transform, width, height }: any) {
          if (typeof width === "number") el.style.width = `${width}px`;
          if (typeof height === "number") el.style.height = `${height}px`;
          if (transform) el.style.transform = transform;
          try {
            state.subjx?.fitControlsToSize?.();
          } catch {}
        },
      });
      state.controls = state.subjx.controls || null;
      try {
        state.subjx.fitControlsToSize();
      } catch {}
    } else {
      // 先禁用旧实例，再绑定到新元素
      try {
        state.subjx.disable();
      } catch {}
      state.subjx = subjxFn(el).drag({
        draggable: true,
        resizable: true,
        rotatable: false,
        scalable: true,
        container: scaleWrapper,
        controlsContainer: scaleWrapper,
        onMove({ transform }: any) {
          el.style.transform = transform;
          try {
            state.subjx?.fitControlsToSize?.();
          } catch {}
        },
        onResize({ transform, width, height }: any) {
          if (typeof width === "number") el.style.width = `${width}px`;
          if (typeof height === "number") el.style.height = `${height}px`;
          if (transform) el.style.transform = transform;
          try {
            state.subjx?.fitControlsToSize?.();
          } catch {}
        },
      });
      state.controls = state.subjx.controls || null;
      try {
        state.subjx.fitControlsToSize();
      } catch {}
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
      if (!el) return;
      const controls = state.controls as HTMLElement | null;
      if (controls && (el === controls || controls.contains(el))) return;
      selectTarget(el);
      try {
        state.subjx?.fitControlsToSize?.();
      } catch {}
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
  if (state?.subjx) {
    try {
      state.subjx.disable();
    } catch {}
    win.__editorState.subjx = null;
    win.__editorState.controls = null;
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
  const wrapper = (doc.getElementById("__ppt_scale_root") as HTMLElement) || body;

  const contentWidth = Math.max(wrapper.scrollWidth, html.scrollWidth);
  const contentHeight = Math.max(wrapper.scrollHeight, html.scrollHeight);
  if (!contentWidth || !contentHeight) return;

  const viewportWidth = frame.clientWidth;
  const viewportHeight = frame.clientHeight;
  if (!viewportWidth || !viewportHeight) return;

  const scale = Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight);

  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.margin = "0";
  wrapper.style.width = `${contentWidth}px`;
  wrapper.style.height = `${contentHeight}px`;
  wrapper.style.transformOrigin = "top left";
  wrapper.style.transform = "";
  (wrapper.style as any).zoom = String(scale);

  try {
    const win = frame.contentWindow as any;
    win.__editorScale = scale;
    const subjxInst = win?.__editorState?.subjx;
    subjxInst?.fitControlsToSize?.();
  } catch {}
}

/**
 * 将当前选中元素的文本设置为加粗
 */
export function boldSelected(frame: HTMLIFrameElement): void {
  const win = frame.contentWindow as any;
  const state = win?.__editorState;
  const el = state?.target as HTMLElement | null;
  if (!el) return;
  el.style.fontWeight = "700";
}
