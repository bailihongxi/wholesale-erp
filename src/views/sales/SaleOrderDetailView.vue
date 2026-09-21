<template>
  <div class="detail-page">
    <!-- 单据头部 -->
    <section class="block">
      <div class="d-head">
        <div>
          <h3 class="d-no">{{ order?.orderNo || '加载中…' }}</h3>
          <span class="d-badge" :class="order?.status">{{ statusText(order?.status ?? '') }}</span>
          <span class="d-badge pay" :class="order?.receiveStatus">{{ recvText(order?.receiveStatus ?? '') }}</span>
        </div>
        <div class="d-actions">
          <button class="btn" type="button" @click="openPreview">🖨 打印送货单</button>
        </div>
      </div>

      <div class="d-meta">
        <span><i>客户</i>{{ customer?.name || '-' }}</span>
        <span><i>联系人</i>{{ customer?.contact || '-' }} {{ customer?.phone || '' }}</span>
        <span><i>下单日期</i>{{ fmtDate(order?.orderDate ?? '') }}</span>
        <span><i>备注</i>{{ order?.remark || '无' }}</span>
      </div>
    </section>

    <!-- 明细 -->
    <section class="block">
      <h4 class="block-title">商品明细（{{ items.length }}）</h4>

      <ul v-if="isMobile" class="item-cards">
        <li v-for="(it, i) in items" :key="i" class="item-card">
          <div class="ic-name">
            {{ nameOf(it.productId) }}
            <span v-if="it.isGift" class="gift-badge">🎁 赠品</span>
          </div>
          <div class="ic-line">数量 {{ it.quantity }} {{ unitOf(it.productId) }}</div>
          <div v-if="canSeeAnyPrice" class="ic-line">单价 {{ it.isGift ? '—' : '¥' + money(it.price) }}</div>
          <div v-if="canSeeAnyPrice" class="ic-line">金额 {{ it.isGift ? '赠品' : '¥' + money(it.subtotal) }}</div>
        </li>
        <li v-if="!items.length" class="empty">暂无明细</li>
      </ul>

      <table v-else class="item-table">
        <thead>
          <tr>
            <th>#</th>
            <th>商品名称</th>
            <th>单位</th>
            <th class="num">数量</th>
            <th v-if="canSeeAnyPrice" class="num">单价</th>
            <th v-if="canSeeAnyPrice" class="num">金额</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, i) in items" :key="i">
            <td>{{ i + 1 }}</td>
            <td>
              {{ nameOf(it.productId) }}
              <span v-if="it.isGift" class="gift-badge">🎁 赠品</span>
            </td>
            <td>{{ unitOf(it.productId) }}</td>
            <td class="num">{{ it.quantity }}</td>
            <td v-if="canSeeAnyPrice" class="num">{{ it.isGift ? '—' : '¥' + money(it.price) }}</td>
            <td v-if="canSeeAnyPrice" class="num">{{ it.isGift ? '赠品' : '¥' + money(it.subtotal) }}</td>
          </tr>
          <tr v-if="!items.length"><td :colspan="colspan" class="empty">暂无明细</td></tr>
        </tbody>
        <tfoot v-if="items.length">
          <tr>
            <td colspan="3" class="total-label">
              合计<span v-if="giftQty" class="gift-note">（含赠品 {{ giftQty }} 件）</span>
            </td>
            <td class="num">{{ totalQty }}</td>
            <td v-if="canSeeAnyPrice" class="num"></td>
            <td v-if="canSeeAnyPrice" class="num"><b>¥{{ money(order?.totalAmount ?? 0) }}</b></td>
          </tr>
        </tfoot>
      </table>
    </section>

    <!-- 出库进度 -->
    <section class="block">
      <h4 class="block-title">出库进度</h4>
      <ul class="prog-list">
        <li v-for="(it, i) in items" :key="i" class="prog-item">
          <span class="p-name">{{ nameOf(it.productId) }}</span>
          <span class="p-bar"><span class="p-fill" :style="{ width: percentOf(it) + '%' }"></span></span>
          <span class="p-num">{{ shippedOf(it.productId) }} / {{ it.quantity }}</span>
        </li>
        <li v-if="!items.length" class="empty">暂无明细</li>
      </ul>
    </section>

    <!-- 出库流水（历史痕迹） -->
    <section class="block">
      <h4 class="block-title">出库流水（{{ outboundRecords.length }}）</h4>
      <table v-if="outboundRecords.length" class="item-table">
        <thead><tr><th>时间</th><th>商品名称</th><th class="num">数量</th><th>操作人</th></tr></thead>
        <tbody>
          <tr v-for="r in outboundRecords" :key="r.id">
            <td>{{ fmtTime(r.createdAt) }}</td>
            <td>{{ nameOf(r.productId) }}</td>
            <td class="num">{{ Math.abs(r.quantity) }}</td>
            <td>{{ operatorName(r.operatorId) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">尚未出库</div>
    </section>

    <!-- 收款记录 -->
    <section class="block">
      <h4 class="block-title">收款记录（{{ payments.length }}）</h4>
      <table v-if="payments.length" class="item-table">
        <thead><tr><th>日期</th><th class="num">金额</th><th>操作人</th><th>备注</th></tr></thead>
        <tbody>
          <tr v-for="p in payments" :key="p.id">
            <td>{{ fmtDate(p.payDate) }}</td>
            <td class="num">¥{{ money(p.amount) }}</td>
            <td>{{ operatorName(p.operatorId) }}</td>
            <td>{{ p.remark || '-' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">尚未登记收款</div>
    </section>

    <PageActions cancel-text="返回" @cancel="goBack" />

    <PrintPreview
      :visible="showPreview"
      :title="`销售单 ${order?.orderNo ?? ''}`"
      :order-data="printData"
      :allow-price-toggle="canSeeAnyPrice"
      v-model:show-price="showPrice"
      @cancel="showPreview = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { useSalesStore } from '../../stores/sales'
import { useResponsive } from '../../composables/useResponsive'
import { usePermission } from '../../composables/usePermission'
import { db } from '../../db'
import { getCompanyName, type PrintOrderData } from '../../utils/printTemplate'
import PageActions from '../../components/PageActions.vue'
import PrintPreview from '../../components/PrintPreview.vue'
import type { SaleOrder, SaleOrderItem, Customer, Payment, Product, StockRecord } from '../../types'

const route = useRoute()
const router = useRouter()
const salesStore = useSalesStore()
const { isMobile } = useResponsive()
const { canSeeAnyPrice } = usePermission()

const order = ref<SaleOrder | null>(null)
const items = ref<SaleOrderItem[]>([])
const customer = ref<Customer | null>(null)
const payments = ref<Payment[]>([])
const outboundRecords = ref<StockRecord[]>([])
const productMap = ref<Record<number, Product>>({})
const shippedMap = ref<Record<number, number>>({})
const userMap = ref<Record<number, string>>({})
const showPrice = ref(true)
const showPreview = ref(false)

const colspan = computed(() => (canSeeAnyPrice.value ? 6 : 4))
const totalQty = computed(() => items.value.filter(it => !it.isGift).reduce((s, it) => s + it.quantity, 0))
const giftQty = computed(() => items.value.filter(it => it.isGift).reduce((s, it) => s + it.quantity, 0))

/** 打印用原始数据：交给预览组件按纸张/表头设置实时排版 */
const printData = computed<PrintOrderData | null>(() => {
  const o = order.value
  if (!o) return null
  return {
    orderNo: o.orderNo,
    date: fmtDate(o.orderDate),
    partyName: customer.value?.name ?? '',
    partyContact: customer.value?.contact ?? '',
    partyPhone: customer.value?.phone ?? '',
    partyAddress: customer.value?.address ?? '',
    partyLabel: '客户',
    items: items.value.map(it => ({
      productName: productMap.value[it.productId]?.brand ?? '',
      category: productMap.value[it.productId]?.category ?? '',
      model: productMap.value[it.productId]?.model ?? '',
      unit: unitOf(it.productId),
      quantity: it.quantity,
      price: it.price,
      subtotal: it.subtotal,
      isGift: it.isGift
    })),
    totalQuantity: totalQty.value,
    totalAmount: o.totalAmount,
    remark: o.remark,
    title: '销售单（送货单）',
    companyName: getCompanyName()
  }
})

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(s: string): string { return s ? s.slice(0, 10) : '-' }
function fmtTime(s: string): string { return s ? s.slice(0, 16).replace('T', ' ') : '-' }
function nameOf(id: number): string {
  const p = productMap.value[id]
  return p ? `${p.brand} ${p.model}` : `商品#${id}`
}
function unitOf(id: number): string { return productMap.value[id]?.unit ?? '-' }
function operatorName(id: number): string { return userMap.value[id] ?? `#${id}` }
function statusText(s: string): string {
  return { pending: '待出库', partial: '部分出库', completed: '已完成' }[s] || s || '-'
}
function recvText(s: string): string {
  return { unreceived: '未收款', partial: '部分收款', received: '已收款' }[s] || s || '-'
}
function shippedOf(productId: number): number { return shippedMap.value[productId] ?? 0 }
function percentOf(it: SaleOrderItem): number {
  if (!it.quantity) return 0
  return Math.min(100, Math.round((shippedOf(it.productId) / it.quantity) * 100))
}

function goBack(): void {
  router.push('/sales/orders')
}

function openPreview(): void {
  if (!order.value) {
    showToast('单据尚未加载完成')
    return
  }
  showPreview.value = true
}

async function loadOrder(): Promise<void> {
  const id = Number(route.params.id)
  if (!id) return
  order.value = (await salesStore.getOrder(id)) ?? null
  if (!order.value) return
  items.value = await salesStore.getOrderItems(id)

  customer.value = (await salesStore.listCustomers()).find(c => c.id === order.value!.customerId) ?? null
  payments.value = await db.payments.where('type').equals('receive').filter(p => p.refOrderId === id).toArray()

  const users = await db.users.toArray()
  const um: Record<number, string> = {}
  for (const u of users) um[u.id!] = u.name
  userMap.value = um

  const map: Record<number, Product> = {}
  for (const it of items.value) {
    const p = await db.products.get(it.productId)
    if (p) map[it.productId] = p
  }
  productMap.value = map

  // 出库流水（历史痕迹），按时间倒序
  const records = await db.stockRecords.where('refOrderId').equals(id).toArray()
  const outs = records
    .filter(r => r.type === 'sale_out')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  outboundRecords.value = outs

  // 已发数量：出库流水为负数，取绝对值
  const shipped: Record<number, number> = {}
  for (const r of outs) {
    shipped[r.productId] = (shipped[r.productId] ?? 0) + Math.abs(r.quantity)
  }
  shippedMap.value = shipped
}

onMounted(loadOrder)
// 同一路由只换单据 id 时组件会被复用，必须监听 id 变化重新加载
watch(() => route.params.id, loadOrder)
</script>

<style scoped>
.detail-page { max-width: 1100px; margin: 0 auto; }
.gift-badge { display: inline-block; margin-left: 6px; font-size: 11px; color: var(--c-accent); background: #eaf1ff; border-radius: 4px; padding: 1px 6px; }
.gift-note { margin-left: 6px; font-size: 12px; font-weight: 400; color: var(--c-accent); }
.d-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.d-no { display: inline-block; font-size: 18px; color: var(--c-primary, #1a365d); margin: 0 8px 0 0; }
.d-badge { font-size: 12px; padding: 2px 10px; border-radius: 10px; background: var(--c-bg, #f1f5f9); color: var(--c-muted, #64748b); }
.d-badge.completed, .d-badge.received { background: #e6f6ee; color: #16a34a; }
.d-badge.pending, .d-badge.unreceived { background: #fff4e5; color: #dd6b20; }
.d-actions { display: flex; align-items: center; gap: 12px; }
.btn { height: 40px; padding: 0 16px; border: none; border-radius: 10px; background: var(--c-accent, #2563eb); color: #fff; cursor: pointer; font-size: 14px; }
.d-meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 12px; font-size: 13px; }
.d-meta i { display: inline-block; width: 62px; color: var(--c-muted, #64748b); font-style: normal; }

.item-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.item-table th, .item-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--c-border, #e2e8f0); }
.item-table th { background: #f1f5f9; color: var(--c-primary, #1a365d); }
.item-table .num { text-align: right; }
.item-table tfoot td { border-bottom: none; font-weight: 600; }
.total-label { text-align: right !important; }
.item-cards { list-style: none; }
.item-card { padding: 10px 4px; border-bottom: 1px solid var(--c-border, #e2e8f0); }
.item-card:last-child { border-bottom: none; }
.ic-name { font-weight: 600; color: var(--c-primary, #1a365d); }
.ic-line { font-size: 13px; color: var(--c-muted, #64748b); margin-top: 2px; }

.prog-list { list-style: none; }
.prog-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 13px; }
.p-name { width: 160px; flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p-bar { flex: 1; height: 8px; background: var(--c-bg, #f1f5f9); border-radius: 6px; overflow: hidden; }
.p-fill { display: block; height: 100%; background: #16a34a; }
.p-num { width: 90px; text-align: right; color: var(--c-muted, #64748b); }
.empty { text-align: center; color: var(--c-muted, #64748b); padding: 18px; }

@media (max-width: 767px) {
  .d-meta { grid-template-columns: 1fr; }
  .p-name { width: 110px; }
}
</style>
