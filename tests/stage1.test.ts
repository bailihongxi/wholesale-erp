import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { useResponsive } from '../src/composables/useResponsive'
import { useLayoutStore } from '../src/stores/layout'
import { useUserStore } from '../src/stores/user'
import AppLayout from '../src/components/AppLayout.vue'
import SideBar from '../src/components/SideBar.vue'
import MobileTabBar from '../src/components/MobileTabBar.vue'
import { getNav } from '../src/router/navConfig'

// 控制 jsdom 中的窗口宽度
function setWidth(w: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w })
}

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/boss/home' },
    { path: '/boss/home', component: { template: '<div>home</div>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div>catch</div>' } }
  ]
})

async function loginBoss(): Promise<void> {
  const userStore = useUserStore()
  userStore.currentUser = {
    id: 1, name: '老板', phone: '13800000000', password: 'admin123',
    role: 'boss', status: 'active', createdAt: ''
  }
  await testRouter.push('/boss/home')
  await testRouter.isReady()
}

describe('阶段1：全局布局框架', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ===== 响应式判断 =====
  it('1.1 窗口宽度<768px 判定为手机模式', async () => {
    const Harness = defineComponent({
      setup() { const r = useResponsive(); return { ...r } },
      template: '<div></div>'
    })
    setWidth(400)
    const wrapper = mount(Harness)
    wrapper.vm.recalculate()
    await nextTick()
    expect(wrapper.vm.isMobile).toBe(true)
    expect(wrapper.vm.isDesktop).toBe(false)
  })

  it('1.2 窗口宽度>=768px 判定为电脑模式', async () => {
    const Harness = defineComponent({
      setup() { const r = useResponsive(); return { ...r } },
      template: '<div></div>'
    })
    setWidth(1280)
    const wrapper = mount(Harness)
    wrapper.vm.recalculate()
    await nextTick()
    expect(wrapper.vm.isMobile).toBe(false)
    expect(wrapper.vm.isDesktop).toBe(true)
  })

  // ===== 侧边栏折叠持久化 =====
  it('1.3 侧边栏折叠状态可切换并持久化到 localStorage', () => {
    localStorage.removeItem('erp_sidebar_collapsed')
    const layout = useLayoutStore()
    expect(layout.sidebarCollapsed).toBe(false)
    layout.toggleSidebar()
    expect(layout.sidebarCollapsed).toBe(true)
    expect(localStorage.getItem('erp_sidebar_collapsed')).toBe('1')
    layout.toggleSidebar()
    expect(layout.sidebarCollapsed).toBe(false)
    expect(localStorage.getItem('erp_sidebar_collapsed')).toBe('0')
  })

  it('1.4 侧边栏折叠状态刷新后保持（从 localStorage 读取）', () => {
    localStorage.setItem('erp_sidebar_collapsed', '1')
    const layout = useLayoutStore()
    expect(layout.sidebarCollapsed).toBe(true)
  })

  // ===== 布局切换 =====
  it('1.5 电脑端渲染左侧导航，不渲染底部Tab', async () => {
    await loginBoss()
    setWidth(1280)
    const wrapper = mount(AppLayout, { global: { plugins: [testRouter] } })
    await nextTick()
    expect(wrapper.find('.sidebar').exists()).toBe(true)
    expect(wrapper.find('.mobile-tabbar').exists()).toBe(false)
  })

  it('1.6 手机端渲染底部Tab，不渲染左侧导航', async () => {
    await loginBoss()
    setWidth(400)
    const wrapper = mount(AppLayout, { global: { plugins: [testRouter] } })
    await nextTick()
    expect(wrapper.find('.mobile-tabbar').exists()).toBe(true)
    expect(wrapper.find('.sidebar').exists()).toBe(false)
  })

  // ===== 导航项数量 =====
  it('1.7 老板端侧边栏含 12 个模块菜单（库存作业 + 财务管理统一入口）', () => {
    const nav = getNav('boss')
    // 经营报表已归入「财务管理」页内（第八轮），侧边栏不再单列
    expect(nav.sidebar.length).toBe(12)
    const routes = nav.sidebar.map(i => i.route)
    // 入库验货 / 出库拣货 已统一归入「库存作业」(/warehouse)，不再各自单列
    expect(routes).not.toContain('/warehouse/inbound')
    expect(routes).not.toContain('/warehouse/outbound')
    expect(routes).toContain('/warehouse')
    // 库存查询已与库存管理合并为统一的 /stock
    expect(routes).toContain('/stock')
    expect(routes).not.toContain('/warehouse/stock')
    expect(routes).not.toContain('/boss/stock')
    // 去重后不应存在重复路由或重复菜单名
    expect(new Set(routes).size).toBe(routes.length)
    const labels = nav.sidebar.map(i => i.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('1.8 老板端手机底部Tab含 3 项', () => {
    const nav = getNav('boss')
    expect(nav.tabbar.length).toBe(3)
  })

  it('1.9 SideBar 渲染出老板全部 12 个菜单项（含库存作业）', async () => {
    await loginBoss()
    const wrapper = mount(SideBar, { global: { plugins: [testRouter] } })
    const items = wrapper.findAll('.menu-item')
    expect(items.length).toBe(12)
    expect(wrapper.text()).toContain('商品档案')
    expect(wrapper.text()).toContain('系统设置')
    // 入库验货 / 出库拣货 已合并为统一的「库存作业」入口
    expect(wrapper.text()).toContain('库存作业')
    expect(wrapper.text()).toContain('库存管理')
    // 操作日志为新增菜单
    expect(wrapper.text()).toContain('操作日志')
    // 合并后不再出现旧入口
    expect(wrapper.text()).not.toContain('库存查询')
    expect(wrapper.text()).not.toContain('经销商')
    expect(wrapper.text()).not.toContain('入库验货')
    expect(wrapper.text()).not.toContain('出库拣货')
  })

  it('1.10 MobileTabBar 渲染出老板 3 个底部Tab', async () => {
    await loginBoss()
    const wrapper = mount(MobileTabBar, { global: { plugins: [testRouter] } })
    const items = wrapper.findAll('.tab-item')
    expect(items.length).toBe(3)
    expect(wrapper.text()).toContain('工作台')
    expect(wrapper.text()).toContain('业务')
    expect(wrapper.text()).toContain('我的')
  })
})
