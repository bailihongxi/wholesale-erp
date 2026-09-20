import { supabase } from '../db/supabaseClient'
import { db } from '../db'

/**
 * 一次性迁移：把本地 IndexedDB（Dexie）里的全部业务数据搬到 Supabase。
 *
 * 用法：系统设置 → 数据备份区块 → 点「迁移到云端」。
 * 可重复执行（用 upsert，按 id 覆盖，不会重复插）。
 */

const TABLES = [
  'users', 'customers', 'suppliers', 'products', 'locations',
  'stock', 'locationStock',
  'purchaseOrders', 'purchaseOrderItems',
  'saleOrders', 'saleOrderItems',
  'stockRecords',
  'transferOrders', 'transferItems',
  'stocktakes', 'stocktakeItems',
  'returnOrders', 'returnItems',
  'payments', 'ledgerEntries', 'auditLogs', 'rolePerms',
  'quoteOrders', 'quoteOrderItems',
]

export interface MigrateResult {
  table: string
  rows: number
}

export async function migrateToCloud(
  onProgress?: (msg: string) => void,
): Promise<MigrateResult[]> {
  const results: MigrateResult[] = []
  for (const t of TABLES) {
    const rows = await (db as any).table(t).toArray()
    if (!rows.length) {
      results.push({ table: t, rows: 0 })
      continue
    }
    // 分批 upsert（Supabase 单批太大可能超时）
    const BATCH = 100
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const { error } = await supabase.from(t).upsert(batch)
      if (error) throw new Error(`表 ${t} 第 ${i / BATCH + 1} 批失败：${error.message}`)
    }
    results.push({ table: t, rows: rows.length })
    onProgress?.(`${t}：${rows.length} 行`)
  }
  return results
}
