/**
 * 库存作业 store：库位（总仓/门店）、调拨、盘点。
 *
 * 数据一致性约定（关键）：
 *   `stock` 表始终代表「总库存」（一个商品一行）。
 *   `locationStock` 表代表「各库位的分布」，二者必须满足：总库存 = 各库位之和。
 *   - 入库（inbound）/ 出库（outbound）都发生在「总仓」(locationId=1)，
 *     因此同时更新总库存与 总仓 分布，等式始终成立。
 *   - 调拨（transfer）只在库位之间挪动，总库存不变，只改 locationStock 两边。
 *   - 盘点（stocktake）校正某库位的实盘差异：该库位 ±delta，同时总库存也 ±delta，
 *     等式依旧成立。
 * 这样既能支持「总仓调拨到门店」这类真实场景，又不会破坏既有的进销存对账。
 */
import { defineStore } from 'pinia'
import { db } from '../db'
import { writeLog, AUDIT_ACTIONS } from '../utils/audit'
import { genStockDocNo } from '../utils/orderNo'
import { applyQuantityDeltas, anyOfBatch, foldQuantityDeltas, safeBulkAdd, safeBulkPut } from '../utils/bulkWrite'
import type { Location } from '../types'

/** 默认库位：总仓(1) 与 门店(2)。调拨在这二者之间移动货物。 */
export const DEFAULT_LOCATIONS: Array<{ id: number; name: string }> = [
  { id: 1, name: '总仓' },
  { id: 2, name: '门店' }
]

export interface TransferRow {
  orderNo: string
  fromLoc: number
  toLoc: number
  fromName: string
  toName: string
  date: string
  operatorName: string
  itemCount: number
  totalQty: number
  items: Array<{ productName: string; quantity: number }>
}

export interface StocktakeRow {
  orderNo: string
  locationId: number
  locationName: string
  date: string
  operatorName: string
  itemCount: number
  /** 盘盈（实盘 > 系统）件数 */
  profit: number
  /** 盘亏（实盘 < 系统）件数 */
  loss: number
  items: Array<{ productName: string; systemQty: number; actualQty: number; diff: number }>
}

export const useInventoryStore = defineStore('inventory', () => {

  // ---------------------------------------------------------- 库位

  async function listLocations(): Promise<Location[]> {
    const all = await db.locations.toArray()
    if (!all.length) return DEFAULT_LOCATIONS.map(l => ({ ...l }))
    return all.sort((a, b) => (a.id! - b.id!))
  }

  /** 默认库房（入库/出库未指定时落在这里）：列表第一个 */
  async function defaultLocationId(): Promise<number> {
    await ensureLocations()
    const locs = await listLocations()
    return locs[0]?.id ?? 1
  }

  /**
   * 解析「本次作业用哪个库房」：
   *  - 传了 locationId 且库房存在 → 用它
   *  - 否则（未传 / 已被删除 / 老数据）→ 退回默认库房
   * 同时保证库房表非空（老库升级后自动补 总仓/门店）。
   */
  async function resolveLocationId(locationId?: number): Promise<number> {
    await ensureLocations()
    if (locationId != null) {
      const row = await db.locations.get(locationId)
      if (row) return locationId
    }
    return await defaultLocationId()
  }

  /**
   * 把单个商品的「库房分布」与「总库存」对齐（自愈）：
   *  - stock 有货但分布缺失/偏少（老数据、直接写 stock 的导入场景）→ 差额补到默认库房
   *  - 分布之和大于总库存（异常数据）→ 从数量最多的库房依次扣回
   * 保证 总库存 = Σ各库位 始终成立，出库校验才有意义。
   */
  async function reconcileProduct(productId: number): Promise<void> {
    const s = await db.stock.where('productId').equals(productId).first()
    const rows = await db.locationStock.where('productId').equals(productId).toArray()
    const sum = rows.reduce((a, r) => a + r.quantity, 0)
    const diff = (s?.quantity ?? 0) - sum
    if (diff > 0) {
      await applyLocationDelta(productId, await defaultLocationId(), diff)
      return
    }
    if (diff < 0) {
      let need = -diff
      for (const r of rows.slice().sort((a, b) => b.quantity - a.quantity)) {
        if (need <= 0) break
        const take = Math.min(need, r.quantity)
        if (take > 0) {
          await db.locationStock.update(r.id!, { quantity: r.quantity - take })
          need -= take
        }
      }
    }
  }

  /**
   * 批量自愈（供批量校验前调用）。
   *
   * 实现要点：一次把 stock / locationStock 两张表读进内存再算差额，
   * 只对真正不一致的商品落库。早先是逐个商品查两次库（N 个商品 = 2N 次查询），
   * 商品上千时首屏会被拖到几秒，这是「库存管理页加载慢」的主因。
   */
  async function reconcileProducts(productIds: number[]): Promise<void> {
    if (!productIds.length) return
    const wanted = new Set(productIds)
    const [stockRows, locRows] = await Promise.all([
      db.stock.toArray(),
      db.locationStock.toArray()
    ])
    const totalMap = new Map<number, number>()
    for (const s of stockRows) {
      if (wanted.has(s.productId)) totalMap.set(s.productId, s.quantity)
    }
    // V2.1-2.34 A2 档：原先这里逐商品 await 写库（N 个不一致商品 = N 次请求），
    // 现在全部收集后批量落盘一次。
    // ⚠️ distMap 里保留的是**整行**：下面要拿它做 bulkPut（upsert 会覆盖整行），
    // 只存 {id, locationId, quantity} 会把 productId 等列抹掉。
    const distMap = new Map<number, Array<{ row: any; locationId: number; quantity: number }>>()
    for (const r of locRows) {
      if (!wanted.has(r.productId)) continue
      const arr = distMap.get(r.productId) ?? []
      arr.push({ row: r, locationId: r.locationId, quantity: r.quantity })
      distMap.set(r.productId, arr)
    }

    const locDeltas: Array<{ productId: number; locationId: number; delta: number }> = []
    const locPuts: any[] = []
    let defId = 0
    for (const id of productIds) {
      const total = totalMap.get(id) ?? 0
      const rows = distMap.get(id) ?? []
      const sum = rows.reduce((a, r) => a + r.quantity, 0)
      const diff = total - sum
      if (diff === 0) continue
      if (diff > 0) {
        // 缺少分布（老数据 / 直接写 stock 的导入场景）→ 差额补到默认库房
        if (!defId) defId = await defaultLocationId()
        locDeltas.push({ productId: id, locationId: defId, delta: diff })
        continue
      }
      let need = -diff
      for (const r of rows.slice().sort((a, b) => b.quantity - a.quantity)) {
        if (need <= 0) break
        const take = Math.min(need, r.quantity)
        if (take > 0) {
          locPuts.push({ ...r.row, quantity: r.quantity - take })
          need -= take
        }
      }
    }
    await Promise.all([
      applyLocationDeltas(locDeltas),
      safeBulkPut(db.locationStock as any, locPuts)
    ])
  }

  /**
   * 确保至少存在一个库房；不存在时用默认数据补齐（兼容升级前的老库）。
   *
   * 注意两点，都是为了「多处同时调用也不出错」：
   *  1. 用 bulkPut 而不是 bulkAdd —— 并发调用时后到的那次不会因重复主键抛 ConstraintError
   *     （页面挂载、路由 watch、库存自愈可能在同一时刻各调一次）。
   *  2. 用 in-flight promise 去重 —— 同一轮里只真正查一次库。
   * 数据库被关闭 / 表被清空等非预期情况下静默失败，由 listLocations 的默认数组兜底。
   */
  let locInitPromise: Promise<void> | null = null
  async function ensureLocations(): Promise<void> {
    if (locInitPromise) return locInitPromise
    const task = (async () => {
      try {
        const count = await db.locations.count()
        if (count === 0) {
          // 显式写入 id，保证「总仓=1 / 门店=2」在历史数据里保持稳定
          await db.locations.bulkPut(
            DEFAULT_LOCATIONS.map(l => ({ id: l.id, name: l.name, createdAt: new Date().toISOString() }))
          )
        }
      } catch {
        /* 静默：库房缺失不影响主流程，listLocations 会返回默认数组 */
      }
    })()
    locInitPromise = task
    try { await task } finally { locInitPromise = null }
  }

  function normName(name: string): string {
    return String(name ?? '').trim()
  }

  /** 新增库房：名称去空格、不可为空、不可重名 */
  async function addLocation(name: string, remark?: string, operatorId = 1): Promise<{ ok: boolean; message: string; id?: number; name?: string }> {
    const n = normName(name)
    if (!n) return { ok: false, message: '请填写库房名称' }
    if (n.length > 20) return { ok: false, message: '库房名称不超过 20 个字' }
    const exist = await db.locations.toArray()
    if (exist.some(l => normName(l.name) === n)) return { ok: false, message: `库房「${n}」已存在` }
    const id = await db.locations.add({ name: n, remark: remark?.trim() || '', createdAt: new Date().toISOString() })
    await writeLog(operatorId, AUDIT_ACTIONS.STOCK_ADJUST, `新增库房「${n}」`)
    return { ok: true, message: `已新增库房「${n}」`, id: id as number, name: n }
  }

  /** 改名 / 改备注：库房 id 不变，历史单据与库存分布自动跟着新名字显示 */
  async function renameLocation(id: number, name: string, remark?: string, operatorId = 1): Promise<{ ok: boolean; message: string }> {
    const n = normName(name)
    if (!n) return { ok: false, message: '请填写库房名称' }
    if (n.length > 20) return { ok: false, message: '库房名称不超过 20 个字' }
    const target = await db.locations.get(id)
    if (!target) return { ok: false, message: '库房不存在' }
    const others = (await db.locations.toArray()).filter(l => l.id !== id)
    if (others.some(l => normName(l.name) === n)) return { ok: false, message: `库房「${n}」已存在` }
    await db.locations.update(id, { name: n, remark: remark?.trim() ?? target.remark ?? '' })
    await writeLog(operatorId, AUDIT_ACTIONS.STOCK_ADJUST, `库房「${target.name}」改名为「${n}」`)
    return { ok: true, message: `已改为「${n}」` }
  }

  /**
   * 删除库房：必须没有库存（quantity > 0）且不是最后一个库房。
   * 有货的库房要先调拨/出库清空，避免库存凭空消失、破坏 总库存 = Σ各库位 的等式。
   */
  async function deleteLocation(id: number, operatorId = 1): Promise<{ ok: boolean; message: string }> {
    const all = await db.locations.toArray()
    if (all.length <= 1) return { ok: false, message: '至少要保留一个库房' }
    const target = all.find(l => l.id === id)
    if (!target) return { ok: false, message: '库房不存在' }
    const rows = await db.locationStock.where('locationId').equals(id).toArray()
    const remain = rows.reduce((s, r) => s + Math.max(0, r.quantity), 0)
    if (remain > 0) {
      return { ok: false, message: `「${target.name}」还有 ${remain} 件库存，请先调拨或出库清空后再删除` }
    }
    await db.locationStock.where('locationId').equals(id).delete()
    await db.locations.delete(id)
    await writeLog(operatorId, AUDIT_ACTIONS.STOCK_ADJUST, `删除库房「${target.name}」`)
    return { ok: true, message: `已删除库房「${target.name}」` }
  }

  /** 各库房的库存件数合计（库房管理页展示用）：locationId -> 件数 */
  async function locationTotals(): Promise<Record<number, number>> {
    const rows = await db.locationStock.toArray()
    const map: Record<number, number> = {}
    for (const r of rows) map[r.locationId] = (map[r.locationId] ?? 0) + Math.max(0, r.quantity)
    return map
  }

  /** 一个商品在各库房的数量分布：locationId -> 数量（只含 >0 的库房） */
  async function productDistribution(productId: number): Promise<Record<number, number>> {
    const rows = await db.locationStock.where('productId').equals(productId).toArray()
    const map: Record<number, number> = {}
    for (const r of rows) {
      if (r.quantity > 0) map[r.locationId] = (map[r.locationId] ?? 0) + r.quantity
    }
    return map
  }

  /**
   * 一次取全部商品的库房分布，供库存明细页动态列渲染：
   *  - byProduct: productId -> (locationId -> 数量)
   *  - byLocation: locationId -> (productId -> 数量)（按库房筛选时用）
   */
  async function distributionAll(): Promise<{
    byProduct: Record<number, Record<number, number>>
    byLocation: Record<number, Record<number, number>>
  }> {
    const rows = await db.locationStock.toArray()
    const byProduct: Record<number, Record<number, number>> = {}
    const byLocation: Record<number, Record<number, number>> = {}
    for (const r of rows) {
      const q = Math.max(0, r.quantity)
      if (!q) continue
      if (!byProduct[r.productId]) byProduct[r.productId] = {}
      byProduct[r.productId][r.locationId] = (byProduct[r.productId][r.locationId] ?? 0) + q
      if (!byLocation[r.locationId]) byLocation[r.locationId] = {}
      byLocation[r.locationId][r.productId] = (byLocation[r.locationId][r.productId] ?? 0) + q
    }
    return { byProduct, byLocation }
  }

  /**
   * 首次使用调拨/盘点时，把现有「总库存」铺到「默认库房」上，
   * 保证总库存 = 各库位之和 的等式成立。只补缺失行，绝不覆盖已有分布。
   *
   * 性能：早先对每个商品发一次 `locationStock.where('productId').equals().first()`
   * （N+1），商品上千时首屏会卡 5 秒以上。改为一次把两张表读进内存再比对，
   * 查询次数从 N+1 降到 2 次 `toArray`，调拨/盘点选商品列表的首屏卡顿随之消除。
   */
  async function syncLocationStock(): Promise<void> {
    await ensureLocations()
    const defId = await defaultLocationId()
    const [stockRows, locRows] = await Promise.all([
      db.stock.toArray(),
      db.locationStock.toArray()
    ])
    // 一次性拿到「默认库位上已有分布的商品」集合，避免逐商品发查询
    const covered = new Set<number>()
    for (const r of locRows) {
      if (r.locationId === defId) covered.add(r.productId)
    }
    for (const s of stockRows) {
      if (!covered.has(s.productId) && s.quantity !== 0) {
        await db.locationStock.add({ productId: s.productId, locationId: defId, quantity: s.quantity })
      }
    }
  }

  /** 指定库位的库存分布：productId -> 数量 */
  async function locationStockMap(locationId: number): Promise<Record<number, number>> {
    const rows = await db.locationStock.where('locationId').equals(locationId).toArray()
    const map: Record<number, number> = {}
    for (const r of rows) map[r.productId] = r.quantity
    return map
  }

  /** 增减某个库位的库存（调拨 / 盘点共用） */
  async function applyLocationDelta(productId: number, locationId: number, delta: number): Promise<void> {
    if (delta === 0) return
    const exist = await db.locationStock
      .where('productId').equals(productId)
      .filter((r: any) => r.locationId === locationId)
      .first()
    if (exist) {
      const next = Math.max(0, exist.quantity + delta)
      await db.locationStock.update(exist.id!, { quantity: next })
    } else {
      await db.locationStock.add({ productId, locationId, quantity: Math.max(0, delta) })
    }
  }

  /**
   * 批量版 `applyLocationDelta`（V2.1-2.34 A 档）。
   *
   * 一张 5 行退货单原先要发 10 次请求（每行 1 查 + 1 写），改成这里后是 **2 次**
   * （一次批量读 + 一次批量写）。
   *
   * ⚠️ 语义等价的保证——必须与「按顺序逐次调用 applyLocationDelta」得到完全相同的结果：
   *  1. **按传入顺序逐条累加**，每条都各自 `Math.max(0, 当前值 + delta)` 截断。
   *     不能先把 delta 求和再算一次：例如当前 5、连续 -10 再 +3，
   *     逐次算是 max(0, -5)=0 → max(0, 3)=3，先求和算是 max(0, -2)=0，两者不同。
   *  2. 不存在的行先 `add`，之后同一主键再命中就走 `update`（与旧逻辑一致）——
   *     这里统一用内存 map 维护新老状态，最后分别批量落盘。
   *  3. delta === 0 的条目直接跳过，与 `applyLocationDelta` 开头的短路一致。
   */
  async function applyLocationDeltas(
    deltas: Array<{ productId: number; locationId: number; delta: number }>
  ): Promise<void> {
    const list = (deltas ?? []).filter(d => d && d.delta !== 0)
    if (!list.length) return

    const productIds = [...new Set(list.map(d => d.productId))]
    const existing = await anyOfBatch<{ id?: number; productId: number; locationId: number; quantity: number }>(
      db.locationStock as any, 'productId', productIds
    )
    const { adds, puts } = foldQuantityDeltas({
      existing,
      getKey: r => `${r.productId}|${r.locationId}`,
      deltas: list.map(d => ({ key: `${d.productId}|${d.locationId}`, delta: d.delta })),
      clampZero: true,
      buildNew: (key, delta) => {
        const [pid, lid] = key.split('|')
        return { productId: Number(pid), locationId: Number(lid), quantity: Math.max(0, delta) }
      }
    })
    await safeBulkAdd(db.locationStock as any, adds)
    await safeBulkPut(db.locationStock as any, puts)
  }

  /**
   * 批量版总库存增减（V2.1-2.34 A2 档，与 `applyLocationDeltas` 成对存在）。
   *
   * 原先调用方是「循环里 逐条读 stock → 改数量 → 写回」，一张 N 行单据就是 N 次读 + N 次写；
   * 这里压成 **1 次批量读 + 1 次批量写**。语义等价的保证同 `applyLocationDeltas`：
   * 按传入顺序逐条累加、每条各自决定是否截断到 0。
   *
   * @param deltas   按业务顺序传入的增量（入库正数 / 出库负数）
   * @param opts.clampZero       为 true 时每条都截断到 ≥ 0（出库的语义）
   * @param opts.createIfMissing 为 false 时「没有该商品库存行就跳过」（采购退货的语义）
   */
  async function applyStockDeltas(
    deltas: Array<{ productId: number; delta: number }>,
    opts: { now: string; clampZero: boolean; createIfMissing: boolean }
  ): Promise<void> {
    const list = (deltas ?? []).filter(d => d && d.delta !== 0)
    if (!list.length) return
    await applyQuantityDeltas({
      table: db.stock as any,
      keyField: 'productId',
      keys: [...new Set(list.map(d => d.productId))],
      deltas: list.map(d => ({ key: String(d.productId), delta: d.delta })),
      getKey: r => String(r.productId),
      clampZero: opts.clampZero,
      buildNew: (key, delta) => opts.createIfMissing
        ? {
          productId: Number(key),
          quantity: opts.clampZero ? Math.max(0, delta) : delta,
          updatedAt: opts.now
        }
        : null,
      touch: r => { r.updatedAt = opts.now }
    })
  }

  // ---------------------------------------------------------- 调拨

  /**
   * 创建调拨单：把商品从 fromLoc 移到 toLoc。
   * 总库存不变，只调整两边库位；来源库位不足时整体拒绝。
   */
  async function transfer(
    fromLoc: number,
    toLoc: number,
    quantities: Record<number, number>,
    operatorId: number
  ): Promise<{ ok: boolean; message: string; orderNo?: string }> {
    if (fromLoc === toLoc) return { ok: false, message: '调出与调入库位不能相同' }
    const entries = Object.entries(quantities).map(([k, v]) => ({ productId: Number(k), qty: Number(v) }))
      .filter(e => e.qty > 0)
    if (!entries.length) return { ok: false, message: '请填写调拨数量' }

    const fromMap = await locationStockMap(fromLoc)
    for (const e of entries) {
      if ((fromMap[e.productId] ?? 0) < e.qty) {
        const p = await db.products.get(e.productId)
        return { ok: false, message: `${p ? `${p.brand} ${p.model}`.trim() : '商品#' + e.productId} 在来源库位仅 ${fromMap[e.productId] ?? 0}，不够调拨 ${e.qty}` }
      }
    }

    const orderNo = genStockDocNo('DB')
    const now = new Date().toISOString()
    const orderId = await db.transferOrders.add({
      orderNo, fromLoc, toLoc, date: now, operatorId, status: 'done'
    })

    // V2.1-2.34 A2 档：原先是「每行 4 次串行请求」（明细 + 两个库位 + 两条流水），
    // 5 行单据就是 20 次；现在四类写入各自批量一次，与逐行执行的结果完全一致。
    await Promise.all([
      safeBulkAdd(db.transferItems as any, entries.map(e => ({
        transferOrderId: orderId as number, productId: e.productId, quantity: e.qty
      }))),
      applyLocationDeltas(entries.flatMap(e => [
        { productId: e.productId, locationId: fromLoc, delta: -e.qty },
        { productId: e.productId, locationId: toLoc, delta: e.qty }
      ])),
      // 流水留痕：来源库位出、目标库位入（总库存净变化为 0）
      safeBulkAdd(db.stockRecords as any, entries.flatMap(e => [
        { type: 'transfer', refOrderId: orderId as number, productId: e.productId, quantity: -e.qty, operatorId, createdAt: now, locationId: fromLoc, batchNo: orderNo },
        { type: 'transfer', refOrderId: orderId as number, productId: e.productId, quantity: e.qty, operatorId, createdAt: now, locationId: toLoc, batchNo: orderNo }
      ]))
    ])

    await writeLog(operatorId, AUDIT_ACTIONS.STOCK_ADJUST, `调拨单 ${orderNo}（${fromLoc}→${toLoc}）`)
    return { ok: true, message: `已生成调拨单 ${orderNo}`, orderNo }
  }

  // C 档（V2.1-2.34-C）提速：
  //   ① users / locations / products 三张字典表原来逐个 await（3 段串行），现在并发；
  //   ② 明细原来是「每个单据一次 where(...).toArray()」的 N+1 —— 单据越多越慢，
  //      100 张单就是 100 次新加坡往返。现在用 anyOfBatch 一次批量取回后按单据分组，
  //      每行的 productName / 数量 与旧实现逐一等价。
  // 两处改动都不碰任何计算口径，只把「等待」从串行改成并行、把 N 次请求压成 1 次。
  async function listTransfers(): Promise<TransferRow[]> {
    const orders = await db.transferOrders.toArray()
    if (!orders.length) return []
    const [users, locs, products] = await Promise.all([
      db.users.toArray(),
      db.locations.toArray(),
      db.products.toArray()
    ])
    const userMap = new Map(users.map(u => [u.id!, u.name]))
    const locMap = new Map(locs.map(l => [l.id!, l.name]))
    const pmap = new Map(products.map(p => [p.id!, `${p.brand} ${p.model}`.trim()]))

    const items = await anyOfBatch(
      db.transferItems as any,
      'transferOrderId',
      orders.map(o => o.id!)
    )
    const byOrder = new Map<number, Array<{ id: number; productId: number; quantity: number }>>()
    for (const it of items as any[]) {
      const list = byOrder.get(it.transferOrderId) ?? []
      list.push({ id: it.id as number, productId: it.productId, quantity: it.quantity })
      byOrder.set(it.transferOrderId, list)
    }
    // 一次 anyOf 返回的行顺序不受控，按主键排一遍：明细行的排列与旧版「逐单查询」保持一致
    for (const list of byOrder.values()) list.sort((a, b) => a.id - b.id)

    const rows: TransferRow[] = []
    for (const o of orders) {
      const its = byOrder.get(o.id!) ?? []
      const detail = its.map(it => ({
        productName: pmap.get(it.productId) ?? `商品#${it.productId}`,
        quantity: it.quantity
      }))
      rows.push({
        orderNo: o.orderNo,
        fromLoc: o.fromLoc,
        toLoc: o.toLoc,
        fromName: locMap.get(o.fromLoc) ?? `库位${o.fromLoc}`,
        toName: locMap.get(o.toLoc) ?? `库位${o.toLoc}`,
        date: (o.date ?? '').slice(0, 16).replace('T', ' '),
        operatorName: userMap.get(o.operatorId) ?? `#${o.operatorId}`,
        itemCount: its.length,
        totalQty: its.reduce((s, it) => s + it.quantity, 0),
        items: detail
      })
    }
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1))
  }

  // ---------------------------------------------------------- 盘点

  /**
   * 创建盘点单：逐项比对「某库位系统库存」与「实盘数」，
   * 差异同时校正该库位分布与总库存（保证 总库存 = 各库位之和）。
   */
  async function stocktake(
    locationId: number,
    actuals: Record<number, number>,
    operatorId: number
  ): Promise<{ ok: boolean; message: string; orderNo?: string; profit?: number; loss?: number }> {
    const entries = Object.entries(actuals).map(([k, v]) => ({ productId: Number(k), actual: Number(v) }))
      .filter(e => e.actual >= 0)
    if (!entries.length) return { ok: false, message: '请填写实盘数量' }

    const sysMap = await locationStockMap(locationId)
    const orderNo = genStockDocNo('PD')
    const now = new Date().toISOString()
    const orderId = await db.stocktakes.add({
      orderNo, locationId, date: now, operatorId, status: 'done'
    })

    let profit = 0
    let loss = 0

    // V2.1-2.34 A2 档：原先每个盘点是 4 次串行请求（库位 + 读总库存 + 写总库存 + 2 条明细流水），
    // 现在是 3 次批量写。delta 与盘盈盘亏仍在内存里按原顺序算，结果不变。
    // ⚠️ 这里**不能**过滤 delta === 0：原实现对「数量一致的盘点行」同样会写
    // stocktakeItems 与 adjust 流水（实盘记录本身就该留痕）。只有库存表会跳过 0 增量，
    // 而 applyLocationDeltas / applyStockDeltas 内部已经做了这个短路。
    const deltas = entries.map(e => {
      const systemQty = sysMap[e.productId] ?? 0
      const delta = e.actual - systemQty
      if (delta > 0) profit += delta
      if (delta < 0) loss += -delta
      return { productId: e.productId, delta, systemQty, actual: e.actual }
    })

    await Promise.all([
      applyLocationDeltas(deltas.map(d => ({ productId: d.productId, locationId, delta: d.delta }))),
      // 校正总库存（与库位同幅，保证「总库存 = 各库位之和」的等式不变）
      applyStockDeltas(deltas.map(d => ({ productId: d.productId, delta: d.delta })), { now, clampZero: false, createIfMissing: true }),
      // 调整流水留痕
      safeBulkAdd(db.stockRecords as any, deltas.map(d => ({
        type: 'adjust', refOrderId: orderId as number, productId: d.productId,
        quantity: d.delta, operatorId, createdAt: now, locationId, batchNo: orderNo,
        remark: `盘点 ${orderNo}`
      }))),
      safeBulkAdd(db.stocktakeItems as any, deltas.map(d => ({
        stocktakeId: orderId as number, productId: d.productId,
        systemQty: d.systemQty, actualQty: d.actual
      })))
    ])

    await writeLog(operatorId, AUDIT_ACTIONS.STOCK_ADJUST, `盘点单 ${orderNo}（盘盈 ${profit} / 盘亏 ${loss}）`)
    return { ok: true, message: `已生成盘点单 ${orderNo}`, orderNo, profit, loss }
  }

  // 同 listTransfers：三张字典表并发 + 明细走 anyOfBatch 批量，消灭 N+1（C 档 V2.1-2.34-C）
  async function listStocktakes(): Promise<StocktakeRow[]> {
    const orders = await db.stocktakes.toArray()
    if (!orders.length) return []
    const [users, locs, products] = await Promise.all([
      db.users.toArray(),
      db.locations.toArray(),
      db.products.toArray()
    ])
    const userMap = new Map(users.map(u => [u.id!, u.name]))
    const locMap = new Map(locs.map(l => [l.id!, l.name]))
    const pmap = new Map(products.map(p => [p.id!, `${p.brand} ${p.model}`.trim()]))

    const items = await anyOfBatch(db.stocktakeItems as any, 'stocktakeId', orders.map(o => o.id!))
    const byOrder = new Map<number, Array<{ id: number; productId: number; systemQty: number; actualQty: number }>>()
    for (const it of items as any[]) {
      const list = byOrder.get(it.stocktakeId) ?? []
      list.push({ id: it.id as number, productId: it.productId, systemQty: it.systemQty, actualQty: it.actualQty })
      byOrder.set(it.stocktakeId, list)
    }
    // 同上：按主键排一遍，与旧版逐单查询的明细顺序一致
    for (const list of byOrder.values()) list.sort((a, b) => a.id - b.id)

    const rows: StocktakeRow[] = []
    for (const o of orders) {
      const its = byOrder.get(o.id!) ?? []
      const detail = its.map(it => ({
        productName: pmap.get(it.productId) ?? `商品#${it.productId}`,
        systemQty: it.systemQty,
        actualQty: it.actualQty,
        diff: it.actualQty - it.systemQty
      }))
      rows.push({
        orderNo: o.orderNo,
        locationId: o.locationId,
        locationName: locMap.get(o.locationId) ?? `库位${o.locationId}`,
        date: (o.date ?? '').slice(0, 16).replace('T', ' '),
        operatorName: userMap.get(o.operatorId) ?? `#${o.operatorId}`,
        itemCount: its.length,
        profit: detail.filter(d => d.diff > 0).reduce((s, d) => s + d.diff, 0),
        loss: detail.filter(d => d.diff < 0).reduce((s, d) => s + -d.diff, 0),
        items: detail
      })
    }
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1))
  }

  return {
    listLocations, defaultLocationId, resolveLocationId, ensureLocations, syncLocationStock,
    reconcileProduct, reconcileProducts,
    addLocation, renameLocation, deleteLocation, locationTotals,
    productDistribution, distributionAll,
    locationStockMap, applyLocationDelta, applyLocationDeltas, applyStockDeltas,
    transfer, listTransfers, stocktake, listStocktakes
  }
})
