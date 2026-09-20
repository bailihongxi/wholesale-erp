<template>
  <div class="orders" :class="isMobile ? 'is-mobile' : 'is-desktop'">
    <PageHeader title="采购单" sub="采购开单、审核与入库进度" />
    <!-- 筛选条：搜索放大，其余控件紧凑排在一行（电脑端） -->
    <div class="toolbar">
      <SearchInput
        v-model="keyword"
        class="tb-search"
        placeholder="搜索单号 / 供应商"
        @search="reload"
      />
      <select v-model="statusFilter" class="filter" @change="reload">
        <option value="">全部状态</option>
        <option value="pending">待入库</option>
        <option value="partial">部分入库</option>
        <option value="completed">已完成</option>
      </select>
      <input v-model="dateFrom" type="date" class="filter" aria-label="开始日期" @change="reload" />
      <span class="dp-sep">至</span>
      <input v-model="dateTo" type="date" class="filter" aria-label="结束日期" @change="reload" />
      <button v-if="hasFilter" class="reset-btn" type="button" @click="resetFilter">重置</button>
      <button v-if="!isMobile" class="add-btn" type="button" @click="go('/purchase/orders/new')">＋ 新建</button>
    </div>

    <div class="sum-line">共 {{ orders.length }} 张采购单</div>

    <LoadingBlock v-if="loading" :rows="6" />

    <!-- 手机端卡片 -->
    <ul v-else-if="isMobile" class="card-list zebra-list">
      <li v-for="o in pager.paged.value" :key="o.id" class="order-card" @click="go(`/purchase/orders/${o.id}`)">
        <div class="oc-head">
          <span class="oc-no">{{ o.orderNo }}</span>
          <span class="oc-status" :class="o.status">{{ statusText(o.status) }}</span>
        </div>
        <div class="oc-meta">
          <span>{{ supplierName(o.supplierId) }}</span>
          <span class="oc-amt">¥{{ o.totalAmount.toLocaleString() }}</span>
        </div>
        <div class="oc-date">{{ o.orderDate.slice(0, 10) }}</div>
      </li>
      <li v-if="!pager.total.value" class="empty">没有符合条件的采购单</li>
    </ul>

    <!-- 电脑端表格 -->
    <table v-else class="data-table order-table">
      <thead>
        <tr><th>单号</th><th>供应商</th><th>日期</th><th>金额</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="o in pager.paged.value" :key="o.id">
          <td>{{ o.orderNo }}</td>
          <td>{{ supplierName(o.supplierId) }}</td>
          <td>{{ o.orderDate.slice(0, 10) }}</td>
          <td>¥{{ o.totalAmount.toLocaleString() }}</td>
          <td :class="o.status">{{ statusText(o.status) }}</td>
          <td><button class="link-btn" type="button" @click="go(`/purchase/orders/${o.id}`)">查看</button></td>
        </tr>
        <tr v-if="!pager.total.value"><td colspan="6" class="empty">没有符合条件的采购单</td></tr>
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

    <button v-if="!loading && isMobile" class="fab" type="button" @click="go('/purchase/orders/new')">＋</button>
  </div>
</template>

<script setup lang="ts">
import TablePager from '../../components/TablePager.vue'
import { usePagination, PAGE_SIZE_LIST } from '../../composables/usePagination'
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { usePurchaseStore } from '../../stores/purchase'
import { useResponsive } from '../../composables/useResponsive'
import SearchInput from '../../components/SearchInput.vue'
import type { PurchaseOrder, Supplier } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'
import LoadingBlock from '../../components/ui/LoadingBlock.vue'

const router = useRouter()
const purchaseStore = usePurchaseStore()
const { isMobile } = useResponsive()

const keyword = ref('')
const statusFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const orders = ref<PurchaseOrder[]>([])
const suppliers = ref<Supplier[]>([])
/** 首次拉数据期间用骨架占位，避免先闪一下「没有符合条件的采购单」 */
const loading = ref(true)

const hasFilter = computed(
  () => !!keyword.value || !!statusFilter.value || !!dateFrom.value || !!dateTo.value
)

// 全站统一：列表每页 20 条 + 斑马纹（表格已挂 data-table）
const pager = usePagination(orders, PAGE_SIZE_LIST)
// 筛选条件一变就回第一页，否则会停在一个已被筛掉的页码上
watch(orders, () => pager.reset())
const page = computed({ get: () => pager.page.value, set: v => pager.go(v) })

async function reload(): Promise<void> {
  let data = await purchaseStore.listOrders()

  if (statusFilter.value) {
    data = data.filter(o => o.status === statusFilter.value)
  }
  // 日期区间按 YYYY-MM-DD 字符串比较，结束日含当天
  if (dateFrom.value) {
    data = data.filter(o => (o.orderDate ?? '').slice(0, 10) >= dateFrom.value)
  }
  if (dateTo.value) {
    data = data.filter(o => (o.orderDate ?? '').slice(0, 10) <= dateTo.value)
  }

  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    data = data.filter(o => {
      const no = (o.orderNo ?? '').toLowerCase()
      const party = supplierName(o.supplierId).toLowerCase()
      return no.includes(kw) || party.includes(kw)
    })
  }
  orders.value = data
  loading.value = false
}

function resetFilter(): void {
  keyword.value = ''
  statusFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  void reload()
}

function supplierName(id: number): string {
  return suppliers.value.find(s => s.id === id)?.name ?? '未知供应商'
}
function statusText(s: string): string {
  return { pending: '待入库', partial: '部分入库', completed: '已完成' }[s] || s
}
function go(p: string): void { router.push(p) }

onMounted(async () => {
  try {
    suppliers.value = await purchaseStore.listSuppliers()
    await reload()
  } catch {
    /* 数据库未就绪时保持空表，不让骨架卡住 */
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.orders { max-width: 1100px; margin: 0 auto; }
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
/* 表格外观交给全站 .data-table（含斑马纹），这里只留状态色等业务样式，
   不要再写 background / border-radius / box-shadow，否则会把设计系统盖掉 */
.order-table th, .order-table td { font-size: 14px; }
.order-table td.completed { color: var(--c-success); }
.order-table td.pending { color: var(--c-warning); }
/* 斑马纹来自 .data-table tbody tr:nth-child(even)；状态色行不能被 hover 洗掉 */
.link-btn { border: none; background: none; color: var(--c-accent); cursor: pointer; }
.empty { text-align: center; color: var(--c-muted); padding: 20px; }
.fab { position: fixed; right: 20px; bottom: 76px; width: 52px; height: 52px; border-radius: 50%; border: none; background: var(--c-accent); color: #fff; font-size: 26px; cursor: pointer; box-shadow: 0 4px 14px rgba(37,99,235,0.4); z-index: 60; }
</style>
