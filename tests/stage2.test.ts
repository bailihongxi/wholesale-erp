import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import LoginView from '../src/views/auth/LoginView.vue'
import { useUserStore } from '../src/stores/user'

function setWidth(w: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w })
}

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/login', component: { template: '<div>login</div>' } },
    { path: '/boss/home', component: { template: '<div>boss</div>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div>catch</div>' } }
  ]
})

describe('阶段2：登录页重写', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    localStorage.clear()
    await testRouter.push('/login')
    await testRouter.isReady()
  })

  it('2.1 渲染系统名称、副标题、手机号/密码输入与登录按钮', () => {
    setWidth(1280)
    const wrapper = mount(LoginView, { global: { plugins: [testRouter] } })
    const text = wrapper.text()
    expect(text).toContain('家电批发ERP')
    expect(wrapper.find('input[type="text"]').exists()).toBe(true)
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    expect(wrapper.find('.login-btn').text()).toContain('登')
    // 第十八轮：登录页不再暴露任何账号密码（防共用电脑冒用），断言「不含凭证」
    expect(text).not.toContain('13800000000')
    expect(text).not.toContain('admin123')
  })

  it('2.2 电脑端为左右分栏，含左侧品牌介绍区', () => {
    setWidth(1280)
    const wrapper = mount(LoginView, { global: { plugins: [testRouter] } })
    expect(wrapper.find('.login-page.is-desktop').exists()).toBe(true)
    expect(wrapper.find('.brand-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain('全流程管理')
  })

  it('2.3 手机端为上下布局，含渐变头部与头像', () => {
    setWidth(400)
    const wrapper = mount(LoginView, { global: { plugins: [testRouter] } })
    expect(wrapper.find('.login-page.is-mobile').exists()).toBe(true)
    expect(wrapper.find('.mobile-header').exists()).toBe(true)
    expect(wrapper.find('.avatar').exists()).toBe(true)
    // 第十二轮起登录页的「系统名称 + 副标题」统一成一份可在系统设置里改的配置，
    // 手机端头部与电脑端品牌区共用同一段副标题（原来是两处写死的不同文案）。
    expect(wrapper.text()).toContain('全流程管理')
  })

  it('2.4 角色自动识别：各角色登录后跳转到对应工作台', () => {
    const userStore = useUserStore()
    expect(userStore.homeRouteForRole('boss')).toBe('/boss/home')
    expect(userStore.homeRouteForRole('purchaser')).toBe('/purchase/home')
    expect(userStore.homeRouteForRole('sales')).toBe('/sales/home')
    expect(userStore.homeRouteForRole('finance')).toBe('/finance/home')
    expect(userStore.homeRouteForRole('warehouse')).toBe('/warehouse/home')
    expect(userStore.homeRouteForRole('dealer')).toBe('/sales/quotes')
  })

  it('2.5 老板登录成功后跳转到老板工作台', async () => {
    const userStore = useUserStore()
    userStore.login = vi.fn().mockResolvedValue({ ok: true, message: '登录成功' })
    userStore.currentUser = {
      id: 1, name: '老板', phone: '13800000000', password: '',
      role: 'boss', status: 'active', createdAt: ''
    }
    setWidth(1280)
    const wrapper = mount(LoginView, { global: { plugins: [testRouter] } })
    await wrapper.find('input[type="text"]').setValue('13800000000')
    await wrapper.find('input[type="password"]').setValue('admin123')
    await wrapper.find('.login-btn').trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe('/boss/home')
  })

  it('2.6 登录失败时不跳转并保留在登录页', async () => {
    const userStore = useUserStore()
    userStore.login = vi.fn().mockResolvedValue({ ok: false, message: '密码错误' })
    userStore.currentUser = null
    setWidth(1280)
    const wrapper = mount(LoginView, { global: { plugins: [testRouter] } })
    await wrapper.find('input[type="text"]').setValue('13800000000')
    await wrapper.find('input[type="password"]').setValue('wrong')
    await wrapper.find('.login-btn').trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe('/login')
  })
})
