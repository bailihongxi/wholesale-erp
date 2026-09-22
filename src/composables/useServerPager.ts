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

export function useServerPager<T>(opts: ServerPagerOpts<T>): ServerPager {
  const page = ref(1)
  const size = ref(opts.size ?? PAGE_SIZE_LIST)
  const paged = ref<T[]>([]) as Ref<any[]>
  const total = ref(0)
  const loading = ref(true)

  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / size.value)))
  const startIndex = computed(() => (page.value - 1) * size.value + 1)
  const hasPrev = computed(() => page.value > 1)
  const hasNext = computed(() => page.value < pageCount.value)

  async function load(): Promise<void> {
    loading.value = true
    try {
      const { rows, total: t } = await opts.loader(page.value, size.value)
      paged.value = rows
      total.value = t
    } finally {
      loading.value = false
    }
  }

  function clamp(p: number): number {
    const n = Number.isFinite(p) ? Math.floor(p) : 1
    return Math.min(Math.max(1, n), pageCount.value)
  }
  function go(p: number): void { page.value = clamp(p); void load() }
  function prev(): void { go(page.value - 1) }
  function next(): void { go(page.value + 1) }
  function reset(): void { page.value = 1; void load() }
  function reload(): void { page.value = 1; void load() }

  if (opts.watch && opts.watch.length) {
    watch(opts.watch, () => { page.value = 1; void load() })
  }
  // 自动首拉：挂在 onMounted 而非 setup 阶段，确保组件挂载完成、首次渲染
  // （骨架占位）之后再拉数据并切到列表——与历史 onMounted(async(){await reload()})
  // 的时序一致，避免测试里 flushPromises 后骨架未切回列表的问题。
  onMounted(() => { void load() })

  // 全站路由组件被 App.vue 的 <keep-alive> 缓存：从列表页进新建页再跳回来时，
  // 组件是「复活」而非「重新挂载」，onMounted 不会再跑，列表就一直是旧数据
  // （表现为「新建的单子要整页刷新才出现」）。这里统一在回到本页时重拉一次。
  // 首次挂载不会触发（由 useReloadOnActivate 内部的「离开过」标志挡掉），
  // 且非 keep-alive 环境（如测试里直接 mount）完全不触发。
  useReloadOnActivate(() => { void load() })

  return {
    page, size, pageCount, total, paged, startIndex, hasPrev, hasNext, loading,
    go, prev, next, reset, reload,
  } as unknown as ServerPager
}
