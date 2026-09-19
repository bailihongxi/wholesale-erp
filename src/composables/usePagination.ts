/**
 * 通用分页组合式。
 * 全站商品类列表统一走这里：商品档案 100 条/页，其余商品明细列表 20 条/页。
 */
import { computed, ref, watch, type Ref } from 'vue'

export interface Pagination {
  /** 当前页码，从 1 开始 */
  page: Ref<number>
  /** 每页条数 */
  size: Ref<number>
  /** 总页数 */
  pageCount: Ref<number>
  /** 总条数 */
  total: Ref<number>
  /** 当前页数据 */
  paged: Ref<any[]>
  /** 当前页序号起点（从 1 开始），用于表格里的连续序号 */
  startIndex: Ref<number>
  /** 是否有上一页 / 下一页 */
  hasPrev: Ref<boolean>
  hasNext: Ref<boolean>
  go(page: number): void
  prev(): void
  next(): void
  /** 数据变化后回到第一页 */
  reset(): void
}

/** 约定的分页粒度：商品档案 100 条，其余商品列表 20 条，库存预警 50 条 */
export const PAGE_SIZE_PRODUCT = 100
export const PAGE_SIZE_LIST = 20
export const PAGE_SIZE_ALERT = 50

export function usePagination<T>(source: Ref<T[]>, size = PAGE_SIZE_LIST): Pagination {
  const page = ref(1)
  const pageSize = ref(size)
  const total = computed(() => source.value.length)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

  // 数据变少导致当前页越界时自动回落，避免停在空白页
  watch(pageCount, max => {
    if (page.value > max) page.value = max
  })

  const paged = computed<T[]>(() => {
    const start = (page.value - 1) * pageSize.value
    return source.value.slice(start, start + pageSize.value)
  }) as Ref<any[]>

  const startIndex = computed(() => (page.value - 1) * pageSize.value + 1)
  const hasPrev = computed(() => page.value > 1)
  const hasNext = computed(() => page.value < pageCount.value)

  function clamp(p: number): number {
    if (!Number.isFinite(p)) return 1
    return Math.min(Math.max(1, Math.floor(p)), pageCount.value)
  }
  function go(p: number): void { page.value = clamp(p) }
  function prev(): void { go(page.value - 1) }
  function next(): void { go(page.value + 1) }
  function reset(): void { page.value = 1 }

  return { page, size: pageSize, pageCount, total, paged, startIndex, hasPrev, hasNext, go, prev, next, reset }
}
