import { defineStore } from 'pinia'
import { db } from '../db'

export const useDashboardStore = defineStore('dashboard', () => {
  // 老板经营看板
  async function getBossSummary() {
    const today = new Date().toDateString()
    const [saleOrders, purchaseOrders] = await Promise.all([
      db.saleOrders.toArray(),
      db.purchaseOrders.toArray(),
    ])

    let todaySales = 0
    let todayPurchases = 0
    let pendingCount = 0

    for (const so of saleOrders) {
      if (new Date(so.orderDate).toDateString() === today) {
        todaySales += so.totalAmount
      }
      if (so.status === 'pending' || so.status === 'partial') pendingCount++
    }
    for (const po of purchaseOrders) {
      if (new Date(po.orderDate).toDateString() === today) {
        todayPurchases += po.totalAmount
      }
    }

    // 低库存预警
    const { useProductStore } = await import('./product')
    const productStore = useProductStore()
    const lowStock = await productStore.getLowStockProducts()

    return {
      todaySales,
      todayPurchases,
      pendingCount,
      lowStockCount: lowStock.length
    }
  }

  // 采购工作台待办
  async function getPurchaseTodo() {
    const pendingInbound = await db.purchaseOrders.where('status').anyOf(['pending', 'partial']).toArray()
    return { pendingInboundCount: pendingInbound.length }
  }

  // 销售工作台待办
  async function getSalesTodo() {
    const pendingOutbound = await db.saleOrders.where('status').anyOf(['pending', 'partial']).toArray()
    return { pendingOutboundCount: pendingOutbound.length }
  }

  // 库房工作台待办
  async function getWarehouseTodo() {
    const pendingIn = await db.purchaseOrders.where('status').anyOf(['pending', 'partial']).toArray()
    const pendingOut = await db.saleOrders.where('status').anyOf(['pending', 'partial']).toArray()
    return {
      pendingInboundCount: pendingIn.length,
      pendingOutboundCount: pendingOut.length
    }
  }

  // 财务工作台待办
  async function getFinanceTodo() {
    const { useFinanceStore } = await import('./finance')
    const financeStore = useFinanceStore()
    const receivables = await financeStore.listReceivables()
    const payables = await financeStore.listPayables()
    const totalReceivable = receivables.reduce((s, r) => s + r.balance, 0)
    const totalPayable = payables.reduce((s, p) => s + p.balance, 0)
    return { totalReceivable, totalPayable }
  }

  // 老板经营看板（真实汇总数据）
  async function getBossDashboard() {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const { useProductStore } = await import('./product')
    const productStore = useProductStore()
    const { useFinanceStore } = await import('./finance')
    const financeStore = useFinanceStore()

    const [saleOrders, purchaseOrders] = await Promise.all([
      db.saleOrders.toArray(),
      db.purchaseOrders.toArray(),
    ])

    // 本月销售额
    let monthSales = 0
    for (const so of saleOrders) {
      if (new Date(so.orderDate) >= monthStart) monthSales += so.totalAmount
    }

    // 本月毛利 = Σ(销售单价 - 商品当前进价) × 数量
    //
    // ⚠️ 旧写法是二重嵌套的 N+1：for 每个订单 → where('saleOrderId') 查一次明细、
    // 再 for 每条明细 → getProduct() 查一次商品。云端就是几百到几千次新加坡往返
    // （几百单 × 每单几条明细），首页加载能拖到十几秒。
    // 现在两次请求搞定：明细整表拉完在内存分组，商品用 bulkGet 一次取回（保序）。
    const monthOrderIds = new Set(
      saleOrders.filter(so => new Date(so.orderDate) >= monthStart).map(so => so.id!)
    )
    const saleItems = await db.saleOrderItems.toArray()
    const monthItems = monthOrderIds.size
      ? saleItems.filter(it => monthOrderIds.has(it.saleOrderId))
      : []
    const itemProductIds = [...new Set(monthItems.map(it => it.productId))]
    let monthGrossProfit = 0
    if (monthItems.length) {
      const prods = (await (db.products as any).bulkGet(itemProductIds)) as Array<any>
      const costById = new Map<number, number>()
      itemProductIds.forEach((id, i) => costById.set(id, prods[i]?.purchasePrice ?? 0))
      for (const it of monthItems) {
        monthGrossProfit += (it.price - (costById.get(it.productId) ?? 0)) * it.quantity
      }
    }

    // 应收 / 应付
    const receivables = await financeStore.listReceivables()
    const payables = await financeStore.listPayables()
    const receivableTotal = receivables.reduce((s, r) => s + r.balance, 0)
    const payableTotal = payables.reduce((s, p) => s + p.balance, 0)

    // 库存预警
    const lowStock = await productStore.getLowStockProducts()

    // 今日待办
    const pendingInbound = purchaseOrders.filter(o => o.status === 'pending' || o.status === 'partial').length
    const pendingOutbound = saleOrders.filter(o => o.status === 'pending' || o.status === 'partial').length
    const pendingReceive = receivables.filter(r => r.balance > 0).length

    return {
      monthSales,
      monthGrossProfit,
      receivableTotal,
      payableTotal,
      lowStockCount: lowStock.length,
      todos: {
        pendingInbound,
        pendingOutbound,
        pendingReceive
      }
    }
  }

  return { getBossSummary, getBossDashboard, getPurchaseTodo, getSalesTodo, getWarehouseTodo, getFinanceTodo }
})
