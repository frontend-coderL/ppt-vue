<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import {
  initIframeEditor,
  destroyIframeEditor,
  getIframeHtml,
  fitIframeContent,
  boldSelected,
  armTextInsert,
} from "../composables/useIframeEditor";

const props = defineProps<{ url: string; active: boolean }>();
const iframeRef = ref<HTMLIFrameElement | null>(null);
const originalHtml = ref<string>("");
let ro: ResizeObserver | null = null;

/**
 * 拉取并注入 HTML 到 iframe[srcdoc]
 */
async function loadHtml() {
  const res = await fetch(props.url);
  const html = await res.text();
  originalHtml.value = html;
  const baseHref = props.url.substring(0, props.url.lastIndexOf("/") + 1);
  const injected = html.replace("<head>", `<head><base href="${baseHref}">`);
  if (iframeRef.value) iframeRef.value.srcdoc = injected;
  iframeRef.value?.addEventListener(
    "load",
    () => {
      if (iframeRef.value) fitIframeContent(iframeRef.value);
    },
    { once: true }
  );
  if (iframeRef.value && !ro) {
    ro = new ResizeObserver(() => {
      if (iframeRef.value) fitIframeContent(iframeRef.value);
    });
    ro.observe(iframeRef.value);
  }
}

/**
 * 激活时初始化编辑能力；非激活时销毁
 */
watch(
  () => props.active,
  async (isActive: any) => {
    if (!iframeRef.value) return;
    if (isActive) {
      await initIframeEditor(iframeRef.value);
    } else {
      destroyIframeEditor(iframeRef.value);
    }
  }
);

onMounted(loadHtml);
onBeforeUnmount(() => {
  destroyIframeEditor(iframeRef.value);
  ro?.disconnect();
  ro = null;
});

/**
 * 保存当前页（序列化为字符串并下载）
 */
function save() {
  if (!iframeRef.value) return;
  const html = getIframeHtml(iframeRef.value);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "slide.html";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 重置为初始 HTML
 */
function reset() {
  if (iframeRef.value) iframeRef.value.srcdoc = originalHtml.value;
}

/**
 * 将选中元素文本加粗
 */
function bold() {
  if (!iframeRef.value) return;
  boldSelected(iframeRef.value);
}

/**
 * 触发一次性文本插入模式（仅激活页生效）
 */
function insertText() {
  if (!iframeRef.value || !props.active) return;
  armTextInsert(iframeRef.value);
}
</script>

<template>
  <div>
    <div class="mb-2 flex items-center gap-2">
      <button
        class="btn"
        @click="save"
      >
        保存本页
      </button>
      <button
        class="btn"
        @click="bold"
      >
        加粗
      </button>
      <button
        class="btn"
        @click="insertText"
      >
        文本
      </button>
      <button
        class="btn"
        @click="reset"
      >
        重置本页
      </button>
    </div>
    <iframe
      ref="iframeRef"
      class="w-full border ppt-frame"
      sandbox="allow-scripts allow-same-origin"
      loading="lazy"
    />
  </div>
</template>

<style scoped>
.btn {
  @apply px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700;
}
.ppt-frame {
  aspect-ratio: 16 / 9;
}
</style>
