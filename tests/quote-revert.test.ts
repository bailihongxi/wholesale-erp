import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { usePurchaseStore } from '../src/stores/purchase'
import { useSalesStore } from '../src/stores/sales'
import { useQuotesStore } from '../src/stores/quotes'
import { AUDIT_ACTIONS } from '../src/utils/audit'
import type { Product } from '../src/types'

/**
 * V2.1-1.4：单据删除的「双向联动」—— 删销售单 / 采购单时，
 * 由报价单 / 预采询价单转来的那些单必须把来源单据退回「未转」状态。
 *
 * 背景：转单只写了「报价单 → 销售单」的单向关联（convertedSaleOrderId），
 * 删除侧原来不回退 → 来源单据被永久钉在 converted（不能再改、不能再转）。
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

/** 直接给商品加库存（转销售单有库存校验） */
async function addStock(productId: number, quantity: number): Promise<void> {
  const s = await db.stock.where('productId').equals(productId).first()
  if (s) await db.stock.update(s.id!, { quantity: s.quantity + quantity, updatedAt: new Date().toISOString() })
  else await db.stock.add({ productId, quantity, updatedAt: new Date().toISOString() })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('删除销售单 → 来源报价单退回未转', () => {
  it('退回 sent、关联字段清零、写审计日志，并可再次转单', async () => {
    const quotesStore = useQuotesStore()
    const salesStore = useSalesStore()
    const a = await seedProduct()
    await addStock(a.id!, 20)

    const res = await quotesStore.createQuote({
      customerId: 0,
      customerName: '散客 王总',
      items: [{ product: a, quantity: 2, price: 1100 }],
      remark: '',
      salesId: 1
    })
    expect(res.ok).toBe(true)
    const quoteId = res.orderId!

    const conv = await quotesStore.convertToSale(quoteId, 1)
    expect(conv.ok).toBe(true)
    const q1 = (await db.quoteOrders.get(quoteId))!
    expect(q1.status).toBe('converted')
    const saleId = q1.convertedSaleOrderId!

    // 删销售单 → 报价单回退
    const del = await salesStore.removeOrder(saleId, 1)
    expect(del.ok).toBe(true)
    expect(del.message).toContain('退回未转状态')

    const q2 = (await db.quoteOrders.get(quoteId))!
    expect(q2.status).toBe('sent')
    expect(q2.convertedSaleOrderId ?? 0).toBe(0)
    expect(q2.convertedSaleNo ?? '').toBe('')
    // 销售单确实没了
    expect(await db.saleOrders.get(saleId)).toBeUndefined()

    // 双向留痕
    const logs = await db.auditLogs.toArray()
    const hit = logs.find(l => l.action === AUDIT_ACTIONS.QUOTE_REVERT)
    expect(hit).toBeTruthy()
    expect(hit!.detail).toContain(q1.orderNo)

    // 退回后可以再次转单（不再被「已转单」拦截）
    await addStock(a.id!, 20)
    const again = await quotesStore.convertToSale(quoteId, 1)
    expect(again.ok).toBe(true)
  })

  it('不是转单来的销售单：正常删除，不误伤任何报价单', async () => {
    const quotesStore = useQuotesStore()
    const salesStore = useSalesStore()
    const a = await seedProduct()
    await addStock(a.id!, 20)

    // 一张「已转单」的报价单（不该被动到）
    const q = await quotesStore.createQuote({
      customerId: 0, customerName: '张三', items: [{ product: a, quantity: 1, price: 1000 }],
      remark: '', salesId: 1
    })
    await addStock(a.id!, 20)
    const conv = await quotesStore.convertToSale(q.orderId!, 1)
    expect(conv.ok).toBe(true)

    // 一张普通销售单
    const customerId = await db.customers.add({
      name: `客户-${uid()}`, contact: '', phone: '', address: '', level: '普通',
      creditLimit: 0, paymentTerm: '', status: 'active', remark: ''
    }) as number
    const created = await salesStore.createOrder({
      customerId,
      salesId: 1,
      items: [{ product: a, quantity: 1, price: 1200 }],
      priceMode: 'wholesale',
      remark: ''
    })
    expect(created.ok).toBe(true)

    const del = await salesStore.removeOrder(created.orderId!, 1)
    expect(del.ok).toBe(true)
    expect(del.message).toBe('已删除')

    // 那张已转单的报价单不受影响
    const keep = (await db.quoteOrders.get(q.orderId!))!
    expect(keep.status).toBe('converted')
  })

  it('已出库的单不让删，来源报价单保持已转（不许误回退）', async () => {
    const quotesStore = useQuotesStore()
    const salesStore = useSalesStore()
    const a = await seedProduct()
    await addStock(a.id!, 20)

    const res = await quotesStore.createQuote({
      customerId: 0, customerName: '李四', items: [{ product: a, quantity: 1, price: 1000 }],
      remark: '', salesId: 1
    })
    const conv = await quotesStore.convertToSale(res.orderId!, 1)
    expect(conv.ok).toBe(true)
    const q = (await db.quoteOrders.get(res.orderId!))!
    const saleId = q.convertedSaleOrderId!

    // 标记成已出库 → 删除必须被拒
    await db.saleOrders.update(saleId, { status: 'done' })
    const del = await salesStore.removeOrder(saleId, 1)
    expect(del.ok).toBe(false)

    const still = (await db.quoteOrders.get(res.orderId!))!
    expect(still.status).toBe('converted')
  })
})

describe('删除采购单 → 来源预采询价单退回未转', () => {
  it('退回 sent、关联字段清零、写审计日志', async () => {
    const quotesStore = useQuotesStore()
    const purchaseStore = usePurchaseStore()
    const a = await seedProduct()

    const res = await quotesStore.createQuote({
      customerId: 0,
      customerName: '某供应商',
      kind: 'purchase',
      items: [{ product: a, quantity: 3, price: 900 }],
      remark: '',
      salesId: 1
    })
    expect(res.ok).toBe(true)
    const quoteId = res.orderId!

    const conv = await quotesStore.convertToPurchase(quoteId, 1)
    expect(conv.ok).toBe(true)
    const q1 = (await db.quoteOrders.get(quoteId))!
    expect(q1.status).toBe('converted')
    const poId = q1.convertedSaleOrderId!

    const del = await purchaseStore.removeOrder(poId, 1)
    expect(del.ok).toBe(true)
    expect(del.message).toContain('退回未转状态')

    const q2 = (await db.quoteOrders.get(quoteId))!
    expect(q2.status).toBe('sent')
    expect(q2.convertedSaleOrderId ?? 0).toBe(0)
    expect(q2.convertedSaleNo ?? '').toBe('')

    // 日志按本单的单号精确匹配（同一文件里前面的用例也写过 QUOTE_REVERT）
    const logs = await db.auditLogs.toArray()
    const hit = logs.find(l => l.action === AUDIT_ACTIONS.QUOTE_REVERT && l.detail.includes(q1.orderNo))
    expect(hit).toBeTruthy()
    expect(hit!.detail).toContain('预采询价单')
    expect(hit!.detail).toContain('删除采购单')
  })
})

describe('两个删除入口都接了回退（源码契约）', () => {
  const cases = [
    { name: '销售单', file: 'src/stores/sales.ts' },
    { name: '采购单', file: 'src/stores/purchase.ts' }
  ]
  for (const c of cases) {
    it(`${c.name}：removeOrder 调用 revertQuoteOnOrderDelete`, async () => {
      const src = readFileSync(resolve(__dirname, '..', c.file), 'utf8')
      expect(src).toContain("from '../utils/quoteLink'")
      expect(src).toContain('revertQuoteOnOrderDelete(')
    })
  }
})
