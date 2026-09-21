<template>
  <nav class="mobile-tabbar">
    <router-link
      v-for="item in tabs"
      :key="item.route"
      :to="item.route"
      class="tab-item"
      active-class="active"
    >
      <span class="tab-icon">{{ iconOf(item) }}</span>
      <span class="tab-label">{{ item.label }}</span>
    </router-link>
  </nav>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useUserStore } from '../stores/user'
import { usePermissionStore } from '../stores/permission'
import { getNav, type NavItem } from '../router/navConfig'
import { useBrand } from '../utils/brand'

const { iconOf } = useBrand()

const userStore = useUserStore()
const permStore = usePermissionStore()

onMounted(() => { void permStore.ensure() })

// 底部 Tab 也受角色权限约束：被关掉的模块不会出现在手机上。
// 若默认 Tab 全部被关掉，退化为「该角色可见模块的前 3 个」，避免底部空空如也。
const tabs = computed<NavItem[]>(() => {
  const role = userStore.role as string
  const defaults = getNav(role).tabbar
  const kept = defaults.filter(i => permStore.canAccess(role, i.route))
  if (kept.length) return kept
  return permStore.sidebarOf(role).slice(0, 3)
})
</script>

<style scoped>
.mobile-tabbar {
  display: flex;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 58px;
  padding-bottom: env(safe-area-inset-bottom);
  /* 底栏原来用 backdrop-filter: blur(8px) 做毛玻璃。但它固定在屏幕底部、
     横跨整个视口，手机滚动时浏览器要**每帧**重算背后内容的模糊 —— 掉帧、
     发热都从这里来。而它的底色本来就是 96% 白，模糊肉眼几乎看不出来，
     换成纯白视觉无差别，滚动立刻顺滑。 */
  background: #fff;
  border-top: 1px solid var(--c-border);
  box-shadow: 0 -2px 12px rgba(16, 32, 60, .05);
  z-index: 50;
}
.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--c-muted);
  text-decoration: none;
  font-size: 11px;
  min-height: 44px;
  position: relative;
  transition: color .15s ease;
}
/* 选中态：顶部一条指示条 + 图标微放大 */
.tab-item.active { color: var(--c-accent); font-weight: 600; }
.tab-item.active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 26px;
  height: 3px;
  border-radius: 0 0 3px 3px;
  background: var(--c-accent);
}
.tab-icon {
  font-size: 20px;
  line-height: 1;
  transition: transform .15s ease;
}
.tab-item.active .tab-icon { transform: translateY(-1px) scale(1.08); }
</style>
