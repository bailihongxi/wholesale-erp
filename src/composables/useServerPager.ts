/**
 * 服务端分页组合式
 * 数据直接从服务端拉，不做本地缓存，避免编辑/删除后列表数据不同步
 */
import { ref, computed, watch, onMounted, type Ref, type WatchSource } from 'vue'
import { showToast } from 'vant'
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

  /**
   * 加载数据
   * @param silent 静默模式：不显示loading骨架屏，后台拉取，拉完直接替换列表
   */
  async function load(silent = false): Promise<void> {
    if (!silent) loading.value = true
    try {
      const { rows, total: t } = await opts.loader(page.value, size.value)
      paged.value = rows
      total.value = t
    } catch (e: any) {
      // V2.1-2.32：加载失败必须让用户看见。原来无 catch，任何一次网络抖动/
      // 附属数据（客户、供应商）拉取失败都会静默停在旧列表或空列表——
      // 「明明有单却查不出来」的观感就是它造成的（同 V2.1-2.26 应收空白事故模式）。
      console.error('[useServerPager] 列表加载失败', e)
      try {
        showToast({ type: 'fail', message: `列表加载失败：${e?.message ?? '网络异常，请重试'}`, duration: 3000 })
      } catch { /* toast 环境不可用时忽略 */ }
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
  onMounted(() => { void load() })

  // 从其他页面返回时：静默后台刷新，不显示loading白屏，先展示之前缓存的列表
  // 后台拉到最新数据后自动替换，用户无感知
  useReloadOnActivate(() => { void load(true) })

  return {
    page, size, pageCount, total, paged, startIndex, hasPrev, hasNext, loading,
    go, prev, next, reset, reload,
  } as unknown as ServerPager
}
