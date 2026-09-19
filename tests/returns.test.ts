import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { useProductStore } from '../src/stores/product'
import { useSalesStore } from '../src/stores/sales'
import { usePurchaseStore } from '../src/stores/purchase'
import { useReturnsStore } from '../src/stores/returns'
import { useFinanceStore } from '../src/stores/finance'
import { db } from '../src/db'
import type { Product } from '../src/types'

describe('退换货模块（销售退货 / 采购退货）', () => {
  let productStore: ReturnType<typeof useProductStore>
  let salesStore: ReturnType<typeof useSalesStore>
  let purchaseStore: ReturnType<typeof usePurchaseStore>
  let returnsStore: ReturnType<typeof useReturnsStore>
  let financeStore: ReturnType<typeof useFinanceStore>

  async function seedProduct(): Promise<Product> {
    await productStore.createProduct({
      brand: '测试', model: '鞋A', category: '鞋', spec: '42', unit: '双',
      purchasePrice: 100, wholesalePrice: 120, retailPrice: 150, warnStock: 5,
      status: 'active', remark: '', extra: {}
    })
    const list = await productStore.search('')
    return list[list.length - 1]
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    productStore = useProductStore()
    salesStore = useSalesStore()
    purchaseStore = usePurchaseStore()
    returnsStore = useReturnsStore()
    financeStore = useFinanceStore()
  })

  it('销售退货：库存回流、写退货单与红冲、应收余额冲减', async () => {
    const cid = await salesStore.createCustomer({ name: '客户甲', contact: '王', phone: '1', address: '', level: 'A', creditLimit: 0, paymentTerm: '', loginPhone: '', loginPassword: '', status: 'active', remark: '' })
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 10 })
    const res = await salesStore.createOrder({ customerId: cid, salesId: 2, items: [{ product: p, quantity: 3 }], remark: '' })
    const oid = res.orderId!

    const items = await salesStore.getOrderItems(oid)
    const ret = await returnsStore.salesReturn({
      refOrderId: oid,
      items: [{ productId: p.id!, quantity: 2, price: items[0].price, reason: '尺码不符' }],
      operatorId: 1
    })
    expect(ret.ok).toBe(true)
    expect(ret.orderNo).toBeTruthy()

    // 库存回流：10 + 2 = 12
    expect(await productStore.getStock(p.id!)).toBe(12)
    // 退货单 + 明细
    const orders = await db.returnOrders.toArray()
    expect(orders.length).toBe(1)
    expect(orders[0].kind).toBe('sale')
    const rItems = await db.returnItems.toArray()
    expect(rItems.length).toBe(1)
    expect(rItems[0].quantity).toBe(2)
    // 流水留痕
    const rec = await db.stockRecords.where('type').equals('sale_return').toArray()
    expect(rec.length).toBe(1)
    expect(rec[0].quantity).toBe(2)
    // 财务红冲：refund
    const pays = await db.payments.where('type').equals('refund').toArray()
    expect(pays.length).toBe(1)
    // 应收余额冲减：原 total - refund
    const recs = await financeStore.listReceivables(true)
    const row = recs.find(r => r.orderId === oid)!
    expect(row.balance).toBe(row.totalAmount - pays[0].amount)
  })

  it('采购退货：库存流出、写退货单与红冲、应付余额冲减', async () => {
    const sid = await purchaseStore.createSupplier({ name: '供应商乙', contact: '李', phone: '2', address: '', paymentTerm: '月结', remark: '' })
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 10 })
    const res = await purchaseStore.createOrder({ supplierId: sid, purchaserId: 1, items: [{ product: p, quantity: 3 }], remark: '' })
    const oid = res.orderId!

    const items = await purchaseStore.getOrderItems(oid)
    const ret = await returnsStore.purchaseReturn({
      refOrderId: oid,
      items: [{ productId: p.id!, quantity: 1, price: items[0].price, reason: '质量问题' }],
      operatorId: 1
    })
    expect(ret.ok).toBe(true)

    // 库存流出：10 - 1 = 9
    expect(await productStore.getStock(p.id!)).toBe(9)
    const rec = await db.stockRecords.where('type').equals('purchase_return').toArray()
    expect(rec.length).toBe(1)
    expect(rec[0].quantity).toBe(-1)
    const pays = await db.payments.where('type').equals('supplier_credit').toArray()
    expect(pays.length).toBe(1)
    const pays2 = await financeStore.listPayables(true)
    const row = pays2.find(r => r.orderId === oid)!
    expect(row.balance).toBe(row.totalAmount - pays[0].amount)
  })

  it('退货数量超过原单数量被拒绝', async () => {
    const cid = await salesStore.createCustomer({ name: '客户丙', contact: '赵', phone: '3', address: '', level: 'A', creditLimit: 0, paymentTerm: '', loginPhone: '', loginPassword: '', status: 'active', remark: '' })
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 10 })
    const res = await salesStore.createOrder({ customerId: cid, salesId: 2, items: [{ product: p, quantity: 1 }], remark: '' })
    expect(res.ok).toBe(true)
    const ret = await returnsStore.salesReturn({
      refOrderId: res.orderId!,
      items: [{ productId: p.id!, quantity: 5, price: 1 }],
      operatorId: 1
    })
    expect(ret.ok).toBe(false)
    expect(ret.message).toContain('超过')
  })

  it('采购退货数量超过在手库存被拒绝', async () => {
    const sid = await purchaseStore.createSupplier({ name: '供应商丁', contact: '钱', phone: '4', address: '', paymentTerm: '', remark: '' })
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 1 })
    const res = await purchaseStore.createOrder({ supplierId: sid, purchaserId: 1, items: [{ product: p, quantity: 5 }], remark: '' })
    const ret = await returnsStore.purchaseReturn({
      refOrderId: res.orderId!,
      items: [{ productId: p.id!, quantity: 3, price: 1 }],
      operatorId: 1
    })
    expect(ret.ok).toBe(false)
    expect(ret.message).toContain('库存')
  })

  it('历史列表同时包含销售退货与采购退货', async () => {
    const cid = await salesStore.createCustomer({ name: '客户戊', contact: 'a', phone: '5', address: '', level: 'A', creditLimit: 0, paymentTerm: '', loginPhone: '', loginPassword: '', status: 'active', remark: '' })
    const sid = await purchaseStore.createSupplier({ name: '供应商己', contact: 'b', phone: '6', address: '', paymentTerm: '', remark: '' })
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 10 })
    const so = await salesStore.createOrder({ customerId: cid, salesId: 2, items: [{ product: p, quantity: 2 }], remark: '' })
    const po = await purchaseStore.createOrder({ supplierId: sid, purchaserId: 1, items: [{ product: p, quantity: 2 }], remark: '' })
    expect(so.ok).toBe(true)
    expect(po.ok).toBe(true)
    const sitems = await salesStore.getOrderItems(so.orderId!)
    const pitems = await purchaseStore.getOrderItems(po.orderId!)
    await returnsStore.salesReturn({ refOrderId: so.orderId!, items: [{ productId: p.id!, quantity: 1, price: sitems[0].price }], operatorId: 1 })
    await returnsStore.purchaseReturn({ refOrderId: po.orderId!, items: [{ productId: p.id!, quantity: 1, price: pitems[0].price }], operatorId: 1 })

    const all = await returnsStore.listReturns()
    expect(all.length).toBe(2)
    expect(all.find(r => r.kind === 'sale')).toBeTruthy()
    expect(all.find(r => r.kind === 'purchase')).toBeTruthy()
    expect((await returnsStore.listReturns('sale')).length).toBe(1)
    expect((await returnsStore.listReturns('purchase')).length).toBe(1)
  })
})
