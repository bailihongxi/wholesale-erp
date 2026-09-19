import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, nextTick } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import BossHomeView from '../src/views/boss/BossHomeView.vue'
import BossBusinessView from '../src/views/boss/BossBusinessView.vue'
import BossMineView from '../src/views/boss/BossMineView.vue'
import MobileTabBar from '../src/components/MobileTabBar.vue'
import { useProductStore } from '../src/stores/product'
import { useSalesStore } from '../src/stores/sales'
import { useUserStore } from '../src/stores/user'
import { getNav } from '../src/router/navConfig'
import { db } from '../src/db'
import router from '../src/router'

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/boss/home' },
    { path: '/boss/home', component: { template: '<div>home</div>' } },
    { path: '/boss/business', component: { template: '<div>business</div>' } },
    { path: '/boss/mine', component: { template: '<div>mine</div>' } },
    { path: '/boss/products', component: { template: '<div>p</div>' } },
    { path: '/boss/stock', component: { template: '<div>s</div>' } },
    { path: '/boss/reports', component: { template: '<div>r</div>' } },
    { path: '/purchase/orders', component: { template: '<div>po</div>' } },
    { path: '/purchase/orders/new', component: { template: '<div>pon</div>' } },
    { path: '/sales/orders', component: { template: '<div>so</div>' } },
    { path: '/sales/orders/new', component: { template: '<div>son</div>' } },
    { path: '/boss/users', component: { template: '<div>u</div>' } },
    { path: '/boss/dealers', component: { template: '<div>d</div>' } },
    { path: '/boss/settings', component: { template: '<div>set</div>' } },
    { path: '/finance/reconcile', component: { template: '<div>fin</div>' } },
    { path: '/warehouse/home', component: { template: '<div>wh</div>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div>catch</div>' } }
  ]
})

describe('阶段3：老板工作台重写', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await testRouter.push('/boss/home')
    await testRouter.isReady()
  })

  it('3.1 工作台渲染欢迎语、4个数据卡片、待办与6个快捷操作', () => {
    const wrapper = mount(BossHomeView, { global: { plugins: [testRouter] } })
    const text = wrapper.text()
    expect(text).toContain('欢迎')
    expect(text).toContain('本月销售额')
    expect(text).toContain('本月毛利')
    expect(text).toContain('应收款')
    expect(text).toContain('库存预警')
    expect(text).toContain('今日待办')
    expect(wrapper.findAll('.quick-item').length).toBe(6)
  })

  it('3.2 数据卡片显示真实汇总数据（本月销售额/毛利）', async () => {
    await db.delete()
    await db.open()
    const productStore = useProductStore()
    await productStore.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调', spec: '1.5匹', unit: '台',
      purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400, warnStock: 10, status: 'active', remark: '', extra: {}
    })
    const products = await productStore.search('')
    const product = products[0]
    const stock = await db.stock.where('productId').equals(product.id!).first()
    await db.stock.update(stock!.id!, { quantity: 100 })

    const salesStore = useSalesStore()
    await salesStore.createOrder({
      customerId: 1, salesId: 2, items: [{ product, quantity: 5 }], remark: ''
    })

    const wrapper = mount(BossHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('¥6,000')
    }, { timeout: 3000 })
    expect(wrapper.text()).toContain('¥1,000')
    await flushPromises()
  })

  it('3.3 手机端「业务」落地页覆盖老板全部业务菜单（自动同步，不再写死 4 个）', () => {
    const wrapper = mount(BossBusinessView, { global: { plugins: [testRouter] } })
    // 入口由老板侧边栏菜单生成（排除底部 Tab 自身），必须一一对应，不能漏项
    const navRoutes = getNav('boss').sidebar.map(i => i.route)
    const expected = navRoutes.filter(r => !['/boss/home', '/boss/business', '/boss/mine'].includes(r))
    expect(wrapper.findAll('.module-card').length).toBe(expected.length)
    // 经营报表已移入「财务管理」页内，这里改为校验财务管理入口
    for (const label of ['商品档案', '采购管理', '销售管理', '库存管理', '财务管理']) {
      expect(wrapper.text()).toContain(label)
    }
    // 不应把 Tab 自身当作业务入口
    expect(wrapper.text()).not.toContain('工作台')
    expect(wrapper.text()).not.toContain('我的')
  })

  it('3.4 手机端「我的」落地页含管理与分析入口', () => {
    const wrapper = mount(BossMineView, { global: { plugins: [testRouter] } })
    expect(wrapper.findAll('.entry-list li').length).toBe(5)
    expect(wrapper.text()).toContain('财务管理')
    expect(wrapper.text()).toContain('人事权限')
    expect(wrapper.text()).toContain('报表中心')
    expect(wrapper.text()).toContain('操作日志')
    expect(wrapper.text()).toContain('系统设置')
  })

  it('3.5 侧边栏 12 个菜单路由均可解析（含库存作业）', () => {
    const paths = getNav('boss').sidebar.map(i => i.route)
    expect(paths.length).toBe(12)
    expect(paths).toContain('/warehouse')
    expect(paths).toContain('/stock')
    expect(paths).toContain('/boss/audit-logs')
    for (const p of paths) {
      const resolved = router.resolve(p)
      expect(resolved.matched.length, `路由未注册: ${p}`).toBeGreaterThan(0)
    }
  })

  it('3.5b 合并后的旧路径仍可解析并重定向到统一页面', () => {
    // 旧入口保留重定向，避免收藏夹失效
    expect(router.resolve('/boss/stock').matched.length).toBeGreaterThan(0)
    expect(router.resolve('/warehouse/stock').matched[0]?.redirect).toBe('/stock')
    expect(router.resolve('/boss/dealers').matched[0]?.redirect).toBe('/customers')
    expect(router.resolve('/sales/customers').matched[0]?.redirect).toBe('/customers')
    expect(router.resolve('/finance/gross-profit').matched[0]?.redirect).toBe('/boss/reports')
  })

  it('3.6 手机底部Tab根据当前路由高亮（业务/我的切换）', async () => {
    const userStore = useUserStore()
    userStore.currentUser = {
      id: 1, name: '老板', phone: '13800000000', password: '',
      role: 'boss', status: 'active', createdAt: ''
    }
    await testRouter.push('/boss/business')
    await testRouter.isReady()
    const w1 = mount(MobileTabBar, { global: { plugins: [testRouter] } })
    const tabs1 = w1.findAll('.tab-item')
    expect(tabs1.length).toBe(3)
    expect(tabs1[1].classes()).toContain('active') // 业务

    await testRouter.push('/boss/mine')
    await testRouter.isReady()
    const w2 = mount(MobileTabBar, { global: { plugins: [testRouter] } })
    const tabs2 = w2.findAll('.tab-item')
    expect(tabs2[2].classes()).toContain('active') // 我的
  })
})
