<template>
  <div class="create ui-page">
    <PageHeader title="新建采购单" sub="选供应商 → 加商品 → 填数量与价格，保存后生成待入库单" />

    <div class="head-card">
      <div class="row">
        <label>供应商 *</label>
        <select v-model="form.supplierId" class="f-input">
          <option :value="0">请选择供应商</option>
          <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <div class="row">
        <label>备注</label>
        <input v-model="form.remark" class="f-input" placeholder="选填" />
      </div>
    </div>

    <!-- 已选明细：单价可改，数量与金额的合计统一放在表格最下面一行 -->
    <section class="items">
      <h4 class="sec-title">采购商品明细</h4>
      <div class="tb-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th class="center" style="width:48px">序号</th>
              <th>商品名称</th>
              <th>类别</th>
              <th class="center" style="width:56px">单位</th>
              <th class="num" style="width:88px">当前库存</th>
              <th class="num" style="width:96px">数量</th>
              <th v-if="canSeePurchasePrice" class="num" style="width:110px">进价（可改）</th>
              <th v-if="canSeePurchasePrice" class="num" style="width:96px">金额</th>
              <th class="center" style="width:88px">赠品</th>
              <th class="center" style="width:64px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(it, idx) in form.items" :key="it.product.id">
              <td class="center">{{ idx + 1 }}</td>
              <td>{{ productName(it.product) }}</td>
              <td>{{ it.product.category || '-' }}</td>
              <td class="center">{{ it.product.unit }}</td>
              <td class="num">
                <span :class="stockClass(it.stock)">{{ it.stock }}</span>
              </td>
              <td class="num">
                <input v-model.number="it.quantity" type="number" min="1" class="mini-input" />
              </td>
              <td v-if="canSeePurchasePrice" class="num">
                <input v-model.number="it.price" type="number" min="0" class="mini-input price" :disabled="it.isGift" />
              </td>
              <td v-if="canSeePurchasePrice" class="num">
                <span v-if="it.isGift" class="gift-tag">🎁 赠品</span>
                <template v-else>¥{{ money(it.price * it.quantity) }}</template>
              </td>
              <td class="center">
                <input v-model="it.isGift" type="checkbox" class="gift-check" aria-label="标记为赠品" />
              </td>
              <td class="center">
                <button class="rm-btn" type="button" @click="removeItem(idx)">移除</button>
              </td>
            </tr>
            <tr v-if="!form.items.length">
              <td :colspan="canSeePurchasePrice ? 10 : 8" class="empty">尚未添加商品，请从下方列表中选择</td>
            </tr>
          </tbody>
          <tfoot v-if="form.items.length">
            <!-- 合计行的列位必须与表头逐列对齐：数量落在「数量」列、金额落在「金额」列。
                 原先 colspan=6 连「数量」列一起占掉，结果数量跑进「进价」列、金额跑进
                 「赠品」列，整行右移一格（手机端更明显，直接与表头错位）。 -->
            <tr>
              <td colspan="5" class="total-label">
                合计<span class="t-note">{{ form.items.length }} 项商品{{ giftQty ? `，含赠品 ${giftQty} 件` : '' }}</span>
              </td>
              <td class="num t-qty">{{ totalQty }}</td>
              <template v-if="canSeePurchasePrice">
                <td class="num"></td>
                <td class="num t-amount">¥{{ money(total) }}</td>
                <td></td>
                <td></td>
              </template>
              <td v-else colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    <!-- 选商品：搜索 + 库存 + 20 条分页 -->
    <ProductPicker
      :loader="loadPicker"
      :categories="pickerCats"
      :selected="selectedMap"
      price-mode="purchase"
      :show-price="canSeePurchasePrice"
      :block-no-stock="false"
      title="选择商品（进货单不受库存限制）"
      @pick="addItem"
    />

    <PageActions
      cancel-text="取消"
      confirm-text="提交采购单"
      :loading="submitting"
      :confirm-disabled="!canSubmit"
      @cancel="goBack"
      @confirm="handleSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import PageHeader from '../../components/ui/PageHeader.vue'
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { goBackOr } from '../../composables/useGoBack'
import { showToast } from 'vant'
import ProductPicker, { type PickerLoader } from '../../components/ProductPicker.vue'
import PageActions from '../../components/PageActions.vue'
import { usePurchaseStore } from '../../stores/purchase'
import { useProductStore } from '../../stores/product'
import { useUserStore } from '../../stores/user'
import { usePermission } from '../../composables/usePermission'
import { clearAllListCaches } from '../../composables/useListCache'
import type { Product, Supplier } from '../../types'

const router = useRouter()
const purchaseStore = usePurchaseStore()
const productStore = useProductStore()
const userStore = useUserStore()
const { canSeePurchasePrice } = usePermission()

interface Line {
  product: Product
  quantity: number
  price: number
  stock: number
  /** 赠品行：金额计 0、不参与合计，照常入库 */
  isGift: boolean
}

const form = reactive({
  supplierId: 0,
  remark: '',
  items: [] as Line[]
})
const suppliers = ref<Supplier[]>([])
const pickerCats = ref<string[]>([])
/**
 * 选商品走服务端分页：商品档案已有 6281 条，旧实现进页面就先拉全量商品 + 全量库存
 * （12562 行）到浏览器。现在只拉当前页 20 条 + 这 20 条的库存 + 总数。
 */
const loadPicker: PickerLoader = args => productStore.pickerPage(args)
const submitting = ref(false)

/** 合计只统计非赠品行；赠品单独计数展示 */
const totalQty = computed(() => form.items.filter(it => !it.isGift).reduce((s, it) => s + (Number(it.quantity) || 0), 0))
const giftQty = computed(() => form.items.filter(it => it.isGift).reduce((s, it) => s + (Number(it.quantity) || 0), 0))
const total = computed(() => form.items.filter(it => !it.isGift).reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0))
const canSubmit = computed(() => form.supplierId > 0 && form.items.length > 0 && totalQty.value + giftQty.value > 0)

const selectedMap = computed<Record<number, number>>(() => {
  const m: Record<number, number> = {}
  for (const it of form.items) m[it.product.id!] = it.quantity
  return m
})

function productName(p: Product): string { return productStore.productName(p) }
function money(n: number): string { return Number(n ?? 0).toLocaleString() }
function stockClass(s: number): string { return s <= 0 ? 'stock-out' : 'stock-ok' }

function addItem(p: Product, stock = 0): void {
  const existing = form.items.find(it => it.product.id === p.id)
  if (existing) {
    existing.quantity += 1
    showToast(`已增加数量，现为 ${existing.quantity}`)
    return
  }
  form.items.push({
    product: p,
    quantity: 1,
    price: Number(p.purchasePrice) || 0,
    stock,
    isGift: false
  })
}

function removeItem(idx: number): void { form.items.splice(idx, 1) }

function goBack(): void {
  goBackOr(router, '/purchase/orders') }

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value) {
    showToast('请选择供应商并添加商品')
    return
  }
  if (submitting.value) return
  submitting.value = true
  try {
    const res = await purchaseStore.createOrder({
      supplierId: form.supplierId,
      purchaserId: userStore.currentUser?.id ?? 1,
      items: form.items.map(it => ({
        product: it.product,
        quantity: Number(it.quantity) || 0,
        price: Number(it.price) || 0,
        isGift: it.isGift
      })),
      remark: form.remark
    })
    if (res.ok) {
      showToast('采购单创建成功')
      // 新采购单要让「待收货」等列表立即可见：清列表页 30 秒缓存（同入库事故）
      clearAllListCaches()
      router.push('/purchase/orders')
    } else {
      showToast(res.message)
    }
  } catch (e: any) {
    showToast('提交失败：' + (e?.message || '网络错误'))
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  const [supList, cats] = await Promise.all([
    purchaseStore.listSuppliers(),
    productStore.pickerCategories()
  ])
  suppliers.value = supList
  pickerCats.value = cats
})
</script>

<style scoped>
.create { max-width: 900px; margin: 0 auto; }
.ct { font-size: 16px; color: var(--c-primary); margin-bottom: 14px; }
.head-card {
  background: #fff; border-radius: 12px; padding: 14px;
  box-shadow: 0 2px 10px rgba(26,54,93,0.06); margin-bottom: 12px;
}
.row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.row:last-child { margin-bottom: 0; }
.row label { font-size: 13px; color: var(--c-muted); }
.f-input {
  height: 44px; border: 1px solid var(--c-border); border-radius: 10px;
  padding: 0 14px; font-size: 14px; outline: none; background: #fff; width: 100%;
}
.items {
  background: #fff; border-radius: 12px; padding: 12px; margin-bottom: 12px;
  box-shadow: 0 2px 10px rgba(26,54,93,0.06);
}
.tb-scroll { overflow-x: auto; }
.mini-input {
  width: 72px; height: 32px; border: 1px solid var(--c-border); border-radius: 6px;
  padding: 0 8px; text-align: right; font-size: 14px;
}
.mini-input.price { width: 92px; }
.total-label { text-align: right; }
/* 合计行醒目化：沿用已取消的底部合计条的视觉（大号红色金额 + 加粗数量） */
.t-note { margin-left: 8px; font-size: 12px; font-weight: 400; color: var(--c-muted); }
.data-table tfoot td.t-qty { font-size: 18px; color: var(--c-text); }
.data-table tfoot td.t-amount { font-size: 20px; color: var(--c-danger); }
.rm-btn { border: none; background: none; color: var(--c-danger); cursor: pointer; font-size: 13px; }
.gift-tag { color: var(--c-accent); font-size: 12px; font-weight: 600; white-space: nowrap; }
.gift-check { width: 16px; height: 16px; accent-color: var(--c-accent); cursor: pointer; }
.mini-input:disabled { background: #f7f9fc; color: var(--c-muted); }
.empty { text-align: center; color: var(--c-muted); padding: 20px; font-size: 13px; }

/* === 手机端：已选商品表改卡片式布局 === */
@media (max-width: 767px) {
  .tb-scroll { overflow-x: visible; }
  .data-table thead { display: none; }
  /* 卡片模式下不再需要「表格至少 640px 宽 + 横向滚动」那套（见 theme.css），
     否则卡片会被撑到 640px、比屏幕还宽。原表格列宽约束一并解除。 */
  .data-table, .data-table tbody { min-width: 0; }
  .data-table, .data-table tbody, .data-table tr, .data-table td { display: block; width: 100%; }
  .data-table tbody tr {
    background: #f8fafc; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px;
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px;
  }
  .data-table tbody td { padding: 2px 0; border: none; width: auto; }
  .data-table tbody td:nth-child(1) { display: none; }
  .data-table tbody td:nth-child(2) { width: 100%; font-size: 15px; font-weight: 600; order: 1; }
  .data-table tbody td:nth-child(3) { order: 2; font-size: 12px; color: var(--c-muted); }
  .data-table tbody td:nth-child(4) { display: none; }
  .data-table tbody td:nth-child(5) { order: 3; font-size: 12px; color: var(--c-muted); }
  .data-table tbody td:nth-child(6) { order: 4; margin-left: auto; }
  .data-table tbody td:nth-child(7) { order: 5; }
  .data-table tbody td:nth-child(8) { order: 6; font-weight: 700; color: var(--c-danger); }
  .data-table tbody td:nth-child(9) { order: 7; }
  .data-table tbody td:nth-child(10) { order: 8; }
  .mini-input { width: 64px; height: 30px; font-size: 14px; }
  .mini-input.price { width: 80px; }
  /* ⚠️ 空态行只有一个 td（colspan），它就是 :nth-child(1)，会被上面的 display:none 一起隐藏 ——
     手机端会变成一张空卡片、连「尚未添加商品」都不显示。这里显式放回来。 */
  .data-table tbody td.empty { display: block; width: 100%; }
  .data-table tfoot tr {
    display: flex; align-items: center; gap: 8px;
    background: #fff; border-top: 2px solid var(--c-border); padding: 12px 4px 0;
  }
  .data-table tfoot td { border: none; padding: 0; width: auto; }
  .data-table tfoot td.total-label { text-align: left; }
  .data-table tfoot td.t-qty { font-size: 18px; }
  .data-table tfoot td.t-amount { font-size: 20px; margin-left: auto; }
}
</style>
