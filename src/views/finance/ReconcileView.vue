<template>
  <div class="page">
    <div class="ui-seg">
      <button :class="{ active: mode === 'receivable' }" type="button" @click="switchMode('receivable')">
        应收（客户欠）
      </button>
      <button :class="{ active: mode === 'payable' }" type="button" @click="switchMode('payable')">
        应付（欠供应商）
      </button>
      <button :class="{ active: mode === 'history' }" type="button" @click="switchMode('history')">
        收付款流水
      </button>
    </div>

    <!-- ============ 应收 / 应付 ============ -->
    <template v-if="mode !== 'history'">
      <div class="toolbar">
        <SearchInput
          v-model="keyword"
          class="tb-search"
          :placeholder="mode === 'receivable' ? '搜索单号 / 客户' : '搜索单号 / 供应商'"
          @search="() => {}"
        />
        <select v-model="settleFilter" class="filter" aria-label="结清状态">
          <option value="unsettled">未结清</option>
          <option value="settled">已结清</option>
          <option value="all">全部</option>
        </select>
      </div>

      <div class="sum-line">
        共 {{ filteredCurrent.length }} 笔 · 余额合计
        <b>¥{{ balanceTotal.toLocaleString() }}</b>
      </div>

      <ul class="card-list">
        <li v-for="r in filteredCurrent" :key="r.orderId" class="recon-card">
          <div class="rc-head">
            <span class="rc-no">{{ r.orderNo }}</span>
            <span class="rc-bal" :class="{ settled: r.balance <= 0 }">
              {{ r.balance > 0 ? `¥${r.balance.toLocaleString()}` : '已结清' }}
            </span>
          </div>
          <div class="rc-sub">
            {{ partyName(r) }} · {{ (r.date ?? '').slice(0, 10) }}
          </div>
          <div class="rc-sub">
            总额 ¥{{ r.totalAmount.toLocaleString() }} ·
            已{{ mode === 'receivable' ? '收' : '付' }} ¥{{ (r.totalAmount - r.balance).toLocaleString() }}
          </div>

          <div v-if="editingId !== r.orderId">
            <button v-if="r.balance > 0" class="link-btn" type="button" @click="startEdit(r)">
              {{ mode === 'receivable' ? '登记收款' : '登记付款' }}
            </button>
          </div>
          <div v-else class="edit-row">
            <input v-model.number="editAmount" type="number" min="0" class="amt-input" aria-label="金额" />
            <button class="confirm-btn" type="button" @click="confirmEdit(r)">确认</button>
            <button class="cancel-btn" type="button" @click="editingId = null">取消</button>
          </div>
        </li>
        <li v-if="!filteredCurrent.length" class="empty">
          {{ mode === 'receivable' ? '没有符合条件的应收' : '没有符合条件的应付' }}
        </li>
      </ul>
    </template>

    <!-- ============ 收付款流水 ============ -->
    <template v-else>
      <div class="toolbar">
        <SearchInput
          v-model="keyword"
          class="tb-search"
          placeholder="搜索单号 / 客户 / 供应商"
          @search="() => {}"
        />
        <select v-model="payType" class="filter" aria-label="流水类型">
          <option value="">全部</option>
          <option value="receive">仅收款</option>
          <option value="pay">仅付款</option>
        </select>
        <input v-model="dateFrom" type="date" class="filter" aria-label="开始日期" />
        <span class="dp-sep">至</span>
        <input v-model="dateTo" type="date" class="filter" aria-label="结束日期" />
        <button v-if="hasHistoryFilter" class="reset-btn" type="button" @click="resetHistoryFilter">重置</button>
      </div>

      <div class="sum-line">
        共 {{ filteredPayments.length }} 笔 ·
        收款 <b class="in">¥{{ receiveTotal.toLocaleString() }}</b> ·
        付款 <b class="out">¥{{ payTotal.toLocaleString() }}</b>
      </div>

      <ul v-if="isMobile" class="card-list">
        <li v-for="p in filteredPayments" :key="p.id" class="pay-card">
          <div class="rc-head">
            <span class="rc-no">{{ p.orderNo }}</span>
            <span class="rc-bal" :class="p.type">{{ p.type === 'receive' ? '+' : '-' }}¥{{ p.amount.toLocaleString() }}</span>
          </div>
          <div class="rc-sub">{{ p.counterpartyName }} · {{ p.type === 'receive' ? '收款' : '付款' }}</div>
          <div class="rc-sub">{{ fmtTime(p.payDate) }} · {{ p.operatorName }}{{ p.remark ? ` · ${p.remark}` : '' }}</div>
        </li>
        <li v-if="!filteredPayments.length" class="empty">没有符合条件的收付款记录</li>
      </ul>

      <table v-else class="pay-table data-table">
        <thead>
          <tr>
            <th>时间</th><th>类型</th><th>单据号</th><th>往来单位</th>
            <th class="num">金额</th><th>操作人</th><th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in filteredPayments" :key="p.id">
            <td>{{ fmtTime(p.payDate) }}</td>
            <td :class="p.type">{{ p.type === 'receive' ? '收款' : '付款' }}</td>
            <td>{{ p.orderNo }}</td>
            <td>{{ p.counterpartyName }}</td>
            <td class="num" :class="p.type">{{ p.type === 'receive' ? '+' : '-' }}¥{{ p.amount.toLocaleString() }}</td>
            <td>{{ p.operatorName }}</td>
            <td>{{ p.remark || '-' }}</td>
          </tr>
          <tr v-if="!filteredPayments.length"><td colspan="7" class="empty">没有符合条件的收付款记录</td></tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useFinanceStore } from '../../stores/finance'
import { useUserStore } from '../../stores/user'
import { useResponsive } from '../../composables/useResponsive'
import SearchInput from '../../components/SearchInput.vue'
import type { PaymentHistoryRow } from '../../types'

type Mode = 'receivable' | 'payable' | 'history'
type SettleFilter = 'unsettled' | 'settled' | 'all'

interface ReconRow {
  orderId: number
  orderNo: string
  customerId?: number
  supplierId?: number
  totalAmount: number
  balance: number
  date: string
}

const financeStore = useFinanceStore()
const userStore = useUserStore()
const { isMobile } = useResponsive()

const mode = ref<Mode>('receivable')
const receivables = ref<ReconRow[]>([])
const payables = ref<ReconRow[]>([])
const payments = ref<PaymentHistoryRow[]>([])
const customerMap = ref<Record<number, string>>({})
const supplierMap = ref<Record<number, string>>({})

const editingId = ref<number | null>(null)
const editAmount = ref(0)

const keyword = ref('')
const settleFilter = ref<SettleFilter>('unsettled')
const payType = ref('')
const dateFrom = ref('')
const dateTo = ref('')

const hasHistoryFilter = computed(
  () => !!keyword.value || !!payType.value || !!dateFrom.value || !!dateTo.value
)

const current = computed<ReconRow[]>(() =>
  mode.value === 'payable' ? payables.value : receivables.value
)

const filteredCurrent = computed<ReconRow[]>(() => {
  let data = current.value
  // 默认只看未结清，避免「结清后单据消失、查不到历史」的问题
  if (settleFilter.value === 'unsettled') data = data.filter(r => r.balance > 0)
  else if (settleFilter.value === 'settled') data = data.filter(r => r.balance <= 0)

  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    data = data.filter(r =>
      (r.orderNo ?? '').toLowerCase().includes(kw) ||
      partyName(r).toLowerCase().includes(kw)
    )
  }
  return data
})

const balanceTotal = computed(() =>
  filteredCurrent.value.reduce((s, r) => s + Math.max(0, r.balance), 0)
)

const filteredPayments = computed<PaymentHistoryRow[]>(() => {
  let data = payments.value
  if (payType.value) data = data.filter(p => p.type === payType.value)
  if (dateFrom.value) data = data.filter(p => (p.payDate ?? '').slice(0, 10) >= dateFrom.value)
  if (dateTo.value) data = data.filter(p => (p.payDate ?? '').slice(0, 10) <= dateTo.value)

  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    data = data.filter(p =>
      (p.orderNo ?? '').toLowerCase().includes(kw) ||
      (p.counterpartyName ?? '').toLowerCase().includes(kw)
    )
  }
  return data
})

const receiveTotal = computed(() =>
  filteredPayments.value.filter(p => p.type === 'receive').reduce((s, p) => s + p.amount, 0)
)
const payTotal = computed(() =>
  filteredPayments.value.filter(p => p.type === 'pay').reduce((s, p) => s + p.amount, 0)
)

async function reload(): Promise<void> {
  // 传 true 取全部单据（含已结清），财务才能查到完整历史
  receivables.value = (await financeStore.listReceivables(true)) as ReconRow[]
  payables.value = (await financeStore.listPayables(true)) as ReconRow[]
  payments.value = await financeStore.listPaymentHistory()

  const { db } = await import('../../db')
  const c: Record<number, string> = {}
  for (const x of await db.customers.toArray()) c[x.id!] = x.name
  customerMap.value = c
  const s: Record<number, string> = {}
  for (const x of await db.suppliers.toArray()) s[x.id!] = x.name
  supplierMap.value = s
}

function partyName(r: ReconRow): string {
  if (r.customerId !== undefined) return customerMap.value[r.customerId] ?? '未知客户'
  return supplierMap.value[r.supplierId ?? -1] ?? '未知供应商'
}

function switchMode(m: Mode): void {
  mode.value = m
  editingId.value = null
}

function resetHistoryFilter(): void {
  keyword.value = ''
  payType.value = ''
  dateFrom.value = ''
  dateTo.value = ''
}

function startEdit(r: ReconRow): void {
  editingId.value = r.orderId
  editAmount.value = r.balance
}

async function confirmEdit(r: ReconRow): Promise<void> {
  const payload = {
    orderId: r.orderId,
    amount: editAmount.value,
    operatorId: userStore.currentUser?.id ?? 1,
    remark: ''
  }
  const res = mode.value === 'payable'
    ? await financeStore.recordPay(payload)
    : await financeStore.recordReceive(payload)
  if (res.ok) {
    editingId.value = null
    await reload()
  }
}

function fmtTime(s: string): string {
  return s ? s.slice(0, 16).replace('T', ' ') : '-'
}

watch(mode, () => { keyword.value = '' })

onMounted(reload)
</script>

<style scoped>
.page { max-width: 1000px; margin: 0 auto; }

.toolbar { display: flex; gap: 10px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
.tb-search { flex: 1; min-width: 180px; }
.filter { height: 44px; border: 1px solid var(--c-border); border-radius: 10px; padding: 0 12px; background: #fff; }
.dp-sep { color: var(--c-muted); font-size: 13px; }
.reset-btn { height: 44px; padding: 0 14px; border: 1px solid var(--c-border); border-radius: 10px; background: #fff; color: var(--c-muted); cursor: pointer; }
.sum-line { font-size: 12px; color: var(--c-muted); margin-bottom: 10px; }
.sum-line .in { color: var(--c-success); }
.sum-line .out { color: var(--c-danger, #dc2626); }

.card-list { list-style: none; }
.recon-card, .pay-card {
  background: #fff; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px;
  box-shadow: 0 2px 10px rgba(26,54,93,0.06);
}
.rc-head { display: flex; justify-content: space-between; align-items: center; }
.rc-no { font-weight: 600; color: var(--c-primary); }
.rc-bal { font-weight: 700; color: var(--c-danger, #dc2626); }
.rc-bal.settled { color: var(--c-success); font-weight: 500; }
.rc-bal.receive { color: var(--c-success); }
.rc-bal.pay { color: var(--c-danger, #dc2626); }
.rc-sub { font-size: 13px; color: var(--c-muted); margin-top: 4px; }

.edit-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.amt-input { width: 120px; height: 40px; border: 1px solid var(--c-border); border-radius: 8px; padding: 0 8px; }
.confirm-btn { height: 40px; padding: 0 16px; border: none; border-radius: 8px; background: var(--c-success); color: #fff; cursor: pointer; }
.cancel-btn { height: 40px; padding: 0 14px; border: 1px solid var(--c-border); border-radius: 8px; background: #fff; cursor: pointer; }
.link-btn { margin-top: 8px; border: none; background: none; color: var(--c-accent); cursor: pointer; font-size: 14px; }

.pay-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.pay-table th, .pay-table td { padding: 11px 13px; text-align: left; border-bottom: 1px solid var(--c-border); font-size: 14px; }
.pay-table th { background: #f1f5f9; color: var(--c-primary); }
.pay-table .num { text-align: right; }
.pay-table td.receive { color: var(--c-success); }
.pay-table td.pay { color: var(--c-danger, #dc2626); }
.empty { text-align: center; color: var(--c-muted); padding: 20px; }
</style>
