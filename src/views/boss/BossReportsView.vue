<template>
  <div class="reports-page">
    <PageHeader title="经营报表" sub="销售额、毛利、应收应付与趋势分析" />
    <!-- 日期筛选 -->
    <div class="toolbar">
      <div class="range-group">
        <input v-model="startDate" class="date-input" type="date" aria-label="开始日期" />
        <span class="range-sep">至</span>
        <input v-model="endDate" class="date-input" type="date" aria-label="结束日期" />
      </div>
      <div class="quick-group">
        <button class="q-btn" type="button" @click="setQuick(0)">本月</button>
        <button class="q-btn" type="button" @click="setQuick(1)">近3月</button>
        <button class="q-btn" type="button" @click="setQuick(5)">近半年</button>
        <button class="q-btn primary" type="button" @click="clearRange">全部数据</button>
      </div>
      <span class="range-tip">{{ rangeLabel }}</span>
    </div>

    <!-- 核心指标 -->
    <div class="stat-row">
      <div class="stat-card blue">
        <span class="s-label">销售收入</span>
        <b class="s-value">¥{{ money(summary.totalSales) }}</b>
      </div>
      <div class="stat-card orange">
        <span class="s-label">销售成本</span>
        <b class="s-value">¥{{ money(summary.totalCost) }}</b>
      </div>
      <div class="stat-card green">
        <span class="s-label">毛利</span>
        <b class="s-value">¥{{ money(summary.grossProfit) }}</b>
      </div>
      <div class="stat-card">
        <span class="s-label">毛利率</span>
        <b class="s-value">{{ profitRate }}%</b>
      </div>
      <div class="stat-card red">
        <span class="s-label">应收未收</span>
        <b class="s-value">¥{{ money(receivableTotal) }}</b>
      </div>
      <div class="stat-card red">
        <span class="s-label">应付未付</span>
        <b class="s-value">¥{{ money(payableTotal) }}</b>
      </div>
    </div>

    <!-- 月度趋势 -->
    <section class="block">
      <h3 class="block-title">销售毛利趋势（近 {{ trend.length }} 个月）</h3>
      <div class="chart">
        <div v-for="t in trend" :key="t.key" class="bar-col">
          <div class="bar-wrap">
            <div
              class="bar sales"
              :style="{ height: barHeight(t.sales) }"
              :title="`销售 ¥${money(t.sales)}`"
            ></div>
            <div
              class="bar profit"
              :style="{ height: barHeight(t.profit) }"
              :title="`毛利 ¥${money(t.profit)}`"
            ></div>
          </div>
          <span class="bar-label">{{ t.label }}</span>
          <span class="bar-val">{{ t.sales ? money(t.sales) : '-' }}</span>
        </div>
      </div>
      <div class="legend">
        <span><i class="dot sales"></i>销售收入</span>
        <span><i class="dot profit"></i>毛利</span>
        <span class="legend-tip">注：趋势图始终展示近 6 个自然月，不受上方日期筛选影响</span>
      </div>
    </section>

    <!-- 低库存预警：每页固定 50 条 + 全站斑马纹表格，长清单不会看串行 -->
    <section class="block">
      <h3 class="block-title" :class="{ danger: lowStock.length > 0 }">
        库存预警商品（{{ lowStock.length }}）
        <span v-if="lowStock.length" class="sec-tip">每页 {{ pager.size.value }} 条 · 低于预警线需及时补货</span>
      </h3>
      <table v-if="!isMobile" class="data-table warn-table">
        <thead>
          <tr>
            <th class="center" style="width:76px">序号</th>
            <th>商品</th>
            <th>分类</th>
            <th class="num">当前库存</th>
            <th class="num">预警值</th>
            <th class="num">缺口</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, i) in pager.paged.value" :key="item.product.id" class="is-warn">
            <td class="center c-muted">{{ pager.startIndex.value + i }}</td>
            <td>{{ productStore.productName(item.product) }}</td>
            <td class="c-muted">{{ item.product.category }}</td>
            <td class="num c-danger">{{ item.quantity }}</td>
            <td class="num c-muted">{{ item.product.warnStock }}</td>
            <td class="num c-danger">{{ gapOf(item) }}</td>
          </tr>
          <tr v-if="!lowStock.length"><td colspan="6" class="empty">库存充足，无预警商品</td></tr>
        </tbody>
      </table>
      <ul v-else class="warn-list zebra-list">
        <li v-for="item in pager.paged.value" :key="item.product.id" class="warn-item">
          <span class="w-name">{{ productStore.productName(item.product) }}</span>
          <span class="w-qty">{{ item.quantity }} / 预警 {{ item.product.warnStock }}</span>
        </li>
        <li v-if="!lowStock.length" class="empty">库存充足，无预警商品</li>
      </ul>

      <TablePager
        v-if="lowStock.length"
        v-model:page="pageProxy"
        :total="pager.total.value"
        :page-count="pager.pageCount.value"
        :size="pager.size.value"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useFinanceStore } from '../../stores/finance'
import { useProductStore } from '../../stores/product'
import { useResponsive } from '../../composables/useResponsive'
import { usePagination, PAGE_SIZE_ALERT } from '../../composables/usePagination'
import type { Product } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'
import TablePager from '../../components/TablePager.vue'

const financeStore = useFinanceStore()
const productStore = useProductStore()
const { isMobile } = useResponsive()

const startDate = ref('')
const endDate = ref('')
const summary = ref({ totalSales: 0, totalCost: 0, grossProfit: 0 })
const trend = ref<Array<{ key: string; label: string; sales: number; cost: number; profit: number }>>([])
const receivableTotal = ref(0)
const payableTotal = ref(0)
const lowStock = ref<Array<{ product: Product; quantity: number }>>([])

/**
 * 库存预警清单固定每页 50 条（与「库存管理 → 库存预警」同一口径），
 * 标题里的数字仍是全部预警商品数，只是分页展示，避免长清单铺满整页。
 */
const pager = usePagination(lowStock, PAGE_SIZE_ALERT)
const pageProxy = computed({
  get: () => pager.page.value,
  set: v => pager.go(v)
})

/** 缺口：距离预警线还差多少（预警值 - 当前库存，至少 1） */
function gapOf(item: { product: Product; quantity: number }): number {
  return Math.max(1, item.product.warnStock - item.quantity)
}

const hasRange = computed(() => !!startDate.value || !!endDate.value)
const rangeLabel = computed(() =>
  hasRange.value
    ? `统计区间：${startDate.value || '全部'} ~ ${endDate.value || '全部'}`
    : '统计区间：全部数据'
)
const profitRate = computed(() => {
  if (!summary.value.totalSales) return '0.0'
  return ((summary.value.grossProfit / summary.value.totalSales) * 100).toFixed(1)
})

/** 趋势图最大值，用于计算柱高比例 */
const maxTrend = computed(() => Math.max(1, ...trend.value.map(t => Math.max(t.sales, t.profit))))
function barHeight(v: number): string {
  return `${Math.round((v / maxTrend.value) * 100)}%`
}

/** 快捷区间：monthsBack=0 表示本月，5 表示近半年 */
function setQuick(monthsBack: number): void {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  start.setMonth(start.getMonth() - monthsBack)
  if (monthsBack === 0) start.setDate(1)
  startDate.value = toDateStr(start)
  endDate.value = toDateStr(end)
}

function clearRange(): void {
  startDate.value = ''
  endDate.value = ''
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

async function reload(): Promise<void> {
  summary.value = await financeStore.getProfitSummary(startDate.value || undefined, endDate.value || undefined)
  receivableTotal.value = await financeStore.getReceivableTotal()
  payableTotal.value = await financeStore.getPayableTotal()
  trend.value = await financeStore.getMonthlyTrend(6)
}

async function reloadLowStock(): Promise<void> {
  lowStock.value = await productStore.getLowStockProducts()
}

onMounted(async () => {
  await reload()
  await reloadLowStock()
})

watch([startDate, endDate], reload)
</script>

<style scoped>
/* ⚠️ 不要在这里写 max-width / margin:auto ——
   本页既作为独立路由 /boss/reports 打开，也被「财务管理」Hub 页嵌进 .tab-pane。
   自带宽度会让它在宽屏下比父级（1240px）再窄一档并各自居中，
   表现为「财务管理标题 → Tab → 报表卡片」左边缘逐层缩进的错位。
   宽度一律交给全局 :where(.reports-page){max-width:1240px;margin:0 auto} 与父级决定。 */
.reports-page { width: 100%; }

.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.range-group { display: flex; align-items: center; gap: 6px; }
.date-input {
  height: 40px; border: 1px solid var(--c-border, #e2e8f0); border-radius: 10px;
  padding: 0 10px; font-size: 13px; background: #fff; color: var(--c-text, #1a202c); outline: none;
}
.range-sep { color: var(--c-muted, #64748b); font-size: 13px; }
.quick-group { display: flex; gap: 6px; }
.q-btn {
  height: 40px; padding: 0 12px; border: 1px solid var(--c-border, #e2e8f0); border-radius: 10px;
  background: #fff; color: var(--c-text, #1a202c); font-size: 13px; cursor: pointer;
}
.q-btn:hover { border-color: var(--c-accent, #2563eb); color: var(--c-accent, #2563eb); }
.q-btn.primary { background: var(--c-accent, #2563eb); color: #fff; border-color: var(--c-accent, #2563eb); }
.range-tip { font-size: 12px; color: var(--c-muted, #64748b); }

.stat-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 16px; }
.stat-card { background: #fff; border-radius: 12px; padding: 12px 14px; box-shadow: 0 2px 10px rgba(26, 54, 93, 0.06); border-left: 4px solid transparent; }
.stat-card.blue { border-left-color: #1f3a68; }
.stat-card.green { border-left-color: #22a06b; }
.stat-card.orange { border-left-color: #f5a623; }
.stat-card.red { border-left-color: #e53e3e; }
.s-label { display: block; font-size: 12px; color: var(--c-muted, #64748b); }
.s-value { display: block; font-size: 18px; color: var(--c-primary, #1a365d); margin-top: 4px; }

.block-title.danger { color: var(--c-danger, #e53e3e); }

.chart { display: flex; align-items: flex-end; gap: 12px; height: 180px; padding: 0 4px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
.bar-wrap { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 4px; }
.bar { width: 40%; min-height: 2px; border-radius: 4px 4px 0 0; transition: height 0.2s ease; }
.bar.sales { background: #1f3a68; }
.bar.profit { background: #22a06b; }
.bar-label { font-size: 12px; color: var(--c-muted, #64748b); margin-top: 6px; }
.bar-val { font-size: 11px; color: var(--c-primary, #1a365d); }
.legend { display: flex; align-items: center; gap: 16px; margin-top: 10px; font-size: 12px; color: var(--c-muted, #64748b); flex-wrap: wrap; }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.dot { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.dot.sales { background: #1f3a68; }
.dot.profit { background: #22a06b; }
.legend-tip { opacity: 0.75; }

.warn-table { width: 100%; border-collapse: collapse; }
.warn-table th, .warn-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--c-border, #e2e8f0); font-size: 14px; }
.warn-table th { background: #f1f5f9; color: var(--c-primary, #1a365d); }
.warn-table .num { text-align: right; }
.c-muted { color: var(--c-muted, #64748b); }
.c-danger { color: var(--c-danger, #e53e3e); font-weight: 600; }
.warn-list { list-style: none; }
.warn-item { display: flex; justify-content: space-between; padding: 10px 4px; border-bottom: 1px solid var(--c-border, #e2e8f0); font-size: 14px; }
.warn-item:last-child { border-bottom: none; }
.w-qty { color: var(--c-danger, #e53e3e); font-weight: 600; }
.empty { text-align: center; color: var(--c-muted, #64748b); padding: 18px; }

@media (max-width: 900px) {
  .stat-row { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 767px) {
  .stat-row { grid-template-columns: repeat(2, 1fr); }
}
</style>
