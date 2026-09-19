import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import type { Product } from '../src/types'

describe('阶段4：销售闭环', () => {
  let sampleProduct: Product

  beforeEach(async () => {
    setActivePinia(createPinia())
    const { db } = await import('../src/db')
    await db.delete()
    await db.open()

    // 准备商品并入库 100 台
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

    // 入库 100 台作为库存基础
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const purchaseStore = usePurchaseStore()
    const supplierId = await purchaseStore.createSupplier({
      name: 'XX供应商', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const po = await purchaseStore.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: sampleProduct, quantity: 100 }],
      remark: ''
    })
    await purchaseStore.inbound(po.orderId!, { [sampleProduct.id!]: 100 }, 1)
  })

  it('创建客户', async () => {
    const { useSalesStore } = await import('../src/stores/sales')
    const store = useSalesStore()
    const id = await store.createCustomer({
      name: 'XX家电卖场', contact: '李经理', phone: '139****',
      address: '', level: 'A', creditLimit: 50000, paymentTerm: '月结30天',
      status: 'active', remark: ''
    })
    expect(id).toBeGreaterThan(0)
    const customers = await store.listCustomers()
    expect(customers.length).toBe(1)
  })

  it('创建销售单自动带批发价', async () => {
    const { useSalesStore } = await import('../src/stores/sales')
    const store = useSalesStore()
    const customerId = await store.createCustomer({
      name: 'XX卖场', contact: '', phone: '', address: '',
      level: 'A', creditLimit: 50000, paymentTerm: '', status: 'active', remark: ''
    })
    const res = await store.createOrder({
      customerId, salesId: 2,
      items: [{ product: sampleProduct, quantity: 10 }],
      remark: ''
    })
    expect(res.ok).toBe(true)
    const order = await store.getOrder(res.orderId!)
    expect(order?.totalAmount).toBe(21000)
    const items = await store.getOrderItems(res.orderId!)
    expect(items[0].price).toBe(2100)  // 批发价
  })

  it('库存不足时创建销售单失败', async () => {
    const { useSalesStore } = await import('../src/stores/sales')
    const store = useSalesStore()
    const customerId = await store.createCustomer({
      name: 'XX', contact: '', phone: '', address: '',
      level: 'A', creditLimit: 50000, paymentTerm: '', status: 'active', remark: ''
    })
    const res = await store.createOrder({
      customerId, salesId: 2,
      items: [{ product: sampleProduct, quantity: 200 }],  // 库存只有100
      remark: ''
    })
    expect(res.ok).toBe(false)
    expect(res.message).toContain('库存不足')
  })

  it('出库后库存自动扣减', async () => {
    const { useSalesStore } = await import('../src/stores/sales')
    const salesStore = useSalesStore()
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()

    const customerId = await salesStore.createCustomer({
      name: 'XX', contact: '', phone: '', address: '',
      level: 'A', creditLimit: 50000, paymentTerm: '', status: 'active', remark: ''
    })
    const res = await salesStore.createOrder({
      customerId, salesId: 2,
      items: [{ product: sampleProduct, quantity: 10 }],
      remark: ''
    })
    const before = await productStore.getStock(sampleProduct.id!)
    expect(before).toBe(100)

    await salesStore.outbound(res.orderId!, { [sampleProduct.id!]: 10 }, 1)
    const after = await productStore.getStock(sampleProduct.id!)
    expect(after).toBe(90)
  })

  it('出库后自动记流水', async () => {
    const { useSalesStore } = await import('../src/stores/sales')
    const salesStore = useSalesStore()
    const { db } = await import('../src/db')

    const customerId = await salesStore.createCustomer({
      name: 'XX', contact: '', phone: '', address: '',
      level: 'A', creditLimit: 50000, paymentTerm: '', status: 'active', remark: ''
    })
    const res = await salesStore.createOrder({
      customerId, salesId: 2,
      items: [{ product: sampleProduct, quantity: 5 }],
      remark: ''
    })
    await salesStore.outbound(res.orderId!, { [sampleProduct.id!]: 5 }, 1)
    const records = await db.stockRecords.where('type').equals('sale_out').toArray()
    expect(records.length).toBe(1)
    expect(records[0].quantity).toBe(-5)
  })

  it('全部出库后状态变为completed', async () => {
    const { useSalesStore } = await import('../src/stores/sales')
    const store = useSalesStore()
    const customerId = await store.createCustomer({
      name: 'XX', contact: '', phone: '', address: '',
      level: 'A', creditLimit: 50000, paymentTerm: '', status: 'active', remark: ''
    })
    const res = await store.createOrder({
      customerId, salesId: 2,
      items: [{ product: sampleProduct, quantity: 10 }],
      remark: ''
    })
    await store.outbound(res.orderId!, { [sampleProduct.id!]: 10 }, 1)
    const order = await store.getOrder(res.orderId!)
    expect(order?.status).toBe('completed')
  })

  it('待出库列表只显示pending和partial', async () => {
    const { useSalesStore } = await import('../src/stores/sales')
    const store = useSalesStore()
    const customerId = await store.createCustomer({
      name: 'XX', contact: '', phone: '', address: '',
      level: 'A', creditLimit: 50000, paymentTerm: '', status: 'active', remark: ''
    })
    const res = await store.createOrder({
      customerId, salesId: 2,
      items: [{ product: sampleProduct, quantity: 5 }],
      remark: ''
    })
    const pending = await store.listPendingOutbound()
    expect(pending.length).toBe(1)
    await store.outbound(res.orderId!, { [sampleProduct.id!]: 5 }, 1)
    const after = await store.listPendingOutbound()
    expect(after.length).toBe(0)
  })
})
