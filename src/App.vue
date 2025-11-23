<script setup lang="ts">
import { ref } from "vue";
import PptEditor from "./components/PptEditor.vue";

// AI 生成 PPT 的 HTML 链接（写死）
const PPT_LINKS = [
  "https://space-static.coze.site/7573960296021950761/data_volume/files/%E7%BE%8E%E5%9B%A22025%E5%B9%B4Q3%E8%B4%A2%E6%8A%A5%E5%88%86%E6%9E%90%E4%B8%8E%E6%88%98%E7%95%A5%E5%B1%95%E6%9C%9B_slide_01.pptx.html?sign=1766162717-607f04372e-0-8ff39b2d636439bee7f6077db9ea5c72a2aa5ae4471a78aff280052e7cc57fe2",
  "https://space-static.coze.site/7573960296021950761/data_volume/files/%E7%BE%8E%E5%9B%A22025%E5%B9%B4Q3%E8%B4%A2%E6%8A%A5%E5%88%86%E6%9E%90%E4%B8%8E%E6%88%98%E7%95%A5%E5%B1%95%E6%9C%9B_slide_02.pptx.html?sign=1766162717-66fd99a5a3-0-3ccf88e7086f6ef3a1613503518a59bc8da4f2d27cbbad2aff7c96496bc86575",
  "https://space-static.coze.site/7573960296021950761/data_volume/files/%E7%BE%8E%E5%9B%A22025%E5%B9%B4Q3%E8%B4%A2%E6%8A%A5%E5%88%86%E6%9E%90%E4%B8%8E%E6%88%98%E7%95%A5%E5%B1%95%E6%9C%9B_slide_03.pptx.html?sign=1766162717-e55de4a83b-0-5462764ba5f27860852c7a896340bfa8aef411836fec8fc55964ad7b6115fcfb",
  "https://space-static.coze.site/7573960296021950761/data_volume/files/%E7%BE%8E%E5%9B%A22025%E5%B9%B4Q3%E8%B4%A2%E6%8A%A5%E5%88%86%E6%9E%90%E4%B8%8E%E6%88%98%E7%95%A5%E5%B1%95%E6%9C%9B_slide_04.pptx.html?sign=1766162717-d0ce731d91-0-26991dff6e922b699ad62b02525741038fb79bef35fd6c85a4fd8b56428ea5b8",
];

const links = ref(PPT_LINKS);
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="sticky top-0 z-10 bg-white border-b">
      <div class="max-w-6xl mx-auto p-4 flex items-center gap-3">
        <h1 class="text-lg font-semibold">AI 生成 PPT 在线编辑</h1>
      </div>
    </header>
    <main class="max-w-6xl mx-auto p-6">
      <PptEditor :links="links" />
    </main>
  </div>
</template>
