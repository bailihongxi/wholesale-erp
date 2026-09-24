/**
 * 列表数据短时间缓存工具（V2.1-2.4）
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
const cacheMap = new Map<string, { data: any; time: number }>()

export function useListCache(key: string) {
  function get<T = any>(): T | null {
    if (!cacheMap.has(key)) return null
    const cached = cacheMap.get(key)!
    const age = Date.now() - cached.time
    if (age > CACHE_DURATION) {
      cacheMap.delete(key)
      return null
    }
    return cached.data as T
  }

  function set(data: any) {
    cacheMap.set(key, { data, time: Date.now() })
  }

  function clear() {
    cacheMap.delete(key)
  }

  return { get, set, clear }
}
