<template>
  <!-- 库存明细：按库房查看商品存放分布（数据由父级「库存管理」统一加载后传入） -->
  <div class="page">
    <!--
      全库概况卡片（第十五轮起从 Hub 页头下移到本模块，位于搜索框上方）：
      反映全库现状，不随页内搜索变化，方便对着明细核对。
    -->
    <div class="ui-stat-grid">
      <StatCard label="商品 SKU" :value="stats.skuCount" />
      <StatCard label="库存总量" :value="stats.totalQty" />
      <!-- 金额按进价汇总，故与「进价」同权限：销售/库房都不应看到 -->
      <StatCard v-if="canSeePurchasePrice" label="库存金额（进价）" :value="`¥${money(stats.totalCost)}`" />
      <StatCard
        label="库存预警"
        :value="stats.warnCount"
        :tone="stats.warnCount > 0 ? 'danger' : 'neutral'"
      />
    </div>

    <!-- 工具栏：搜索 + 分类 + 库房 + 仅看低库存 -->
    <div class="toolbar">
      <SearchInput
        v-model="keyword"
        class="toolbar-search"
        placeholder="搜索品牌 / 型号 / 分类"
        :debounce="0"
      />
      <select v-model="category" class="toolbar-select">
        <option value="">全部分类</option>
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-if="locations.length > 1" v-model.number="locFilter" class="toolbar-select">
        <option :value="0">全部库房</option>
        <option v-for="l in locations" :key="l.id" :value="l.id">只看 {{ l.name }} 有货</option>
      </select>
      <button class="toolbar-btn" :class="{ active: onlyLow }" type="button" @click="toggleOnlyLow">
        {{ onlyLow ? '✓ 仅看低库存' : '仅看低库存' }}
      </button>
      <button v-if="hasFilter" class="reset-btn" type="button" @click="resetFilter">重置</button>
    </div>

    <LoadingBlock v-if="loading" :rows="6" />

    <template v-else>
      <ul v-if="isMobile" class="card-list zebra-list">
        <li
          v-for="p in pager.paged.value"
          :key="p.id"
          class="prod-card"
          :class="{ 'warn-card': isLow(p) }"
        >
          <div class="pc-head">
            <span class="pc-name">{{ productName(p) }}</span>
            <span v-if="isLow(p)" class="pc-badge">预警</span>
          </div>
          <div class="pc-meta">
            <span class="pc-cat">{{ p.category }}</span>
            <span class="pc-qty">库存 {{ stockOf(p.id) }} {{ p.unit }}</span>
            <span v-if="canSeeAnyPrice" class="pc-price">批发 ¥{{ money(p.wholesalePrice) }}</span>
          </div>
          <div v-if="locations.length > 1" class="pc-locs">
            <span
              v-for="l in locations"
              :key="l.id"
              class="pc-loc"
              :class="{ zero: locQty(p.id!, l.id!) === 0 }"
            >
              {{ l.name }} {{ locQty(p.id!, l.id!) }}
            </span>
          </div>
        </li>
        <li v-if="!pager.paged.value.length" class="empty">
          {{ hasFilter ? '没有匹配的商品，试试清除搜索条件' : '暂无商品' }}
        </li>
      </ul>

      <table v-else class="stock-table data-table">
        <thead>
          <tr>
            <th>商品名称</th>
            <th>分类</th>
            <!-- 按库房动态生成列：一个商品的数量可以分散在多个库房 -->
            <th v-for="l in locations" :key="l.id" class="num loc-col" :title="l.remark || l.name">
              {{ l.name }}
            </th>
            <th class="num">合计库存</th>
            <th>单位</th>
            <th v-if="canSeePurchasePrice" class="num">进价</th>
            <th v-if="canSeeAnyPrice" class="num">批发价</th>
            <th v-if="canSeeAnyPrice" class="num">库存金额</th>
            <th>预警值</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in pager.paged.value" :key="p.id" :class="{ warn: isLow(p) }">
            <td>{{ productName(p) }}</td>
            <td class="c-cat">{{ p.category }}</td>
            <td
              v-for="l in locations"
              :key="l.id"
              class="num"
              :class="{ 'loc-zero': locQty(p.id!, l.id!) === 0 }"
            >
              {{ locQty(p.id!, l.id!) }}
            </td>
            <td class="num">
              <b>{{ stockOf(p.id) }}</b>
              <span v-if="isLow(p)" class="row-badge">预警</span>
            </td>
            <td>{{ p.unit }}</td>
            <td v-if="canSeePurchasePrice" class="num">¥{{ money(p.purchasePrice) }}</td>
            <td v-if="canSeeAnyPrice" class="num">¥{{ money(p.wholesalePrice) }}</td>
            <td v-if="canSeeAnyPrice" class="num">¥{{ money(stockOf(p.id) * p.purchasePrice) }}</td>
            <td>{{ p.warnStock }}</td>
            <td :class="isLow(p) ? 'c-danger' : 'c-muted'">{{ isLow(p) ? '需补货' : '正常' }}</td>
          </tr>
          <tr v-if="!pager.paged.value.length">
            <td :colspan="colspan" class="empty">
              {{ hasFilter ? '没有匹配的商品，试试清除搜索条件' : '暂无商品' }}
            </td>
          </tr>
        </tbody>
      </table>

      <TablePager
        v-if="pager.total.value"
        v-model:page="pageProxy"
        :total="pager.total.value"
        :page-count="pager.pageCount.value"
        :size="pager.size.value"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import SearchInput from '../../components/SearchInput.vue'
import TablePager from '../../components/TablePager.vue'
import LoadingBlock from '../../components/ui/LoadingBlock.vue'
import StatCard from '../../components/ui/StatCard.vue'
import { useProductStore } from '../../stores/product'
import { useResponsive } from '../../composables/useResponsive'
import { usePermission } from '../../composables/usePermission'
import { usePagination, PAGE_SIZE_LIST } from '../../composables/usePagination'
import type { Product, Location } from '../../types'

const props = withDefaults(
  defineProps<{
    products: Product[]
    stock: Record<number, number>
    locations: Location[]
    dist: Record<number, Record<number, number>>
    loading?: boolean
  }>(),
  { loading: false }
)

const productStore = useProductStore()
const { isMobile } = useResponsive()
const { canSeeAnyPrice, canSeePurchasePrice } = usePermission()

const keyword = ref('')
const category = ref('')
const onlyLow = ref(false)
const locFilter = ref(0)

/** 分类下拉基于全量商品（不受当前搜索影响），避免筛一次后选项消失 */
const categories = computed(() =>
  Array.from(new Set(props.products.map(p => p.category).filter(Boolean))).sort()
)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  let data = props.products
  if (kw) {
    data = data.filter(p =>
      p.brand.toLowerCase().includes(kw) ||
      p.model.toLowerCase().includes(kw) ||
      `${p.brand} ${p.model}`.toLowerCase().includes(kw) ||
      p.category.toLowerCase().includes(kw)
    )
  }
  if (category.value) data = data.filter(p => p.category === category.value)
  // 「只看某库房有货」：该库房有数量的商品
  if (locFilter.value) {
    const map = props.dist
    data = data.filter(p => (map[p.id!]?.[locFilter.value] ?? 0) > 0)
  }
  return data
})

const list = computed(() => (onlyLow.value ? filtered.value.filter(isLow) : filtered.value))

const pager = usePagination(list, PAGE_SIZE_LIST)
watch([keyword, category, onlyLow, locFilter], () => pager.reset())
const pageProxy = computed({
  get: () => pager.page.value,
  set: v => pager.go(v)
})

const hasFilter = computed(
  () => !!keyword.value.trim() || !!category.value || onlyLow.value || !!locFilter.value
)

/** 全库概况：始终基于全量商品，不受页内搜索/筛选影响（与明细表可对照） */
const stats = computed(() => {
  const data = props.products
  return {
    skuCount: data.length,
    totalQty: data.reduce((s, p) => s + stockOf(p.id), 0),
    totalCost: data.reduce((s, p) => s + stockOf(p.id) * p.purchasePrice, 0),
    warnCount: data.filter(isLow).length
  }
})

// 商品、分类、[各库房列]、合计库存、单位、预警值、状态 + 价格列
const colspan = computed(
  () => 6 + props.locations.length + (canSeePurchasePrice.value ? 1 : 0) + (canSeeAnyPrice.value ? 2 : 0)
)

function locQty(productId: number, locationId: number): number {
  return props.dist[productId]?.[locationId] ?? 0
}
function toggleOnlyLow(): void {
  onlyLow.value = !onlyLow.value
}
function resetFilter(): void {
  keyword.value = ''
  category.value = ''
  onlyLow.value = false
  locFilter.value = 0
}
function stockOf(id?: number): number {
  return id ? (props.stock[id] ?? 0) : 0
}
function isLow(p: Product): boolean {
  return stockOf(p.id) <= p.warnStock
}
function productName(p: Product): string {
  return productStore.productName(p)
}
function money(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '0'
}
</script>

<style scoped>
.card-list { list-style: none; }
.prod-card {
  background: #fff; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px;
  box-shadow: 0 2px 10px rgba(26, 54, 93, 0.06);
}
.prod-card.warn-card { border-left: 4px solid var(--c-danger); }
.pc-head { display: flex; justify-content: space-between; align-items: center; }
.pc-name { font-weight: 600; color: var(--c-primary); }
.pc-badge { background: var(--c-danger); color: #fff; font-size: 11px; padding: 1px 8px; border-radius: 10px; }
.pc-meta { display: flex; gap: 14px; margin-top: 6px; font-size: 13px; color: var(--c-muted); flex-wrap: wrap; }
.pc-qty { color: var(--c-text); font-weight: 600; }
.pc-price { color: var(--c-success); }
.pc-locs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.pc-loc {
  font-size: 12px; padding: 2px 8px; border-radius: 999px;
  background: #eff6ff; color: var(--c-primary);
}
.pc-loc.zero { background: #f1f5f9; color: #cbd5e1; }

.stock-table tr.warn { background: #fff5f5; }
.stock-table tbody tr.warn:hover { background: #ffecec; }
.row-badge { color: var(--c-danger); font-size: 12px; margin-left: 6px; }
/* 库房列：表头略窄，数量为 0 的格子淡显，一眼看出货放在哪个库 */
.stock-table th.loc-col { font-size: 12px; white-space: nowrap; }
.stock-table td.loc-zero { color: #cbd5e1; }
.c-cat, .c-muted { color: var(--c-muted); font-size: 13px; }
.c-danger { color: var(--c-danger); font-size: 13px; font-weight: 600; }

.reset-btn {
  height: 40px; padding: 0 14px; border: 1px solid var(--c-border); border-radius: var(--r-sm);
  background: #fff; color: var(--c-muted); cursor: pointer;
}
.toolbar-btn {
  height: 40px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm);
  padding: 0 14px; font-size: 14px; background: #fff; cursor: pointer; color: var(--c-text-2);
  white-space: nowrap;
}
.toolbar-btn.active { background: var(--c-accent); color: #fff; border-color: var(--c-accent); }
</style>
