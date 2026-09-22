<template>
  <div class="page">
    <SegmentedTabs v-model="tab" size="sm" :options="tabOptions" />

    <!-- ============ 新建调拨 ============ -->
    <template v-if="tab === 'create'">
      <section class="block">
        <h4 class="sec-title">调拨方向</h4>
        <div class="loc-row">
          <label class="loc-field">
            <span class="lf-label">调出库位</span>
            <select v-model.number="fromLoc" class="ui-select loc-sel" @change="reloadMaps">
              <option v-for="l in locations" :key="l.id" :value="l.id">{{ l.name }}</option>
            </select>
          </label>
          <span class="loc-arrow">➜</span>
          <label class="loc-field">
            <span class="lf-label">调入库位</span>
            <select v-model.number="toLoc" class="ui-select loc-sel" @change="reloadMaps">
              <option v-for="l in locations" :key="l.id" :value="l.id">{{ l.name }}</option>
            </select>
          </label>
        </div>
        <p v-if="fromLoc === toLoc" class="warn-line">调出与调入库位不能相同</p>
      </section>

      <ProductPicker
        :rows="pickerRows"
        :selected="selectedMap"
        :title="`选择要调拨的商品（${fromName}库存）`"
        :show-price="false"
        @pick="onPick"
      />

      <section class="block">
        <h4 class="sec-title">
          调拨明细
          <span class="sec-tip">默认带出来源库位库存，按实际调拨数量修改</span>
        </h4>
        <table v-if="lines.length" class="data-table">
          <thead>
            <tr>
              <th>商品名称</th>
              <th class="num">{{ fromName }}库存</th>
              <th class="num">{{ toName }}库存</th>
              <th class="num" style="width:120px">调拨数量</th>
              <th class="center" style="width:80px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ln in lines" :key="ln.productId">
              <td>{{ ln.name }}</td>
              <td class="num">{{ ln.fromStock }}</td>
              <td class="num">{{ ln.toStock }}</td>
              <td class="num">
                <input
                  v-model.number="ln.qty"
                  type="number"
                  min="0"
                  :max="ln.fromStock"
                  class="mini-input"
                  :class="{ bad: ln.qty > ln.fromStock || ln.qty < 0 }"
                  aria-label="调拨数量"
                />
              </td>
              <td class="center">
                <button class="link-btn danger" type="button" @click="removeLine(ln.productId)">移除</button>
              </td>
            </tr>
          </tbody>
          <tfoot v-if="lines.length">
            <tr>
              <td colspan="3" class="total-label">合计</td>
              <td class="num t-qty">{{ totalQty }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div v-else class="empty">尚未选择商品，请在上方商品列表中点击「＋ 添加」</div>
      </section>

      <div class="actions">
        <button class="btn ghost" type="button" @click="clearLines">清空</button>
        <button class="btn primary" type="button" :disabled="!canSubmit" @click="submit">确认调拨</button>
      </div>
    </template>

    <!-- ============ 调拨历史 ============ -->
    <template v-else>
      <ul v-if="isMobile" class="card-list zebra-list">
        <li v-for="d in history" :key="d.orderNo" class="doc-card">
          <div class="oc-head">
            <span class="oc-no">{{ d.orderNo }}</span>
            <span class="hs-qty">{{ d.totalQty }} 件</span>
          </div>
          <div class="oc-meta">
            <span>{{ d.fromName }} ➜ {{ d.toName }}</span>
            <span class="oc-date">{{ d.date }}</span>
          </div>
          <div class="hs-sub">{{ d.itemCount }} 个品种 · {{ d.operatorName }}</div>
        </li>
        <li v-if="!history.length" class="empty">暂无调拨记录</li>
      </ul>
      <table v-else class="data-table order-table">
        <thead>
          <tr>
            <th>调拨单号</th><th>调出→调入</th><th class="num">件数</th>
            <th>时间</th><th>经手人</th><th>明细</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in history" :key="d.orderNo">
            <td class="mono">{{ d.orderNo }}</td>
            <td>{{ d.fromName }} ➜ {{ d.toName }}</td>
            <td class="num stock-ok">+{{ d.totalQty }}</td>
            <td>{{ d.date }}</td>
            <td>{{ d.operatorName }}</td>
            <td>
              <button class="link-btn" type="button" @click="showDetail(d)">明细</button>
            </td>
          </tr>
          <tr v-if="!history.length"><td colspan="6" class="empty">暂无调拨记录</td></tr>
        </tbody>
      </table>

      <div v-if="activeDetail" class="detail-pop">
        <div class="dp-head">
          <strong>{{ activeDetail.orderNo }}</strong>
          <span class="dp-sub">{{ activeDetail.fromName }} ➜ {{ activeDetail.toName }} · {{ activeDetail.date }} · {{ activeDetail.operatorName }}</span>
          <button class="link-btn" type="button" @click="activeDetail = null">关闭</button>
        </div>
        <table class="data-table">
          <thead><tr><th>商品名称</th><th class="num">数量</th></tr></thead>
          <tbody>
            <tr v-for="it in activeDetail.items" :key="it.productName">
              <td>{{ it.productName }}</td>
              <td class="num">{{ it.quantity }}</td>
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
import { useProductStore } from '../../stores/product'
import { useInventoryStore, type TransferRow } from '../../stores/inventory'
import { useUserStore } from '../../stores/user'
import { useResponsive } from '../../composables/useResponsive'
import ProductPicker, { type PickerRow } from '../../components/ProductPicker.vue'
import SegmentedTabs from '../../components/ui/SegmentedTabs.vue'
import type { Product } from '../../types'

const productStore = useProductStore()
const inv = useInventoryStore()
const userStore = useUserStore()
const { isMobile } = useResponsive()

const tab = ref<'create' | 'history'>('create')
const locations = ref<Array<{ id?: number; name: string }>>([])
const fromLoc = ref(1)
const toLoc = ref(2)
const fromMap = ref<Record<number, number>>({})
const toMap = ref<Record<number, number>>({})
const products = ref<Product[]>([])
const lines = ref<Array<{ productId: number; name: string; unit: string; fromStock: number; toStock: number; qty: number }>>([])
const history = ref<TransferRow[]>([])

/** 页内 Tab 选项 */
const tabOptions = computed(() => [
  { value: 'create', label: '新建调拨' },
  { value: 'history', label: `调拨历史（${history.value.length}）` }
])
const activeDetail = ref<TransferRow | null>(null)

const fromName = computed(() => locations.value.find(l => l.id === fromLoc.value)?.name ?? '来源')
const toName = computed(() => locations.value.find(l => l.id === toLoc.value)?.name ?? '目标')
const totalQty = computed(() => lines.value.reduce((s, l) => s + (Number(l.qty) || 0), 0))
const selectedMap = computed<Record<number, number>>(() => {
  const m: Record<number, number> = {}
  for (const l of lines.value) m[l.productId] = 1
  return m
})
const canSubmit = computed(() => fromLoc.value !== toLoc.value && totalQty.value > 0)
const pickerRows = computed<PickerRow[]>(() =>
  products.value.map(p => ({ product: p, stock: fromMap.value[p.id!] ?? 0 }))
)

async function reloadMaps(): Promise<void> {
  fromMap.value = await inv.locationStockMap(fromLoc.value)
  toMap.value = await inv.locationStockMap(toLoc.value)
  for (const l of lines.value) {
    l.fromStock = fromMap.value[l.productId] ?? 0
    l.toStock = toMap.value[l.productId] ?? 0
  }
}

function onPick(p: Product): void {
  if (lines.value.some(l => l.productId === p.id)) return
  const from = fromMap.value[p.id!] ?? 0
  lines.value.push({
    productId: p.id!,
    name: `${p.brand} ${p.model}`.trim(),
    unit: p.unit,
    fromStock: from,
    toStock: toMap.value[p.id!] ?? 0,
    qty: from > 0 ? 1 : 0
  })
}
function removeLine(id: number): void {
  lines.value = lines.value.filter(l => l.productId !== id)
}
function clearLines(): void { lines.value = [] }

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  const qtyMap: Record<number, number> = {}
  for (const l of lines.value) qtyMap[l.productId] = Number(l.qty) || 0
  const res = await inv.transfer(fromLoc.value, toLoc.value, qtyMap, userStore.currentUser?.id ?? 1)
  if (!res.ok) { showToast(res.message); return }
  showToast(`已生成调拨单 ${res.orderNo}`)
  lines.value = []
  await reloadMaps()
  await loadHistory()
  tab.value = 'history'
}

async function loadHistory(): Promise<void> {
  history.value = await inv.listTransfers()
}
function showDetail(d: TransferRow): void { activeDetail.value = d }

async function init(): Promise<void> {
  await inv.syncLocationStock()
  locations.value = await inv.listLocations()
  // 库房由用户自行设定，数量与 id 都不固定：默认「第一个 → 第二个」
  const ids = locations.value.map(l => l.id!).filter(id => id != null)
  if (!ids.includes(fromLoc.value)) fromLoc.value = ids[0] ?? 0
  if (!ids.includes(toLoc.value) || toLoc.value === fromLoc.value) {
    toLoc.value = ids.find(id => id !== fromLoc.value) ?? fromLoc.value
  }
  products.value = await productStore.listAll()
  await reloadMaps()
  await loadHistory()
}

onMounted(init)
watch(tab, v => { if (v === 'history') void loadHistory() })
</script>

<style scoped>
.page { max-width: 1100px; margin: 0 auto; }
.loc-row { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.loc-field { display: flex; flex-direction: column; gap: 4px; }
.lf-label { font-size: 12px; color: var(--c-muted); }
/* 库位下拉：外观走设计系统的 .ui-select，这里只约束宽度 */
.loc-sel { min-width: 150px; }
.loc-arrow { font-size: 18px; color: var(--c-accent); padding-bottom: 10px; }
.warn-line { margin-top: 8px; font-size: 13px; color: var(--c-danger); }
.mini-input { width: 84px; height: 32px; border: 1px solid var(--c-border); border-radius: 6px; padding: 0 8px; text-align: right; font-size: 14px; }
.mini-input.bad { border-color: var(--c-danger); color: var(--c-danger); }
.total-label { text-align: right; }
.t-qty { font-size: 18px; color: var(--c-text); }
.empty { text-align: center; color: var(--c-muted); padding: 20px; font-size: 13px; }
.actions { display: flex; gap: 10px; justify-content: flex-end; }
.btn { height: 44px; border-radius: 10px; font-size: 14px; cursor: pointer; padding: 0 24px; }
.btn.ghost { border: 1px solid var(--c-border); background: #fff; color: var(--c-muted); }
.btn.primary { border: none; background: var(--c-accent); color: #fff; }
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.link-btn { border: none; background: none; color: var(--c-accent); cursor: pointer; font-size: 13px; }
.link-btn.danger { color: var(--c-danger); }
.order-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.order-table th, .order-table td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--c-border); font-size: 14px; }
.order-table th { background: #f1f5f9; color: var(--c-primary); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.card-list { border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 2px 10px rgba(26,54,93,0.06); list-style: none; }
.doc-card { padding: 14px 16px; border-bottom: 1px solid var(--c-border); }
.oc-head { display: flex; justify-content: space-between; align-items: center; }
.oc-no { font-weight: 600; color: var(--c-primary); }
.hs-qty { color: var(--c-success); font-weight: 700; }
.oc-meta { display: flex; justify-content: space-between; margin-top: 8px; font-size: 13px; color: var(--c-muted); }
.oc-date { font-size: 12px; }
.hs-sub { font-size: 12px; color: var(--c-muted); margin-top: 4px; }
.detail-pop { margin-top: 14px; background: #fff; border-radius: 12px; padding: 12px; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.dp-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.dp-sub { font-size: 12px; color: var(--c-muted); }

/* 手机端合计行通栏：统一由 src/styles/theme.css 的 .app-layout.is-mobile 钩子提供。
   页面里不要再写一份 —— scoped 副本特异性更高（(0,2,3)）会盖住全局，而它只声明
   display/width/margin，不管 padding/border/background，于是「只改全局不生效」。
   详见 theme.css 中「手机端：合计行通栏」那段 ⚠️ 注释。 */
</style>
