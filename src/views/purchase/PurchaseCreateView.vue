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
            <tr>
              <td colspan="6" class="total-label">
                合计<span class="t-note">{{ form.items.length }} 项商品{{ giftQty ? `，含赠品 ${giftQty} 件` : '' }}</span>
              </td>
              <td class="num t-qty">{{ totalQty }}</td>
              <td v-if="canSeePurchasePrice" class="num"></td>
              <td v-if="canSeePurchasePrice" class="num t-amount">¥{{ money(total) }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    <!-- 选商品：搜索 + 库存 + 20 条分页 -->
    <ProductPicker
      :rows="rows"
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
import { showToast } from 'vant'
import ProductPicker, { type PickerRow } from '../../components/ProductPicker.vue'
import PageActions from '../../components/PageActions.vue'
import { usePurchaseStore } from '../../stores/purchase'
import { useProductStore } from '../../stores/product'
import { useUserStore } from '../../stores/user'
import { usePermission } from '../../composables/usePermission'
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
const rows = ref<PickerRow[]>([])
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

function addItem(p: Product): void {
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
    stock: rows.value.find(r => r.product.id === p.id)?.stock ?? 0,
    isGift: false
  })
}

function removeItem(idx: number): void { form.items.splice(idx, 1) }

function goBack(): void { router.push('/purchase/orders') }

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value) {
    showToast('请选择供应商并添加商品')
    return
  }
  if (submitting.value) return
  submitting.value = true
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
  submitting.value = false
  if (res.ok) {
    showToast('采购单创建成功')
    router.push('/purchase/orders')
  } else {
    showToast(res.message)
  }
}

onMounted(async () => {
  suppliers.value = await purchaseStore.listSuppliers()
  const list = await productStore.search('')
  const smap = await productStore.stockMap()
  rows.value = list.map(p => ({ product: p, stock: smap[p.id!] ?? 0 }))
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
</style>
