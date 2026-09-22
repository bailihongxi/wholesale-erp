import { defineStore } from 'pinia'
import { db } from '../db'
import { genPurchaseNo, genStockDocNo } from '../utils/orderNo'
import { writeLog, AUDIT_ACTIONS } from '../utils/audit'
import { useInventoryStore } from './inventory'
import type { Supplier, PurchaseOrder, PurchaseOrderItem, Product, StockHistoryRow } from '../types'

export const usePurchaseStore = defineStore('purchase', () => {
  // ===== 供应商 =====
  async function listSuppliers(): Promise<Supplier[]> {
    return await db.suppliers.toArray()
  }

  // operatorId 可选：传入时会记录操作日志
  async function createSupplier(data: Omit<Supplier, 'id'>, operatorId?: number): Promise<number> {
    const id = await db.suppliers.add(data) as number
    if (operatorId) {
      await writeLog(operatorId, AUDIT_ACTIONS.SUPPLIER_CREATE, `新增供应商 ${data.name}`)
    }
    return id
  }

  async function getSupplier(id: number): Promise<Supplier | undefined> {
    return await db.suppliers.get(id)
  }

  // ===== 采购单 =====
  async function createOrder(data: {
    supplierId: number
    purchaserId: number
    items: Array<{ product: Product; quantity: number; price?: number; isGift?: boolean }>
    remark: string
  }): Promise<{ ok: boolean; orderId?: number; message: string }> {
    if (data.items.length === 0) return { ok: false, message: '请选择商品' }
    let totalAmount = 0
    const orderNo = genPurchaseNo()
    const now = new Date().toISOString()

    const orderId = await db.purchaseOrders.add({
      orderNo,
      supplierId: data.supplierId,
      purchaserId: data.purchaserId,
      orderDate: now,
      status: 'pending',
      totalAmount: 0,
      payStatus: 'unpaid',
      remark: data.remark
    }) as number

    // 批量插入明细（云端模式下 N 次请求 → 1 次）
    const itemRows = data.items.map(item => {
      const isGift = item.isGift === true
      const price = isGift ? 0 : (item.price ?? item.product.purchasePrice)
      const subtotal = price * item.quantity
      if (!isGift) totalAmount += subtotal
      return {
        purchaseOrderId: orderId,
        productId: item.product.id!,
        quantity: item.quantity,
        price,
        subtotal,
        isGift
      }
    })
    await db.purchaseOrderItems.bulkAdd(itemRows)
    await db.purchaseOrders.update(orderId, { totalAmount })
    await writeLog(
      data.purchaserId,
      AUDIT_ACTIONS.PURCHASE_CREATE,
      `采购单 ${orderNo}，供应商ID ${data.supplierId}，共 ${data.items.length} 项，金额 ¥${totalAmount}`
    )
    return { ok: true, orderId, message: '采购单创建成功' }
  }

  async function listOrders(): Promise<PurchaseOrder[]> {
    return await db.purchaseOrders.orderBy('orderDate').reverse().toArray()
  }

  async function getOrder(id: number): Promise<PurchaseOrder | undefined> {
    if (id == null || !Number.isFinite(id)) return undefined
    return await db.purchaseOrders.get(id)
  }

  async function getOrderItems(orderId: number): Promise<PurchaseOrderItem[]> {
    if (orderId == null || !Number.isFinite(orderId)) return []
    return await db.purchaseOrderItems.where('purchaseOrderId').equals(orderId).toArray()
  }

  // ===== 库房入库（验货） =====
  /**
   * 收货入库。每次收货都会生成一张独立的入库单（RK… 批次号），
   * 同一张采购单可以分多次收货（部分入库），多次收货通过 batchNo 分组、
   * 通过 refOrderId 关联回原采购单。
   */
  async function inbound(
    orderId: number,
    actualQuantities: Record<number, number>,
    operatorId: number,
    remark?: string,
    locationId?: number
  ): Promise<{ ok: boolean; message: string; batchNo?: string }> {
    const inv = useInventoryStore()
    const [order, locId] = await Promise.all([
      db.purchaseOrders.get(orderId),
      inv.resolveLocationId(locationId),
    ])
    if (!order) return { ok: false, message: '采购单不存在' }
    if (order.status === 'completed') return { ok: false, message: '该单已完成入库' }
    const loc = await db.locations.get(locId)
    if (!loc) return { ok: false, message: '入库库房不存在，请重新选择' }

    const items = await db.purchaseOrderItems.where('purchaseOrderId').equals(orderId).toArray()
    const productIds = items.map(it => it.productId)
    const [allRecords, allStocks, allLocStocks] = await Promise.all([
      db.stockRecords.where('refOrderId').equals(orderId).toArray(),
      productIds.length ? db.stock.where('productId').anyOf(productIds).toArray() : [],
      productIds.length ? db.locationStock.where('productId').anyOf(productIds).toArray() : [],
    ])

    let allReceived = true
    const batchNo = genStockDocNo('RK')
    const now = new Date().toISOString()
    const stockMap = new Map(allStocks.map(s => [s.productId, s]))
    const locStockMap = new Map(allLocStocks.filter(r => r.locationId === locId).map(r => [r.productId, r]))
    const priorMap: Record<number, number> = {}
    for (const r of allRecords.filter(x => x.type === 'purchase_in')) {
      priorMap[r.productId] = (priorMap[r.productId] ?? 0) + r.quantity
    }

    const stockToUpdate: any[] = [], stockToAdd: any[] = []
    const locStockToUpdate: any[] = [], locStockToAdd: any[] = []
    const recordsToAdd: any[] = []

    for (const item of items) {
      const actual = actualQuantities[item.productId] ?? item.quantity
      const receivedBefore = priorMap[item.productId] ?? 0
      if (receivedBefore + actual < item.quantity) allReceived = false
      if (actual > 0) {
        const s = stockMap.get(item.productId)
        if (s) stockToUpdate.push({ id: s.id!, quantity: s.quantity + actual, updatedAt: now })
        else stockToAdd.push({ productId: item.productId, quantity: actual, updatedAt: now })
        const ls = locStockMap.get(item.productId)
        if (ls) locStockToUpdate.push({ id: ls.id!, quantity: Math.max(0, ls.quantity + actual) })
        else locStockToAdd.push({ productId: item.productId, locationId: locId, quantity: Math.max(0, actual) })
        recordsToAdd.push({
          type: 'purchase_in', refOrderId: orderId, productId: item.productId,
          quantity: actual, operatorId, createdAt: now, batchNo, locationId: locId,
          remark: item.isGift ? [remark, '赠品'].filter(Boolean).join(' · ') : remark,
        })
      }
    }

    await Promise.all([
      ...stockToUpdate.map(u => db.stock.update(u.id, { quantity: u.quantity, updatedAt: u.updatedAt })),
      ...stockToAdd.map(r => db.stock.add(r)),
      ...locStockToUpdate.map(u => db.locationStock.update(u.id, { quantity: u.quantity })),
      ...locStockToAdd.map(r => db.locationStock.add(r)),
      recordsToAdd.length ? db.stockRecords.bulkAdd(recordsToAdd) : Promise.resolve(),
      db.purchaseOrders.update(orderId, { status: allReceived ? 'completed' : 'partial' }),
    ])

    await writeLog(
      operatorId,
      AUDIT_ACTIONS.PURCHASE_INBOUND,
      `入库单 ${batchNo} → ${loc.name}，来源采购单 ${order.orderNo}（${allReceived ? '全部完成' : '部分入库'}）`
    )
    return { ok: true, message: '入库完成', batchNo }
  }

  async function listPendingInbound(): Promise<PurchaseOrder[]> {
    return await db.purchaseOrders.where('status').anyOf(['pending', 'partial']).toArray()
  }

  // ===== 入库历史 =====
  // 每次验货都会在 stockRecords 留下一条 purchase_in 流水，
  // 这里把所有流水与单据、供应商、商品、操作人关联起来，
  // 让库房/老板能回查「什么时候、谁、入了什么货、对应哪张采购单」。
  async function listInboundHistory(): Promise<StockHistoryRow[]> {
    const records = await db.stockRecords.where('type').equals('purchase_in').toArray()
    const orders = await db.purchaseOrders.toArray()
    const suppliers = await db.suppliers.toArray()
    const users = await db.users.toArray()

    const orderMap = new Map(orders.map(o => [o.id!, o]))
    const supplierMap = new Map(suppliers.map(s => [s.id!, s.name]))
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
          partyName: order ? (supplierMap.get(order.supplierId) ?? '未知供应商') : '—',
          productId: r.productId,
          productName: productMap.get(r.productId) ?? `商品#${r.productId}`,
          quantity: Math.abs(r.quantity),
          operatorId: r.operatorId,
          operatorName: userMap.get(r.operatorId) ?? `#${r.operatorId}`,
          createdAt: r.createdAt
        }
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  return {
    listSuppliers, createSupplier, getSupplier,
    createOrder, listOrders, getOrder, getOrderItems,
    inbound, listPendingInbound, listInboundHistory
  }
})
