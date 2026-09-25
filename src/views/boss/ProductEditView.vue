<template>
  <div class="product-edit ui-page">
    <PageHeader
      :title="isEdit ? '编辑商品' : '新增商品'"
      :sub="isEdit ? '修改后点保存，商品名称会自动重新生成' : '品牌 + 型号 + 规格 自动生成商品名称，同款共用一个条码'"
    />

    <div class="preview">
      商品名称（自动生成）：<b>{{ previewName }}</b>
      <span v-if="isEdit" class="preview-id">商品 #{{ editId }}</span>
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
        <input v-model="form.category" class="f-input" list="categoryList" placeholder="选择或输入新分类" />
        <datalist id="categoryList">
          <option v-for="c in categories" :key="c" :value="c" />
        </datalist>
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
      <div class="row">
        <label>备注</label>
        <textarea
          v-model="form.remark"
          class="f-input remark-input"
          rows="3"
          placeholder="选填：产地、配件、替代型号、注意事项…"
        />
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
import { useReloadOnActivate } from '../../composables/useReloadOnActivate'
import PageActions from '../../components/PageActions.vue'
import { getPriceRule, calcWholesale, calcRetail, type PriceRule } from '../../utils/priceRule'
import type { Product } from '../../types'

const route = useRoute()
const router = useRouter()
const productStore = useProductStore()
const { canSeeAnyPrice, canSeePurchasePrice } = usePermission()

/**
 * ⚠️ 编辑的商品 id **必须是 computed**。
 *
 * 本组件被 App.vue 的 <keep-alive> 缓存：`/boss/products/edit/:id` 之间来回切换时
 * 组件是「复活」而不是「重新挂载」，setup 只跑一次。旧实现把
 * `const id = route.params.id` 在 setup 里取值一次，于是从列表里点第二个商品进来，
 * 表单虽然加载了第二个商品，保存却仍写回**第一个**商品的 id ——
 * 表现就是「只有第一次点编辑能改成功，后面的都改不动」，甚至把 A 的数据盖到 B 上。
 */
const editId = computed(() => Number(route.params.id) || 0)
const isEdit = computed(() => editId.value > 0)
const saving = ref(false)
const rule = ref<PriceRule>(getPriceRule())
/** 手工改过价格后不再自动覆盖，尊重开单人的临时改价 */
const manual = reactive({ wholesale: false, retail: false })

function emptyForm() {
  return {
    brand: '', model: '', category: '', spec: '', unit: '台',
    purchasePrice: 0, wholesalePrice: 0, retailPrice: 0, warnStock: 0,
    status: 'active' as 'active' | 'inactive', remark: ''
  }
}
const form = reactive(emptyForm())
const categories = ref<string[]>([])

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
  router.back()
}

/**
 * 载入表单。**每次都先整份重置**，再按 editId 填值——
 * 只覆盖「读回来的那几个字段」的话，上一个商品残留的值会混进新商品里（例如上一个
 * 有备注、这一个没有，保存时备注就串了）。
 */
async function initForm(): Promise<void> {
  const id = editId.value
  Object.assign(form, emptyForm())
  manual.wholesale = false
  manual.retail = false
  try {
    // 分类下拉：走带缓存的 distinctCategories，不在这里扫整张商品表
    categories.value = await productStore.distinctCategories()
  } catch { categories.value = [] }
  if (!id) return
  try {
    const p = await productStore.getProduct(id)
    if (!p) {
      showToast(`没找到商品 #${id}`)
      return
    }
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
    form.remark = p.remark ?? ''
    // 档案里已有的价格是准的：别让「成本 → 售价」的自动推算在载入时把它们冲掉
    manual.wholesale = true
    manual.retail = true
  } catch (e: any) {
    showToast('加载失败：' + (e?.message || '未知错误'))
  }
}

onMounted(() => { void initForm() })
// 路由参数变化（换一个商品编辑 / 从编辑切到新增）必须重新初始化
watch(() => route.params.id, () => { void initForm() })
// 从别的页面回到本页（keep-alive 复活）时重新载入，避免停留在上次的表单
useReloadOnActivate(initForm)

function payload(): Pick<Product, 'brand' | 'model' | 'category' | 'spec' | 'unit' | 'purchasePrice' | 'wholesalePrice' | 'retailPrice' | 'warnStock' | 'status' | 'remark'> {
  return {
    brand: String(form.brand ?? '').trim(),
    model: String(form.model ?? '').trim(),
    category: form.category,
    spec: form.spec,
    unit: form.unit,
    purchasePrice: Number(form.purchasePrice) || 0,
    wholesalePrice: Number(form.wholesalePrice) || 0,
    retailPrice: Number(form.retailPrice) || 0,
    warnStock: Number(form.warnStock) || 0,
    status: form.status as 'active' | 'inactive',
    remark: String(form.remark ?? '')
  }
}

async function handleSave(): Promise<void> {
  if (!form.brand || !form.model) {
    showToast('品牌和型号必填')
    return
  }
  saving.value = true
  try {
    const data = payload()
    // 同名拦截：不论新增还是改名，都不允许库里出现第二个「品牌+型号」完全相同的商品
    const same = await productStore.findSameName(data.brand, data.model, isEdit.value ? editId.value : undefined)
    if (same.length) {
      showToast(`已存在同名商品（#${same[0].id} ${data.brand} ${data.model}），请改用「合并同名」`)
      return
    }
    if (isEdit.value) {
      await productStore.updateProduct(editId.value, data)
      showToast('已保存')
      router.push('/boss/products')
    } else {
      const res = await productStore.createProduct({ ...data, extra: {} })
      if (res.ok) {
        showToast('已保存')
        router.push('/boss/products')
      } else {
        showToast(res.message)
      }
    }
  } catch (e: any) {
    showToast('保存失败：' + (e?.message || '未知错误'))
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
.preview-id { margin-left: 8px; color: var(--c-muted); font-size: 12px; }
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
.remark-input {
  height: auto; min-height: 84px; padding: 10px 14px; line-height: 1.5;
  resize: vertical; font-family: inherit;
}
.save-btn {
  height: 48px; border: none; border-radius: 10px; background: var(--c-accent);
  color: #fff; font-size: 16px; cursor: pointer; margin-top: 8px;
}
.save-btn:disabled { opacity: 0.7; }
</style>
