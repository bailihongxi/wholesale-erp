<template>
  <div class="ui-page">
    <PageHeader title="采购工作台" sub="待入库、本月采购额与未付款概览">
      <template #actions>
        <button class="ui-btn ui-btn-primary ui-btn-sm" type="button" @click="go('/purchase/orders/new')">＋ 新建采购单</button>
      </template>
    </PageHeader>

    <!-- 统计卡片 -->
    <div class="ui-stat-grid">
      <StatCard label="待入库单" :value="pendingInbound.length" icon="📥" tone="warning" />
      <StatCard label="本月采购额" :value="`¥${money(monthPurchase)}`" icon="🛒" tone="primary" />
      <StatCard label="供应商" :value="supplierCount" icon="🏭" tone="neutral" />
      <StatCard label="未付款金额" :value="`¥${money(unpaidAmount)}`" icon="💸" tone="danger" />
    </div>

    <!-- 待办 -->
    <SectionCard title="待入库单据" :desc="`${pendingInbound.length} 张`">
      <ul v-if="pendingInbound.length" class="todo-list">
        <li v-for="o in pendingInbound" :key="o.id" class="todo-item" @click="go(`/warehouse/inbound/${o.id}`)">
          <div class="t-main">
            <span class="t-no">{{ o.orderNo }}</span>
            <span class="ui-badge" :class="o.status === 'partial' ? 'warning' : 'muted'">{{ statusText(o.status) }}</span>
          </div>
          <div class="t-sub">
            <span>{{ supplierName(o.supplierId) }}</span>
            <span class="t-amt">¥{{ money(o.totalAmount) }}</span>
          </div>
        </li>
      </ul>
      <EmptyState v-else icon="📥" text="暂无待入库单据" />
    </SectionCard>

    <!-- 快捷入口 -->
    <SectionCard title="快捷操作">
      <div class="quick-row">
        <button class="ui-btn ui-btn-primary quick-btn" type="button" @click="go('/purchase/orders/new')">＋ 新建采购单</button>
        <button class="ui-btn quick-btn" type="button" @click="go('/purchase/orders')">采购单列表</button>
        <button class="ui-btn quick-btn" type="button" @click="go('/purchase/suppliers')">供应商管理</button>
      </div>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useReloadOnActivate } from '../../composables/useReloadOnActivate'
import { useRouter } from 'vue-router'
import { usePurchaseStore } from '../../stores/purchase'
import { useFinanceStore } from '../../stores/finance'
import type { PurchaseOrder, Supplier } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatCard from '../../components/ui/StatCard.vue'
import EmptyState from '../../components/ui/EmptyState.vue'

const router = useRouter()
const purchaseStore = usePurchaseStore()
const financeStore = useFinanceStore()

const pendingInbound = ref<PurchaseOrder[]>([])
const suppliers = ref<Supplier[]>([])
const monthPurchase = ref(0)
const unpaidAmount = ref(0)
const supplierCount = ref(0)

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function supplierName(id: number): string {
  return suppliers.value.find(s => s.id === id)?.name ?? '未知供应商'
}
function statusText(s: string): string {
  return { pending: '待入库', partial: '部分入库', completed: '已完成' }[s] || s
}
function go(p: string): void { router.push(p) }

async function reload(): Promise<void> {
  // 四份数据互不依赖：原来逐个 await 是 4 段串行往返（新加坡节点每段 200~400ms），
  // 现在一次并发，等待时间由「之和」变成「最大值」（C 档 V2.1-2.34-C）。
  const [sups, pending, all, payables] = await Promise.all([
    purchaseStore.listSuppliers(),
    purchaseStore.listPendingInbound(),
    purchaseStore.listOrders(),
    financeStore.listPayables()
  ])

  suppliers.value = sups
  supplierCount.value = sups.length
  pendingInbound.value = pending

  // 本月（自然月）采购额
  const prefix = new Date().toISOString().slice(0, 7)
  monthPurchase.value = all
    .filter(o => (o.orderDate ?? '').slice(0, 7) === prefix)
    .reduce((s, o) => s + o.totalAmount, 0)

  // 未付款金额：所有采购单总额 - 已付款
  unpaidAmount.value = payables.reduce((s, p) => s + p.balance, 0)
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
.t-amt { color: var(--c-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.quick-row { display: flex; gap: 10px; flex-wrap: wrap; }
</style>
