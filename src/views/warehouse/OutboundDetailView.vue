<template>
  <div class="page">
    <h3 class="ct">
      出库拣货（发货单）
      <span class="tag tag-info">{{ orderNo }}</span>
    </h3>

    <!-- 单据头：发给谁、什么时候、多少钱、发到什么程度 -->
    <dl class="doc-head">
      <div class="dh-item">
        <dt>销售单号</dt>
        <dd class="mono">{{ orderNo }}</dd>
      </div>
      <div class="dh-item">
        <dt>客户</dt>
        <dd>{{ customerName || '—' }}</dd>
      </div>
      <div class="dh-item">
        <dt>开单日期</dt>
        <dd>{{ orderDate.slice(0, 10) || '—' }}</dd>
      </div>
      <div class="dh-item">
        <dt>单据金额</dt>
        <dd>¥{{ totalAmount.toLocaleString() }}</dd>
      </div>
      <div class="dh-item">
        <dt>发货进度</dt>
        <dd>
          <span class="tag" :class="progressClass">{{ statusText }}</span>
          <span class="dh-sub">{{ shippedTotal }} / {{ orderedTotal }} 件</span>
        </dd>
      </div>
    </dl>

    <!-- 出库库房：本次发货整单从哪个库房出 -->
    <section class="block">
      <h4 class="sec-title">
        出库库房
        <span class="sec-tip">本次发货全部从所选库房出库；「可用库存」显示的就是该库房的现有数量</span>
      </h4>
      <select v-model.number="locationId" class="ui-select loc-sel" @change="onLocationChange">
        <option v-for="l in locations" :key="l.id" :value="l.id">
          {{ l.name }}
        </option>
      </select>
    </section>

    <!-- 明细：应发 / 已发 / 待发 / 库存够不够 / 本次实发，合计在最下面一行 -->
    <section class="block">
      <h4 class="sec-title">
        拣货明细
        <span class="sec-tip">「可用库存」为「{{ locationName || '所选库房' }}」的数量，不足的行不能发足，请先补货或换库房</span>
      </h4>
      <div class="tb-scroll">
        <!-- items-edit：手机端卡片范式的契约类，列序见 <style> 末尾 @media -->
        <table class="data-table items-edit">
          <thead>
            <tr>
              <th class="center" style="width:48px">序号</th>
              <th>商品名称</th>
              <th class="center" style="width:56px">单位</th>
              <th class="num" style="width:88px">订购量</th>
              <th class="num" style="width:88px">已发</th>
              <th class="num" style="width:88px">待发</th>
              <th class="num" style="width:96px">{{ locationName || '可用库存' }}</th>
              <th class="num" style="width:110px">本次实发</th>
              <th class="center" style="width:80px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(it, i) in items" :key="it.productId" :class="{ 'is-warn': shortOf(it) < remainOf(it) }">
              <td class="center">{{ i + 1 }}</td>
              <td>{{ nameOf(it.productId) }}</td>
              <td class="center">{{ unitOf(it.productId) }}</td>
              <td class="num">{{ it.quantity }}</td>
              <td class="num">{{ shippedOf(it.productId) }}</td>
              <td class="num">
                <span :class="remainOf(it) > 0 ? 'stock-low' : 'stock-ok'">{{ remainOf(it) }}</span>
              </td>
              <td class="num">
                <span :class="shortOf(it) <= 0 ? 'stock-out' : 'stock-ok'">{{ shortOf(it) }}</span>
              </td>
              <td class="num">
                <input
                  v-model.number="outboundQty[it.productId]"
                  type="number"
                  min="0"
                  :max="Math.min(remainOf(it), shortOf(it))"
                  class="qty-input mini-input"
                  :class="{ bad: (outboundQty[it.productId] ?? 0) > Math.min(remainOf(it), shortOf(it)) }"
                  aria-label="本次实发数量"
                />
              </td>
              <td class="center">
                <button class="link-btn" type="button" @click="fillMax(it)">发足</button>
              </td>
            </tr>
            <tr v-if="!items.length">
              <td colspan="9" class="empty">无明细</td>
            </tr>
          </tbody>
          <tfoot v-if="items.length">
            <tr>
              <td colspan="3" class="total-label">合计</td>
              <td class="num">{{ orderedTotal }}</td>
              <td class="num">{{ shippedTotal }}</td>
              <td class="num">{{ remainTotal }}</td>
              <td class="num"></td>
              <td class="num">{{ thisTotal }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    <!-- 拣货备注：记录拣货异常、缺货等有效信息，随出库单保存 -->
    <section class="block">
      <h4 class="sec-title">
        拣货备注
        <span class="sec-tip">缺货、串色串码、客户特殊要求等有效信息，将随出库单留存</span>
      </h4>
      <textarea
        v-model="remark"
        class="remark-box"
        rows="3"
        maxlength="200"
        placeholder="例如：红色缺 1 件已改发蓝色 / 客户要求周五送达……"
      ></textarea>
    </section>

    <!-- 本单已经发过的批次（部分出库会拆成多张 CK 单，可逐张查看 / 撤回） -->
    <section class="block">
      <h4 class="sec-title">
        本单发货批次
        <span class="sec-tip">一次发货生成一张出库单，可单独查看、打印或撤回</span>
      </h4>
      <table v-if="batches.length" class="data-table">
        <thead>
          <tr>
            <th>出库单号</th>
            <th>发货时间</th>
            <th>出库库房</th>
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
            <td class="num stock-out">-{{ b.totalQty }}</td>
            <td>{{ b.operatorName }}</td>
            <td class="center">
              <span class="op-cell">
                <button class="link-btn" type="button" @click="openBatch(b.batchNo)">明细</button>
                <button class="link-btn danger" type="button" @click="revertBatch(b)">撤销</button>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">尚未发货</div>
    </section>

    <PageActions
      cancel-text="取消"
      confirm-text="确认出库"
      :loading="loading"
      :confirm-disabled="!items.length || thisTotal <= 0"
      @cancel="goBack"
      @confirm="handleOutbound"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useReloadOnActivate } from '../../composables/useReloadOnActivate'
import { clearAllListCaches } from '../../composables/useListCache'
import { useRoute, useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import { useSalesStore } from '../../stores/sales'
import { useProductStore } from '../../stores/product'
import { useStockDocStore, type StockDocRow } from '../../stores/stockDoc'
import { useUserStore } from '../../stores/user'
import { useInventoryStore } from '../../stores/inventory'
import { db } from '../../db'
import PageActions from '../../components/PageActions.vue'
import type { SaleOrderItem, Location } from '../../types'

const route = useRoute()
const router = useRouter()
const salesStore = useSalesStore()
const productStore = useProductStore()
const docStore = useStockDocStore()
const userStore = useUserStore()
const inventoryStore = useInventoryStore()

const orderNo = ref('')
const orderId = ref(0)
const orderDate = ref('')
const orderStatus = ref('')
const totalAmount = ref(0)
const customerName = ref('')
const items = ref<SaleOrderItem[]>([])
const nameMap = ref<Record<number, string>>({})
const unitMap = ref<Record<number, string>>({})
const stockMap = ref<Record<number, number>>({})
const shippedMap = ref<Record<number, number>>({})
const outboundQty = ref<Record<number, number>>({})
const batches = ref<StockDocRow[]>([])
const remark = ref('')
/** 本次出库的库房（单据级：整单从同一个库房出） */
const locations = ref<Location[]>([])
const locationId = ref(0)
const loading = ref(false)

/** 当前所选库房的名称（表头与提示里显示） */
const locationName = computed(() => locations.value.find(l => l.id === locationId.value)?.name ?? '')

function nameOf(id: number): string { return nameMap.value[id] ?? '未知商品' }
function unitOf(id: number): string { return unitMap.value[id] ?? '-' }
function stockOf(id: number): number { return stockMap.value[id] ?? 0 }
function shippedOf(id: number): number { return shippedMap.value[id] ?? 0 }
function remainOf(it: SaleOrderItem): number {
  return Math.max(0, it.quantity - shippedOf(it.productId))
}
/** 该商品在「所选库房」的可用库存（出库前必须确认该库房够不够） */
function shortOf(it: SaleOrderItem): number { return Math.max(0, stockOf(it.productId)) }
function fmtTime(s: string): string {
  return s ? s.slice(0, 16).replace('T', ' ') : '-'
}

const orderedTotal = computed(() => items.value.reduce((s, it) => s + it.quantity, 0))
const shippedTotal = computed(() => items.value.reduce((s, it) => s + shippedOf(it.productId), 0))
const remainTotal = computed(() => items.value.reduce((s, it) => s + remainOf(it), 0))
const thisTotal = computed(() =>
  items.value.reduce((s, it) => s + Math.min(Number(outboundQty.value[it.productId]) || 0, remainOf(it), shortOf(it)), 0)
)
const statusText = computed(() =>
  ({ pending: '待发货', partial: '部分发货', completed: '已发齐' }[orderStatus.value] ?? orderStatus.value)
)
const progressClass = computed(() =>
  orderStatus.value === 'completed' ? 'tag-ok' : orderStatus.value === 'partial' ? 'tag-warn' : 'tag-muted'
)

function fillMax(it: SaleOrderItem): void {
  outboundQty.value[it.productId] = Math.min(remainOf(it), shortOf(it))
}

function goBack(): void {
  router.back() }
function openBatch(no: string): void { router.push(`/warehouse/outbound/doc/${no}`) }

async function revertBatch(b: StockDocRow): Promise<void> {
  await showConfirmDialog({
    title: '撤回出库单',
    message: `撤回 ${b.batchNo} 后，该批 ${b.totalQty} 件会退回库存，销售单发货进度同步回退。`
  })
  const res = await docStore.revertDoc('out', b.batchNo, userStore.currentUser?.id ?? 1)
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
  const order = await salesStore.getOrder(oid)
  orderNo.value = order?.orderNo ?? ''
  orderDate.value = order?.orderDate ?? ''
  orderStatus.value = order?.status ?? ''
  totalAmount.value = order?.totalAmount ?? 0
  items.value = await salesStore.getOrderItems(oid)

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
  await loadLocationStock()

  if (order) {
    const customers = await salesStore.listCustomers()
    customerName.value = customers.find(c => c.id === order.customerId)?.name ?? ''
  }

  const records = await db.stockRecords.where('refOrderId').equals(oid).toArray()
  const shipped: Record<number, number> = {}
  for (const r of records.filter(x => x.type === 'sale_out')) {
    shipped[r.productId] = (shipped[r.productId] ?? 0) + Math.abs(r.quantity)
  }
  shippedMap.value = shipped

  const all = await docStore.listDocs('out')
  batches.value = all.filter(b => b.refOrderId === orderId.value)

  // 本次库房默认沿用上一批的库房（同一单连续发货通常从同一个库出）
  const latestBatchLoc = batches.value[0]?.locationId
  if (latestBatchLoc && locations.value.some(l => l.id === latestBatchLoc) && latestBatchLoc !== locationId.value) {
    locationId.value = latestBatchLoc
    await loadLocationStock()
  }

  fillAllDefault()
}

/** 拉取所选库房的库存分布（「可用库存」列显示的就是本库房的数量） */
async function loadLocationStock(): Promise<void> {
  if (!locationId.value) return
  // 先自愈：兼容「只写过总库存、没有库房分布」的老数据
  await inventoryStore.reconcileProducts(items.value.map(i => i.productId))
  stockMap.value = await inventoryStore.locationStockMap(locationId.value)
}

/** 「本次实发」默认带出「待发」与「本库房可用」的较小值 */
function fillAllDefault(): void {
  const qty: Record<number, number> = {}
  for (const it of items.value) qty[it.productId] = Math.min(remainOf(it), shortOf(it))
  outboundQty.value = qty
}

/** 换库房后按新库房的库存重算可发数量 */
async function onLocationChange(): Promise<void> {
  await loadLocationStock()
  fillAllDefault()
}

onMounted(loadOrder)

// 回到本页时自动刷新：路由组件被 App.vue 的 <keep-alive> 缓存，
// 从别的页面回来是「复活」而非「重新挂载」，onMounted 不会再跑，数据会停在旧状态。
useReloadOnActivate(loadOrder)
watch(() => route.params.id, loadOrder)

async function handleOutbound(): Promise<void> {
  if (loading.value) return
  if (thisTotal.value <= 0) { showToast('请填写本次实发数量'); return }
  loading.value = true
  const qtyMap: Record<number, number> = {}
  for (const it of items.value) {
    qtyMap[it.productId] = Math.min(Number(outboundQty.value[it.productId]) || 0, remainOf(it), shortOf(it))
  }
  const res = await salesStore.outbound(
    orderId.value, qtyMap, userStore.currentUser?.id ?? 1,
    remark.value.trim() || undefined,
    locationId.value || undefined
  )
  loading.value = false
  if (res.ok) {
    showToast(res.batchNo ? `已生成出库单 ${res.batchNo}` : '出库成功')
    // 清列表页 30 秒缓存：否则出库后待发货/出库历史最长 30 秒都是旧数据（同入库事故）
    clearAllListCaches()
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
/* 出库库房下拉 */
/* 库房下拉：外观走设计系统的 .ui-select，这里只约束宽度 */
.loc-sel { width: 100%; max-width: 320px; }
/* 操作列里的「明细 / 撤销」拉开间距 —— 间距口径统一在 theme.css 的 .op-cell */
.tb-scroll { overflow-x: auto; }
.mini-input {
  width: 84px; height: 32px; border: 1px solid var(--c-border); border-radius: 6px;
  padding: 0 8px; text-align: right; font-size: 14px;
}
.mini-input.bad { border-color: var(--c-danger); color: var(--c-danger); }
.total-label { text-align: right; }
.link-btn { border: none; background: none; color: var(--c-accent); cursor: pointer; font-size: 13px; }
.link-btn.danger { color: var(--c-danger); }
.empty { text-align: center; color: var(--c-muted); padding: 20px; font-size: 13px; }

/* 手机端合计行通栏：统一由 src/styles/theme.css 的 .app-layout.is-mobile 钩子提供。
   页面里不要再写一份 —— scoped 副本特异性更高（(0,2,3)）会盖住全局，而它只声明
   display/width/margin，不管 padding/border/background，于是「只改全局不生效」。
   详见 theme.css 中「手机端：合计行通栏」那段 ⚠️ 注释。 */

/* ── 手机端：拣货明细 → 卡片（V2.1-1.4，与采购/销售开单同一套范式） ──
   列序（thead）：1序号 2名称 3单位 4订购量 5已发 6待发 7可用库存 8本次实发 9操作
   ⚠️ 往明细里插列必须同步改这里的 nth-child 与 order。 */
@media (max-width: 767px) {
  .tb-scroll { overflow-x: visible; }
  .items-edit, .items-edit tbody { min-width: 0; }
  .items-edit thead { display: none; }
  .items-edit, .items-edit tbody, .items-edit tr, .items-edit td { display: block; width: 100%; }
  .items-edit tbody tr {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px;
    background: #f8fafc; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px;
  }
  /* 库存不足的行（is-warn）在卡片模式下也要看得出来 */
  .items-edit tbody tr.is-warn { background: #fff7ed; }
  .items-edit tbody td { padding: 2px 0; border: none; width: auto; }
  .items-edit tbody td:nth-child(1) { display: none; }                                   /* 序号 */
  .items-edit tbody td:nth-child(2) { width: 100%; font-size: 15px; font-weight: 600; order: 1; }
  .items-edit tbody td:nth-child(3) { order: 2; font-size: 12px; color: var(--c-muted); } /* 单位 */
  .items-edit tbody td:nth-child(4) { order: 3; font-size: 12px; color: var(--c-muted); } /* 订购 */
  .items-edit tbody td:nth-child(5) { order: 4; font-size: 12px; color: var(--c-muted); } /* 已发 */
  .items-edit tbody td:nth-child(6) { order: 5; font-size: 12px; color: var(--c-muted); } /* 待发 */
  .items-edit tbody td:nth-child(7) { order: 6; font-size: 12px; color: var(--c-muted); } /* 可用库存 */
  .items-edit tbody td:nth-child(8) { order: 7; margin-left: auto; }                      /* 本次实发 */
  .items-edit tbody td:nth-child(9) { order: 8; }                                         /* 操作 */
  .items-edit tbody td:nth-child(4)::before { content: '订购 '; }
  .items-edit tbody td:nth-child(5)::before { content: '已发 '; }
  .items-edit tbody td:nth-child(6)::before { content: '待发 '; }
  .items-edit tbody td:nth-child(7)::before { content: '库存 '; }
  .items-edit tbody td:nth-child(8)::before { content: '实发 '; }
  .items-edit tbody td::before { font-size: 12px; font-weight: 400; color: var(--c-muted); }
  .items-edit .mini-input { width: 64px; height: 30px; }
  .items-edit tbody td.empty { display: block; width: 100%; }
  .items-edit tfoot tr {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px;
    background: #fff; border-top: 2px solid var(--c-border); padding: 12px 4px 0;
  }
  .items-edit tfoot td { border: none; padding: 0; width: auto; font-size: 13px; }
  .items-edit tfoot td.total-label { text-align: left; font-weight: 700; }
  .items-edit tfoot td:nth-child(2)::before { content: '订购 '; }
  .items-edit tfoot td:nth-child(3)::before { content: '已发 '; }
  .items-edit tfoot td:nth-child(4)::before { content: '待发 '; }
  .items-edit tfoot td:nth-child(6)::before { content: '本次 '; }
  /* 第 5、7 格是占位空格，手机端藏掉免得出现孤零零的「库存」标签 */
  .items-edit tfoot td:nth-child(5), .items-edit tfoot td:nth-child(7) { display: none; }
  .items-edit tfoot td::before { font-size: 12px; color: var(--c-muted); }
}
</style>
