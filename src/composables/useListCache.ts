/**
 * 列表数据短时间缓存工具（V2.1-2.6 升级为sessionStorage持久化）
 * 
 * 用法：
 *   import { useListCache } from '../composables/useListCache'
 *   const listCache = useListCache('product-list')
 *   
 *   async function reload() {
 *     // 先看缓存
 *     const cached = listCache.get()
 *     if (cached) {
 *       pageRows.value = cached.rows
 *       total.value = cached.total
 *       loading.value = false
 *       return
 *     }
 *     
 *     // 没有缓存，重新加载
 *     loading.value = true
 *     const res = await loadData()
 *     pageRows.value = res.rows
 *     total.value = res.total
 *     listCache.set({ rows: res.rows, total: res.total })
 *     loading.value = false
 *   }
 * 
 *   // 手动刷新时清除缓存
 *   function refresh() {
 *     listCache.clear()
 *     reload()
 *   }
 */

const CACHE_DURATION = 30 * 1000 // 30秒
const CACHE_PREFIX = 'erp_list_cache_'

export function useListCache(key: string) {
  const fullKey = CACHE_PREFIX + key

  function get<T = any>(): T | null {
    try {
      const raw = sessionStorage.getItem(fullKey)
      if (!raw) return null
      const cached = JSON.parse(raw)
      const age = Date.now() - cached.time
      if (age > CACHE_DURATION) {
        sessionStorage.removeItem(fullKey)
        return null
      }
      return cached.data as T
    } catch {
      return null
    }
  }

  function set(data: any) {
    try {
      sessionStorage.setItem(fullKey, JSON.stringify({
        data,
        time: Date.now()
      }))
    } catch {
      // sessionStorage满了就忽略
    }
  }

  function clear() {
    try {
      sessionStorage.removeItem(fullKey)
    } catch {}
  }

  return { get, set, clear }
}

/**
 * 清除本系统全部列表缓存（V2.1-2.32）。
 *
 * 背景（2026-09-25 事故）：入库完成后收货单列表要「刷新四次 + 等 30 秒」才更新——
 * 各列表页的 sessionStorage 缓存（30 秒 TTL）在写操作成功后没人清，30 秒内
 * 无论怎么刷新都命中旧快照（sessionStorage 连 F5 都不清）。
 *
 * 与其逐页配对「哪个写动作清哪个 key」（容易漏），不如在所有写操作
 * （入库/出库/退货/记一笔/登记付款/新建采购单……）成功后统一调这一个函数。
 * 成本为零（就是删几个 sessionStorage key），下次进列表直接重拉，
 * 缓存 TTL 只有 30 秒，本来就是弱缓存，不影响加载速度。
 */
export function clearAllListCaches(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k)
    }
    keys.forEach((k) => sessionStorage.removeItem(k))
  } catch {
    // sessionStorage 不可用就忽略
  }
}
