import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '../db'
import {
  ALL_MODULES, ALL_MODULE_ROUTES, DEFAULT_ROLE_PERMS, MODULE_GROUPS,
  modulesOf, getNav, type NavItem, type ModuleGroup
} from '../router/navConfig'
import { writeLog, AUDIT_ACTIONS } from '../utils/audit'

/**
 * 角色权限：老板在「员工管理 → 权限配置」里用开关给每个角色分配模块，
 * 保存后该角色登录只看得到勾中的模块。
 *
 * 设计要点：
 * 1. 权限是**角色级**的（不是员工级），改一次对所有该角色员工生效；
 * 2. 未配置 / 空数组时回退到 DEFAULT_ROLE_PERMS，保证升级后菜单不会变空；
 * 3. 只保存合法路由，已下线的模块自动剔除，不会因版本升级残留脏数据；
 * 4. 权限存在数据库里，可被备份与云同步带走（不存 localStorage）；
 * 5. 老板角色不参与配置：老板恒定为全部可见（最高权限）。
 */
export const usePermissionStore = defineStore('permission', () => {
  /** role -> 已保存的模块路由；空数组表示未自定义（走默认） */
  const perms = ref<Record<string, string[]>>({})
  const loaded = ref(false)

  async function ensure(): Promise<void> {
    if (loaded.value) return
    try {
      const rows = await db.rolePerms.toArray()
      for (const r of rows) perms.value[r.role] = r.modules ?? []
    } catch {
      /* 表不可用时退化为默认权限，不阻断登录 */
    }
    loaded.value = true
  }

  /** 该角色是否已被自定义过 */
  function isCustomized(role: string): boolean {
    const saved = perms.value[role]
    return Array.isArray(saved) && saved.length > 0
  }

  /**
   * 生效的模块路由：自定义过用自定义，否则用默认。
   * 老板走默认清单（12 项常驻菜单），但路由层面恒定为全部可见（见 canAccess），
   * 这样老板侧边栏保持清爽，又不会因为权限配置把自己挡在门外。
   */
  function routesOf(role: string): string[] {
    const saved = perms.value[role]
    if (saved && saved.length) return saved.filter(r => ALL_MODULE_ROUTES.includes(r))
    return DEFAULT_ROLE_PERMS[role] ?? []
  }

  /** 生效的菜单项（响应式，侧边栏直接渲染） */
  function sidebarOf(role: string): NavItem[] {
    return modulesOf(routesOf(role))
  }

  /** 同步版：未加载完时也不会报错，返回默认权限 */
  const sidebarNow = computed(() => (role: string): NavItem[] => sidebarOf(role))

  /** 该角色能否访问某路由（供路由守卫与页面内跳转判断） */
  function canAccess(role: string | null, route: string): boolean {
    if (!role) return false
    if (role === 'boss') return true
    const routes = routesOf(role)
    if (routes.length) return routes.includes(route)
    // 经销商等「不在模块矩阵里」的角色：DEFAULT_ROLE_PERMS 没有它的条目、
    // 也不该登记为可配置模块（其权限固定、不接受老板改），
    // 可用入口完全由 navConfig 声明（报价单 / 我的），据此放行。
    // 少了这段，canAccess 对它恒为 false，底部 Tab 会丢掉「我的」只剩报价单。
    const nav = getNav(role)
    return [...nav.sidebar, ...nav.tabbar].some(i => i.route === route)
  }

  /** 保存某角色的权限；传空数组表示恢复默认 */
  async function setPerms(role: string, routes: string[], operatorId = 1): Promise<{ ok: boolean; message: string }> {
    if (role === 'boss') return { ok: false, message: '老板为最高权限，无需配置' }
    const valid = routes.filter(r => ALL_MODULE_ROUTES.includes(r))
    if (valid.length === 0) {
      return { ok: false, message: '至少保留一个模块，否则该角色登录后没有可用页面' }
    }
    await ensure()
    const existing = await db.rolePerms.where('role').equals(role).first()
    const now = new Date().toISOString()
    if (existing?.id) {
      await db.rolePerms.update(existing.id, { modules: valid, updatedAt: now })
    } else {
      await db.rolePerms.add({ role: role as never, modules: valid, updatedAt: now })
    }
    perms.value[role] = valid
    const names = modulesOf(valid).map(m => m.label).join('、')
    await writeLog(operatorId, AUDIT_ACTIONS.STOCK_ADJUST, `配置「${role}」角色权限：${names}`)
    return { ok: true, message: `已保存，该角色共 ${valid.length} 个模块` }
  }

  /** 恢复默认权限（删除自定义记录） */
  async function resetPerms(role: string, operatorId = 1): Promise<{ ok: boolean; message: string }> {
    await ensure()
    await db.rolePerms.where('role').equals(role).delete()
    perms.value[role] = []
    await writeLog(operatorId, AUDIT_ACTIONS.STOCK_ADJUST, `恢复「${role}」角色默认权限`)
    return { ok: true, message: '已恢复默认权限' }
  }

  /** 按分组返回全量模块的开关矩阵，供权限配置页渲染 */
  function matrixOf(): Array<{ group: ModuleGroup; items: NavItem[] }> {
    return MODULE_GROUPS.map(g => ({
      group: g,
      items: ALL_MODULES.filter(m => m.group === g)
    })).filter(g => g.items.length > 0)
  }

  return {
    perms, loaded,
    ensure, isCustomized, routesOf, sidebarOf, sidebarNow,
    canAccess, setPerms, resetPerms, matrixOf
  }
})
