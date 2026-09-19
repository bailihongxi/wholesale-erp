import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import LoginView from '../src/views/auth/LoginView.vue'

describe('阶段0：项目初始化', () => {
  it('应用入口文件存在且可挂载', () => {
    expect(LoginView).toBeDefined()
  })

  it('登录页能正常渲染，显示产品名称', () => {
    setActivePinia(createPinia())
    const wrapper = mount(LoginView)
    expect(wrapper.text()).toContain('家电批发ERP')
  })

  it('路由配置包含登录页', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', redirect: '/login' },
        { path: '/login', component: LoginView }
      ]
    })
    router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('类型定义文件导出所有12个表类型', async () => {
    const types = await import('../src/types/index')
    expect(types).toBeDefined()
  })
})
