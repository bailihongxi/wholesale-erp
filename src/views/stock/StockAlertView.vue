<template>
  <!--
    库存预警：当前库存 ≤ 预警值的商品。
    第十二轮起独立成模块，每页固定 50 条（不再一次性铺满整页），
    表格用全站统一的 .data-table（自带斑马纹 + 悬停高亮）。
  -->
  <div class="page">
    <div class="toolbar">
      <SearchInput
        v-model="keyword"
        class="alert-search"
        placeholder="搜索品牌 / 型号 / 分类"
        :debounce="0"
      />
      <select v-model="category" class="alert-select">
        <option value="">全部分类</option>
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-if="locations.length > 1" v-model.number="locFilter" class="alert-select">
        <option :value="0">全部库房</option>
        <option v-for="l in locations" :key="l.id" :value="l.id">只看 {{ l.name }}</option>
      </select>
      <button v-if="hasFilter" class="reset-btn" type="button" @click="resetFilter">重置</button>
    </div>

    <div class="sum-line">
      共 <b class="danger">{{ rows.length }}</b> 个商品低于预警线 ·
      每页 {{ pager.size.value }} 条
    </div>

    <ul v-if="isMobile" class="card-list zebra-list">
      <li v-for="p in pager.paged.value" :key="p.id" class="alert-card">
        <div class="ac-head">
          <span class="ac-name">{{ productName(p) }}</span>
          <span class="ui-badge danger">缺口 {{ gapOf(p) }}</span>
        </div>
        <div class="ac-meta">
          <span>{{ p.category }}</span>
          <span>现库存 <b class="danger">{{ stockOf(p.id) }}</b> {{ p.unit }}</span>
          <span>预警值 {{ p.warnStock }}</span>
        </div>
        <div v-if="locations.length > 1" class="ac-locs">
          <span v-for="l in locations" :key="l.id" class="ac-loc">
            {{ l.name }} {{ locQty(p.id!, l.id!) }}
          </span>
        </div>
      </li>
      <li v-if="!pager.paged.value.length" class="empty">
        {{ hasFilter ? '没有匹配的预警商品，试试清除筛选' : '👍 暂无低于预警线的商品' }}
      </li>
    </ul>

    <table v-else class="data-table alert-table">
      <thead>
        <tr>
          <th class="center" style="width: 92px">序号</th>
          <th>商品名称</th>
          <th>分类</th>
          <th v-for="l in locations" :key="l.id" class="num">{{ l.name }}</th>
          <th class="num">当前库存</th>
          <th class="num">预警值</th>
          <th class="num">缺口</th>
          <th class="center">单位</th>
          <th class="center">状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, i) in pager.paged.value" :key="p.id" class="is-warn">
          <td class="center c-muted">{{ pager.startIndex.value + i }}</td>
          <td>{{ productName(p) }}</td>
          <td class="c-muted">{{ p.category }}</td>
          <td
            v-for="l in locations"
            :key="l.id"
            class="num"
            :class="{ 'loc-zero': locQty(p.id!, l.id!) === 0 }"
          >
            {{ locQty(p.id!, l.id!) }}
          </td>
          <td class="num"><b class="danger">{{ stockOf(p.id) }}</b></td>
          <td class="num c-muted">{{ p.warnStock }}</td>
          <td class="num"><b class="danger">{{ gapOf(p) }}</b></td>
          <td class="center">{{ p.unit }}</td>
          <td class="center"><span class="ui-badge danger">需补货</span></td>
        </tr>
        <tr v-if="!pager.paged.value.length">
          <td :colspan="colspan" class="empty">
            {{ hasFilter ? '没有匹配的预警商品，试试清除筛选' : '👍 暂无低于预警线的商品' }}
          </td>
        </tr>
      </tbody>
    </table>

    <TablePager
      v-if="rows.length"
      v-model:page="pageProxy"
      :total="pager.total.value"
      :page-count="pager.pageCount.value"
      :size="pager.size.value"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import SearchInput from '../../components/SearchInput.vue'
import TablePager from '../../components/TablePager.vue'
import { useProductStore } from '../../stores/product'
import { useResponsive } from '../../composables/useResponsive'
import { usePagination, PAGE_SIZE_ALERT } from '../../composables/usePagination'
import type { Product, Location } from '../../types'

const props = defineProps<{
  products: Product[]
  stock: Record<number, number>
  locations: Location[]
  dist: Record<number, Record<number, number>>
}>()

const productStore = useProductStore()
const { isMobile } = useResponsive()

const keyword = ref('')
const category = ref('')
const locFilter = ref(0)

const categories = computed(() =>
  Array.from(new Set(props.products.map(p => p.category).filter(Boolean))).sort()
)

const rows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return props.products.filter(p => {
    if (category.value && p.category !== category.value) return false
    if (locFilter.value && (props.dist[p.id!]?.[locFilter.value] ?? 0) <= 0) return false
    if (kw) {
      const hit =
        p.brand.toLowerCase().includes(kw) ||
        p.model.toLowerCase().includes(kw) ||
        `${p.brand} ${p.model}`.toLowerCase().includes(kw) ||
        p.category.toLowerCase().includes(kw)
      if (!hit) return false
    }
    return stockOf(p.id) <= p.warnStock
  })
})

/** 预警模块固定每页 50 条 */
const pager = usePagination(rows, PAGE_SIZE_ALERT)
watch([keyword, category, locFilter], () => pager.reset())
const pageProxy = computed({
  get: () => pager.page.value,
  set: v => pager.go(v)
})

const hasFilter = computed(() => !!keyword.value.trim() || !!category.value || !!locFilter.value)
const colspan = computed(() => 7 + props.locations.length)

function stockOf(id?: number): number {
  return id ? (props.stock[id] ?? 0) : 0
}
/** 缺口：距离预警线还差多少（预警值 - 当前库存，至少 1） */
function gapOf(p: Product): number {
  return Math.max(1, p.warnStock - stockOf(p.id))
}
function locQty(productId: number, locationId: number): number {
  return props.dist[productId]?.[locationId] ?? 0
}
function resetFilter(): void {
  keyword.value = ''
  category.value = ''
  locFilter.value = 0
}
function productName(p: Product): string {
  return productStore.productName(p)
}
</script>

<style scoped>
.sum-line { font-size: 12px; color: var(--c-muted); margin-bottom: 10px; }
.sum-line .danger { color: var(--c-danger); }
.danger { color: var(--c-danger); }
.c-muted { color: var(--c-muted); }
.alert-table th, .alert-table td { padding: 10px 14px; }
.alert-table tbody tr.is-warn td:first-child { box-shadow: inset 3px 0 0 var(--c-danger); }
.alert-table td.loc-zero { color: #cbd5e1; }

.reset-btn {
  height: 40px; padding: 0 14px; border: 1px solid var(--c-border); border-radius: var(--r-sm);
  background: #fff; color: var(--c-muted); cursor: pointer;
}

.card-list { list-style: none; }
.alert-card {
  background: #fff; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px;
  border-left: 4px solid var(--c-danger); box-shadow: 0 2px 10px rgba(26, 54, 93, 0.06);
}
.ac-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.ac-name { font-weight: 600; color: var(--c-primary); }
.ac-meta { display: flex; gap: 14px; margin-top: 6px; font-size: 13px; color: var(--c-muted); flex-wrap: wrap; }
.ac-locs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.ac-loc { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #eff6ff; color: var(--c-primary); }
</style>
