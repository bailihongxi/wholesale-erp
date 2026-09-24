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
