import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import 'fake-indexeddb/auto'
import { getNav, navConfig } from '../src/router/navConfig'
import router from '../src/router'
import { useUserStore } from '../src/stores/user'
import type { Role } from '../src/types'

function loginAs(role: Role): void {
  const u = useUserStore()
  u.currentUser = {
    id: 1, name: 'tester', phone: '1', password: '',
    role, status: 'active', createdAt: ''
  }
}

/** 通配兜底路由的 path，命中它说明该路径根本没注册 */
const CATCH_ALL = '/:pathMatch(.*)*'

/**
 * 校验某个路径是否已注册（而非被通配规则吃掉）。
 */
function isRegistered(path: string): boolean {
  const matched = router.resolve(path).matched
  if (matched.length === 0) return false
  return !matched.some(r => r.path === CATCH_ALL)
}

const ROLES: Role[] = ['boss', 'purchaser', 'sales', 'finance', 'warehouse']

describe('导航权限与路由可用性', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await router.push('/login')
    await router.isReady()
  })

  // 这是本次事故的核心回归点：
  // 菜单里存在的每一项，登录该角色后必须能真正停留在页面上，
  // 既不能被守卫弹回角色首页，也不能因为路由未注册而被兜底规则丢到 /login。
  for (const role of ROLES) {
    describe(`${role} 角色`, () => {
      const nav = getNav(role)
      const allItems = [
        ...nav.sidebar.map(i => ({ ...i, from: 'sidebar' })),
        ...nav.tabbar.map(i => ({ ...i, from: 'tabbar' }))
      ]

      it('菜单项指向的路由均已注册', () => {
        for (const item of allItems) {
          expect(isRegistered(item.route), `${role}/${item.from}「${item.label}」指向未注册路由 ${item.route}`).toBe(true)
        }
      })

      it('菜单项均可真正访问（不被守卫弹回、不跳登录页）', async () => {
        loginAs(role)
        const home = useUserStore().homeRouteForRole(role)

        for (const item of allItems) {
          await router.push(item.route)
          await flushPromises()
          const landed = router.currentRoute.value.path

          expect(landed, `${role}「${item.label}」(${item.route}) 被跳到登录页`).not.toBe('/login')

          // 菜单项本身就是首页时允许停在首页；其余情况停在首页即代表被守卫弹回
          if (item.route !== home) {
            expect(landed, `${role}「${item.label}」(${item.route}) 被守卫弹回首页 ${home}`).not.toBe(home)
          }
        }
      })
    })
  }

  it('老板（最高权限）可进入全部业务模块页面', async () => {
    loginAs('boss')
    const businessRoutes = [
      '/purchase/orders',
      '/purchase/suppliers',
      '/sales/orders',
      '/customers',
      '/finance/reconcile',
      '/warehouse/inbound',
      '/warehouse/outbound',
      '/stock'
    ]
    for (const p of businessRoutes) {
      await router.push(p)
      await flushPromises()
      expect(router.currentRoute.value.path, `老板无法进入 ${p}`).toBe(p)
    }
  })

  it('各角色不能越权访问其他角色的专属页', async () => {
    loginAs('sales')
    await router.push('/boss/users')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/sales/home')

    loginAs('warehouse')
    await router.push('/boss/settings')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/warehouse/home')
  })

  it('未登录访问任何业务页都会被重定向到登录页', async () => {
    useUserStore().currentUser = null
    await router.push('/boss/home')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('navConfig 中每个角色都存在且菜单不为空', () => {
    for (const role of ROLES) {
      expect(navConfig[role], `缺少角色 ${role} 的导航配置`).toBeTruthy()
      expect(navConfig[role].sidebar.length).toBeGreaterThan(0)
      expect(navConfig[role].tabbar.length).toBeGreaterThan(0)
    }
  })
})
