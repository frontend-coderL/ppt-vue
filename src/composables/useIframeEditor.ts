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
    doc.addEventListener("pointerdown", (e: Event) => {
      const evt = e as MouseEvent;
      const el = evt.target as HTMLElement;
      const body = doc.body as HTMLElement;

      // 一次性文本插入模式
      if (state.pendingInsert === "text") {
        const rect = body.getBoundingClientRect();
        const transform = getComputedStyle(body).transform;
        let scaleX = 1;
        let scaleY = 1;
        if (transform && transform !== "none") {
          const nums = transform
            .replace(/matrix\(([^)]+)\)/, "$1")
            .replace(/matrix3d\(([^)]+)\)/, "$1")
            .split(",")
            .map((s) => parseFloat(s.trim()))
            .filter((n) => !Number.isNaN(n));
          if (nums.length === 6) {
            scaleX = nums[0];
            scaleY = nums[3];
          } else if (nums.length === 16) {
            scaleX = nums[0];
            scaleY = nums[5];
          }
        }
        const x = (evt.clientX - rect.left) / (scaleX || 1);
        const y = (evt.clientY - rect.top) / (scaleY || 1);

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
