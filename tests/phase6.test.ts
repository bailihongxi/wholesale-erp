import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import type { Product } from '../src/types'

describe('阶段6：工作台 + 报表', () => {
  let sampleProduct: Product

  beforeEach(async () => {
    setActivePinia(createPinia())
    const { db } = await import('../src/db')
    await db.delete()
    await db.open()

    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    await productStore.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调',
      spec: '', unit: '台', purchasePrice: 1800,
      wholesalePrice: 2100, retailPrice: 2300,
      warnStock: 50, status: 'active', remark: '', extra: {}
    })
    const products = await productStore.search('')
    sampleProduct = products[0]

    // 入库 100 台
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const purchaseStore = usePurchaseStore()
    const supplierId = await purchaseStore.createSupplier({
      name: '供应商A', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const po = await purchaseStore.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: sampleProduct, quantity: 100 }],
      remark: ''
    })
    await purchaseStore.inbound(po.orderId!, { [sampleProduct.id!]: 100 }, 1)

    // 创建销售单但不完成出库（留待办）
    const { useSalesStore } = await import('../src/stores/sales')
    const salesStore = useSalesStore()
    const customerId = await salesStore.createCustomer({
      name: '客户B', contact: '', phone: '', address: '',
      level: 'A', creditLimit: 50000, paymentTerm: '', status: 'active', remark: ''
    })
    await salesStore.createOrder({
      customerId, salesId: 2,
      items: [{ product: sampleProduct, quantity: 10 }],
      remark: ''
    })
  })

  it('老板工作台汇总正确', async () => {
    const { useDashboardStore } = await import('../src/stores/dashboard')
    const store = useDashboardStore()
    const summary = await store.getBossSummary()
    expect(summary.todaySales).toBe(21000)
    expect(summary.todayPurchases).toBe(180000)
    expect(summary.pendingCount).toBe(1)  // 1张待出库销售单
    expect(summary.lowStockCount).toBe(0)  // 库存100台 > 预警50
  })

  it('采购工作台待办正确', async () => {
    const { useDashboardStore } = await import('../src/stores/dashboard')
    const store = useDashboardStore()
    const todo = await store.getPurchaseTodo()
    expect(todo.pendingInboundCount).toBe(0)  // 采购单已完成入库
  })

  it('销售工作台待办正确', async () => {
    const { useDashboardStore } = await import('../src/stores/dashboard')
    const store = useDashboardStore()
    const todo = await store.getSalesTodo()
    expect(todo.pendingOutboundCount).toBe(1)  // 1张待出库
  })

  it('库房工作台待办正确', async () => {
    const { useDashboardStore } = await import('../src/stores/dashboard')
    const store = useDashboardStore()
    const todo = await store.getWarehouseTodo()
    expect(todo.pendingInboundCount).toBe(0)
    expect(todo.pendingOutboundCount).toBe(1)
  })

  it('财务工作台汇总应收应付', async () => {
    const { useDashboardStore } = await import('../src/stores/dashboard')
    const store = useDashboardStore()
    const todo = await store.getFinanceTodo()
    expect(todo.totalReceivable).toBe(21000)
    expect(todo.totalPayable).toBe(180000)  // 采购入库完成但未付款
  })

  it('采购完成后库存不足时预警数增加', async () => {
    // 出库 80 台，库存剩 20 台 < 预警 50
    const { useSalesStore } = await import('../src/stores/sales')
    const salesStore = useSalesStore()
    const orders = await salesStore.listOrders()
    await salesStore.outbound(orders[0].id!, { [sampleProduct.id!]: 10 }, 1)
    // 再创建一张销售单出库70台
    const customerId = orders[0].customerId
    const so2 = await salesStore.createOrder({
      customerId, salesId: 2,
      items: [{ product: sampleProduct, quantity: 70 }],
      remark: ''
    })
    await salesStore.outbound(so2.orderId!, { [sampleProduct.id!]: 70 }, 1)

    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    const low = await productStore.getLowStockProducts()
    expect(low.length).toBe(1)  // 库存20 < 预警50
  })
})
