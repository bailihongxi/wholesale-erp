<template>
  <div class="landing">
    <h3 class="landing-title">我的</h3>

    <div class="user-card">
      <div class="u-avatar" :class="{ 'is-img': myAvatar.type === 'image' }">
        <img v-if="myAvatar.type === 'image'" :src="myAvatar.value" alt="" />
        <template v-else>{{ myAvatar.value || initial }}</template>
      </div>
      <div class="u-info">
        <div class="u-name">{{ userStore.currentUser?.name || '未登录' }}</div>
        <div class="u-role">{{ roleLabel }}</div>
      </div>
    </div>

    <ul class="entry-list">
      <li v-for="e in entries" :key="e.route" @click="go(e.route)">
        <span class="e-icon">{{ iconOf(e) }}</span>
        <span class="e-name">{{ e.label }}</span>
        <span class="e-arrow">›</span>
      </li>
    </ul>

    <button class="pwd-btn btn-edit" type="button" @click="pwdOpen = true">🔑 修改密码</button>
    <button class="logout-btn" type="button" @click="handleLogout">退出登录</button>

    <ChangePasswordModal v-model:open="pwdOpen" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { usePermissionStore } from '../stores/permission'
import type { NavItem } from '../router/navConfig'
import { ROLE_LABELS } from '../router/navConfig'
import { useBrand } from '../utils/brand'
import ChangePasswordModal from '../components/ChangePasswordModal.vue'

const router = useRouter()
const userStore = useUserStore()
const permStore = usePermissionStore()

const pwdOpen = ref(false)

// 角色头像与快捷图标都可以在系统设置里自定义
const { iconOf, roleAvatar } = useBrand()
const myAvatar = computed(() => roleAvatar(userStore.role))

const initial = computed(() => (userStore.currentUser?.name ?? '?').slice(0, 1))
const roleLabel = computed(() => ROLE_LABELS[userStore.role ?? ''] ?? '-')

// 载入角色权限，保证「我的」与侧边栏看到一致的功能清单
onMounted(() => { void permStore.ensure() })

/**
 * 手机端「我的」入口直接取自该角色有权限的模块，
 * 避免两处各写一份导致菜单调整后手机端不同步。
 */
const entries = computed<NavItem[]>(() => permStore.sidebarOf(userStore.role ?? ''))

function go(p: string): void {
  router.push(p)
}

function handleLogout(): void {
  userStore.logout()
  router.push('/login')
}
</script>

<style scoped>
.landing { max-width: 720px; margin: 0 auto; }

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
  overflow: hidden;
}
.u-avatar.is-img { background: #fff; }
.u-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
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
  display: flex; align-items: center; gap: 14px;
  padding: 15px 18px;
  border-bottom: 1px solid #f0f3f8;
  cursor: pointer;
  min-height: 52px;
  transition: background .15s ease;
}
.entry-list li:last-child { border-bottom: none; }
.entry-list li:active { background: var(--c-accent-soft); }
.e-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: var(--r-sm);
  background: var(--c-primary-soft);
  font-size: 16px; flex: none;
}
.e-name { flex: 1; color: var(--c-primary); font-size: 15px; font-weight: 500; }
.e-arrow { color: var(--c-muted); font-size: 20px; }

.logout-btn {
  width: 100%; margin-top: var(--sp-4); height: 46px;
  border: 1px solid #fca5a5;
  background: #fff; color: #dc2626;
  border-radius: var(--r-md);
  font-size: 15px; font-weight: 600; cursor: pointer;
  transition: background .15s ease;
}
.logout-btn:active { background: #fef2f2; }

/* 自助改密入口：员工过去只能找老板改密码，这里补上 */
.pwd-btn {
  width: 100%; margin-top: var(--sp-5); height: 46px;
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface); color: var(--c-primary);
  border-radius: var(--r-md);
  font-size: 15px; font-weight: 600; cursor: pointer;
  transition: background .15s ease;
}
.pwd-btn:active { background: var(--c-primary-soft); }
</style>
