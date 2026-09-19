import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import PurchaseOrdersView from '../src/views/purchase/PurchaseOrdersView.vue'
import PurchaseCreateView from '../src/views/purchase/PurchaseCreateView.vue'
import SuppliersView from '../src/views/purchase/SuppliersView.vue'
import SalesOrdersView from '../src/views/sales/SalesOrdersView.vue'
import SalesCreateView from '../src/views/sales/SalesCreateView.vue'
import CustomersView from '../src/views/sales/CustomersView.vue'
import { usePurchaseStore } from '../src/stores/purchase'
import { useSalesStore } from '../src/stores/sales'
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
    { path: '/', redirect: '/purchase/orders' },
    { path: '/purchase/orders', component: { template: '<div>po</div>' } },
    { path: '/purchase/orders/new', component: { template: '<div>new</div>' } },
    { path: '/sales/orders', component: { template: '<div>so</div>' } },
    { path: '/sales/orders/new', component: { template: '<div>new</div>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div></div>' } }
  ]
})

function setRole(role: string): void {
  const u = useUserStore()
  u.currentUser = {
    id: 1, name: 'tester', phone: '1', password: '',
    role: role as any, status: 'active', createdAt: ''
  }
}

async function waitForOrder(store: any, expectTotal: number): Promise<string> {
  let no = ''
  await vi.waitFor(async () => {
    const list = await store.listOrders()
    expect(list.length).toBe(1)
    expect(list[0].totalAmount).toBe(expectTotal)
    no = list[0].orderNo
  }, { timeout: 3000 })
  return no
}

/** 页面 onMounted 里有多段 await（供应商 + 商品 + 库存），需要多轮微任务才渲染完全 */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await flushPromises()
}

describe('阶段5：采购+销售模块重写', () => {
  let purchaseStore: ReturnType<typeof usePurchaseStore>
  let salesStore: ReturnType<typeof useSalesStore>
  let productStore: ReturnType<typeof useProductStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    // 清空所有表（不关闭数据库，避免与上一个用例的异步 DB 操作产生 DatabaseClosedError 竞争）
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
    purchaseStore = usePurchaseStore()
    salesStore = useSalesStore()
    productStore = useProductStore()
    await testRouter.push('/purchase/orders')
    await testRouter.isReady()
  })

  async function seedProduct(over: Partial<Product> = {}): Promise<Product> {
    await productStore.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调', spec: '1.5匹', unit: '台',
      purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400, warnStock: 10,
      status: 'active', remark: '', extra: {}, ...over
    })
    const list = await productStore.search('')
    return list[list.length - 1]
  }

  async function seedSupplier(name = '供应商A'): Promise<number> {
    return await purchaseStore.createSupplier({ name, contact: '王', phone: '1', address: '', paymentTerm: '月结30天', remark: '' })
  }

  async function seedCustomer(name = '客户A'): Promise<number> {
    return await salesStore.createCustomer({ name, contact: '李', phone: '2', address: '', level: 'A', creditLimit: 0, paymentTerm: '', loginPhone: '', loginPassword: '', status: 'active', remark: '' })
  }

  // ===== 采购单 =====
  it('5.1 新建采购单（电脑端）：选供应商+商品→提交→列表显示且金额=进价×数量', async () => {
    setWidth(1280); setRole('boss')
    const sid = await seedSupplier()
    const p = await seedProduct()
    const wrapper = mount(PurchaseCreateView, { global: { plugins: [testRouter] } })
    await settle()

    await wrapper.find('select.f-input').setValue(sid)
    await wrapper.findAll('.pk-add')[0].trigger('click')
    await settle()
    await wrapper.find('.pa-confirm').trigger('click')

    const no = await waitForOrder(purchaseStore, 1000) // 进价1000 × 1
    await vi.waitFor(() => expect(testRouter.currentRoute.value.path).toBe('/purchase/orders'), { timeout: 3000 })

    const listWrapper = mount(PurchaseOrdersView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(listWrapper.text()).toContain(no), { timeout: 3000 })
  })

  it('5.2 新建采购单（手机端）：移动版表单同样能提交成功', async () => {
    setWidth(400); setRole('boss')
    const sid = await seedSupplier()
    await seedProduct()
    const wrapper = mount(PurchaseCreateView, { global: { plugins: [testRouter] } })
    await settle()

    await wrapper.find('select.f-input').setValue(sid)
    await wrapper.findAll('.pk-add')[0].trigger('click')
    await settle()
    await wrapper.find('.pa-confirm').trigger('click')

    await waitForOrder(purchaseStore, 1000)
    await vi.waitFor(() => expect(testRouter.currentRoute.value.path).toBe('/purchase/orders'), { timeout: 3000 })
  })

  // ===== 销售单 =====
  it('5.3 新建销售单（电脑端）：需有库存→提交→列表显示且金额=批发价×数量', async () => {
    setWidth(1280); setRole('boss')
    const cid = await seedCustomer()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })

    const wrapper = mount(SalesCreateView, { global: { plugins: [testRouter] } })
    await settle()

    await wrapper.find('select.f-input').setValue(cid)
    await wrapper.findAll('.pk-add')[0].trigger('click')
    await settle()
    await wrapper.find('.pa-confirm').trigger('click')

    const no = await waitForOrder(salesStore, 1200) // 批发价1200 × 1
    await vi.waitFor(() => expect(testRouter.currentRoute.value.path).toBe('/sales/orders'), { timeout: 3000 })

    const listWrapper = mount(SalesOrdersView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(listWrapper.text()).toContain(no), { timeout: 3000 })
  })

  it('5.4 新建销售单（手机端）：移动版表单同样能提交成功', async () => {
    setWidth(400); setRole('boss')
    const cid = await seedCustomer()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })

    const wrapper = mount(SalesCreateView, { global: { plugins: [testRouter] } })
    await settle()

    await wrapper.find('select.f-input').setValue(cid)
    await wrapper.findAll('.pk-add')[0].trigger('click')
    await settle()
    await wrapper.find('.pa-confirm').trigger('click')

    await waitForOrder(salesStore, 1200)
    await vi.waitFor(() => expect(testRouter.currentRoute.value.path).toBe('/sales/orders'), { timeout: 3000 })
  })

  // ===== 权限隔离 =====
  it('5.5 销售选商品时看不到进价（仅显示批发价）', async () => {
    setWidth(1280); setRole('sales')
    await seedProduct()
    const wrapper = mount(SalesCreateView, { global: { plugins: [testRouter] } })
    await settle()
    await wrapper.findAll('.pk-add')[0].trigger('click')
    await settle()

    // 销售页只出现「批发价 / 零售价」两种价格口径，绝不出现进价
    expect(wrapper.text()).not.toContain('进价')
    expect(wrapper.text()).toContain('批发价')
    expect(wrapper.text()).toContain('零售价')
    expect(wrapper.text()).toContain('¥1,200')
  })

  it('5.6 权限隔离：销售在采购建单页看不到进价字段，老板可见', async () => {
    setWidth(1280); setRole('sales')
    await seedProduct()
    const salesWrapper = mount(PurchaseCreateView, { global: { plugins: [testRouter] } })
    await settle()
    await salesWrapper.findAll('.pk-add')[0].trigger('click')
    await settle()
    // 明细与商品列表的表头都不能出现进价
    const salesHeads = salesWrapper.findAll('th').map(t => t.text()).join(' ')
    expect(salesHeads).not.toContain('进价')
    expect(salesWrapper.text()).not.toContain('进价')

    setRole('boss')
    const bossWrapper = mount(PurchaseCreateView, { global: { plugins: [testRouter] } })
    await settle()
    await bossWrapper.findAll('.pk-add')[0].trigger('click')
    await settle()
    const bossHeads = bossWrapper.findAll('th').map(t => t.text()).join(' ')
    expect(bossHeads).toContain('进价')
    expect(bossWrapper.text()).toContain('¥1,000')
  })

  // ===== 供应商/客户管理 =====
  it('5.7 供应商管理：新增供应商后列表展示', async () => {
    setRole('boss')
    const wrapper = mount(SuppliersView, { global: { plugins: [testRouter] } })
    await settle()
    await wrapper.find('.add-btn').trigger('click')
    await settle()
    await wrapper.find('input[placeholder="名称 *"]').setValue('供应商B')
    await wrapper.find('.save').trigger('click')

    await vi.waitFor(async () => {
      const list = await purchaseStore.listSuppliers()
      expect(list.some(s => s.name === '供应商B')).toBe(true)
    }, { timeout: 3000 })
    await vi.waitFor(() => expect(wrapper.text()).toContain('供应商B'), { timeout: 3000 })
  })

  it('5.8 客户管理：新增客户并设为经销商→列表显示「经销商」徽章', async () => {
    setRole('boss')
    const wrapper = mount(CustomersView, { global: { plugins: [testRouter] } })
    await settle()
    await wrapper.find('.add-btn').trigger('click')
    await settle()
    await wrapper.find('input[placeholder="客户名称 *"]').setValue('客户B')
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await settle()
    await wrapper.find('input[placeholder="经销商登录手机号 *"]').setValue('13800000000')
    await wrapper.find('input[placeholder="经销商登录密码 *"]').setValue('abc123')
    await wrapper.find('.save').trigger('click')

    await vi.waitFor(async () => {
      const list = await salesStore.listCustomers()
      const c = list.find(x => x.name === '客户B')
      expect(c).toBeTruthy()
      expect(c!.loginPhone).toBe('13800000000')
    }, { timeout: 3000 })
    await vi.waitFor(() => expect(wrapper.text()).toContain('经销商'), { timeout: 3000 })
  })

  // ===== 状态筛选 =====
  it('5.9 采购单列表按状态筛选：pending 可见，completed 不可见', async () => {
    setWidth(400); setRole('boss')
    const sid = await seedSupplier()
    const p = await seedProduct()
    await purchaseStore.createOrder({ supplierId: sid, purchaserId: 1, items: [{ product: p, quantity: 1 }], remark: '' })

    const wrapper = mount(PurchaseOrdersView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.order-card').length).toBe(1), { timeout: 3000 })

    await wrapper.find('.filter').setValue('completed')
    await vi.waitFor(() => expect(wrapper.findAll('.order-card').length).toBe(0), { timeout: 3000 })
  })
})
