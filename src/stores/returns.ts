/**
 * 退换货 store：销售退货 / 采购退货 统一单据管理。
 *
 * 业务约定：
 *  - 销售退货（客户退货）：货物回流到「总仓」(locationId=1)，总库存 +，
 *    财务上记一笔 `refund`（客户 Credit），冲减该销售单的应收余额。
 *  - 采购退货（退给供应商）：货物从「总仓」流出，总库存 −，
 *    财务上记一笔 `supplier_credit`，冲减该采购单的应付余额。
 *  - 两类退货都写入 stockRecords（sale_return / purchase_return）留痕，
 *    并各自落一张退货单（returnOrders）+ 明细（returnItems），可在历史里回查。
 *  - 库存一致性沿用既有约定：总库存 = 各库位之和；退货同时改总库存与总仓分布。
 */
import { defineStore } from 'pinia'
import { db } from '../db'
import { writeLog, AUDIT_ACTIONS } from '../utils/audit'
import { genStockDocNo } from '../utils/orderNo'
import { useInventoryStore } from './inventory'

/** 取商品名（品牌+型号），用于校验提示文案 */
async function productNameOf(productId: number): Promise<string> {
  const p = await db.products.get(productId)
  if (!p) return `商品#${productId}`
  return `${p.brand ?? ''} ${p.model ?? ''}`.trim() || `商品#${productId}`
}

export interface ReturnLine {
  productId: number
  /** 退货数量（正数） */
  quantity: number
  /** 退货成交单价（销售退货默认原售价、采购退货默认原进价） */
  price: number
  /** 退货原因：质量问题 / 尺码不符 / 发错货 等 */
  reason?: string
}

export interface ReturnRow {
  orderNo: string
  kind: 'sale' | 'purchase'
  refOrderId: number
  refOrderNo: string
  partyName: string
  date: string
  operatorName: string
  totalAmount: number
  itemCount: number
  remark?: string
  items: Array<{ productName: string; quantity: number; price: number; amount: number; reason?: string }>
}

export interface ReturnDetail extends ReturnRow {
  id: number
}

export const useReturnsStore = defineStore('returns', () => {

  // ---------------------------------------------------------- 销售退货
  async function salesReturn(params: {
    refOrderId: number
    items: ReturnLine[]
    operatorId: number
    remark?: string
    /** 退回的库房（不传则落默认库房） */
    locationId?: number
  }): Promise<{ ok: boolean; message: string; orderNo?: string }> {
    const lines = params.items.filter(l => l.quantity > 0)
    if (!lines.length) return { ok: false, message: '请填写退货数量' }
    const order = await db.saleOrders.get(params.refOrderId)
    if (!order) return { ok: false, message: '销售单不存在' }

    const srcItems = await db.saleOrderItems.where('saleOrderId').equals(params.refOrderId).toArray()
    const srcMap = new Map(srcItems.map(i => [i.productId, i]))
    let total = 0
    for (const l of lines) {
      const src = srcMap.get(l.productId)
      if (!src) return { ok: false, message: '商品不在该销售单中' }
      if (l.quantity > src.quantity) {
        return { ok: false, message: `${await productNameOf(l.productId)} 退货数量超过销售数量` }
      }
      total += l.quantity * l.price
    }

    const inv = useInventoryStore()
    const locId = await inv.resolveLocationId(params.locationId)
    const loc = await db.locations.get(locId)
    if (!loc) return { ok: false, message: '退回库房不存在，请重新选择' }
    const orderNo = genStockDocNo('TH')
    const now = new Date().toISOString()
    const id = await db.returnOrders.add({
      orderNo, kind: 'sale', refOrderId: params.refOrderId, refOrderNo: order.orderNo,
      partyId: order.customerId, date: now, operatorId: params.operatorId, status: 'done',
      totalAmount: total, remark: params.remark
    })

    for (const l of lines) {
      await db.returnItems.add({
        returnOrderId: id as number, productId: l.productId,
        quantity: l.quantity, price: l.price, amount: l.quantity * l.price, reason: l.reason
      })
      // 货物回流：总库存 +，所选库房分布 +
      await inv.applyLocationDelta(l.productId, locId, l.quantity)
      const stock = await db.stock.where('productId').equals(l.productId).first()
      if (stock) {
        await db.stock.update(stock.id!, { quantity: stock.quantity + l.quantity, updatedAt: now })
      } else {
        await db.stock.add({ productId: l.productId, quantity: l.quantity, updatedAt: now })
      }
      await db.stockRecords.add({
        type: 'sale_return', refOrderId: params.refOrderId, productId: l.productId,
        quantity: l.quantity, operatorId: params.operatorId, createdAt: now,
        locationId: locId, batchNo: orderNo, remark: l.reason
      })
    }
    // 财务红冲：退货金额作为客户 Credit，冲减应收余额（listReceivables 计入贷方）
    await db.payments.add({
      type: 'refund', refOrderId: params.refOrderId, counterpartyId: order.customerId,
      amount: total, payDate: now, operatorId: params.operatorId, remark: `销售退货 ${orderNo}`
    })
    await writeLog(params.operatorId, AUDIT_ACTIONS.RETURN_SALE, `销售退货单 ${orderNo} → ${loc.name}（来源 ${order.orderNo}，退货 ¥${total}）`)
    return { ok: true, message: `已生成销售退货单 ${orderNo}`, orderNo }
  }

  // ---------------------------------------------------------- 采购退货
  async function purchaseReturn(params: {
    refOrderId: number
    items: ReturnLine[]
    operatorId: number
    remark?: string
    /** 从哪个库房退回（不传则用默认库房） */
    locationId?: number
  }): Promise<{ ok: boolean; message: string; orderNo?: string }> {
    const lines = params.items.filter(l => l.quantity > 0)
    if (!lines.length) return { ok: false, message: '请填写退货数量' }
    const order = await db.purchaseOrders.get(params.refOrderId)
    if (!order) return { ok: false, message: '采购单不存在' }

    const inv = useInventoryStore()
    const locId = await inv.resolveLocationId(params.locationId)
    const loc = await db.locations.get(locId)
    if (!loc) return { ok: false, message: '退回库房不存在，请重新选择' }
    await inv.reconcileProducts(params.items.map(l => l.productId))
    const locStock = await inv.locationStockMap(locId)

    const srcItems = await db.purchaseOrderItems.where('purchaseOrderId').equals(params.refOrderId).toArray()
    const srcMap = new Map(srcItems.map(i => [i.productId, i]))
    let total = 0
    for (const l of lines) {
      const src = srcMap.get(l.productId)
      if (!src) return { ok: false, message: '商品不在该采购单中' }
      if (l.quantity > src.quantity) {
        return { ok: false, message: `${await productNameOf(l.productId)} 退货数量超过采购数量` }
      }
      // 退货需要实物在手：该库房库存不足以退回则拒绝
      const have = locStock[l.productId] ?? 0
      if (have < l.quantity) {
        return { ok: false, message: `「${loc.name}」库存仅 ${have} 件，不足以退回 ${l.quantity}` }
      }
      total += l.quantity * l.price
    }

    const orderNo = genStockDocNo('TH')
    const now = new Date().toISOString()
    const id = await db.returnOrders.add({
      orderNo, kind: 'purchase', refOrderId: params.refOrderId, refOrderNo: order.orderNo,
      partyId: order.supplierId, date: now, operatorId: params.operatorId, status: 'done',
      totalAmount: total, remark: params.remark
    })

    for (const l of lines) {
      await db.returnItems.add({
        returnOrderId: id as number, productId: l.productId,
        quantity: l.quantity, price: l.price, amount: l.quantity * l.price, reason: l.reason
      })
      // 货物退回供应商：总库存 −，所选库房分布 −
      await inv.applyLocationDelta(l.productId, locId, -l.quantity)
      const stock = await db.stock.where('productId').equals(l.productId).first()
      if (stock) {
        await db.stock.update(stock.id!, { quantity: Math.max(0, stock.quantity - l.quantity), updatedAt: now })
      }
      await db.stockRecords.add({
        type: 'purchase_return', refOrderId: params.refOrderId, productId: l.productId,
        quantity: -l.quantity, operatorId: params.operatorId, createdAt: now,
        locationId: locId, batchNo: orderNo, remark: l.reason
      })
    }
    // 财务红冲：退货金额作为供应商 Credit，冲减应付余额（listPayables 计入贷方）
    await db.payments.add({
      type: 'supplier_credit', refOrderId: params.refOrderId, counterpartyId: order.supplierId,
      amount: total, payDate: now, operatorId: params.operatorId, remark: `采购退货 ${orderNo}`
    })
    await writeLog(params.operatorId, AUDIT_ACTIONS.RETURN_PURCHASE, `采购退货单 ${orderNo} ← ${loc.name}（来源 ${order.orderNo}，退货 ¥${total}）`)
    return { ok: true, message: `已生成采购退货单 ${orderNo}`, orderNo }
  }

  // ---------------------------------------------------------- 查询
  async function listReturns(kind?: 'sale' | 'purchase'): Promise<ReturnRow[]> {
    const orders = await db.returnOrders.toArray()
    if (!orders.length) return []
    const filtered = kind ? orders.filter(o => o.kind === kind) : orders
    if (!filtered.length) return []

    const users = await db.users.toArray()
    const userMap = new Map(users.map(u => [u.id!, u.name]))
    const customers = await db.customers.toArray()
    const suppliers = await db.suppliers.toArray()
    const customerMap = new Map(customers.map(c => [c.id!, c.name]))
    const supplierMap = new Map(suppliers.map(s => [s.id!, s.name]))
    const products = await db.products.toArray()
    const pmap = new Map(products.map(p => [p.id!, `${p.brand} ${p.model}`.trim()]))

    const rows: ReturnRow[] = []
    for (const o of filtered) {
      const items = await db.returnItems.where('returnOrderId').equals(o.id!).toArray()
      const detail = items.map(it => ({
        productName: pmap.get(it.productId) ?? `商品#${it.productId}`,
        quantity: it.quantity,
        price: it.price,
        amount: it.amount,
        reason: it.reason
      }))
      const partyName = o.kind === 'sale'
        ? (customerMap.get(o.partyId) ?? `客户#${o.partyId}`)
        : (supplierMap.get(o.partyId) ?? `供应商#${o.partyId}`)
      rows.push({
        orderNo: o.orderNo,
        kind: o.kind,
        refOrderId: o.refOrderId,
        refOrderNo: o.refOrderNo,
        partyName,
        date: (o.date ?? '').slice(0, 16).replace('T', ' '),
        operatorName: userMap.get(o.operatorId) ?? `#${o.operatorId}`,
        totalAmount: o.totalAmount,
        itemCount: items.length,
        remark: o.remark,
        items: detail
      })
    }
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1))
  }

  async function getReturn(orderNo: string): Promise<ReturnDetail | null> {
    const o = (await db.returnOrders.where('orderNo').equals(orderNo).first())
    if (!o) return null
    const list = await listReturns()
    const row = list.find(r => r.orderNo === orderNo)
    if (!row) return null
    return { ...row, id: o.id! }
  }

  return { salesReturn, purchaseReturn, listReturns, getReturn }
})
