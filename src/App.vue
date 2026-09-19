<template>
  <AppLayout v-if="!isPlainRoute">
    <router-view />
  </AppLayout>
  <router-view v-else />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from './components/AppLayout.vue'

const route = useRoute()
// 登录页与经销商目录页使用独立全屏布局，不套用 App 外壳
const isPlainRoute = computed(() => {
  const l = route.meta.layout
  return l === 'auth' || l === 'plain'
})
</script>

<!--
  全站设计令牌、基础重置、通用组件类与表格规范统一放在 styles/theme.css，
  由 main.ts 全局引入（此前写在本文件的 <style> 里，已收敛以免两套样式打架）。
-->

