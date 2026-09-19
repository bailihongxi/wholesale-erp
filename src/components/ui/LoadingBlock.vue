<template>
  <!--
    列表页首屏骨架。
    各页的数据都是 onMounted 里异步拉的，直接从「DOM 已挂载但数据还没到」
    渲染出去，就会先闪一下空态（「暂无数据」）再出现真实列表。
    在 ready 之前用本组件占位，视觉上只闪一次骨架，不再跳空态。
  -->
  <div class="ui-skeleton" :style="{ minHeight: `${rows * 26 + 20}px` }" aria-hidden="true">
    <i v-for="n in rows" :key="n" class="ui-skeleton-row" />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 6 })
</script>
