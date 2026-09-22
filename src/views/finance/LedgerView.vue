<template>
  <div class="ui-page">
    <PageHeader
      title="记一笔"
      sub="送货费、物流费、快递费、安装费、辅材费等不走采购/销售单的日常收支，在这里单独记账"
    >
      <template #actions>
        <button class="ui-btn ui-btn-sm" type="button" @click="fillDemo">填入示例</button>
      </template>
    </PageHeader>

    <!-- ===== 汇总 ===== -->
    <div class="ui-stat-grid">
      <StatCard label="本期收入" :value="`¥${money(summary.income)}`" icon="📈" tone="success" :hint="`${incomeCount} 笔`" />
      <StatCard label="本期支出" :value="`¥${money(summary.expense)}`" icon="📉" tone="danger" :hint="`${expenseCount} 笔`" />
      <StatCard
        label="净额"
        :value="`¥${money(summary.net)}`"
        icon="⚖️"
        :tone="summary.net >= 0 ? 'success' : 'danger'"
        :hint="summary.net >= 0 ? '收大于支' : '支大于收'"
      />
      <StatCard label="合计笔数" :value="rows.length" icon="🧾" tone="neutral" :hint="rangeLabel" />
    </div>

    <div class="ledger-grid">
      <!-- ===== 记账表单 ===== -->
      <SectionCard title="记一笔" desc="金额填错可在下方列表里删除重记">
        <div class="ui-seg dir-seg">
          <button
            type="button"
            class="ui-seg-item"
            :class="{ active: form.direction === 'out' }"
            @click="switchDirection('out')"
          >
            <span class="ui-seg-ico">➖</span>支出
          </button>
          <button
            type="button"
            class="ui-seg-item"
            :class="{ active: form.direction === 'in' }"
            @click="switchDirection('in')"
          >
            <span class="ui-seg-ico">➕</span>收入
          </button>
        </div>

        <div class="cat-wrap">
          <span class="ui-label">费用分类<span class="req">*</span></span>
          <div class="cat-grid">
            <button
              v-for="c in categories"
              :key="c.key"
              type="button"
              class="cat-chip"
              :class="{ active: form.category === c.key }"
              @click="form.category = c.key"
            >
              <span class="cat-ico">{{ c.icon }}</span>{{ c.label }}
            </button>
          </div>
        </div>

        <div class="ui-form-grid">
          <label class="ui-field">
            <span class="ui-label">金额<span class="req">*</span></span>
            <input
              v-model="form.amount"
              class="ui-input"
              type="number"
              min="0"
              step="0.01"
              inputmode="decimal"
              placeholder="0.00"
            />
          </label>
          <label class="ui-field">
            <span class="ui-label">发生日期</span>
            <input v-model="form.entryDate" class="ui-input" type="date" />
          </label>
          <label class="ui-field">
            <span class="ui-label">往来单位<span class="ui-hint">（选填）</span></span>
            <input v-model="form.counterparty" class="ui-input" list="ledger-parties" placeholder="如：顺丰、张师傅" />
            <datalist id="ledger-parties">
              <option v-for="n in partyNames" :key="n" :value="n"></option>
            </datalist>
          </label>
          <label class="ui-field link-field">
            <span class="ui-label">关联单据<span class="ui-hint">（选填）</span></span>
            <div class="link-row">
              <select v-model="form.linkDocType" class="ui-select link-type" aria-label="单据类型">
                <option value="">不关联</option>
                <option v-for="t in LEDGER_LINK_TYPES" :key="t.key" :value="t.key">
                  {{ t.label }}（{{ t.prefix }}…）
                </option>
              </select>
              <input
                v-model="form.linkDocNo"
                class="ui-input"
                list="ledger-link-docs"
                :disabled="!form.linkDocType"
                :placeholder="form.linkDocType ? `选择或输入${linkTypeLabel(form.linkDocType)}号` : '先选择单据类型'"
              />
            </div>
            <datalist id="ledger-link-docs">
              <option v-for="n in linkDocNos" :key="n" :value="n"></option>
            </datalist>
          </label>
        </div>

        <label class="ui-field remark-field">
          <span class="ui-label">备注<span class="ui-hint">（选填）</span></span>
          <textarea
            v-model="form.remark"
            class="ui-textarea"
            rows="2"
            maxlength="200"
            placeholder="如：8 月送货运费、门店安装辅材采购……"
          ></textarea>
        </label>

        <template #foot>
          <button class="ui-btn ui-btn-primary" type="button" :disabled="saving" @click="submit">
            {{ saving ? '保存中…' : '✅ 保存这一笔' }}
          </button>
          <button class="ui-btn" type="button" @click="resetForm">清空</button>
          <span v-if="lastNo" class="ui-hint">已保存 {{ lastNo }}</span>
        </template>
      </SectionCard>

      <!-- ===== 分类汇总 ===== -->
      <SectionCard title="分类汇总" desc="按筛选区间统计">
        <div v-if="summary.byCategory.length" class="cat-sum">
          <div v-for="c in summary.byCategory" :key="c.direction + c.category" class="cs-row">
            <span class="cs-name">
              <span class="cs-ico">{{ categoryIcon(c.category) }}</span>{{ c.label }}
            </span>
            <span class="cs-bar">
              <i :style="{ width: barWidth(c.amount) + '%' }" :class="c.direction === 'in' ? 'in' : 'out'"></i>
            </span>
            <span class="cs-amt" :class="c.direction === 'in' ? 'in' : 'out'">
              {{ c.direction === 'in' ? '+' : '-' }}¥{{ money(c.amount) }}
            </span>
          </div>
        </div>
        <EmptyState v-else icon="🧮" text="该区间还没有记账" hint="先在左边记一笔" />
      </SectionCard>
    </div>

    <!-- ===== 流水列表 ===== -->
    <SectionCard title="收支流水" :desc="`共 ${rows.length} 笔`" tight>
      <template #extra>
        <div class="ui-toolbar">
          <select v-model="filter.direction" class="ui-select f-dir" aria-label="方向">
            <option value="">全部收支</option>
            <option value="in">仅收入</option>
            <option value="out">仅支出</option>
          </select>
          <select v-model="filter.category" class="ui-select f-cat" aria-label="分类">
            <option value="">全部分类</option>
            <option v-for="c in LEDGER_CATEGORIES" :key="c.key" :value="c.key">{{ c.label }}</option>
          </select>
          <input v-model="filter.from" class="ui-input f-date" type="date" aria-label="开始日期" />
          <span class="ui-hint">至</span>
          <input v-model="filter.to" class="ui-input f-date" type="date" aria-label="结束日期" />
          <button class="ui-btn ui-btn-sm" type="button" @click="clearFilter">重置</button>
        </div>
      </template>

      <table v-if="rows.length" class="data-table">
        <thead>
          <tr>
            <th>单号</th>
            <th>日期</th>
            <th>分类</th>
            <th>往来单位</th>
            <th>关联单据</th>
            <th class="num">金额</th>
            <th>备注</th>
            <th class="center">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in pager.paged.value" :key="r.id">
            <td class="mono">{{ r.orderNo }}</td>
            <td>{{ r.entryDate }}</td>
            <td>
              <span class="ui-badge" :class="r.direction === 'in' ? 'success' : 'danger'">
                {{ categoryIcon(r.category) }} {{ categoryLabel(r.category) }}
              </span>
            </td>
            <td>{{ r.counterparty || '—' }}</td>
            <td class="link-cell">{{ linkCell(r) }}</td>
            <td class="num" :class="r.direction === 'in' ? 'amt-in' : 'amt-out'">
              {{ r.direction === 'in' ? '+' : '-' }}¥{{ money(r.amount) }}
            </td>
            <td class="remark-cell">{{ r.remark || '—' }}</td>
            <td class="center">
              <button class="ui-link danger" type="button" @click="remove(r)">删除</button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5">合计</td>
            <td class="num" :class="summary.net >= 0 ? 'amt-in' : 'amt-out'">
              {{ summary.net >= 0 ? '+' : '-' }}¥{{ money(Math.abs(summary.net)) }}
            </td>
            <td colspan="2" class="ui-hint">收入 ¥{{ money(summary.income) }} · 支出 ¥{{ money(summary.expense) }}</td>
          </tr>
        </tfoot>
      </table>
      <EmptyState v-else icon="🧾" text="还没有记一笔" hint="左边填好金额与分类，点「保存这一笔」" />

      <TablePager
        v-if="pager.total.value"
        v-model:page="page"
        :page-count="pager.pageCount.value"
        :total="pager.total.value"
        :size="pager.size.value"
        show-jump
      />
    </SectionCard>
  </div>
</template>

<script setup lang="ts">
import { usePagination, PAGE_SIZE_LIST } from '../../composables/usePagination'
import TablePager from '../../components/TablePager.vue'
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useFinanceStore } from '../../stores/finance'
import { useUserStore } from '../../stores/user'
import { db } from '../../db'
import {
  LEDGER_CATEGORIES, LEDGER_LINK_TYPES, linkTypeLabel, categoriesOf, categoryLabel, categoryIcon, todayStr
} from '../../utils/ledger'
import type { LedgerDirection, LedgerEntry } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatCard from '../../components/ui/StatCard.vue'
import EmptyState from '../../components/ui/EmptyState.vue'

const financeStore = useFinanceStore()
const userStore = useUserStore()

const rows = ref<LedgerEntry[]>([])
const saving = ref(false)
const lastNo = ref('')
const partyNames = ref<string[]>([])

const filter = reactive<{ direction: LedgerDirection | ''; category: string; from: string; to: string }>({
  direction: '', category: '', from: '', to: ''
})

const form = reactive({
  direction: 'out' as LedgerDirection,
  category: 'delivery',
  amount: '',
  entryDate: todayStr(),
  counterparty: '',
  linkDocType: '',
  linkDocNo: '',
  remark: ''
})

/** 当前所选单据类型的全部单号（datalist 候选） */
const linkDocNos = ref<string[]>([])

async function loadLinkDocs(type: string): Promise<void> {
  if (!type) {
    linkDocNos.value = []
    return
  }
  let nos: string[] = []
  if (type === 'inbound' || type === 'outbound') {
    const recType = type === 'inbound' ? 'purchase_in' : 'sale_out'
    const records = await db.stockRecords.where('type').equals(recType).toArray()
    nos = Array.from(new Set(records.map(r => r.batchNo).filter(Boolean) as string[]))
  } else if (type === 'return') {
    nos = (await db.returnOrders.toArray()).map(r => r.orderNo).filter(Boolean)
  } else if (type === 'purchase') {
    nos = (await db.purchaseOrders.toArray()).map(r => r.orderNo).filter(Boolean)
  } else if (type === 'sale') {
    nos = (await db.saleOrders.toArray()).map(r => r.orderNo).filter(Boolean)
  } else if (type === 'transfer') {
    nos = (await db.transferOrders.toArray()).map(r => r.orderNo).filter(Boolean)
  } else if (type === 'stocktake') {
    nos = (await db.stocktakes.toArray()).map(r => r.orderNo).filter(Boolean)
  }
  // 新单号在前，方便选择最近的单据
  linkDocNos.value = [...new Set(nos)].sort().reverse()
}

watch(() => form.linkDocType, t => {
  form.linkDocNo = ''
  loadLinkDocs(t)
})

const categories = computed(() => categoriesOf(form.direction))

const summary = ref<{ income: number; expense: number; net: number; byCategory: Array<{ category: string; label: string; amount: number; direction: LedgerDirection }> }>({
  income: 0, expense: 0, net: 0, byCategory: []
})

const incomeCount = computed(() => rows.value.filter(r => r.direction === 'in').length)
const expenseCount = computed(() => rows.value.filter(r => r.direction === 'out').length)
const rangeLabel = computed(() => {
  if (filter.from && filter.to) return `${filter.from} ~ ${filter.to}`
  if (filter.from) return `${filter.from} 起`
  if (filter.to) return `截至 ${filter.to}`
  return '全部区间'
})

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function barWidth(amount: number): number {
  const max = Math.max(...summary.value.byCategory.map(c => c.amount), 1)
  return Math.max(4, Math.round((amount / max) * 100))
}

function switchDirection(d: LedgerDirection): void {
  form.direction = d
  // 切换方向时自动带一个该方向的分类，避免提交时分类与方向不匹配
  const list = categoriesOf(d)
  if (!list.some(c => c.key === form.category)) form.category = list[0]?.key ?? ''
}

function resetForm(): void {
  form.amount = ''
  form.entryDate = todayStr()
  form.counterparty = ''
  form.linkDocType = ''
  form.linkDocNo = ''
  form.remark = ''
  lastNo.value = ''
}

function fillDemo(): void {
  form.direction = 'out'
  form.category = 'delivery'
  form.amount = '120'
  form.counterparty = '顺丰同城'
  form.remark = '客户急单送货'
}

async function submit(): Promise<void> {
  if (saving.value) return
  const amount = Number(form.amount)
  if (!Number.isFinite(amount) || amount <= 0) { showToast('请填写大于 0 的金额'); return }
  if (!form.category) { showToast('请选择费用分类'); return }
  saving.value = true
  const res = await financeStore.addLedger({
    direction: form.direction,
    category: form.category,
    amount,
    counterparty: form.counterparty,
    entryDate: form.entryDate,
    operatorId: userStore.currentUser?.id ?? 1,
    remark: form.remark,
    linkDocType: form.linkDocType,
    linkDocNo: form.linkDocNo
  })
  saving.value = false
  showToast(res.message)
  if (res.ok) {
    lastNo.value = res.orderNo ?? ''
    resetForm()
    lastNo.value = res.orderNo ?? ''
    await reload()
  }
}

async function remove(r: LedgerEntry): Promise<void> {
  try {
    await showConfirmDialog({
      title: '删除这一笔',
      message: `${r.orderNo} · ${categoryLabel(r.category)} ¥${money(r.amount)}\n删除后不可恢复`
    })
  } catch {
    return
  }
  const res = await financeStore.deleteLedger(r.id!, userStore.currentUser?.id ?? 1)
  showToast(res.message)
  if (res.ok) await reload()
}

function clearFilter(): void {
  filter.direction = ''
  filter.category = ''
  filter.from = ''
  filter.to = ''
}

/** 关联单据的展示文本：类型标签 + 单号，未关联显示 — */
function linkCell(r: LedgerEntry): string {
  if (!r.linkDocNo) return '—'
  const label = linkTypeLabel(r.linkDocType ?? '')
  return label ? `${label} ${r.linkDocNo}` : r.linkDocNo
}

async function reload(): Promise<void> {
  rows.value = await financeStore.listLedger({
    direction: filter.direction || undefined,
    category: filter.category || undefined,
    from: filter.from || undefined,
    to: filter.to || undefined
  })
  summary.value = await financeStore.ledgerSummary(filter.from || undefined, filter.to || undefined)
}

async function loadParties(): Promise<void> {
  const [cs, ss] = await Promise.all([db.customers.toArray(), db.suppliers.toArray()])
  partyNames.value = [...cs.map(c => c.name), ...ss.map(s => s.name)].filter(Boolean)
}

watch(filter, reload)

// 全站统一：列表每页 20 条 + 斑马纹（表格已挂 data-table）
// 合计仍按全部 rows 汇总，翻页不影响
const pager = usePagination(rows, PAGE_SIZE_LIST)
watch(rows, () => pager.reset())
const page = computed({ get: () => pager.page.value, set: v => pager.go(v) })

onMounted(async () => {
  await loadParties()
  await reload()
})
</script>

<style scoped>
.ledger-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: var(--sp-4);
  align-items: start;
}
@media (max-width: 1023px) {
  .ledger-grid { grid-template-columns: 1fr; }
}

.dir-seg { margin-bottom: var(--sp-4); }

.cat-wrap { margin-bottom: var(--sp-4); }
.cat-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-pill);
  background: var(--c-surface);
  color: var(--c-text-2);
  font-size: 13px;
  cursor: pointer;
  transition: all .15s ease;
}
.cat-chip:hover { border-color: var(--c-accent); color: var(--c-accent); }
.cat-chip.active {
  background: var(--c-accent);
  border-color: var(--c-accent);
  color: #fff;
  box-shadow: 0 2px 8px rgba(47, 107, 255, .22);
}
.cat-ico { font-size: 13px; line-height: 1; }

.remark-field { margin-top: var(--sp-4); }

.cat-sum { display: flex; flex-direction: column; gap: 10px; }
.cs-row {
  display: grid;
  grid-template-columns: 108px 1fr 84px;
  align-items: center;
  gap: 10px;
}
.cs-name { font-size: 13px; color: var(--c-text-2); display: flex; align-items: center; gap: 5px; }
.cs-ico { font-size: 13px; }
.cs-bar {
  height: 8px;
  border-radius: var(--r-pill);
  background: #eef1f6;
  overflow: hidden;
}
.cs-bar i { display: block; height: 100%; border-radius: var(--r-pill); }
.cs-bar i.in { background: var(--c-success); }
.cs-bar i.out { background: var(--c-danger); }
.cs-amt { text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; }
.cs-amt.in, .amt-in { color: #0f9d76; font-weight: 600; }
.cs-amt.out, .amt-out { color: #dc2626; font-weight: 600; }

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: var(--c-text-2); }
.remark-cell { max-width: 220px; color: var(--c-text-2); font-size: 13px; }
.link-cell { color: var(--c-primary); font-size: 12.5px; white-space: nowrap; }
.link-field { grid-column: 1 / -1; }
.link-row { display: grid; grid-template-columns: 176px minmax(0, 1fr); gap: 8px; }
.link-type { width: 100%; }
@media (max-width: 767px) {
  .link-field { grid-column: auto; }
  .link-row { grid-template-columns: 1fr; }
}

.f-dir { width: 116px; }
.f-cat { width: 130px; }
.f-date { width: 148px; }
@media (max-width: 767px) {
  .f-dir, .f-cat, .f-date { width: 100%; }
  .cs-row { grid-template-columns: 92px 1fr 76px; }
}

/* 手机端合计行通栏：统一由 src/styles/theme.css 的 .app-layout.is-mobile 钩子提供
   （含「说明格 colspan 不伸缩」「备注格 ui-hint 隐藏」两条，原先只写在本页）。
   页面里不要再写一份 —— scoped 副本特异性更高（(0,2,3)）会盖住全局，而它只声明
   display/width/margin，不管 padding/border/background，于是「只改全局不生效」。
   详见 theme.css 中「手机端：合计行通栏」那段 ⚠️ 注释。 */
</style>
