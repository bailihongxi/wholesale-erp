import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getNav, navConfig } from '../router/navConfig'

// 侧边栏菜单自定义排序：按角色把「顺序（路由数组）」持久化到 localStorage。
// 设计要点：
// 1. 以 navConfig 的默认顺序为基准，用户保存的顺序只决定相对次序；
// 2. 后续新增的菜单自动补到末尾，已移除的菜单自动剔除，不会因版本升级错乱；
// 3. 顺序保存在响应式 ref 中，拖拽后侧边栏可立即重渲染（重渲染依赖此响应式）；
// 4. 所有 localStorage 读写都 try/catch 包裹，不可用时退化为默认顺序。

const STORAGE_PREFIX = 'erp_menu_order_'

function storageKey(role: string): string {
  return `${STORAGE_PREFIX}${role}`
}

function readSaved(role: string): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey(role))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((r): r is string => typeof r === 'string')
  } catch {
    return null
  }
}

function writeSaved(role: string, routes: string[]): void {
  try {
    localStorage.setItem(storageKey(role), JSON.stringify(routes))
  } catch {
    /* 忽略持久化异常（如隐私模式） */
  }
}

/** 预载入所有已知角色的自定义顺序，避免首次渲染时在 computed 内写入状态 */
function preloadOrders(): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const role of Object.keys(navConfig)) {
    result[role] = readSaved(role) ?? []
  }
  return result
}

export const useMenuOrderStore = defineStore('menuOrder', () => {
  /**
   * 角色 -> 自定义顺序（仅保存有效路由）。
   * 空数组表示「未自定义」，此时使用 navConfig 默认顺序。
   * 用 ref 保存是为了让侧边栏在拖拽排序后能响应式重渲染。
   */
  const orders = ref<Record<string, string[]>>(preloadOrders())

  /** navConfig 中该角色的默认顺序 */
  function defaultRoutes(role: string): string[] {
    return getNav(role).sidebar.map(i => i.route)
  }

  /** 首次访问某角色时，从 localStorage 载入其自定义顺序 */
  function ensureRole(role: string): void {
    if (role in orders.value) return
    orders.value[role] = readSaved(role) ?? []
  }

  /**
   * 取得该角色最终生效的菜单顺序：
   * 自定义过 → 自定义顺序（剔除已不存在的菜单）+ 新增菜单补末尾
   * 未自定义 → 默认顺序
   */
  function getOrder(role: string): string[] {
    ensureRole(role)
    const defaults = defaultRoutes(role)
    if (defaults.length === 0) return []
    const saved = orders.value[role]
    if (!saved || saved.length === 0) return [...defaults]
    const valid = saved.filter(r => defaults.includes(r))
    const missing = defaults.filter(r => !valid.includes(r))
    return [...valid, ...missing]
  }

  /** 是否已存在自定义顺序（以持久化数据为准） */
  function hasCustomOrder(role: string): boolean {
    return readSaved(role) !== null
  }

  /** 直接写入一套完整顺序（响应式更新 + 持久化） */
  function setOrder(role: string, routes: string[]): void {
    ensureRole(role)
    orders.value[role] = [...routes]
    writeSaved(role, routes)
  }

  /** 把第 from 项移动到第 to 位，返回移动后的顺序 */
  function moveItem(role: string, from: number, to: number): string[] {
    ensureRole(role)
    const order = getOrder(role)
    if (order.length === 0) return order
    if (from < 0 || from >= order.length) return order
    if (to < 0 || to >= order.length) return order
    if (from === to) return order
    const [moved] = order.splice(from, 1)
    order.splice(to, 0, moved)
    setOrder(role, order)
    return order
  }

  /** 恢复默认顺序 */
  function resetOrder(role: string): void {
    orders.value[role] = []
    try {
      localStorage.removeItem(storageKey(role))
    } catch {
      /* 忽略 */
    }
  }

  return { defaultRoutes, getOrder, hasCustomOrder, setOrder, moveItem, resetOrder }
})
