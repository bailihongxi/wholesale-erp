<template>
  <aside class="sidebar" :class="{ collapsed: collapsed }">
    <div class="sidebar-header">
      <span v-show="!collapsed" class="logo-icon">ERP</span>
      <span v-show="!collapsed" class="logo-text">家电批发ERP</span>
      <!-- 折叠/展开（回弹）按钮：常驻菜单栏，紧跟在「家电批发ERP」之后，
           不再放在功能页面左上角 -->
      <button
        class="collapse-btn"
        type="button"
        :title="collapsed ? '展开菜单' : '折叠菜单'"
        :aria-label="collapsed ? '展开菜单' : '折叠菜单'"
        @click="layoutStore.toggleSidebar()"
      >
        {{ collapsed ? '☰' : '‹' }}
      </button>
    </div>
    <nav class="sidebar-nav">
      <router-link
        v-for="(item, idx) in orderedItems"
        :key="item.route"
        :to="item.route"
        class="menu-item"
        :class="{ dragging: dragIndex === idx, 'drop-target': dropIndex === idx }"
        active-class="active"
        :draggable="!collapsed"
        @dragstart="onDragStart(idx)"
        @dragover.prevent="onDragOver(idx)"
        @drop="onDrop(idx)"
        @dragend="onDragEnd"
      >
        <span class="menu-icon">{{ item.icon }}</span>
        <span v-show="!collapsed" class="menu-label">{{ item.label }}</span>
        <span v-show="!collapsed" class="drag-handle" title="按住拖拽可调整顺序">⠿</span>
      </router-link>
    </nav>
    <div v-show="!collapsed" class="sidebar-footer">
      <button class="reset-btn" type="button" @click="handleReset">↺ 重置菜单顺序</button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useUserStore } from '../stores/user'
import { useLayoutStore } from '../stores/layout'
import { useMenuOrderStore } from '../stores/menuOrder'
import { usePermissionStore } from '../stores/permission'
import type { NavItem } from '../router/navConfig'

const userStore = useUserStore()
const layoutStore = useLayoutStore()
const menuOrder = useMenuOrderStore()
const permStore = usePermissionStore()

const collapsed = computed(() => layoutStore.sidebarCollapsed)
const role = computed(() => userStore.role as string)

// 载入数据库里的角色权限（未配置时回退默认清单）
onMounted(() => { void permStore.ensure() })

/**
 * 渲染顺序：先按「角色权限」过滤出可见模块，再套用用户拖拽过的自定义顺序；
 * 权限里新增、但自定义顺序里没有的模块补在末尾。
 */
const orderedItems = computed<NavItem[]>(() => {
  const allowed = permStore.sidebarOf(role.value)
  if (!allowed.length) return []
  const order = menuOrder.getOrder(role.value)
  const byRoute = new Map(allowed.map(i => [i.route, i]))
  const picked: NavItem[] = []
  for (const r of order) {
    const item = byRoute.get(r)
    if (item) picked.push(item)
  }
  const missing = allowed.filter(i => !picked.includes(i))
  return [...picked, ...missing]
})

// ===== 拖拽排序 =====
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

function onDragStart(idx: number): void {
  dragIndex.value = idx
}

function onDragOver(idx: number): void {
  dropIndex.value = idx
}

function onDrop(idx: number): void {
  if (dragIndex.value !== null && dragIndex.value !== idx) {
    menuOrder.moveItem(role.value, dragIndex.value, idx)
  }
  dragIndex.value = null
  dropIndex.value = null
}

function onDragEnd(): void {
  dragIndex.value = null
  dropIndex.value = null
}

function handleReset(): void {
  menuOrder.resetOrder(role.value)
  dragIndex.value = null
  dropIndex.value = null
}

</script>

<style scoped>
.sidebar {
  width: 224px;
  min-width: 224px;
  height: 100vh;
  background: linear-gradient(180deg, #16325c 0%, #122a4d 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  transition: width 0.2s ease, min-width 0.2s ease;
  overflow: hidden;
  box-shadow: 1px 0 0 rgba(255, 255, 255, .06);
}
.sidebar.collapsed {
  width: 68px;
  min-width: 68px;
}

/* ===== 头部 ===== */
.sidebar-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 14px;
  font-weight: 700;
  font-size: 15px;
  border-bottom: 1px solid rgba(255, 255, 255, .08);
  white-space: nowrap;
}
.logo-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: linear-gradient(135deg, #2f6bff 0%, #1e5bef 100%);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .3px;
  flex: none;
  box-shadow: 0 2px 8px rgba(47, 107, 255, .35);
}
.logo-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: .3px;
}
/* 折叠/展开按钮紧跟标题，右对齐到头部末端 */
.collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255, 255, 255, .22);
  border-radius: 8px;
  background: rgba(255, 255, 255, .08);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  flex: none;
  transition: background .15s ease, transform .15s ease;
}
.collapse-btn:hover {
  background: rgba(255, 255, 255, .2);
  transform: scale(1.06);
}

/* ===== 菜单 ===== */
.sidebar-nav {
  flex: 1;
  padding: 10px 8px;
  overflow-y: auto;
  overflow-x: hidden;
}
.sidebar-nav::-webkit-scrollbar { width: 6px; }
.sidebar-nav::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, .14);
  border-radius: 3px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 0;
  padding: 10px 12px;
  border-radius: 9px;
  color: rgba(255, 255, 255, .72);
  text-decoration: none;
  font-size: 14px;
  white-space: nowrap;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, padding-left .15s ease;
}
.menu-item[draggable='true'] { cursor: grab; }

.menu-item:hover {
  background: rgba(255, 255, 255, .07);
  color: #fff;
}

.menu-item.active {
  background: linear-gradient(90deg, rgba(47, 107, 255, .38) 0%, rgba(47, 107, 255, .14) 100%);
  color: #fff;
  border-left-color: #2f6bff;
  font-weight: 600;
}
.menu-item.active .menu-icon { opacity: 1; }

.menu-item.dragging { opacity: .45; }
.menu-item.drop-target {
  border-left-color: #2f6bff;
  background: rgba(47, 107, 255, .16);
}

.menu-icon {
  width: 22px;
  text-align: center;
  flex: none;
  font-size: 15px;
  opacity: .9;
}
.menu-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: .2px;
}
.drag-handle {
  opacity: 0;
  color: rgba(255, 255, 255, .4);
  font-size: 12px;
  cursor: grab;
  flex: none;
  transition: opacity .15s ease;
}
.menu-item:hover .drag-handle { opacity: 1; }

/* ===== 底部 ===== */
.sidebar-footer {
  padding: 10px 12px 14px;
  border-top: 1px solid rgba(255, 255, 255, .08);
}
.reset-btn {
  width: 100%;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 8px;
  background: rgba(255, 255, 255, .06);
  color: rgba(255, 255, 255, .75);
  font-size: 12px;
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.reset-btn:hover {
  background: rgba(255, 255, 255, .14);
  color: #fff;
}
</style>
