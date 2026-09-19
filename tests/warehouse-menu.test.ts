import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import 'fake-indexeddb/auto'
import { getNav } from '../src/router/navConfig'
import router from '../src/router'
import { useUserStore } from '../src/stores/user'

function loginAs(role: string): void {
  const u = useUserStore()
  u.currentUser = {
    id: 1, name: 'tester', phone: '1', password: '',
    role: role as any, status: 'active', createdAt: ''
  }
}

describe('库房管理接入左侧菜单栏', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    loginAs('boss')
    await router.push('/login')
    await router.isReady()
  })

  it('老板左侧菜单包含库存管理与库存作业（库房业务统一入口）', () => {
    const routes = getNav('boss').sidebar.map(i => i.route)
    // 入库验货 / 出库拣货 已统一归入「库存作业」(/warehouse)，不再各自单列
    expect(routes).not.toContain('/warehouse/inbound')
    expect(routes).not.toContain('/warehouse/outbound')
    // 库存已合并为统一的 /stock（不再单独保留「库存查询」）
    expect(routes).toContain('/stock')
    expect(routes).not.toContain('/warehouse/stock')
    // 「库存作业」是库房业务的统一入口
    expect(routes).toContain('/warehouse')
    // 库存作业下的四个子模块路由均可解析（入库验货/出库拣货/调拨/盘点）
    for (const sub of ['/warehouse/inbound', '/warehouse/outbound', '/warehouse/transfer', '/warehouse/count']) {
      expect(router.resolve(sub).matched.length, `路由未注册: ${sub}`).toBeGreaterThan(0)
    }
  })

  it('老板菜单无重复路由与重复菜单名', () => {
    const nav = getNav('boss')
    const routes = nav.sidebar.map(i => i.route)
    const labels = nav.sidebar.map(i => i.label)
    expect(new Set(routes).size).toBe(routes.length)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('财务左侧菜单包含库存管理', () => {
    const routes = getNav('finance').sidebar.map(i => i.route)
    expect(routes).toContain('/stock')
    // 毛利核算已并入经营报表，不再单列
    expect(routes).not.toContain('/finance/gross-profit')
    // 经营报表已并入「财务管理」/finance 页内（第八轮），不再单独挂在侧边栏
    expect(routes).toContain('/finance')
    expect(routes).not.toContain('/boss/reports')
  })

  it('库房左侧菜单包含库存管理', () => {
    const routes = getNav('warehouse').sidebar.map(i => i.route)
    expect(routes).toContain('/stock')
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('老板可访问入库页（守卫放行，不重定向）', async () => {
    await router.push('/warehouse/inbound')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/warehouse/inbound')
  })

  it('老板可访问库存管理页（统一路由 /stock）', async () => {
    await router.push('/stock')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/stock')
  })

  it('财务可访问库存管理页（统一路由 /stock）', async () => {
    loginAs('finance')
    await router.push('/stock')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/stock')
  })

  it('旧库存查询路径 /warehouse/stock 重定向到统一页面 /stock', async () => {
    await router.push('/warehouse/stock')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/stock')
  })

  it('旧的重复路径 /boss/dealers 重定向到统一客户管理 /customers', async () => {
    await router.push('/boss/dealers')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/customers')
  })

  it('旧的 /finance/gross-profit 重定向到经营报表（毛利已并入）', async () => {
    loginAs('finance')
    await router.push('/finance/gross-profit')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/boss/reports')
  })

  it('未授权角色（销售）访问入库页被拦截回首页', async () => {
    loginAs('sales')
    await router.push('/warehouse/inbound')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/sales/home')
  })

  it('库房角色仍可正常使用入库页', async () => {
    loginAs('warehouse')
    await router.push('/warehouse/inbound')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/warehouse/inbound')
  })
})
