<template>
  <div class="page">
    <div class="ui-seg">
      <button :class="{ active: tab === 'create' }" type="button" @click="tab = 'create'">新建盘点</button>
      <button :class="{ active: tab === 'history' }" type="button" @click="tab = 'history'">
        盘点历史（{{ history.length }}）
      </button>
    </div>

    <!-- ============ 新建盘点 ============ -->
    <template v-if="tab === 'create'">
      <section class="block">
        <h4 class="sec-title">盘点库位</h4>
        <select v-model.number="locId" class="loc-sel" @change="onLocChange">
          <option v-for="l in locations" :key="l.id" :value="l.id">{{ l.name }}</option>
        </select>
        <p class="sec-tip">盘点会按实盘数校正系统库存：盘盈自动入库、盘亏自动出库，并留存盘点单。</p>
      </section>

      <ProductPicker
        :rows="pickerRows"
        :selected="selectedMap"
        :title="`选择要盘点的商品（${locName}系统库存）`"
        :show-price="false"
        @pick="onPick"
      />

      <div class="quick-row">
        <button class="btn ghost sm" type="button" @click="addAll">＋ 加入全部商品</button>
        <button class="btn ghost sm" type="button" @click="clearLines">清空</button>
      </div>

      <section class="block">
        <h4 class="sec-title">
          盘点明细
          <span class="sec-tip">「实盘数量」默认等于系统库存，按实际清点结果修改</span>
        </h4>
        <table v-if="lines.length" class="data-table">
          <thead>
            <tr>
              <th>商品名称</th>
              <th class="num">系统库存</th>
              <th class="num" style="width:120px">实盘数量</th>
              <th class="num">差异</th>
              <th class="center" style="width:80px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ln in lines" :key="ln.productId" :class="diffClass(ln)">
              <td>{{ ln.name }}</td>
              <td class="num">{{ ln.sys }}</td>
              <td class="num">
                <input
                  v-model.number="ln.actual"
                  type="number"
                  min="0"
                  class="mini-input"
                  :class="{ bad: ln.actual < 0 }"
                  aria-label="实盘数量"
                />
              </td>
              <td class="num diff">{{ diffOf(ln) }}</td>
              <td class="center">
                <button class="link-btn danger" type="button" @click="removeLine(ln.productId)">移除</button>
              </td>
            </tr>
          </tbody>
          <tfoot v-if="lines.length">
            <tr>
              <td colspan="2" class="total-label">合计</td>
              <td class="num t-qty">{{ totalActual }}</td>
              <td class="num">
                <span class="profit">盈{{ totalProfit }}</span>
                <span class="loss">亏{{ totalLoss }}</span>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div v-else class="empty">尚未选择商品，请在上方商品列表中点击「＋ 添加」</div>
      </section>

      <div class="actions">
        <button class="btn ghost" type="button" @click="clearLines">清空</button>
        <button class="btn primary" type="button" :disabled="!lines.length" @click="submit">确认盘点并调整库存</button>
      </div>
    </template>

    <!-- ============ 盘点历史 ============ -->
    <template v-else>
      <ul v-if="isMobile" class="card-list">
        <li v-for="d in history" :key="d.orderNo" class="doc-card" @click="showDetail(d)">
          <div class="oc-head">
            <span class="oc-no">{{ d.orderNo }}</span>
            <span class="hs-qty">盈{{ d.profit }} / 亏{{ d.loss }}</span>
          </div>
          <div class="oc-meta">
            <span>{{ d.locationName }}</span>
            <span class="oc-date">{{ d.date }}</span>
          </div>
          <div class="hs-sub">{{ d.itemCount }} 个品种 · {{ d.operatorName }}</div>
        </li>
        <li v-if="!history.length" class="empty">暂无盘点记录</li>
      </ul>
      <table v-else class="data-table order-table">
        <thead>
          <tr><th>盘点单号</th><th>库位</th><th class="num">盘盈</th><th class="num">盘亏</th><th>时间</th><th>经手人</th><th>明细</th></tr>
        </thead>
        <tbody>
          <tr v-for="d in history" :key="d.orderNo">
            <td class="mono">{{ d.orderNo }}</td>
            <td>{{ d.locationName }}</td>
            <td class="num stock-ok">+{{ d.profit }}</td>
            <td class="num stock-out">-{{ d.loss }}</td>
            <td>{{ d.date }}</td>
            <td>{{ d.operatorName }}</td>
            <td><button class="link-btn" type="button" @click="showDetail(d)">明细</button></td>
          </tr>
          <tr v-if="!history.length"><td colspan="7" class="empty">暂无盘点记录</td></tr>
        </tbody>
      </table>

      <div v-if="activeDetail" class="detail-pop">
        <div class="dp-head">
          <strong>{{ activeDetail.orderNo }}</strong>
          <span class="dp-sub">{{ activeDetail.locationName }} · {{ activeDetail.date }} · {{ activeDetail.operatorName }}</span>
          <button class="link-btn" type="button" @click="activeDetail = null">关闭</button>
        </div>
        <table class="data-table">
          <thead><tr><th>商品</th><th class="num">系统</th><th class="num">实盘</th><th class="num">差异</th></tr></thead>
          <tbody>
            <tr v-for="it in activeDetail.items" :key="it.productName">
              <td>{{ it.productName }}</td>
              <td class="num">{{ it.systemQty }}</td>
              <td class="num">{{ it.actualQty }}</td>
              <td class="num" :class="it.diff > 0 ? 'stock-ok' : it.diff < 0 ? 'stock-out' : ''">{{ it.diff > 0 ? '+' : '' }}{{ it.diff }}</td>
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
import { useInventoryStore, type StocktakeRow } from '../../stores/inventory'
import { useUserStore } from '../../stores/user'
import { useResponsive } from '../../composables/useResponsive'
import ProductPicker, { type PickerRow } from '../../components/ProductPicker.vue'
import type { Product } from '../../types'

const productStore = useProductStore()
const inv = useInventoryStore()
const userStore = useUserStore()
const { isMobile } = useResponsive()

const tab = ref<'create' | 'history'>('create')
const locations = ref<Array<{ id?: number; name: string }>>([])
const locId = ref(1)
const sysMap = ref<Record<number, number>>({})
const products = ref<Product[]>([])
const lines = ref<Array<{ productId: number; name: string; unit: string; sys: number; actual: number }>>([])
const history = ref<StocktakeRow[]>([])
const activeDetail = ref<StocktakeRow | null>(null)

const locName = computed(() => locations.value.find(l => l.id === locId.value)?.name ?? '库位')
const selectedMap = computed<Record<number, number>>(() => {
  const m: Record<number, number> = {}
  for (const l of lines.value) m[l.productId] = 1
  return m
})
const totalActual = computed(() => lines.value.reduce((s, l) => s + (Number(l.actual) || 0), 0))
const totalProfit = computed(() =>
  lines.value.reduce((s, l) => s + Math.max(0, (Number(l.actual) || 0) - l.sys), 0)
)
const totalLoss = computed(() =>
  lines.value.reduce((s, l) => s + Math.max(0, l.sys - (Number(l.actual) || 0)), 0)
)
const pickerRows = computed<PickerRow[]>(() =>
  products.value.map(p => ({ product: p, stock: sysMap.value[p.id!] ?? 0 }))
)

async function reloadSys(): Promise<void> {
  sysMap.value = await inv.locationStockMap(locId.value)
  for (const l of lines.value) {
    l.sys = sysMap.value[l.productId] ?? 0
    l.actual = l.sys
  }
}
function onLocChange(): void { void reloadSys() }

function onPick(p: Product): void {
  if (lines.value.some(l => l.productId === p.id)) return
  const sys = sysMap.value[p.id!] ?? 0
  lines.value.push({ productId: p.id!, name: `${p.brand} ${p.model}`.trim(), unit: p.unit, sys, actual: sys })
}
function addAll(): void {
  for (const p of products.value) {
    if (!lines.value.some(l => l.productId === p.id)) {
      const sys = sysMap.value[p.id!] ?? 0
      lines.value.push({ productId: p.id!, name: `${p.brand} ${p.model}`.trim(), unit: p.unit, sys, actual: sys })
    }
  }
}
function removeLine(id: number): void { lines.value = lines.value.filter(l => l.productId !== id) }
function clearLines(): void { lines.value = [] }
function diffOf(l: { sys: number; actual: number }): number { return (Number(l.actual) || 0) - l.sys }
function diffClass(l: { sys: number; actual: number }): string {
  const d = diffOf(l)
  return d > 0 ? 'row-profit' : d < 0 ? 'row-loss' : ''
}

async function submit(): Promise<void> {
  if (!lines.value.length) return
  const actuals: Record<number, number> = {}
  for (const l of lines.value) actuals[l.productId] = Number(l.actual) || 0
  const res = await inv.stocktake(locId.value, actuals, userStore.currentUser?.id ?? 1)
  if (!res.ok) { showToast(res.message); return }
  showToast(`已生成盘点单 ${res.orderNo}（盈 ${res.profit} / 亏 ${res.loss}）`)
  lines.value = []
  await reloadSys()
  await loadHistory()
  tab.value = 'history'
}

async function loadHistory(): Promise<void> { history.value = await inv.listStocktakes() }
function showDetail(d: StocktakeRow): void { activeDetail.value = d }

async function init(): Promise<void> {
  await inv.syncLocationStock()
  locations.value = await inv.listLocations()
  // 库房由用户自行设定，数量与 id 都不固定：默认盘第一个库房
  const ids = locations.value.map(l => l.id!).filter(id => id != null)
  if (!ids.includes(locId.value)) locId.value = ids[0] ?? 0
  products.value = await productStore.listAll()
  await reloadSys()
  await loadHistory()
}

onMounted(init)
watch(tab, v => { if (v === 'history') void loadHistory() })
</script>

<style scoped>
.page { max-width: 1100px; margin: 0 auto; }
.loc-sel { height: 44px; border: 1px solid var(--c-border); border-radius: 10px; padding: 0 12px; background: #fff; font-size: 14px; color: var(--c-text); }
.quick-row { display: flex; gap: 10px; margin: 12px 0; }
.btn { height: 44px; border-radius: 10px; font-size: 14px; cursor: pointer; padding: 0 24px; }
.btn.sm { height: 36px; padding: 0 14px; font-size: 13px; }
.btn.ghost { border: 1px solid var(--c-border); background: #fff; color: var(--c-muted); }
.btn.primary { border: none; background: var(--c-accent); color: #fff; }
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.mini-input { width: 84px; height: 32px; border: 1px solid var(--c-border); border-radius: 6px; padding: 0 8px; text-align: right; font-size: 14px; }
.mini-input.bad { border-color: var(--c-danger); color: var(--c-danger); }
.total-label { text-align: right; }
.t-qty { font-size: 18px; color: var(--c-text); }
.diff { font-weight: 600; }
.profit { color: var(--c-success); margin-right: 8px; }
.loss { color: var(--c-danger); }
.row-profit { background: #ecfdf5; }
.row-loss { background: #fef2f2; }
.empty { text-align: center; color: var(--c-muted); padding: 20px; font-size: 13px; }
.actions { display: flex; gap: 10px; justify-content: flex-end; }
.link-btn { border: none; background: none; color: var(--c-accent); cursor: pointer; font-size: 13px; }
.link-btn.danger { color: var(--c-danger); }
.order-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.order-table th, .order-table td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--c-border); font-size: 14px; }
.order-table th { background: #f1f5f9; color: var(--c-primary); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.card-list { border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 2px 10px rgba(26,54,93,0.06); list-style: none; }
.doc-card { padding: 14px 16px; border-bottom: 1px solid var(--c-border); cursor: pointer; }
.oc-head { display: flex; justify-content: space-between; align-items: center; }
.oc-no { font-weight: 600; color: var(--c-primary); }
.hs-qty { color: var(--c-muted); font-weight: 600; }
.oc-meta { display: flex; justify-content: space-between; margin-top: 8px; font-size: 13px; color: var(--c-muted); }
.oc-date { font-size: 12px; }
.hs-sub { font-size: 12px; color: var(--c-muted); margin-top: 4px; }
.detail-pop { margin-top: 14px; background: #fff; border-radius: 12px; padding: 12px; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.dp-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.dp-sub { font-size: 12px; color: var(--c-muted); }
</style>
