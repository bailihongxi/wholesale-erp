<template>
  <div class="ui-page">
    <PageHeader
      title="财务管理"
      sub="应收应付对账、经营报表、记一笔与资金流水，统一在这里处理"
    />

    <SegmentedTabs v-model="tab" :options="tabs" />

    <!-- 四大模块：菜单只需一个「财务管理」入口 -->
    <div class="tab-pane">
      <ReconcileView v-if="tab === 'reconcile'" />
      <BossReportsView v-else-if="tab === 'reports'" />
      <LedgerView v-else-if="tab === 'ledger'" />
      <template v-else>
        <!-- ===== 资金流水：收付款 + 记一笔 合并成一条时间线 ===== -->
        <div class="ui-stat-grid">
          <StatCard label="区间收入" :value="`¥${money(inTotal)}`" icon="📈" tone="success" :hint="`${inRows.length} 笔`" />
          <StatCard label="区间支出" :value="`¥${money(outTotal)}`" icon="📉" tone="danger" :hint="`${outRows.length} 笔`" />
          <StatCard
            label="净流入"
            :value="`¥${money(inTotal - outTotal)}`"
            icon="⚖️"
            :tone="inTotal - outTotal >= 0 ? 'success' : 'danger'"
          />
          <StatCard label="流水笔数" :value="filtered.length" icon="🧾" tone="neutral" />
        </div>

        <SectionCard title="资金流水" desc="收款 / 付款 / 记一笔 合并展示" tight>
          <template #extra>
            <div class="ui-toolbar">
              <select v-model="kind" class="ui-select f-kind" aria-label="类型">
                <option value="">全部类型</option>
                <option value="receive">销售收款</option>
                <option value="pay">采购付款</option>
                <option value="refund">销售退货</option>
                <option value="supplier_credit">采购退货</option>
                <option value="ledger">记一笔</option>
              </select>
              <input v-model="from" class="ui-input f-date" type="date" aria-label="开始日期" />
              <span class="ui-hint">至</span>
              <input v-model="to" class="ui-input f-date" type="date" aria-label="结束日期" />
              <button class="ui-btn ui-btn-sm" type="button" @click="clearFilter">重置</button>
            </div>
          </template>

          <table v-if="filtered.length" class="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>类型</th>
                <th>摘要</th>
                <th class="num">收入</th>
                <th class="num">支出</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in pager.paged.value" :key="r.key">
                <td>{{ r.date }}</td>
                <td>
                  <span class="ui-badge" :class="r.badge">{{ r.kindLabel }}</span>
                </td>
                <td class="sum-cell">{{ r.summary }}</td>
                <td class="num amt-in">{{ r.in ? `¥${money(r.in)}` : '' }}</td>
                <td class="num amt-out">{{ r.out ? `¥${money(r.out)}` : '' }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3">合计</td>
                <td class="num amt-in">¥{{ money(inTotal) }}</td>
                <td class="num amt-out">¥{{ money(outTotal) }}</td>
              </tr>
            </tfoot>
          </table>
          <EmptyState v-else icon="💸" text="该区间没有资金流水" hint="收款、付款或记一笔后会出现在这里" />

      <TablePager
        v-if="pager.total.value"
        v-model:page="page"
        :page-count="pager.pageCount.value"
        :total="pager.total.value"
        :size="pager.size.value"
        show-jump
      />
        </SectionCard>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useReloadOnActivate } from '../../composables/useReloadOnActivate'
import { useListCache } from '../../composables/useListCache'
import { useRoute } from 'vue-router'
import { db } from '../../db'
import { useFinanceStore } from '../../stores/finance'
import { usePagination, PAGE_SIZE_LIST } from '../../composables/usePagination'
import { categoryLabel, linkTypeLabel } from '../../utils/ledger'
import type { LedgerEntry } from '../../types'
import TablePager from '../../components/TablePager.vue'
import ReconcileView from './ReconcileView.vue'
import BossReportsView from '../boss/BossReportsView.vue'
import LedgerView from './LedgerView.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatCard from '../../components/ui/StatCard.vue'
import EmptyState from '../../components/ui/EmptyState.vue'
import SegmentedTabs from '../../components/ui/SegmentedTabs.vue'

type TabKey = 'reconcile' | 'reports' | 'ledger' | 'flow'

const tabs = [
  { value: 'reconcile', label: '应收应付', icon: '📒' },
  { value: 'reports', label: '经营报表', icon: '📊' },
  { value: 'ledger', label: '记一笔', icon: '✏️' },
  { value: 'flow', label: '资金流水', icon: '💸' }
]

const tab = ref<TabKey>('reconcile')
const financeStore = useFinanceStore()

// ===== 资金流水 =====
interface FlowRow {
  key: string
  date: string
  kind: string
  kindLabel: string
  badge: string
  summary: string
  in: number
  out: number
}

const kind = ref('')
const from = ref('')
const to = ref('')
const flowRows = ref<FlowRow[]>([])

const KIND_LABEL: Record<string, string> = {
  receive: '销售收款',
  pay: '采购付款',
  refund: '销售退货',
  supplier_credit: '采购退货',
  ledger: '记一笔'
}
const KIND_BADGE: Record<string, string> = {
  receive: 'success',
  refund: 'warning',
  pay: 'danger',
  supplier_credit: 'warning',
  ledger: 'info'
}
const day = (s: string): string => (s ?? '').slice(0, 10)

// 支持从别处带 ?tab=reports / ?tab=ledger 直接落到对应子页
const route = useRoute()
watch(
  () => route.query.tab,
  q => {
    if (q && tabs.some(t => t.value === q)) tab.value = q as TabKey
  },
  { immediate: true }
)

const filtered = computed(() => flowRows.value.filter(r => {
  if (kind.value && r.kind !== kind.value) return false
  if (from.value && r.date < from.value) return false
  if (to.value && r.date > to.value) return false
  return true
}))

const inRows = computed(() => filtered.value.filter(r => r.in > 0))
const outRows = computed(() => filtered.value.filter(r => r.out > 0))
const inTotal = computed(() => inRows.value.reduce((s, r) => s + r.in, 0))
const outTotal = computed(() => outRows.value.reduce((s, r) => s + r.out, 0))


// 全站统一：列表每页 20 条 + 斑马纹（表格已挂 data-table）
const pager = usePagination(filtered, PAGE_SIZE_LIST)
watch([kind, from, to], () => pager.reset())
const page = computed({ get: () => pager.page.value, set: v => pager.go(v) })

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function clearFilter(): void {
  kind.value = ''
  from.value = ''
  to.value = ''
}

const listCache = useListCache('finance-ops-flow')

async function loadFlow(useCache = true): Promise<void> {
  // 先看缓存
  if (useCache) {
    const cached = listCache.get<FlowRow[]>()
    if (cached) {
      flowRows.value = cached
      return
    }
  }

  const [history, ledger] = await Promise.all([
    financeStore.listPaymentHistory(),
    db.ledgerEntries.toArray()
  ])

  const rows: FlowRow[] = []

  for (const p of history) {
    const isIn = p.type === 'receive'
    // 退货是红冲：销售退货减少应收（视作支出的反向），这里按「资金流向」展示
    const moneyOut = p.type === 'pay'
    rows.push({
      key: `p-${p.id}`,
      date: day(p.payDate),
      kind: p.type,
      kindLabel: KIND_LABEL[p.type] ?? p.type,
      badge: KIND_BADGE[p.type] ?? 'muted',
      summary: `${p.orderNo} · ${p.counterpartyName}${p.remark ? ` · ${p.remark}` : ''}`,
      in: isIn ? p.amount : 0,
      out: moneyOut ? p.amount : 0
    })
  }

  for (const e of ledger as LedgerEntry[]) {
    rows.push({
      key: `l-${e.id}`,
      date: e.entryDate,
      kind: 'ledger',
      kindLabel: '记一笔',
      badge: 'info',
      summary: `${e.orderNo} · ${categoryLabel(e.category)}` +
        (e.counterparty ? ` · ${e.counterparty}` : '') + (e.remark ? ` · ${e.remark}` : '') +
        (e.linkDocNo ? ` · 关联${linkTypeLabel(e.linkDocType ?? '')}${e.linkDocNo}` : ''),
      in: e.direction === 'in' ? e.amount : 0,
      out: e.direction === 'out' ? e.amount : 0
    })
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  flowRows.value = rows
  // 写入缓存
  listCache.set(rows)
}

onMounted(loadFlow)

// 回到本页时自动刷新：路由组件被 App.vue 的 <keep-alive> 缓存，
// 从别的页面回来是「复活」而非「重新挂载」，onMounted 不会再跑，数据会停在旧状态。
useReloadOnActivate(() => loadFlow(true))
</script>

<style scoped>
.tab-pane { margin-top: var(--sp-4); }
.amt-in { color: #0f9d76; font-weight: 600; }
.amt-out { color: #dc2626; font-weight: 600; }
.sum-cell { color: var(--c-text-2); font-size: 13px; }
.f-kind { width: 130px; }
.f-date { width: 148px; }
@media (max-width: 767px) {
  .f-kind, .f-date { width: 100%; }
}

/* 手机端合计行通栏：统一由 src/styles/theme.css 的 .app-layout.is-mobile 钩子提供。
   页面里不要再写一份 —— scoped 副本特异性更高（(0,2,3)）会盖住全局，而它只声明
   display/width/margin，不管 padding/border/background，于是「只改全局不生效」。
   详见 theme.css 中「手机端：合计行通栏」那段 ⚠️ 注释。 */
</style>
