<template>
  <div class="product-edit ui-page">
    <PageHeader
      :title="isEdit ? '编辑商品' : '新增商品'"
      :sub="isEdit ? '修改后点保存，商品名称会自动重新生成' : '品牌 + 型号 + 规格 自动生成商品名称，同款共用一个条码'"
    />

    <div class="preview">
      商品名称（自动生成）：<b>{{ previewName }}</b>
    </div>

    <div class="form">
      <div class="row">
        <label>品牌 *</label>
        <input v-model="form.brand" class="f-input" placeholder="如：格力" />
      </div>
      <div class="row">
        <label>型号 *</label>
        <input v-model="form.model" class="f-input" placeholder="如：KFR-35GW" />
      </div>
      <div class="row">
        <label>分类</label>
        <input v-model="form.category" class="f-input" placeholder="如：空调 / 冰箱" />
      </div>
      <div class="row">
        <label>规格</label>
        <input v-model="form.spec" class="f-input" placeholder="如：1.5匹 变频" />
      </div>
      <div class="row">
        <label>单位</label>
        <input v-model="form.unit" class="f-input" placeholder="台 / 件 / 套" />
      </div>

      <template v-if="canSeePurchasePrice">
        <div class="row">
          <label>成本价（进价）</label>
          <input v-model.number="form.purchasePrice" type="number" class="f-input" placeholder="采购成本" />
        </div>
      </template>
      <template v-if="canSeeAnyPrice">
        <!-- 按系统设置里的加价率自动推算，手改后不再被覆盖 -->
        <div class="row">
          <label>
            批发价
            <span class="auto-tag">成本 +{{ rule.wholesaleRate }}% 自动计算</span>
          </label>
          <div class="price-line">
            <input v-model.number="form.wholesalePrice" type="number" class="f-input" placeholder="给经销商的价格" @input="manual.wholesale = true" />
            <button class="calc-btn" type="button" @click="recalc('wholesale')">按规则重算</button>
          </div>
        </div>
        <div class="row">
          <label>
            零售价
            <span class="auto-tag">成本 +{{ rule.retailRate }}% 自动计算</span>
          </label>
          <div class="price-line">
            <input v-model.number="form.retailPrice" type="number" class="f-input" placeholder="门市价" @input="manual.retail = true" />
            <button class="calc-btn" type="button" @click="recalc('retail')">按规则重算</button>
          </div>
        </div>
        <p class="tip">加价比例在系统设置 →「价格规则」中修改。</p>
      </template>

      <div class="row">
        <label>库存预警值</label>
        <input v-model.number="form.warnStock" type="number" class="f-input" placeholder="低于此数报警" />
      </div>
      <div class="row">
        <label>状态</label>
        <select v-model="form.status" class="f-input">
          <option value="active">在售</option>
          <option value="inactive">停售</option>
        </select>
      </div>

      <PageActions
        cancel-text="取消"
        confirm-text="保存"
        :loading="saving"
        @cancel="goBack"
        @confirm="handleSave"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import PageHeader from '../../components/ui/PageHeader.vue'
import { ref, computed, reactive, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { useProductStore } from '../../stores/product'
import { usePermission } from '../../composables/usePermission'
import PageActions from '../../components/PageActions.vue'
import { getPriceRule, calcWholesale, calcRetail, type PriceRule } from '../../utils/priceRule'
import type { Product } from '../../types'

const route = useRoute()
const router = useRouter()
const productStore = useProductStore()
const { canSeeAnyPrice, canSeePurchasePrice } = usePermission()

const id = route.params.id
const isEdit = computed(() => !!id)
const saving = ref(false)
const rule = ref<PriceRule>(getPriceRule())
/** 手工改过价格后不再自动覆盖，尊重开单人的临时改价 */
const manual = reactive({ wholesale: false, retail: false })

const form = reactive({
  brand: '', model: '', category: '', spec: '', unit: '台',
  purchasePrice: 0, wholesalePrice: 0, retailPrice: 0, warnStock: 0, status: 'active'
})

// 填了成本就自动带出批发价 / 零售价（规则里关闭了自动填充则不动）
watch(
  () => form.purchasePrice,
  cost => {
    if (!rule.value.autoFill) return
    if (!manual.wholesale) form.wholesalePrice = calcWholesale(cost, rule.value)
    if (!manual.retail) form.retailPrice = calcRetail(cost, rule.value)
  }
)

function recalc(which: 'wholesale' | 'retail'): void {
  if (which === 'wholesale') {
    form.wholesalePrice = calcWholesale(form.purchasePrice, rule.value)
    manual.wholesale = false
  } else {
    form.retailPrice = calcRetail(form.purchasePrice, rule.value)
    manual.retail = false
  }
  showToast('已按规则重算')
}

const previewName = computed(() => productStore.productName(form as Pick<Product, 'brand' | 'model'>))

function goBack(): void {
  router.push('/boss/products')
}

onMounted(async () => {
  if (isEdit.value) {
    const p = await productStore.getProduct(Number(id))
    if (p) {
      form.brand = p.brand
      form.model = p.model
      form.category = p.category
      form.spec = p.spec
      form.unit = p.unit
      form.purchasePrice = p.purchasePrice
      form.wholesalePrice = p.wholesalePrice
      form.retailPrice = p.retailPrice
      form.warnStock = p.warnStock
      form.status = p.status
    }
  }
})

async function handleSave(): Promise<void> {
  if (!form.brand || !form.model) {
    showToast('品牌和型号必填')
    return
  }
  saving.value = true
  try {
    const payload = {
      brand: form.brand, model: form.model, category: form.category, spec: form.spec,
      unit: form.unit, purchasePrice: Number(form.purchasePrice), wholesalePrice: Number(form.wholesalePrice),
      retailPrice: Number(form.retailPrice), warnStock: Number(form.warnStock), status: form.status as 'active' | 'inactive'
    }
    if (isEdit.value) {
      await productStore.updateProduct(Number(id), payload)
      showToast('已保存')
      router.push('/boss/products')
    } else {
      const res = await productStore.createProduct({ ...payload, remark: '', extra: {} })
      if (res.ok) {
        showToast('已保存')
        router.push('/boss/products')
      } else {
        showToast(res.message)
      }
    }
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.product-edit { max-width: 640px; margin: 0 auto; }
.preview {
  padding: 10px 14px; background: #eef6ff; border-radius: 10px; font-size: 13px;
  color: #1f6b48; margin-bottom: 14px;
}
.form { display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; flex-direction: column; gap: 6px; }
.row label { font-size: 13px; color: var(--c-muted); }
.price-line { display: flex; gap: 8px; align-items: center; }
.price-line .f-input { flex: 1; }
.calc-btn {
  height: 44px; padding: 0 12px; white-space: nowrap;
  border: 1px solid var(--c-accent); border-radius: 10px;
  background: #fff; color: var(--c-accent); font-size: 13px; cursor: pointer;
}
.auto-tag {
  margin-left: 6px; padding: 1px 6px; border-radius: 8px;
  background: #eef6ff; color: var(--c-accent); font-size: 11px;
}
.tip { font-size: 12px; color: var(--c-muted); }
.f-input {
  height: 44px; border: 1px solid var(--c-border); border-radius: 10px;
  padding: 0 14px; font-size: 14px; outline: none; background: #fff;
}
.save-btn {
  height: 48px; border: none; border-radius: 10px; background: var(--c-accent);
  color: #fff; font-size: 16px; cursor: pointer; margin-top: 8px;
}
.save-btn:disabled { opacity: 0.7; }
</style>
