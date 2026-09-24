import { defineStore } from 'pinia'
import { db } from '../db'
import { genSaleNo, genStockDocNo } from '../utils/orderNo'
import { writeLog, AUDIT_ACTIONS } from '../utils/audit'
import { revertQuoteOnOrderDelete } from '../utils/quoteLink'
import { useInventoryStore } from './inventory'
import type { Customer, SaleOrder, SaleOrderItem, Product, StockHistoryRow } from '../types'

export const useSalesStore = defineStore('sales', () => {
  // ===== 客户（全局缓存，所有页面共用） =====
  let cachedCustomers: Customer[] | null = null
  let customerMap: Map<number, string> | null = null

  async function listCustomers(force = false): Promise<Customer[]> {
    if (cachedCustomers && !force) return cachedCustomers
    cachedCustomers = await db.customers.toArray()
    customerMap = new Map(cachedCustomers.map(c => [c.id!, c.name]))
    return cachedCustomers
  }

  async function getCustomerMap(): Promise<Map<number, string>> {
    if (!customerMap) await listCustomers()
    return customerMap!
  }

  function clearCustomerCache() {
    cachedCustomers = null
    customerMap = null
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
    const [order, locId] = await Promise.all([
      db.saleOrders.get(orderId),
      inv.resolveLocationId(locationId),
    ])
    if (!order) return { ok: false, message: '销售单不存在' }
    if (order.status === 'completed') return { ok: false, message: '该单已完成出库' }
    const loc = await db.locations.get(locId)
    if (!loc) return { ok: false, message: '出库库房不存在，请重新选择' }

    const items = await db.saleOrderItems.where('saleOrderId').equals(orderId).toArray()
    const productIds = items.map(i => i.productId)
    await inv.reconcileProducts(productIds)
    const locStock = await inv.locationStockMap(locId)

    // 库存校验
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
    const batchNo = genStockDocNo('CK')
    const now = new Date().toISOString()

    // 一次性查历史流水和库存
    const [allRecords, allStocks, allLocStocks] = await Promise.all([
      db.stockRecords.where('refOrderId').equals(orderId).toArray(),
      productIds.length ? db.stock.where('productId').anyOf(productIds).toArray() : [],
      productIds.length ? db.locationStock.where('productId').anyOf(productIds).toArray() : [],
    ])
    const stockMap = new Map(allStocks.map(s => [s.productId, s]))
    const locStockMap = new Map(allLocStocks.filter(r => r.locationId === locId).map(r => [r.productId, r]))
    const priorMap: Record<number, number> = {}
    for (const r of allRecords.filter(x => x.type === 'sale_out')) {
      priorMap[r.productId] = (priorMap[r.productId] ?? 0) + Math.abs(r.quantity)
    }

    const stockToUpdate: any[] = []
    const locStockToUpdate: any[] = []
    const recordsToAdd: any[] = []

    for (const item of items) {
      const actual = actualQuantities[item.productId] ?? item.quantity
      const shippedBefore = priorMap[item.productId] ?? 0
      if (shippedBefore + actual < item.quantity) allShipped = false
      if (actual > 0) {
        const s = stockMap.get(item.productId)
        if (s) stockToUpdate.push({ id: s.id!, quantity: s.quantity - actual, updatedAt: now })
        const ls = locStockMap.get(item.productId)
        if (ls) locStockToUpdate.push({ id: ls.id!, quantity: ls.quantity - actual })
        recordsToAdd.push({
          type: 'sale_out', refOrderId: orderId, productId: item.productId,
          quantity: -actual, operatorId, createdAt: now, batchNo, locationId: locId,
          remark: item.isGift ? [remark, '赠品'].filter(Boolean).join(' · ') : remark,
        })
      }
    }

    await Promise.all([
      ...stockToUpdate.map(u => db.stock.update(u.id, { quantity: u.quantity, updatedAt: u.updatedAt })),
      ...locStockToUpdate.map(u => db.locationStock.update(u.id, { quantity: u.quantity })),
      recordsToAdd.length ? db.stockRecords.bulkAdd(recordsToAdd) : Promise.resolve(),
      db.saleOrders.update(orderId, { status: allShipped ? 'completed' : 'partial' }),
    ])

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
    const allProducts = productIds.length
      ? await db.products.where('id').anyOf(productIds).toArray()
      : []
    const productMap = new Map(allProducts.map(p => [p.id!, `${p.brand} ${p.model}`]))

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

  /** 修改销售单（仅未出库状态） */
  async function updateOrder(
    orderId: number,
    items: Array<{ productId: number; quantity: number; price: number; isGift?: boolean }>,
    remark?: string
  ): Promise<{ ok: boolean; message: string }> {
    const order = await db.saleOrders.get(orderId)
    if (!order) return { ok: false, message: '销售单不存在' }
    if (order.status !== 'pending') return { ok: false, message: '该单已出库，不能修改' }
    if (!items.length) return { ok: false, message: '明细不能为空' }

    // 删除旧明细，插入新明细
    await db.saleOrderItems.where('saleOrderId').equals(orderId).delete()
    await db.saleOrderItems.bulkAdd(items.map(it => ({
      saleOrderId: orderId,
      productId: it.productId,
      quantity: it.quantity,
      price: it.price,
      subtotal: it.isGift ? 0 : it.quantity * it.price,
      isGift: it.isGift ?? false
    })))

    // 更新订单总额
    const totalAmount = items.reduce((s, it) => s + (it.isGift ? 0 : it.quantity * it.price), 0)
    await db.saleOrders.update(orderId, {
      totalAmount,
      remark: remark ?? order.remark
    })

    return { ok: true, message: '已保存' }
  }

  /**
   * 删除销售单（仅老板 / 系统管理员可用，入口在详情页「删除」按钮）。
   *
   * 只允许删「待出库」的单：一旦部分或全部出库，库存已经动过，直接删会让
   * 库存与单据对不上 —— 那种情况必须先撤回出库单。store 层照旧做状态校验，
   * 避免绕过界面误删。
   */
  async function removeOrder(orderId: number, operatorId: number): Promise<{ ok: boolean; message: string }> {
    const order = await db.saleOrders.get(orderId)
    if (!order) return { ok: false, message: '销售单不存在' }
    if (order.status !== 'pending') {
      return { ok: false, message: '该单已出库，不能删除（请先撤回对应的出库单）' }
    }
    // 双向联动（V2.1-1.4）：本单若是报价单转来的，先把来源报价单退回未转，
    // 否则它会被永久钉在「已转单」（不能再改、不能再转），变成孤儿单据。
    const rev = await revertQuoteOnOrderDelete(orderId, order.orderNo, 'sale', operatorId)
    await db.saleOrderItems.where('saleOrderId').equals(orderId).delete()
    await db.saleOrders.delete(orderId)
    await writeLog(operatorId, AUDIT_ACTIONS.SALE_DELETE, `删除销售单 ${order.orderNo}`)
    return {
      ok: true,
      message: rev.reverted ? `已删除，来源报价单 ${rev.quoteNo} 已退回未转状态` : '已删除'
    }
  }

  return {
    listCustomers, createCustomer, getCustomer, getCustomerMap, clearCustomerCache,
    createOrder, listOrders, getOrder, getOrderItems, updateOrder, removeOrder,
    outbound, listPendingOutbound, listOutboundHistory
  }
})
