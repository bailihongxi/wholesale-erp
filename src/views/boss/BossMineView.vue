<template>
  <div class="landing">
    <h3 class="landing-title">我的</h3>

    <div class="user-card">
      <div class="u-avatar">{{ initial }}</div>
      <div class="u-info">
        <div class="u-name">{{ userStore.currentUser?.name || '未登录' }}</div>
        <div class="u-role">{{ roleLabel }}</div>
      </div>
    </div>

    <ul class="entry-list">
      <li v-for="e in entries" :key="e.route" @click="go(e.route)">
        <span class="e-icon">{{ e.icon }}</span>
        <span class="e-name">{{ e.label }}</span>
        <span class="e-arrow">›</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../../stores/user'

const router = useRouter()
const userStore = useUserStore()

/** 手机端「我的」：管理与分析类入口 */
const entries = [
  { route: '/finance', icon: '🧾', label: '财务管理' },
  { route: '/boss/reports', icon: '📊', label: '报表中心（含毛利）' },
  { route: '/boss/users', icon: '👤', label: '人事权限' },
  { route: '/boss/audit-logs', icon: '📜', label: '操作日志' },
  { route: '/boss/settings', icon: '⚙️', label: '系统设置' }
]

const initial = computed(() => (userStore.currentUser?.name ?? '?').slice(0, 1))
const ROLE_LABELS: Record<string, string> = {
  boss: '老板', purchaser: '采购', sales: '销售',
  finance: '财务', warehouse: '库房', dealer: '经销商'
}
const roleLabel = computed(() => ROLE_LABELS[userStore.role ?? ''] ?? '-')

function go(p: string): void {
  router.push(p)
}
</script>

<style scoped>
.landing { max-width: 720px; margin: 0 auto; }
.landing-title {
  font-size: 17px; font-weight: 700; letter-spacing: .3px;
  color: var(--c-primary); margin-bottom: 14px;
}
.user-card {
  display: flex; align-items: center; gap: 14px;
  padding: 18px;
  background: linear-gradient(120deg, var(--c-primary) 0%, #24508f 100%);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-md);
  margin-bottom: var(--sp-4);
  color: #fff;
}
.u-avatar {
  width: 48px; height: 48px; border-radius: 50%;
  background: rgba(255, 255, 255, .18);
  border: 1px solid rgba(255, 255, 255, .3);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 700; flex: none;
}
.u-name { font-weight: 600; font-size: 16px; }
.u-role {
  display: inline-block; margin-top: 4px;
  padding: 1px 9px; border-radius: var(--r-pill);
  background: rgba(255, 255, 255, .16);
  font-size: 12px;
}
.entry-list {
  list-style: none;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  overflow: hidden;
  box-shadow: var(--sh-sm);
}
.entry-list li {
  display: flex; align-items: center; gap: 14px; padding: 15px 18px;
  border-bottom: 1px solid #f0f3f8; cursor: pointer; min-height: 52px;
  transition: background .15s ease;
}
.entry-list li:last-child { border-bottom: none; }
.entry-list li:active { background: var(--c-accent-soft); }
.e-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: var(--r-sm);
  background: var(--c-primary-soft); font-size: 16px; flex: none;
}
.e-name { flex: 1; color: var(--c-primary); font-size: 15px; font-weight: 500; }
.e-arrow { color: var(--c-muted); font-size: 20px; }
</style>
