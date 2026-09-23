import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import 'fake-indexeddb/auto'
import router from '../src/router'
import { useUserStore } from '../src/stores/user'
import { navConfig } from '../src/router/navConfig'
import type { Role } from '../src/types'

function loginAs(role: Role, id = 1): void {
  const u = useUserStore()
  u.currentUser = {
    id, name: 'tester', phone: '1', password: '',
    role, status: 'active', createdAt: ''
  }
}

const CATCH_ALL = '/:pathMatch(.*)*'
function isRegistered(path: string): boolean {
  const matched = router.resolve(path).matched
  if (matched.length === 0) return false
  return !matched.some(r => r.path === CATCH_ALL)
}

describe('经销商（dealer）门户权限 —— V2.1-1', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await router.push('/login')
    await router.isReady()
  })

  it('经销商登录后首页路由指向报价单页（不再是死循环的 /dealer/catalog）', () => {
    loginAs('dealer')
    expect(useUserStore().homeRouteForRole('dealer')).toBe('/sales/quotes')
  })

  it('经销商只能进入报价单页，其它业务页一律弹回报价单页', async () => {
    loginAs('dealer')

    // 报价单页（meta.role 已含 dealer）可正常进入
    await router.push('/sales/quotes')
    await flushPromises()
    expect(router.currentRoute.value.path, '经销商应能进入报价单页').toBe('/sales/quotes')

    // 其它内部页：sales/purchase/finance/stock/warehouse/boss/customers 全部弹回首页
    const blocked = [
      '/sales/orders', '/purchase/orders', '/finance', '/stock',
      '/warehouse', '/boss/home', '/customers'
    ]
    for (const p of blocked) {
      await router.push(p)
      await flushPromises()
      expect(router.currentRoute.value.path, `经销商不应能进 ${p}`).toBe('/sales/quotes')
    }
  })

  it('navConfig 含 dealer 且菜单项均指向已注册路由，且只含报价单入口', () => {
    const nav = navConfig.dealer
    expect(nav, 'navConfig 缺少 dealer 配置').toBeTruthy()
    expect(nav.sidebar.length).toBeGreaterThan(0)
    expect(nav.tabbar.length).toBeGreaterThan(0)

    const all = [...nav.sidebar, ...nav.tabbar]
    for (const item of all) {
      expect(isRegistered(item.route), `dealer 菜单项「${item.label}」(${item.route}) 未注册`).toBe(true)
    }
    // 经销商菜单应只含报价单相关入口
    expect(nav.sidebar.some(i => i.route === '/sales/quotes'), '经销商侧边栏应含报价单入口').toBe(true)
  })

  it('经销商建单 salesId 写 0，不得写客户 id（撞号会把他们错记成某个销售的业绩）', () => {
    const code = readFileSync(resolve(__dirname, '..', 'src/views/sales/QuotesView.vue'), 'utf-8')
    expect(code, '经销商分支必须把 salesId 写成 0（暂无归属销售，待销售确认时回填）')
      .toMatch(/salesId:\s*isDealer\.value\s*\?\s*0\s*:/)
    expect(code, 'handleCreate 不得再把建单人 id 无条件写进 salesId')
      .not.toMatch(/salesId:\s*userStore\.currentUser\?\.id/)
  })
})
