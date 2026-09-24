<template>
  <div class="orders" :class="isMobile ? 'is-mobile' : 'is-desktop'">
    <PageHeader title="销售单" sub="销售开单、审核与出库进度" />

    <!-- 页内 Tab：销售单 / 报价单（第二十轮起报价单收进销售管理页内） -->
    <div class="orders-tabs">
      <button type="button" :class="{ active: route.path === '/sales/orders' }" @click="go('/sales/orders')">
        销售单
      </button>
      <button type="button" :class="{ active: route.path === '/sales/quotes' }" @click="go('/sales/quotes')">
        报价单
      </button>
    </div>

    <div class="toolbar">
      <SearchInput
        v-model="keyword"
        class="tb-search"
        placeholder="搜索单号 / 客户"
      />
      <select v-model="statusFilter" class="filter">
        <option value="">全部状态</option>
        <option value="pending">待出库</option>
        <option value="partial">部分出库</option>
        <option value="completed">已完成</option>
      </select>
      <input v-model="dateFrom" type="date" class="filter" aria-label="开始日期" />
      <span class="dp-sep">至</span>
      <input v-model="dateTo" type="date" class="filter" aria-label="结束日期" />
      <button v-if="hasFilter" class="reset-btn" type="button" @click="resetFilter">重置</button>
      <button v-if="!isMobile" class="add-btn" type="button" @click="go('/sales/orders/new')">＋ 新建</button>
    </div>

    <div class="sum-line">共 {{ pager.total.value }} 张销售单</div>

    <LoadingBlock v-if="pager.loading.value" :rows="6" />

    <ul v-else-if="isMobile" class="card-list zebra-list">
      <li v-for="o in pager.paged.value" :key="o.id" class="order-card" @click="go(`/sales/orders/${o.id}`)">
        <div class="oc-head">
          <span class="oc-no">{{ o.orderNo }}</span>
          <span class="oc-status" :class="o.status">{{ statusText(o.status) }}</span>
        </div>
        <div class="oc-meta">
          <span>{{ customerName(o.customerId) }}</span>
          <span class="oc-amt">¥{{ o.totalAmount.toLocaleString() }}</span>
        </div>
        <div class="oc-date">{{ o.orderDate.slice(0, 10) }}</div>
      </li>
      <li v-if="!pager.total.value" class="empty">没有符合条件的销售单</li>
    </ul>

    <table v-else class="data-table order-table">
      <thead>
        <tr><th>单号</th><th>客户</th><th>日期</th><th>金额</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="o in pager.paged.value" :key="o.id">
          <td>{{ o.orderNo }}</td>
          <td>{{ customerName(o.customerId) }}</td>
          <td>{{ o.orderDate.slice(0, 10) }}</td>
          <td>¥{{ o.totalAmount.toLocaleString() }}</td>
          <td :class="o.status">{{ statusText(o.status) }}</td>
          <td><button class="link-btn" type="button" @click="go(`/sales/orders/${o.id}`)">查看</button></td>
        </tr>
        <tr v-if="!pager.total.value"><td colspan="6" class="empty">没有符合条件的销售单</td></tr>
      </tbody>
    </table>

    <TablePager
      v-if="pager.total.value"
      v-model:page="page"
      :page-count="pager.pageCount.value"
      :total="pager.total.value"
      :size="pager.size.value"
      show-jump
    />

    <button v-if="!pager.loading.value && isMobile" class="fab" type="button" @click="go('/sales/orders/new')">＋</button>
  </div>
</template>

<script setup lang="ts">
import TablePager from '../../components/TablePager.vue'
import { useServerPager } from '../../composables/useServerPager'
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSalesStore } from '../../stores/sales'
import { useResponsive } from '../../composables/useResponsive'
import SearchInput from '../../components/SearchInput.vue'
import LoadingBlock from '../../components/ui/LoadingBlock.vue'
import { serverPage } from '../../db/serverPage'
import { db } from '../../db'
import { escapeOr } from '../../db/cloudDb'
import type { SaleOrder } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'

const router = useRouter()
const route = useRoute()
const salesStore = useSalesStore()
const { isMobile } = useResponsive()

const keyword = ref('')
const statusFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')

const customerMap = ref<Map<number, string>>(new Map())

const hasFilter = computed(
  () => !!keyword.value || !!statusFilter.value || !!dateFrom.value || !!dateTo.value
)

// 服务端分页：只拉当前页 + 总数，不再进页面就全量拉取销售单（数据量大时首屏慢）
const pager = useServerPager<SaleOrder>({
  watch: [keyword, statusFilter, dateFrom, dateTo],
  loader: async (pg, size) => {
    await ensureCustomers()
    const kw = keyword.value.trim()
    let orExpr: string | undefined
    let extraFilter: ((r: SaleOrder) => boolean) | undefined
    if (kw) {
      const lower = kw.toLowerCase()
      const ids = [...customerMap.value.entries()]
        .filter(([, n]) => n.toLowerCase().includes(lower))
        .map(([id]) => id)
      const parts = [`orderNo.ilike.*${escapeOr(kw)}*`]
      if (ids.length) parts.push(`customerId.in.(${ids.join(',')})`)
      orExpr = parts.join(',')
      extraFilter = (r) =>
        (r.orderNo ?? '').toLowerCase().includes(lower) ||
        (customerMap.value.get(r.customerId) ?? '').toLowerCase().includes(lower)
    }
    return serverPage<SaleOrder>(db.saleOrders, {
      page: pg,
      pageSize: size,
      eq: statusFilter.value ? { status: statusFilter.value } : {},
      gte: dateFrom.value ? { orderDate: dateFrom.value } : {},
      lte: dateTo.value ? { orderDate: dateTo.value } : {},
      orderBy: 'orderDate',
      ascending: false,
      orExpr,
      extraFilter,
    })
  },
})
const page = computed({ get: () => pager.page.value, set: v => pager.go(v) })

async function loadCustomers(): Promise<void> {
  customerMap.value = await salesStore.getCustomerMap()
}
async function ensureCustomers(): Promise<void> {
  if (customerMap.value.size === 0) await loadCustomers()
}

function resetFilter(): void {
  keyword.value = ''
  statusFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
}

function customerName(id: number): string {
  return customerMap.value.get(id) ?? '未知客户'
}
function statusText(s: string): string {
  return { pending: '待出库', partial: '部分出库', completed: '已完成' }[s] || s
}
function go(p: string): void { router.push(p) }

onMounted(async () => {
  try {
    await loadCustomers()
  } catch {
    /* 数据库未就绪时保持空表，不让骨架卡住 */
  }
  // 不再额外 pager.reload()：useServerPager 自身已在 onMounted 首拉一次，
  // 这里再调会让首屏发两遍同样的请求（云端慢时尤其明显）。
  // 回到本页时的刷新由 useServerPager 内置的 useReloadOnActivate 负责。
})
</script>

<style scoped>
.orders { max-width: 1100px; margin: 0 auto; }
.orders-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
.orders-tabs button {
  height: 36px; padding: 0 18px; border: 1px solid var(--c-border-strong);
  border-radius: 18px; background: #fff; color: var(--c-muted); font-size: 14px; cursor: pointer;
}
.orders-tabs button.active { background: var(--c-primary); border-color: var(--c-primary); color: #fff; font-weight: 600; }
.toolbar { display: flex; gap: 10px; margin-bottom: 12px; align-items: center; }
.tb-search { flex: 1 1 320px; min-width: 200px; }
.filter { height: 40px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm); padding: 0 12px; background: #fff; }
.dp-sep { color: var(--c-muted); font-size: 13px; }
.reset-btn { height: 40px; padding: 0 14px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm); background: #fff; color: var(--c-muted); cursor: pointer; }
.add-btn { height: 40px; padding: 0 18px; border: none; border-radius: var(--r-sm); background: var(--c-accent); color: #fff; cursor: pointer; margin-left: auto; }
.sum-line { font-size: 12px; color: var(--c-muted); margin-bottom: 10px; }
.card-list { list-style: none; }
.order-card { background: #fff; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.oc-head { display: flex; justify-content: space-between; align-items: center; }
.oc-no { font-weight: 600; color: var(--c-primary); }
.oc-status { font-size: 12px; padding: 1px 8px; border-radius: 10px; background: var(--c-bg); color: var(--c-muted); }
.oc-status.pending { color: var(--c-warning); }
.oc-status.completed { color: var(--c-success); }
.oc-meta { display: flex; justify-content: space-between; margin-top: 8px; font-size: 13px; color: var(--c-muted); }
.oc-amt { color: var(--c-text); font-weight: 600; }
.oc-date { font-size: 12px; color: var(--c-muted); margin-top: 4px; }
/* 表格外观交给全站 .data-table（含斑马纹），这里只留状态色等业务样式 */
.order-table th, .order-table td { font-size: 14px; }
.order-table td.completed { color: var(--c-success); }
.order-table td.pending { color: var(--c-warning); }
.link-btn { border: none; background: none; color: var(--c-accent); cursor: pointer; }
.empty { text-align: center; color: var(--c-muted); padding: 20px; }
.fab { position: fixed; right: 20px; bottom: 76px; width: 52px; height: 52px; border-radius: 50%; border: none; background: var(--c-accent); color: #fff; font-size: 26px; cursor: pointer; box-shadow: 0 4px 14px rgba(37,99,235,0.4); z-index: 60; }
</style>
