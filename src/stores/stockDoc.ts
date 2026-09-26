/**
 * 出入库单（库房单据）store。
 *
 * 为什么要有这一层：
 *  采购单 / 销售单是「业务意图」，入库单 / 出库单是「实际发生的货物流动」。
 *  一张采购单常常分好几次到货（部分入库），一次收货就生成一张 RK 入库单；
 *  这些入库单各自可查明细、可打印、可改量、可撤回，但始终关联着原采购单。
 *  把 stockRecords 按 batchNo 聚合成「单据」，库房和财务对账时才有抓手。
 *
 * 兼容性：早期流水没有 batchNo，这里给它们按「同一单 + 同一秒」虚拟一个批次号，
 *         历史数据同样能被查出来、支持撤回与修改。
 */
import { defineStore } from 'pinia'
import { db } from '../db'
import { writeLog, AUDIT_ACTIONS } from '../utils/audit'
import { useInventoryStore } from './inventory'
import { safeBulkAdd, safeBulkUpdate } from '../utils/bulkWrite'

export type StockDocType = 'in' | 'out'

/** 单据列表里的一行（按批次聚合后的结果） */
export interface StockDocRow {
  batchNo: string
  type: StockDocType
  /** 来源单据 id：采购单 / 销售单 */
  refOrderId: number
  orderNo: string
  /** 往来单位标签：供应商 / 客户 */
  partyLabel: string
  partyName: string
  /** 本次涉及品种数 */
  itemCount: number
  /** 本次总件数 */
  totalQty: number
  /** 本次金额（数量 × 对应单据里的成交单价） */
  amount: number
  operatorId: number
  operatorName: string
  createdAt: string
  /** 涉及商品名拼接，供列表页关键词搜索使用 */
  productNames: string
  /** 验收 / 拣货备注（随流水保存，可在入库单明细里查看与编辑） */
  remark?: string
  /** 本批次货物所在的库房（入库入库房 / 出库出库房） */
  locationId?: number
  locationName?: string
}

/** 单据明细里的一行 */
export interface StockDocItem {
  productId: number
  productName: string
  brand: string
  model: string
  category: string
  unit: string
  quantity: number
  price: number
  subtotal: number
  /** 来源单据上的订购数量，用于限制改量上限 */
  orderedQty: number
  /** 赠品行（第二十轮）：出入库流水备注带「赠品」的明细行，打印时显示为赠品 */
  isGift?: boolean
}

export interface StockDocDetail {
  doc: StockDocRow | null
  items: StockDocItem[]
}

/** 老流水没有批次号时，按「单据 + 秒」归并成一张虚拟单据 */
function legacyKey(type: 'purchase_in' | 'sale_out', refOrderId: number, createdAt: string): string {
  return `LEGACY-${type === 'purchase_in' ? 'RK' : 'CK'}-${refOrderId}-${(createdAt ?? '').slice(0, 19).replace(/[-:T]/g, '')}`
}

function absQty(r: { quantity: number }): number { return Math.abs(r.quantity) }

export const useStockDocStore = defineStore('stockDoc', () => {

  // ---------------------------------------------------------------- 查询

  /** 列出全部入库单（type='in'）或出库单（type='out'），按时间倒序 */
  async function listDocs(type: StockDocType): Promise<StockDocRow[]> {
    const recordType = type === 'in' ? 'purchase_in' : 'sale_out'
    const records = await db.stockRecords.where('type').equals(recordType).toArray()
    if (!records.length) return []

    // V2.1-2.33 性能修复：四类关联数据一次并行拉取（原来串行 3 趟起步）
    const productIds = [...new Set(records.map(r => r.productId))]
    const [users, locs, itemRows, allProducts] = await Promise.all([
      db.users.toArray(),
      db.locations.toArray(),
      type === 'in' ? db.purchaseOrderItems.toArray() : db.saleOrderItems.toArray(),
      // 商品原来逐个 await products.get(pid)：N 个商品 = N 次网络请求，历史单据一多列表就卡死
      productIds.length ? db.products.where('id').anyOf(productIds).toArray() : Promise.resolve([])
    ])
    const userMap = new Map(users.map(u => [u.id!, u.name]))
    const locMap = new Map(locs.map(l => [l.id!, l.name]))

    // 取参与过的商品，用于名称与单价兜底
    const productMap = new Map<number, { name: string; model: string; unit: string; category: string }>()
    for (const p of allProducts) {
      productMap.set(p.id!, { name: `${p.brand} ${p.model}`.trim(), model: p.model, unit: p.unit, category: p.category })
    }

    // 来源单据明细的成交单价：按 refOrderId + productId 建立索引
    const priceMap = new Map<string, { price: number; orderedQty: number }>()
    for (const it of itemRows as Array<Record<string, any>>) {
      const oid = type === 'in' ? it.purchaseOrderId : it.saleOrderId
      priceMap.set(`${oid}-${it.productId}`, { price: it.price, orderedQty: it.quantity })
    }

    // 来源单号 / 往来单位：原来每张新单据逐个 get（每张 2~4 次请求），改 anyOf 两次批量
    const refOrderIds = [...new Set(records.map(r => r.refOrderId))]
    const orderRows: any[] = refOrderIds.length
      ? await (type === 'in' ? db.purchaseOrders : db.saleOrders).where('id').anyOf(refOrderIds).toArray()
      : []
    const orderMap = new Map(orderRows.map(o => [o.id!, o]))
    const partyIds = [...new Set(orderRows
      .map(o => (type === 'in' ? o.supplierId : o.customerId))
      .filter((x): x is number => x != null))]
    const partyRows: any[] = partyIds.length
      ? await (type === 'in' ? db.suppliers : db.customers).where('id').anyOf(partyIds).toArray()
      : []
    const partyMap = new Map(partyRows.map(x => [x.id!, x.name]))
    const orderNoOfBatch = (id: number): string =>
      orderMap.get(id)?.orderNo ?? `已删除单据#${id}`
    const partyNameOfBatch = (id: number): string => {
      const o = orderMap.get(id)
      if (!o) return '—'
      const pid = type === 'in' ? o.supplierId : o.customerId
      return partyMap.get(pid!) ?? (type === 'in' ? '未知供应商' : '未知客户')
    }

    // 聚合
    const orderNoCache = new Map<number, string>()
    const partyCache = new Map<number, string>()
    const buckets = new Map<string, StockDocRow>()
    const namesMap = new Map<string, string[]>()
    for (const r of records) {
      const key = r.batchNo || legacyKey(recordType, r.refOrderId, r.createdAt)
      const qty = absQty(r)
      const info = priceMap.get(`${r.refOrderId}-${r.productId}`)
      const price = info?.price ?? 0
      const pname = productMap.get(r.productId)?.name ?? `商品#${r.productId}`
      const names = namesMap.get(key) ?? []
      if (!names.includes(pname)) names.push(pname)
      namesMap.set(key, names)
      const existing = buckets.get(key)
      if (existing) {
        existing.itemCount += 1
        existing.totalQty += qty
        existing.amount += qty * price
        existing.productNames = names.slice(0, 5).join('、') + (names.length > 5 ? ' 等' : '')
        // 同一批次的流水理论同库房；若历史数据混杂，以第一条为准
        if (existing.locationId == null && r.locationId != null) {
          existing.locationId = r.locationId
          existing.locationName = locMap.get(r.locationId) ?? `库房${r.locationId}`
        }
      } else {
        // 同一张来源单据会反复出现，缓存后避免重复查库（商品多时能明显加快列表加载）
        if (!orderNoCache.has(r.refOrderId)) orderNoCache.set(r.refOrderId, orderNoOfBatch(r.refOrderId))
        if (!partyCache.has(r.refOrderId)) partyCache.set(r.refOrderId, partyNameOfBatch(r.refOrderId))
        const locId = r.locationId ?? locs[0]?.id
        buckets.set(key, {
          batchNo: key,
          type,
          refOrderId: r.refOrderId,
          orderNo: orderNoCache.get(r.refOrderId)!,
          partyLabel: type === 'in' ? '供应商' : '客户',
          partyName: partyCache.get(r.refOrderId)!,
          itemCount: 1,
          totalQty: qty,
          amount: qty * price,
          operatorId: r.operatorId,
          operatorName: userMap.get(r.operatorId) ?? `#${r.operatorId}`,
          createdAt: r.createdAt,
          productNames: pname,
          locationId: locId,
          locationName: locId != null ? (locMap.get(locId) ?? `库房${locId}`) : undefined
        })
      }
    }

    return [...buckets.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  async function orderNoOf(type: StockDocType, refOrderId: number): Promise<string> {
    if (type === 'in') {
      const o = await db.purchaseOrders.get(refOrderId)
      return o?.orderNo ?? `已删除单据#${refOrderId}`
    }
    const o = await db.saleOrders.get(refOrderId)
    return o?.orderNo ?? `已删除单据#${refOrderId}`
  }

  async function partyNameOf(type: StockDocType, refOrderId: number): Promise<string> {
    if (type === 'in') {
      const o = await db.purchaseOrders.get(refOrderId)
      if (!o) return '—'
      const s = await db.suppliers.get(o.supplierId)
      return s?.name ?? '未知供应商'
    }
    const o = await db.saleOrders.get(refOrderId)
    if (!o) return '—'
    const c = await db.customers.get(o.customerId)
    return c?.name ?? '未知客户'
  }

  /** 单张出入库单的明细：列表 + 每件商品的实际数量与来源单价 */
  async function getDoc(type: StockDocType, batchNo: string): Promise<StockDocDetail> {
    const recordType = type === 'in' ? 'purchase_in' : 'sale_out'
    const all = await db.stockRecords.where('type').equals(recordType).toArray()
    const records = all.filter(r => (r.batchNo || legacyKey(recordType, r.refOrderId, r.createdAt)) === batchNo)
    if (!records.length) return { doc: null, items: [] }

    const refOrderId = records[0].refOrderId
    const priceMap = new Map<string, { price: number; orderedQty: number }>()
    if (type === 'in') {
      for (const it of await db.purchaseOrderItems.where('purchaseOrderId').equals(refOrderId).toArray()) {
        priceMap.set(String(it.productId), { price: it.price, orderedQty: it.quantity })
      }
    } else {
      for (const it of await db.saleOrderItems.where('saleOrderId').equals(refOrderId).toArray()) {
        priceMap.set(String(it.productId), { price: it.price, orderedQty: it.quantity })
      }
    }

    const productIds = [...new Set(records.map(r => r.productId))]
    const allProducts = await db.products.where('id').anyOf(productIds).toArray()
    const productMap = new Map(allProducts.map(p => [p.id, p]))

    const items: StockDocItem[] = []
    for (const r of records) {
      const p = productMap.get(r.productId)
      const info = priceMap.get(String(r.productId))
      const qty = absQty(r)
      const price = info?.price ?? 0
      items.push({
        productId: r.productId,
        productName: p ? `${p.brand} ${p.model}`.trim() : `商品#${r.productId}`,
        brand: p?.brand ?? '',
        model: p?.model ?? '',
        category: p?.category ?? '',
        unit: p?.unit ?? '',
        quantity: qty,
        price,
        subtotal: qty * price,
        orderedQty: info?.orderedQty ?? qty,
        isGift: (r.remark ?? '').includes('赠品')
      })
    }

    const [users] = await Promise.all([
      db.users.toArray(),
    ])
    const totalQty = items.reduce((s, i) => s + i.quantity, 0)
    const amount = items.reduce((s, i) => s + i.subtotal, 0)

    return {
      doc: {
        batchNo,
        type,
        refOrderId,
        orderNo: await orderNoOf(type, refOrderId),
        partyLabel: type === 'in' ? '供应商' : '客户',
        partyName: await partyNameOf(type, refOrderId),
        itemCount: items.length,
        totalQty,
        amount,
        operatorId: records[0].operatorId,
        operatorName: users.find(u => u.id === records[0].operatorId)?.name ?? `#${records[0].operatorId}`,
        createdAt: records[0].createdAt,
        productNames: items.map(i => i.productName).slice(0, 5).join('、'),
        remark: records.map(r => r.remark).find(r => r && r.trim()) || '',
        locationId: records[0].locationId,
        locationName: records[0].locationId != null
          ? ((await db.locations.get(records[0].locationId))?.name ?? `库房${records[0].locationId}`)
          : undefined
      },
      items
    }
  }

  // ---------------------------------------------------------------- 改动

  /**
   * 修改单据：先把本单已经发生的库存变化原样退回，再按新数量重新记账。
   * 单据号（batchNo）保持不变，日志里留下改单痕迹，便于事后追责。
   */
  async function updateDoc(
    type: StockDocType,
    batchNo: string,
    quantities: Record<number, number>,
    operatorId: number
  ): Promise<{ ok: boolean; message: string }> {
    const { doc, items } = await getDoc(type, batchNo)
    if (!doc) return { ok: false, message: '单据不存在' }

    const recordType = type === 'in' ? 'purchase_in' : 'sale_out'
    const all = await db.stockRecords.where('type').equals(recordType).toArray()
    const records = all.filter(r => (r.batchNo || legacyKey(recordType, r.refOrderId, r.createdAt)) === batchNo)

    // ⓪ 改单前先把「总库存 vs 库房分布」对齐，否则上一步的校验会用到过期分布
    const invForReconcile = useInventoryStore()
    await invForReconcile.reconcileProducts(items.map(i => i.productId))

    // ① 上限校验：不能超过来源单据上订的数量
    for (const it of items) {
      const next = Number(quantities[it.productId] ?? it.quantity)
      if (next < 0) return { ok: false, message: `${it.productName} 数量不能为负` }
      if (next > it.orderedQty) {
        return { ok: false, message: `${it.productName} 最多只能入/出 ${it.orderedQty}（来源单据订购量）` }
      }
    }

    // ② 先把原批次库存退回（连库房分布一起退回）——A2 档：整批一次，不再是逐条串行
    await applyStockDeltas(records.map(r => ({ productId: r.productId, delta: -r.quantity, locationId: r.locationId })))

    // ③ 出库类要确认库存在退回后仍够新数量（避免改大导致负数库存）
    if (type === 'out') {
      const inv = useInventoryStore()
      const locId = records[0]?.locationId ?? (await inv.defaultLocationId())
      const locMap = await inv.locationStockMap(locId)
      const loc = await db.locations.get(locId)
      for (const it of items) {
        const next = Number(quantities[it.productId] ?? it.quantity)
        const avail = locMap[it.productId] ?? 0
        if (next > avail) {
          // 回滚作废，恢复原样
          await applyStockDeltas(records.map(r => ({ productId: r.productId, delta: r.quantity, locationId: r.locationId })))
          return { ok: false, message: `${it.productName} 在「${loc?.name ?? '该库房'}」库存只有 ${avail}，无法出 ${next}` }
        }
      }
    }

    // ④ 删旧流水、按新数量写回同批次流水（沿用原批次所在库房）
    await db.stockRecords.bulkDelete(records.map(r => r.id!))
    const now = new Date().toISOString()
    const locId = records[0]?.locationId
    // A2 档：库存改动与流水写入各自批量一次（原实现逐条 N 次请求）
    const writes = items.map(it => {
      const next = Number(quantities[it.productId] ?? it.quantity)
      return { it, next, signed: type === 'in' ? next : -next }
    }).filter(w => w.next > 0)
    await applyStockDeltas(writes.map(w => ({ productId: w.it.productId, delta: w.signed, locationId: locId })))
    await safeBulkAdd(db.stockRecords as any, writes.map(w => ({
      type: recordType,
      refOrderId: doc.refOrderId,
      productId: w.it.productId,
      quantity: w.signed,
      operatorId,
      createdAt: doc.createdAt,
      batchNo,
      locationId: locId
    })))

    await recalcOrderStatus(type, doc.refOrderId)
    await writeLog(operatorId, AUDIT_ACTIONS.STOCK_ADJUST, `修改${type === 'in' ? '入库' : '出库'}单 ${batchNo}（${now.slice(0, 10)}）`)
    return { ok: true, message: '单据已更新' }
  }

  /**
   * 编辑单据备注（验收 / 拣货的有效信息备注）。
   * 该批所有流水共享同一备注，便于在入库单明细里统一查看。
   */
  async function setDocRemark(type: StockDocType, batchNo: string, remark: string, operatorId: number): Promise<{ ok: boolean; message: string }> {
    const { doc } = await getDoc(type, batchNo)
    if (!doc) return { ok: false, message: '单据不存在' }
    const recordType = type === 'in' ? 'purchase_in' : 'sale_out'
    const all = await db.stockRecords.where('type').equals(recordType).toArray()
    const records = all.filter(r => (r.batchNo || legacyKey(recordType, r.refOrderId, r.createdAt)) === batchNo)
    await safeBulkUpdate(db.stockRecords as any, records.map(r => r.id!), { remark })
    await writeLog(operatorId, AUDIT_ACTIONS.STOCK_ADJUST, `修改${type === 'in' ? '入库' : '出库'}单 ${batchNo} 备注`)
    return { ok: true, message: '备注已保存' }
  }

  /** 撤回整张单据：库存原路退回，流水删除，来源单据状态重算 */
  async function revertDoc(type: StockDocType, batchNo: string, operatorId: number): Promise<{ ok: boolean; message: string }> {
    const { doc } = await getDoc(type, batchNo)
    if (!doc) return { ok: false, message: '单据不存在' }

    const recordType = type === 'in' ? 'purchase_in' : 'sale_out'
    const all = await db.stockRecords.where('type').equals(recordType).toArray()
    const records = all.filter(r => (r.batchNo || legacyKey(recordType, r.refOrderId, r.createdAt)) === batchNo)

    await applyStockDeltas(records.map(r => ({ productId: r.productId, delta: -r.quantity, locationId: r.locationId })))
    await db.stockRecords.bulkDelete(records.map(r => r.id!))

    await recalcOrderStatus(type, doc.refOrderId)
    await writeLog(operatorId, AUDIT_ACTIONS.STOCK_ADJUST, `撤回${type === 'in' ? '入库' : '出库'}单 ${batchNo}`)
    return { ok: true, message: '已撤回' }
  }

  // ---------------------------------------------------------------- 内部

  /**
   * 批量版库存增减（V2.1-2.34 A2 档）。
   *
   * 原 `applyStockDelta` 是「读一行 → 改 → 写 → 再改库位」，每个商品 3~4 次请求；
   * 这里把整张单据的库存改动压成 **1 次批量读 + 2 次批量写**（总库存 + 库位分布）。
   *
   * ⚠️ 语义等价：默认库房只解析一次并复用到所有条目（原本每个商品各调一次
   * `defaultLocationId()`，返回值完全一致，只是白花 N 次请求）。
   * 总库存不截断（入库为负 / 出库为正的异常数据保持原样露出，便于排查），
   * 库位分布按既有约定截断到 ≥ 0。
   */
  async function applyStockDeltas(
    deltas: Array<{ productId: number; delta: number; locationId?: number }>
  ): Promise<void> {
    const list = (deltas ?? []).filter(d => d && d.delta !== 0)
    if (!list.length) return
    const inv = useInventoryStore()
    const fallbackLoc = list.some(d => d.locationId == null)
      ? await inv.defaultLocationId()
      : undefined
    const now = new Date().toISOString()
    await Promise.all([
      inv.applyStockDeltas(
        list.map(d => ({ productId: d.productId, delta: d.delta })),
        { now, clampZero: false, createIfMissing: true }
      ),
      // 同步维护库房分布，否则「总库存 = Σ各库位」的等式会被改单/撤回破坏
      inv.applyLocationDeltas(list.map(d => ({
        productId: d.productId,
        locationId: d.locationId ?? fallbackLoc!,
        delta: d.delta
      })))
    ])
  }

  /**
   * 根据累计出入库数量重算来源单据状态：
   * 全部到位 → completed；部分到位 → partial；一笔都没有 → pending。
   * 撤回与改单后都必须调用，否则单据状态会与实际收货情况脱节。
   */
  async function recalcOrderStatus(type: StockDocType, refOrderId: number): Promise<void> {
    if (type === 'in') {
      const order = await db.purchaseOrders.get(refOrderId)
      if (!order) return
      const items = await db.purchaseOrderItems.where('purchaseOrderId').equals(refOrderId).toArray()
      const records = (await db.stockRecords.where('refOrderId').equals(refOrderId).toArray())
        .filter(r => r.type === 'purchase_in')
      let all = true
      let any = false
      for (const it of items) {
        const got = records.filter(r => r.productId === it.productId).reduce((s, r) => s + absQty(r), 0)
        if (got > 0) any = true
        if (got < it.quantity) all = false
      }
      const status = !any ? 'pending' : all ? 'completed' : 'partial'
      await db.purchaseOrders.update(refOrderId, { status })
      return
    }

    const order = await db.saleOrders.get(refOrderId)
    if (!order) return
    const items = await db.saleOrderItems.where('saleOrderId').equals(refOrderId).toArray()
    const records = (await db.stockRecords.where('refOrderId').equals(refOrderId).toArray())
      .filter(r => r.type === 'sale_out')
    let all = true
    let any = false
    for (const it of items) {
      const got = records.filter(r => r.productId === it.productId).reduce((s, r) => s + absQty(r), 0)
      if (got > 0) any = true
      if (got < it.quantity) all = false
    }
    const status = !any ? 'pending' : all ? 'completed' : 'partial'
    await db.saleOrders.update(refOrderId, { status })
  }

  return { listDocs, getDoc, updateDoc, setDocRemark, revertDoc, recalcOrderStatus }
})
