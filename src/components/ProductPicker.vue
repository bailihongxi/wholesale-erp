<template>
  <!--
    全站统一的「选商品」区块：采购单、销售单等所有需要挑商品的地方都复用它。
    固定三件套：顶部搜索框、列表显示可用库存、底部分页（默认 20 条/页）。
    商品多了以后靠搜索定位，避免在一长串里翻找；库存直接列出来，
    开单前就能看出哪些不能卖，不必等到提交被拦才知道。
  -->
  <section class="picker">
    <header class="pk-head">
      <h4 class="pk-title">
        {{ title }}
        <span v-if="priceModeLabel" class="tag tag-info">{{ priceModeLabel }}</span>
      </h4>
      <div class="data-toolbar pk-tools">
        <SearchInput
          v-model="kw"
          class="grow"
          :placeholder="`搜索商品名称 / 型号 / 分类（共 ${products.length} 条）`"
          :debounce="0"
          @search="pager.reset()"
        />
        <select v-model="cat" class="pk-sel" @change="pager.reset()">
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
            <th>型号 / 规格</th>
            <th class="center" style="width:56px">单位</th>
            <th class="num" style="width:90px">可用库存</th>
            <th v-if="showPrice" class="num" style="width:100px">{{ priceHeader }}</th>
            <th class="center" style="width:96px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(p, i) in pager.paged.value"
            :key="p.id"
            :class="{
              'row-disabled': p.stock <= 0 && blockNoStock,
              'row-picked': selectedCount(p.product.id!) > 0
            }"
          >
            <td class="center">{{ pager.startIndex.value + i }}</td>
            <td>{{ nameOf(p.product) }}</td>
            <td>{{ p.product.category || '-' }}</td>
            <td class="pk-sub">{{ p.product.spec || p.product.model || '-' }}</td>
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
                @click="emit('pick', p.product)"
              >{{ addLabel(p.product.id!) }}</button>
            </td>
          </tr>
          <tr v-if="!pager.paged.value.length">
            <td :colspan="showPrice ? 8 : 7" class="empty">
              {{ products.length ? '没有匹配的商品，换个关键词试试' : '暂无商品，请先在商品档案中添加' }}
            </td>
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
import { ref, computed, watch } from 'vue'
import SearchInput from './SearchInput.vue'
import TablePager from './TablePager.vue'
import { usePagination, PAGE_SIZE_LIST } from '../composables/usePagination'
import type { Product } from '../types'

/** 带库存的商品行，调用方一次性算好传入，避免逐条查询拖慢列表 */
export interface PickerRow {
  product: Product
  stock: number
}

const props = withDefaults(
  defineProps<{
    rows: PickerRow[]
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
    selected: () => ({}),
    priceMode: 'wholesale',
    showPrice: true,
    blockNoStock: false,
    title: '商品列表',
    pageSize: PAGE_SIZE_LIST
  }
)

const emit = defineEmits<{ (e: 'pick', p: Product): void }>()

const kw = ref('')
const cat = ref('')
const onlyInStock = ref(false)

const products = computed(() => props.rows)

const filtered = computed<PickerRow[]>(() => {
  const k = kw.value.trim().toLowerCase()
  return products.value.filter(r => {
    if (cat.value && r.product.category !== cat.value) return false
    if (onlyInStock.value && r.stock <= 0) return false
    if (!k) return true
    const p = r.product
    return (
      p.brand.toLowerCase().includes(k) ||
      p.model.toLowerCase().includes(k) ||
      (p.category ?? '').toLowerCase().includes(k) ||
      (p.spec ?? '').toLowerCase().includes(k) ||
      `${p.brand} ${p.model}`.toLowerCase().includes(k)
    )
  })
})

const pager = usePagination(filtered, props.pageSize)
watch([kw, cat, onlyInStock], () => pager.reset())

const pageProxy = computed({
  get: () => pager.page.value,
  set: v => pager.go(v)
})

const cats = computed(() => {
  const s = new Set<string>()
  for (const r of products.value) if (r.product.category) s.add(r.product.category)
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
  height: 44px; border: 1px solid var(--c-border); border-radius: 10px;
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
</style>
