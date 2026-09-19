<template>
  <div class="ui-page">
    <PageHeader title="销售工作台" sub="待出库、本月销售额与未收款概览">
      <template #actions>
        <button class="ui-btn ui-btn-primary ui-btn-sm" type="button" @click="go('/sales/orders/new')">＋ 新建销售单</button>
      </template>
    </PageHeader>

    <div class="ui-stat-grid">
      <StatCard label="待出库单" :value="pendingOutbound.length" icon="📤" tone="warning" />
      <StatCard label="本月销售额" :value="`¥${money(monthSales)}`" icon="💰" tone="primary" />
      <StatCard label="客户数" :value="customerCount" icon="👥" tone="neutral" />
      <StatCard label="未收款金额" :value="`¥${money(unreceivedAmount)}`" icon="🧾" tone="danger" />
    </div>

    <SectionCard title="待出库单据" :desc="`${pendingOutbound.length} 张`">
      <ul v-if="pendingOutbound.length" class="todo-list">
        <li v-for="o in pendingOutbound" :key="o.id" class="todo-item" @click="go(`/warehouse/outbound/${o.id}`)">
          <div class="t-main">
            <span class="t-no">{{ o.orderNo }}</span>
            <span class="ui-badge" :class="o.status === 'partial' ? 'warning' : 'muted'">{{ statusText(o.status) }}</span>
          </div>
          <div class="t-sub">
            <span>{{ customerName(o.customerId) }}</span>
            <span class="t-amt">¥{{ money(o.totalAmount) }}</span>
          </div>
        </li>
      </ul>
      <EmptyState v-else icon="📤" text="暂无待出库单据" />
    </SectionCard>

    <SectionCard title="快捷操作">
      <div class="quick-row">
        <button class="ui-btn ui-btn-primary quick-btn" type="button" @click="go('/sales/orders/new')">＋ 新建销售单</button>
        <button class="ui-btn quick-btn" type="button" @click="go('/sales/orders')">销售单列表</button>
        <button class="ui-btn quick-btn" type="button" @click="go('/customers')">客户管理</button>
        <button class="ui-btn quick-btn" type="button" @click="go('/stock')">查看库存</button>
      </div>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSalesStore } from '../../stores/sales'
import { useFinanceStore } from '../../stores/finance'
import type { SaleOrder, Customer } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatCard from '../../components/ui/StatCard.vue'
import EmptyState from '../../components/ui/EmptyState.vue'

const router = useRouter()
const salesStore = useSalesStore()
const financeStore = useFinanceStore()

const pendingOutbound = ref<SaleOrder[]>([])
const customers = ref<Customer[]>([])
const monthSales = ref(0)
const unreceivedAmount = ref(0)
const customerCount = ref(0)

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function customerName(id: number): string {
  return customers.value.find(c => c.id === id)?.name ?? '未知客户'
}
function statusText(s: string): string {
  return { pending: '待出库', partial: '部分出库', completed: '已完成' }[s] || s
}
function go(p: string): void { router.push(p) }

async function reload(): Promise<void> {
  customers.value = await salesStore.listCustomers()
  customerCount.value = customers.value.length
  pendingOutbound.value = await salesStore.listPendingOutbound()

  const all = await salesStore.listOrders()
  const prefix = new Date().toISOString().slice(0, 7)
  monthSales.value = all
    .filter(o => (o.orderDate ?? '').slice(0, 7) === prefix)
    .reduce((s, o) => s + o.totalAmount, 0)

  const receivables = await financeStore.listReceivables()
  unreceivedAmount.value = receivables.reduce((s, r) => s + r.balance, 0)
}

onMounted(reload)
</script>

<style scoped>
.home { max-width: 1100px; margin: 0 auto; }
.page-title { font-size: 16px; color: var(--c-primary, #1a365d); margin-bottom: 12px; }
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
.stat-card { background: #fff; border-radius: 12px; padding: 14px 16px; box-shadow: 0 2px 10px rgba(26,54,93,0.06); border-left: 4px solid transparent; }
.stat-card.warn { border-left-color: #dd6b20; }
.stat-card.red { border-left-color: #e53e3e; }
.s-label { display: block; font-size: 12px; color: var(--c-muted, #64748b); }
.s-value { display: block; font-size: 20px; color: var(--c-primary, #1a365d); margin-top: 4px; }
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
.t-amt { color: var(--c-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.quick-row { display: flex; gap: 10px; flex-wrap: wrap; }
</style>
