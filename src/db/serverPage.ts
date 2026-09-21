/**
 * 服务端分页双模助手（V2.0-4）。
 *
 * 业务列表页的统一分页入口：
 *   - 云端（USE_CLOUD=true）：直接调 CloudTable.queryPage()，只拉当前页 + 总数，
 *     不再进页面就 toArray() 全表。大表（销售单/采购单/库存流水 …）首屏从「全量」
 *     降到「几十行」。
 *   - 本地 / 测试（USE_CLOUD=false）：仍走 IndexedDB，但把「全表 → 前端过滤 → 切片」
 *     收敛到这一处，保证离线可用、且测试行为与云端一致。
 *
 * 用法（配合 useServerPager）：
 *   const pager = useServerPager<Row>({
 *     watch: [keyword, status],
 *     loader: (page, size) =>
 *       serverPage(db.saleOrders, { page, pageSize: size, eq: {...}, gte: {...}, search: {...}, orderBy: 'orderDate', ascending: false })
 *   })
 */
import { USE_CLOUD } from './supabaseClient'
import { CloudTable, type QueryPageOpts } from './cloudDb'

/** 通用比较：数字走数值，其余转字符串（ISO/日期串也可正确比较） */
function compareValues(a: any, b: any): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const sa = String(a)
  const sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

/**
 * 本地模式：完整复刻 queryPage 的 eq / gte / lte / inFilter / search / orderBy 语义。
 * orExpr 在本地模式由调用方改用 extraFilter 实现，这里不解析 orExpr。
 */
export function localApplyFilters<T>(rows: T[], opts: QueryPageOpts): T[] {
  let out = rows

  if (opts.eq) {
    for (const [k, v] of Object.entries(opts.eq)) {
      if (v === '' || v == null) continue
      out = out.filter(r => (r as any)[k] === v)
    }
  }
  if (opts.gte) {
    for (const [k, v] of Object.entries(opts.gte)) {
      if (v == null || v === '') continue
      out = out.filter(r => compareValues((r as any)[k], v) >= 0)
    }
  }
  if (opts.lte) {
    for (const [k, v] of Object.entries(opts.lte)) {
      if (v == null || v === '') continue
      out = out.filter(r => compareValues((r as any)[k], v) <= 0)
    }
  }
  if (opts.inFilter) {
    for (const [k, vals] of Object.entries(opts.inFilter)) {
      if (Array.isArray(vals) && vals.length) {
        out = out.filter(r => (vals as any[]).includes((r as any)[k]))
      }
    }
  }
  if (opts.search?.keyword) {
    const kw = opts.search.keyword.trim().toLowerCase()
    if (kw) {
      const fields = opts.search.fields ?? []
      out = out.filter(r =>
        fields.some(f => String((r as any)[f] ?? '').toLowerCase().includes(kw))
      )
    }
  }
  if (opts.orderBy) {
    const dir = opts.ascending ? 1 : -1
    const field = opts.orderBy
    out = out.slice().sort((a, b) => compareValues((a as any)[field], (b as any)[field]) * dir)
  }
  return out
}

/**
 * 按页拉取。云端走 queryPage（带总数），本地走 toArray + 过滤 + 切片。
 * @param table 云端为 CloudTable（有 queryPage），本地为 Dexie Table（有 toArray）。
 * @param opts  分页与过滤选项；extraFilter 仅在本地模式生效（云端由 orExpr 承担）。
 */
export async function serverPage<T = any>(
  table: any,
  opts: QueryPageOpts
): Promise<{ rows: T[]; total: number }> {
  if (USE_CLOUD) {
    return (table as CloudTable<T>).queryPage(opts)
  }

  // 本地 / 测试模式：全量拉取后按相同语义过滤 + 切片
  let all = (await table.toArray()) as T[]
  // 跨表名搜索：本地模式用 extraFilter 直接对行做 OR 匹配
  if (typeof opts.extraFilter === 'function') {
    all = all.filter(r => (opts.extraFilter as (row: T) => boolean)(r))
  }
  const filtered = localApplyFilters(all, opts)
  const total = filtered.length
  const size = opts.pageSize ?? 20
  const start = (Math.max(1, opts.page ?? 1) - 1) * size
  const rows = filtered.slice(start, start + size)
  return { rows, total }
}
