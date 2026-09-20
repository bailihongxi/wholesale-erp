import { describe, it, expect, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'fs'
import { useResponsive } from '../src/composables/useResponsive'

/** 第二十四轮（V1.0-12）：手机端体验修复回归
 *  - 问题1：商品选择器手机端隐藏「型号/规格」列（与商品名重复）
 *  - 问题2/3a：手机端筛选条换行 + 页头标题去重（theme.css 规则）
 *  - 问题4：报价单批发/零售价切换
 */

function setWidth(w: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w })
}

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/sales/quotes' },
    { path: '/sales/quotes', component: { template: '<div>q</div>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div>catch</div>' } }
  ]
})

afterEach(() => {
  setWidth(1280)
  useResponsive().recalculate()
})

describe('问题1：商品选择器手机端隐藏型号/规格列', () => {
  const fakeProduct = {
    id: 1, brand: '海尔', model: 'H9', category: '空调', unit: '台', spec: '1.5匹',
    purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1500, warnStock: 1, status: 'active'
  } as any

  it('手机端（<768px）：空行 colspan = 7（showPrice 时），表头带 col-spec 钩子', async () => {
    setWidth(390)
    useResponsive().recalculate()
    const ProductPicker = (await import('../src/components/ProductPicker.vue')).default
    const wrapper = mount(ProductPicker, { props: { rows: [], showPrice: true } })
    await new Promise(r => setTimeout(r, 20))
    const td = wrapper.find('td.empty')
    expect(td.exists()).toBe(true)
    expect(td.attributes('colspan')).toBe('7')
    // 手机端隐藏钩子必须存在，CSS 才能把它藏掉
    expect(wrapper.find('th.col-spec').exists()).toBe(true)
  })

  it('手机端：数据行的型号/规格单元格带 col-spec 钩子（CSS 据此隐藏）', async () => {
    setWidth(390)
    useResponsive().recalculate()
    const ProductPicker = (await import('../src/components/ProductPicker.vue')).default
    const wrapper = mount(ProductPicker, {
      props: { rows: [{ product: fakeProduct, stock: 5 }], showPrice: true }
    })
    await new Promise(r => setTimeout(r, 20))
    expect(wrapper.find('td.col-spec').exists()).toBe(true)
  })

  it('电脑端（>=768px）：空行 colspan = 8（showPrice 时）', async () => {
    setWidth(1280)
    useResponsive().recalculate()
    const ProductPicker = (await import('../src/components/ProductPicker.vue')).default
    const wrapper = mount(ProductPicker, { props: { rows: [], showPrice: true } })
    await new Promise(r => setTimeout(r, 20))
    expect(wrapper.find('td.empty').attributes('colspan')).toBe('8')
  })
})

describe('问题2/3a：手机端筛选条换行 + 页头标题去重（theme.css）', () => {
  it('含手机端筛选条换行与 .ui-page-main 隐藏规则', () => {
    const css = readFileSync('src/styles/theme.css', 'utf-8')
    expect(css).toContain('@media (max-width: 767px)')
    expect(css).toContain('.app-layout.is-mobile :is(.toolbar, .data-toolbar, .ui-toolbar)')
    expect(css).toContain('.app-layout.is-mobile .ui-page-main { display: none; }')
  })
})

describe('问题4：报价单批发/零售价切换', () => {
  it('默认按批发价；点击零售价后节标题标签切换为「按零售价」', async () => {
    setActivePinia(createPinia())
    const QuotesView = (await import('../src/views/sales/QuotesView.vue')).default
    const wrapper = mount(QuotesView, { global: { plugins: [router] } })
    await router.isReady()
    await new Promise(r => setTimeout(r, 30))

    // 切到新建态才能看到价格类型切换
    wrapper.vm.mode = 'create'
    await wrapper.vm.$nextTick()
    await new Promise(r => setTimeout(r, 20))

    const tag = wrapper.find('.sec-title .tag')
    expect(tag.exists()).toBe(true)
    expect(tag.text()).toContain('按批发价')

    const buttons = wrapper.findAll('.mode-btn')
    expect(buttons.length).toBe(2)
    await buttons[1].trigger('click') // 第二个是「零售价」
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sec-title .tag').text()).toContain('按零售价')
  })
})
