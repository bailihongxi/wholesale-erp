import { defineStore } from 'pinia'
import { db } from '../db'
import { genSaleNo, genStockDocNo } from '../utils/orderNo'
import { writeLog, AUDIT_ACTIONS } from '../utils/audit'
import { useInventoryStore } from './inventory'
import type { Customer, SaleOrder, SaleOrderItem, Product, StockHistoryRow } from '../types'

export const useSalesStore = defineStore('sales', () => {
  // ===== 客户 =====
  async function listCustomers(): Promise<Customer[]> {
    return await db.customers.toArray()
  }

  // operatorId 可选：传入时会记录操作日志
  async function createCustomer(data: Omit<Customer, 'id'>, operatorId?: number): Promise<number> {
    const id = await db.customers.add(data) as number
    if (operatorId) {
      await writeLog(operatorId, AUDIT_ACTIONS.CUSTOMER_CREATE, `新增客户 ${data.name}${data.loginPhone ? `（经销商账号 ${data.loginPhone}）` : ''}`)
    }
    return id
  }

  async function getCustomer(id: number): Promise<Customer | undefined> {
    return await db.customers.get(id)
  }

  // ===== 销售单 =====
  async function createOrder(data: {
    customerId: number
    salesId: number
    items: Array<{ product: Product; quantity: number; price?: number; isGift?: boolean }>
    /** 批发 / 零售 */
    priceMode?: 'wholesale' | 'retail'
    remark: string
  }): Promise<{ ok: boolean; orderId?: number; message: string }> {
    if (data.items.length === 0) return { ok: false, message: '请选择商品' }

    // 检查库存是否够
    const { useProductStore } = await import('./product')
    const productStore = useProductStore()
    // 库存检查并行查
    const stockResults = await Promise.all(
      data.items.map(it => productStore.getStock(it.product.id!))
    )
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]
      if (stockResults[i] < item.quantity) {
        return { ok: false, message: `${productStore.productName(item.product)} 库存不足（现有 ${stockResults[i]}）` }
      }
    }

    let totalAmount = 0
    const orderNo = genSaleNo()
    const now = new Date().toISOString()

    const orderId = await db.saleOrders.add({
      orderNo,
      customerId: data.customerId,
      salesId: data.salesId,
      orderDate: now,
      status: 'pending',
      totalAmount: 0,
      receiveStatus: 'unreceived',
      remark: data.remark,
      priceMode: data.priceMode ?? 'wholesale'
    }) as number

    // 批量插入明细
    const mode = data.priceMode ?? 'wholesale'
    const itemRows = data.items.map(item => {
      const isGift = item.isGift === true
      const price = isGift ? 0 : (item.price ?? (mode === 'retail' ? item.product.retailPrice : item.product.wholesalePrice))
      const subtotal = price * item.quantity
      if (!isGift) totalAmount += subtotal
      return {
        saleOrderId: orderId,
        productId: item.product.id!,
        quantity: item.quantity,
        price,
        subtotal,
        isGift
      }
    })
    await db.saleOrderItems.bulkAdd(itemRows)
    await db.saleOrders.update(orderId, { totalAmount })
    await writeLog(
      data.salesId,
      AUDIT_ACTIONS.SALE_CREATE,
      `销售单 ${orderNo}，客户ID ${data.customerId}，共 ${data.items.length} 项，金额 ¥${totalAmount}`
    )
    return { ok: true, orderId, message: '销售单创建成功' }
  }

  async function listOrders(): Promise<SaleOrder[]> {
    return await db.saleOrders.orderBy('orderDate').reverse().toArray()
  }

  async function getOrder(id: number): Promise<SaleOrder | undefined> {
    if (id == null || !Number.isFinite(id)) return undefined
    return await db.saleOrders.get(id)
  }

  async function getOrderItems(orderId: number): Promise<SaleOrderItem[]> {
    if (orderId == null || !Number.isFinite(orderId)) return []
    return await db.saleOrderItems.where('saleOrderId').equals(orderId).toArray()
  }

  // ===== 库房出库（拣货发货） =====
  async function outbound(orderId: number, actualQuantities: Record<number, number>, operatorId: number, remark?: string, locationId?: number): Promise<{ ok: boolean; message: string; batchNo?: string }> {
    const inv = useInventoryStore()
    const order = await db.saleOrders.get(orderId)
    if (!order) return { ok: false, message: '销售单不存在' }
    if (order.status === 'completed') return { ok: false, message: '该单已完成出库' }

    // 出库库房：页面上选定，未传则落到默认库房
    const locId = await inv.resolveLocationId(locationId)
    const loc = await db.locations.get(locId)
    if (!loc) return { ok: false, message: '出库库房不存在，请重新选择' }

    const items = await db.saleOrderItems.where('saleOrderId').equals(orderId).toArray()

    // 出库前按「所选库房」的现有库存校验：该库房不够就整单拒绝，
    // 避免把别处库房的货算进来（总库存够但本库房不够的情况）。
    // 先做一次分布自愈，兼容「只写过总库存、没有库房分布」的老数据。
    await inv.reconcileProducts(items.map(i => i.productId))
    const locStock = await inv.locationStockMap(locId)
    for (const item of items) {
      const actual = actualQuantities[item.productId] ?? item.quantity
      if (actual <= 0) continue
      const have = locStock[item.productId] ?? 0
      if (actual > have) {
        const p = await db.products.get(item.productId)
        const nm = p ? `${p.brand ?? ''} ${p.model ?? ''}`.trim() : `商品#${item.productId}`
        return { ok: false, message: `${nm} 在「${loc.name}」仅 ${have}，不够发货 ${actual}` }
      }
    }

    let allShipped = true
    // 每次发货生成一张独立出库单（CK…），部分发货时多次出库各成一单，均关联本销售单
    const batchNo = genStockDocNo('CK')

    for (const item of items) {
      const actual = actualQuantities[item.productId] ?? item.quantity
      // 累加本次之前已发的数量，支持「分次出库」：
      // 多次发货累计达到订单数量才判定为完成（流水里出库记为负数，取绝对值累加）。
      const prior = await db.stockRecords
        .where('refOrderId').equals(orderId)
        .filter(r => r.type === 'sale_out' && r.productId === item.productId)
        .toArray()
      const shippedBefore = prior.reduce((s, r) => s + Math.abs(r.quantity), 0)
      if (shippedBefore + actual < item.quantity) allShipped = false
      if (actual > 0) {
        // 扣减库存
        const stock = await db.stock.where('productId').equals(item.productId).first()
        if (stock) {
          await db.stock.update(stock.id!, {
            quantity: stock.quantity - actual,
            updatedAt: new Date().toISOString()
          })
        }
        // 同时维护所选库房的库存分布（出库一律从用户选定的库房出）
        await inv.applyLocationDelta(item.productId, locId, -actual)
        // 记流水（出库记负数）；赠品行备注附加「赠品」标记
        await db.stockRecords.add({
          type: 'sale_out',
          refOrderId: orderId,
          productId: item.productId,
          quantity: -actual,
          operatorId,
          createdAt: new Date().toISOString(),
          batchNo,
          locationId: locId,
          remark: item.isGift ? [remark, '赠品'].filter(Boolean).join(' · ') : remark
        })
      }
    }

    await db.saleOrders.update(orderId, { status: allShipped ? 'completed' : 'partial' })
    await writeLog(
      operatorId,
      AUDIT_ACTIONS.SALE_OUTBOUND,
      `出库单 ${batchNo} ← ${loc.name}，来源销售单 ${order.orderNo}（${allShipped ? '全部完成' : '部分出库'}）`
    )
    return { ok: true, message: '出库完成', batchNo }
  }

  async function listPendingOutbound(): Promise<SaleOrder[]> {
    return await db.saleOrders.where('status').anyOf(['pending', 'partial']).toArray()
  }

  // ===== 出库历史 =====
  // 每次拣货发货都会在 stockRecords 留下一条 sale_out 流水（存负数），
  // 这里关联单据、客户、商品、操作人，便于回查发货痕迹。
  async function listOutboundHistory(): Promise<StockHistoryRow[]> {
    const records = await db.stockRecords.where('type').equals('sale_out').toArray()
    const orders = await db.saleOrders.toArray()
    const customers = await db.customers.toArray()
    const users = await db.users.toArray()

    const orderMap = new Map(orders.map(o => [o.id!, o]))
    const customerMap = new Map(customers.map(c => [c.id!, c.name]))
    const userMap = new Map(users.map(u => [u.id!, u.name]))

    const productIds = [...new Set(records.map(r => r.productId))]
    const productMap = new Map<number, string>()
    for (const pid of productIds) {
      const p = await db.products.get(pid)
      if (p) productMap.set(pid, `${p.brand} ${p.model}`)
    }

    return records
      .map(r => {
        const order = orderMap.get(r.refOrderId)
        return {
          id: r.id!,
          orderId: r.refOrderId,
          orderNo: order?.orderNo ?? `已删除单据#${r.refOrderId}`,
          partyName: order ? (customerMap.get(order.customerId) ?? '未知客户') : '—',
          productId: r.productId,
          productName: productMap.get(r.productId) ?? `商品#${r.productId}`,
          // 出库流水存负数，历史展示统一取绝对值
          quantity: Math.abs(r.quantity),
          operatorId: r.operatorId,
          operatorName: userMap.get(r.operatorId) ?? `#${r.operatorId}`,
          createdAt: r.createdAt
        }
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  return {
    listCustomers, createCustomer, getCustomer,
    createOrder, listOrders, getOrder, getOrderItems,
    outbound, listPendingOutbound, listOutboundHistory
  }
})
