<template>
  <div class="page">
    <SegmentedTabs v-model="tab" size="sm" :options="tabOptions" />

    <!-- ============ 待发货 ============ -->
    <template v-if="tab === 'pending'">
      <ul v-if="isMobile" class="card-list zebra-list">
        <li v-for="o in orders" :key="o.id" class="order-card" @click="go(`/warehouse/outbound/${o.id}`)">
          <div class="oc-head">
            <span class="oc-no">{{ o.orderNo }}</span>
            <span class="oc-status" :class="o.status">{{ statusText(o.status) }}</span>
          </div>
          <div class="oc-meta">
            <span>{{ customerName(o.customerId) }}</span>
            <span class="oc-amt">{{ countOf(o.id) }} 项</span>
          </div>
        </li>
        <li v-if="!orders.length" class="empty">暂无待发货</li>
      </ul>
      <table v-else class="data-table order-table">
        <thead>
          <tr><th>单号</th><th>客户</th><th>日期</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="o in orders" :key="o.id">
            <td>{{ o.orderNo }}</td>
            <td>{{ customerName(o.customerId) }}</td>
            <td>{{ (o.orderDate ?? '').slice(0, 10) }}</td>
            <td :class="o.status">{{ statusText(o.status) }}</td>
            <td><button class="link-btn" type="button" @click="go(`/warehouse/outbound/${o.id}`)">拣货</button></td>
          </tr>
          <tr v-if="!orders.length"><td colspan="5" class="empty">暂无待发货</td></tr>
        </tbody>
      </table>
    </template>

    <!-- ============ 出库单历史（每次发货生成一张 CK 单，分批发货会拆成多张） ============ -->
    <template v-else>
      <div class="data-toolbar">
        <SearchInput
          v-model="keyword"
          class="grow"
          placeholder="搜索出库单号 / 销售单号 / 客户 / 商品"
          :debounce="0"
          @search="pager.reset()"
        />
        <input v-model="dateFrom" type="date" class="filter" aria-label="开始日期" />
        <span class="dp-sep">至</span>
        <input v-model="dateTo" type="date" class="filter" aria-label="结束日期" />
        <button v-if="hasFilter" class="reset-btn" type="button" @click="resetFilter">重置</button>
      </div>

      <ul v-if="isMobile" class="card-list zebra-list">
        <li v-for="d in pager.paged.value" :key="d.batchNo" class="doc-card" @click="openDoc(d.batchNo)">
          <div class="oc-head">
            <span class="oc-no">{{ d.batchNo }}</span>
            <span class="hs-qty">-{{ d.totalQty }} 件</span>
          </div>
          <div class="oc-meta">
            <span>{{ d.partyName }}</span>
            <span class="oc-date">{{ fmtTime(d.createdAt) }}</span>
          </div>
          <div class="hs-sub">
            来源 {{ d.orderNo }} · {{ d.itemCount }} 个品种 · {{ d.operatorName }}
          </div>
        </li>
        <li v-if="!pager.paged.value.length" class="empty">没有符合条件的出库单</li>
      </ul>

      <table v-else class="data-table order-table">
        <thead>
          <tr>
            <th>出库单号</th>
            <th>来源销售单</th>
            <th>客户</th>
            <th>商品名称</th>
            <th class="num">数量</th>
            <th class="num">金额</th>
            <th>发货时间</th>
            <th>经手人</th>
            <th class="center">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in pager.paged.value" :key="d.batchNo">
            <td class="mono">{{ d.batchNo }}</td>
            <td class="mono sub">{{ d.orderNo }}</td>
            <td>{{ d.partyName }}</td>
            <td class="pnames" :title="d.productNames">{{ d.productNames }}</td>
            <td class="num stock-out">-{{ d.totalQty }}</td>
            <td class="num">¥{{ d.amount.toLocaleString() }}</td>
            <td>{{ fmtTime(d.createdAt) }}</td>
            <td>{{ d.operatorName }}</td>
            <td class="center">
              <button class="link-btn" type="button" @click="openDoc(d.batchNo)">明细</button>
            </td>
          </tr>
          <tr v-if="!pager.paged.value.length">
            <td colspan="9" class="empty">没有符合条件的出库单</td>
          </tr>
        </tbody>
      </table>

      <TablePager
        v-model:page="pageProxy"
        :total="pager.total.value"
        :page-count="pager.pageCount.value"
        :size="pager.size.value"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useReloadOnActivate } from '../../composables/useReloadOnActivate'
import { useListCache } from '../../composables/useListCache'
import { useRouter } from 'vue-router'
import { useSalesStore } from '../../stores/sales'
import { useStockDocStore, type StockDocRow } from '../../stores/stockDoc'
import { useResponsive } from '../../composables/useResponsive'
import { usePagination, PAGE_SIZE_LIST } from '../../composables/usePagination'
import SearchInput from '../../components/SearchInput.vue'
import TablePager from '../../components/TablePager.vue'
import SegmentedTabs from '../../components/ui/SegmentedTabs.vue'
import type { SaleOrder, Customer } from '../../types'

const router = useRouter()
const salesStore = useSalesStore()
const docStore = useStockDocStore()
const { isMobile } = useResponsive()

const tab = ref<'pending' | 'history'>('pending')
const orders = ref<SaleOrder[]>([])
const customers = ref<Customer[]>([])
const counts = ref<Record<number, number>>({})
/** 出库历史按「出库单（批次）」展示：一次发货 = 一张 CK 单 */
const docs = ref<StockDocRow[]>([])

const keyword = ref('')
const dateFrom = ref('')
const dateTo = ref('')

const hasFilter = computed(() => !!keyword.value || !!dateFrom.value || !!dateTo.value)

/** 页内 Tab 选项（数量随数据实时变化，故用 computed 生成） */
const tabOptions = computed(() => [
  { value: 'pending', label: `待发货（${orders.value.length}）` },
  { value: 'history', label: `出库历史（${filteredDocs.value.length} 张单）` }
])

const filteredDocs = computed<StockDocRow[]>(() => {
  let data = docs.value
  if (dateFrom.value) {
    data = data.filter(d => (d.createdAt ?? '').slice(0, 10) >= dateFrom.value)
  }
  if (dateTo.value) {
    data = data.filter(d => (d.createdAt ?? '').slice(0, 10) <= dateTo.value)
  }
  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    data = data.filter(d =>
      d.batchNo.toLowerCase().includes(kw) ||
      (d.orderNo ?? '').toLowerCase().includes(kw) ||
      (d.partyName ?? '').toLowerCase().includes(kw) ||
      (d.productNames ?? '').toLowerCase().includes(kw) ||
      (d.operatorName ?? '').toLowerCase().includes(kw)
    )
  }
  return data
})

const pager = usePagination(filteredDocs, PAGE_SIZE_LIST)
watch([keyword, dateFrom, dateTo], () => pager.reset())
const pageProxy = computed({
  get: () => pager.page.value,
  set: v => pager.go(v)
})

function resetFilter(): void {
  keyword.value = ''
  dateFrom.value = ''
  dateTo.value = ''
}

const listCache = useListCache('outbound-list')

async function reload(useCache = true): Promise<void> {
  // 先看缓存
  if (useCache) {
    const cached = listCache.get<{ orders: any[]; customers: any[]; counts: Record<number, number> }>()
    if (cached) {
      orders.value = cached.orders
      customers.value = cached.customers
      counts.value = cached.counts
      return
    }
  }

  orders.value = await salesStore.listPendingOutbound()
  customers.value = await salesStore.listCustomers()
  const c: Record<number, number> = {}
  for (const o of orders.value) {
    c[o.id!] = (await salesStore.getOrderItems(o.id!)).length
  }
  counts.value = c
  // 写入缓存
  listCache.set({ orders: orders.value, customers: customers.value, counts: c })
}

async function loadHistory(useCache = true): Promise<void> {
  // 历史单据也加缓存
  const historyCache = useListCache('outbound-history')
  if (useCache) {
    const cached = historyCache.get<any[]>()
    if (cached) {
      docs.value = cached
      return
    }
  }
  docs.value = await docStore.listDocs('out')
  historyCache.set(docs.value)
}

watch(tab, async v => {
  if (v === 'history') await loadHistory()
})

function customerName(id: number): string {
  return customers.value.find(c => c.id === id)?.name ?? '未知客户'
}
function countOf(id?: number): number { return id ? (counts.value[id] ?? 0) : 0 }
function statusText(s: string): string {
  return { pending: '待出库', partial: '部分出库', completed: '已完成' }[s] || s
}
function fmtTime(s: string): string {
  return s ? s.slice(0, 16).replace('T', ' ') : '-'
}
function go(p: string): void { router.push(p) }
function openDoc(batchNo: string): void {
  router.push(`/warehouse/outbound/doc/${batchNo}`)
}

onMounted(async () => {
  await reload()
  await loadHistory()
})

// 回到本页时自动刷新：路由组件被 App.vue 的 <keep-alive> 缓存，
// 从别的页面回来是「复活」而非「重新挂载」，onMounted 不会再跑，数据会停在旧状态。
useReloadOnActivate(async () => { await reload(true); await loadHistory(true) })
</script>

<style scoped>
.page { max-width: 1100px; margin: 0 auto; }

.toolbar { display: flex; gap: 10px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
.tb-search { flex: 1; min-width: 180px; }
.filter { height: 40px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm); padding: 0 12px; background: #fff; }
.dp-sep { color: var(--c-muted); font-size: 13px; }
.reset-btn { height: 40px; padding: 0 14px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm); background: #fff; color: var(--c-muted); cursor: pointer; }

.card-list { list-style: none; }
.card-list { border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.order-card, .doc-card { padding: 14px 16px; border-bottom: 1px solid var(--c-border); cursor: pointer; }
.order-card:hover, .doc-card:hover { background: #eaf1ff; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.mono.sub { color: var(--c-muted); }
.pnames { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--c-muted); }
.oc-head { display: flex; justify-content: space-between; align-items: center; }
.oc-no { font-weight: 600; color: var(--c-primary); }
.oc-status { font-size: 12px; padding: 1px 8px; border-radius: 10px; background: var(--c-bg); color: var(--c-muted); }
.oc-status.pending { color: var(--c-warning); }
.oc-status.completed { color: var(--c-success); }
.oc-meta { display: flex; justify-content: space-between; margin-top: 8px; font-size: 13px; color: var(--c-muted); }
.oc-date { font-size: 12px; }
.oc-amt { color: var(--c-text); font-weight: 600; }
.hs-qty { color: var(--c-danger, #dc2626); font-weight: 700; }
.hs-sub { font-size: 12px; color: var(--c-muted); margin-top: 4px; }

.order-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.order-table th, .order-table td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--c-border); font-size: 14px; }
.order-table th { background: #f1f5f9; color: var(--c-primary); }
.order-table .num { text-align: right; }
.order-table td.completed { color: var(--c-success); }
.order-table td.pending { color: var(--c-warning); }
.link-btn { border: none; background: none; color: var(--c-accent); cursor: pointer; }
.empty { text-align: center; color: var(--c-muted); padding: 20px; }
</style>
