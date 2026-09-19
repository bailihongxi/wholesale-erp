// P1：四个角色工作台从静态占位改造为真实数据看板
// 校验「待办数量与实际单据一致」「统计金额正确」「点击可跳转」
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import PurchaseHomeView from '../src/views/purchase/PurchaseHomeView.vue'
import SalesHomeView from '../src/views/sales/SalesHomeView.vue'
import FinanceHomeView from '../src/views/finance/FinanceHomeView.vue'
import WarehouseHomeView from '../src/views/warehouse/WarehouseHomeView.vue'
import { usePurchaseStore } from '../src/stores/purchase'
import { useSalesStore } from '../src/stores/sales'
import { useProductStore } from '../src/stores/product'
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
    id: 1, name: '测试', phone: '1', password: '',
    role: role as any, status: 'active', createdAt: ''
  }
}

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/purchase/home' },
    { path: '/purchase/home', component: { template: '<div>ph</div>' } },
    { path: '/purchase/orders', component: { template: '<div>po</div>' } },
    { path: '/purchase/orders/new', component: { template: '<div>pn</div>' } },
    { path: '/purchase/suppliers', component: { template: '<div>ps</div>' } },
    { path: '/sales/home', component: { template: '<div>sh</div>' } },
    { path: '/sales/orders', component: { template: '<div>so</div>' } },
    { path: '/sales/orders/new', component: { template: '<div>sn</div>' } },
    { path: '/customers', component: { template: '<div>cu</div>' } },
    { path: '/stock', component: { template: '<div>st</div>' } },
    { path: '/finance/home', component: { template: '<div>fh</div>' } },
    { path: '/finance/reconcile', component: { template: '<div>fr</div>' } },
    { path: '/boss/reports', component: { template: '<div>br</div>' } },
    { path: '/warehouse/home', component: { template: '<div>wh</div>' } },
    { path: '/warehouse/inbound', component: { template: '<div>wi</div>' } },
    { path: '/warehouse/inbound/:id', component: { template: '<div>wid</div>' } },
    { path: '/warehouse/outbound', component: { template: '<div>wo</div>' } },
    { path: '/warehouse/outbound/:id', component: { template: '<div>wod</div>' } },
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

describe('P1 角色工作台（真实数据）', () => {
  let purchaseStore: ReturnType<typeof usePurchaseStore>
  let salesStore: ReturnType<typeof useSalesStore>
  let productStore: ReturnType<typeof useProductStore>
  let financeStore: ReturnType<typeof useFinanceStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    purchaseStore = usePurchaseStore()
    salesStore = useSalesStore()
    productStore = useProductStore()
    financeStore = useFinanceStore()
    setWidth(1280)
    await testRouter.push('/purchase/home')
    await testRouter.isReady()
  })

  async function seedProduct(): Promise<Product> {
    await productStore.createProduct(productData())
    return await db.products.where('brand').equals('海尔').first() as Product
  }

  // ===== 采购工作台 =====
  it('采购工作台：待入库单数量与实际待入库单据一致', async () => {
    setRole('purchaser')
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    const p = await seedProduct()
    await purchaseStore.createOrder({ supplierId: suppliers[0].id!, purchaserId: 1, items: [{ product: p, quantity: 2 }], remark: '' })
    await purchaseStore.createOrder({ supplierId: suppliers[0].id!, purchaserId: 1, items: [{ product: p, quantity: 3 }], remark: '' })

    const wrapper = mount(PurchaseHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('海尔总代'), { timeout: 3000 })

    const pending = await purchaseStore.listPendingInbound()
    expect(pending.length).toBe(2)
    expect(wrapper.findAll('.stat-card .s-value')[0].text()).toBe('2')
    expect(wrapper.findAll('.todo-item').length).toBe(2)
  })

  it('采购工作台：入库完成后从待办消失', async () => {
    setRole('purchaser')
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    const p = await seedProduct()
    const res = await purchaseStore.createOrder({ supplierId: suppliers[0].id!, purchaserId: 1, items: [{ product: p, quantity: 2 }], remark: '' })
    await purchaseStore.inbound(res.orderId!, { [p.id!]: 2 }, 1)

    const wrapper = mount(PurchaseHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.stat-card').length).toBe(4), { timeout: 3000 })
    await vi.waitFor(() => expect(wrapper.findAll('.stat-card .s-value')[0].text()).toBe('0'), { timeout: 3000 })
    expect(wrapper.text()).toContain('暂无待入库单据')
  })

  it('采购工作台：本月采购额统计正确，且能跳转单据', async () => {
    setRole('purchaser')
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    const p = await seedProduct()
    const res = await purchaseStore.createOrder({ supplierId: suppliers[0].id!, purchaserId: 1, items: [{ product: p, quantity: 5 }], remark: '' })

    const wrapper = mount(PurchaseHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('海尔总代'), { timeout: 3000 })
    await vi.waitFor(() => expect(wrapper.findAll('.stat-card .s-value')[1].text()).toBe('¥5,000'), { timeout: 3000 })

    // 点击待办跳转到入库验货页
    await wrapper.find('.todo-item').trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe(`/warehouse/inbound/${res.orderId}`)
  })

  // ===== 销售工作台 =====
  it('销售工作台：待出库单数量与实际一致', async () => {
    setRole('sales')
    await salesStore.createCustomer({ name: '城南电器', contact: '李', phone: '138', address: '', level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: '' })
    const customers = await salesStore.listCustomers()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    await salesStore.createOrder({ customerId: customers[0].id!, salesId: 1, items: [{ product: p, quantity: 2 }], remark: '' })

    const wrapper = mount(SalesHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('城南电器'), { timeout: 3000 })

    const pending = await salesStore.listPendingOutbound()
    expect(pending.length).toBe(1)
    await vi.waitFor(() => expect(wrapper.findAll('.stat-card .s-value')[0].text()).toBe('1'), { timeout: 3000 })
    expect(wrapper.findAll('.todo-item').length).toBe(1)
  })

  it('销售工作台：出库完成后从待办消失，本月销售额与未收款正确', async () => {
    setRole('sales')
    await salesStore.createCustomer({ name: '城南电器', contact: '李', phone: '138', address: '', level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: '' })
    const customers = await salesStore.listCustomers()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const res = await salesStore.createOrder({ customerId: customers[0].id!, salesId: 1, items: [{ product: p, quantity: 2 }], remark: '' })
    await salesStore.outbound(res.orderId!, { [p.id!]: 2 }, 1)

    const wrapper = mount(SalesHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.stat-card').length).toBe(4), { timeout: 3000 })
    await vi.waitFor(() => expect(wrapper.findAll('.stat-card .s-value')[0].text()).toBe('0'), { timeout: 3000 })
    expect(wrapper.text()).toContain('暂无待出库单据')
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stat-card .s-value')[1].text()).toBe('¥2,400')
      expect(wrapper.findAll('.stat-card .s-value')[3].text()).toBe('¥2,400')
    }, { timeout: 3000 })
  })

  // ===== 财务工作台 =====
  it('财务工作台：应收/应付金额来自真实单据', async () => {
    setRole('finance')
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    await salesStore.createCustomer({ name: '城南电器', contact: '李', phone: '138', address: '', level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: '' })
    const customers = await salesStore.listCustomers()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })

    const por = await purchaseStore.createOrder({ supplierId: suppliers[0].id!, purchaserId: 1, items: [{ product: p, quantity: 3 }], remark: '' })
    const sor = await salesStore.createOrder({ customerId: customers[0].id!, salesId: 1, items: [{ product: p, quantity: 2 }], remark: '' })

    const wrapper = mount(FinanceHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('城南电器'), { timeout: 3000 })
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stat-card .s-value')[0].text()).toBe('¥2,400') // 应收
      expect(wrapper.findAll('.stat-card .s-value')[1].text()).toBe('¥3,000') // 应付
    }, { timeout: 3000 })
    // createOrder 只返回 orderId，单号需从库中取
    const po = await purchaseStore.getOrder(por.orderId!)
    const so = await salesStore.getOrder(sor.orderId!)
    expect(wrapper.text()).toContain(po!.orderNo)
    expect(wrapper.text()).toContain(so!.orderNo)
  })

  it('财务工作台：登记收款后应收金额减少', async () => {
    setRole('finance')
    await salesStore.createCustomer({ name: '城南电器', contact: '李', phone: '138', address: '', level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: '' })
    const customers = await salesStore.listCustomers()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const sor = await salesStore.createOrder({ customerId: customers[0].id!, salesId: 1, items: [{ product: p, quantity: 2 }], remark: '' })

    const before = mount(FinanceHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(before.text()).toContain('城南电器'), { timeout: 3000 })
    await vi.waitFor(() => expect(before.findAll('.stat-card .s-value')[0].text()).toBe('¥2,400'), { timeout: 3000 })

    await financeStore.recordReceive({ orderId: sor.orderId!, amount: 400, operatorId: 1, remark: '' })

    const after = mount(FinanceHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(after.text()).toContain('城南电器'), { timeout: 3000 })
    await vi.waitFor(() => expect(after.findAll('.stat-card .s-value')[0].text()).toBe('¥2,000'), { timeout: 3000 })
    // 本月已收同步统计
    await vi.waitFor(() => expect(after.findAll('.stat-card .s-value')[2].text()).toBe('¥400'), { timeout: 3000 })
  })

  it('财务工作台：全部收完之后待收款列表为空', async () => {
    setRole('finance')
    await salesStore.createCustomer({ name: '城南电器', contact: '李', phone: '138', address: '', level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: '' })
    const customers = await salesStore.listCustomers()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })
    const sor = await salesStore.createOrder({ customerId: customers[0].id!, salesId: 1, items: [{ product: p, quantity: 1 }], remark: '' })
    await financeStore.recordReceive({ orderId: sor.orderId!, amount: 1200, operatorId: 1, remark: '' })

    const wrapper = mount(FinanceHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.stat-card').length).toBe(4), { timeout: 3000 })
    await vi.waitFor(() => expect(wrapper.text()).toContain('无待收款单据'), { timeout: 3000 })
  })

  // ===== 库房工作台 =====
  it('库房工作台：待收货/待发货数量与实际一致', async () => {
    setRole('warehouse')
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    await salesStore.createCustomer({ name: '城南电器', contact: '李', phone: '138', address: '', level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: '' })
    const customers = await salesStore.listCustomers()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })

    await purchaseStore.createOrder({ supplierId: suppliers[0].id!, purchaserId: 1, items: [{ product: p, quantity: 2 }], remark: '' })
    await salesStore.createOrder({ customerId: customers[0].id!, salesId: 1, items: [{ product: p, quantity: 1 }], remark: '' })

    const wrapper = mount(WarehouseHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('城南电器'), { timeout: 3000 })
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stat-card .s-value')[0].text()).toBe('1') // 待收货
      expect(wrapper.findAll('.stat-card .s-value')[1].text()).toBe('1') // 待发货
    }, { timeout: 3000 })
  })

  it('库房工作台：今日出入库数量来自当日流水', async () => {
    setRole('warehouse')
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    await salesStore.createCustomer({ name: '城南电器', contact: '李', phone: '138', address: '', level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: '' })
    const customers = await salesStore.listCustomers()
    const p = await seedProduct()

    const por = await purchaseStore.createOrder({ supplierId: suppliers[0].id!, purchaserId: 1, items: [{ product: p, quantity: 5 }], remark: '' })
    await purchaseStore.inbound(por.orderId!, { [p.id!]: 5 }, 1)

    const sor = await salesStore.createOrder({ customerId: customers[0].id!, salesId: 1, items: [{ product: p, quantity: 2 }], remark: '' })
    await salesStore.outbound(sor.orderId!, { [p.id!]: 2 }, 1)

    const wrapper = mount(WarehouseHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.stat-card').length).toBe(4), { timeout: 3000 })
    await vi.waitFor(() => {
      expect(wrapper.findAll('.stat-card .s-value')[2].text()).toBe('5') // 今日入库
      expect(wrapper.findAll('.stat-card .s-value')[3].text()).toBe('2') // 今日出库
    }, { timeout: 3000 })
  })

  it('库房工作台：点击待办单据跳转到对应验货/拣货页', async () => {
    setRole('warehouse')
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    await salesStore.createCustomer({ name: '城南电器', contact: '李', phone: '138', address: '', level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: '' })
    const customers = await salesStore.listCustomers()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 100 })

    const por = await purchaseStore.createOrder({ supplierId: suppliers[0].id!, purchaserId: 1, items: [{ product: p, quantity: 2 }], remark: '' })
    const sor = await salesStore.createOrder({ customerId: customers[0].id!, salesId: 1, items: [{ product: p, quantity: 1 }], remark: '' })

    const wrapper = mount(WarehouseHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.todo-item').length).toBe(2), { timeout: 3000 })

    const blocks = wrapper.findAll('.block')
    // 第一个 block 是待收货
    await blocks[0].find('.todo-item').trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe(`/warehouse/inbound/${por.orderId}`)

    await testRouter.push('/warehouse/home')
    await flushPromises()
    // 第二个 block 是待发货
    await blocks[1].find('.todo-item').trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe(`/warehouse/outbound/${sor.orderId}`)
  })

  it('四个工作台都不再是静态占位：均有真实统计卡与内容', async () => {
    const cases = [
      { comp: PurchaseHomeView, role: 'purchaser', title: '采购工作台' },
      { comp: SalesHomeView, role: 'sales', title: '销售工作台' },
      { comp: FinanceHomeView, role: 'finance', title: '财务工作台' },
      { comp: WarehouseHomeView, role: 'warehouse', title: '库房工作台' }
    ]
    for (const c of cases) {
      setRole(c.role)
      const wrapper = mount(c.comp, { global: { plugins: [testRouter] } })
      await vi.waitFor(() => expect(wrapper.findAll('.stat-card').length).toBe(4), { timeout: 3000 })
      expect(wrapper.text(), `${c.title} 缺少标题`).toContain(c.title)
      expect(wrapper.findAll('.block').length, `${c.title} 缺少内容区块`).toBeGreaterThan(0)
      expect(wrapper.findAll('.quick-btn').length, `${c.title} 缺少快捷操作`).toBeGreaterThan(0)
    }
  })
})
