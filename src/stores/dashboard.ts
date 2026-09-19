import { defineStore } from 'pinia'
import { db } from '../db'

export const useDashboardStore = defineStore('dashboard', () => {
  // 老板经营看板
  async function getBossSummary() {
    const today = new Date().toDateString()
    const saleOrders = await db.saleOrders.toArray()
    const purchaseOrders = await db.purchaseOrders.toArray()

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

    const saleOrders = await db.saleOrders.toArray()
    const purchaseOrders = await db.purchaseOrders.toArray()

    // 本月销售额
    let monthSales = 0
    for (const so of saleOrders) {
      if (new Date(so.orderDate) >= monthStart) monthSales += so.totalAmount
    }

    // 本月毛利 = Σ(销售单价 - 商品当前进价) × 数量
    let monthGrossProfit = 0
    for (const so of saleOrders) {
      const items = await db.saleOrderItems.where('saleOrderId').equals(so.id!).toArray()
      for (const it of items) {
        const p = await productStore.getProduct(it.productId)
        const cost = p?.purchasePrice ?? 0
        monthGrossProfit += (it.price - cost) * it.quantity
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
