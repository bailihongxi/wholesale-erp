<template>
  <div class="ui-page">
    <PageHeader title="财务工作台" sub="应收应付、经营报表与日常收支总览">
      <template #actions>
        <button class="ui-btn ui-btn-primary" type="button" @click="go('/finance?tab=ledger')">✏️ 记一笔</button>
      </template>
    </PageHeader>

    <div class="ui-stat-grid">
      <StatCard label="应收未收" :value="`¥${money(receivableTotal)}`" icon="📥" tone="success" />
      <StatCard label="应付未付" :value="`¥${money(payableTotal)}`" icon="📤" tone="danger" />
      <StatCard label="本月已收" :value="`¥${money(monthReceived)}`" icon="💹" tone="primary" />
      <StatCard label="本月已付" :value="`¥${money(monthPaid)}`" icon="💸" tone="warning" />
    </div>

    <SectionCard title="待收款" :desc="`${receivables.length} 笔`">
      <ul v-if="receivables.length" class="todo-list">
        <li v-for="r in receivables" :key="r.orderId" class="todo-item" @click="go('/finance?tab=reconcile')">
          <div class="t-main">
            <span class="t-no">{{ r.orderNo }}</span>
            <span class="ui-badge danger">欠 ¥{{ money(r.balance) }}</span>
          </div>
          <div class="t-sub">
            <span>{{ customerName(r.customerId) }}</span>
            <span>应收 ¥{{ money(r.totalAmount) }}</span>
          </div>
        </li>
      </ul>
      <EmptyState v-else icon="🎉" text="无待收款单据" />
    </SectionCard>

    <SectionCard title="待付款" :desc="`${payables.length} 笔`">
      <ul v-if="payables.length" class="todo-list">
        <li v-for="p in payables" :key="p.orderId" class="todo-item" @click="go('/finance?tab=reconcile')">
          <div class="t-main">
            <span class="t-no">{{ p.orderNo }}</span>
            <span class="ui-badge danger">欠 ¥{{ money(p.balance) }}</span>
          </div>
          <div class="t-sub">
            <span>{{ supplierName(p.supplierId) }}</span>
            <span>应付 ¥{{ money(p.totalAmount) }}</span>
          </div>
        </li>
      </ul>
      <EmptyState v-else icon="🎉" text="无待付款单据" />
    </SectionCard>

    <SectionCard title="日常收支（记一笔）" desc="送货费、物流费、安装费等不走单据的费用">
      <div v-if="ledgerTotal || ledgerRows.length" class="ledger-mini">
        <div class="lm-item">
          <span class="lm-label">本月其他收入</span>
          <b class="lm-val in">+¥{{ money(ledgerIncome) }}</b>
        </div>
        <div class="lm-item">
          <span class="lm-label">本月其他支出</span>
          <b class="lm-val out">-¥{{ money(ledgerExpense) }}</b>
        </div>
        <div class="lm-item">
          <span class="lm-label">笔数</span>
          <b class="lm-val">{{ ledgerRows.length }}</b>
        </div>
      </div>
      <EmptyState v-else icon="🧾" text="还没有记过一笔" hint="送货费、快递费等点右上角「记一笔」" />
      <template #foot>
        <button class="ui-btn ui-btn-sm" type="button" @click="go('/finance?tab=ledger')">去记一笔 →</button>
        <button class="ui-btn ui-btn-sm" type="button" @click="go('/finance?tab=flow')">查看资金流水</button>
      </template>
    </SectionCard>

    <SectionCard title="快捷操作">
      <div class="quick-row">
        <button class="ui-btn quick-btn primary" type="button" @click="go('/finance?tab=reconcile')">应收应付对账</button>
        <button class="ui-btn quick-btn" type="button" @click="go('/finance?tab=reports')">经营报表（含毛利）</button>
        <button class="ui-btn quick-btn" type="button" @click="go('/stock')">库存管理</button>
      </div>
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useReloadOnActivate } from '../../composables/useReloadOnActivate'
import { useRouter } from 'vue-router'
import { useFinanceStore } from '../../stores/finance'
import { useSalesStore } from '../../stores/sales'
import { usePurchaseStore } from '../../stores/purchase'
import { db } from '../../db'
import type { Customer, Supplier, Payment, LedgerEntry } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatCard from '../../components/ui/StatCard.vue'
import EmptyState from '../../components/ui/EmptyState.vue'

const router = useRouter()
const financeStore = useFinanceStore()
const salesStore = useSalesStore()
const purchaseStore = usePurchaseStore()

const receivables = ref<Awaited<ReturnType<typeof financeStore.listReceivables>>>([])
const payables = ref<Awaited<ReturnType<typeof financeStore.listPayables>>>([])
const customers = ref<Customer[]>([])
const suppliers = ref<Supplier[]>([])
const payments = ref<Payment[]>([])
const ledgerRows = ref<LedgerEntry[]>([])

const receivableTotal = computed(() => receivables.value.reduce((s, r) => s + r.balance, 0))
const payableTotal = computed(() => payables.value.reduce((s, p) => s + p.balance, 0))

// 记一笔：本月其他收支直接影响真实利润，这里给老板一个总览
const thisMonthPrefix = new Date().toISOString().slice(0, 7)
const monthLedger = computed(() => ledgerRows.value.filter(r => (r.entryDate ?? '').slice(0, 7) === thisMonthPrefix))
const ledgerIncome = computed(() => monthLedger.value.filter(r => r.direction === 'in').reduce((s, r) => s + r.amount, 0))
const ledgerExpense = computed(() => monthLedger.value.filter(r => r.direction === 'out').reduce((s, r) => s + r.amount, 0))
const ledgerTotal = computed(() => ledgerIncome.value + ledgerExpense.value)

const thisMonth = new Date().toISOString().slice(0, 7)
const monthReceived = computed(() =>
  payments.value.filter(p => p.type === 'receive' && (p.payDate ?? '').slice(0, 7) === thisMonth)
    .reduce((s, p) => s + p.amount, 0)
)
const monthPaid = computed(() =>
  payments.value.filter(p => p.type === 'pay' && (p.payDate ?? '').slice(0, 7) === thisMonth)
    .reduce((s, p) => s + p.amount, 0)
)

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function customerName(id: number): string {
  return customers.value.find(c => c.id === id)?.name ?? '未知客户'
}
function supplierName(id: number): string {
  return suppliers.value.find(s => s.id === id)?.name ?? '未知供应商'
}
function go(p: string): void { router.push(p) }

async function reload(): Promise<void> {
  const [rs, ps, cs, ss, pays] = await Promise.all([
    financeStore.listReceivables(),
    financeStore.listPayables(),
    salesStore.listCustomers(),
    purchaseStore.listSuppliers(),
    db.payments.toArray()
  ])
  receivables.value = rs
  payables.value = ps
  customers.value = cs
  suppliers.value = ss
  payments.value = pays
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

.ledger-mini {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.lm-item {
  padding: 12px 14px;
  background: var(--c-surface-alt);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
}
.lm-label { display: block; font-size: 12px; color: var(--c-muted); }
.lm-val {
  display: block; margin-top: 4px;
  font-size: 17px; font-weight: 700; color: var(--c-primary);
  font-variant-numeric: tabular-nums;
}
.lm-val.in { color: #0f9d76; }
.lm-val.out { color: #dc2626; }

.quick-row { display: flex; gap: 10px; flex-wrap: wrap; }

@media (max-width: 767px) {
  .ledger-mini { grid-template-columns: 1fr; }
}
</style>
