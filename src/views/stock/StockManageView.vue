<template>
  <div class="stock-page">
    <PageHeader title="库存明细" sub="按库房查看商品存放分布与预警状态" />
    <!-- 汇总卡片 -->
    <div class="stat-row">
      <div class="stat-card">
        <span class="s-label">商品 SKU</span>
        <b class="s-value">{{ stats.skuCount }}</b>
      </div>
      <div class="stat-card">
        <span class="s-label">库存总量</span>
        <b class="s-value">{{ stats.totalQty }}</b>
      </div>
      <div v-if="canSeeAnyPrice" class="stat-card">
        <span class="s-label">库存金额（进价）</span>
        <b class="s-value">¥{{ money(stats.totalCost) }}</b>
      </div>
      <div class="stat-card" :class="{ danger: stats.warnCount > 0 }">
        <span class="s-label">库存预警</span>
        <b class="s-value">{{ stats.warnCount }}</b>
      </div>
    </div>

    <!-- 工具栏：搜索 + 分类筛选 + 仅看低库存 -->
    <div class="toolbar">
      <SearchInput
        v-model="keyword"
        class="toolbar-search"
        placeholder="搜索品牌 / 型号 / 分类"
        :debounce="0"
        @search="reload"
      />
      <select v-model="category" class="toolbar-select" @change="reload">
        <option value="">全部分类</option>
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-if="locations.length > 1" v-model.number="locFilter" class="toolbar-select">
        <option :value="0">全部库房</option>
        <option v-for="l in locations" :key="l.id" :value="l.id">只看 {{ l.name }} 有货</option>
      </select>
      <button
        class="toolbar-btn"
        :class="{ active: onlyLow }"
        type="button"
        @click="toggleOnlyLow"
      >
        {{ onlyLow ? '✓ 仅看低库存' : '仅看低库存' }}
      </button>
    </div>

    <!-- 库存预警区（实时库存低于预警值） -->
    <section v-if="warnList.length && !onlyLow" class="block">
      <h3 class="block-title danger">⚠️ 库存预警（{{ warnList.length }}）</h3>
      <ul v-if="isMobile" class="card-list">
        <li v-for="p in warnList" :key="p.id" class="prod-card warn-card">
          <div class="pc-head">
            <span class="pc-name">{{ productName(p) }}</span>
            <span class="pc-badge">预警</span>
          </div>
          <div class="pc-meta">
            <span class="pc-cat">{{ p.category }}</span>
            <span class="pc-qty">{{ stockOf(p.id!) }} {{ p.unit }}</span>
          </div>
        </li>
      </ul>
      <ul v-else class="stock-list">
        <li v-for="p in warnList" :key="p.id" class="stock-item warn">
          <span class="s-name">{{ productName(p) }}</span>
          <span class="s-cat">{{ p.category }}</span>
          <span class="s-qty">{{ stockOf(p.id!) }} {{ p.unit }}</span>
        </li>
      </ul>
    </section>

    <!-- 库存明细 -->
    <section class="block">
      <h3 class="block-title">库存明细（{{ list.length }}）</h3>

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
            <span class="pc-qty">库存 {{ stockOf(p.id!) }} {{ p.unit }}</span>
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
            <th>商品</th>
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
              <b>{{ stockOf(p.id!) }}</b>
              <span v-if="isLow(p)" class="row-badge">预警</span>
            </td>
            <td>{{ p.unit }}</td>
            <td v-if="canSeePurchasePrice" class="num">¥{{ money(p.purchasePrice) }}</td>
            <td v-if="canSeeAnyPrice" class="num">¥{{ money(p.wholesalePrice) }}</td>
            <td v-if="canSeeAnyPrice" class="num">¥{{ money(stockOf(p.id!) * p.purchasePrice) }}</td>
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
        v-model:page="pageProxy"
        :total="pager.total.value"
        :page-count="pager.pageCount.value"
        :size="pager.size.value"
      />
    </section>

    <!-- 出入库流水 -->
    <section class="block">
      <h3 class="block-title">出入库流水（最近 {{ records.length }}）</h3>
      <ul class="record-list">
        <li v-for="r in records" :key="r.id" class="record-item">
          <span class="r-type" :class="r.type">{{ typeLabel(r.type) }}</span>
          <span class="r-prod">{{ nameById(r.productId) }}</span>
          <span class="r-qty" :class="r.quantity > 0 ? 'in' : 'out'">
            {{ r.quantity > 0 ? '+' : '' }}{{ r.quantity }}
          </span>
          <span v-if="!isMobile" class="r-ref">单号 #{{ r.refOrderId }}</span>
          <span class="r-date">{{ fmtDate(r.createdAt) }}</span>
        </li>
        <li v-if="!records.length" class="empty">暂无流水</li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import SearchInput from '../../components/SearchInput.vue'
import TablePager from '../../components/TablePager.vue'
import { useProductStore } from '../../stores/product'
import { useInventoryStore } from '../../stores/inventory'
import { useResponsive } from '../../composables/useResponsive'
import { usePermission } from '../../composables/usePermission'
import { usePagination, PAGE_SIZE_LIST } from '../../composables/usePagination'
import { db } from '../../db'
import type { Product, StockRecord, Location } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'

const productStore = useProductStore()
const inventoryStore = useInventoryStore()
const { isMobile } = useResponsive()
const { canSeeAnyPrice, canSeePurchasePrice } = usePermission()

const keyword = ref('')
const category = ref('')
const onlyLow = ref(false)
const all = ref<Product[]>([])
const stockMap = ref<Record<number, number>>({})
const categories = ref<string[]>([])
const records = ref<StockRecord[]>([])
/** 库房列表与「商品 → 各库房数量」分布（库存明细按库房动态出列） */
const locations = ref<Location[]>([])
const distByProduct = ref<Record<number, Record<number, number>>>({})
const locFilter = ref(0)

// 先按搜索/分类过滤，再按「仅看低库存」过滤
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  let data = all.value
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
    const map = distByProduct.value
    data = data.filter(p => (map[p.id!]?.[locFilter.value] ?? 0) > 0)
  }
  return data
})

const list = computed(() => (onlyLow.value ? filtered.value.filter(isLow) : filtered.value))
const warnList = computed(() => filtered.value.filter(isLow))

// 库存明细 20 条一页；预警区始终展示全部，不分页
const pager = usePagination(list, PAGE_SIZE_LIST)
watch([keyword, category, onlyLow, locFilter], () => pager.reset())
const pageProxy = computed({
  get: () => pager.page.value,
  set: v => pager.go(v)
})

// 用于判断是否处于筛选状态（空态文案提示）
const hasFilter = computed(
  () => !!keyword.value.trim() || !!category.value || onlyLow.value || !!locFilter.value
)

// 商品、分类、[各库房列]、合计库存、单位、预警值、状态 + 价格列
const colspan = computed(
  () => 6 + locations.value.length + (canSeePurchasePrice.value ? 1 : 0) + (canSeeAnyPrice.value ? 2 : 0)
)

const stats = computed(() => {
  const data = list.value
  const warnCount = data.filter(isLow).length
  const totalCost = data.reduce((s, p) => s + stockOf(p.id!) * p.purchasePrice, 0)
  return {
    skuCount: data.length,
    totalQty: data.reduce((s, p) => s + stockOf(p.id!), 0),
    totalCost,
    warnCount
  }
})

async function reload(): Promise<void> {
  all.value = await productStore.search(keyword.value.trim())
  const m: Record<number, number> = {}
  for (const p of all.value) m[p.id!] = await productStore.getStock(p.id!)
  stockMap.value = m
  // 分类下拉基于全量商品（不受当前搜索影响），避免筛一次后选项消失
  const cats = await productStore.search('')
  categories.value = Array.from(new Set(cats.map(p => p.category).filter(Boolean))).sort()
  records.value = await db.stockRecords.orderBy('createdAt').reverse().limit(20).toArray()
  await loadDistributions()
}

/** 库房列表 + 全部商品的库房分布（一次取全，页面按库房动态出列） */
async function loadDistributions(): Promise<void> {
  await inventoryStore.ensureLocations()
  locations.value = await inventoryStore.listLocations()
  // 自愈：兼容只有总库存、还没写过库房分布的老数据
  await inventoryStore.reconcileProducts(all.value.map(p => p.id!))
  const { byProduct } = await inventoryStore.distributionAll()
  distByProduct.value = byProduct
}

/** 某商品在某库房的数量 */
function locQty(productId: number, locationId: number): number {
  return distByProduct.value[productId]?.[locationId] ?? 0
}

function toggleOnlyLow(): void {
  onlyLow.value = !onlyLow.value
}

onMounted(reload)

function stockOf(id?: number): number { return id ? (stockMap.value[id] ?? 0) : 0 }
function isLow(p: Product): boolean { return stockOf(p.id!) <= p.warnStock }
function productName(p: Product): string { return productStore.productName(p) }
function money(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '0'
}
function typeLabel(t: string): string {
  return t === 'purchase_in' ? '采购入库' : t === 'sale_out' ? '销售出库' : '库存调整'
}
function nameById(id: number): string {
  const p = all.value.find(x => x.id === id)
  return p ? productName(p) : `商品#${id}`
}
function fmtDate(s: string): string {
  return s ? s.slice(0, 16).replace('T', ' ') : ''
}
</script>

<style scoped>
.stock-page { max-width: 1100px; margin: 0 auto; }
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
.stat-card {
  background: #fff; border-radius: 12px; padding: 14px 16px;
  box-shadow: 0 2px 10px rgba(26, 54, 93, 0.06);
}
.stat-card.danger { border-left: 4px solid var(--c-danger, #e53e3e); }
.s-label { display: block; font-size: 12px; color: var(--c-muted, #64748b); }
.s-value { display: block; font-size: 20px; color: var(--c-primary, #1a365d); margin-top: 4px; }

.toolbar { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.toolbar-search { flex: 1; min-width: 200px; }
.toolbar-select, .toolbar-btn {
  height: 44px; border: 1px solid var(--c-border, #e2e8f0); border-radius: 10px;
  padding: 0 14px; font-size: 14px; outline: none; background: #fff; cursor: pointer;
  color: var(--c-text, #1a202c);
}
.toolbar-btn.active { background: var(--c-accent, #2563eb); color: #fff; border-color: var(--c-accent, #2563eb); }

.block-title.danger { color: var(--c-danger, #e53e3e); }

.card-list { list-style: none; }
.prod-card {
  background: #fff; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px;
  box-shadow: 0 2px 10px rgba(26, 54, 93, 0.06);
}
.prod-card.warn-card { border-left: 4px solid var(--c-danger, #e53e3e); }
.pc-head { display: flex; justify-content: space-between; align-items: center; }
.pc-name { font-weight: 600; color: var(--c-primary, #1a365d); }
.pc-badge { background: var(--c-danger, #e53e3e); color: #fff; font-size: 11px; padding: 1px 8px; border-radius: 10px; }
.pc-meta { display: flex; gap: 14px; margin-top: 6px; font-size: 13px; color: var(--c-muted, #64748b); flex-wrap: wrap; }
.pc-qty { color: var(--c-text, #1a202c); font-weight: 600; }
.pc-price { color: var(--c-success, #16a34a); }

.stock-list, .record-list { list-style: none; }
.stock-item { display: flex; align-items: center; gap: 10px; padding: 12px 4px; border-bottom: 1px solid var(--c-border, #e2e8f0); font-size: 14px; }
.stock-item:last-child { border-bottom: none; }
.stock-item.warn .s-qty { color: var(--c-danger, #e53e3e); font-weight: 700; }
.s-name { flex: 1; }
.s-cat { color: var(--c-muted, #64748b); font-size: 12px; }
.s-qty { font-weight: 600; }

.stock-table { width: 100%; border-collapse: collapse; background: #fff; }
.stock-table th, .stock-table td { padding: 11px 12px; text-align: left; border-bottom: 1px solid var(--c-border, #e2e8f0); font-size: 14px; }
.stock-table th { background: #f1f5f9; color: var(--c-primary, #1a365d); }
.stock-table .num { text-align: right; }
.stock-table tr.warn { background: #fff5f5; }
.row-badge { color: var(--c-danger, #e53e3e); font-size: 12px; margin-left: 6px; }
/* 库房列：表头略窄，数量为 0 的格子淡显，一眼看出货放在哪个库 */
.stock-table th.loc-col { font-size: 12px; white-space: nowrap; }
.stock-table td.loc-zero { color: #cbd5e1; }
/* 手机端卡片里的库房分布 */
.pc-locs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.pc-loc {
  font-size: 12px; padding: 2px 8px; border-radius: 999px;
  background: #eff6ff; color: var(--c-primary, #1a365d);
}
.pc-loc.zero { background: #f1f5f9; color: #cbd5e1; }
.c-cat, .c-muted { color: var(--c-muted, #64748b); font-size: 13px; }
.c-danger { color: var(--c-danger, #e53e3e); font-size: 13px; font-weight: 600; }

.record-item { display: flex; align-items: center; gap: 10px; padding: 10px 4px; border-bottom: 1px solid var(--c-border, #e2e8f0); font-size: 13px; }
.record-item:last-child { border-bottom: none; }
.r-type { padding: 2px 8px; border-radius: 6px; background: var(--c-bg, #f8fafc); font-size: 12px; }
.r-type.purchase_in { color: var(--c-success, #16a34a); }
.r-type.sale_out { color: var(--c-danger, #e53e3e); }
.r-prod { flex: 1; }
.r-qty.in { color: var(--c-success, #16a34a); font-weight: 600; }
.r-qty.out { color: var(--c-danger, #e53e3e); font-weight: 600; }
.r-ref, .r-date { color: var(--c-muted, #64748b); }
.empty { text-align: center; color: var(--c-muted, #64748b); padding: 20px; }

@media (max-width: 767px) {
  .stat-row { grid-template-columns: repeat(2, 1fr); }
}
</style>
