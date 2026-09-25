<template>
  <div class="quotes ui-page" :class="isMobile ? 'is-mobile' : 'is-desktop'">
    <PageHeader title="采购管理" sub="采购开单、预采询价与入库进度" />

    <!-- 页内 Tab：采购单 / 预采询价单（第二十轮起预采询价单收进采购管理页内，不单列侧边栏菜单） -->
    <div class="quotes-tabs">
      <button type="button" :class="{ active: route.path === '/purchase/orders' }" @click="go('/purchase/orders')">
        采购单
      </button>
      <button type="button" :class="{ active: true }" @click="go('/purchase/quotes')">
        预采询价单
      </button>
    </div>

    <!-- ==================== 列表态 ==================== -->
    <template v-if="mode === 'list'">
      <div class="toolbar">
        <SearchInput v-model="keyword" class="tb-search" placeholder="搜索单号 / 供应商" :debounce="0" />
        <select v-model="statusFilter" class="filter">
          <option value="">全部状态</option>
          <option value="draft">待询价</option>
          <option value="sent">已询价</option>
          <option value="converted">已转采购单</option>
          <option value="void">已失效</option>
        </select>
        <button v-if="hasFilter" class="reset-btn" type="button" @click="resetFilter">重置</button>
        <button v-if="!isMobile" class="add-btn" type="button" @click="mode = 'create'">＋ 新建询价</button>
      </div>
      <div class="sum-line">共 {{ pager.total.value }} 张预采询价单</div>

      <LoadingBlock v-if="pager.loading.value" :rows="6" />

      <ul v-else-if="isMobile" class="card-list zebra-list">
        <li v-for="o in pager.paged.value" :key="o.id" class="quote-card" @click="openDetail(o.id!)">
          <div v-if="o.status === 'converted'" class="stamp-stamp">已转采购单</div>
          <div class="qc-head">
            <span class="qc-no">{{ o.orderNo }}</span>
            <span class="qc-status" :class="o.status">{{ statusText(o.status) }}</span>
          </div>
          <div class="qc-meta">
            <span>{{ partyName(o) }}</span>
            <span class="qc-amt">¥{{ o.totalAmount.toLocaleString() }}</span>
          </div>
          <div class="qc-date">{{ o.quoteDate.slice(0, 10) }}</div>
        </li>
        <li v-if="!pager.total.value" class="empty">没有符合条件的预采询价单</li>
      </ul>

      <table v-else class="data-table quote-table">
        <thead>
          <tr><th>单号</th><th>供应商</th><th>日期</th><th class="num">金额</th><th>状态</th><th class="center">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="o in pager.paged.value" :key="o.id">
            <td>{{ o.orderNo }}</td>
            <td>{{ partyName(o) }}</td>
            <td>{{ o.quoteDate.slice(0, 10) }}</td>
            <td class="num">¥{{ o.totalAmount.toLocaleString() }}</td>
            <td :class="o.status">{{ statusText(o.status) }}</td>
            <td class="center">
              <button class="link-btn" type="button" @click="openDetail(o.id!)">查看</button>
            </td>
          </tr>
          <tr v-if="!pager.total.value"><td colspan="6" class="empty">没有符合条件的预采询价单</td></tr>
        </tbody>
      </table>

      <TablePager
        v-if="pager.total.value"
        v-model:page="page"
        :page-count="pager.pageCount.value"
        :total="pager.total.value"
        :size="pager.size.value"
        show-jump
      />

      <button v-if="isMobile" class="fab-btn" type="button" @click="mode = 'create'">＋ 新建询价</button>
    </template>

    <!-- ==================== 新建态 ==================== -->
    <template v-else-if="mode === 'create'">
      <PageHeader title="新建预采询价单" sub="选供应商 → 加商品 → 填数量与询价，供应商确认后可一键转采购单" />
      <div class="head-card">
        <div class="row">
          <label>供应商</label>
          <select v-model="form.customerId" class="f-input">
            <option :value="0">散客 / 新供应商（直接填名字）</option>
            <option v-for="c in suppliers" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="row">
          <label>供应商名称 <span v-if="form.customerId > 0" class="muted">（已选供应商，无需填写）</span></label>
          <input v-model="form.customerName" class="f-input" placeholder="如：红星商场 王老板" :disabled="form.customerId > 0" />
        </div>
        <div class="row">
          <label>有效期（天）<span class="muted">（选填）</span></label>
          <input v-model.number="form.validDays" class="f-input" type="number" min="0" placeholder="如 7；留空表示长期有效" />
        </div>
        <div class="row">
          <label>备注</label>
          <input v-model="form.remark" class="f-input" placeholder="选填" />
        </div>
        <!-- 批发 / 零售：同一个供应商可能拿不同价，按单切换 -->
        <div class="row">
          <label>本单价格类型</label>
          <div class="mode-switch">
            <button class="mode-btn" :class="{ active: priceMode === 'wholesale' }" type="button" @click="switchMode('wholesale')">
              进价<span class="mode-hint">采购进货</span>
            </button>
            <button class="mode-btn" :class="{ active: priceMode === 'retail' }" type="button" @click="switchMode('retail')">
              批发价<span class="mode-hint">参考批发</span>
            </button>
          </div>
        </div>
      </div>

      <section class="items">
        <h4 class="sec-title">
          询价商品明细
          <span class="tag" :class="priceMode === 'retail' ? 'tag-warn' : 'tag-info'">{{ priceMode === 'retail' ? '按进价' : '按进价' }}</span>
        </h4>
        <div class="tb-scroll">
          <!-- items-edit：手机端卡片范式的契约类，列序见下方 @media（V2.1-1.3） -->
          <table class="data-table items-edit">
            <thead>
              <tr>
                <th class="center" style="width:48px">序号</th>
                <th>商品名称</th>
                <th>类别</th>
                <th class="center" style="width:56px">单位</th>
                <th class="num" style="width:96px">数量</th>
                <th class="num" style="width:110px">询价（可改）</th>
                <th class="num" style="width:110px">金额</th>
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
                  <input v-model.number="it.quantity" type="number" min="1" class="mini-input" />
                </td>
                <td class="num">
                  <input v-model.number="it.price" type="number" min="0" class="mini-input price" />
                </td>
                <td class="num">¥{{ money(it.price * it.quantity) }}</td>
                <td class="center">
                  <button class="rm-btn" type="button" @click="form.items.splice(idx, 1)">移除</button>
                </td>
              </tr>
              <tr v-if="!form.items.length">
                <td colspan="8" class="empty">尚未添加商品，请从下方列表中选择</td>
              </tr>
            </tbody>
            <tfoot v-if="form.items.length">
              <tr>
                <td colspan="5" class="total-label">
                  合计<span class="t-note">{{ form.items.length }} 项商品</span>
                </td>
                <td class="num"></td>
                <td class="num t-amount">¥{{ money(total) }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <!-- 选商品：预采询价单不占库存，未上架/无库存商品也可以询价 -->
      <ProductPicker
        :loader="loadPicker"
        :categories="pickerCats"
        :selected="selectedMap"
        :price-mode="priceMode"
        :show-price="true"
        :block-no-stock="false"
        title="选择商品（询价不占库存）"
        @pick="addItem"
      />

      <PageActions
        cancel-text="取消"
        confirm-text="保存预采询价单"
        :loading="submitting"
        :confirm-disabled="!canSubmit"
        @cancel="backToList"
        @confirm="handleCreate"
      />
    </template>

    <!-- ==================== 详情态 ==================== -->
    <template v-else>
      <PageHeader title="预采询价单详情" sub="核对明细后可直接转成采购单" />
      <section class="block" v-if="quote">
        <div class="d-head">
          <div>
            <h3 class="d-no">{{ quote.orderNo }}</h3>
            <span class="d-badge" :class="quote.status">{{ statusText(quote.status) }}</span>
            <span v-if="quote.convertedSaleNo" class="d-badge conv">→ {{ quote.convertedSaleNo }}</span>
          </div>
          <div class="d-actions">
            <button v-if="quote.status !== 'converted'" class="btn primary btn-edit" type="button" @click="beginEdit">✏️ 修改</button>
            <button class="btn btn-print" type="button" @click="openPreview">🖨 打印</button>
            <button v-if="quote.status !== 'converted'" class="btn primary" type="button" :disabled="converting" @click="handleConvert">
              {{ converting ? '转换中…' : '➜ 转为采购单' }}
            </button>
            <button v-if="canDeleteDoc && quote.status !== 'converted'" class="btn danger" type="button" @click="handleRemove">🗑 删除</button>
          </div>
        </div>

        <div class="d-meta">
          <span><i>供应商</i>{{ partyName(quote) }}</span>
          <span><i>询价日期</i>{{ fmtDate(quote.quoteDate) }}</span>
          <span v-if="quote.validDays"><i>有效期</i>{{ quote.validDays }} 天</span>
          <span><i>备注</i>{{ quote.remark || '无' }}</span>
        </div>
      </section>

      <section class="block">
        <!-- 手机端卡片（全站统一组件），电脑端列表表格。规则见 docs/手机端明细卡片规范.md -->
        <ItemCards
          v-if="isMobile"
          title="询价明细"
          :items="detailCards"
          :total-amount="quote?.totalAmount ?? 0"
          empty-text="暂无明细"
        />

        <template v-else>
        <h4 class="block-title">询价明细（{{ detailItems.length }}）</h4>
        <table v-if="detailItems.length" class="data-table">
          <thead>
            <tr><th>#</th><th>商品名称</th><th>单位</th><th class="num">数量</th><th class="num">询价</th><th class="num">金额</th></tr>
          </thead>
          <tbody>
            <tr v-for="(it, i) in detailItems" :key="i">
              <td>{{ i + 1 }}</td>
              <td>{{ nameOf(it.productId) }}</td>
              <td>{{ unitOf(it.productId) }}</td>
              <td class="num">{{ it.quantity }}</td>
              <td class="num">¥{{ money(it.price) }}</td>
              <td class="num">¥{{ money(it.subtotal) }}</td>
            </tr>
          </tbody>
          <tfoot v-if="detailItems.length">
            <tr>
              <td colspan="4" class="total-label">合计</td>
              <td class="num"></td>
              <td class="num"><b>¥{{ money(quote?.totalAmount ?? 0) }}</b></td>
            </tr>
          </tfoot>
        </table>
        <div v-else class="empty">暂无明细</div>
        </template>
      </section>

      <!-- 编辑模式：与销售单同一套做法 —— 电脑端内联在详情页下方（普通卡片），
           手机端整屏覆盖；底部只留「取消 / 保存修改」。 -->
      <EditModePanel :model-value="showEdit" :saving="saving"
                     @cancel="closeEdit" @save="onSaveEdit">
        <section class="block">
          <div class="d-head">
            <h3 class="d-no">修改预采询价单</h3>
          </div>
          <div class="d-meta remark-row">
            <div class="rm-label"><i>备注</i></div>
            <div class="rm-input">
              <textarea
                v-model="editRemark"
                class="edit-remark-input"
                rows="2"
                placeholder="选填"
                @input="onRemarkInput"
              ></textarea>
            </div>
          </div>
        </section>

        <section class="block">
          <h4 class="block-title"><span class="bar"></span>询价明细（{{ editItems.length }}）</h4>
          <ul class="ec-list">
            <li v-for="(it, i) in editItems" :key="i" class="ec-item">
              <div class="ec-top">
                <span class="ec-idx">{{ i + 1 }}</span>
                <span class="ec-name">{{ nameOf(it.productId) }}</span>
                <b class="ec-amount">¥{{ money((it.quantity || 0) * (it.price || 0)) }}</b>
              </div>
              <div class="ec-row">
                <label class="ec-field">
                  <i>数量</i>
                  <input v-model.number="it.quantity" type="number" min="1" inputmode="numeric" class="ec-input" />
                  <em>{{ unitOf(it.productId) }}</em>
                </label>
                <label class="ec-field">
                  <i>询价</i>
                  <input v-model.number="it.price" type="number" min="0" inputmode="decimal" class="ec-input" />
                </label>
              </div>
            </li>
            <li v-if="!editItems.length" class="empty">暂无明细</li>
          </ul>
          <div v-if="editItems.length" class="mc-total">
            <span>合计</span>
            <span class="mt-qty">{{ editItems.reduce((s, it) => s + (it.quantity || 0), 0) }} 件</span>
            <b class="mt-amount">¥{{ money(editItems.reduce((s, it) => s + (it.quantity || 0) * (it.price || 0), 0)) }}</b>
          </div>
        </section>
      </EditModePanel>

      <p class="tip-line">预采询价单不占库存、不生成应收；供应商确认后点「转为采购单」，明细与价格自动带过去。</p>

      <!-- 页面最底部的橘色「返回」（借 PageActions 的 tone-back）——
           详情态此前没有任何返回入口（V2.1-2.1 老板要求补上），
           与销售单 / 采购单 / 报价单详情页保持一致；编辑时收起，模块一关自动回来。 -->
      <PageActions v-if="!showEdit" cancel-text="返回" @cancel="backToList" />
    </template>

    <PrintPreview
      v-if="printVisible"
      :visible="printVisible"
      :title="printTitle"
      :html="printHtml"
      @cancel="printVisible = false"
      @confirm="printVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { useProductCache } from '../../composables/useProductCache'
import { useRoute, useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import PageHeader from '../../components/ui/PageHeader.vue'
import LoadingBlock from '../../components/ui/LoadingBlock.vue'
import ItemCards from '../../components/ui/ItemCards.vue'
import SearchInput from '../../components/SearchInput.vue'
import TablePager from '../../components/TablePager.vue'
import ProductPicker, { type PickerLoader } from '../../components/ProductPicker.vue'
import PageActions from '../../components/PageActions.vue'
import PrintPreview from '../../components/PrintPreview.vue'
import { useEditMode } from '../../composables/useEditMode'
import EditModePanel from '../../components/EditModePanel.vue'
import { useQuotesStore } from '../../stores/quotes'
import { useProductStore } from '../../stores/product'
import { usePurchaseStore } from '../../stores/purchase'
import { useUserStore } from '../../stores/user'
import { useResponsive } from '../../composables/useResponsive'
import { usePermission } from '../../composables/usePermission'
import { useServerPager } from '../../composables/useServerPager'
import { db } from '../../db'
import { escapeOr } from '../../db/cloudDb'
import { serverPage } from '../../db/serverPage'
import { buildOrderPrintHTML, getCompanyName } from '../../utils/printTemplate'
import type { Product, QuoteOrder, QuoteOrderItem, ItemCardRow } from '../../types'
import { useScrollRestore } from '../../composables/useScrollRestore'

useScrollRestore('purchase-quotes')
const route = useRoute()
const router = useRouter()
const quotesStore = useQuotesStore()
const productStore = useProductStore()
const purchaseStore = usePurchaseStore()
const userStore = useUserStore()
const { isMobile } = useResponsive()
const { canDeleteDoc } = usePermission()

type Mode = 'list' | 'create' | 'detail'
const mode = ref<Mode>('list')

// ---- 列表 ----
const keyword = ref('')
const statusFilter = ref('')
const hasFilter = computed(() => !!keyword.value.trim() || !!statusFilter.value)
const suppliers = ref<any[]>([])

// 服务端分页：只拉当前页 + 总数，不再进页面就 toArray() 全量询价单。
// 采购询价单 kind='purchase'（走 eq）；关键词走 单号 / 供应商名。
const pager = useServerPager<QuoteOrder>({
  watch: [keyword, statusFilter],
  loader: async (pg, size) => {
    await ensureSuppliers()
    const kw = keyword.value.trim()
    const lower = kw.toLowerCase()
    const eq: Record<string, any> = { kind: 'purchase' }
    if (statusFilter.value) eq.status = statusFilter.value
    let orExpr: string | undefined
    if (kw) {
      const ids = suppliers.value
        .filter((c: any) => String(c.name ?? '').toLowerCase().includes(lower))
        .map((c: any) => c.id!)
      const kwParts = [`orderNo.ilike.*${escapeOr(kw)}*`, `customerName.ilike.*${escapeOr(kw)}*`]
      if (ids.length) kwParts.push(`customerId.in.(${ids.join(',')})`)
      orExpr = `or(${kwParts.join(',')})`
    }
    // 本地 / 测试模式没有 orExpr 语义，用同一套条件在行上过滤
    const extraFilter = (r: QuoteOrder): boolean => {
      const row = r as any
      if (row.kind !== 'purchase') return false
      if (!kw) return true
      return (
        String(row.orderNo ?? '').toLowerCase().includes(lower) ||
        String(row.customerName ?? '').toLowerCase().includes(lower) ||
        (row.customerId > 0 &&
          String(suppliers.value.find((c: any) => c.id === row.customerId)?.name ?? '')
            .toLowerCase().includes(lower))
      )
    }
    return serverPage<QuoteOrder>(db.quoteOrders, {
      page: pg,
      pageSize: size,
      eq,
      orExpr,
      extraFilter,
      orderBy: 'quoteDate',
      ascending: false,
    })
  },
})
const page = computed({ get: () => pager.page.value, set: v => pager.go(v) })

/** 供应商列表既用于列表展示（供应商名），也用于新建询价的下拉；按需加载一次 */
async function ensureSuppliers(): Promise<void> {
  if (!suppliers.value.length) suppliers.value = await purchaseStore.listSuppliers()
}


function resetFilter(): void { keyword.value = ''; statusFilter.value = '' }

function statusText(s: string): string {
  return { draft: '待询价', sent: '已询价', converted: '已转采购单', void: '已失效' }[s] ?? s
}
function partyName(q: QuoteOrder): string {
  return q.customerId > 0 ? suppliers.value.find((c:any) => c.id === q.customerId)?.name ?? `供应商#${q.customerId}` : q.customerName
}

// ---- 新建 ----
const pickerCats = ref<string[]>([])
/**
 * 选商品走服务端分页：商品档案已有 6281 条，旧实现进页面就先拉全量商品 + 全量库存
 * （12562 行）到浏览器。现在只拉当前页 20 条 + 这 20 条的库存 + 总数。
 */
const loadPicker: PickerLoader = args => productStore.pickerPage(args)
const submitting = ref(false)
interface Line { product: Product; quantity: number; price: number }
const form = reactive({
  customerId: 0,
  customerName: '',
  validDays: 0,
  remark: '',
  items: [] as Line[]
})
const total = computed(() => form.items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0))
const canSubmit = computed(() => {
  const hasCustomer = form.customerId > 0 || form.customerName.trim().length > 0
  return hasCustomer && form.items.length > 0
})
const selectedMap = computed<Record<number, number>>(() => {
  const m: Record<number, number> = {}
  for (const it of form.items) m[it.product.id!] = it.quantity
  return m
})

function productName(p: Product): string { return productStore.productName(p) }
function money(n: number): string { return Number(n ?? 0).toLocaleString() }

/** 预采询价单的批发 / 零售切换（与销售开单一致）：切换时整单单价随之切换 */
type PriceMode = 'wholesale' | 'retail'
const priceMode = ref<PriceMode>('wholesale')
function priceByMode(p: Product): number {
  return Number(p.purchasePrice)
}
function switchMode(mode: PriceMode): void {
  if (priceMode.value === mode) return
  priceMode.value = mode
  // 切换后整单单价跟随新模式（个别行仍可手工改价）
  for (const it of form.items) it.price = priceByMode(it.product)
  showToast(mode === 'retail' ? '已切换到批发价' : '已切换到进价')
}

function addItem(p: Product): void {
  const existing = form.items.find(it => it.product.id === p.id)
  if (existing) { existing.quantity += 1; return }
  form.items.push({ product: p, quantity: 1, price: priceByMode(p) })
}

async function handleCreate(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  const res = await quotesStore.createQuote({
    customerId: form.customerId,
    customerName: form.customerId > 0 ? '' : form.customerName,
    items: form.items.map(it => ({ product: it.product, quantity: Number(it.quantity) || 0, price: Number(it.price) || 0 })),
    remark: form.remark,
    validDays: form.validDays,
    salesId: userStore.currentUser?.id ?? 2,
    kind: 'purchase'
  })
  submitting.value = false
  if (res.ok) {
    showToast(res.message)
    form.customerId = 0
    form.customerName = ''
    form.validDays = 0
    form.remark = ''
    form.items = []
    await pager.reload()
    mode.value = 'list'
  } else {
    showToast(res.message)
  }
}

function backToList(): void { mode.value = 'list' }

// ---- 详情 ----
const quote = ref<QuoteOrder | null>(null)
const detailItems = ref<QuoteOrderItem[]>([])
const converting = ref(false)
const { productName: getProductName, productUnit: getProductUnit, cache: productCache } = useProductCache()
const productMap = ref<Record<number, Product>>({})

// ---- 修改：与销售单同一套（useEditMode 管状态与滚动，EditModePanel 管排版） ----
const { showEdit, saving, startEdit, closeEdit } = useEditMode({ scrollSelectorOnStart: '.edit-page' })
const editRemark = ref('')
const editItems = ref<Array<{ productId: number; quantity: number; price: number }>>([])

/** 备注框随内容自增高度：文字超过两行时不再挤在固定高度里滚动 */
function autoGrowRemark(el: HTMLTextAreaElement | null): void {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.max(el.scrollHeight, 56)}px`
}
function onRemarkInput(e: Event): void {
  autoGrowRemark(e.target as HTMLTextAreaElement)
}

/** 点「修改」：先拷出可编辑副本，再进入编辑态 */
async function beginEdit(): Promise<void> {
  if (!quote.value) return
  editItems.value = detailItems.value.map(it => ({
    productId: it.productId,
    quantity: it.quantity,
    price: it.price
  }))
  editRemark.value = quote.value.remark || ''
  await startEdit()
  await nextTick()
  autoGrowRemark(document.querySelector<HTMLTextAreaElement>('.edit-remark-input'))
}

/** 点「保存修改」：成功后关闭模块，刷新详情与列表 */
async function onSaveEdit(): Promise<void> {
  if (!quote.value) return
  const id = quote.value.id!
  saving.value = true
  try {
    const res = await quotesStore.updateQuote(
      id,
      editItems.value,
      editRemark.value,
      userStore.currentUser?.id ?? 2
    )
    if (res.ok) {
      showToast('已保存')
      await closeEdit()
      quote.value = (await quotesStore.getQuote(id)) ?? null
      detailItems.value = await quotesStore.getQuoteItems(id)
      await pager.reload()
    } else {
      showToast(res.message)
    }
  } finally {
    saving.value = false
  }
}

async function openDetail(id: number): Promise<void> {
  quote.value = (await quotesStore.getQuote(id)) ?? null
  detailItems.value = await quotesStore.getQuoteItems(id)
  const ids = [...new Set(detailItems.value.map(it => it.productId))]
  const list = await db_products(ids)
  const m: Record<number, Product> = {}
  for (const p of list) m[p.id!] = p
  productMap.value = m
  mode.value = 'detail'
}

async function db_products(ids: number[]): Promise<Product[]> {
  const { db } = await import('../../db')
  return await db.products.bulkGet(ids).then(a => a.filter((p): p is Product => Boolean(p)))
}

function nameOf(id: number): string { return getProductName(id) }
function unitOf(id: number): string { return getProductUnit(id) }

/** 手机端「询价明细」卡片行数据（详情态），形状见 types/ItemCardRow */
const detailCards = computed<ItemCardRow[]>(() =>
  detailItems.value.map(it => ({
    name: nameOf(it.productId),
    unit: unitOf(it.productId),
    qty: it.quantity,
    price: it.price,
    amount: it.subtotal
  }))
)
function fmtDate(s: string): string { return s ? s.slice(0, 10) : '-' }

async function handleConvert(): Promise<void> {
  if (!quote.value) return
  const go = await showConfirmDialog({
    title: '转为采购单',
    message: `将按询价明细生成采购单（含库存校验），原预采询价单标记「已转采购单」。确定继续？`
  }).then(() => true).catch(() => false)
  if (!go) return
  converting.value = true
  try {
    const res = await quotesStore.convertToPurchase(quote.value.id!, userStore.currentUser?.id ?? 2)
    showToast(res.message)
    if (res.ok) {
      quote.value = (await quotesStore.getQuote(quote.value.id!)) ?? null
      await pager.reload()
    }
  } finally {
    converting.value = false
  }
}

async function handleRemove(): Promise<void> {
  if (!quote.value) return
  const go = await showConfirmDialog({
    title: '删除预采询价单',
    message: `确定删除 ${quote.value.orderNo}？（预采询价单不影响库存，可随时删除）`
  }).then(() => true).catch(() => false)
  if (!go) return
  const res = await quotesStore.removeQuote(quote.value.id!, userStore.currentUser?.id ?? 2)
  showToast(res.message)
  if (res.ok) {
    mode.value = 'list'
    await pager.reload()
  }
}

// ---- 打印 ----
const printVisible = ref(false)
const printTitle = ref('预采询价单')
const printHtml = ref('')

async function openPreview(): Promise<void> {
  if (!quote.value) return
  printTitle.value = '预采询价单'
  printHtml.value = buildOrderPrintHTML({
    orderNo: quote.value.orderNo,
    date: quote.value.quoteDate.slice(0, 10),
    partyName: partyName(quote.value),
    partyLabel: '供应商',
    items: detailItems.value.map(it => ({
      productName: productCache.value[it.productId]?.brand ?? '',
      category: productCache.value[it.productId]?.category ?? '',
      model: productCache.value[it.productId]?.model ?? '',
      unit: unitOf(it.productId),
      quantity: it.quantity,
      price: it.price,
      subtotal: it.subtotal
    })),
    totalQuantity: detailItems.value.reduce((s, it) => s + it.quantity, 0),
    totalAmount: quote.value.totalAmount,
    remark: quote.value.remark,
    title: '预采询价单',
    companyName: getCompanyName()
  }, true)
  printVisible.value = true
}

// ---- 公共 ----
function go(p: string): void { router.push(p) }

onMounted(async () => {
  // 刷新页面后，如果之前在详情页，自动恢复详情
  const savedId = sessionStorage.getItem('purchase_quote_detail_id')
  if (savedId && mode.value === 'list') {
    const id = Number(savedId)
    if (id) {
      await openDetail(id)
      return
    }
  }
  suppliers.value = await purchaseStore.listSuppliers()
  pickerCats.value = await productStore.pickerCategories()
})
</script>

<style scoped>
.quotes { max-width: 1100px; margin: 0 auto; }
.quotes-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
.quotes-tabs button {
  height: 36px; padding: 0 18px; border: 1px solid var(--c-border-strong);
  border-radius: 18px; background: #fff; color: var(--c-muted); font-size: 14px; cursor: pointer;
}
.quotes-tabs button.active { background: var(--c-primary); border-color: var(--c-primary); color: #fff; font-weight: 600; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.tb-search { flex: 1 1 260px; min-width: 180px; }
.filter { height: 40px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm); padding: 0 12px; font-size: 14px; background: #fff; outline: none; }
.reset-btn { height: 40px; padding: 0 14px; border: 1px solid var(--c-border); border-radius: var(--r-sm); background: #fff; color: var(--c-muted); cursor: pointer; }
.add-btn { height: 40px; padding: 0 16px; border: none; border-radius: var(--r-sm); background: var(--c-accent); color: #fff; font-size: 14px; cursor: pointer; }
.sum-line { font-size: 12px; color: var(--c-muted); margin-bottom: 10px; }
.quote-table th, .quote-table td { padding: 10px 12px; }
.qc-status, .d-badge { font-size: 12px; padding: 2px 8px; border-radius: 6px; background: #f1f5f9; color: var(--c-primary); }
.qc-status.converted, .d-badge.converted { background: #e8f5ec; color: #1a8a4a; }
.qc-status.void { background: #f1f5f9; color: var(--c-muted); }
.d-badge.conv { background: #eaf1ff; color: var(--c-accent); }
.quote-card { padding: 12px 14px; }
.qc-head { display: flex; justify-content: space-between; align-items: center; }
.qc-no { font-weight: 600; color: var(--c-primary); }
.qc-meta { display: flex; justify-content: space-between; margin-top: 6px; }
.qc-amt { color: var(--c-danger); font-weight: 600; }
.qc-date { font-size: 12px; color: var(--c-muted); margin-top: 4px; }
.fab-btn {
  position: fixed; right: 18px; bottom: 76px; height: 48px; padding: 0 20px;
  border: none; border-radius: 24px; background: var(--c-accent); color: #fff;
  font-size: 15px; font-weight: 600; box-shadow: 0 6px 18px rgba(26,54,93,.25); cursor: pointer; z-index: 20;
}
.head-card { background: #fff; border-radius: 12px; padding: 14px; box-shadow: 0 2px 10px rgba(26,54,93,.06); margin-bottom: 12px; }
.row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.row:last-child { margin-bottom: 0; }
.row label { font-size: 13px; color: var(--c-muted); }
.muted { color: var(--c-muted); font-weight: 400; }
.f-input { height: 44px; border: 1px solid var(--c-border); border-radius: 10px; padding: 0 14px; font-size: 14px; outline: none; background: #fff; width: 100%; }
.f-input:disabled { background: #f7f9fc; color: var(--c-muted); }
/* 批发 / 批发价切换（与销售开单一致） */
.mode-switch { display: flex; gap: 10px; }
.mode-btn {
  flex: 1 1 0; min-width: 120px; height: 48px; border-radius: 10px;
  border: 1px solid var(--c-border-strong); background: #fff; color: var(--c-muted);
  font-size: 14px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
}
.mode-btn.active { border-color: var(--c-accent); background: var(--c-accent-soft); color: var(--c-primary); font-weight: 600; }
.mode-hint { font-size: 11px; font-weight: 400; color: var(--c-muted); }
.mode-btn.active .mode-hint { color: var(--c-accent); }
.items { background: #fff; border-radius: 12px; padding: 12px; margin-bottom: 12px; box-shadow: 0 2px 10px rgba(26,54,93,.06); }
.sec-title { font-size: 15px; color: var(--c-primary); margin-bottom: 10px; }
.tb-scroll { overflow-x: auto; }
.mini-input { width: 76px; height: 32px; border: 1px solid var(--c-border); border-radius: 6px; padding: 0 8px; text-align: right; font-size: 14px; }
.mini-input.price { width: 96px; }
.total-label { text-align: right; }
.t-note { margin-left: 8px; font-size: 12px; font-weight: 400; color: var(--c-muted); }
.data-table tfoot td.t-amount { font-size: 18px; color: var(--c-danger); }
.rm-btn { border: none; background: none; color: var(--c-danger); cursor: pointer; font-size: 13px; }
.empty { text-align: center; color: var(--c-muted); padding: 20px; font-size: 13px; }
.d-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.d-no { font-size: 17px; color: var(--c-primary); }
.d-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.btn { height: 36px; padding: 0 14px; border: 1px solid var(--c-border-strong); border-radius: 8px; background: #fff; color: var(--c-primary); font-size: 13px; cursor: pointer; }
.btn.primary { background: var(--c-accent); border-color: var(--c-accent); color: #fff; }
.btn.danger { color: var(--c-danger); border-color: #fca5a5; }
.btn:disabled { opacity: .6; }
.d-meta { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 14px; font-size: 13px; color: var(--c-text); }
.d-meta i { font-style: normal; color: var(--c-muted); margin-right: 6px; }
.block { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 2px 10px rgba(26,54,93,.06); }
.block-title { font-size: 15px; color: var(--c-primary); margin-bottom: 10px; }
.link-btn { border: none; background: none; color: var(--c-accent); cursor: pointer; font-size: 13px; }
.tip-line { font-size: 12px; color: var(--c-muted); }

/* ── 手机端：可编辑明细表 → 卡片（与报价单新建态同一套范式，V2.1-1.3） ──
   列序（.items-edit 的 thead）：1序号 2名称 3类别 4单位 5数量 6询价 7金额 8操作
   ⚠️ 往明细里插列必须同步改这里的 nth-child 与 order。 */
@media (max-width: 767px) {
  /* 卡片模式下不再需要「表格至少 640px + 横向滚动」，否则卡片被撑得比屏幕还宽 */
  .tb-scroll { overflow-x: visible; }
  .items-edit, .items-edit tbody { min-width: 0; }
  .items-edit thead { display: none; }
  .items-edit, .items-edit tbody, .items-edit tr, .items-edit td { display: block; width: 100%; }
  .items-edit tbody tr {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px;
    background: #f8fafc; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px;
  }
  .items-edit tbody td { padding: 2px 0; border: none; width: auto; }
  .items-edit tbody td:nth-child(1) { display: none; }                                  /* 序号 */
  .items-edit tbody td:nth-child(2) { width: 100%; font-size: 15px; font-weight: 600; order: 1; }
  .items-edit tbody td:nth-child(3) { order: 2; font-size: 12px; color: var(--c-muted); } /* 类别 */
  .items-edit tbody td:nth-child(4) { display: none; }                                   /* 单位并入数量 */
  .items-edit tbody td:nth-child(5) { order: 3; margin-left: auto; }
  .items-edit tbody td:nth-child(6) { order: 4; }
  .items-edit tbody td:nth-child(7) { order: 5; font-weight: 700; color: var(--c-danger); }
  .items-edit tbody td:nth-child(8) { order: 6; }
  .items-edit .mini-input { width: 64px; height: 30px; }
  .items-edit .mini-input.price { width: 80px; }
  /* ⚠️ 空态那行只有一个 td（colspan）→ 命中 nth-child(1) 的 display:none 会一起被隐藏，
     手机端就变成一张空卡片。必须显式放回来（同特异性、靠书写顺序取胜）。 */
  .items-edit tbody td.empty { display: block; width: 100%; }
  .items-edit tfoot tr {
    display: flex; align-items: center; gap: 8px;
    background: #fff; border-top: 2px solid var(--c-border); padding: 12px 4px 0;
  }
  .items-edit tfoot td { border: none; padding: 0; width: auto; }
  .items-edit tfoot td.total-label { text-align: left; }
  .items-edit tfoot td.t-amount { margin-left: auto; font-size: 20px; }
}

/* 手机端合计行通栏：统一由 src/styles/theme.css 的 .app-layout.is-mobile 钩子提供。
   页面里不要再写一份 —— scoped 副本特异性更高（(0,2,3)）会盖住全局，而它只声明
   display/width/margin，不管 padding/border/background，于是「只改全局不生效」。
   详见 theme.css 中「手机端：合计行通栏」那段 ⚠️ 注释。 */

/* 椭圆红色印章 */
.stamp-stamp {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 4px 12px;
  border: 2px solid #e53935;
  border-radius: 6px;
  color: #e53935;
  font-weight: bold;
  font-size: 13px;
  transform: rotate(-10deg);
  opacity: 0.9;
  background: rgba(229, 57, 53, 0.05);
  pointer-events: none;
}
.quote-card {
  position: relative;
}
</style>
