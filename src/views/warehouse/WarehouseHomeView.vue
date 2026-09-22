<template>
  <div class="ui-page">
    <PageHeader title="库房工作台" sub="待收货、待发货与今日出入库概览">
      <template #actions>
        <button class="ui-btn ui-btn-sm" type="button" @click="go('/warehouse?tab=locations')">🏬 库房管理</button>
      </template>
    </PageHeader>

    <div class="ui-stat-grid">
      <StatCard label="待收货单" :value="pendingInbound.length" icon="📥" tone="warning" />
      <StatCard label="待发货单" :value="pendingOutbound.length" icon="📤" tone="warning" />
      <StatCard label="今日入库" :value="todayInQty" icon="⬇️" tone="success" />
      <StatCard label="今日出库" :value="todayOutQty" icon="⬆️" tone="primary" />
    </div>

    <SectionCard title="待收货" :desc="`${pendingInbound.length} 张`">
      <ul v-if="pendingInbound.length" class="todo-list">
        <li v-for="o in pendingInbound" :key="o.id" class="todo-item" @click="go(`/warehouse/inbound/${o.id}`)">
          <div class="t-main">
            <span class="t-no">{{ o.orderNo }}</span>
            <span class="ui-badge" :class="o.status === 'partial' ? 'warning' : 'muted'">{{ statusText(o.status) }}</span>
          </div>
          <div class="t-sub">
            <span>{{ supplierName(o.supplierId) }}</span>
            <span class="t-date">{{ fmtDate(o.orderDate) }}</span>
          </div>
        </li>
      </ul>
      <EmptyState v-else icon="📥" text="暂无待收货单据" />
    </SectionCard>

    <SectionCard title="待发货" :desc="`${pendingOutbound.length} 张`">
      <ul v-if="pendingOutbound.length" class="todo-list">
        <li v-for="o in pendingOutbound" :key="o.id" class="todo-item" @click="go(`/warehouse/outbound/${o.id}`)">
          <div class="t-main">
            <span class="t-no">{{ o.orderNo }}</span>
            <span class="ui-badge" :class="o.status === 'partial' ? 'warning' : 'muted'">{{ statusText(o.status) }}</span>
          </div>
          <div class="t-sub">
            <span>{{ customerName(o.customerId) }}</span>
            <span class="t-date">{{ fmtDate(o.orderDate) }}</span>
          </div>
        </li>
      </ul>
      <EmptyState v-else icon="📤" text="暂无待发货单据" />
    </SectionCard>

    <SectionCard title="快捷操作">
      <div class="quick-row">
        <button class="ui-btn ui-btn-primary quick-btn" type="button" @click="go('/warehouse/inbound')">收货验货</button>
        <button class="ui-btn quick-btn" type="button" @click="go('/warehouse/outbound')">拣货发货</button>
        <button class="ui-btn quick-btn" type="button" @click="go('/stock')">库存管理</button>
      </div>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useReloadOnActivate } from '../../composables/useReloadOnActivate'
import { useRouter } from 'vue-router'
import { usePurchaseStore } from '../../stores/purchase'
import { useSalesStore } from '../../stores/sales'
import { db } from '../../db'
import type { Customer, Supplier } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatCard from '../../components/ui/StatCard.vue'
import EmptyState from '../../components/ui/EmptyState.vue'

const router = useRouter()
const purchaseStore = usePurchaseStore()
const salesStore = useSalesStore()

const pendingInbound = ref<Awaited<ReturnType<typeof purchaseStore.listPendingInbound>>>([])
const pendingOutbound = ref<Awaited<ReturnType<typeof salesStore.listPendingOutbound>>>([])
const customers = ref<Customer[]>([])
const suppliers = ref<Supplier[]>([])
const todayInQty = ref(0)
const todayOutQty = ref(0)

function statusText(s: string): string {
  return { pending: '待处理', partial: '部分完成', completed: '已完成' }[s] || s
}
function fmtDate(s: string): string { return s ? s.slice(0, 10) : '-' }
function supplierName(id: number): string {
  return suppliers.value.find(s => s.id === id)?.name ?? '未知供应商'
}
function customerName(id: number): string {
  return customers.value.find(c => c.id === id)?.name ?? '未知客户'
}
function go(p: string): void { router.push(p) }

async function reload(): Promise<void> {
  const [pi, po, cs, ss] = await Promise.all([
    purchaseStore.listPendingInbound(),
    salesStore.listPendingOutbound(),
    salesStore.listCustomers(),
    purchaseStore.listSuppliers()
  ])
  pendingInbound.value = pi
  pendingOutbound.value = po
  customers.value = cs
  suppliers.value = ss

  // 今日出入库数量（按流水日期统计）
  const today = new Date().toISOString().slice(0, 10)
  const records = await db.stockRecords.toArray()
  todayInQty.value = records
    .filter(r => r.type === 'purchase_in' && (r.createdAt ?? '').slice(0, 10) === today)
    .reduce((s, r) => s + r.quantity, 0)
  todayOutQty.value = records
    .filter(r => r.type === 'sale_out' && (r.createdAt ?? '').slice(0, 10) === today)
    .reduce((s, r) => s + Math.abs(r.quantity), 0)
}

onMounted(reload)

// 回到本页时自动刷新：路由组件被 App.vue 的 <keep-alive> 缓存，
// 从别的页面回来是「复活」而非「重新挂载」，onMounted 不会再跑，数据会停在旧状态。
useReloadOnActivate(reload)
</script>

<style scoped>
.todo-list { list-style: none; }
.todo-item {
  padding: 11px 12px;
  margin: 0 -12px;
  border-bottom: 1px solid #f0f3f8;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background .15s ease;
}
.todo-item:last-child { border-bottom: none; }
.todo-item:hover { background: var(--c-accent-soft); }
.t-main { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.t-no { font-weight: 600; color: var(--c-primary); font-size: 14px; }
.t-sub {
  display: flex; justify-content: space-between; gap: 10px;
  font-size: 13px; color: var(--c-muted); margin-top: 4px;
}
.t-date { font-size: 12px; }
.quick-row { display: flex; gap: 10px; flex-wrap: wrap; }
</style>
