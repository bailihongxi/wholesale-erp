<template>
  <div class="detail-page">
    <!-- 单据头部 -->
    <section class="block">
      <div class="d-head">
        <div>
          <h3 class="d-no">{{ order?.orderNo || '加载中…' }}</h3>
          <span class="d-badge" :class="order?.status">{{ statusText(order?.status ?? '') }}</span>
          <span class="d-badge pay" :class="order?.payStatus">{{ payText(order?.payStatus ?? '') }}</span>
        </div>
        <div class="d-actions">
          <button v-if="order?.status === 'pending'" class="btn primary btn-edit" type="button" @click="beginEdit">✏️ 修改</button>
          <button class="btn btn-print" type="button" @click="openPreview">🖨 打印</button>
          <!-- 删除：仅老板 / 系统管理员可见，且只限于「待入库」的单据 -->
          <button
            v-if="canDeleteDoc && order?.status === 'pending'"
            class="btn danger"
            type="button"
            :disabled="removing"
            @click="handleRemove"
          >{{ removing ? '删除中…' : '🗑 删除' }}</button>
        </div>
      </div>

      <div class="d-meta">
        <span><i>供应商</i>{{ supplier?.name || '-' }}</span>
        <span><i>联系人</i>{{ supplier?.contact || '-' }} {{ supplier?.phone || '' }}</span>
        <span><i>下单日期</i>{{ fmtDate(order?.orderDate ?? '') }}</span>
        <span><i>备注</i>{{ order?.remark || '无' }}</span>
      </div>
    </section>

    <!-- 明细：手机端卡片（components/ui/ItemCards.vue，全站统一），电脑端列表表格。
         规则见 docs/手机端明细卡片规范.md：电脑端明细=列表，手机端明细=卡片。 -->
    <section class="block">
      <ItemCards
        v-if="isMobile"
        title="商品明细"
        :items="cardRows"
        :show-price="canSeePurchasePrice"
        :total-qty="totalQty"
        :total-amount="order?.totalAmount ?? 0"
        empty-text="暂无明细"
      />

      <template v-else>
      <h4 class="block-title">商品明细（{{ items.length }}）</h4>
      <table class="item-table">
        <thead>
          <tr>
            <th>#</th>
            <th>商品名称</th>
            <th>单位</th>
            <th class="num">订单数量</th>
            <th v-if="canSeePurchasePrice" class="num">单价</th>
            <th v-if="canSeePurchasePrice" class="num">金额</th>
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
            <td v-if="canSeePurchasePrice" class="num">{{ it.isGift ? '—' : '¥' + money(it.price) }}</td>
            <td v-if="canSeePurchasePrice" class="num">{{ it.isGift ? '赠品' : '¥' + money(it.subtotal) }}</td>
          </tr>
          <tr v-if="!items.length"><td :colspan="colspan" class="empty">暂无明细</td></tr>
        </tbody>
        <tfoot v-if="items.length">
          <tr>
            <td colspan="3" class="total-label">
              合计<span v-if="giftQty" class="gift-note">（含赠品 {{ giftQty }} 件）</span>
            </td>
            <td class="num">{{ totalQty }}</td>
            <td v-if="canSeePurchasePrice" class="num"></td>
            <td v-if="canSeePurchasePrice" class="num"><b>¥{{ money(order?.totalAmount ?? 0) }}</b></td>
          </tr>
        </tfoot>
      </table>
      </template>
    </section>

    <!-- 入库进度 -->
    <section class="block">
      <h4 class="block-title">入库进度</h4>
      <ul class="prog-list">
        <li v-for="(it, i) in items" :key="i" class="prog-item">
          <span class="p-name">{{ nameOf(it.productId) }}</span>
          <span class="p-bar">
            <span class="p-fill" :style="{ width: percentOf(it) + '%' }"></span>
          </span>
          <span class="p-num">{{ receivedOf(it.productId) }} / {{ it.quantity }}</span>
        </li>
        <li v-if="!items.length" class="empty">暂无明细</li>
      </ul>
    </section>

    <!-- 入库流水（历史痕迹） -->
    <section class="block">
      <h4 class="block-title">入库流水（{{ inboundRecords.length }}）</h4>
      <table v-if="inboundRecords.length" class="item-table">
        <thead><tr><th>时间</th><th>商品名称</th><th class="num">数量</th><th>操作人</th></tr></thead>
        <tbody>
          <tr v-for="r in inboundRecords" :key="r.id">
            <td>{{ fmtTime(r.createdAt) }}</td>
            <td>{{ nameOf(r.productId) }}</td>
            <td class="num">+{{ r.quantity }}</td>
            <td>{{ operatorName(r.operatorId) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">尚未入库</div>
    </section>

    <!-- 付款记录 -->
    <section class="block">
      <h4 class="block-title">付款记录（{{ payments.length }}）</h4>
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
      <div v-else class="empty">尚未登记付款</div>
    </section>

<!-- 编辑模式：与销售单同一套做法 —— 电脑端内联在详情页里（普通卡片，与其它卡片同宽），
     手机端整屏覆盖；底部只留「取消 / 保存修改」，返回语义交给详情页的橘色「返回」键
     （编辑时它被 v-if 收起，模块一关就自动回来）。 -->
    <EditModePanel :model-value="showEdit" :saving="saving"
                   @cancel="closeEdit" @save="onSaveEdit">
      <section class="block">
        <div class="d-head">
          <h3 class="d-no">修改采购单</h3>
        </div>
        <div class="d-meta remark-row">
          <div class="rm-label"><i>备注</i></div>
          <div class="rm-input">
            <textarea
              v-model="editRemark"
              class="edit-remark-input"
              rows="2"
              placeholder="选填"
              @input="onRemarkInput"
            ></textarea>
          </div>
        </div>
      </section>

      <section class="block">
        <h4 class="block-title"><span class="bar"></span>商品明细（{{ editItems.length }}）</h4>
        <ul class="ec-list">
          <li v-for="(it, i) in editItems" :key="i" class="ec-item">
            <div class="ec-top">
              <span class="ec-idx">{{ i + 1 }}</span>
              <span class="ec-name">{{ productCache[it.productId]?.brand }} {{ productCache[it.productId]?.model }}</span>
              <span v-if="it.isGift" class="gift-badge">🎁 赠品</span>
              <b class="ec-amount">¥{{ money((it.quantity || 0) * (it.price || 0)) }}</b>
            </div>
            <div class="ec-row">
              <label class="ec-field">
                <i>数量</i>
                <input v-model.number="it.quantity" type="number" min="1" inputmode="numeric" class="ec-input" />
                <em>{{ unitOf(it.productId) }}</em>
              </label>
              <label class="ec-field">
                <i>单价</i>
                <input v-model.number="it.price" type="number" min="0" inputmode="decimal" class="ec-input" />
              </label>
            </div>
          </li>
          <li v-if="!editItems.length" class="empty">暂无明细</li>
        </ul>
        <div v-if="editItems.length" class="mc-total">
          <span>合计</span>
          <span class="mt-qty">{{ editItems.reduce((s, it) => s + (it.quantity || 0), 0) }} 件</span>
          <b class="mt-amount">¥{{ money(editItems.reduce((s, it) => s + (it.quantity || 0) * (it.price || 0), 0)) }}</b>
        </div>
      </section>
    </EditModePanel>

    <PageActions v-if="!showEdit" cancel-text="返回" @cancel="goBack" />

    <PrintPreview
      :visible="showPreview"
      :title="`采购单 ${order?.orderNo ?? ''}`"
      :order-data="printData"
      :allow-price-toggle="canSeePurchasePrice"
      v-model:show-price="showPrice"
      @cancel="showPreview = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useProductCache } from '../../composables/useProductCache'
import { useReloadOnActivate } from '../../composables/useReloadOnActivate'
import { useRoute, useRouter } from 'vue-router'
import { goBackOr } from '../../composables/useGoBack'
import { showConfirmDialog, showToast } from 'vant'
import { usePurchaseStore } from '../../stores/purchase'
import { useUserStore } from '../../stores/user'
import { useResponsive } from '../../composables/useResponsive'
import { usePermission } from '../../composables/usePermission'
import { db } from '../../db'
import { getCompanyName, type PrintOrderData } from '../../utils/printTemplate'
import PageActions from '../../components/PageActions.vue'
import PrintPreview from '../../components/PrintPreview.vue'
import ItemCards from '../../components/ui/ItemCards.vue'
import { useEditMode } from '../../composables/useEditMode'
import EditModePanel from '../../components/EditModePanel.vue'
import type { PurchaseOrder, PurchaseOrderItem, Supplier, Payment, Product, StockRecord, ItemCardRow } from '../../types'

const route = useRoute()
const router = useRouter()
const purchaseStore = usePurchaseStore()
const userStore = useUserStore()
const { isMobile } = useResponsive()
const { canSeePurchasePrice, canDeleteDoc } = usePermission()

const order = ref<PurchaseOrder | null>(null)
const items = ref<PurchaseOrderItem[]>([])
const supplier = ref<Supplier | null>(null)
const payments = ref<Payment[]>([])
const inboundRecords = ref<StockRecord[]>([])
const { cache: productCache, productName, productUnit } = useProductCache()
const productMap = ref<Record<number, Product>>({})
const receivedMap = ref<Record<number, number>>({})
const userMap = ref<Record<number, string>>({})
const showPrice = ref(true)
const showPreview = ref(false)

// 编辑功能：与销售单同一套（useEditMode 管状态与滚动，EditModePanel 管排版）
const { showEdit, saving, startEdit, closeEdit } = useEditMode({ scrollSelectorOnStart: '.edit-page' })
const editRemark = ref('')
const editItems = ref<Array<{ productId: number; quantity: number; price: number; isGift?: boolean }>>([])

/** 备注框随内容自增高度：文字超过两行时不再挤在固定高度里滚动 */
function autoGrowRemark(el: HTMLTextAreaElement | null): void {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.max(el.scrollHeight, 56)}px`
}
function onRemarkInput(e: Event): void {
  autoGrowRemark(e.target as HTMLTextAreaElement)
}

/** 点「修改」：先拷出可编辑副本，再进入编辑态 */
async function beginEdit(): Promise<void> {
  editItems.value = items.value.map(it => ({
    productId: it.productId,
    quantity: it.quantity,
    price: it.price,
    isGift: it.isGift
  }))
  editRemark.value = order.value?.remark || ''
  await startEdit()
  await nextTick()
  autoGrowRemark(document.querySelector<HTMLTextAreaElement>('.edit-remark-input'))
}

/** 点「保存修改」：成功后关闭模块（橘色「返回」键自动回来）并重新加载 */
async function onSaveEdit(): Promise<void> {
  if (!order.value) return
  saving.value = true
  try {
    const res = await purchaseStore.updateOrder(
      Number(route.params.id),
      editItems.value,
      editRemark.value
    )
    if (res.ok) {
      showToast('已保存')
      await closeEdit()
      await loadOrder()
    } else {
      showToast(res.message)
    }
  } finally {
    saving.value = false
  }
}

const colspan = computed(() => (canSeePurchasePrice.value ? 6 : 4))
const totalQty = computed(() => items.value.filter(it => !it.isGift).reduce((s, it) => s + it.quantity, 0))
const giftQty = computed(() => items.value.filter(it => it.isGift).reduce((s, it) => s + it.quantity, 0))

/** 手机端卡片行数据：把单据明细折算成 ItemCards 需要的统一形状 */
const cardRows = computed<ItemCardRow[]>(() =>
  items.value.map(it => ({
    name: nameOf(it.productId),
    unit: unitOf(it.productId),
    qty: it.quantity,
    price: it.price,
    amount: it.subtotal,
    tag: it.isGift ? '🎁 赠品' : undefined,
    note: it.isGift ? '赠品不计价' : undefined
  }))
)

/** 打印用原始数据：交给预览组件按纸张/表头设置实时排版 */
const printData = computed<PrintOrderData | null>(() => {
  const o = order.value
  if (!o) return null
  return {
    orderNo: o.orderNo,
    date: fmtDate(o.orderDate),
    partyName: supplier.value?.name ?? '',
    partyContact: supplier.value?.contact ?? '',
    partyPhone: supplier.value?.phone ?? '',
    partyAddress: supplier.value?.address ?? '',
    partyLabel: '供应商',
    items: items.value.map(it => ({
      productName: productCache.value[it.productId]?.brand ?? '',
      category: productCache.value[it.productId]?.category ?? '',
      model: productCache.value[it.productId]?.model ?? '',
      unit: unitOf(it.productId),
      quantity: it.quantity,
      price: it.price,
      subtotal: it.subtotal,
      isGift: it.isGift
    })),
    totalQuantity: totalQty.value,
    totalAmount: o.totalAmount,
    remark: o.remark,
    title: '采购单',
    companyName: getCompanyName()
  }
})

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(s: string): string {
  return s ? s.slice(0, 10) : '-'
}
function fmtTime(s: string): string {
  return s ? s.slice(0, 16).replace('T', ' ') : '-'
}
function nameOf(id: number): string {
  return productName(id)
}
function unitOf(id: number): string {
  return productUnit(id) || '-'
}
function operatorName(id: number): string {
  return userMap.value[id] ?? `#${id}`
}
function statusText(s: string): string {
  return { pending: '待入库', partial: '部分入库', completed: '已完成' }[s] || s || '-'
}
function payText(s: string): string {
  return { unpaid: '未付款', partial: '部分付款', paid: '已付款' }[s] || s || '-'
}
function receivedOf(productId: number): number {
  return receivedMap.value[productId] ?? 0
}
function percentOf(it: PurchaseOrderItem): number {
  if (!it.quantity) return 0
  return Math.min(100, Math.round((receivedOf(it.productId) / it.quantity) * 100))
}

function goBack(): void {
  goBackOr(router, '/purchase/orders')
}

/** 删除整张采购单：仅老板 / 系统管理员，且只能删「待入库」的单 */
const removing = ref(false)
async function handleRemove(): Promise<void> {
  if (!order.value?.id) return
  try {
    await showConfirmDialog({
      title: '删除采购单',
      message:
        `确定删除 ${order.value.orderNo}？\n删除后不可恢复，只能重新开单。` +
        `\n若本单由预采询价单转来，来源询价单会一并退回「未转」状态。`
    })
  } catch {
    return // 用户取消
  }
  removing.value = true
  try {
    const res = await purchaseStore.removeOrder(order.value.id, userStore.currentUser?.id ?? 0)
    if (!res.ok) {
      showToast(res.message)
      return
    }
    showToast(res.message)
    router.replace('/purchase/orders')
  } finally {
    removing.value = false
  }
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
  order.value = (await purchaseStore.getOrder(id)) ?? null
  if (!order.value) return
  items.value = await purchaseStore.getOrderItems(id)

  supplier.value = (await purchaseStore.listSuppliers()).find(s => s.id === order.value!.supplierId) ?? null
  payments.value = await db.payments.where('type').equals('pay').filter(p => p.refOrderId === id).toArray()

  const users = await db.users.toArray()
  const um: Record<number, string> = {}
  for (const u of users) um[u.id!] = u.name
  userMap.value = um

  // 商品信息
  // 用全局商品缓存，不用循环拉商品表了
  productMap.value = {}

  // 入库流水（历史痕迹），按时间倒序
  const records = await db.stockRecords.where('refOrderId').equals(id).toArray()
  const ins = records
    .filter(r => r.type === 'purchase_in')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  inboundRecords.value = ins

  const received: Record<number, number> = {}
  for (const r of ins) {
    received[r.productId] = (received[r.productId] ?? 0) + r.quantity
  }
  receivedMap.value = received
}

onMounted(loadOrder)

// 回到本页时自动刷新：路由组件被 App.vue 的 <keep-alive> 缓存，
// 从别的页面回来是「复活」而非「重新挂载」，onMounted 不会再跑，数据会停在旧状态。
useReloadOnActivate(loadOrder)
// 同一路由只换单据 id 时组件会被复用，必须监听 id 变化重新加载，避免显示上一张单据
watch(() => route.params.id, loadOrder)
</script>

<style scoped>
.detail-page { max-width: 1100px; margin: 0 auto; }
.gift-badge { display: inline-block; margin-left: 6px; font-size: 11px; color: var(--c-accent); background: #eaf1ff; border-radius: 4px; padding: 1px 6px; }
.gift-note { margin-left: 6px; font-size: 12px; font-weight: 400; color: var(--c-accent); }
.d-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.d-no { display: inline-block; font-size: 18px; color: var(--c-primary, #1a365d); margin: 0 8px 0 0; }
.d-badge { font-size: 12px; padding: 2px 10px; border-radius: 10px; background: var(--c-bg, #f1f5f9); color: var(--c-muted, #64748b); }
.d-badge.completed, .d-badge.paid { background: #e6f6ee; color: #16a34a; }
.d-badge.pending, .d-badge.unpaid { background: #fff4e5; color: #dd6b20; }
.d-actions { display: flex; align-items: center; gap: 12px; }
.btn { height: 40px; padding: 0 16px; border: none; border-radius: 10px; background: var(--c-accent, #2563eb); color: #fff; cursor: pointer; font-size: 14px; }
.d-meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 12px; font-size: 13px; color: var(--c-text, #1a202c); }
.d-meta i { display: inline-block; width: 62px; color: var(--c-muted, #64748b); font-style: normal; }

.item-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.item-table th, .item-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--c-border, #e2e8f0); }
.item-table th { background: #f1f5f9; color: var(--c-primary, #1a365d); }
.item-table .num { text-align: right; }
.item-table tfoot td { border-bottom: none; font-weight: 600; }
.total-label { text-align: right !important; }
/* 手机端商品明细卡片已收敛到 components/ui/ItemCards.vue（V2.1-1.3），
   本页不再自建卡片类 —— 避免各页各写一份、手机端反复撑破。 */

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

/* 手机端合计行通栏：统一由 src/styles/theme.css 的 .app-layout.is-mobile 钩子提供。
   页面里不要再写一份 —— scoped 副本特异性更高（(0,2,3)）会盖住全局，而它只声明
   display/width/margin，不管 padding/border/background，于是「只改全局不生效」。
   详见 theme.css 中「手机端：合计行通栏」那段 ⚠️ 注释。 */

/* 编辑模式：排版（电脑端内联 / 手机端整屏）与底部「取消 / 保存修改」按钮条
   统一由 <EditModePanel> 提供（与销售单同一套），这里不再写 .edit-page /
   .edit-footer / .btn-back 等规则 —— 留着会和组件样式打架。 */
.btn.primary { background: var(--c-accent, #2563eb); color: #fff; border: none; }
</style>
