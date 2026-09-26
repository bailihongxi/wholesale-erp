import { defineStore } from 'pinia'
import { db } from '../db'
import { writeLog, AUDIT_ACTIONS } from '../utils/audit'
import { genLedgerNo, todayStr, categoryLabel } from '../utils/ledger'
import type { PaymentHistoryRow, LedgerEntry, LedgerDirection } from '../types'

export const useFinanceStore = defineStore('finance', () => {
  // ===== 应收：客户欠款 =====
  // includeSettled=false（默认）只返回还有余额的应收；
  // 传 true 则返回全部销售单（含已结清），供财务查看完整历史。
  // paysAll：调用方若已拉过 payments 全表（如对账页 loadAll），传进来复用，
  // 避免同一页面对 payments 表重复全量拉取（V2.1-2.32 提速）。
  // ordersAll：同理，调用方若已拉过销售单全表（如老板看板），传进来复用，
  // 避免同一屏对同一张大表拉两遍（V2.1-2.34-C）。两个参数都不传时行为与旧版完全一致。
  async function listReceivables(
    includeSettled = false,
    paysAll?: Array<{ type: string; refOrderId: number; amount: number }>,
    ordersAll?: Array<{ id?: number; orderNo: string; customerId: number; totalAmount: number; orderDate: string }>
  ) {
    const orders = ordersAll ?? await db.saleOrders.toArray()
    // 收付款流水一次性取回后按单据聚合。
    // 原来写法是「每个订单一次 payments 请求」，500 单 = 500 次往返（N+1），
    // 订单一多这页就会卡住；且 payments 表若没数据会直接抛错导致整页空白。
    const pays = paysAll ?? await db.payments.toArray()
    const agg = new Map<number, { receive: number; refund: number }>()
    for (const p of pays) {
      if (p.type !== 'receive' && p.type !== 'refund') continue
      const cur = agg.get(p.refOrderId) ?? { receive: 0, refund: 0 }
      cur[p.type] += p.amount
      agg.set(p.refOrderId, cur)
    }
    const result: Array<{
      orderId: number
      orderNo: string
      customerId: number
      totalAmount: number
      receivedAmount: number
      balance: number
      date: string
    }> = []
    for (const o of orders) {
      const a = agg.get(o.id!) ?? { receive: 0, refund: 0 }
      const received = a.receive
      // 销售退货记为客户 Credit（贷方），从应收余额中扣除
      const credited = a.refund
      const balance = o.totalAmount - received - credited
      if (includeSettled || balance > 0) {
        result.push({
          orderId: o.id!, orderNo: o.orderNo, customerId: o.customerId,
          totalAmount: o.totalAmount, receivedAmount: received, balance, date: o.orderDate
        })
      }
    }
    return result
  }

  // ===== 应付：欠供应商 =====
  // paysAll：同 listReceivables，复用调用方已拉取的 payments 全表
  // ordersAll：同 listReceivables，复用调用方已拉取的采购单全表
  async function listPayables(
    includeSettled = false,
    paysAll?: Array<{ type: string; refOrderId: number; amount: number }>,
    ordersAll?: Array<{ id?: number; orderNo: string; supplierId: number; totalAmount: number; orderDate: string }>
  ) {
    const orders = ordersAll ?? await db.purchaseOrders.toArray()
    // 同 listReceivables：一次性取回流水再聚合，避免每单一请求
    const pays = paysAll ?? await db.payments.toArray()
    const agg = new Map<number, { pay: number; credit: number }>()
    for (const p of pays) {
      if (p.type !== 'pay' && p.type !== 'supplier_credit') continue
      const cur = agg.get(p.refOrderId) ?? { pay: 0, credit: 0 }
      // 逐个字段累加，不要写 cur[p.type]：字段名是 pay/credit，跟流水 type 不是一回事
      if (p.type === 'pay') cur.pay += p.amount
      else cur.credit += p.amount
      agg.set(p.refOrderId, cur)
    }
    const result: Array<{
      orderId: number
      orderNo: string
      supplierId: number
      totalAmount: number
      paidAmount: number
      balance: number
      date: string
    }> = []
    for (const o of orders) {
      const a = agg.get(o.id!) ?? { pay: 0, credit: 0 }
      const paid = a.pay
      // 采购退货记为供应商 Credit（贷方），从应付余额中扣除
      const credited = a.credit
      const balance = o.totalAmount - paid - credited
      if (includeSettled || balance > 0) {
        result.push({
          orderId: o.id!, orderNo: o.orderNo, supplierId: o.supplierId,
          totalAmount: o.totalAmount, paidAmount: paid, balance, date: o.orderDate
        })
      }
    }
    return result
  }

  // ===== 收付款流水（财务的完整历史痕迹） =====
  // 每笔收款/付款登记都会写入 payments，这里把流水与单据、往来单位、
  // 操作人关联起来，让财务能逐笔回查，而不是只看到一个余额数字。
  async function listPaymentHistory(paysAll?: Array<{ type: string; refOrderId: number; amount: number; payDate: string; counterpartyId: number; operatorId: number; remark?: string; id?: number }>): Promise<PaymentHistoryRow[]> {
    // V2.1-2.32：六张表原来串行 await，弱网下一次历史加载要串六趟；
    // 改为并行，且 payments 可复用调用方已拉的全表
    const [payments, saleOrders, purchaseOrders, customers, suppliers, users] = await Promise.all([
      paysAll ? Promise.resolve(paysAll as any[]) : db.payments.toArray(),
      db.saleOrders.toArray(),
      db.purchaseOrders.toArray(),
      db.customers.toArray(),
      db.suppliers.toArray(),
      db.users.toArray(),
    ])

    const saleMap = new Map(saleOrders.map(o => [o.id!, o.orderNo]))
    const purchaseMap = new Map(purchaseOrders.map(o => [o.id!, o.orderNo]))
    const customerMap = new Map(customers.map(c => [c.id!, c.name]))
    const supplierMap = new Map(suppliers.map(s => [s.id!, s.name]))
    const userMap = new Map(users.map(u => [u.id!, u.name]))

    return payments
      .map(p => ({
        id: p.id!,
        type: p.type,
        orderId: p.refOrderId,
        orderNo: p.type === 'receive'
          ? (saleMap.get(p.refOrderId) ?? `已删除单据#${p.refOrderId}`)
          : (purchaseMap.get(p.refOrderId) ?? `已删除单据#${p.refOrderId}`),
        counterpartyName: p.type === 'receive'
          ? (customerMap.get(p.counterpartyId) ?? '未知客户')
          : (supplierMap.get(p.counterpartyId) ?? '未知供应商'),
        amount: p.amount,
        payDate: p.payDate,
        operatorId: p.operatorId,
        operatorName: userMap.get(p.operatorId) ?? `#${p.operatorId}`,
        remark: p.remark
      }))
      .sort((a, b) => (a.payDate < b.payDate ? 1 : -1))
  }

  // ===== 收付款登记 =====
  async function recordReceive(data: {
    orderId: number
    amount: number
    operatorId: number
    remark: string
  }): Promise<{ ok: boolean; message: string; paid?: number }> {
    const order = await db.saleOrders.get(data.orderId)
    if (!order) return { ok: false, message: '销售单不存在' }
    await db.payments.add({
      type: 'receive',
      refOrderId: data.orderId,
      counterpartyId: order.customerId,
      amount: data.amount,
      payDate: new Date().toISOString(),
      operatorId: data.operatorId,
      remark: data.remark
    })
    // 更新收款状态
    const pays = await db.payments.where('type').equals('receive').filter(p => p.refOrderId === data.orderId).toArray()
    const received = pays.reduce((sum, p) => sum + p.amount, 0)
    const status = received >= order.totalAmount ? 'received' : (received > 0 ? 'partial' : 'unreceived')
    await db.saleOrders.update(order.id!, { receiveStatus: status })
    await writeLog(
      data.operatorId,
      AUDIT_ACTIONS.PAYMENT_RECEIVE,
      `销售单 ${order.orderNo} 收款 ¥${data.amount}（当前状态：${status}）`
    )
    // paid：登记后的已收合计，供调用方直接弹「已登记收款 ¥x，已收合计 ¥y」（V2.1-2.32）
    return { ok: true, message: '收款登记成功', paid: received }
  }

  async function recordPay(data: {
    orderId: number
    amount: number
    operatorId: number
    remark: string
  }): Promise<{ ok: boolean; message: string; paid?: number }> {
    const order = await db.purchaseOrders.get(data.orderId)
    if (!order) return { ok: false, message: '采购单不存在' }
    await db.payments.add({
      type: 'pay',
      refOrderId: data.orderId,
      counterpartyId: order.supplierId,
      amount: data.amount,
      payDate: new Date().toISOString(),
      operatorId: data.operatorId,
      remark: data.remark
    })
    const pays = await db.payments.where('type').equals('pay').filter(p => p.refOrderId === data.orderId).toArray()
    const paid = pays.reduce((sum, p) => sum + p.amount, 0)
    const status = paid >= order.totalAmount ? 'paid' : (paid > 0 ? 'partial' : 'unpaid')
    await db.purchaseOrders.update(order.id!, { payStatus: status })
    await writeLog(
      data.operatorId,
      AUDIT_ACTIONS.PAYMENT_PAY,
      `采购单 ${order.orderNo} 付款 ¥${data.amount}（当前状态：${status}）`
    )
    // paid：登记后的已付合计，供调用方直接弹「已登记付款 ¥x，已付合计 ¥y」（V2.1-2.32）
    return { ok: true, message: '付款登记成功', paid }
  }

  // ===== 毛利统计 =====
  // startDate / endDate 为 YYYY-MM-DD。传入时只统计该区间内的销售单；
  // 不传则统计全部（保持向后兼容）。
  async function getProfitSummary(
    startDate?: string,
    endDate?: string
  ): Promise<{ totalSales: number; totalCost: number; grossProfit: number }> {
    let saleOrders = await db.saleOrders.toArray()
    if (startDate || endDate) {
      const from = startDate ? `${startDate}T00:00:00.000Z` : ''
      // 结束日按当天 23:59 处理，采用字符串比较即可覆盖整日
      const to = endDate ? `${endDate}T23:59:59.999Z` : ''
      saleOrders = saleOrders.filter(o => {
        if (from && o.orderDate < from) return false
        if (to && o.orderDate > to) return false
        return true
      })
    }
    let totalSales = 0
    let totalCost = 0
    for (const so of saleOrders) {
      totalSales += so.totalAmount
      const items = await db.saleOrderItems.where('saleOrderId').equals(so.id!).toArray()
      for (const item of items) {
        const product = await db.products.get(item.productId)
        if (product) {
          totalCost += product.purchasePrice * item.quantity
        }
      }
    }
    return {
      totalSales,
      totalCost,
      grossProfit: totalSales - totalCost
    }
  }

  // ===== 按月的销售/毛利趋势 =====
  // 返回近 months 个月（含当前月）的数组，用于报表趋势图。
  async function getMonthlyTrend(months = 6): Promise<
    Array<{ key: string; label: string; sales: number; cost: number; profit: number }>
  > {
    const buckets = new Map<string, { sales: number; cost: number }>()
    const now = new Date()
    const keys: string[] = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      keys.push(key)
      buckets.set(key, { sales: 0, cost: 0 })
    }

    const saleOrders = await db.saleOrders.toArray()
    for (const so of saleOrders) {
      const key = (so.orderDate ?? '').slice(0, 7)
      const bucket = buckets.get(key)
      if (!bucket) continue
      bucket.sales += so.totalAmount
      const items = await db.saleOrderItems.where('saleOrderId').equals(so.id!).toArray()
      for (const item of items) {
        const product = await db.products.get(item.productId)
        if (product) bucket.cost += product.purchasePrice * item.quantity
      }
    }

    return keys.map(key => {
      const b = buckets.get(key)!
      return {
        key,
        label: `${Number(key.slice(5))}月`,
        sales: b.sales,
        cost: b.cost,
        profit: b.sales - b.cost
      }
    })
  }

  // ===== 应收/应付总额（用于报表与工作台） =====
  async function getReceivableTotal(): Promise<number> {
    const list = await listReceivables()
    return list.reduce((s, r) => s + r.balance, 0)
  }

  async function getPayableTotal(): Promise<number> {
    const list = await listPayables()
    return list.reduce((s, p) => s + p.balance, 0)
  }

  // ==================================================================
  // 记一笔：采购 / 销售单之外的日常收支（送货费、物流费、安装费、辅材费……）
  // 这类钱不走库存、不生成单据，但对算清真实利润必不可少。
  // ==================================================================

  /** 记一笔 */
  async function addLedger(params: {
    direction: LedgerDirection
    category: string
    amount: number
    counterparty?: string
    entryDate?: string
    operatorId: number
    remark?: string
    /** 关联单据类型（inbound/outbound/return/purchase/sale/transfer/stocktake），空表示不关联 */
    linkDocType?: string
    /** 关联单据号 */
    linkDocNo?: string
  }): Promise<{ ok: boolean; message: string; orderNo?: string }> {
    const amount = Number(params.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, message: '请填写大于 0 的金额' }
    }
    if (!params.category) return { ok: false, message: '请选择费用分类' }

    const orderNo = genLedgerNo()
    const now = new Date().toISOString()
    const entry: LedgerEntry = {
      orderNo,
      direction: params.direction,
      category: params.category,
      amount: Math.round(amount * 100) / 100,
      counterparty: (params.counterparty ?? '').trim(),
      entryDate: params.entryDate || todayStr(),
      operatorId: params.operatorId,
      remark: (params.remark ?? '').trim(),
      linkDocType: (params.linkDocType ?? '').trim(),
      linkDocNo: (params.linkDocNo ?? '').trim(),
      createdAt: now
    }
    await db.ledgerEntries.add(entry)
    await writeLog(
      params.operatorId,
      AUDIT_ACTIONS.LEDGER_ADD,
      `${params.direction === 'in' ? '收入' : '支出'} ${orderNo} · ${categoryLabel(params.category)} ¥${entry.amount}` +
        (entry.counterparty ? `（${entry.counterparty}）` : '') +
        (entry.linkDocNo ? ` · 关联${entry.linkDocNo}` : '')
    )
    return { ok: true, message: `已记一笔 ${orderNo}`, orderNo }
  }

  /** 记一笔流水：可按方向 / 分类 / 日期区间筛选 */
  async function listLedger(filter?: {
    direction?: LedgerDirection | ''
    category?: string
    from?: string
    to?: string
  }): Promise<LedgerEntry[]> {
    let rows = await db.ledgerEntries.toArray()
    if (filter?.direction) rows = rows.filter(r => r.direction === filter.direction)
    if (filter?.category) rows = rows.filter(r => r.category === filter.category)
    if (filter?.from) rows = rows.filter(r => (r.entryDate ?? '') >= filter.from!)
    if (filter?.to) rows = rows.filter(r => (r.entryDate ?? '') <= filter.to!)
    return rows.sort((a, b) => {
      const ka = `${a.entryDate} ${a.createdAt}`
      const kb = `${b.entryDate} ${b.createdAt}`
      return ka < kb ? 1 : ka > kb ? -1 : 0
    })
  }

  /** 删除一笔（记错了可以删掉重记） */
  async function deleteLedger(id: number, operatorId: number): Promise<{ ok: boolean; message: string }> {
    const row = await db.ledgerEntries.get(id)
    if (!row) return { ok: false, message: '该笔记录不存在' }
    await db.ledgerEntries.delete(id)
    await writeLog(
      operatorId,
      AUDIT_ACTIONS.LEDGER_DELETE,
      `删除记一笔 ${row.orderNo} · ${categoryLabel(row.category)} ¥${row.amount}`
    )
    return { ok: true, message: `已删除 ${row.orderNo}` }
  }

  /** 记一笔汇总：总收入 / 总支出 / 净额 / 按分类小计 */
  async function ledgerSummary(from?: string, to?: string): Promise<{
    income: number
    expense: number
    net: number
    byCategory: Array<{ category: string; label: string; amount: number; direction: LedgerDirection }>
  }> {
    const rows = await listLedger({ from, to })
    let income = 0
    let expense = 0
    const bucket = new Map<string, number>()
    for (const r of rows) {
      if (r.direction === 'in') income += r.amount
      else expense += r.amount
      const key = `${r.direction}:${r.category}`
      bucket.set(key, (bucket.get(key) ?? 0) + r.amount)
    }
    const byCategory = Array.from(bucket.entries())
      .map(([key, amount]) => {
        const [direction, category] = key.split(':')
        return { category, label: categoryLabel(category), amount, direction: direction as LedgerDirection }
      })
      .sort((a, b) => b.amount - a.amount)
    return { income, expense, net: income - expense, byCategory }
  }

  return {
    listReceivables, listPayables, recordReceive, recordPay,
    listPaymentHistory,
    getProfitSummary, getMonthlyTrend, getReceivableTotal, getPayableTotal,
    addLedger, listLedger, deleteLedger, ledgerSummary
  }
})
