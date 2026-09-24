/**
 * 服务端分页组合式（V2.0-4 引入）。
 * 暴露与 usePagination 完全一致的接口（page/size/pageCount/total/paged/startIndex/
 * hasPrev/hasNext/go/prev/next/reset），并额外暴露 loading，但数据由 async
 * loader(page,size) 从服务端按页拉取，不再进页面就 toArray() 全表。
 *
 * 用法：
 *   const pager = useServerPager<Row>({
 *     watch: [keyword, statusFilter],        // 这些响应式源变化 -> 回到第 1 页重载
 *     loader: async (page, size) => {
 *       // 云端走 db.xxx.queryPage(...)，本地走 toArray() 过滤后切片
 *       return { rows, total }
 *     },
 *   })
 * 模板无需改动：pager.paged.value / pager.total.value / pager.pageCount.value /
 * pager.size.value / pager.loading.value / pager.startIndex.value 与 TablePager 的原用法完全一致。
 *
 * 注意：创建即自动首拉一次（无需在 onMounted 里再触发）；watch 源变化自动回第 1 页重载。
 */
import { ref, computed, watch, onMounted, type Ref, type WatchSource } from 'vue'
import { PAGE_SIZE_LIST, type Pagination } from './usePagination'
import { useReloadOnActivate } from './useReloadOnActivate'

export interface ServerPagerOpts<T> {
  /** 每页条数，默认 PAGE_SIZE_LIST(20) */
  size?: number
  /** 响应式依赖：任一变化即回到第 1 页并重新拉取 */
  watch?: WatchSource[]
  /** 拉取指定页；返回当前页行与过滤后的总条数 */
  loader: (page: number, size: number) => Promise<{ rows: T[]; total: number }>
}

export interface ServerPager extends Pagination {
  /** 拉取中状态（首屏骨架占位用） */
  loading: Ref<boolean>
  /** 回到第 1 页并重新拉取（筛选条件变化 / 手动刷新时调用） */
  reload: () => void
}

// 列表数据短时间缓存：30秒内从其他页面返回不重新请求，秒开
const CACHE_DURATION = 30 * 1000 // 30秒
const cacheMap = new Map<string, { data: { rows: any[]; total: number }; page: number; size: number; time: number }>()

export function useServerPager<T>(opts: ServerPagerOpts<T>): ServerPager {
  const page = ref(1)
  const size = ref(opts.size ?? PAGE_SIZE_LIST)
  const paged = ref<T[]>([]) as Ref<any[]>
  const total = ref(0)
  const loading = ref(true)

  // 用loader函数toString当缓存key，不同页面各自缓存
  const cacheKey = opts.loader.toString().slice(0, 100)

  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / size.value)))
  const startIndex = computed(() => (page.value - 1) * size.value + 1)
  const hasPrev = computed(() => page.value > 1)
  const hasNext = computed(() => page.value < pageCount.value)

  async function load(useCache = true): Promise<void> {
    // 先看缓存有没有
    if (useCache && cacheMap.has(cacheKey)) {
      const cached = cacheMap.get(cacheKey)!
      const age = Date.now() - cached.time
      // 缓存有效且页码一致，直接用缓存
      if (age < CACHE_DURATION && cached.page === page.value && cached.size === size.value) {
        paged.value = cached.data.rows
        total.value = cached.data.total
        loading.value = false
        return
      }
    }

    loading.value = true
    try {
      const { rows, total: t } = await opts.loader(page.value, size.value)
      paged.value = rows
      total.value = t
      // 写入缓存
      cacheMap.set(cacheKey, {
        data: { rows, total: t },
        page: page.value,
        size: size.value,
        time: Date.now(),
      })
    } finally {
      loading.value = false
    }
  }

  function clamp(p: number): number {
    const n = Number.isFinite(p) ? Math.floor(p) : 1
    return Math.min(Math.max(1, n), pageCount.value)
  }
  function go(p: number): void { page.value = clamp(p); void load(false) } // 翻页不用缓存
  function prev(): void { go(page.value - 1) }
  function next(): void { go(page.value + 1) }
  function reset(): void { page.value = 1; void load(false) }
  function reload(): void { page.value = 1; void load(false) } // 手动刷新不用缓存

  if (opts.watch && opts.watch.length) {
    watch(opts.watch, () => { page.value = 1; void load(false) })
  }
  onMounted(() => { void load() })

  // 从其他页面返回时：用缓存，秒开；30秒内不重新请求
  useReloadOnActivate(() => { void load(true) })

  return {
    page, size, pageCount, total, paged, startIndex, hasPrev, hasNext, loading,
    go, prev, next, reset, reload,
  } as unknown as ServerPager
}
