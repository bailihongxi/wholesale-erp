<template>
  <header class="mobile-topnav">
    <h1 class="nav-title">{{ title }}</h1>
    <span class="nav-spacer"></span>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '../stores/user'
import { ROLE_LABELS } from '../router/navConfig'

const props = withDefaults(defineProps<{ title?: string }>(), { title: '' })
const route = useRoute()
const userStore = useUserStore()

const title = computed(() => {
  const t = props.title || (route.meta.title as string) || ''
  if (t.endsWith('工作台')) {
    if (userStore.currentUser?.system) return '管理员工作台'
    return `${ROLE_LABELS[userStore.role || ''] || '员工'}工作台`
  }
  return t
})

// 说明：返回按钮已统一移到左侧菜单栏（电脑端「家电批发ERP」之后），
// 手机端通过底部 Tab 导航返回，功能页面左上角不再放置返回按钮。
</script>

<style scoped>
.mobile-topnav {
  display: flex;
  align-items: center;
  height: 50px;
  padding: 0 12px;
  background: linear-gradient(120deg, var(--c-primary) 0%, #24508f 100%);
  color: #fff;
  position: sticky;
  top: 0;
  z-index: 40;
  box-shadow: 0 2px 10px rgba(16, 32, 60, .12);
}
.nav-title {
  flex: 1;
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: .5px;
  margin: 0;
}
.nav-spacer { width: 44px; }
</style>
