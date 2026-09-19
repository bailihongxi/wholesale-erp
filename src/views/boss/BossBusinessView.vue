<template>
  <div class="landing">
    <h3 class="landing-title">业务中心</h3>
    <!-- 直接由「老板侧边栏菜单」生成：新增/调整菜单后本页自动同步，不会漏项 -->
    <div class="module-grid">
      <div
        v-for="item in entries"
        :key="item.route"
        class="module-card"
        @click="go(item.route)"
      >
        <div class="m-icon">{{ item.icon }}</div>
        <div class="m-name">{{ item.label }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMenuOrderStore } from '../../stores/menuOrder'
import { getNav } from '../../router/navConfig'

const router = useRouter()
const menuOrder = useMenuOrderStore()

/**
 * 手机端「业务」页展示老板的全部业务菜单。
 * 排除底部 Tab 自身（工作台 / 业务 / 我的），其余按用户自定义排序展示。
 */
const TAB_ROUTES = ['/boss/home', '/boss/business', '/boss/mine']

const entries = computed(() => {
  const items = getNav('boss').sidebar.filter(i => !TAB_ROUTES.includes(i.route))
  const byRoute = new Map(items.map(i => [i.route, i]))
  const sorted = menuOrder
    .getOrder('boss')
    .filter(r => byRoute.has(r))
    .map(r => byRoute.get(r)!)
  // 兜底：万一有菜单不在排序缓存里
  for (const i of items) if (!sorted.includes(i)) sorted.push(i)
  return sorted
})

function go(p: string): void {
  router.push(p)
}
</script>

<style scoped>
.landing { max-width: 1100px; margin: 0 auto; }
.landing-title {
  font-size: 17px; font-weight: 700; letter-spacing: .3px;
  color: var(--c-primary); margin-bottom: 14px;
}
.module-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.module-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 14px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-sm);
  cursor: pointer;
  text-align: center;
  transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease;
}
.module-card:active { transform: scale(.98); background: var(--c-accent-soft); }
.module-card:hover { border-color: var(--c-accent); box-shadow: var(--sh-md); }
.m-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 46px; height: 46px; border-radius: var(--r-md);
  background: var(--c-primary-soft);
  font-size: 24px;
}
.m-name { font-weight: 600; color: var(--c-primary); font-size: 14px; letter-spacing: .3px; }
@media (min-width: 768px) {
  .module-grid { grid-template-columns: repeat(4, 1fr); }
}
</style>
