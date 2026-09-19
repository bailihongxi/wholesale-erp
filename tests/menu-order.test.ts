// 覆盖两项需求：
// 1) 侧边栏折叠/展开（回弹）按钮移入左侧菜单栏头部，位于「家电批发ERP」之后，
//    不再出现在功能页面左上角；同时移除了此前误加的「返回」按钮
// 2) 菜单栏各菜单支持用户自行拖拽排序，并持久化
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import 'fake-indexeddb/auto'
import SideBar from '../src/components/SideBar.vue'
import AppLayout from '../src/components/AppLayout.vue'
import MobileTopNav from '../src/components/MobileTopNav.vue'
import router from '../src/router'
import { useUserStore } from '../src/stores/user'
import { useLayoutStore } from '../src/stores/layout'
import { useMenuOrderStore } from '../src/stores/menuOrder'
import { getNav } from '../src/router/navConfig'

function loginAs(role: string): void {
  const u = useUserStore()
  u.currentUser = {
    id: 1, name: 'tester', phone: '1', password: '',
    role: role as any, status: 'active', createdAt: ''
  }
}

const BOSS_DEFAULT = getNav('boss').sidebar.map(i => i.route)

describe('侧边栏折叠按钮位置 + 菜单自定义排序', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    // 清掉上一用例残留的自定义顺序，保证用例独立
    for (const role of ['boss', 'purchaser', 'sales', 'finance', 'warehouse']) {
      localStorage.removeItem(`erp_menu_order_${role}`)
    }
    localStorage.removeItem('erp_sidebar_collapsed')
    loginAs('boss')
    useLayoutStore().setSidebarCollapsed(false)
    await router.push('/login')
    await router.isReady()
  })

  // ===== 需求 1：折叠（回弹）按钮的位置与行为 =====

  it('折叠按钮位于侧边栏头部，且在「家电批发ERP」文字之后', () => {
    const wrapper = mount(SideBar, { global: { plugins: [router] } })
    const header = wrapper.find('.sidebar-header')
    expect(header.exists()).toBe(true)
    expect(header.find('.collapse-btn').exists(), '折叠按钮应在菜单栏头部内').toBe(true)

    const html = header.html()
    const logoIdx = html.indexOf('家电批发ERP')
    const btnIdx = html.indexOf('collapse-btn')
    expect(logoIdx).toBeGreaterThan(-1)
    expect(btnIdx).toBeGreaterThan(logoIdx)
  })

  it('侧边栏不再有此前误加的「返回」按钮', () => {
    const wrapper = mount(SideBar, { global: { plugins: [router] } })
    expect(wrapper.find('.back-btn').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('返回')
  })

  it('功能页面左上角不再有返回/折叠按钮（手机端顶部栏）', async () => {
    await router.push('/warehouse/inbound/1')
    await flushPromises()
    const wrapper = mount(MobileTopNav, { global: { plugins: [router] } })
    expect(wrapper.find('.nav-back').exists()).toBe(false)
  })

  it('电脑端顶部栏不再有折叠按钮（已移入菜单栏）', async () => {
    const wrapper = mount(AppLayout, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('.desktop-topbar').exists(), 'jsdom 默认宽度应为电脑端布局').toBe(true)
    expect(wrapper.find('.desktop-topbar .collapse-btn').exists()).toBe(false)
  })

  it('点击折叠按钮切换侧边栏折叠状态', async () => {
    const layout = useLayoutStore()
    const toggleSpy = vi.spyOn(layout, 'toggleSidebar')
    const wrapper = mount(SideBar, { global: { plugins: [router] } })

    expect(layout.sidebarCollapsed).toBe(false)
    await wrapper.find('.collapse-btn').trigger('click')
    expect(toggleSpy).toHaveBeenCalled()
    expect(layout.sidebarCollapsed).toBe(true)

    await wrapper.find('.collapse-btn').trigger('click')
    expect(layout.sidebarCollapsed).toBe(false)
    toggleSpy.mockRestore()
  })

  it('折叠后按钮显示 ☰ 且隐藏标题文字，展开后显示 ‹', async () => {
    const layout = useLayoutStore()
    const wrapper = mount(SideBar, { global: { plugins: [router] } })

    expect(wrapper.find('.collapse-btn').text()).toBe('‹')
    // 展开时标题文字不隐藏（v-show 会写入 display 行内样式）
    expect(wrapper.find('.logo-text').attributes('style') ?? '').not.toContain('display: none')

    layout.setSidebarCollapsed(true)
    await flushPromises()
    expect(wrapper.find('.collapse-btn').text()).toBe('☰')
    expect(wrapper.find('.logo-text').attributes('style')).toContain('display: none')
  })

  // ===== 需求 2：菜单自定义排序 =====

  it('默认顺序与 navConfig 一致', () => {
    const menuOrder = useMenuOrderStore()
    expect(menuOrder.getOrder('boss')).toEqual(BOSS_DEFAULT)
    expect(menuOrder.hasCustomOrder('boss')).toBe(false)
  })

  it('moveItem 可移动菜单位置并持久化', () => {
    const menuOrder = useMenuOrderStore()
    // 把第 0 项（工作台）移到第 2 位
    const result = menuOrder.moveItem('boss', 0, 2)
    expect(result[0]).toBe(BOSS_DEFAULT[1])
    expect(result[1]).toBe(BOSS_DEFAULT[2])
    expect(result[2]).toBe(BOSS_DEFAULT[0])
    // 数量不变
    expect(result.length).toBe(BOSS_DEFAULT.length)
    // 已持久化到 localStorage
    expect(localStorage.getItem('erp_menu_order_boss')).toBeTruthy()
    expect(menuOrder.hasCustomOrder('boss')).toBe(true)
  })

  it('越界的移动不会破坏菜单数量', () => {
    const menuOrder = useMenuOrderStore()
    const before = menuOrder.getOrder('boss').length
    menuOrder.moveItem('boss', 999, 0)
    menuOrder.moveItem('boss', 0, -3)
    expect(menuOrder.getOrder('boss').length).toBe(before)
  })

  it('新增菜单自动补到末尾，已移除的菜单自动剔除', () => {
    const menuOrder = useMenuOrderStore()
    // 只保留两个菜单，并夹带一个不存在的路由
    menuOrder.setOrder('boss', [BOSS_DEFAULT[1], '/this-route-does-not-exist'])
    const order = menuOrder.getOrder('boss')
    expect(order[0]).toBe(BOSS_DEFAULT[1])
    expect(order).not.toContain('/this-route-does-not-exist')
    // 其余菜单按默认相对顺序补在后面，总数与默认一致
    expect(order.length).toBe(BOSS_DEFAULT.length)
    expect(order).toEqual([BOSS_DEFAULT[1], ...BOSS_DEFAULT.filter(r => r !== BOSS_DEFAULT[1])])
  })

  it('重置顺序后恢复 navConfig 默认顺序', () => {
    const menuOrder = useMenuOrderStore()
    menuOrder.moveItem('boss', 0, 3)
    expect(menuOrder.getOrder('boss')).not.toEqual(BOSS_DEFAULT)
    menuOrder.resetOrder('boss')
    expect(menuOrder.getOrder('boss')).toEqual(BOSS_DEFAULT)
    expect(localStorage.getItem('erp_menu_order_boss')).toBeNull()
  })

  it('拖拽菜单后侧边栏按新顺序渲染并持久化', async () => {
    const wrapper = mount(SideBar, { global: { plugins: [router] } })
    const menuOrder = useMenuOrderStore()
    await flushPromises()

    const labelsBefore = wrapper.findAll('.menu-item').map(i => i.find('.menu-label').text())
    expect(labelsBefore[0]).toBe('工作台')

    const items = wrapper.findAll('.menu-item')
    await items[0].trigger('dragstart')
    await items[2].trigger('dragover')
    await items[2].trigger('drop')
    await flushPromises()

    const labelsAfter = wrapper.findAll('.menu-item').map(i => i.find('.menu-label').text())
    expect(labelsAfter.slice(0, 3)).toEqual(['商品档案', '库存管理', '工作台'])
    expect(menuOrder.getOrder('boss').slice(0, 3)).toEqual([
      '/boss/products', '/stock', '/boss/home'
    ])
  })

  it('点击「重置菜单顺序」恢复默认顺序', async () => {
    const menuOrder = useMenuOrderStore()
    menuOrder.moveItem('boss', 0, 2)
    const wrapper = mount(SideBar, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.findAll('.menu-item')[0].find('.menu-label').text()).toBe('商品档案')

    await wrapper.find('.reset-btn').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.menu-item')[0].find('.menu-label').text()).toBe('工作台')
    expect(menuOrder.getOrder('boss')).toEqual(BOSS_DEFAULT)
  })

  it('自定义顺序按角色隔离（老板的调整不影响库房）', () => {
    const menuOrder = useMenuOrderStore()
    menuOrder.moveItem('boss', 0, 2)
    const whDefault = getNav('warehouse').sidebar.map(i => i.route)
    expect(menuOrder.getOrder('warehouse')).toEqual(whDefault)
  })
})
