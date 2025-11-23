<script setup lang="ts">
import { ref } from "vue";
import SlideEditor from "./SlideEditor.vue";

const props = defineProps<{ links: string[] }>();
const activeIndex = ref<number | null>(0);

/** 切换活动页 */
function setActive(i: number) {
  activeIndex.value = i;
}

/** 保存全部（示例：控制台输出） */
function saveAll() {
  // 在实际场景中，应收集每个 SlideEditor 的当前 HTML 并打包下载/上传
  console.log("保存全部：请在每页中点击保存或对接后端");
}

/** 重置全部 */
function resetAll() {
  // 可通过事件触发每个子组件的重置逻辑，这里简化为提示
  console.log("重置全部：请在每页中点击重置");
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center gap-2">
      <button
        class="btn"
        @click="saveAll"
      >
        保存全部
      </button>
      <button
        class="btn"
        @click="resetAll"
      >
        重置全部
      </button>
    </div>
    <div class="space-y-6">
      <section
        v-for="(url, i) in props.links"
        :key="url"
        class="rounded-lg shadow bg-white border"
        :class="activeIndex === i ? 'ring-2 ring-indigo-500' : ''"
        @click="setActive(i)"
      >
        <div class="px-3 py-2 flex items-center justify-between border-b bg-gray-50">
          <span class="text-sm text-gray-600">第 {{ i + 1 }} 页</span>
          <span class="text-xs text-gray-400">{{ activeIndex === i ? "可编辑" : "只读" }}</span>
        </div>
        <div class="p-3">
          <SlideEditor
            :url="url"
            :active="activeIndex === i"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.btn {
  @apply px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700;
}
</style>
