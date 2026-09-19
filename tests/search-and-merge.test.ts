// 覆盖两项改造：
// 1) 统一搜索组件 SearchInput：全项目搜索框自带清除按钮
// 2) 菜单去重：库存管理 /stock、客户管理 /customers、经营报表（含毛利）/boss/reports
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import SearchInput from '../src/components/SearchInput.vue'
import StockManageView from '../src/views/stock/StockManageView.vue'
import CustomersView from '../src/views/sales/CustomersView.vue'
import BossReportsView from '../src/views/boss/BossReportsView.vue'
import { useProductStore } from '../src/stores/product'
import { useSalesStore } from '../src/stores/sales'
import { useFinanceStore } from '../src/stores/finance'
import { useUserStore } from '../src/stores/user'
import { db } from '../src/db'
import type { Product } from '../src/types'

function setWidth(w: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w })
}

function setRole(role: string): void {
  const u = useUserStore()
  u.currentUser = {
    id: 1, name: 'tester', phone: '1', password: '',
    role: role as any, status: 'active', createdAt: ''
  }
}

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/stock' },
    { path: '/stock', component: { template: '<div>stock</div>' } },
    { path: '/customers', component: { template: '<div>customers</div>' } },
    { path: '/boss/reports', component: { template: '<div>reports</div>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div></div>' } }
  ]
})

function productData(over: Partial<Product> = {}): Omit<Product, 'id'> {
  return {
    brand: '海尔', model: 'XQB100', category: '洗衣机', spec: '10公斤', unit: '台',
    purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1500,
    warnStock: 5, status: 'active', remark: '', extra: {},
    ...over
  }
}

describe('统一搜索组件 SearchInput', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('初始为空时不显示清除按钮', () => {
    const wrapper = mount(SearchInput, { props: { modelValue: '' } })
    expect(wrapper.find('.clear-btn').exists()).toBe(true)
    // v-show=false 会写入 display: none
    expect(wrapper.find('.clear-btn').attributes('style')).toContain('display: none')
  })

  it('输入内容后显示清除按钮', async () => {
    const wrapper = mount(SearchInput, { props: { modelValue: '' } })
    await wrapper.find('.search-field').setValue('海尔')
    await flushPromises()
    expect(wrapper.find('.clear-btn').attributes('style') ?? '').not.toContain('display: none')
  })

  it('点击清除按钮清空内容并触发 search 空串', async () => {
    const wrapper = mount(SearchInput, { props: { modelValue: '', debounce: 0 } })
    await wrapper.find('.search-field').setValue('海尔')
    await flushPromises()
    await wrapper.find('.clear-btn').trigger('click')
    await flushPromises()

    expect(wrapper.find('.search-field').element.value).toBe('')
    const searchEvents = wrapper.emitted('search')
    expect(searchEvents).toBeTruthy()
    expect(searchEvents!.at(-1)).toEqual([''])
    expect(wrapper.emitted('clear')).toBeTruthy()
    // 清除后按钮重新隐藏
    expect(wrapper.find('.clear-btn').attributes('style')).toContain('display: none')
  })

  it('按 Esc 也能清空', async () => {
    const wrapper = mount(SearchInput, { props: { modelValue: '', debounce: 0 } })
    await wrapper.find('.search-field').setValue('格力')
    await flushPromises()
    await wrapper.find('.search-field').trigger('keydown.esc')
    await flushPromises()
    expect(wrapper.find('.search-field').element.value).toBe('')
  })

  it('输入通过 update:modelValue 双向同步父组件', async () => {
    const wrapper = mount(SearchInput, { props: { modelValue: '', debounce: 0 } })
    await wrapper.find('.search-field').setValue('美的')
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual(['美的'])
  })

  it('外部把 modelValue 改回空串时，输入框同步清空', async () => {
    const wrapper = mount(SearchInput, { props: { modelValue: '海尔' } })
    expect(wrapper.find('.search-field').element.value).toBe('海尔')
    await wrapper.setProps({ modelValue: '' })
    await flushPromises()
    expect(wrapper.find('.search-field').element.value).toBe('')
  })
})

describe('库存管理页（合并后统一页面 /stock）', () => {
  let productStore: ReturnType<typeof useProductStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    productStore = useProductStore()
    setWidth(1280)
    setRole('boss')
    await testRouter.push('/stock')
    await testRouter.isReady()
  })

  async function seedProducts(): Promise<void> {
    await productStore.createProduct(productData())
    await productStore.createProduct(
      productData({ brand: '美的', model: 'BCD-253', category: '冰箱', warnStock: 5 })
    )
  }

  it('页面提供搜索框，且搜索框自带清除按钮', async () => {
    await seedProducts()
    const wrapper = mount(StockManageView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.find('.search-field').exists(), '库存管理页必须有搜索框').toBe(true)
    expect(wrapper.find('.clear-btn').exists(), '搜索框必须自带清除按钮').toBe(true)
    expect(wrapper.findAll('.stock-table tbody tr').length).toBe(2)
  })

  it('搜索关键字可过滤库存明细', async () => {
    await seedProducts()
    const wrapper = mount(StockManageView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.findAll('.stock-table tbody tr').length).toBe(2)

    await wrapper.find('.search-field').setValue('美的')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stock-table tbody tr').length).toBe(1)
    }, { timeout: 3000 })
    expect(wrapper.text()).toContain('美的 BCD-253')
    expect(wrapper.text()).not.toContain('海尔 XQB100')
  })

  it('清除搜索后恢复全部库存明细', async () => {
    await seedProducts()
    const wrapper = mount(StockManageView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await wrapper.find('.search-field').setValue('美的')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stock-table tbody tr').length).toBe(1)
    }, { timeout: 3000 })

    await wrapper.find('.clear-btn').trigger('click')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stock-table tbody tr').length).toBe(2)
    }, { timeout: 3000 })
  })

  it('支持按分类筛选', async () => {
    await seedProducts()
    const wrapper = mount(StockManageView, { global: { plugins: [testRouter] } })
    await flushPromises()
    // 分类下拉由 reload() 末尾填充（Dexie 异步），需等待就绪
    await vi.waitFor(() => {
      expect(wrapper.findAll('.toolbar-select option').length).toBeGreaterThan(1)
    }, { timeout: 3000 })

    await wrapper.find('.toolbar-select').setValue('冰箱')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stock-table tbody tr').length).toBe(1)
    }, { timeout: 3000 })
    expect(wrapper.text()).toContain('美的 BCD-253')
  })

  it('「仅看低库存」只显示达到预警线的商品', async () => {
    await seedProducts()
    // 给海尔 3 台（预警值 5）→ 低库存；美的不动（库存 0 也低于预警 5）
    const haier = await db.products.where('brand').equals('海尔').first()
    await db.stock.where('productId').equals(haier.id!).modify({ quantity: 80 })

    const wrapper = mount(StockManageView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.findAll('.stock-table tbody tr').length).toBe(2)

    await wrapper.find('.toolbar-btn').trigger('click')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stock-table tbody tr').length).toBe(1)
    }, { timeout: 3000 })
    expect(wrapper.text()).toContain('美的 BCD-253')
  })

  it('汇总数据与明细一致（SKU 数 / 库存总量 / 预警数）', async () => {
    await seedProducts()
    const haier = await db.products.where('brand').equals('海尔').first()
    await db.stock.where('productId').equals(haier.id!).modify({ quantity: 30 })

    const wrapper = mount(StockManageView, { global: { plugins: [testRouter] } })
    await flushPromises()
    // 库存数量需逐个商品异步读取，等待汇总卡片渲染完成
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stat-card').length).toBe(4)
    }, { timeout: 3000 })
    await vi.waitFor(() => {
      const v = wrapper.findAll('.stat-card .s-value').map(e => e.text())
      expect(v[1]).toBe('30')
    }, { timeout: 3000 })

    const values = wrapper.findAll('.stat-card .s-value').map(e => e.text())
    expect(values[0]).toBe('2')   // SKU 数
    expect(values[1]).toBe('30')  // 库存总量
    expect(values[3]).toBe('1')   // 预警数（美的库存 0 ≤ 5）
  })

  it('库房角色看不到任何价格列', async () => {
    setRole('warehouse')
    await seedProducts()
    const wrapper = mount(StockManageView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('批发价')
    expect(wrapper.text()).not.toContain('进价')
    expect(wrapper.text()).not.toContain('库存金额')
    expect(wrapper.text()).not.toContain('¥')
  })
})

describe('客户管理页（合并经销商后统一页面 /customers）', () => {
  let salesStore: ReturnType<typeof useSalesStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    salesStore = useSalesStore()
    setWidth(1280)
    setRole('boss')
    await testRouter.push('/customers')
    await testRouter.isReady()
  })

  async function seedCustomers(): Promise<void> {
    await salesStore.createCustomer({
      name: '城南电器', contact: '李老板', phone: '13800001111', address: '城南',
      level: 'A', creditLimit: 0, paymentTerm: '月结30天',
      loginPhone: '', loginPassword: '', status: 'active', remark: ''
    })
    await salesStore.createCustomer({
      name: '北方家电', contact: '王总', phone: '13900002222', address: '北方',
      level: 'B', creditLimit: 0, paymentTerm: '现结',
      loginPhone: '13600003333', loginPassword: 'pwd123', status: 'active', remark: ''
    })
  }

  it('页面提供带清除按钮的搜索框', async () => {
    await seedCustomers()
    const wrapper = mount(CustomersView, { global: { plugins: [testRouter] } })
    await flushPromises()
    expect(wrapper.find('.search-field').exists()).toBe(true)
    expect(wrapper.find('.clear-btn').exists()).toBe(true)
    expect(wrapper.findAll('.cust-table tbody tr').length).toBe(2)
  })

  it('搜索可按客户名称过滤', async () => {
    await seedCustomers()
    const wrapper = mount(CustomersView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await wrapper.find('.search-field').setValue('北方')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.cust-table tbody tr').length).toBe(1)
    }, { timeout: 3000 })
    expect(wrapper.text()).toContain('北方家电')
    expect(wrapper.text()).not.toContain('城南电器')
  })

  it('搜索可按联系电话过滤，清除后恢复全部', async () => {
    await seedCustomers()
    const wrapper = mount(CustomersView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await wrapper.find('.search-field').setValue('13800001111')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.cust-table tbody tr').length).toBe(1)
    }, { timeout: 3000 })

    await wrapper.find('.clear-btn').trigger('click')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.cust-table tbody tr').length).toBe(2)
    }, { timeout: 3000 })
  })

  it('经销商在同一个页面管理并显示账号徽章', async () => {
    await seedCustomers()
    const wrapper = mount(CustomersView, { global: { plugins: [testRouter] } })
    await flushPromises()
    // 经销商徽章 + 登录号展示在同一个客户列表里，不再需要单独的「经销商」菜单
    expect(wrapper.text()).toContain('经销商')
    expect(wrapper.text()).toContain('13600003333')
  })

  it('可按「仅看经销商」筛选', async () => {
    await seedCustomers()
    const wrapper = mount(CustomersView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await wrapper.find('.tb-select').setValue('dealer')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.cust-table tbody tr').length).toBe(1)
    }, { timeout: 3000 })
    expect(wrapper.text()).toContain('北方家电')
    expect(wrapper.text()).not.toContain('城南电器')
  })
})

describe('经营报表页（毛利并入 + 日期筛选）', () => {
  let salesStore: ReturnType<typeof useSalesStore>
  let financeStore: ReturnType<typeof useFinanceStore>
  let productStore: ReturnType<typeof useProductStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    salesStore = useSalesStore()
    financeStore = useFinanceStore()
    productStore = useProductStore()
    setWidth(1280)
    setRole('boss')
    await testRouter.push('/boss/reports')
    await testRouter.isReady()
  })

  it('报表页展示毛利相关指标', async () => {
    const wrapper = mount(BossReportsView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stat-card').length).toBe(6)
    }, { timeout: 3000 })
    const text = wrapper.text()
    expect(text).toContain('销售收入')
    expect(text).toContain('销售成本')
    expect(text).toContain('毛利')
    expect(text).toContain('毛利率')
    expect(text).toContain('应收未收')
    expect(text).toContain('应付未付')
  })

  it('毛利数字与 financeStore.getProfitSummary 一致', async () => {
    const r = await productStore.createProduct(productData())
    const p = await db.products.get(r ? await db.products.where('brand').equals('海尔').first().then(x => x!.id!) : 0) as Product
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 50 })
    await salesStore.createOrder({
      customerId: 1, salesId: 1,
      items: [{ product: p, quantity: 2 }], remark: ''
    })

    const wrapper = mount(BossReportsView, { global: { plugins: [testRouter] } })
    await flushPromises()
    const expected = await financeStore.getProfitSummary()
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain(`¥${expected.grossProfit.toLocaleString('zh-CN')}`)
    }, { timeout: 3000 })
  })

  it('按日期筛选：区间外无单据时收入为 0，清除筛选后恢复', async () => {
    const created = await productStore.createProduct(productData())
    const p = await db.products.where('brand').equals('海尔').first() as Product
    expect(created.ok).toBe(true)
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 50 })
    await salesStore.createOrder({ customerId: 1, salesId: 1, items: [{ product: p, quantity: 1 }], remark: '' })

    const wrapper = mount(BossReportsView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stat-card')[0].find('.s-value').text()).not.toBe('¥0')
    }, { timeout: 3000 })

    // 选一个完全空白的历史区间（起止都在 2000 年），该区间内没有任何单据
    const dates = wrapper.findAll('input[type="date"]')
    await dates[0].setValue('2000-01-01')
    await dates[1].setValue('2000-01-31')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stat-card')[0].find('.s-value').text()).toBe('¥0')
    }, { timeout: 3000 })
    expect(wrapper.find('.range-tip').text()).toContain('2000-01-01')

    // 清除筛选恢复全部数据
    await wrapper.find('.q-btn.primary').trigger('click')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stat-card')[0].find('.s-value').text()).not.toBe('¥0')
    }, { timeout: 3000 })
  })

  it('趋势图展示近 6 个月', async () => {
    const wrapper = mount(BossReportsView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.findAll('.bar-col').length).toBe(6)
    }, { timeout: 3000 })
  })
})
