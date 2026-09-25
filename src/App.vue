<template>
  <!-- 应用初始化中：只显示品牌启动页，不渲染任何页面。
       V2.1-2.32：这里必须等「第一次导航确认」再放行——原来 onMounted 立即放行，
       首次导航未确认时 route.meta 是空的，会先渲染 AppLayout 空壳
       （手机端表现为「先跳到主页」闪一下），守卫确认未登录后才跳登录页；
       重进系统时同理先闪一层空壳再出内容，就是老板说的「闪屏」。
       之前拆掉这道的原因是怕 isReady 多等一轮白屏——现在保留挡板但换成品牌启动页，
       观感是「启动页→直接进页面」，不再有空壳闪跳；并配 8 秒绝对兜底防卡死。 -->
  <div v-if="!appReady" class="app-loading">
    <div class="app-logo">🏠</div>
    <p class="loading-text">{{ slowNetwork ? '网络较慢，正在加载…' : '加载中...' }}</p>
    <div class="loading-spinner"></div>
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
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from './components/AppLayout.vue'

const route = useRoute()
const router = useRouter()
const appReady = ref(false)
const slowNetwork = ref(false)
let slowTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  // 第一次导航确认（含守卫 restoreSession 与登录页/工作台 chunk 加载）后才放行。
  // restoreSession 走本地快照分支是快路径；慢的是懒加载 chunk，弱网下交给启动页兜住。
  router.isReady()
    .catch(() => { /* chunk 加载失败等也要放行，避免卡死在启动页 */ })
    .finally(() => { appReady.value = true })
  // 绝对兜底：万一 isReady 因未知原因长期不 resolve，8 秒后强制放行
  slowTimer = setTimeout(() => { appReady.value = true }, 8000)
  // 3 秒还没好就提示网络慢（正常情况永远看不到这行字）
  setTimeout(() => { if (!appReady.value) slowNetwork.value = true }, 3000)
})
onBeforeUnmount(() => { if (slowTimer) clearTimeout(slowTimer) })

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
.app-logo {
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 4px 20px rgba(26, 54, 93, 0.12);
  margin-bottom: 20px;
}
.loading-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #e2e8f0;
  border-top-color: var(--c-primary, #1a365d);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
.loading-text {
  margin: 0 0 14px;
  color: #64748b;
  font-size: 14px;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
