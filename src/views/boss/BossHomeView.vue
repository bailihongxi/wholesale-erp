<template>
  <div class="ui-page">
    <PageHeader :title="`欢迎，${userName} 👋`" sub="今天也要好好做生意～" />

    <!-- 内置密码提醒：老板仍用初始密码时给一条温和提示，可关闭、不阻断操作 -->
    <div v-if="showPwdTip" class="pwd-tip">
      <span class="pt-text">🔐 您当前仍在使用系统初始密码，建议尽快在「我的 → 修改密码」中修改，避免账号被冒用。</span>
      <span class="pt-acts">
        <button class="ui-btn ui-btn-sm" type="button" @click="pwdOpen = true">去修改</button>
        <button class="pt-x" type="button" @click="showPwdTip = false">✕</button>
      </span>
    </div>

    <!-- 空数据引导：新装系统 IndexedDB 为空时，各列表页都会显示「暂无数据」，
         这里给出明确指引，避免误以为功能没有开发。 -->
    <SectionCard v-if="isEmpty" class="guide" title="👋 开始使用" desc="首次使用请先载入示例数据或直接录入商品">
      <p class="guide-text">
        当前系统还没有任何业务数据，采购、销售、库存、财务等页面都会显示「暂无数据」。
        你可以先载入一套示例数据，快速查看各模块的完整效果与操作流程；也可以直接开始录入自己的商品与单据。
      </p>
      <template #foot>
        <button class="ui-btn ui-btn-primary" type="button" :disabled="seeding" @click="loadDemo">
          {{ seeding ? '生成中…' : '✨ 载入示例数据' }}
        </button>
        <button class="ui-btn" type="button" @click="go('/boss/products/new')">📦 直接录入商品</button>
      </template>
    </SectionCard>

    <!-- 4 个数据卡片 -->
    <div class="ui-stat-grid">
      <StatCard label="本月销售额" :value="yuan(d.monthSales)" icon="💹" tone="primary" />
      <StatCard label="本月毛利" :value="yuan(d.monthGrossProfit)" icon="📈" tone="success" />
      <StatCard label="应收款" :value="yuan(d.receivableTotal)" icon="🧾" tone="warning" />
      <StatCard label="库存预警" :value="`${d.lowStockCount} 项`" icon="⚠️" tone="danger" />
    </div>

    <!-- 今日待办 -->
    <SectionCard title="今日待办" desc="点一下直达处理页">
      <ul class="todo-list">
        <li class="todo-item" @click="go('/warehouse/inbound')">
          <span class="ti-left"><span class="ti-ico">📥</span>待入库采购单</span>
          <span class="todo-num">{{ d.todos.pendingInbound }}</span>
        </li>
        <li class="todo-item" @click="go('/warehouse/outbound')">
          <span class="ti-left"><span class="ti-ico">📤</span>待发货销售单</span>
          <span class="todo-num">{{ d.todos.pendingOutbound }}</span>
        </li>
        <li class="todo-item" @click="go('/finance/reconcile')">
          <span class="ti-left"><span class="ti-ico">💰</span>待收款单据</span>
          <span class="todo-num">{{ d.todos.pendingReceive }}</span>
        </li>
      </ul>
    </SectionCard>

    <!-- 快捷操作 -->
    <SectionCard title="快捷操作">
      <div class="quick-grid">
        <div class="quick-item" @click="go('/boss/products')"><span class="qi-ico">📦</span><span>商品档案</span></div>
        <div class="quick-item" @click="go('/boss/products/new')"><span class="qi-ico">➕</span><span>新增商品</span></div>
        <div class="quick-item" @click="go('/purchase/orders/new')"><span class="qi-ico">🛒</span><span>采购开单</span></div>
        <div class="quick-item" @click="go('/sales/orders/new')"><span class="qi-ico">💰</span><span>销售开单</span></div>
        <div class="quick-item" @click="go('/stock')"><span class="qi-ico">🗃️</span><span>库存管理</span></div>
        <div class="quick-item" @click="go('/finance?tab=reports')"><span class="qi-ico">📊</span><span>经营报表</span></div>
      </div>
    </SectionCard>

    <ChangePasswordModal v-model:open="pwdOpen" @changed="onPwdChanged" />
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { db } from '../../db'
import { seedDemoData } from '../../utils/demoData'
import { useUserStore } from '../../stores/user'
import { useDashboardStore } from '../../stores/dashboard'
import PageHeader from '../../components/ui/PageHeader.vue'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatCard from '../../components/ui/StatCard.vue'
import ChangePasswordModal from '../../components/ChangePasswordModal.vue'

const router = useRouter()
const userStore = useUserStore()
const dashboardStore = useDashboardStore()

const userName = userStore.currentUser?.name ?? '老板'

// 「我的 → 修改密码」弹窗与内置密码提醒条
const pwdOpen = ref(false)
const showPwdTip = ref(false)

const isEmpty = ref(false)
const seeding = ref(false)

const d = reactive({
  monthSales: 0,
  monthGrossProfit: 0,
  receivableTotal: 0,
  payableTotal: 0,
  lowStockCount: 0,
  todos: { pendingInbound: 0, pendingOutbound: 0, pendingReceive: 0 }
})

async function refreshDashboard(): Promise<void> {
  const summary = await dashboardStore.getBossDashboard()
  Object.assign(d, summary)
}

async function refreshEmpty(): Promise<void> {
  const [products, purchaseOrders, saleOrders] = await Promise.all([
    db.products.count(),
    db.purchaseOrders.count(),
    db.saleOrders.count()
  ])
  isEmpty.value = products + purchaseOrders + saleOrders === 0
}

async function loadDemo(): Promise<void> {
  seeding.value = true
  try {
    const res = await seedDemoData()
    showToast(res.message)
    await Promise.all([refreshEmpty(), refreshDashboard()])
  } finally {
    seeding.value = false
  }
}

onMounted(async () => {
  // 首屏统计只做展示，加载失败不应把异常抛到挂载流程之外
  // （数据库被关闭/重置、账号切换等场景都可能让它失败），保持空态即可。
  try {
    await refreshDashboard()
    await refreshEmpty()
    showPwdTip.value = await userStore.usesDefaultPassword()
  } catch (e) {
    console.debug('[工作台] 统计加载失败，页面保持空态：', e)
  }
})

/** 改完密码后重新判定，提醒条应立刻消失 */
async function onPwdChanged(): Promise<void> {
  showPwdTip.value = await userStore.usesDefaultPassword()
}

function yuan(n: number): string {
  return '¥' + Math.round(n).toLocaleString('zh-CN')
}

function go(path: string): void {
  router.push(path)
}
</script>

<style scoped>
/* 内置密码提醒：琥珀色提示条，可关闭，不阻断任何操作 */
.pwd-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 11px 14px;
  margin-bottom: var(--sp-3);
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: var(--r-md);
}
.pt-text { font-size: 13px; color: #92400e; line-height: 1.55; }
.pt-acts { display: flex; align-items: center; gap: 10px; flex: none; }
.pt-x {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  color: #b45309;
  padding: 0 2px;
}

.guide-text {
  font-size: 13px;
  line-height: 1.8;
  color: var(--c-muted);
}

.todo-list { list-style: none; }
.todo-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 13px 12px;
  margin: 0 -12px;
  border-bottom: 1px solid #f0f3f8;
  border-radius: var(--r-sm);
  cursor: pointer;
  font-size: 14px;
  transition: background .15s ease;
}
.todo-item:last-child { border-bottom: none; }
.todo-item:hover { background: var(--c-accent-soft); }
.ti-left { display: inline-flex; align-items: center; gap: 9px; color: var(--c-text); }
.ti-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: var(--r-sm);
  background: var(--c-primary-soft); font-size: 15px;
}
.todo-num {
  min-width: 30px; height: 24px; padding: 0 9px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--r-pill);
  background: var(--c-danger-soft);
  color: #dc2626;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.quick-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 18px 8px;
  background: var(--c-surface-alt);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  cursor: pointer;
  font-size: 13px;
  color: var(--c-text-2);
  min-height: 78px;
  transition: border-color .15s ease, background .15s ease, transform .15s ease;
}
.quick-item:hover {
  border-color: var(--c-accent);
  background: var(--c-accent-soft);
  color: var(--c-accent);
  transform: translateY(-1px);
}
.qi-ico { font-size: 22px; line-height: 1; }

@media (max-width: 767px) {
  .quick-grid { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .quick-item { min-height: 70px; padding: 14px 4px; font-size: 12px; }
}
</style>
