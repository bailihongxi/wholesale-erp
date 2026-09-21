<template>
  <div class="page ui-page">
    <PageHeader
      :title="`${isIn ? '入库单' : '出库单'} · ${doc?.batchNo ?? batchNo}`"
      :badge="isIn ? '收货入库' : '发货出库'"
      :badge-tone="isIn ? 'success' : 'info'"
      :sub="isIn ? '可修改数量并重算库存，也可整单撤回；备注随单据保存与打印' : '可修改数量并重算库存，也可整单撤销'"
    />

    <!-- 单据头：一眼看清这张单的来源、往来单位、经手人 -->
    <dl class="doc-head">
      <div class="dh-item">
        <dt>来源{{ isIn ? '采购' : '销售' }}单</dt>
        <dd class="dh-no" @click="gotoSource">{{ doc?.orderNo ?? '-' }}</dd>
      </div>
      <div class="dh-item">
        <dt>{{ doc?.partyLabel ?? (isIn ? '供应商' : '客户') }}</dt>
        <dd>{{ doc?.partyName ?? '-' }}</dd>
      </div>
      <div class="dh-item">
        <dt>{{ isIn ? '收货' : '发货' }}时间</dt>
        <dd>{{ fmtTime(doc?.createdAt ?? '') }}</dd>
      </div>
      <div class="dh-item">
        <dt>经手人</dt>
        <dd>{{ doc?.operatorName ?? '-' }}</dd>
      </div>
      <div class="dh-item">
        <dt>单据状态</dt>
        <dd><span class="tag tag-ok">已{{ isIn ? '入库' : '出库' }}</span></dd>
      </div>
    </dl>

    <p v-if="splitTip" class="split-tip">
      ⛓ {{ splitTip }}
    </p>

    <!-- 备注（验收 / 拣货有效信息），可在单据上补充与编辑 -->
    <section class="block remark-block">
      <h4 class="sec-title">
        备注
        <span class="sec-tip">验收 / 拣货时记录的有效信息</span>
      </h4>
      <textarea
        v-model="remarkEdit"
        class="remark-box"
        rows="2"
        maxlength="200"
        placeholder="暂无备注，可补充到货异常、拣货缺货等信息"
      ></textarea>
      <div class="rm-actions">
        <button class="ghost-btn sm" type="button" @click="saveRemark">保存备注</button>
      </div>
    </section>

    <!-- 明细表：数量与金额的合计统一放在表格最下面一行 -->
    <section class="block">
      <h4 class="sec-title">{{ isIn ? '入库' : '出库' }}明细</h4>
      <div class="tb-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th class="center" style="width:48px">序号</th>
              <th>商品名称</th>
              <th>类别</th>
              <th class="center" style="width:56px">单位</th>
              <th class="num" style="width:100px">{{ isIn ? '入库' : '出库' }}数量</th>
              <th class="num" style="width:88px">上限</th>
              <th v-if="canSeePrice" class="num" style="width:100px">单价</th>
              <th v-if="canSeePrice" class="num" style="width:110px">金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(it, i) in items" :key="it.productId">
              <td class="center">{{ i + 1 }}</td>
              <td>{{ it.productName }}</td>
              <td>{{ it.category || '-' }}</td>
              <td class="center">{{ it.unit }}</td>
              <td class="num">
                <input
                  v-if="editing"
                  v-model.number="editQty[it.productId]"
                  type="number"
                  min="0"
                  :max="it.orderedQty"
                  class="mini-input"
                  :class="{ bad: isOver(it) }"
                />
                <span v-else :class="isIn ? 'stock-ok' : 'stock-out'">{{ isIn ? '+' : '-' }}{{ it.quantity }}</span>
              </td>
              <td class="num limit">{{ it.orderedQty }}</td>
              <td v-if="canSeePrice" class="num">¥{{ money(it.price) }}</td>
              <td v-if="canSeePrice" class="num">¥{{ money(it.subtotal) }}</td>
            </tr>
            <tr v-if="!items.length">
              <td :colspan="canSeePrice ? 8 : 6" class="empty">没有明细</td>
            </tr>
          </tbody>
          <tfoot v-if="items.length">
            <tr>
              <td colspan="4" class="total-label">合计</td>
              <td class="num">{{ isIn ? '+' : '-' }}{{ editTotalQty }}</td>
              <td class="num"></td>
              <td v-if="canSeePrice" class="num"></td>
              <td v-if="canSeePrice" class="num">¥{{ money(editTotalAmount) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    <!-- 同单据的其他批次（部分入库 / 部分出库的拆单关联） -->
    <section v-if="siblings.length" class="block">
      <h4 class="sec-title">同源单据的其他批次</h4>
      <ul class="sib-list">
        <li v-for="s in siblings" :key="s.batchNo">
          <span class="sib-no" @click="gotoBatch(s.batchNo)">{{ s.batchNo }}</span>
          <span class="sib-qty">{{ s.itemCount }} 项 / {{ s.totalQty }} 件</span>
          <span class="sib-time">{{ fmtTime(s.createdAt) }}</span>
        </li>
      </ul>
    </section>

    <PageActions
      :cancel-text="editing ? '取消修改' : '返回'"
      :confirm-text="editing ? '保存修改' : '✎ 修改单据'"
      :loading="saving"
      @cancel="onCancel"
      @confirm="onPrimary"
    />
    <div class="extra-actions">
      <button class="ghost-btn" type="button" @click="showPreview = true">🖨 打印{{ isIn ? '入库' : '出库' }}单</button>
      <button v-if="!editing" class="danger-btn" type="button" @click="handleRevert">↩ 撤回本单</button>
    </div>

    <PrintPreview
      :visible="showPreview"
      :title="`${isIn ? '入库单' : '出库单'} ${doc?.batchNo ?? ''}`"
      :order-data="printData"
      :allow-price-toggle="canSeePrice"
      v-model:show-price="showPrice"
      @cancel="showPreview = false"
    />
  </div>
</template>

<script setup lang="ts">
import PageHeader from '../../components/ui/PageHeader.vue'
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import PageActions from '../../components/PageActions.vue'
import PrintPreview from '../../components/PrintPreview.vue'
import { useStockDocStore, type StockDocItem, type StockDocRow, type StockDocType } from '../../stores/stockDoc'
import { useUserStore } from '../../stores/user'
import { usePermission } from '../../composables/usePermission'
import type { PrintOrderData } from '../../utils/printTemplate'

const route = useRoute()
const router = useRouter()
const docStore = useStockDocStore()
const userStore = useUserStore()
const { canSeeAnyPrice } = usePermission()

const canSeePrice = canSeeAnyPrice
const isIn = computed(() => route.path.startsWith('/warehouse/inbound'))
const type = computed<StockDocType>(() => (isIn.value ? 'in' : 'out'))
const batchNo = computed(() => String(route.params.batchNo ?? ''))

const doc = ref<StockDocRow | null>(null)
const items = ref<StockDocItem[]>([])
const siblings = ref<StockDocRow[]>([])
const editing = ref(false)
const saving = ref(false)
const editQty = ref<Record<number, number>>({})
const showPreview = ref(false)
const showPrice = ref(true)
const remarkEdit = ref('')

const splitTip = computed(() => {
  if (!doc.value) return ''
  const n = siblings.value.length
  if (!n) return '本单一次性完成，无分批记录。'
  return `这是一张分批${isIn.value ? '入库' : '出库'}单：来源${isIn.value ? '采购' : '销售'}单共有 ${n + 1} 个批次，本单为其中之一，批次间通过来源单号关联。`
})

const editTotalQty = computed(() =>
  editing.value
    ? items.value.reduce((s, it) => s + (Number(editQty.value[it.productId]) || 0), 0)
    : (doc.value?.totalQty ?? 0)
)
const editTotalAmount = computed(() =>
  items.value.reduce((s, it) => s + (Number(editQty.value[it.productId] ?? it.quantity) || 0) * it.price, 0)
)

const printData = computed<PrintOrderData>(() => ({
  orderNo: doc.value?.batchNo ?? '',
  date: (doc.value?.createdAt ?? '').slice(0, 10),
  partyName: doc.value?.partyName ?? '',
  partyLabel: doc.value?.partyLabel ?? (isIn.value ? '供应商' : '客户'),
  items: items.value.map(it => ({
    productName: it.productName,
    model: it.model,
    category: it.category,
    unit: it.unit,
    quantity: Number(editQty.value[it.productId] ?? it.quantity),
    price: it.price,
    subtotal: Number(editQty.value[it.productId] ?? it.quantity) * it.price,
    // 出入库流水的赠品行（getDoc 归并时按备注里的「赠品」标记），打印时显示为赠品
    isGift: it.isGift
  })),
  totalQuantity: editTotalQty.value,
  totalAmount: editTotalAmount.value,
  remark: doc.value?.remark?.trim()
    ? `${doc.value.remark}（来源${isIn.value ? '采购' : '销售'}单：${doc.value?.orderNo ?? ''}）`
    : `来源${isIn.value ? '采购' : '销售'}单：${doc.value?.orderNo ?? ''}`,
  title: isIn.value ? '入库单' : '出库单',
  operatorName: doc.value?.operatorName ?? ''
}))

function isOver(it: StockDocItem): boolean {
  return (Number(editQty.value[it.productId]) || 0) > it.orderedQty
}
function money(n: number): string { return Number(n ?? 0).toLocaleString() }
function fmtTime(s: string): string {
  return s ? s.slice(0, 16).replace('T', ' ') : '-'
}

async function load(): Promise<void> {
  if (!batchNo.value) return
  const { doc: d, items: list } = await docStore.getDoc(type.value, batchNo.value)
  doc.value = d
  items.value = list
  remarkEdit.value = d?.remark ?? ''
  const q: Record<number, number> = {}
  for (const it of list) q[it.productId] = it.quantity
  editQty.value = q
  if (d) {
    const all = await docStore.listDocs(type.value)
    siblings.value = all.filter(x => x.refOrderId === d.refOrderId && x.batchNo !== d.batchNo)
  }
}

function gotoSource(): void {
  if (!doc.value) return
  router.push(isIn.value ? `/purchase/orders/${doc.value.refOrderId}` : `/sales/orders/${doc.value.refOrderId}`)
}
function gotoBatch(no: string): void {
  router.push(isIn.value ? `/warehouse/inbound/doc/${no}` : `/warehouse/outbound/doc/${no}`)
}

function onCancel(): void {
  if (editing.value) {
    editing.value = false
    // 放弃改动：把编辑数量还原成单据原值
    const q: Record<number, number> = {}
    for (const it of items.value) q[it.productId] = it.quantity
    editQty.value = q
    return
  }
  router.push(isIn.value ? '/warehouse/inbound' : '/warehouse/outbound')
}

function onPrimary(): void {
  if (editing.value) void handleSave()
  else editing.value = true
}

async function handleSave(): Promise<void> {
  if (items.value.some(isOver)) {
    showToast('数量超过来源单据的订购量')
    return
  }
  await showConfirmDialog({
    title: '修改单据',
    message: '会按新数量重新计算库存与来源单据状态，确定修改吗？'
  })
  saving.value = true
  const res = await docStore.updateDoc(
    type.value,
    batchNo.value,
    { ...editQty.value },
    userStore.currentUser?.id ?? 1
  )
  saving.value = false
  if (!res.ok) { showToast(res.message); return }
  showToast('已保存')
  editing.value = false
  await load()
}

async function handleRevert(): Promise<void> {
  await showConfirmDialog({
    title: '撤回单据',
    message: `撤回后库存会原路退回，来源${isIn.value ? '采购' : '销售'}单恢复为待${isIn.value ? '入库' : '出库'}状态。`
  })
  const res = await docStore.revertDoc(type.value, batchNo.value, userStore.currentUser?.id ?? 1)
  if (!res.ok) { showToast(res.message); return }
  showToast('已撤回')
  router.push(isIn.value ? '/warehouse/inbound' : '/warehouse/outbound')
}

async function saveRemark(): Promise<void> {
  const res = await docStore.setDocRemark(type.value, batchNo.value, remarkEdit.value.trim(), userStore.currentUser?.id ?? 1)
  showToast(res.message)
  if (res.ok) await load()
}

onMounted(load)
watch(() => route.fullPath, load)
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
.dh-no { color: var(--c-accent); cursor: pointer; text-decoration: underline; }
.split-tip {
  background: #eef6ff; color: var(--c-primary); font-size: 13px;
  padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; line-height: 1.7;
}
.remark-block { background: #fff; border-radius: 12px; padding: 12px; margin-bottom: 12px; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.remark-box {
  width: 100%; box-sizing: border-box; border: 1px solid var(--c-border); border-radius: 10px;
  padding: 10px 12px; font-size: 14px; line-height: 1.6; resize: vertical; color: var(--c-text);
  font-family: inherit;
}
.remark-box:focus { outline: none; border-color: var(--c-accent); }
.rm-actions { margin-top: 8px; display: flex; justify-content: flex-end; }
.ghost-btn.sm { flex: none; height: 36px; padding: 0 16px; font-size: 13px; }
.tb-scroll { overflow-x: auto; }
.mini-input {
  width: 84px; height: 32px; border: 1px solid var(--c-border); border-radius: 6px;
  padding: 0 8px; text-align: right; font-size: 14px;
}
.mini-input.bad { border-color: var(--c-danger); color: var(--c-danger); }
.limit { color: var(--c-muted); }
.total-label { text-align: right; }
.empty { text-align: center; color: var(--c-muted); padding: 20px; font-size: 13px; }
.sib-list { list-style: none; }
.sib-list li {
  display: flex; align-items: center; gap: 14px; padding: 8px 0;
  border-bottom: 1px dashed var(--c-border); font-size: 13px;
}
.sib-list li:last-child { border-bottom: none; }
.sib-no { color: var(--c-accent); cursor: pointer; text-decoration: underline; min-width: 150px; }
.sib-qty { color: var(--c-text); }
.sib-time { margin-left: auto; color: var(--c-muted); }
.extra-actions { display: flex; gap: 10px; margin-top: 10px; }
.ghost-btn {
  flex: 1; height: 44px; border: 1px solid var(--c-border); border-radius: 10px;
  background: #fff; color: var(--c-text); font-size: 14px; cursor: pointer;
}
.danger-btn {
  flex: 1; height: 44px; border: 1px solid var(--c-danger); border-radius: 10px;
  background: #fff; color: var(--c-danger); font-size: 14px; cursor: pointer;
}

/* 手机端：合计行通栏 */
@media (max-width: 767px) {
  .data-table tfoot { display: block; }
  .data-table tfoot tr { display: flex; align-items: center; gap: 8px; width: 100%; }
  .data-table tfoot td { display: inline-block; width: auto; }
  .data-table tfoot td.num { font-weight: 700; margin-left: auto; }
}
</style>
