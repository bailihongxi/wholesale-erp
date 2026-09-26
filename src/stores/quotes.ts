import { defineStore } from 'pinia'
import { db } from '../db'
import { genQuoteNo } from '../utils/orderNo'
import { writeLog, AUDIT_ACTIONS } from '../utils/audit'
import type { Product, QuoteOrder, QuoteOrderItem, Customer } from '../types'
import { safeBulkAdd } from '../utils/bulkWrite'

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
    kind?: 'sale' | 'purchase'
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
      kind: data.kind || 'sale',
      createdAt: now
    }) as number

    // A2 档：明细一次批量写（原实现逐行 insert，N 行就是 N 次请求）
    const rows = data.items.map(item => {
      const price = item.price ?? item.product.wholesalePrice
      const subtotal = price * item.quantity
      totalAmount += subtotal
      return { quoteOrderId: orderId, productId: item.product.id!, quantity: item.quantity, price, subtotal }
    })
    await safeBulkAdd(db.quoteOrderItems as any, rows)
    await db.quoteOrders.update(orderId, { totalAmount })
    await writeLog(
      data.salesId,
      AUDIT_ACTIONS.QUOTE_CREATE,
      `报价单 ${orderNo}，${customerId > 0 ? `客户ID ${customerId}` : `散客 ${name}`}，共 ${data.items.length} 项，金额 ¥${totalAmount}`
    )
    return { ok: true, orderId, message: '报价单创建成功' }
  }

  async function listQuotes(kind: 'sale' | 'purchase' = 'sale'): Promise<QuoteOrder[]> {
    const all = await db.quoteOrders.orderBy('quoteDate').reverse().toArray()
    return all.filter(q => (q as any).kind === kind || ((q as any).kind == null && kind === 'sale'))
  }

  async function getQuote(id: number): Promise<QuoteOrder | undefined> {
    if (id == null || !Number.isFinite(id)) return undefined
    return await db.quoteOrders.get(id)
  }

  async function getQuoteItems(quoteOrderId: number): Promise<QuoteOrderItem[]> {
    if (quoteOrderId == null || !Number.isFinite(quoteOrderId)) return []
    return await db.quoteOrderItems.where('quoteOrderId').equals(quoteOrderId).toArray()
  }

  /**
   * 修改报价单 / 预采询价单（数量、单价、备注）。
   *
   * 与销售单、采购单的 updateOrder 同套约定：
   *  - 已转成正式单据（converted）的单子不允许再改，避免与已生成的销售/采购单对不上；
   *  - 明细整单替换（先删后加），金额按明细重算，保证单头 totalAmount 与明细一致；
   *  - 写审计日志。
   */
  async function updateQuote(
    quoteId: number,
    items: Array<{ productId: number; quantity: number; price: number }>,
    remark: string,
    operatorId: number
  ): Promise<{ ok: boolean; message: string }> {
    const q = await db.quoteOrders.get(quoteId)
    if (!q) return { ok: false, message: '报价单不存在' }
    if (q.status === 'converted') return { ok: false, message: '已转销售单/采购单的报价单不能修改' }
    if (!items.length) return { ok: false, message: '明细不能为空' }

    await db.quoteOrderItems.where('quoteOrderId').equals(quoteId).delete()
    let totalAmount = 0
    const rows = items.map(it => {
      const quantity = Number(it.quantity) || 0
      const price = Number(it.price) || 0
      const subtotal = quantity * price
      totalAmount += subtotal
      return { quoteOrderId: quoteId, productId: it.productId, quantity, price, subtotal }
    })
    await safeBulkAdd(db.quoteOrderItems as any, rows)

    await db.quoteOrders.update(quoteId, { totalAmount, remark: remark ?? '' })
    await writeLog(
      operatorId,
      AUDIT_ACTIONS.QUOTE_UPDATE,
      `修改报价单 ${q.orderNo}，共 ${items.length} 项，金额 ¥${totalAmount}`
    )
    return { ok: true, message: '已保存' }
  }

  /**
   * 销售「确认询价单」（V2.1-2，窗口买票 / 售票员闭环里的「售票员确认」那一步）：
   * `draft → sent`，**不动明细**，只回填确认人与确认时间。
   *
   * 为什么要单独一个动作而不是复用 updateQuote：
   *  - 确认是「不改单直接放行」的场景（报价没问题就确认），改单是另一回事；
   *  - 状态流转要留痕（审计 QUOTE_CONFIRM），混在 QUOTE_UPDATE 里分不清是谁确认的；
   *  - 经销商侧的「转销售单」按钮以 `status === 'sent'` 为开关，
   *    这一步就是把闸门交到销售手上——没确认前经销商转不了单。
   */
  async function confirmQuote(quoteId: number, operatorId: number): Promise<{ ok: boolean; message: string }> {
    const q = await db.quoteOrders.get(quoteId)
    if (!q) return { ok: false, message: '报价单不存在' }
    if (q.status === 'converted') return { ok: false, message: '已转成销售单，无需再确认' }
    if (q.status === 'void') return { ok: false, message: '已失效的报价单不能确认' }
    if (q.status === 'sent') return { ok: false, message: '该报价单已确认' }

    const items = await db.quoteOrderItems.where('quoteOrderId').equals(quoteId).toArray()
    if (!items.length) return { ok: false, message: '报价单没有明细，无法确认' }

    const now = new Date().toISOString()
    // ⚠️ confirmedBy / confirmedAt 是 V2.1-2 新加的列，要用户先在 SQL Editor 跑过
    // supabase/migrate_v2.1-2_realtime_quote_orders.sql 才存在。没跑脚本时整条 update 会被
    // PostgREST 拒掉（column does not exist），确认就静默失败 —— 老板只看到「点了没反应」。
    // 所以这里降级：写不进去就只改状态，确认本身照样生效，留痕字段等脚本跑过后自动补上。
    try {
      await db.quoteOrders.update(quoteId, { status: 'sent', confirmedBy: operatorId, confirmedAt: now })
    } catch {
      await db.quoteOrders.update(quoteId, { status: 'sent' })
    }
    await writeLog(
      operatorId,
      AUDIT_ACTIONS.QUOTE_CONFIRM,
      `确认询价单 ${q.orderNo}，共 ${items.length} 项，金额 ¥${q.totalAmount}`
    )
    return { ok: true, message: '已确认，经销商现在可以转销售单' }
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
    try {
      await db.quoteOrders.update(quoteId, {
        status: 'converted',
        convertedSaleOrderId: res.orderId,
        convertedSaleNo: sale?.orderNo ?? ''
      })
    } catch (e: any) {
      // V2.1-2.32：销售单已建成但报价单回填失败时必须提示——
      // 原来异常直接穿出去无任何提示，用户以为「没转成」，去列表里找一张
      // 根本不存在的已转单（孤儿单 BJ20260924-114 就是这么产生的观感来源之一）
      console.error('[quotes] 转单回填报价单状态失败', e)
      return {
        ok: false,
        message: `销售单 ${sale?.orderNo ?? ''} 已创建，但报价单状态回填失败：${e?.message ?? '请重试'}。请勿重复转换，联系管理员核查`
      }
    }
    await writeLog(
      salesId,
      AUDIT_ACTIONS.QUOTE_CONVERT,
      `报价单 ${q.orderNo} → 销售单 ${sale?.orderNo ?? ''}（金额 ¥${q.totalAmount}）`
    )
    return { ok: true, message: `已转成销售单 ${sale?.orderNo ?? ''}`, saleOrderNo: sale?.orderNo }
  }

  /** 预采询价 → 采购单：供应商自动建档，明细与报价带过去 */
  async function convertToPurchase(quoteId: number, purchaserId: number): Promise<{ ok: boolean; message: string; purchaseOrderNo?: string }> {
    const q = await db.quoteOrders.get(quoteId)
    if (!q) return { ok: false, message: '询价单不存在' }
    if (q.status === 'converted') return { ok: false, message: '该询价单已转成采购单，不能重复转换' }

    const items = await db.quoteOrderItems.where('quoteOrderId').equals(quoteId).toArray()
    if (!items.length) return { ok: false, message: '询价单没有明细，无法转换' }

    // 供应商自动建档
    let supplierId = q.customerId
    if (supplierId <= 0 && q.customerName.trim()) {
      const s = await db.suppliers.add({
        name: q.customerName.trim(),
        contact: '',
        phone: '',
        address: '',
        paymentTerm: '',
        remark: '由预采询价单自动建档'
      }) as number
      supplierId = s
    }

    const productIds = items.map(it => it.productId)
    const products = await db.products.bulkGet(productIds)
    const pMap = new Map<number, Product | undefined>(productIds.map((id, i) => [id, products[i]]))
    const orderItems = items.map(it => {
      const p = pMap.get(it.productId)
      return { product: p ?? ({ id: it.productId } as Product), quantity: it.quantity, price: it.price }
    })

    const { usePurchaseStore } = await import('./purchase')
    const purchaseStore = usePurchaseStore()
    const res = await purchaseStore.createOrder({
      supplierId,
      purchaserId,
      items: orderItems,
      remark: q.remark ? `${q.remark}（来源预采询价单 ${q.orderNo}）` : `来源预采询价单 ${q.orderNo}`
    })
    if (!res.ok || res.orderId == null) return { ok: false, message: res.message }

    const po = await db.purchaseOrders.get(res.orderId)
    await db.quoteOrders.update(quoteId, {
      status: 'converted',
      convertedSaleOrderId: res.orderId,
      convertedSaleNo: po?.orderNo ?? ''
    })
    await writeLog(
      purchaserId,
      AUDIT_ACTIONS.QUOTE_CONVERT,
      `预采询价单 ${q.orderNo} → 采购单 ${po?.orderNo ?? ''}（金额 ¥${q.totalAmount}）`
    )
    return { ok: true, message: `已转成采购单 ${po?.orderNo ?? ''}`, purchaseOrderNo: po?.orderNo }
  }

  return {
    createQuote, listQuotes, getQuote, getQuoteItems, updateQuote, confirmQuote, removeQuote, convertToSale, convertToPurchase
  }
})
