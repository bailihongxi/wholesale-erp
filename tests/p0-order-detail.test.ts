// P0 补闭环验收：
// 1) 采购单 / 销售单详情页（列表「操作」按钮不再错误跳转）
// 2) 打印：调用已有 printTemplate 生成 A4 单据，可切换带/不带价格
// 3) 操作日志：关键业务动作写入 auditLogs，页面可读且可搜索
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import PurchaseOrdersView from '../src/views/purchase/PurchaseOrdersView.vue'
import PurchaseOrderDetailView from '../src/views/purchase/PurchaseOrderDetailView.vue'
import SalesOrdersView from '../src/views/sales/SalesOrdersView.vue'
import SaleOrderDetailView from '../src/views/sales/SaleOrderDetailView.vue'
import AuditLogView from '../src/views/boss/AuditLogView.vue'
import { usePurchaseStore } from '../src/stores/purchase'
import { useSalesStore } from '../src/stores/sales'
import { useProductStore } from '../src/stores/product'
import { useFinanceStore } from '../src/stores/finance'
import { useUserStore } from '../src/stores/user'
import { db } from '../src/db'
import { AUDIT_ACTIONS } from '../src/utils/audit'
import type { Product } from '../src/types'

function setWidth(w: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w })
}

function setRole(role: string): void {
  const u = useUserStore()
  u.currentUser = {
    id: 1, name: '测试员', phone: '1', password: '',
    role: role as any, status: 'active', createdAt: ''
  }
}

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/purchase/orders' },
    { path: '/purchase/orders', component: { template: '<div>list</div>' } },
    { path: '/purchase/orders/new', component: { template: '<div>new</div>' } },
    { path: '/purchase/orders/:id', component: { template: '<div>detail</div>' } },
    { path: '/sales/orders', component: { template: '<div>list</div>' } },
    { path: '/sales/orders/new', component: { template: '<div>new</div>' } },
    { path: '/sales/orders/:id', component: { template: '<div>detail</div>' } },
    { path: '/boss/audit-logs', component: { template: '<div>logs</div>' } },
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

describe('P0-1 单据详情页', () => {
  let purchaseStore: ReturnType<typeof usePurchaseStore>
  let salesStore: ReturnType<typeof useSalesStore>
  let productStore: ReturnType<typeof useProductStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    purchaseStore = usePurchaseStore()
    salesStore = useSalesStore()
    productStore = useProductStore()
    setWidth(1280)
    setRole('boss')
    await testRouter.push('/purchase/orders')
    await testRouter.isReady()
  })

  it('采购单列表「操作」按钮跳转到详情页而不是新建页', async () => {
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    await productStore.createProduct(productData())
    const p = await db.products.where('brand').equals('海尔').first() as Product
    const res = await purchaseStore.createOrder({
      supplierId: suppliers[0].id!, purchaserId: 1,
      items: [{ product: p, quantity: 3 }], remark: '测试单'
    })

    const wrapper = mount(PurchaseOrdersView, { global: { plugins: [testRouter] } })
    // 等待真实数据行（空态也会渲染一行，因此以「查看」按钮出现为准）
    await vi.waitFor(() => expect(wrapper.findAll('.link-btn').length).toBeGreaterThan(0), { timeout: 3000 })

    const btn = wrapper.find('.order-table .link-btn')
    expect(btn.text()).toBe('查看')
    await btn.trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe(`/purchase/orders/${res.orderId}`)
  })

  it('销售单列表「操作」按钮跳转到详情页而不是新建页', async () => {
    await salesStore.createCustomer({ name: '城南电器', contact: '李', phone: '138', address: '', level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: '' })
    const customers = await salesStore.listCustomers()
    await productStore.createProduct(productData())
    const p = await db.products.where('brand').equals('海尔').first() as Product
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 50 })
    const res = await salesStore.createOrder({
      customerId: customers[0].id!, salesId: 1,
      items: [{ product: p, quantity: 2 }], remark: ''
    })

    const wrapper = mount(SalesOrdersView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.findAll('.link-btn').length).toBeGreaterThan(0), { timeout: 3000 })

    const btn = wrapper.find('.order-table .link-btn')
    expect(btn.text()).toBe('查看')
    await btn.trigger('click')
    await flushPromises()
    expect(testRouter.currentRoute.value.path).toBe(`/sales/orders/${res.orderId}`)
  })

  it('采购单详情页展示单头、明细、金额与入库进度', async () => {
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张经理', phone: '139', address: '青岛', paymentTerm: '月结30天', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    await productStore.createProduct(productData())
    const p = await db.products.where('brand').equals('海尔').first() as Product
    const res = await purchaseStore.createOrder({
      supplierId: suppliers[0].id!, purchaserId: 1,
      items: [{ product: p, quantity: 4 }], remark: '加急'
    })
    await testRouter.push(`/purchase/orders/${res.orderId}`)
    await flushPromises()

    const wrapper = mount(PurchaseOrderDetailView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('海尔总代'), { timeout: 3000 })

    // 单头信息
    expect(wrapper.text()).toContain('海尔总代')
    expect(wrapper.text()).toContain('加急')
    expect(wrapper.text()).toContain('待入库')
    expect(wrapper.text()).toContain('未付款')
    // 明细与金额
    expect(wrapper.text()).toContain('海尔 XQB100')
    await vi.waitFor(() => expect(wrapper.text()).toContain('¥4,000.00'), { timeout: 3000 })
    // 入库进度：尚未入库显示 0 / 4
    await vi.waitFor(() => expect(wrapper.text()).toContain('0 / 4'), { timeout: 3000 })
  })

  it('入库后详情页进度与状态更新', async () => {
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    await productStore.createProduct(productData())
    const p = await db.products.where('brand').equals('海尔').first() as Product
    const res = await purchaseStore.createOrder({
      supplierId: suppliers[0].id!, purchaserId: 1,
      items: [{ product: p, quantity: 4 }], remark: ''
    })
    await purchaseStore.inbound(res.orderId!, { [p.id!]: 4 }, 1)

    await testRouter.push(`/purchase/orders/${res.orderId}`)
    await flushPromises()
    const wrapper = mount(PurchaseOrderDetailView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('4 / 4'), { timeout: 3000 })
    expect(wrapper.text()).toContain('已完成')
  })

  it('销售单详情页展示单头、明细、进度与收款记录', async () => {
    await salesStore.createCustomer({ name: '城南电器', contact: '李老板', phone: '138', address: '城南', level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: '' })
    const customers = await salesStore.listCustomers()
    await productStore.createProduct(productData())
    const p = await db.products.where('brand').equals('海尔').first() as Product
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 50 })
    const res = await salesStore.createOrder({
      customerId: customers[0].id!, salesId: 1, items: [{ product: p, quantity: 2 }], remark: ''
    })
    await testRouter.push(`/sales/orders/${res.orderId}`)
    await flushPromises()

    const wrapper = mount(SaleOrderDetailView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('城南电器'), { timeout: 3000 })
    expect(wrapper.text()).toContain('海尔 XQB100')
    await vi.waitFor(() => expect(wrapper.text()).toContain('¥2,400.00'), { timeout: 3000 })
    expect(wrapper.text()).toContain('尚未登记收款')
    await vi.waitFor(() => expect(wrapper.text()).toContain('0 / 2'), { timeout: 3000 })
  })
})

describe('P0-2 单据打印', () => {
  let purchaseStore: ReturnType<typeof usePurchaseStore>
  let productStore: ReturnType<typeof useProductStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    purchaseStore = usePurchaseStore()
    productStore = useProductStore()
    setWidth(1280)
    setRole('boss')
    await testRouter.push('/purchase/orders')
    await testRouter.isReady()
  })

  it('采购单详情页点击打印会先弹出预览，预览内容含单号/供应商/商品/金额', async () => {
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张经理', phone: '139', address: '青岛', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    await productStore.createProduct(productData())
    const p = await db.products.where('brand').equals('海尔').first() as Product
    const res = await purchaseStore.createOrder({
      supplierId: suppliers[0].id!, purchaserId: 1,
      items: [{ product: p, quantity: 2 }], remark: ''
    })
    await testRouter.push(`/purchase/orders/${res.orderId}`)
    await flushPromises()

    const wrapper = mount(PurchaseOrderDetailView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('海尔总代'), { timeout: 3000 })

    // 未点击前不应展示预览弹窗
    expect(wrapper.find('.pp-dialog').exists()).toBe(false)

    await wrapper.find('.btn').trigger('click')
    await flushPromises()

    // 预览弹窗打开，且带「取消」「打印」两个按钮
    expect(wrapper.find('.pp-dialog').exists()).toBe(true)
    const btnTexts = wrapper.findAll('.pp-btn').map(b => b.text())
    expect(btnTexts).toContain('取消')
    expect(btnTexts.some(t => t.includes('打印'))).toBe(true)

    const doc = wrapper.find('.pp-frame').attributes('srcdoc') ?? ''
    expect(doc).toContain('采购单')
    expect(doc).toContain('海尔总代')
    expect(doc).toContain('XQB100')
    // 打印模板金额保留两位小数并带千分位
    expect(doc).toContain('2,000.00')

    // 点「取消」关闭预览，且不应触发打印
    await wrapper.find('.pp-btn.ghost').trigger('click')
    await flushPromises()
    expect(wrapper.find('.pp-dialog').exists()).toBe(false)
  })

  it('预览页「打印含单价」开关可切换，取消后不含任何价格', async () => {
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    await productStore.createProduct(productData())
    const p = await db.products.where('brand').equals('海尔').first() as Product
    const res = await purchaseStore.createOrder({
      supplierId: suppliers[0].id!, purchaserId: 1,
      items: [{ product: p, quantity: 2 }], remark: ''
    })
    await testRouter.push(`/purchase/orders/${res.orderId}`)
    await flushPromises()

    const wrapper = mount(PurchaseOrderDetailView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('海尔总代'), { timeout: 3000 })
    await wrapper.find('.btn').trigger('click')
    await flushPromises()

    const srcDoc = (): string => wrapper.find('.pp-frame').attributes('srcdoc') ?? ''

    // 1) 默认含单价
    expect(srcDoc()).toContain('单价')
    expect(srcDoc()).toContain('1,000.00')

    // 2) 取消勾选后不含单价与金额
    await wrapper.find('.pp-toggle input').setValue(false)
    await flushPromises()
    expect(srcDoc()).not.toContain('单价')
    expect(srcDoc()).not.toContain('1,000.00')
    // 往来单位等基本信息仍保留
    expect(srcDoc()).toContain('海尔总代')
    expect(srcDoc()).toContain('XQB100')
  })
})

describe('P0-3 操作日志', () => {
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
    setRole('boss')
    await testRouter.push('/boss/audit-logs')
    await testRouter.isReady()
  })

  it('关键业务动作会写入 auditLogs', async () => {
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' }, 1)
    const suppliers = await purchaseStore.listSuppliers()
    await productStore.createProduct(productData(), 1)
    const p = await db.products.where('brand').equals('海尔').first() as Product
    const por = await purchaseStore.createOrder({
      supplierId: suppliers[0].id!, purchaserId: 1,
      items: [{ product: p, quantity: 2 }], remark: ''
    })
    await purchaseStore.inbound(por.orderId!, { [p.id!]: 2 }, 1)

    const logs = await db.auditLogs.toArray()
    const actions = logs.map(l => l.action)
    expect(actions).toContain(AUDIT_ACTIONS.SUPPLIER_CREATE)
    expect(actions).toContain(AUDIT_ACTIONS.PRODUCT_CREATE)
    expect(actions).toContain(AUDIT_ACTIONS.PURCHASE_CREATE)
    expect(actions).toContain(AUDIT_ACTIONS.PURCHASE_INBOUND)
    expect(logs.length).toBeGreaterThanOrEqual(4)
  })

  it('收款/付款登记也会写日志', async () => {
    // 采购：付款
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    await productStore.createProduct(productData())
    const p = await db.products.where('brand').equals('海尔').first() as Product
    const por = await purchaseStore.createOrder({
      supplierId: suppliers[0].id!, purchaserId: 1,
      items: [{ product: p, quantity: 1 }], remark: ''
    })
    await financeStore.recordPay({ orderId: por.orderId!, amount: 1000, operatorId: 1, remark: '' })
    expect(por.ok, por.message).toBe(true)

    // 销售：收款（销售单需先有库存）
    await salesStore.createCustomer({ name: '城南电器', contact: '李', phone: '138', address: '', level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: '' })
    const customers = await salesStore.listCustomers()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 50 })
    const sor = await salesStore.createOrder({
      customerId: customers[0].id!, salesId: 1, items: [{ product: p, quantity: 1 }], remark: ''
    })
    expect(sor.ok, sor.message).toBe(true)
    await financeStore.recordReceive({ orderId: sor.orderId!, amount: 1200, operatorId: 1, remark: '' })

    const actions = (await db.auditLogs.toArray()).map(l => l.action)
    expect(actions).toContain(AUDIT_ACTIONS.PAYMENT_PAY)
    expect(actions).toContain(AUDIT_ACTIONS.PAYMENT_RECEIVE)
  })

  it('操作日志页面可读取并展示日志', async () => {
    const r = await productStore.createProduct(productData(), 7)
    expect(r.ok).toBe(true)
    const wrapper = mount(AuditLogView, { global: { plugins: [testRouter] } })
    // 空态也会渲染一行 <tr>，因此以「真实日志内容」出现为准
    await vi.waitFor(() => expect(wrapper.text()).toContain('海尔'), { timeout: 3000 })
    expect(wrapper.text()).toContain(AUDIT_ACTIONS.PRODUCT_CREATE)
    expect(wrapper.text()).toContain('海尔 XQB100')
    // 日志页同样使用带清除按钮的统一搜索框
    expect(wrapper.find('.search-field').exists()).toBe(true)
    expect(wrapper.find('.clear-btn').exists()).toBe(true)
  })

  it('操作日志支持按动作与关键字搜索', async () => {
    await productStore.createProduct(productData(), 7)
    await salesStore.createCustomer({ name: '城南电器', contact: '李', phone: '138', address: '', level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: '' }, 7)

    const wrapper = mount(AuditLogView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('城南电器'), { timeout: 3000 })
    expect(wrapper.findAll('.log-table tbody tr').length).toBe(2)

    // 按关键字过滤
    await wrapper.find('.search-field').setValue('海尔')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('城南电器'), { timeout: 3000 })
    expect(wrapper.findAll('.log-table tbody tr').length).toBe(1)

    // 清除搜索恢复
    await wrapper.find('.clear-btn').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('城南电器'), { timeout: 3000 })

    // 按动作筛选
    await wrapper.find('.tb-select').setValue(AUDIT_ACTIONS.CUSTOMER_CREATE)
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('海尔 XQB100'), { timeout: 3000 })
    expect(wrapper.text()).toContain('城南电器')
    expect(wrapper.findAll('.log-table tbody tr').length).toBe(1)
  })
})
