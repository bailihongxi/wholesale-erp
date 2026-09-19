<template>
  <div class="app-layout" :class="isMobile ? 'is-mobile' : 'is-desktop'">
    <!-- 电脑端：左侧导航 + 顶部栏 + 内容 -->
    <template v-if="isDesktop">
      <SideBar />
      <div class="main-col">
        <header class="desktop-topbar">
          <span class="topbar-title">{{ pageTitle }}</span>
          <span class="topbar-spacer"></span>
          <span class="topbar-user">
            <span class="tu-avatar">{{ userInitial }}</span>
            <span class="tu-text">
              <b>{{ userName }}</b>
              <i>{{ roleLabel }}</i>
            </span>
          </span>
          <button class="logout-btn" type="button" @click="handleLogout">退出</button>
        </header>
        <main class="content">
          <slot />
        </main>
      </div>
    </template>

    <!-- 手机端：顶部标题 + 内容 + 底部Tab -->
    <template v-else>
      <MobileTopNav />
      <main class="content with-tabbar">
        <slot />
      </main>
      <MobileTabBar />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useResponsive } from '../composables/useResponsive'
import { useUserStore } from '../stores/user'
import SideBar from './SideBar.vue'
import MobileTabBar from './MobileTabBar.vue'
import MobileTopNav from './MobileTopNav.vue'

const { isMobile, isDesktop } = useResponsive()
const userStore = useUserStore()
const route = useRoute()
const router = useRouter()

// 说明：侧边栏折叠/展开（回弹）按钮已统一移入左侧菜单栏头部，
// 紧跟在「家电批发ERP」文字之后；顶部栏与功能页面左上角都不再放置该按钮。
const pageTitle = computed(() => (route.meta.title as string) || '')
const userName = computed(() => userStore.currentUser?.name ?? '未登录')
const roleLabel = computed(() => roleName(userStore.role))
const userInitial = computed(() => (userStore.currentUser?.name ?? '?').slice(0, 1))

const roleNames: Record<string, string> = {
  boss: '老板',
  purchaser: '采购',
  sales: '销售',
  finance: '财务',
  warehouse: '库房',
  dealer: '经销商'
}
function roleName(r: string | null): string {
  return r ? roleNames[r] ?? r : ''
}

function handleLogout(): void {
  userStore.logout()
  router.push('/login')
}
</script>

<style scoped>
.app-layout {
  height: 100vh;
  display: flex;
  background: #f8fafc;
}
.main-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.desktop-topbar {
  display: flex;
  align-items: center;
  height: 58px;
  padding: 0 20px;
  background: rgba(255, 255, 255, .92);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--c-border);
  box-shadow: 0 1px 2px rgba(16, 32, 60, .04);
  gap: 14px;
}
.topbar-title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: .3px;
  color: var(--c-primary);
}
.topbar-spacer { flex: 1; }

.topbar-user {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 4px 12px 4px 4px;
  border-radius: var(--r-pill);
  background: var(--c-primary-soft);
}
.tu-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--c-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  flex: none;
}
.tu-text { display: flex; flex-direction: column; line-height: 1.25; }
.tu-text b { font-size: 13px; color: var(--c-primary); font-weight: 600; }
.tu-text i { font-size: 11px; color: var(--c-muted); font-style: normal; }

.logout-btn {
  height: 34px;
  padding: 0 14px;
  border: 1px solid #f5c2c2;
  background: #fff;
  border-radius: var(--r-sm);
  color: #dc2626;
  cursor: pointer;
  font-size: 13px;
  transition: background .15s ease;
}
.logout-btn:hover { background: #fef2f2; }

.content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.content.with-tabbar {
  padding-bottom: 76px;
}
.is-mobile .content {
  padding: 12px;
}
</style>
