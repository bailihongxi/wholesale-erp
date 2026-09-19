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
    items: Array<{ product: Product; quantity: number; price?: number }>
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

    for (const item of data.items) {
      // 允许开单人临时改价（改价后以表单传入的 price 为准）
      const price = item.price ?? item.product.purchasePrice
      const subtotal = price * item.quantity
      totalAmount += subtotal
      await db.purchaseOrderItems.add({
        purchaseOrderId: orderId,
        productId: item.product.id!,
        quantity: item.quantity,
        price,
        subtotal
      })
    }
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
    const order = await db.purchaseOrders.get(orderId)
    if (!order) return { ok: false, message: '采购单不存在' }
    if (order.status === 'completed') return { ok: false, message: '该单已完成入库' }

    // 入库库房：页面上选定，未传则落到默认库房
    const locId = await inv.resolveLocationId(locationId)
    const loc = await db.locations.get(locId)
    if (!loc) return { ok: false, message: '入库库房不存在，请重新选择' }

    const items = await db.purchaseOrderItems.where('purchaseOrderId').equals(orderId).toArray()
    let allReceived = true
    const batchNo = genStockDocNo('RK')

    for (const item of items) {
      const actual = actualQuantities[item.productId] ?? item.quantity
      // 累加本次之前已收的数量，支持「分次入库」：
      // 多次收货累计达到订单数量才判定为完成，否则一直停留在 partial。
      const prior = await db.stockRecords
        .where('refOrderId').equals(orderId)
        .filter(r => r.type === 'purchase_in' && r.productId === item.productId)
        .toArray()
      const receivedBefore = prior.reduce((s, r) => s + r.quantity, 0)
      if (receivedBefore + actual < item.quantity) allReceived = false
      if (actual > 0) {
        // 增加库存
        const stock = await db.stock.where('productId').equals(item.productId).first()
        if (stock) {
          await db.stock.update(stock.id!, {
            quantity: stock.quantity + actual,
            updatedAt: new Date().toISOString()
          })
        } else {
          await db.stock.add({
            productId: item.productId,
            quantity: actual,
            updatedAt: new Date().toISOString()
          })
        }
        // 同时维护所选库房的库存分布（入库一律进用户选定的库房）
        await inv.applyLocationDelta(item.productId, locId, actual)
        // 记流水（带批次号，便于按单查询 / 撤回）
        await db.stockRecords.add({
          type: 'purchase_in',
          refOrderId: orderId,
          productId: item.productId,
          quantity: actual,
          operatorId,
          createdAt: new Date().toISOString(),
          batchNo,
          locationId: locId,
          remark
        })
      }
    }

    await db.purchaseOrders.update(orderId, { status: allReceived ? 'completed' : 'partial' })
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
