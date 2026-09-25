<template>
  <div class="page">
    <h3 class="ct">
      入库验货（收货单）
      <span class="tag tag-info">{{ orderNo }}</span>
    </h3>

    <!-- 单据头：谁供货、什么时候订的、这单多少钱、收到什么程度 -->
    <dl class="doc-head">
      <div class="dh-item">
        <dt>采购单号</dt>
        <dd class="mono">{{ orderNo }}</dd>
      </div>
      <div class="dh-item">
        <dt>供应商</dt>
        <dd>{{ supplierName || '—' }}</dd>
      </div>
      <div class="dh-item">
        <dt>采购日期</dt>
        <dd>{{ orderDate.slice(0, 10) || '—' }}</dd>
      </div>
      <div class="dh-item">
        <dt>单据金额</dt>
        <dd>¥{{ totalAmount.toLocaleString() }}</dd>
      </div>
      <div class="dh-item">
        <dt>收货进度</dt>
        <dd>
          <span class="tag" :class="progressClass">{{ statusText }}</span>
          <span class="dh-sub">{{ receivedTotal }} / {{ orderedTotal }} 件</span>
        </dd>
      </div>
    </dl>

    <!-- 明细：应入 / 已收 / 待收 / 本次实收，合计在最下面一行 -->
    <section class="block">
      <h4 class="sec-title">
        验货明细
        <span class="sec-tip">「本次实收」默认带出待收数量，可按实际到货修改</span>
      </h4>
      <div class="tb-scroll">
        <!-- items-edit：手机端卡片范式的契约类，列序见 <style> 末尾 @media -->
        <table class="data-table items-edit">
          <thead>
            <tr>
              <th class="center" style="width:48px">序号</th>
              <th>商品名称</th>
              <th class="center" style="width:56px">单位</th>
              <th class="num" style="width:90px">订购量</th>
              <th class="num" style="width:90px">已收</th>
              <th class="num" style="width:90px">待收</th>
              <th class="num" style="width:110px">本次实收</th>
              <th class="center" style="width:80px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(it, i) in items" :key="it.productId">
              <td class="center">{{ i + 1 }}</td>
              <td>{{ nameOf(it.productId) }}</td>
              <td class="center">{{ unitOf(it.productId) }}</td>
              <td class="num">{{ it.quantity }}</td>
              <td class="num stock-ok">{{ receivedOf(it.productId) }}</td>
              <td class="num">
                <span :class="remainOf(it) > 0 ? 'stock-low' : 'stock-ok'">{{ remainOf(it) }}</span>
              </td>
              <td class="num">
                <input
                  v-model.number="inboundQty[it.productId]"
                  type="number"
                  min="0"
                  :max="remainOf(it)"
                  class="qty-input mini-input"
                  :class="{ bad: (inboundQty[it.productId] ?? 0) > remainOf(it) }"
                  aria-label="本次实收数量"
                />
              </td>
              <td class="center">
                <button class="link-btn" type="button" @click="fillAll(it)">收满</button>
              </td>
            </tr>
            <tr v-if="!items.length">
              <td colspan="8" class="empty">无明细</td>
            </tr>
          </tbody>
          <tfoot v-if="items.length">
            <tr>
              <td colspan="3" class="total-label">合计</td>
              <td class="num">{{ orderedTotal }}</td>
              <td class="num stock-ok">{{ receivedTotal }}</td>
              <td class="num stock-low">{{ remainTotal }}</td>
              <td class="num">{{ thisTotal }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    <!-- 入库库房：本次收货整单进哪个库房 -->
    <section class="block">
      <h4 class="sec-title">
        入库库房
        <span class="sec-tip">本次收货的货物全部进入所选库房；下次收货可换另一个库房，各自记各自的数量</span>
      </h4>
      <select v-model.number="locationId" class="ui-select loc-sel">
        <option v-for="l in locations" :key="l.id" :value="l.id">
          {{ l.name }}
        </option>
      </select>
    </section>

    <!-- 验收备注：记录到货异常、破损等有效信息，随入库单保存 -->
    <section class="block">
      <h4 class="sec-title">
        验收备注
        <span class="sec-tip">到货异常、外箱破损、数量不符等有效信息，将随入库单留存</span>
      </h4>
      <textarea
        v-model="remark"
        class="remark-box"
        rows="3"
        maxlength="200"
        placeholder="例如：外箱破损 2 台已拒收 / 型号与订单不符，已拍照留证……"
      ></textarea>
    </section>

    <!-- 本单已经收过的批次（部分入库会拆成多张 RK 单，可逐张查看 / 撤回） -->
    <section class="block">
      <h4 class="sec-title">
        本单收货批次
        <span class="sec-tip">一次收货生成一张入库单，可单独查看、打印或撤回</span>
      </h4>
      <table v-if="batches.length" class="data-table">
        <thead>
          <tr>
            <th>入库单号</th>
            <th>收货时间</th>
            <th>入库库房</th>
            <th class="num">件数</th>
            <th>经手人</th>
            <th class="center">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in batches" :key="b.batchNo">
            <td class="mono">{{ b.batchNo }}</td>
            <td>{{ fmtTime(b.createdAt) }}</td>
            <td>{{ b.locationName || '—' }}</td>
            <td class="num stock-ok">+{{ b.totalQty }}</td>
            <td>{{ b.operatorName }}</td>
            <td class="center">
              <span class="op-cell">
                <button class="link-btn" type="button" @click="openBatch(b.batchNo)">明细</button>
                <button class="link-btn danger" type="button" @click="revertBatch(b)">撤回</button>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">尚未收货</div>
    </section>

    <PageActions
      cancel-text="取消"
      confirm-text="确认入库"
      :loading="loading"
      :confirm-disabled="!items.length || thisTotal <= 0"
      @cancel="goBack"
      @confirm="handleInbound"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useReloadOnActivate } from '../../composables/useReloadOnActivate'
import { useRoute, useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import { usePurchaseStore } from '../../stores/purchase'
import { useProductStore } from '../../stores/product'
import { useStockDocStore, type StockDocRow } from '../../stores/stockDoc'
import { useUserStore } from '../../stores/user'
import { useInventoryStore } from '../../stores/inventory'
import { db } from '../../db'
import PageActions from '../../components/PageActions.vue'
import type { PurchaseOrderItem, Location } from '../../types'

const route = useRoute()
const router = useRouter()
const purchaseStore = usePurchaseStore()
const productStore = useProductStore()
const docStore = useStockDocStore()
const userStore = useUserStore()
const inventoryStore = useInventoryStore()

const orderNo = ref('')
const orderId = ref(0)
const orderDate = ref('')
const orderStatus = ref('')
const totalAmount = ref(0)
const supplierName = ref('')
const items = ref<PurchaseOrderItem[]>([])
const nameMap = ref<Record<number, string>>({})
const unitMap = ref<Record<number, string>>({})
const receivedMap = ref<Record<number, number>>({})
const inboundQty = ref<Record<number, number>>({})
const batches = ref<StockDocRow[]>([])
const remark = ref('')
/** 本次入库的目标库房（单据级：整单进同一个库房） */
const locations = ref<Location[]>([])
const locationId = ref(0)
const loading = ref(false)

function nameOf(id: number): string { return nameMap.value[id] ?? '未知商品' }
function unitOf(id: number): string { return unitMap.value[id] ?? '-' }
function receivedOf(id: number): number { return receivedMap.value[id] ?? 0 }
function remainOf(it: PurchaseOrderItem): number {
  return Math.max(0, it.quantity - receivedOf(it.productId))
}
function fmtTime(s: string): string {
  return s ? s.slice(0, 16).replace('T', ' ') : '-'
}

const orderedTotal = computed(() => items.value.reduce((s, it) => s + it.quantity, 0))
const receivedTotal = computed(() => items.value.reduce((s, it) => s + receivedOf(it.productId), 0))
const remainTotal = computed(() => items.value.reduce((s, it) => s + remainOf(it), 0))
const thisTotal = computed(() =>
  items.value.reduce((s, it) => s + Math.min(Number(inboundQty.value[it.productId]) || 0, remainOf(it)), 0)
)
const statusText = computed(() =>
  ({ pending: '待收货', partial: '部分收货', completed: '已收齐' }[orderStatus.value] ?? orderStatus.value)
)
const progressClass = computed(() =>
  orderStatus.value === 'completed' ? 'tag-ok' : orderStatus.value === 'partial' ? 'tag-warn' : 'tag-muted'
)

function fillAll(it: PurchaseOrderItem): void {
  inboundQty.value[it.productId] = remainOf(it)
}

function goBack(): void {
  router.back() }
function openBatch(no: string): void { router.push(`/warehouse/inbound/doc/${no}`) }

async function revertBatch(b: StockDocRow): Promise<void> {
  await showConfirmDialog({
    title: '撤回入库单',
    message: `撤回 ${b.batchNo} 后，该批 ${b.totalQty} 件会退回库存，采购单收货进度同步回退。`
  })
  const res = await docStore.revertDoc('in', b.batchNo, userStore.currentUser?.id ?? 1)
  showToast(res.message)
  await loadOrder()
}

async function loadOrder(): Promise<void> {
  // 库房列表（可自行设定）与默认库房：与单据无关，先加载
  await inventoryStore.ensureLocations()
  locations.value = await inventoryStore.listLocations()
  if (!locationId.value || !locations.value.some(l => l.id === locationId.value)) {
    locationId.value = await inventoryStore.defaultLocationId()
  }

  const oid = Number(route.params.id)
  orderId.value = oid
  // 路由缺少合法 id（例如从详情跳回列表、或路由切换瞬间）时直接退出，
  // 避免对 IndexedDB 执行 .get(NaN)/.where().equals(NaN) 触发未处理异常。
  if (!Number.isFinite(oid)) return
  const order = await purchaseStore.getOrder(oid)
  orderNo.value = order?.orderNo ?? ''
  orderDate.value = order?.orderDate ?? ''
  orderStatus.value = order?.status ?? ''
  totalAmount.value = order?.totalAmount ?? 0
  items.value = await purchaseStore.getOrderItems(oid)

  // 只查这张单真正用到的商品：旧实现 search('') 会把 6281 条商品全拉进来，
  // 而单据明细通常只有几行，属于白搬 6000+ 行数据。
  const pids = [...new Set(items.value.map(it => it.productId))]
  const products = await db.products.bulkGet(pids)
  const nm: Record<number, string> = {}
  const um: Record<number, string> = {}
  for (const p of products) {
    if (!p?.id) continue
    nm[p.id] = productStore.productName(p)
    um[p.id] = p.unit
  }
  nameMap.value = nm
  unitMap.value = um

  if (order) {
    const suppliers = await purchaseStore.listSuppliers()
    supplierName.value = suppliers.find(s => s.id === order.supplierId)?.name ?? ''
  }

  // 已收数量仍以流水为准
  const records = await db.stockRecords.where('refOrderId').equals(oid).toArray()
  const received: Record<number, number> = {}
  for (const r of records.filter(x => x.type === 'purchase_in')) {
    received[r.productId] = (received[r.productId] ?? 0) + Math.abs(r.quantity)
  }
  receivedMap.value = received

  // 已生成的入库单批次
  const all = await docStore.listDocs('in')
  batches.value = all.filter(b => b.refOrderId === orderId.value)

  // 本次库房默认沿用上一批的库房（同一单连续收货通常进同一个库）
  const latestBatchLoc = batches.value[0]?.locationId
  if (latestBatchLoc && locations.value.some(l => l.id === latestBatchLoc)) {
    locationId.value = latestBatchLoc
  }

  const qty: Record<number, number> = {}
  for (const it of items.value) qty[it.productId] = remainOf(it)
  inboundQty.value = qty
}

onMounted(loadOrder)

// 回到本页时自动刷新：路由组件被 App.vue 的 <keep-alive> 缓存，
// 从别的页面回来是「复活」而非「重新挂载」，onMounted 不会再跑，数据会停在旧状态。
useReloadOnActivate(loadOrder)
// 同一路由只换单据 id 时组件会被复用，必须监听 id 变化重新加载
watch(() => route.params.id, loadOrder)

async function handleInbound(): Promise<void> {
  if (loading.value) return
  if (thisTotal.value <= 0) { showToast('请填写本次实收数量'); return }
  loading.value = true
  const qtyMap: Record<number, number> = {}
  for (const it of items.value) {
    qtyMap[it.productId] = Math.min(Number(inboundQty.value[it.productId]) || 0, remainOf(it))
  }
  const res = await purchaseStore.inbound(
    orderId.value, qtyMap, userStore.currentUser?.id ?? 1,
    remark.value.trim() || undefined,
    locationId.value || undefined
  )
  loading.value = false
  if (res.ok) {
    showToast(res.batchNo ? `已生成入库单 ${res.batchNo}` : '入库成功')
    await loadOrder()
  } else {
    showToast(res.message)
  }
}
</script>

<style scoped>
.page { max-width: 900px; margin: 0 auto; }
.ct { display: flex; align-items: center; gap: 8px; font-size: 16px; color: var(--c-primary); margin-bottom: 12px; }
.doc-head {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;
  background: #fff; border-radius: 12px; padding: 14px; margin-bottom: 12px;
  box-shadow: 0 2px 10px rgba(26,54,93,0.06);
}
.dh-item dt { font-size: 12px; color: var(--c-muted); margin-bottom: 4px; }
.dh-item dd { font-size: 14px; color: var(--c-text); font-weight: 600; }
.dh-sub { font-weight: 400; font-size: 12px; color: var(--c-muted); margin-left: 6px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.remark-box {
  width: 100%; box-sizing: border-box; border: 1px solid var(--c-border); border-radius: 10px;
  padding: 10px 12px; font-size: 14px; line-height: 1.6; resize: vertical; color: var(--c-text);
  font-family: inherit;
}
.remark-box:focus { outline: none; border-color: var(--c-accent); }
/* 入库库房下拉 */
/* 库房下拉：外观走设计系统的 .ui-select，这里只约束宽度 */
.loc-sel { width: 100%; max-width: 320px; }
/* 操作列里的「明细 / 撤回」拉开间距 —— 间距口径统一在 theme.css 的 .op-cell */
.tb-scroll { overflow-x: auto; }
.mini-input {
  width: 84px; height: 32px; border: 1px solid var(--c-border); border-radius: 6px;
  padding: 0 8px; text-align: right; font-size: 14px;
}
.mini-input.bad { border-color: var(--c-danger); color: var(--c-danger); }
.total-label { text-align: left; padding-left: 48px; font-size: 16px; font-weight: 700; }
.data-table tfoot td { font-size: 16px; font-weight: 700; }
.data-table tfoot td.stock-ok { color: var(--c-success) !important; }
.data-table tfoot td.stock-low { color: var(--c-warning) !important; }
.link-btn { border: none; background: none; color: var(--c-accent); cursor: pointer; font-size: 13px; }
.link-btn.danger { color: var(--c-danger); }
.empty { text-align: center; color: var(--c-muted); padding: 20px; font-size: 13px; }

/* 手机端合计行通栏：统一由 src/styles/theme.css 的 .app-layout.is-mobile 钩子提供。
   页面里不要再写一份 —— scoped 副本特异性更高（(0,2,3)）会盖住全局，而它只声明
   display/width/margin，不管 padding/border/background，于是「只改全局不生效」。
   详见 theme.css 中「手机端：合计行通栏」那段 ⚠️ 注释。 */

/* ── 手机端：验货明细 → 卡片（V2.1-1.4，与采购/销售开单同一套范式） ──
   列序（thead）：1序号 2名称 3单位 4订购量 5已收 6待收 7本次实收 8操作
   ⚠️ 往明细里插列必须同步改这里的 nth-child 与 order。 */
@media (max-width: 767px) {
  /* 卡片模式下不再需要「表格最小宽 + 横向滚动」，否则卡片被撑得比屏幕还宽 */
  .tb-scroll { overflow-x: visible; }
  .items-edit, .items-edit tbody { min-width: 0; }
  .items-edit thead { display: none; }
  .items-edit, .items-edit tbody, .items-edit tr, .items-edit td { display: block; width: 100%; }
  .items-edit tbody tr {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px;
    background: #f8fafc; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px;
  }
  .items-edit tbody td { padding: 2px 0; border: none; width: auto; }
  .items-edit tbody td:nth-child(1) { display: none; }                                   /* 序号 */
  .items-edit tbody td:nth-child(2) { width: 100%; font-size: 15px; font-weight: 600; order: 1; }
  .items-edit tbody td:nth-child(3) { order: 2; font-size: 12px; color: var(--c-muted); } /* 单位 */
  .items-edit tbody td:nth-child(4) { order: 3; font-size: 12px; color: var(--c-muted); } /* 订购 */
  .items-edit tbody td:nth-child(5) { order: 4; font-size: 12px; color: var(--c-muted); } /* 已收 */
  .items-edit tbody td:nth-child(6) { order: 5; font-size: 12px; color: var(--c-muted); } /* 待收 */
  .items-edit tbody td:nth-child(7) { order: 6; margin-left: auto; }                      /* 本次实收 */
  .items-edit tbody td:nth-child(8) { order: 7; }                                         /* 操作 */
  .items-edit tbody td:nth-child(4)::before { content: '订购 '; }
  .items-edit tbody td:nth-child(5)::before { content: '已收 '; }
  .items-edit tbody td:nth-child(6)::before { content: '待收 '; }
  .items-edit tbody td:nth-child(7)::before { content: '实收 '; }
  .items-edit tbody td::before { font-size: 12px; font-weight: 400; color: var(--c-muted); }
  .items-edit .mini-input { width: 64px; height: 30px; }
  /* ⚠️ 空态那行只有一个 td（colspan）→ 会被 nth-child(1) 的 display:none 一起隐藏，必须显式放回 */
  .items-edit tbody td.empty { display: block; width: 100%; }
  /* 合计行通栏：每格补标签，否则一列数字分不清 */
  .items-edit tfoot tr {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px;
    background: #fff; border-top: 2px solid var(--c-border); padding: 12px 4px 0;
  }
  .items-edit tfoot td { border: none; padding: 0; width: auto; font-size: 13px; }
  .items-edit tfoot td.total-label { text-align: left; font-weight: 700; }
  .items-edit tfoot td:nth-child(2)::before { content: '订购 '; }
  .items-edit tfoot td:nth-child(3)::before { content: '已收 '; }
  .items-edit tfoot td:nth-child(4)::before { content: '待收 '; }
  .items-edit tfoot td:nth-child(5)::before { content: '本次 '; }
  .items-edit tfoot td::before { font-size: 12px; color: var(--c-muted); }
}
</style>
