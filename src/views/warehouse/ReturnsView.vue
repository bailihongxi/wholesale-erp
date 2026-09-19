<template>
  <div class="page">
    <div class="ui-seg">
      <button :class="{ active: tab === 'sale' }" type="button" @click="tab = 'sale'">销售退货</button>
      <button :class="{ active: tab === 'purchase' }" type="button" @click="tab = 'purchase'">采购退货</button>
      <button :class="{ active: tab === 'history' }" type="button" @click="tab = 'history'">
        退换货历史（{{ history.length }}）
      </button>
    </div>

    <!-- ============ 销售退货 / 采购退货 ============ -->
    <template v-if="tab === 'sale' || tab === 'purchase'">
      <section class="block">
        <h4 class="sec-title">
          {{ tab === 'sale' ? '选择销售单' : '选择采购单' }}
          <span class="sec-tip">退货将冲减对应单据的应收 / 应付，并自动调整所选库房的库存</span>
        </h4>
        <select v-model.number="selOrderId" class="ord-sel" @change="onOrderChange">
          <option :value="0">— 请选择{{ tab === 'sale' ? '销售单' : '采购单' }} —</option>
          <option v-for="o in orders" :key="o.id" :value="o.id">
            {{ o.orderNo }} · {{ partyNameOf(o) }} · ¥{{ o.totalAmount.toLocaleString() }}
          </option>
        </select>
        <label class="field-label">{{ tab === 'sale' ? '退回库房' : '退出库房' }}</label>
        <select v-model.number="locationId" class="ord-sel">
          <option v-for="l in locations" :key="l.id" :value="l.id">
            {{ l.name }}
          </option>
        </select>
        <textarea
          v-model="docRemark"
          class="remark-box"
          rows="2"
          maxlength="200"
          placeholder="整单退货说明（选填）：如整批质量问题、客户集体退换……"
        ></textarea>
      </section>

      <section class="block" v-if="lines.length">
        <h4 class="sec-title">
          {{ tab === 'sale' ? '销售退货' : '采购退货' }}明细
          <span class="sec-tip">填写每件商品的「退货数量」与原因；默认带出原单价</span>
        </h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>商品名称</th>
              <th class="num">原单数量</th>
              <th class="center" style="width:110px">退货数量</th>
              <th class="num" style="width:100px">单价</th>
              <th class="num" style="width:100px">行金额</th>
              <th>退货原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ln in lines" :key="ln.productId">
              <td>{{ ln.name }}</td>
              <td class="num">{{ ln.maxQty }}</td>
              <td class="center">
                <input
                  v-model.number="ln.qty"
                  type="number"
                  min="0"
                  :max="ln.maxQty"
                  class="mini-input"
                  :class="{ bad: ln.qty > ln.maxQty || ln.qty < 0 }"
                  aria-label="退货数量"
                />
              </td>
              <td class="num">¥{{ ln.price.toLocaleString() }}</td>
              <td class="num">{{ (ln.qty * ln.price).toLocaleString() }}</td>
              <td>
                <input v-model="ln.reason" class="reason-input" placeholder="原因选填" />
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" class="total-label">合计</td>
              <td class="num t-amt">¥{{ total.toLocaleString() }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </section>
      <div v-else-if="selOrderId" class="empty">该单据暂无明细</div>
      <div v-else class="empty">请先选择一张{{ tab === 'sale' ? '销售单' : '采购单' }}</div>

      <div class="actions" v-if="lines.length">
        <button class="btn ghost" type="button" @click="clearLines">清空</button>
        <button class="btn primary" type="button" :disabled="total <= 0" @click="submit">
          {{ tab === 'sale' ? '确认销售退货（库存回流 + 应收红冲）' : '确认采购退货（库存流出 + 应付红冲）' }}
        </button>
      </div>
    </template>

    <!-- ============ 退换货历史 ============ -->
    <template v-else>
      <table v-if="!isMobile" class="data-table order-table">
        <thead>
          <tr><th>退货单号</th><th>类型</th><th>来源单据</th><th>往来单位</th><th class="num">退货金额</th><th>时间</th><th>经手人</th><th>明细</th></tr>
        </thead>
        <tbody>
          <tr v-for="d in history" :key="d.orderNo">
            <td class="mono">{{ d.orderNo }}</td>
            <td><span class="badge" :class="d.kind">{{ d.kind === 'sale' ? '销售退货' : '采购退货' }}</span></td>
            <td class="mono">{{ d.refOrderNo }}</td>
            <td>{{ d.partyName }}</td>
            <td class="num">¥{{ d.totalAmount.toLocaleString() }}</td>
            <td>{{ d.date }}</td>
            <td>{{ d.operatorName }}</td>
            <td><button class="link-btn" type="button" @click="showDetail(d)">明细</button></td>
          </tr>
          <tr v-if="!history.length"><td colspan="8" class="empty">暂无退换货记录</td></tr>
        </tbody>
      </table>
      <ul v-else class="card-list">
        <li v-for="d in history" :key="d.orderNo" class="doc-card" @click="showDetail(d)">
          <div class="oc-head">
            <span class="oc-no">{{ d.orderNo }}</span>
            <span class="badge" :class="d.kind">{{ d.kind === 'sale' ? '销售退货' : '采购退货' }}</span>
          </div>
          <div class="oc-meta"><span>{{ d.refOrderNo }} · {{ d.partyName }}</span><span class="oc-date">{{ d.date }}</span></div>
          <div class="hs-sub">¥{{ d.totalAmount.toLocaleString() }} · {{ d.itemCount }} 个品种 · {{ d.operatorName }}</div>
        </li>
        <li v-if="!history.length" class="empty">暂无退换货记录</li>
      </ul>

      <div v-if="activeDetail" class="detail-pop">
        <div class="dp-head">
          <strong>{{ activeDetail.orderNo }}</strong>
          <span class="dp-sub">{{ activeDetail.kind === 'sale' ? '销售退货' : '采购退货' }} · 来源 {{ activeDetail.refOrderNo }} · {{ activeDetail.partyName }}</span>
          <span class="dp-sub">{{ activeDetail.date }} · {{ activeDetail.operatorName }}</span>
          <button class="link-btn" type="button" @click="activeDetail = null">关闭</button>
        </div>
        <table class="data-table">
          <thead><tr><th>商品</th><th class="num">退货数量</th><th class="num">单价</th><th class="num">金额</th><th>原因</th></tr></thead>
          <tbody>
            <tr v-for="(it, i) in activeDetail.items" :key="i">
              <td>{{ it.productName }}</td>
              <td class="num">{{ it.quantity }}</td>
              <td class="num">¥{{ it.price.toLocaleString() }}</td>
              <td class="num">¥{{ it.amount.toLocaleString() }}</td>
              <td>{{ it.reason || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { showToast } from 'vant'
import { useSalesStore } from '../../stores/sales'
import { usePurchaseStore } from '../../stores/purchase'
import { useReturnsStore, type ReturnLine, type ReturnRow } from '../../stores/returns'
import { useInventoryStore } from '../../stores/inventory'
import { useUserStore } from '../../stores/user'
import { useResponsive } from '../../composables/useResponsive'
import { db } from '../../db'
import type { SaleOrder, PurchaseOrder, Location } from '../../types'

const salesStore = useSalesStore()
const purchaseStore = usePurchaseStore()
const returnsStore = useReturnsStore()
const inventoryStore = useInventoryStore()
const userStore = useUserStore()
const { isMobile } = useResponsive()

const tab = ref<'sale' | 'purchase' | 'history'>('sale')
const saleOrders = ref<SaleOrder[]>([])
const purchaseOrders = ref<PurchaseOrder[]>([])
const customerMap = ref<Record<number, string>>({})
const supplierMap = ref<Record<number, string>>({})
const productNameMap = ref<Record<number, string>>({})
const selOrderId = ref(0)
const docRemark = ref('')
/** 退货收发库房（销售退货：货物退回此库房；采购退货：从此库房退回供应商） */
const locations = ref<Location[]>([])
const locationId = ref(0)
const lines = ref<Array<{ productId: number; name: string; maxQty: number; qty: number; price: number; reason: string }>>([])
const history = ref<ReturnRow[]>([])
const activeDetail = ref<ReturnRow | null>(null)

const orders = computed(() => (tab.value === 'sale' ? saleOrders.value : purchaseOrders.value))
const total = computed(() => lines.value.reduce((s, l) => s + (Number(l.qty) || 0) * l.price, 0))

function partyNameOf(o: SaleOrder | PurchaseOrder): string {
  return tab.value === 'sale'
    ? (customerMap.value[(o as SaleOrder).customerId] ?? `客户#${(o as SaleOrder).customerId}`)
    : (supplierMap.value[(o as PurchaseOrder).supplierId] ?? `供应商#${(o as PurchaseOrder).supplierId}`)
}

function nameOf(productId: number): string {
  return productNameMap.value[productId] ?? `商品#${productId}`
}

function toLines(items: Array<{ productId: number; quantity: number; price: number }>) {
  return items.map(it => ({
    productId: it.productId,
    name: nameOf(it.productId),
    maxQty: it.quantity,
    qty: 0,
    price: it.price,
    reason: ''
  }))
}

async function onOrderChange(): Promise<void> {
  lines.value = []
  docRemark.value = ''
  const id = selOrderId.value
  if (!id) return
  if (tab.value === 'sale') {
    lines.value = toLines(await salesStore.getOrderItems(id))
  } else {
    lines.value = toLines(await purchaseStore.getOrderItems(id))
  }
}

function clearLines(): void { lines.value = []; selOrderId.value = 0; docRemark.value = '' }

async function submit(): Promise<void> {
  if (total.value <= 0) { showToast('请填写退货数量'); return }
  const payload: ReturnLine[] = lines.value
    .filter(l => (Number(l.qty) || 0) > 0)
    .map(l => ({ productId: l.productId, quantity: Number(l.qty) || 0, price: l.price, reason: l.reason || undefined }))
  if (!payload.length) { showToast('请填写退货数量'); return }
  const operatorId = userStore.currentUser?.id ?? 1
  const res = tab.value === 'sale'
    ? await returnsStore.salesReturn({ refOrderId: selOrderId.value, items: payload, operatorId, remark: docRemark.value || undefined, locationId: locationId.value || undefined })
    : await returnsStore.purchaseReturn({ refOrderId: selOrderId.value, items: payload, operatorId, remark: docRemark.value || undefined, locationId: locationId.value || undefined })
  if (!res.ok) { showToast(res.message); return }
  showToast(`已生成${tab.value === 'sale' ? '销售退货单' : '采购退货单'} ${res.orderNo}`)
  clearLines()
  await loadHistory()
  activeDetail.value = null
  tab.value = 'history'
}

async function loadHistory(): Promise<void> { history.value = await returnsStore.listReturns() }
function showDetail(d: ReturnRow): void { activeDetail.value = d }

async function init(): Promise<void> {
  await inventoryStore.ensureLocations()
  locations.value = await inventoryStore.listLocations()
  if (!locationId.value || !locations.value.some(l => l.id === locationId.value)) {
    locationId.value = await inventoryStore.defaultLocationId()
  }
  saleOrders.value = await salesStore.listOrders()
  purchaseOrders.value = await purchaseStore.listOrders()
  const customers = await db.customers.toArray()
  const suppliers = await db.suppliers.toArray()
  customerMap.value = Object.fromEntries(customers.map(c => [c.id!, c.name]))
  supplierMap.value = Object.fromEntries(suppliers.map(s => [s.id!, s.name]))
  const products = await db.products.toArray()
  productNameMap.value = Object.fromEntries(
    products.map(p => [p.id!, `${p.brand ?? ''} ${p.model ?? ''}`.trim() || `商品#${p.id}`])
  )
  await loadHistory()
}

onMounted(init)
watch(tab, () => { activeDetail.value = null; if (tab.value === 'history') void loadHistory() })
</script>

<style scoped>
.page { max-width: 1100px; margin: 0 auto; }
.ord-sel { width: 100%; height: 44px; border: 1px solid var(--c-border); border-radius: 10px; padding: 0 12px; background: #fff; font-size: 14px; color: var(--c-text); margin-bottom: 10px; }
.field-label { display: block; font-size: 12px; color: var(--c-muted); margin-bottom: 6px; }
.remark-box { width: 100%; box-sizing: border-box; border: 1px solid var(--c-border); border-radius: 10px; padding: 10px 12px; font-size: 14px; line-height: 1.6; resize: vertical; color: var(--c-text); font-family: inherit; }
.remark-box:focus { outline: none; border-color: var(--c-accent); }
.mini-input { width: 84px; height: 32px; border: 1px solid var(--c-border); border-radius: 6px; padding: 0 8px; text-align: right; font-size: 14px; }
.mini-input.bad { border-color: var(--c-danger); color: var(--c-danger); }
.reason-input { width: 100%; height: 32px; border: 1px solid var(--c-border); border-radius: 6px; padding: 0 8px; font-size: 13px; box-sizing: border-box; }
.total-label { text-align: right; }
.t-amt { font-size: 18px; color: var(--c-text); }
.empty { text-align: center; color: var(--c-muted); padding: 20px; font-size: 13px; }
.actions { display: flex; gap: 10px; justify-content: flex-end; }
.btn { height: 44px; border-radius: 10px; font-size: 14px; cursor: pointer; padding: 0 24px; }
.btn.ghost { border: 1px solid var(--c-border); background: #fff; color: var(--c-muted); }
.btn.primary { border: none; background: var(--c-accent); color: #fff; }
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.link-btn { border: none; background: none; color: var(--c-accent); cursor: pointer; font-size: 13px; }
.order-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.order-table th, .order-table td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--c-border); font-size: 14px; }
.order-table th { background: #f1f5f9; color: var(--c-primary); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
.badge.sale { background: #ecfdf5; color: var(--c-success); }
.badge.purchase { background: #fff7ed; color: #ea580c; }
.card-list { border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 2px 10px rgba(26,54,93,0.06); list-style: none; }
.doc-card { padding: 14px 16px; border-bottom: 1px solid var(--c-border); cursor: pointer; }
.oc-head { display: flex; justify-content: space-between; align-items: center; }
.oc-no { font-weight: 600; color: var(--c-primary); }
.oc-meta { display: flex; justify-content: space-between; margin-top: 8px; font-size: 13px; color: var(--c-muted); }
.oc-date { font-size: 12px; }
.hs-sub { font-size: 12px; color: var(--c-muted); margin-top: 4px; }
.detail-pop { margin-top: 14px; background: #fff; border-radius: 12px; padding: 12px; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.dp-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.dp-sub { font-size: 12px; color: var(--c-muted); }
</style>
