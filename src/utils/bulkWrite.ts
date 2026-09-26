/**
 * 批量写 / 批量读的通用兜底工具（V2.1-2.34 A 档）。
 *
 * 背景：单据过账（退货 / 出入库 / 调拨 / 盘点）历史上是「循环里逐行 await」，
 * 一张 5 行单据要发 15~30 次网络请求，手机端要等好几秒。改批量写可以一次搞定，
 * 但**「不能让性能下降、不能比现在更容易失败」是硬要求**，所以统一走这里的
 * `safeBulk*`：**批量失败时自动退化为逐行重试**，最差情况等于改之前的行为。
 *
 * 为什么降级是安全的：
 *  - `bulkPut` / `put` 是 upsert，同一主键重复执行是幂等的，重试不会产生脏数据；
 *  - PostgREST 与 Dexie 的 insert / upsert 都是整批原子执行——要么全成、要么全败，
 *    不存在「写进去一半」的中间态，所以整批重试不会重复插入。
 *
 * ⚠️ 新增任何批量写都必须走这里，不要直接调 `table.bulkPut()`。
 */

/** 数据表的最小接口：云端 CloudTable 与本地 Dexie Table 都满足 */
export interface BulkTable {
  bulkPut(rows: any[]): Promise<unknown>
  bulkAdd(rows: any[]): Promise<unknown>
  put(row: any): Promise<unknown>
  add(row: any): Promise<unknown>
  update(id: number | string, patch: Record<string, any>): Promise<unknown>
  where(field: string): {
    anyOf(ids: (number | string)[]): { toArray(): Promise<any[]> }
  }
}

/** 批量 upsert（写整行，行对象必须带 id）：失败自动降级为逐行 put */
export async function safeBulkPut(table: BulkTable, rows: any[]): Promise<void> {
  if (!rows.length) return
  try {
    await table.bulkPut(rows)
  } catch {
    for (const r of rows) await table.put(r)
  }
}

/** 批量新增（新行无 id）：失败自动降级为逐行 add */
export async function safeBulkAdd(table: BulkTable, rows: any[]): Promise<void> {
  if (!rows.length) return
  try {
    await table.bulkAdd(rows)
  } catch {
    for (const r of rows) await table.add(r)
  }
}

/** 批量按主键赋同一个值集合（不同 id 不同值用不上，保持 update 语义）：失败降级为逐行 update */
export async function safeBulkUpdate(
  table: BulkTable,
  ids: (number | string)[],
  patch: Record<string, any>
): Promise<void> {
  if (!ids.length) return
  const bulkUpdate = (table as any).bulkUpdate
  if (typeof bulkUpdate === 'function') {
    try {
      if (typeof (table as any).client !== 'undefined') {
        // 云端 CloudTable.bulkUpdate(ids, changes)：一批一个网络请求
        await bulkUpdate.call(table, ids, patch)
        return
      }
      // Dexie 4 的 Table.bulkUpdate(keysAndChanges)：签名是 [{key, changes}] 数组，
      // 传 (ids, patch) 会把 patch 静默吞掉且不抛错（V2.2-1.0 入库备注事故）
      await bulkUpdate.call(table, ids.map(id => ({ key: id, changes: patch })))
      return
    } catch {
      /* 落到下面的逐行重试 */
    }
  }
  for (const id of ids) await table.update(id, patch)
}

/**
 * 纯内存版的「按序叠加数量增量」（V2.1-2.34 A 档的核心，刻意不碰数据库以便单测）。
 *
 * 单据过账要么改「总库存 stock」要么改「库位分布 locationStock」，两者的计算规则一样：
 * 把若干条 delta 依次叠加到目标行上，缺行则新建、命中则累加，可选「不低于 0」截断。
 *
 * ⚠️ **必须与「循环里逐条 读 → 改 → 写」得到完全相同的结果**，两条铁律：
 *  1. **按传入顺序逐条累加、每条各自截断**，不能先把同 key 的 delta 求和再算一次。
 *     例：当前 5，连续 -10 再 +3 → 逐条算是 max(0,-5)=0 再 max(0,3)=**3**，
 *     先求和算是 max(0,-2)=**0**，结果不同。（`Math.max` 不是线性运算。）
 *  2. 同一批里新建的行在后续 delta 中会被再次命中，必须接着它的值继续累加。
 *
 * @returns adds = 需要 insert 的新行；puts = 被改动过的已有行（整行 upsert，字段不变只改数量）
 */
export function foldQuantityDeltas(args: {
  /** 已存在的行（云端 select('*') 取回的整行，含 id 与其它字段） */
  existing: Array<Record<string, any>>
  /** 行的唯一标识（stock 用 productId，locationStock 用 productId|locationId） */
  getKey: (row: Record<string, any>) => string
  /** 待叠加的增量，按业务顺序传入 */
  deltas: Array<{ key: string; delta: number }>
  /** 缺行时如何新建；返回 null 表示「缺行就跳过」（采购退货的语义） */
  buildNew: (key: string, delta: number) => Record<string, any> | null
  /** 每条（不是总和）都截断到 ≥ 0 */
  clampZero: boolean
}): { adds: Array<Record<string, any>>; puts: Array<Record<string, any>> } {
  const byKey = new Map<string, Record<string, any>>()
  for (const r of args.existing) byKey.set(args.getKey(r), r)

  const dirty = new Set<Record<string, any>>()
  const created: string[] = []
  for (const d of args.deltas) {
    const exist = byKey.get(d.key)
    if (exist) {
      const cur = Number(exist.quantity) || 0
      exist.quantity = args.clampZero ? Math.max(0, cur + d.delta) : cur + d.delta
      dirty.add(exist)
    } else {
      const fresh = args.buildNew(d.key, d.delta)
      if (fresh) {
        byKey.set(d.key, fresh)
        created.push(d.key)
      }
    }
  }
  return {
    adds: created.map(k => byKey.get(k)!),
    puts: args.existing.filter(r => dirty.has(r))
  }
}

/**
 * 「先批量读 → 内存叠加 → 批量写」的标准流程，stock / locationStock 两张表共用。
 *
 * 语义等价于原来的「for delta { 读一行 → 改数量 → 写回 }」，差别只在于
 * 几十次网络请求被压成 1 次读 + 1 次写。**叠加算法本身在 foldQuantityDeltas 里，
 * 是本文件唯一的实现**，所有调用方共享它，避免各写一套导致口径漂移。
 *
 * @returns 新增行数与被更新行数（便于写审计日志）
 */
export async function applyQuantityDeltas(args: {
  table: BulkTable
  /** 按哪个字段批量捞出现有行（stock 用 productId） */
  keyField: string
  /** 涉及的主键清单，用于一次性把候选行捞齐 */
  keys: (number | string)[]
  /** 按业务顺序传入的增量 */
  deltas: Array<{ key: string; delta: number }>
  getKey: (row: Record<string, any>) => string
  clampZero: boolean
  /** 缺行时新建什么；返回 null = 缺行就跳过 */
  buildNew: (key: string, delta: number) => Record<string, any> | null
  /** 落盘前给每个被改动的行补字段（例如 stock 要刷 updatedAt） */
  touch?: (row: Record<string, any>) => void
}): Promise<{ added: number; putted: number }> {
  if (!args.deltas.length) return { added: 0, putted: 0 }
  const existing = await anyOfBatch<Record<string, any>>(args.table, args.keyField, args.keys)
  const { adds, puts } = foldQuantityDeltas({
    existing,
    getKey: args.getKey,
    deltas: args.deltas,
    clampZero: args.clampZero,
    buildNew: args.buildNew
  })
  if (args.touch) {
    for (const r of adds) args.touch(r)
    for (const r of puts) args.touch(r)
  }
  await safeBulkAdd(args.table, adds)
  await safeBulkPut(args.table, puts)
  return { added: adds.length, putted: puts.length }
}

/**
 * `where(field).anyOf(ids).toArray()` 的安全批量版。
 *
 * 为什么要分批：PostgREST 的 `in.(...)` 把 id 拼进 URL，几千个 id 会超出服务端
 * URL 长度限制导致整条查询失败。这里按 300 一批并行，结果集合与一次性查完全一致。
 *
 * ⚠️ **读失败必须原样抛出，绝不静默返回空数组**。
 * 这不是洁癖：库存过账是「先读现有库存行，再决定是 update 还是 insert」。
 * 读失败若被当成「没有这一行」，下一步就会去 insert 一条新库存行，
 * 于是同一个商品在 stock 表里出现两行、库存额凭空翻倍——这是账目级事故。
 * 改之前逐行 `where().equals().first()` 失败会一路 throw（cloudDb.ts:91），
 * 这里保持同样的失败语义，由调用方决定要不要提示。
 */
export async function anyOfBatch<T = any>(
  table: BulkTable,
  field: string,
  ids: (number | string)[],
  batchSize = 300
): Promise<T[]> {
  const list = (ids ?? []).filter(v => v !== null && v !== undefined)
  if (!list.length) return []
  const chunks: Array<Array<number | string>> = []
  for (let i = 0; i < list.length; i += batchSize) {
    chunks.push(list.slice(i, i + batchSize))
  }
  const results = await Promise.all(
    chunks.map(c => table.where(field).anyOf(c).toArray())
  )
  const out: T[] = []
  for (const r of results) out.push(...(r as T[]))
  return out
}
