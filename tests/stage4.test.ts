import { describe, it, expect, beforeEach } from 'vitest'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import ProductListView from '../src/views/boss/ProductListView.vue'
import ProductEditView from '../src/views/boss/ProductEditView.vue'
import { useProductStore } from '../src/stores/product'
import { useUserStore } from '../src/stores/user'
import { db } from '../src/db'
import type { Product } from '../src/types'

function setWidth(w: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w })
}

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/boss/products' },
    { path: '/boss/products', component: { template: '<div>list</div>' } },
    { path: '/boss/products/new', component: { template: '<div>new</div>' } },
    { path: '/boss/products/edit/:id', component: ProductEditView }
  ]
})

function setRole(role: string): void {
  const u = useUserStore()
  u.currentUser = {
    id: 1, name: 'tester', phone: '1', password: '',
    role: role as any, status: 'active', createdAt: ''
  }
}

async function seed(over: Partial<Product> = {}): Promise<Product> {
  const ps = useProductStore()
  await ps.createProduct({
    brand: '格力', model: 'KFR-35GW', category: '空调', spec: '1.5匹', unit: '台',
    purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400, warnStock: 10,
    status: 'active', remark: '', extra: {}, ...over
  })
  const list = await ps.search('')
  return list[list.length - 1]
}

describe('阶段4：商品中心页面重写', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.delete()
    await db.open()
    await testRouter.push('/boss/products')
    await testRouter.isReady()
  })

  it('4.1 手机端商品列表为卡片，显示「品牌 型号」名称', async () => {
    setWidth(400); setRole('boss')
    await seed()
    const wrapper = mount(ProductListView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.findAll('.prod-card').length).toBe(1)
    expect(wrapper.text()).toContain('格力 KFR-35GW')
  })

  it('4.2 电脑端商品列表为表格，老板可见进价/批发价/零售价', async () => {
    setWidth(1280); setRole('boss')
    await seed()
    const wrapper = mount(ProductListView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.find('.prod-table').exists()).toBe(true)
    expect(wrapper.text()).toContain('进价')
    expect(wrapper.text()).toContain('批发价')
    expect(wrapper.text()).toContain('零售价')
  })

  it('4.3 搜索功能按关键字过滤列表', async () => {
    setWidth(400); setRole('boss')
    await seed()
    await seed({ brand: '美的', model: 'BCD-253' })
    const wrapper = mount(ProductListView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.findAll('.prod-card').length).toBe(2)
    // 搜索框已统一为 SearchInput 组件（自带清除按钮），输入其内部 .search-field
    await wrapper.find('.search-field').setValue('格力')
    await sleep(350) // 搜索防抖 250ms
    await flushPromises()
    expect(wrapper.findAll('.prod-card').length).toBe(1)
    expect(wrapper.text()).toContain('格力 KFR-35GW')
  })

  it('4.3b 搜索框在输入后显示清除按钮，点击清除恢复全部列表', async () => {
    setWidth(400); setRole('boss')
    await seed()
    await seed({ brand: '美的', model: 'BCD-253' })
    const wrapper = mount(ProductListView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.findAll('.prod-card').length).toBe(2)

    // 未输入时不显示清除按钮
    expect(wrapper.find('.clear-btn').attributes('style')).toContain('display: none')

    await wrapper.find('.search-field').setValue('格力')
    await sleep(350)
    await flushPromises()
    expect(wrapper.findAll('.prod-card').length).toBe(1)
    // 有输入内容时清除按钮出现
    expect(wrapper.find('.clear-btn').attributes('style') ?? '').not.toContain('display: none')

    await wrapper.find('.clear-btn').trigger('click')
    await sleep(350)
    await flushPromises()
    expect(wrapper.find('.search-field').element.value).toBe('')
    expect(wrapper.findAll('.prod-card').length).toBe(2)
  })

  it('4.4 库存低于预警值显示红色预警标记', async () => {
    setWidth(400); setRole('boss')
    await seed({ warnStock: 50 }) // 库存 0 <= 50
    const wrapper = mount(ProductListView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.find('.prod-card.is-warn').exists()).toBe(true)
    expect(wrapper.text()).toContain('警') // 手机端卡片简化为单字「警」
  })

  it('4.5 销售角色看不到进价，但可见批发价', async () => {
    setWidth(1280); setRole('sales')
    await seed()
    const wrapper = mount(ProductListView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('进价')
    expect(wrapper.text()).toContain('批发价')
  })

  it('4.6 库房角色看不到任何价格', async () => {
    setWidth(1280); setRole('warehouse')
    await seed()
    const wrapper = mount(ProductListView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('进价')
    expect(wrapper.text()).not.toContain('批发价')
    expect(wrapper.text()).not.toContain('零售价')
    expect(wrapper.text()).toContain('格力 KFR-35GW')
  })

  it('4.7 新增商品时名称 = 品牌 + 型号 实时预览', async () => {
    setRole('boss')
    const wrapper = mount(ProductEditView, { global: { plugins: [testRouter] } })
    await wrapper.find('input[placeholder="如：格力"]').setValue('格力')
    await wrapper.find('input[placeholder="如：KFR-35GW"]').setValue('KFR-35GW')
    expect(wrapper.text()).toContain('格力 KFR-35GW')
  })

  it('4.8 新增商品保存后列表出现该商品并跳回列表页', async () => {
    setRole('boss')
    const wrapper = mount(ProductEditView, { global: { plugins: [testRouter] } })
    await wrapper.find('input[placeholder="如：格力"]').setValue('海尔')
    await wrapper.find('input[placeholder="如：KFR-35GW"]').setValue('XQB80')
    await wrapper.find('input[placeholder="如：空调 / 冰箱"]').setValue('洗衣机')
    await wrapper.find('input[placeholder="台 / 件 / 套"]').setValue('台')
    await wrapper.find('input[placeholder="采购成本"]').setValue('800')
    await wrapper.find('input[placeholder="给经销商的价格"]').setValue('1000')
    await wrapper.find('input[placeholder="门市价"]').setValue('1200')
    await wrapper.find('input[placeholder="低于此数报警"]').setValue('5')
    await wrapper.find('.pa-confirm').trigger('click')
    await flushPromises()
    const list = await useProductStore().search('')
    expect(list.length).toBe(1)
    expect(list[0].brand).toBe('海尔')
    expect(testRouter.currentRoute.value.path).toBe('/boss/products')
  })

  it('4.9 编辑模式加载已有商品数据', async () => {
    setRole('boss')
    const p = await seed({ brand: '海尔', model: 'XQB80' })
    await testRouter.push(`/boss/products/edit/${p.id}`)
    await testRouter.isReady()
    const wrapper = mount(ProductEditView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.text()).toContain('编辑商品')
    const brandInput = wrapper.find('input[placeholder="如：格力"]').element as HTMLInputElement
    expect(brandInput.value).toBe('海尔')
  })
})
