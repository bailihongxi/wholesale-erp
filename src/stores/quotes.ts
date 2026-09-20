import { defineStore } from 'pinia'
import { db } from '../db'
import { genQuoteNo } from '../utils/orderNo'
import { writeLog, AUDIT_ACTIONS } from '../utils/audit'
import type { Product, QuoteOrder, QuoteOrderItem, Customer } from '../types'

/**
 * 报价单（第二十轮）：客户询价 → 临时报价 → 订单确定后一键转销售单。
 * - 报价不占库存、不影响库存与财务；
 * - 散客（未建档询价）名字直接存 customerName，转销售单时自动补建客户档案；
 * - 转单后回填 convertedSaleOrderId / convertedSaleNo，销售单侧反查来源报价单。
 */
export const useQuotesStore = defineStore('quotes', () => {
  async function createQuote(data: {
    customerId: number
    customerName: string
    items: Array<{ product: Product; quantity: number; price?: number }>
    remark: string
    validDays?: number
    salesId: number
  }): Promise<{ ok: boolean; orderId?: number; message: string }> {
    if (data.items.length === 0) return { ok: false, message: '请选择商品' }
    const name = data.customerName.trim()
    if (data.customerId <= 0 && !name) return { ok: false, message: '请选择客户或填写客户名称' }

    const orderNo = genQuoteNo()
    const now = new Date().toISOString()
    const customerId = data.customerId > 0 ? data.customerId : 0
    let totalAmount = 0

    const orderId = await db.quoteOrders.add({
      orderNo,
      customerId,
      customerName: customerId > 0 ? '' : name,
      quoteDate: now,
      status: 'draft',
      totalAmount: 0,
      validDays: data.validDays && data.validDays > 0 ? data.validDays : undefined,
      remark: data.remark.trim(),
      salesId: data.salesId,
      createdAt: now
    }) as number

    for (const item of data.items) {
      const price = item.price ?? item.product.wholesalePrice
      const subtotal = price * item.quantity
      totalAmount += subtotal
      await db.quoteOrderItems.add({
        quoteOrderId: orderId,
        productId: item.product.id!,
        quantity: item.quantity,
        price,
        subtotal
      })
    }
    await db.quoteOrders.update(orderId, { totalAmount })
    await writeLog(
      data.salesId,
      AUDIT_ACTIONS.QUOTE_CREATE,
      `报价单 ${orderNo}，${customerId > 0 ? `客户ID ${customerId}` : `散客 ${name}`}，共 ${data.items.length} 项，金额 ¥${totalAmount}`
    )
    return { ok: true, orderId, message: '报价单创建成功' }
  }

  async function listQuotes(): Promise<QuoteOrder[]> {
    return await db.quoteOrders.orderBy('quoteDate').reverse().toArray()
  }

  async function getQuote(id: number): Promise<QuoteOrder | undefined> {
    if (id == null || !Number.isFinite(id)) return undefined
    return await db.quoteOrders.get(id)
  }

  async function getQuoteItems(quoteOrderId: number): Promise<QuoteOrderItem[]> {
    if (quoteOrderId == null || !Number.isFinite(quoteOrderId)) return []
    return await db.quoteOrderItems.where('quoteOrderId').equals(quoteOrderId).toArray()
  }

  async function removeQuote(id: number, operatorId: number): Promise<{ ok: boolean; message: string }> {
    const q = await db.quoteOrders.get(id)
    if (!q) return { ok: false, message: '报价单不存在' }
    if (q.status === 'converted') return { ok: false, message: '已转销售单的报价单不能删除' }
    await db.quoteOrderItems.where('quoteOrderId').equals(id).delete()
    await db.quoteOrders.delete(id)
    await writeLog(operatorId, AUDIT_ACTIONS.QUOTE_DELETE, `删除报价单 ${q.orderNo}`)
    return { ok: true, message: '已删除' }
  }

  /** 报价 → 销售单：散客自动补建客户档案，明细与价格整单带过去 */
  async function convertToSale(quoteId: number, salesId: number): Promise<{ ok: boolean; message: string; saleOrderNo?: string }> {
    const q = await db.quoteOrders.get(quoteId)
    if (!q) return { ok: false, message: '报价单不存在' }
    if (q.status === 'converted') return { ok: false, message: '该报价单已转成销售单，不能重复转换' }

    const items = await db.quoteOrderItems.where('quoteOrderId').equals(quoteId).toArray()
    if (!items.length) return { ok: false, message: '报价单没有明细，无法转换' }

    // 1) 散客自动建档：名字直接存客户档案（contact/phone 等留空，后续可补）
    let customerId = q.customerId
    if (customerId <= 0 && q.customerName.trim()) {
      const c: Omit<Customer, 'id'> = {
        name: q.customerName.trim(),
        contact: '',
        phone: '',
        address: '',
        level: '普通',
        creditLimit: 0,
        paymentTerm: '',
        status: 'active',
        remark: '由报价单自动建档'
      }
      customerId = await db.customers.add(c) as number
      await writeLog(salesId, AUDIT_ACTIONS.CUSTOMER_CREATE, `报价单 ${q.orderNo} 转销售单时自动建档客户 ${q.customerName.trim()}`)
    }

    // 2) 组装商品明细（报价单价带过去，可再改）
    const productIds = items.map(it => it.productId)
    const products = await db.products.bulkGet(productIds)
    const pMap = new Map<number, Product | undefined>(productIds.map((id, i) => [id, products[i]]))
    const orderItems = items.map(it => {
      const p = pMap.get(it.productId)
      return {
        product: p ?? ({ id: it.productId } as Product),
        quantity: it.quantity,
        price: it.price
      }
    })

    // 3) 走销售单创建（含库存校验），成功后回填关联
    const { useSalesStore } = await import('./sales')
    const salesStore = useSalesStore()
    const res = await salesStore.createOrder({
      customerId,
      salesId,
      items: orderItems,
      priceMode: 'wholesale',
      remark: q.remark ? `${q.remark}（来源报价单 ${q.orderNo}）` : `来源报价单 ${q.orderNo}`
    })
    if (!res.ok || res.orderId == null) return { ok: false, message: res.message }

    const sale = await db.saleOrders.get(res.orderId)
    await db.quoteOrders.update(quoteId, {
      status: 'converted',
      convertedSaleOrderId: res.orderId,
      convertedSaleNo: sale?.orderNo ?? ''
    })
    await writeLog(
      salesId,
      AUDIT_ACTIONS.QUOTE_CONVERT,
      `报价单 ${q.orderNo} → 销售单 ${sale?.orderNo ?? ''}（金额 ¥${q.totalAmount}）`
    )
    return { ok: true, message: `已转成销售单 ${sale?.orderNo ?? ''}`, saleOrderNo: sale?.orderNo }
  }

  return {
    createQuote, listQuotes, getQuote, getQuoteItems, removeQuote, convertToSale
  }
})
