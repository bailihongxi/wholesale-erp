<template>
  <!--
    全站统一的「选商品」区块：采购单、销售单等所有需要挑商品的地方都复用它。
    固定三件套：顶部搜索框、列表显示可用库存、底部分页（默认 20 条/页）。
    商品多了以后靠搜索定位，避免在一长串里翻找；库存直接列出来，
    开单前就能看出哪些不能卖，不必等到提交被拦才知道。

    两种取数模式（商品上万条时务必用后者）：
      1) 客户端模式：调用方把 rows 一次性算好传进来，本组件只做前端过滤 + 分页。
      2) 服务端模式：传 loader，本组件自己按页拉（关键词/分类/只看有货都下推到服务端），
         内存里永远只有当前页这 20 条。
  -->
  <section class="picker">
    <header class="pk-head">
      <h4 class="pk-title">
        {{ title }}
        <span v-if="priceModeLabel" class="tag tag-info">{{ priceModeLabel }}</span>
      </h4>
      <div class="data-toolbar pk-tools">
        <SearchInput
          v-model="keyword"
          class="grow"
          :placeholder="`搜索商品名称 / 型号 / 分类（共 ${pager.total.value} 条）`"
          :debounce="0"
        />
        <select v-model="cat" class="pk-sel">
          <option value="">全部分类</option>
          <option v-for="c in cats" :key="c" :value="c">{{ c }}</option>
        </select>
        <label class="pk-check">
          <input v-model="onlyInStock" type="checkbox" />
          只看有货
        </label>
      </div>
    </header>

    <div class="pk-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th class="center" style="width:48px">序号</th>
            <th>商品名称</th>
            <th>类别</th>
            <th class="col-spec">型号 / 规格</th>
            <th class="center" style="width:56px">单位</th>
            <th class="num" style="width:90px">可用库存</th>
            <th v-if="showPrice" class="num" style="width:100px">{{ priceHeader }}</th>
            <th class="center" style="width:96px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(p, i) in pager.paged.value"
            :key="p.product.id"
            :class="{
              'row-disabled': p.stock <= 0 && blockNoStock,
              'row-picked': selectedCount(p.product.id!) > 0
            }"
          >
            <td class="center">{{ pager.startIndex.value + i }}</td>
            <td>{{ nameOf(p.product) }}</td>
            <td>{{ p.product.category || '-' }}</td>
            <td class="pk-sub col-spec">{{ p.product.spec || p.product.model || '-' }}</td>
            <td class="center">{{ p.product.unit }}</td>
            <td class="num">
              <span :class="stockClass(p)">{{ p.stock }}</span>
              <span v-if="p.stock <= 0" class="tag tag-danger">无货</span>
              <span v-else-if="p.stock <= p.product.warnStock" class="tag tag-warn">偏低</span>
            </td>
            <td v-if="showPrice" class="num">¥{{ money(priceOf(p.product)) }}</td>
            <td class="center">
              <button
                class="pk-add"
                :class="{ 'pk-added': selectedCount(p.product.id!) > 0 }"
                type="button"
                :disabled="blockNoStock && p.stock <= 0"
                :title="blockNoStock && p.stock <= 0 ? '无库存，无法销售' : ''"
                @click="pickRow(p)"
              >{{ addLabel(p.product.id!) }}</button>
            </td>
          </tr>
          <!-- 服务端模式首屏骨架：与「空数据」用不同 class，避免被当成空态影响既有断言 -->
          <tr v-if="showSkeleton">
            <td :colspan="colCount" class="pk-loading">商品加载中…</td>
          </tr>
          <tr v-else-if="!pager.paged.value.length">
            <td :colspan="colCount" class="empty">{{ emptyHint }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <TablePager
      v-model:page="pageProxy"
      :total="pager.total.value"
      :page-count="pager.pageCount.value"
      :size="pager.size.value"
    />
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import SearchInput from './SearchInput.vue'
import TablePager from './TablePager.vue'
import { PAGE_SIZE_LIST } from '../composables/usePagination'
import { useServerPager } from '../composables/useServerPager'
import { useResponsive } from '../composables/useResponsive'
import type { Product } from '../types'

/** 带库存的商品行，调用方一次性算好传入（客户端模式），避免逐条查询拖慢列表 */
export interface PickerRow {
  product: Product
  stock: number
}

/** 服务端模式的取数入参：翻页与筛选条件全部下推给调用方 */
export interface PickerLoadArgs {
  page: number
  pageSize: number
  keyword: string
  category: string
  onlyInStock: boolean
}
export type PickerLoader = (args: PickerLoadArgs) => Promise<{ rows: PickerRow[]; total: number }>

const props = withDefaults(
  defineProps<{
    /** 客户端模式的数据源（调用方一次性算好）。商品上千条时请改用 loader */
    rows?: PickerRow[]
    /** 服务端模式：传了它就按页拉，rows 被忽略 */
    loader?: PickerLoader
    /** 服务端模式的分类下拉数据（rows 只有当前页，推导不出全部分类） */
    categories?: string[]
    /** 已选商品 → 数量，用于行尾提示 */
    selected?: Record<number, number>
    /** 单价取值口径：进价 / 批发价 / 零售价 */
    priceMode?: 'purchase' | 'wholesale' | 'retail'
    showPrice?: boolean
    /** 库存为 0 时禁止添加（销售出库场景必须开，采购进货场景不开） */
    blockNoStock?: boolean
    title?: string
    pageSize?: number
  }>(),
  {
    rows: () => [],
    selected: () => ({}),
    priceMode: 'wholesale',
    showPrice: true,
    blockNoStock: false,
    title: '商品列表',
    pageSize: PAGE_SIZE_LIST
  }
)

/** 服务端模式判定：loader 在组件生命周期内不变，直接取一次即可 */
const isServer = typeof props.loader === 'function'

const emit = defineEmits<{ (e: 'pick', p: Product, stock?: number): void }>()

const { isMobile } = useResponsive()
/** 表格列数：手机端隐藏「型号/规格」列（与商品名重复），空行 colspan 要跟着减 */
const colCount = computed(() => (isMobile.value ? 6 : 7) + (props.showPrice ? 1 : 0))

const keyword = ref('')
/** 真正参与查询的关键词：服务端模式必须防抖，否则每敲一个字就发一次请求 */
const appliedKeyword = ref('')
const cat = ref('')
const onlyInStock = ref(false)

let kwTimer: ReturnType<typeof setTimeout> | null = null
watch(keyword, v => {
  if (kwTimer !== null) clearTimeout(kwTimer)
  if (!isServer) { appliedKeyword.value = v; return }
  kwTimer = setTimeout(() => { appliedKeyword.value = v }, 300)
})
onBeforeUnmount(() => { if (kwTimer !== null) clearTimeout(kwTimer) })

/** 客户端模式的行过滤：与服务端 search(四字段 ilike) / eq(category) 语义保持一致 */
function filterRows(rows: PickerRow[]): PickerRow[] {
  const k = appliedKeyword.value.trim().toLowerCase()
  return rows.filter(r => {
    if (cat.value && r.product.category !== cat.value) return false
    if (onlyInStock.value && r.stock <= 0) return false
    if (!k) return true
    const p = r.product
    return (
      (p.brand ?? '').toLowerCase().includes(k) ||
      (p.model ?? '').toLowerCase().includes(k) ||
      (p.category ?? '').toLowerCase().includes(k) ||
      (p.spec ?? '').toLowerCase().includes(k) ||
      `${p.brand} ${p.model}`.toLowerCase().includes(k)
    )
  })
}

/**
 * 统一走 useServerPager：服务端模式交给 loader，客户端模式在内存里过滤切片。
 * 客户端模式额外 watch `props.rows`——历史调用方是在自己的 onMounted 里异步把
 * rows 填进来的，子组件首次挂载时还是空数组，不重新加载就会一直显示「暂无商品」。
 */
const pager = useServerPager<PickerRow>({
  size: props.pageSize,
  watch: isServer ? [appliedKeyword, cat, onlyInStock] : [appliedKeyword, cat, onlyInStock, () => props.rows],
  loader: async (page, size) => {
    if (isServer) {
      return await props.loader!({
        page,
        pageSize: size,
        keyword: appliedKeyword.value.trim(),
        category: cat.value,
        onlyInStock: onlyInStock.value
      })
    }
    const all = filterRows(props.rows)
    return { rows: all.slice((page - 1) * size, page * size), total: all.length }
  }
})

const pageProxy = computed({
  get: () => pager.page.value,
  set: v => pager.go(v)
})

/** 服务端模式首屏才显示骨架；客户端模式数据就在内存里，闪一下反而突兀 */
const showSkeleton = computed(() => isServer && pager.loading.value && !pager.paged.value.length)

/** 空态文案的「有没有数据」口径：服务端看服务端总数，客户端看传入的 rows */
const sourceTotal = computed(() => (isServer ? pager.total.value : props.rows.length))
const emptyHint = computed(() =>
  sourceTotal.value ? '没有匹配的商品，换个关键词试试' : '暂无商品，请先在商品档案中添加'
)

const cats = computed(() => {
  if (props.categories) return props.categories
  const s = new Set<string>()
  for (const r of props.rows) if (r.product.category) s.add(r.product.category)
  return [...s].sort()
})

const priceModeLabel = computed(() =>
  props.priceMode === 'purchase' ? '进货价' : props.priceMode === 'retail' ? '零售价' : '批发价'
)
const priceHeader = computed(() =>
  props.priceMode === 'purchase' ? '进价' : props.priceMode === 'retail' ? '零售价' : '批发价'
)

function nameOf(p: Product): string { return `${p.brand} ${p.model}`.trim() }
function money(n: number): string { return Number(n ?? 0).toLocaleString() }
function priceOf(p: Product): number {
  if (props.priceMode === 'purchase') return p.purchasePrice
  if (props.priceMode === 'retail') return p.retailPrice
  return p.wholesalePrice
}
function selectedCount(id: number): number { return props.selected[id] ?? 0 }
/** 已选中的行按钮变橘色并显示「已选」，重复添加时显示件数 */
function addLabel(id: number): string {
  const n = selectedCount(id)
  if (n <= 0) return '＋ 添加'
  return n > 1 ? `已选 ×${n}` : '已选'
}
/** 把该行库存一并抛出：服务端模式下调用方手里只有当前页，拿不到别的商品库存 */
function pickRow(r: PickerRow): void { emit('pick', r.product, r.stock) }
function stockClass(r: PickerRow): string {
  if (r.stock <= 0) return 'stock-out'
  if (r.stock <= r.product.warnStock) return 'stock-low'
  return 'stock-ok'
}
</script>

<style scoped>
.picker {
  background: #fff; border-radius: 12px; padding: 12px;
  box-shadow: 0 2px 10px rgba(26,54,93,0.06);
}
.pk-head { margin-bottom: 8px; }
.pk-title { display: flex; align-items: center; gap: 8px; color: var(--c-primary); font-size: 14px; }
.pk-tools { margin-bottom: 8px; }
.pk-sel {
  height: 40px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm);
  padding: 0 12px; font-size: 14px; background: #fff; color: var(--c-text); outline: none;
}
.pk-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--c-muted); }
/* 表格横向撑开时保持可滚动，避免手机上把布局挤变形 */
.pk-scroll { overflow-x: auto; }
.pk-sub { color: var(--c-muted); font-size: 13px; }
.pk-add {
  border: 1px solid var(--c-accent); background: #fff; color: var(--c-accent);
  border-radius: 8px; padding: 5px 10px; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.pk-add:disabled { border-color: var(--c-border); color: var(--c-muted); cursor: not-allowed; opacity: 0.6; }
/* 已加入本单的商品：整行蓝色着重标注，按钮转橘色（与「未选」明显区分） */
.pk-scroll tbody tr.row-picked { background: #dbe8ff; }
.pk-scroll tbody tr.row-picked:hover { background: #cddcff; }
.pk-scroll tbody tr.row-picked td { color: #1a4bb3; font-weight: 600; }
.pk-scroll tbody tr.row-picked td:first-child { box-shadow: inset 3px 0 0 #2563eb; }
.pk-add.pk-added {
  background: #ff7a1a; border-color: #ff7a1a; color: #fff; font-weight: 600;
}
.pk-add.pk-added:hover { background: #f06a06; border-color: #f06a06; }
.empty { text-align: center; color: var(--c-muted); padding: 20px; font-size: 13px; }
.pk-loading { text-align: center; color: var(--c-muted); padding: 20px; font-size: 13px; }
/* 手机端：商品名已是「品牌+型号」，型号/规格列信息重复，藏掉让本行更宽松；
   同时把本层的横向滚动交还给表格自己。
   ⚠️ 手机端 `.data-table` 本身就是横向滚动容器（见 theme.css「手机端表格」一节），
   这里若也留 `overflow-x: auto` 就成了**双层滚动容器嵌套**：外层其实没有可滚内容
   （内层已经把自己的溢出裁进滚动区），手指横向滑动时容易两头都不动，
   表现为「明明右边有列却怎么也滑不出来」。与开单页 `.tb-scroll { overflow-x: visible }`
   的处理保持一致，全站只保留一层滚动容器。 */
@media (max-width: 767px) {
  .col-spec { display: none; }
  .pk-scroll { overflow-x: visible; }
}
</style>
