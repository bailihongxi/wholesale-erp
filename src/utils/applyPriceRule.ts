/**
 * 把价格规则批量套到全库商品。
 *
 * 旧实现的性能灾难（已废弃）：
 *   const list = await db.products.toArray()
 *   for (const p of list) {
 *     await db.products.update(p.id, { wholesalePrice, retailPrice })   // 1 次云端 PATCH
 *   }
 * 6281 条 = 6281 次**串行** PATCH 到新加坡节点，半小时才几百条。
 *
 * 新实现：一次性拉全量 → 本地计算 → 按 500 条一批、6 路并发做 `bulkPut`
 * （一次请求 upsert 整批）。6281 条 ≈ 13 批，6 路并发约 3 波完成，
 * 从「半小时几百条」降到几十秒，并实时回传进度。
 */
import { db as cloudDb } from '../db'
import { calcWholesale, calcRetail, type PriceRule } from './priceRule'

/** 每批写入的商品条数（避开单次请求过大；也兼顾进度粒度） */
export const BULK_CHUNK = 500
/** 并发批数：新加坡节点高延迟下，并发能数倍提速（不至于触发限流的安全值） */
export const CONCURRENCY = 6

export interface ApplyPriceProgress {
  done: number
  total: number
}

export interface ApplyPriceDeps {
  /** 拉全量商品（默认走云端 toArray，含并行分页） */
  fetchAll: () => Promise<any[]>
  /** 批量 upsert（默认走云端 bulkPut，一次请求整批写入；返回类型不限） */
  bulkPut: (rows: any[]) => Promise<unknown>
  /** 进度回调（done/total） */
  onProgress?: (p: ApplyPriceProgress) => void
}

/**
 * 纯逻辑：给定依赖，把规则套到所有商品并分批并发写回。
 * 与具体 db 解耦，便于单测注入假 db。
 */
export async function applyPriceRuleToAllImpl(
  rule: PriceRule,
  deps: ApplyPriceDeps,
): Promise<number> {
  const list = await deps.fetchAll()
  if (!list.length) return 0

  // 本地逐条计算（无需联网，纯 CPU）
  const updated = list.map(p => ({
    ...p,
    wholesalePrice: calcWholesale(p.purchasePrice, rule),
    retailPrice: calcRetail(p.purchasePrice, rule),
  }))

  // 切成 BULK_CHUNK 一批的块
  const chunks: any[][] = []
  for (let i = 0; i < updated.length; i += BULK_CHUNK) {
    chunks.push(updated.slice(i, i + BULK_CHUNK))
  }

  let done = 0
  // 受限并发：CONCURRENCY 个 worker 抢任务队列
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < chunks.length) {
      const idx = cursor++
      await deps.bulkPut(chunks[idx])
      done += chunks[idx].length
      deps.onProgress?.({ done, total: updated.length })
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker))

  return updated.length
}

/** 真实入口：直接用云端 db 执行全库价格重算 */
export async function applyPriceRuleToAll(
  rule: PriceRule,
  onProgress?: (p: ApplyPriceProgress) => void,
): Promise<number> {
  return applyPriceRuleToAllImpl(rule, {
    fetchAll: () => cloudDb.products.toArray(),
    bulkPut: (rows) => cloudDb.products.bulkPut(rows),
    onProgress,
  })
}
