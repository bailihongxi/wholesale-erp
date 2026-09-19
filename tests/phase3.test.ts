import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import type { Product } from '../src/types'

describe('阶段3：采购闭环', () => {
  let sampleProduct: Product

  beforeEach(async () => {
    setActivePinia(createPinia())
    const { db } = await import('../src/db')
    await db.delete()
    await db.open()

    // 准备一个商品
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    await productStore.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调',
      spec: '1.5匹', unit: '台', purchasePrice: 1800,
      wholesalePrice: 2100, retailPrice: 2300,
      warnStock: 50, status: 'active', remark: '', extra: {}
    })
    const products = await productStore.search('')
    sampleProduct = products[0]
  })

  it('创建供应商', async () => {
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const store = usePurchaseStore()
    const id = await store.createSupplier({
      name: 'XX家电批发', contact: '王老板', phone: '138****',
      address: '', paymentTerm: '月结30天', remark: ''
    })
    expect(id).toBeGreaterThan(0)
    const suppliers = await store.listSuppliers()
    expect(suppliers.length).toBe(1)
  })

  it('创建采购单并自动算总金额', async () => {
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const store = usePurchaseStore()
    const supplierId = await store.createSupplier({
      name: 'XX家电', contact: '王', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const res = await store.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: sampleProduct, quantity: 10 }],
      remark: ''
    })
    expect(res.ok).toBe(true)
    const order = await store.getOrder(res.orderId!)
    expect(order?.totalAmount).toBe(18000)
    expect(order?.status).toBe('pending')
  })

  it('空商品列表创建采购单失败', async () => {
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const store = usePurchaseStore()
    const supplierId = await store.createSupplier({
      name: 'XX', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const res = await store.createOrder({
      supplierId, purchaserId: 1, items: [], remark: ''
    })
    expect(res.ok).toBe(false)
  })

  it('入库后库存自动增加', async () => {
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const purchaseStore = usePurchaseStore()
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()

    const supplierId = await purchaseStore.createSupplier({
      name: 'XX', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const res = await purchaseStore.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: sampleProduct, quantity: 10 }],
      remark: ''
    })
    const beforeStock = await productStore.getStock(sampleProduct.id!)
    expect(beforeStock).toBe(0)

    await purchaseStore.inbound(res.orderId!, { [sampleProduct.id!]: 10 }, 1)
    const afterStock = await productStore.getStock(sampleProduct.id!)
    expect(afterStock).toBe(10)
  })

  it('入库后自动生成出入库流水', async () => {
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const purchaseStore = usePurchaseStore()
    const { db } = await import('../src/db')

    const supplierId = await purchaseStore.createSupplier({
      name: 'XX', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const res = await purchaseStore.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: sampleProduct, quantity: 10 }],
      remark: ''
    })
    await purchaseStore.inbound(res.orderId!, { [sampleProduct.id!]: 10 }, 1)
    const records = await db.stockRecords.where('type').equals('purchase_in').toArray()
    expect(records.length).toBe(1)
    expect(records[0].quantity).toBe(10)
  })

  it('全部到齐后采购单状态变为completed', async () => {
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const store = usePurchaseStore()
    const supplierId = await store.createSupplier({
      name: 'XX', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const res = await store.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: sampleProduct, quantity: 10 }],
      remark: ''
    })
    await store.inbound(res.orderId!, { [sampleProduct.id!]: 10 }, 1)
    const order = await store.getOrder(res.orderId!)
    expect(order?.status).toBe('completed')
  })

  it('部分到货时状态为partial', async () => {
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const store = usePurchaseStore()
    const supplierId = await store.createSupplier({
      name: 'XX', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const res = await store.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: sampleProduct, quantity: 10 }],
      remark: ''
    })
    // 只到 7 台
    await store.inbound(res.orderId!, { [sampleProduct.id!]: 7 }, 1)
    const order = await store.getOrder(res.orderId!)
    expect(order?.status).toBe('partial')
  })

  it('待入库列表只显示pending和partial', async () => {
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const store = usePurchaseStore()
    const supplierId = await store.createSupplier({
      name: 'XX', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const res = await store.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: sampleProduct, quantity: 10 }],
      remark: ''
    })
    const pending = await store.listPendingInbound()
    expect(pending.length).toBe(1)
    // 入库完成后不再出现在待入库列表
    await store.inbound(res.orderId!, { [sampleProduct.id!]: 10 }, 1)
    const after = await store.listPendingInbound()
    expect(after.length).toBe(0)
  })
})
