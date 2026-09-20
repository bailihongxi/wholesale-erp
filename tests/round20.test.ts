import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { usePurchaseStore } from '../src/stores/purchase'
import { useSalesStore } from '../src/stores/sales'
import { useQuotesStore } from '../src/stores/quotes'
import { genQuoteNo } from '../src/utils/orderNo'
import { buildOrderPrintHTML } from '../src/utils/printTemplate'
import type { Product, Supplier, Customer } from '../src/types'

/**
 * 第二十轮（V1.0-9）：
 * ① 赠品：采购 / 销售建单可标记赠品行——金额计 0、不参与合计，验货 / 拣货照常出入库，
 *    出入库流水备注带「赠品」，打印金额列显示「赠品」；
 * ② 报价单：客户询价临时报价（BJ 前缀），订单确定后一键转销售单，
 *    散客自动建档，转单后双向可查、不能重复转换。
 */
let seq = 0
function uid(): string { seq += 1; return `${Date.now()}-${seq}` }

async function seedProduct(): Promise<Product> {
  const id = await db.products.add({
    brand: '测试品牌',
    model: `M-${uid()}`,
    category: '空调',
    spec: '',
    unit: '台',
    purchasePrice: 1000,
    wholesalePrice: 1200,
    retailPrice: 1500,
    warnStock: 1,
    status: 'active',
    remark: '',
    extra: {}
  }) as number
  return (await db.products.get(id))!
}

async function seedSupplier(): Promise<Supplier> {
  const id = await db.suppliers.add({
    name: `供应商-${uid()}`,
    contact: '',
    phone: '',
    address: '',
    status: 'active',
    remark: ''
  }) as number
  return (await db.suppliers.get(id))!
}

async function seedCustomer(name?: string): Promise<Customer> {
  const id = await db.customers.add({
    name: name ?? `客户-${uid()}`,
    contact: '',
    phone: '',
    address: '',
    level: '普通',
    creditLimit: 0,
    paymentTerm: '',
    status: 'active',
    remark: ''
  }) as number
  return (await db.customers.get(id))!
}

async function addStock(productId: number, quantity: number): Promise<void> {
  const s = await db.stock.where('productId').equals(productId).first()
  if (s) await db.stock.update(s.id!, { quantity: s.quantity + quantity, updatedAt: new Date().toISOString() })
  else await db.stock.add({ productId, quantity, updatedAt: new Date().toISOString() })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('第二十轮①：采购赠品——金额计 0、照常入库、流水备注「赠品」', () => {
  it('采购单中赠品行 price 记 0 且不计入合计，验货入库后库存照常增加', async () => {
    const store = usePurchaseStore()
    const normal = await seedProduct()
    const gift = await seedProduct()
    const sup = await seedSupplier()

    const res = await store.createOrder({
      supplierId: sup.id!,
      purchaserId: 1,
      items: [
        { product: normal, quantity: 2, price: 1000 },
        { product: gift, quantity: 3, isGift: true }
      ],
      remark: ''
    })
    expect(res.ok).toBe(true)

    const order = (await db.purchaseOrders.get(res.orderId!))!
    expect(order.totalAmount).toBe(2000)

    const items = await db.purchaseOrderItems.where('purchaseOrderId').equals(res.orderId!).toArray()
    const normalItem = items.find(i => i.productId === normal.id)!
    const giftItem = items.find(i => i.productId === gift.id)!
    expect(normalItem.isGift ?? false).toBe(false)
    expect(giftItem.isGift).toBe(true)
    expect(giftItem.price).toBe(0)
    expect(giftItem.subtotal).toBe(0)

    // 验货入库：赠品行照常入库
    const ib = await store.inbound(res.orderId!, {}, 1)
    expect(ib.ok).toBe(true)

    const giftRecs = await db.stockRecords
      .where('refOrderId').equals(res.orderId!)
      .filter(r => r.productId === gift.id && r.type === 'purchase_in')
      .toArray()
    expect(giftRecs.length).toBeGreaterThan(0)
    expect(giftRecs[0].remark).toContain('赠品')

    const gs = await db.stock.where('productId').equals(gift.id).first()
    expect(gs?.quantity).toBe(3)
    const ns = await db.stock.where('productId').equals(normal.id).first()
    expect(ns?.quantity).toBe(2)
  })
})

describe('第二十轮①：销售赠品——金额计 0、照常出库、流水备注「赠品」', () => {
  it('销售单中赠品行 price 记 0 且不计入合计，拣货出库后库存照常扣减', async () => {
    const store = useSalesStore()
    const normal = await seedProduct()
    const gift = await seedProduct()
    await addStock(normal.id!, 10)
    await addStock(gift.id!, 10)
    const cus = await seedCustomer()

    const res = await store.createOrder({
      customerId: cus.id!,
      salesId: 1,
      items: [
        { product: normal, quantity: 2, price: 1200 },
        { product: gift, quantity: 2, isGift: true }
      ],
      priceMode: 'wholesale',
      remark: ''
    })
    expect(res.ok).toBe(true)

    const order = (await db.saleOrders.get(res.orderId!))!
    expect(order.totalAmount).toBe(2400)

    const items = await db.saleOrderItems.where('saleOrderId').equals(res.orderId!).toArray()
    const giftItem = items.find(i => i.productId === gift.id)!
    expect(giftItem.isGift).toBe(true)
    expect(giftItem.price).toBe(0)
    expect(giftItem.subtotal).toBe(0)

    // 拣货出库：赠品行照常出库
    const ob = await store.outbound(res.orderId!, {}, 1)
    expect(ob.ok).toBe(true)

    const giftRecs = await db.stockRecords
      .where('refOrderId').equals(res.orderId!)
      .filter(r => r.productId === gift.id && r.type === 'sale_out')
      .toArray()
    expect(giftRecs.length).toBeGreaterThan(0)
    expect(giftRecs[0].remark).toContain('赠品')

    const gs = await db.stock.where('productId').equals(gift.id).first()
    expect(gs?.quantity).toBe(8)
  })
})

describe('第二十轮①：打印——赠品行金额列显示「赠品」', () => {
  it('buildOrderPrintHTML 对 isGift 明细行输出「赠品 / —」', () => {
    const html = buildOrderPrintHTML(
      {
        orderNo: 'CG-TEST-1',
        date: '2026-09-20',
        partyName: '某某供应商',
        partyLabel: '供应商',
        items: [
          { productName: '滚筒洗衣机', category: '洗衣机', model: 'XQG100', unit: '台', quantity: 2, price: 1800, subtotal: 3600 },
          { productName: '电饭煲', category: '小家电', model: 'DFB-40', unit: '台', quantity: 1, price: 0, subtotal: 0, isGift: true }
        ],
        totalQuantity: 3,
        totalAmount: 3600,
        title: '采购单'
      },
      true
    )
    expect(html).toContain('赠品')
    // 赠品行金额列不应出现 ¥0 的货币渲染（子串断言：金额列模板输出「赠品」文本）
    expect(html).toMatch(/赠品</)
    expect(html).not.toContain('¥0')
  })
})

describe('第二十轮②：报价单——创建与单号', () => {
  it('报价单单号 BJ 前缀，金额按明细累加，散客名称直接保存', async () => {
    const store = useQuotesStore()
    const a = await seedProduct()
    const b = await seedProduct()

    const res = await store.createQuote({
      customerId: 0,
      customerName: '红星商场 王老板',
      items: [
        { product: a, quantity: 2, price: 1100 },
        { product: b, quantity: 1, price: 900 }
      ],
      remark: '询价',
      validDays: 7,
      salesId: 1
    })
    expect(res.ok).toBe(true)

    const q = (await db.quoteOrders.get(res.orderId!))!
    expect(q.orderNo.startsWith('BJ')).toBe(true)
    expect(q.status).toBe('draft')
    expect(q.customerId).toBe(0)
    expect(q.customerName).toBe('红星商场 王老板')
    expect(q.totalAmount).toBe(3100)
    expect(q.validDays).toBe(7)

    const items = await db.quoteOrderItems.where('quoteOrderId').equals(res.orderId!).toArray()
    expect(items.length).toBe(2)
    expect(items.reduce((s, i) => s + i.subtotal, 0)).toBe(3100)
  })

  it('genQuoteNo 输出 BJ + 日期 + 随机段', () => {
    const no = genQuoteNo()
    expect(no.startsWith('BJ')).toBe(true)
    expect(no.length).toBeGreaterThanOrEqual(12)
    expect(no).toMatch(/^BJ\d{8}-\d{3}$/)
  })
})

describe('第二十轮②：报价单——一键转销售单', () => {
  it('散客报价单转销售单：自动建档 + 明细价格带过去 + 双向回填，不能重复转换', async () => {
    const quotesStore = useQuotesStore()
    const salesStore = useSalesStore()
    const a = await seedProduct()
    const b = await seedProduct()
    await addStock(a.id!, 20)
    await addStock(b.id!, 20)

    const res = await quotesStore.createQuote({
      customerId: 0,
      customerName: '散客 李总',
      items: [
        { product: a, quantity: 5, price: 1100 },
        { product: b, quantity: 3, price: 900 }
      ],
      remark: '要货',
      salesId: 1
    })
    expect(res.ok).toBe(true)
    const quoteId = res.orderId!

    const conv = await quotesStore.convertToSale(quoteId, 1)
    expect(conv.ok).toBe(true)
    expect(conv.saleOrderNo).toBeTruthy()

    // 1) 散客自动建档
    const created = (await db.customers.where('name').equals('散客 李总').toArray())[0]
    expect(created).toBeTruthy()
    expect(created!.remark).toContain('报价单')

    // 2) 报价单状态回填
    const q = (await db.quoteOrders.get(quoteId))!
    expect(q.status).toBe('converted')
    expect(q.convertedSaleOrderId).toBeTruthy()
    expect(q.convertedSaleNo).toBe(conv.saleOrderNo)

    // 3) 销售单明细价格与报价一致（有库存，未扣减前库存足够）
    const sale = (await db.saleOrders.get(q.convertedSaleOrderId!))!
    expect(sale.customerId).toBe(created!.id)
    const saleItems = await db.saleOrderItems.where('saleOrderId').equals(sale.id!).toArray()
    expect(saleItems.length).toBe(2)
    expect(saleItems.find(i => i.productId === a.id)!.price).toBe(1100)
    expect(saleItems.find(i => i.productId === b.id)!.price).toBe(900)
    expect(sale.totalAmount).toBe(8200)

    // 4) 不能重复转换
    const again = await quotesStore.convertToSale(quoteId, 1)
    expect(again.ok).toBe(false)
  })

  it('已建档客户报价单转销售单：不重复建档，直接挂到该客户', async () => {
    const quotesStore = useQuotesStore()
    const a = await seedProduct()
    await addStock(a.id!, 20)
    const cus = await seedCustomer('老客户 张三')

    const res = await quotesStore.createQuote({
      customerId: cus.id!,
      customerName: '',
      items: [{ product: a, quantity: 2, price: 1100 }],
      remark: '',
      salesId: 1
    })
    expect(res.ok).toBe(true)

    const conv = await quotesStore.convertToSale(res.orderId!, 1)
    expect(conv.ok).toBe(true)

    const same = await db.customers.where('name').equals('老客户 张三').toArray()
    expect(same.length).toBe(1)
    const sale = (await db.saleOrders.get((await db.quoteOrders.get(res.orderId!))!.convertedSaleOrderId!))!
    expect(sale.customerId).toBe(cus.id)
  })
})
