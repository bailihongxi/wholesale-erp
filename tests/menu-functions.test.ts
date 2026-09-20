// 逐菜单运行验证：
// 1) 每个角色的每个侧边栏菜单都有已注册、可解析的页面（功能已开发/已接入）
// 2) 每个菜单对应的页面都能正常渲染（挂载不报错、产出真实内容）
// 3) 各菜单页面背后的核心功能（建档/供应商/客户/员工/采购单/销售单）真实跑通并落库
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import 'fake-indexeddb/auto'

import router from '../src/router'
import { db } from '../src/db'
import { navConfig } from '../src/router/navConfig'
import { useUserStore } from '../src/stores/user'
import { useProductStore } from '../src/stores/product'
import { usePurchaseStore } from '../src/stores/purchase'
import { useSalesStore } from '../src/stores/sales'
import { useFinanceStore } from '../src/stores/finance'
import type { Product, Supplier, Customer } from '../src/types'

// ===== 各菜单对应的页面 =====
import BossHomeView from '../src/views/boss/BossHomeView.vue'
import ProductListView from '../src/views/boss/ProductListView.vue'
import ProductEditView from '../src/views/boss/ProductEditView.vue'
import StockManageView from '../src/views/stock/StockManageView.vue'
import UsersManageView from '../src/views/boss/UsersManageView.vue'
import BossReportsView from '../src/views/boss/BossReportsView.vue'
import SettingsView from '../src/views/boss/SettingsView.vue'
import PurchaseHomeView from '../src/views/purchase/PurchaseHomeView.vue'
import PurchaseOrdersView from '../src/views/purchase/PurchaseOrdersView.vue'
import SuppliersView from '../src/views/purchase/SuppliersView.vue'
import SalesHomeView from '../src/views/sales/SalesHomeView.vue'
import SalesOrdersView from '../src/views/sales/SalesOrdersView.vue'
import CustomersView from '../src/views/sales/CustomersView.vue'
import FinanceHomeView from '../src/views/finance/FinanceHomeView.vue'
import ReconcileView from '../src/views/finance/ReconcileView.vue'
import WarehouseHomeView from '../src/views/warehouse/WarehouseHomeView.vue'

function loginAs(role: string): void {
  const u = useUserStore()
  u.currentUser = {
    id: 1, name: 'tester', phone: '1', password: '',
    role: role as any, status: 'active', createdAt: ''
  }
}

function productData(over: Partial<Product> = {}): Omit<Product, 'id'> {
  return {
    brand: '海尔', model: 'XQB100', category: '洗衣机', spec: '10公斤', unit: '台',
    purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1500,
    warnStock: 5, status: 'active', remark: '', extra: {},
    ...over
  }
}

function supplierData(over: Partial<Supplier> = {}): Omit<Supplier, 'id'> {
  return { name: '海尔总代', contact: '张经理', phone: '13900000001', address: '青岛', paymentTerm: '月结30天', remark: '', ...over }
}

function customerData(over: Partial<Customer> = {}): Omit<Customer, 'id'> {
  return {
    name: '诚信家电', contact: '李老板', phone: '13900000002', address: '临沂',
    level: '零售', creditLimit: 0, paymentTerm: '现结', status: 'active', remark: '', ...over
  }
}

describe('逐菜单功能验证', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    await router.push('/login')
    await router.isReady()
  })

  // ===== 1. 每个菜单都有已注册的页面 =====
  it('所有角色的每个侧边栏菜单都能解析到已注册页面', () => {
    let checked = 0
    for (const [role, nav] of Object.entries(navConfig)) {
      for (const item of nav.sidebar) {
        const resolved = router.resolve(item.route)
        expect(
          resolved.matched.length,
          `[${role}] 菜单「${item.label}」没有对应页面: ${item.route}`
        ).toBeGreaterThan(0)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  // ===== 2. 每个页面都能正常渲染 =====
  const VIEWS: Array<{ menu: string; comp: any; role: string }> = [
    { menu: '工作台(老板)', comp: BossHomeView, role: 'boss' },
    { menu: '商品档案', comp: ProductListView, role: 'boss' },
    { menu: '新增商品', comp: ProductEditView, role: 'boss' },
    { menu: '库存管理(合并)', comp: StockManageView, role: 'boss' },
    { menu: '员工管理', comp: UsersManageView, role: 'boss' },
    { menu: '经营报表(含毛利)', comp: BossReportsView, role: 'boss' },
    { menu: '系统设置', comp: SettingsView, role: 'boss' },
    { menu: '采购工作台', comp: PurchaseHomeView, role: 'purchaser' },
    { menu: '采购单', comp: PurchaseOrdersView, role: 'purchaser' },
    { menu: '供应商', comp: SuppliersView, role: 'purchaser' },
    { menu: '销售工作台', comp: SalesHomeView, role: 'sales' },
    { menu: '销售单', comp: SalesOrdersView, role: 'sales' },
    { menu: '客户管理(合并)', comp: CustomersView, role: 'boss' },
    { menu: '财务工作台', comp: FinanceHomeView, role: 'finance' },
    { menu: '应收应付', comp: ReconcileView, role: 'finance' },
    { menu: '库房工作台', comp: WarehouseHomeView, role: 'warehouse' },
    { menu: '库存管理', comp: StockManageView, role: 'warehouse' }
  ]

  for (const v of VIEWS) {
    it(`菜单「${v.menu}」对应页面可正常渲染`, async () => {
      loginAs(v.role)
      const errSpy = vi.spyOn(console, 'error')
      const wrapper = mount(v.comp, { global: { plugins: [router] } })
      await flushPromises()

      expect(wrapper.exists()).toBe(true)
      // 产出真实内容（不是空壳）
      expect(wrapper.findAll('*').length, `「${v.menu}」页面渲染内容为空`).toBeGreaterThan(5)
      expect(errSpy, `「${v.menu}」页面渲染报错`).not.toHaveBeenCalled()
      errSpy.mockRestore()
    })
  }

  // ===== 3. 各菜单核心功能真实跑通 =====

  it('商品档案：新增商品成功，库存初始化为 0 且可查询到', async () => {
    const productStore = useProductStore()
    const res = await productStore.createProduct(productData())
    expect(res.ok).toBe(true)

    const list = await productStore.search('')
    expect(list.some(p => p.model === 'XQB100')).toBe(true)

    const created = list.find(p => p.model === 'XQB100')!
    expect(await productStore.getStock(created.id!)).toBe(0)
  })

  it('商品档案：重复品牌+型号被拒绝', async () => {
    const productStore = useProductStore()
    await productStore.createProduct(productData())
    const dup = await productStore.createProduct(productData())
    expect(dup.ok).toBe(false)
  })

  it('供应商：新增供应商后出现在列表', async () => {
    const purchaseStore = usePurchaseStore()
    const id = await purchaseStore.createSupplier(supplierData())
    const list = await purchaseStore.listSuppliers()
    expect(list.some(s => s.id === id && s.name === '海尔总代')).toBe(true)
  })

  it('客户管理：新增客户后出现在列表', async () => {
    const salesStore = useSalesStore()
    const id = await salesStore.createCustomer(customerData())
    const list = await salesStore.listCustomers()
    expect(list.some(c => c.id === id && c.name === '诚信家电')).toBe(true)
  })

  it('员工管理：新增员工账号后出现在列表', async () => {
    const userStore = useUserStore()
    const res = await userStore.createUser({
      name: '小王', username: 'xiaowang', phone: '13700000001', password: '123456', role: 'sales', status: 'active'
    })
    expect(res.ok).toBe(true)
    const list = await userStore.listUsers()
    expect(list.some(u => u.phone === '13700000001')).toBe(true)
  })

  it('采购单：按进价建单，金额与明细正确落库', async () => {
    const productStore = useProductStore()
    const purchaseStore = usePurchaseStore()
    await productStore.createProduct(productData())
    const product = (await productStore.search(''))[0]
    const supplierId = await purchaseStore.createSupplier(supplierData())

    const res = await purchaseStore.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product, quantity: 2 }], remark: ''
    })
    expect(res.ok).toBe(true)

    const orders = await purchaseStore.listOrders()
    expect(orders.length).toBe(1)
    expect(orders[0].totalAmount).toBe(2000) // 进价 1000 × 2

    const items = await purchaseStore.getOrderItems(res.orderId!)
    expect(items.length).toBe(1)
    expect(items[0].price).toBe(1000)
  })

  it('销售单：库存不足时拒绝建单', async () => {
    const productStore = useProductStore()
    const salesStore = useSalesStore()
    await productStore.createProduct(productData())
    const product = (await productStore.search(''))[0]
    const customerId = await salesStore.createCustomer(customerData())

    const res = await salesStore.createOrder({
      customerId, salesId: 1, items: [{ product, quantity: 1 }], remark: ''
    })
    expect(res.ok).toBe(false) // 库存为 0
  })

  it('销售单：有库存时按批发价建单成功', async () => {
    const productStore = useProductStore()
    const purchaseStore = usePurchaseStore()
    const salesStore = useSalesStore()
    await productStore.createProduct(productData())
    const product = (await productStore.search(''))[0]

    // 先采购入库补充库存
    const supplierId = await purchaseStore.createSupplier(supplierData())
    const po = await purchaseStore.createOrder({ supplierId, purchaserId: 1, items: [{ product, quantity: 5 }], remark: '' })
    await purchaseStore.inbound(po.orderId!, { [product.id!]: 5 }, 1)
    expect(await productStore.getStock(product.id!)).toBe(5)

    const customerId = await salesStore.createCustomer(customerData())
    const so = await salesStore.createOrder({ customerId, salesId: 1, items: [{ product, quantity: 2 }], remark: '' })
    expect(so.ok).toBe(true)

    const orders = await salesStore.listOrders()
    expect(orders.length).toBe(1)
    expect(orders[0].totalAmount).toBe(2400) // 批发价 1200 × 2
  })

  it('毛利核算：按销售-成本计算毛利', async () => {
    const productStore = useProductStore()
    const purchaseStore = usePurchaseStore()
    const salesStore = useSalesStore()
    const financeStore = useFinanceStore()

    await productStore.createProduct(productData())
    const product = (await productStore.search(''))[0]
    const supplierId = await purchaseStore.createSupplier(supplierData())
    const po = await purchaseStore.createOrder({ supplierId, purchaserId: 1, items: [{ product, quantity: 5 }], remark: '' })
    await purchaseStore.inbound(po.orderId!, { [product.id!]: 5 }, 1)

    const customerId = await salesStore.createCustomer(customerData())
    const so = await salesStore.createOrder({ customerId, salesId: 1, items: [{ product, quantity: 2 }], remark: '' })
    await salesStore.outbound(so.orderId!, { [product.id!]: 2 }, 1)

    const profit = await financeStore.getProfitSummary()
    expect(profit.totalSales).toBe(2400) // 1200 × 2
    expect(profit.totalCost).toBe(2000)  // 进价 1000 × 2
    expect(profit.grossProfit).toBe(400)
  })
})
