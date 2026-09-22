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
          <button v-if="order?.status === 'pending'" class="btn primary" type="button" @click="startEdit">✏️ 修改</button>
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

      <!-- 手机端：卡片式，数量 × 单价 = 金额 一行读清 -->
      <template v-if="isMobile">
        <ul class="mc-list">
          <li v-for="(it, i) in items" :key="i" class="mc-item">
            <div class="mc-top">
              <span class="mc-name">{{ nameOf(it.productId) }}</span>
              <span v-if="it.isGift" class="gift-badge">🎁 赠品</span>
            </div>
            <div class="mc-calc">
              <span class="mc-qty">{{ it.quantity }} {{ unitOf(it.productId) }}</span>
              <template v-if="canSeeAnyPrice">
                <template v-if="it.isGift">
                  <span class="mc-gift">赠品不计价</span>
                </template>
                <template v-else>
                  <span class="mc-op">×</span>
                  <span>¥{{ money(it.price) }}</span>
                  <span class="mc-op">=</span>
                  <b class="mc-amount">¥{{ money(it.subtotal) }}</b>
                </template>
              </template>
            </div>
          </li>
          <li v-if="!items.length" class="empty">暂无明细</li>
        </ul>
        <div v-if="items.length" class="mc-total">
          <span>合计<span v-if="giftQty" class="gift-note">（含赠品 {{ giftQty }} 件）</span></span>
          <span class="mt-qty">{{ totalQty }} 件</span>
          <b v-if="canSeeAnyPrice" class="mt-amount">¥{{ money(order?.totalAmount ?? 0) }}</b>
        </div>
      </template>

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
      <template v-if="isMobile">
        <ul v-if="outboundRecords.length" class="rc-list">
          <li v-for="r in outboundRecords" :key="r.id" class="rc-item">
            <div class="rc-top">
              <span class="rc-name">{{ nameOf(r.productId) }}</span>
              <span class="rc-qty">{{ Math.abs(r.quantity) }} {{ unitOf(r.productId) }}</span>
            </div>
            <div class="rc-sub">{{ fmtTime(r.createdAt) }} · {{ operatorName(r.operatorId) }}</div>
          </li>
        </ul>
        <div v-else class="empty">尚未出库</div>
      </template>
      <table v-else-if="outboundRecords.length" class="item-table">
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
      <template v-if="isMobile">
        <ul v-if="payments.length" class="rc-list">
          <li v-for="p in payments" :key="p.id" class="rc-item">
            <div class="rc-top">
              <span class="rc-name">{{ fmtDate(p.payDate) }}</span>
              <span class="rc-amount">¥{{ money(p.amount) }}</span>
            </div>
            <div class="rc-sub">{{ operatorName(p.operatorId) }}<template v-if="p.remark"> · {{ p.remark }}</template></div>
          </li>
        </ul>
        <div v-else class="empty">尚未登记收款</div>
      </template>
      <table v-else-if="payments.length" class="item-table">
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

    <!-- 编辑模式：页面级，跟新建页风格一致 -->
    <div v-if="showEdit" class="edit-page">
     <div class="edit-scroll">
      <!-- 单据头部卡片 -->
      <section class="block">
        <div class="d-head">
          <h3 class="d-no">修改销售单</h3>
        </div>
        <div class="d-meta">
          <div><i>备注</i></div>
          <div><input v-model="editRemark" class="edit-remark-input" placeholder="选填" /></div>
        </div>
      </section>

      <!-- 商品明细卡片 -->
      <section class="block">
        <h4 class="block-title"><span class="bar"></span>商品明细（{{ editItems.length }}）</h4>

        <!-- 手机端：卡片式，输入框带「数量 / 单价」标签，避免横向挤压与误填 -->
        <template v-if="isMobile">
          <ul class="ec-list">
            <li v-for="(it, i) in editItems" :key="i" class="ec-item">
              <div class="ec-top">
                <span class="ec-name">{{ productMap[it.productId]?.brand }} {{ productMap[it.productId]?.model }}</span>
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
        </template>

        <table v-else class="item-table">
          <thead>
            <tr>
              <th style="width:48px">#</th>
              <th style="width:35%">商品名称</th>
              <th style="width:10%" class="center">单位</th>
              <th style="width:15%" class="num">数量</th>
              <th style="width:20%" class="num">单价</th>
              <th style="width:20%" class="num">金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(it, i) in editItems" :key="i">
              <td>{{ i + 1 }}</td>
              <td>{{ productMap[it.productId]?.brand }} {{ productMap[it.productId]?.model }}</td>
              <td class="center">{{ unitOf(it.productId) }}</td>
              <td class="num"><input v-model.number="it.quantity" type="number" min="1" class="mini-input" /></td>
              <td class="num"><input v-model.number="it.price" type="number" min="0" class="mini-input" /></td>
              <td class="num">¥{{ money((it.quantity||0) * (it.price||0)) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" class="total-label">合计</td>
              <td class="num">{{ editItems.reduce((s, it) => s + (it.quantity||0), 0) }}</td>
              <td></td>
              <td class="num">¥{{ money(editItems.reduce((s, it) => s + (it.quantity||0) * (it.price||0), 0)) }}</td>
            </tr>
          </tfoot>
        </table>
      </section>
     </div>

      <div class="edit-footer">
        <button class="btn-back" type="button" @click="goBack">← 返回</button>
        <button class="btn-cancel" type="button" @click="showEdit = false">取消</button>
        <button class="btn-save" type="button" :disabled="saving" @click="saveEdit">{{ saving ? '保存中...' : '保存修改' }}</button>
      </div>
    </div>

    <PageActions v-if="!showEdit" cancel-text="返回" @cancel="goBack" />

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

// 编辑功能
const showEdit = ref(false)
const saving = ref(false)
const editRemark = ref('')
const editItems = ref<Array<{ productId: number; quantity: number; price: number; isGift?: boolean; note?: string }>>([])

function startEdit(): void {
  editItems.value = items.value.map(it => ({
    productId: it.productId,
    quantity: it.quantity,
    price: it.price,
    isGift: it.isGift,
    note: (it as any).note || ''
  }))
  editRemark.value = order.value?.remark || ''
  showEdit.value = true
}

async function saveEdit(): Promise<void> {
  if (!order.value) return
  saving.value = true
  try {
    const res = await salesStore.updateOrder(
      Number(route.params.id),
      editItems.value,
      editRemark.value
    )
    if (res.ok) {
      showToast('已保存')
      showEdit.value = false
      await loadOrder()
    } else {
      showToast(res.message)
    }
  } finally {
    saving.value = false
  }
}

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
/* ── 手机端卡片列表：商品明细 / 出库流水 / 收款记录 / 编辑明细 ──────────
   只在 isMobile 时渲染这套 DOM，桌面端表格结构完全不受影响。 */
.mc-list, .ec-list, .rc-list { list-style: none; margin: 0; padding: 0; }
.mc-item, .ec-item, .rc-item {
  padding: 10px 12px; margin-bottom: 8px;
  background: #f8fafc; border: 1px solid var(--c-border); border-radius: 10px;
}
.mc-item:last-child, .ec-item:last-child, .rc-item:last-child { margin-bottom: 0; }
.mc-top, .ec-top, .rc-top { display: flex; align-items: center; gap: 8px; }
.mc-name, .ec-name, .rc-name {
  flex: 1; min-width: 0; font-size: 15px; font-weight: 600;
  color: var(--c-primary); overflow-wrap: anywhere;
}
.mc-calc { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 13px; color: var(--c-muted); }
.mc-qty { font-weight: 600; color: var(--c-primary); }
.mc-op { color: var(--c-border-strong); }
.mc-amount { margin-left: auto; font-size: 15px; font-weight: 700; color: var(--c-primary); }
.mc-gift { color: var(--c-accent); }

/* 合计条：手机端没有表格 tfoot，用这条补上 */
.mc-total {
  display: flex; align-items: center; gap: 8px;
  margin-top: 10px; padding-top: 10px; font-size: 13px; color: var(--c-muted);
  border-top: 1px dashed var(--c-border);
}
.mc-total .mt-qty { font-weight: 600; color: var(--c-primary); }
.mc-total .mt-amount { margin-left: auto; font-size: 17px; font-weight: 700; color: var(--c-danger); }

/* 出库流水 / 收款记录 */
.rc-qty { flex: none; font-weight: 600; color: var(--c-primary); }
.rc-amount { flex: none; margin-left: auto; font-weight: 700; color: var(--c-danger); }
.rc-sub { margin-top: 4px; font-size: 12px; color: var(--c-muted); overflow-wrap: anywhere; }

/* 编辑明细：输入行（标签 + 输入框一体，触摸目标 ≥44px） */
.ec-amount { flex: none; font-size: 15px; font-weight: 700; color: var(--c-primary); }
.ec-row { display: flex; gap: 10px; margin-top: 10px; }
.ec-field {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px;
  height: 44px; padding: 0 10px;
  background: #fff; border: 1px solid var(--c-border-strong); border-radius: 8px;
}
.ec-field:focus-within { border-color: var(--c-accent); box-shadow: 0 0 0 2px var(--c-accent-soft); }
.ec-field i, .ec-field em { flex: none; font-style: normal; font-size: 12px; color: var(--c-muted); }
.ec-input {
  flex: 1; min-width: 0; height: 100%; border: none; outline: none; background: transparent;
  font-size: 15px; text-align: right; color: var(--c-primary);
}

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

  /* 商品明细 / 出库流水 / 收款记录在手机端直接走上面的卡片 DOM，
     表格只在桌面端渲染。若将来有表格漏加 isMobile 分支，这里兜底为
     横向滚动，绝不撑破屏幕（V2.0-18 起的方案）。 */
  .item-table { display: block; overflow-x: auto; }
}

/* 手机端合计行通栏：统一由 src/styles/theme.css 的 .app-layout.is-mobile 钩子提供。
   页面里不要再写一份 —— scoped 副本特异性更高（(0,2,3)）会盖住全局，而它只声明
   display/width/margin，不管 padding/border/background，于是「只改全局不生效」。
   详见 theme.css 中「手机端：合计行通栏」那段 ⚠️ 注释。 */

/* 编辑模式：与详情页正常状态风格统一 */
.edit-page { background: var(--c-bg, #f4f6fa); padding: 12px 0 90px; border: 4px solid var(--c-amber, #f97316); border-radius: 12px; }
.edit-page .block { background: #fff; border-radius: 12px; padding: 16px; margin: 12px; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.edit-page .block-title { font-size: 15px; color: var(--c-primary, #1a365d); margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px; }
.edit-page .block-title .bar { width: 3px; height: 16px; background: var(--c-accent, #2563eb); border-radius: 2px; }
.edit-page .d-no { font-size: 18px; color: var(--c-primary, #1a365d); margin: 0; }
.edit-page .d-meta { margin-top: 12px; font-size: 13px; display: grid; grid-template-columns: 62px 1fr; gap: 8px; align-items: center; }
.edit-page .d-meta i { display: inline-block; color: var(--c-muted, #64748b); font-style: normal; }
.edit-remark-input { height: 38px; border: 1px solid var(--c-border, #e2e8f0); border-radius: 8px; padding: 0 12px; font-size: 14px; width: 100%; outline: none; }
.edit-remark-input:focus { border-color: var(--c-accent, #2563eb); }
.edit-page .item-table { width: 100%; border-collapse: collapse; font-size: 14px; table-layout: fixed; }
.edit-page .item-table th, .edit-page .item-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--c-border, #e2e8f0); }
.edit-page .item-table th { background: #f1f5f9; color: var(--c-primary, #1a365d); }
.edit-page .item-table .num { text-align: right; }
.edit-page .item-table .center { text-align: center; }
.edit-page .item-table tfoot td { border-bottom: none; font-weight: 600; }
.edit-page .item-table .total-label { text-align: right !important; }
.edit-page .mini-input { width: 72px; height: 32px; border: 1px solid var(--c-border, #e2e8f0); border-radius: 6px; padding: 0 8px; text-align: right; font-size: 14px; }
.edit-footer { display: flex; gap: 12px; padding: 12px 20px; background: #fff; border-top: 1px solid #e8eaef; border-radius: 0 0 12px 12px; }
.edit-footer button { height: 46px; border-radius: 10px; font-size: 15px; font-weight: 600; border: none; cursor: pointer; }
.edit-footer .btn-back { flex: 1; background: var(--c-amber, #f97316); color: #fff; }
.edit-footer .btn-cancel { flex: 1; background: #ef4444; color: #fff; }
.edit-footer .btn-save { flex: 2; background: var(--c-accent, #2563eb); color: #fff; }
.edit-footer button:disabled { opacity: 0.55; cursor: not-allowed; }

/* 编辑模式手机端：整屏覆盖（点「修改」立即切换，不用往下翻找），
   内容区独立滚动，底部「返回 / 取消 / 保存」常驻。
   桌面端保持原样：详情页内联的橙色边框卡片区。 */
@media (max-width: 767px) {
  .edit-page {
    position: fixed; inset: 0; z-index: 90;
    display: flex; flex-direction: column;
    padding: 0; border: none; border-radius: 0;
    background: var(--c-bg); overflow: hidden;
  }
  .edit-page .edit-scroll {
    flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
    padding-bottom: 8px;
  }
  .edit-page .block { margin: 10px; padding: 14px; }
  .edit-page .block:first-child { margin-top: 12px; }
  .edit-page .d-meta { grid-template-columns: 62px 1fr; }
  .edit-page .item-table { display: block; overflow-x: auto; }
  .edit-page .edit-footer {
    flex: none; gap: 10px;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
    border-radius: 0; box-shadow: 0 -2px 12px rgba(22, 50, 92, 0.08);
  }
  .edit-page .edit-footer button { height: 48px; }
}
</style>
