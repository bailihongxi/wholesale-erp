<template>
  <!-- 应用初始化中：只显示加载动画，不渲染任何页面，避免登录时闪系统界面 -->
  <div v-if="!appReady" class="app-loading">
    <div class="loading-spinner"></div>
    <p class="loading-text">加载中...</p>
  </div>

  <template v-else>
    <AppLayout v-if="!isPlainRoute">
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </AppLayout>
    <router-view v-else />
  </template>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from './components/AppLayout.vue'

const route = useRoute()
const appReady = ref(false)

// 说明：这里**不再** `await router.isReady()` 才置 appReady。
// isReady 要等第一次导航确认完成，而守卫里 restoreSession 尚未返回 →
// 等于在「路由守卫」这层 await 之外又套了一层，冷启动白屏多等一轮。
// 路由守卫本身仍然 await restoreSession（未登录时必须要等，否则会闪一下受保护页），
// 而 restoreSession 走本地快照分支时是快路径，await 几乎立即返回。
// 加载中由路由守卫的加载态与页面自身骨架屏负责，不需要根节点再挡一道。
onMounted(() => {
  appReady.value = true
})

// 登录页与经销商目录页使用独立全屏布局，不套用 App 外壳
const isPlainRoute = computed(() => {
  const l = route.meta.layout
  return l === 'auth' || l === 'plain'
})
</script>

<style scoped>
.app-loading {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  z-index: 9999;
}
.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e2e8f0;
  border-top-color: var(--c-primary, #1a365d);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
.loading-text {
  margin-top: 16px;
  color: #64748b;
  font-size: 14px;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
