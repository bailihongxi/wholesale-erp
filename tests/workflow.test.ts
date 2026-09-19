// 完整业务流程端到端测试（按真实经营顺序跑通全链路）：
// 商品建档 → 供应商/客户建档 → 采购建单 → 入库验货(库存+) → 销售建单 → 出库发货(库存-)
// → 财务应付/付款 → 财务应收/收款 → 毛利核算
// 同时覆盖分次入库/出库、部分收付款、重复出入库防护等异常分支。
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'

import { db } from '../src/db'
import { useProductStore } from '../src/stores/product'
import { usePurchaseStore } from '../src/stores/purchase'
import { useSalesStore } from '../src/stores/sales'
import { useFinanceStore } from '../src/stores/finance'
import type { Product, Supplier, Customer } from '../src/types'

const PURCHASE_PRICE = 1000  // 进价
const WHOLESALE_PRICE = 1200 // 批发价

function productData(over: Partial<Product> = {}): Omit<Product, 'id'> {
  return {
    brand: '海尔', model: 'XQB100', category: '洗衣机', spec: '10公斤', unit: '台',
    purchasePrice: PURCHASE_PRICE, wholesalePrice: WHOLESALE_PRICE, retailPrice: 1500,
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
    level: '批发', creditLimit: 0, paymentTerm: '月结', status: 'active', remark: '', ...over
  }
}

describe('完整业务流程：采购 → 入库 → 销售 → 出库 → 财务', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
  })

  /** 基础数据：商品 + 供应商 + 客户，返回各自 id */
  async function seedBaseData() {
    const productStore = useProductStore()
    const purchaseStore = usePurchaseStore()
    const salesStore = useSalesStore()

    const created = await productStore.createProduct(productData())
    expect(created.ok).toBe(true)
    const product = (await productStore.search(''))[0]
    const supplierId = await purchaseStore.createSupplier(supplierData())
    const customerId = await salesStore.createCustomer(customerData())
    return { productStore, purchaseStore, salesStore, product, supplierId, customerId }
  }

  it('完整正向流程：全链路数据一致（金额/库存/状态/财务/毛利）', async () => {
    const { productStore, purchaseStore, salesStore, product, supplierId, customerId } = await seedBaseData()
    const financeStore = useFinanceStore()
    const pid = product.id!

    // ── 1. 采购建单：按进价计算 ──
    const po = await purchaseStore.createOrder({
      supplierId, purchaserId: 1, items: [{ product, quantity: 10 }], remark: '首批进货'
    })
    expect(po.ok).toBe(true)
    let poRow = await purchaseStore.getOrder(po.orderId!)
    expect(poRow!.totalAmount).toBe(PURCHASE_PRICE * 10) // 10000
    expect(poRow!.status).toBe('pending')
    expect(poRow!.payStatus).toBe('unpaid')
    expect(await productStore.getStock(pid)).toBe(0)

    // ── 2. 库房入库验货：库存 +10，采购单完成 ──
    const inRes = await purchaseStore.inbound(po.orderId!, { [pid]: 10 }, 1)
    expect(inRes.ok).toBe(true)
    poRow = await purchaseStore.getOrder(po.orderId!)
    expect(poRow!.status).toBe('completed')
    expect(await productStore.getStock(pid)).toBe(10)

    // 入库后不再出现在「待入库」列表
    const pendingIn = await purchaseStore.listPendingInbound()
    expect(pendingIn.some(o => o.id === po.orderId)).toBe(false)

    // ── 3. 销售建单：按批发价计算 ──
    const so = await salesStore.createOrder({
      customerId, salesId: 1, items: [{ product, quantity: 4 }], remark: '批发出货'
    })
    expect(so.ok).toBe(true)
    let soRow = await salesStore.getOrder(so.orderId!)
    expect(soRow!.totalAmount).toBe(WHOLESALE_PRICE * 4) // 4800
    expect(soRow!.status).toBe('pending')
    expect(soRow!.receiveStatus).toBe('unreceived')

    // ── 4. 库房出库发货：库存 -4，销售单完成 ──
    const outRes = await salesStore.outbound(so.orderId!, { [pid]: 4 }, 1)
    expect(outRes.ok).toBe(true)
    soRow = await salesStore.getOrder(so.orderId!)
    expect(soRow!.status).toBe('completed')
    expect(await productStore.getStock(pid)).toBe(6)

    // ── 5. 财务应付：采购欠款 10000 ──
    let payables = await financeStore.listPayables()
    expect(payables.length).toBe(1)
    expect(payables[0].orderId).toBe(po.orderId)
    expect(payables[0].totalAmount).toBe(10000)
    expect(payables[0].paidAmount).toBe(0)
    expect(payables[0].balance).toBe(10000)

    // ── 6. 财务应收：客户欠款 4800 ──
    let receivables = await financeStore.listReceivables()
    expect(receivables.length).toBe(1)
    expect(receivables[0].orderId).toBe(so.orderId)
    expect(receivables[0].balance).toBe(4800)

    // ── 7. 登记付款：应付清零 ──
    const payRes = await financeStore.recordPay({ orderId: po.orderId!, amount: 10000, operatorId: 1, remark: '全额付款' })
    expect(payRes.ok).toBe(true)
    poRow = await purchaseStore.getOrder(po.orderId!)
    expect(poRow!.payStatus).toBe('paid')
    payables = await financeStore.listPayables()
    expect(payables.length, '付清后不应再出现在应付列表').toBe(0)

    // ── 8. 登记收款：应收清零 ──
    const recvRes = await financeStore.recordReceive({ orderId: so.orderId!, amount: 4800, operatorId: 1, remark: '全额收款' })
    expect(recvRes.ok).toBe(true)
    soRow = await salesStore.getOrder(so.orderId!)
    expect(soRow!.receiveStatus).toBe('received')
    receivables = await financeStore.listReceivables()
    expect(receivables.length, '收清后不应再出现在应收列表').toBe(0)

    // ── 9. 毛利核算：销售 4800 - 成本(进价1000×4) 4000 = 800 ──
    const profit = await financeStore.getProfitSummary()
    expect(profit.totalSales).toBe(4800)
    expect(profit.totalCost).toBe(4000)
    expect(profit.grossProfit).toBe(800)

    // ── 10. 最终库存 ──
    expect(await productStore.getStock(pid)).toBe(6)
  })

  it('分次入库：两次收货累计达到订单量后状态变为已完成', async () => {
    const { productStore, purchaseStore, product, supplierId } = await seedBaseData()
    const pid = product.id!

    const po = await purchaseStore.createOrder({
      supplierId, purchaserId: 1, items: [{ product, quantity: 10 }], remark: ''
    })

    // 第一次只收 6 台
    await purchaseStore.inbound(po.orderId!, { [pid]: 6 }, 1)
    let row = await purchaseStore.getOrder(po.orderId!)
    expect(row!.status).toBe('partial')
    expect(await productStore.getStock(pid)).toBe(6)
    expect((await purchaseStore.listPendingInbound()).some(o => o.id === po.orderId)).toBe(true)

    // 第二次补收剩余 4 台 → 累计 10 台，应判定完成
    await purchaseStore.inbound(po.orderId!, { [pid]: 4 }, 1)
    row = await purchaseStore.getOrder(po.orderId!)
    expect(row!.status, '分次入库累计达量后应变为 completed').toBe('completed')
    expect(await productStore.getStock(pid)).toBe(10)
    expect((await purchaseStore.listPendingInbound()).some(o => o.id === po.orderId)).toBe(false)
  })

  it('分次出库：两次发货累计达到订单量后状态变为已完成', async () => {
    const { productStore, purchaseStore, salesStore, product, supplierId, customerId } = await seedBaseData()
    const pid = product.id!

    // 先备货 10 台
    const po = await purchaseStore.createOrder({ supplierId, purchaserId: 1, items: [{ product, quantity: 10 }], remark: '' })
    await purchaseStore.inbound(po.orderId!, { [pid]: 10 }, 1)
    expect(await productStore.getStock(pid)).toBe(10)

    const so = await salesStore.createOrder({ customerId, salesId: 1, items: [{ product, quantity: 10 }], remark: '' })

    // 第一次只发 6 台
    await salesStore.outbound(so.orderId!, { [pid]: 6 }, 1)
    let row = await salesStore.getOrder(so.orderId!)
    expect(row!.status).toBe('partial')
    expect(await productStore.getStock(pid)).toBe(4)

    // 第二次补发 4 台 → 累计 10 台，应判定完成
    await salesStore.outbound(so.orderId!, { [pid]: 4 }, 1)
    row = await salesStore.getOrder(so.orderId!)
    expect(row!.status, '分次出库累计达量后应变为 completed').toBe('completed')
    expect(await productStore.getStock(pid)).toBe(0)
  })

  it('部分付款：付一部分时状态为 partial，余额继续留在应付列表', async () => {
    const { purchaseStore, product, supplierId } = await seedBaseData()
    const financeStore = useFinanceStore()

    const po = await purchaseStore.createOrder({ supplierId, purchaserId: 1, items: [{ product, quantity: 10 }], remark: '' })

    await financeStore.recordPay({ orderId: po.orderId!, amount: 4000, operatorId: 1, remark: '先付定金' })
    let row = await purchaseStore.getOrder(po.orderId!)
    expect(row!.payStatus).toBe('partial')

    let payables = await financeStore.listPayables()
    expect(payables.length).toBe(1)
    expect(payables[0].paidAmount).toBe(4000)
    expect(payables[0].balance).toBe(6000)

    // 付清尾款
    await financeStore.recordPay({ orderId: po.orderId!, amount: 6000, operatorId: 1, remark: '付清尾款' })
    row = await purchaseStore.getOrder(po.orderId!)
    expect(row!.payStatus).toBe('paid')
    payables = await financeStore.listPayables()
    expect(payables.length).toBe(0)
  })

  it('部分收款：收一部分时状态为 partial，余额继续留在应收列表', async () => {
    const { productStore, purchaseStore, salesStore, product, supplierId, customerId } = await seedBaseData()
    const financeStore = useFinanceStore()
    const pid = product.id!

    const po = await purchaseStore.createOrder({ supplierId, purchaserId: 1, items: [{ product, quantity: 10 }], remark: '' })
    await purchaseStore.inbound(po.orderId!, { [pid]: 10 }, 1)
    const so = await salesStore.createOrder({ customerId, salesId: 1, items: [{ product, quantity: 4 }], remark: '' })

    await financeStore.recordReceive({ orderId: so.orderId!, amount: 800, operatorId: 1, remark: '收定金' })
    let row = await salesStore.getOrder(so.orderId!)
    expect(row!.receiveStatus).toBe('partial')

    let receivables = await financeStore.listReceivables()
    expect(receivables.length).toBe(1)
    expect(receivables[0].receivedAmount).toBe(800)
    expect(receivables[0].balance).toBe(4000)

    await financeStore.recordReceive({ orderId: so.orderId!, amount: 4000, operatorId: 1, remark: '收尾款' })
    row = await salesStore.getOrder(so.orderId!)
    expect(row!.receiveStatus).toBe('received')
    receivables = await financeStore.listReceivables()
    expect(receivables.length).toBe(0)
  })

  it('已完成的采购单不允许重复入库（避免库存被重复累加）', async () => {
    const { productStore, purchaseStore, product, supplierId } = await seedBaseData()
    const pid = product.id!

    const po = await purchaseStore.createOrder({ supplierId, purchaserId: 1, items: [{ product, quantity: 10 }], remark: '' })
    await purchaseStore.inbound(po.orderId!, { [pid]: 10 }, 1)
    expect(await productStore.getStock(pid)).toBe(10)

    const again = await purchaseStore.inbound(po.orderId!, { [pid]: 10 }, 1)
    expect(again.ok).toBe(false)
    expect(await productStore.getStock(pid), '重复入库不应再次增加库存').toBe(10)
  })

  it('已完成的销售单不允许重复出库（避免库存被重复扣减）', async () => {
    const { productStore, purchaseStore, salesStore, product, supplierId, customerId } = await seedBaseData()
    const pid = product.id!

    const po = await purchaseStore.createOrder({ supplierId, purchaserId: 1, items: [{ product, quantity: 10 }], remark: '' })
    await purchaseStore.inbound(po.orderId!, { [pid]: 10 }, 1)
    const so = await salesStore.createOrder({ customerId, salesId: 1, items: [{ product, quantity: 4 }], remark: '' })
    await salesStore.outbound(so.orderId!, { [pid]: 4 }, 1)
    expect(await productStore.getStock(pid)).toBe(6)

    const again = await salesStore.outbound(so.orderId!, { [pid]: 4 }, 1)
    expect(again.ok).toBe(false)
    expect(await productStore.getStock(pid), '重复出库不应再次扣减库存').toBe(6)
  })

  it('库存不足时不允许建销售单（防止超卖）', async () => {
    const { productStore, salesStore, product, customerId } = await seedBaseData()

    // 未入库，库存为 0
    expect(await productStore.getStock(product.id!)).toBe(0)
    const res = await salesStore.createOrder({ customerId, salesId: 1, items: [{ product, quantity: 1 }], remark: '' })
    expect(res.ok).toBe(false)
    expect(res.message).toContain('库存不足')
  })

  it('出入库流水完整记录（可追溯）', async () => {
    const { productStore, purchaseStore, salesStore, product, supplierId, customerId } = await seedBaseData()
    const pid = product.id!

    const po = await purchaseStore.createOrder({ supplierId, purchaserId: 1, items: [{ product, quantity: 10 }], remark: '' })
    await purchaseStore.inbound(po.orderId!, { [pid]: 10 }, 1)
    const so = await salesStore.createOrder({ customerId, salesId: 1, items: [{ product, quantity: 4 }], remark: '' })
    await salesStore.outbound(so.orderId!, { [pid]: 4 }, 1)

    const records = await db.stockRecords.where('productId').equals(pid).toArray()
    expect(records.length).toBe(2)
    const purchaseIn = records.find(r => r.type === 'purchase_in')
    const saleOut = records.find(r => r.type === 'sale_out')
    expect(purchaseIn!.quantity).toBe(10)
    expect(saleOut!.quantity).toBe(-4) // 出库记负数
  })
})
