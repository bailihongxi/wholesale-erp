<template>
  <div class="product-list">
    <PageHeader title="商品档案" sub="搜索、筛选、批量导入导出与库存状态一览" />
    <!-- 工具条：搜索 / 分类 / 状态 / 导入导出 -->
    <div class="data-toolbar">
      <SearchInput
        v-model="keyword"
        class="grow"
        placeholder="搜索名称 / 型号 / 分类 / 规格"
        :debounce="0"
        @search="pager.reset()"
      />
      <select v-model="category" class="sel" @change="pager.reset()">
        <option value="">全部分类</option>
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-model="status" class="sel" @change="pager.reset()">
        <option value="">全部状态</option>
        <option value="active">在售</option>
        <option value="inactive">停售</option>
      </select>
      <button class="ghost-btn" type="button" @click="openImport">⇩ 导入</button>
      <button class="ghost-btn" type="button" @click="exportAll">⇧ 导出</button>
      <button class="ghost-btn" type="button" @click="scanDuplicates">⧉ 重复检测</button>
      <button v-if="!isMobile" class="primary-btn" type="button" @click="go('/boss/products/new')">＋ 新增</button>
    </div>

    <!-- 选中后的批量操作条 -->
    <div v-if="selected.length" class="bulk-bar">
      已选 <b>{{ selected.length }}</b> 项
      <button class="bulk-btn" type="button" @click="openBulkEdit">✎ 批量编辑</button>
      <button class="bulk-btn" type="button" :disabled="!canMergeSelected" @click="mergeSelected">⧉ 合并同名</button>
      <button class="bulk-btn danger" type="button" @click="removeSelected">🗑 删除</button>
      <span v-if="!canMergeSelected && selected.length > 1" class="bulk-tip">合并要求所选商品名称一致</span>
      <button class="link-btn" type="button" @click="clearSelection">取消选择</button>
    </div>

    <!-- 首次拉数据期间骨架占位，不闪空态 -->
    <LoadingBlock v-if="loading" :rows="8" />

    <!-- 电脑端：表格（含多选、库存、斑马纹） -->
    <table v-else-if="!isMobile" class="data-table prod-table">
      <thead>
        <tr>
          <th class="center" style="width:40px">
            <input type="checkbox" :checked="allChecked" :indeterminate="someChecked" aria-label="全选本页" @change="toggleAll" />
          </th>
          <th class="center" style="width:52px">序号</th>
          <th>商品名称</th>
          <th>分类</th>
          <th>规格</th>
          <th class="center">单位</th>
          <th v-if="canSeePurchasePrice" class="num">进价</th>
          <th v-if="canSeeAnyPrice" class="num">批发价</th>
          <th v-if="canSeeAnyPrice" class="num">零售价</th>
          <th class="num">库存</th>
          <th class="center">状态</th>
          <th class="center">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(p, i) in pager.paged.value"
          :key="p.id"
          :class="{ 'is-selected': isSelected(p.id!), 'is-warn': isWarn(p) }"
        >
          <td class="center">
            <input type="checkbox" :checked="isSelected(p.id!)" :aria-label="`选择 ${p.brand} ${p.model}`" @change="toggleOne(p.id!)" />
          </td>
          <td class="center">{{ pager.startIndex.value + i }}</td>
          <td>{{ productName(p) }}</td>
          <td>{{ p.category || '-' }}</td>
          <td>{{ p.spec || '-' }}</td>
          <td class="center">{{ p.unit }}</td>
          <td v-if="canSeePurchasePrice" class="num">¥{{ money(p.purchasePrice) }}</td>
          <td v-if="canSeeAnyPrice" class="num">¥{{ money(p.wholesalePrice) }}</td>
          <td v-if="canSeeAnyPrice" class="num">¥{{ money(p.retailPrice) }}</td>
          <td class="num">
            <span :class="stockClass(p)">{{ stockOf(p.id!) }}</span>
            <span v-if="isWarn(p)" class="tag tag-danger">预警</span>
          </td>
          <td class="center">
            <span class="tag" :class="p.status === 'active' ? 'tag-ok' : 'tag-muted'">
              {{ p.status === 'active' ? '在售' : '停售' }}
            </span>
          </td>
          <td class="center">
            <button class="link-btn" type="button" @click="go(`/boss/products/edit/${p.id}`)">编辑</button>
          </td>
        </tr>
        <tr v-if="!pager.paged.value.length">
          <td :colspan="colspan" class="empty">没有符合条件的商品</td>
        </tr>
      </tbody>
    </table>

    <!-- 手机端：卡片列表，同样支持多选 -->
    <ul v-else class="card-list zebra-list">
      <li
        v-for="p in pager.paged.value"
        :key="p.id"
        class="prod-card"
        :class="{ 'is-selected': isSelected(p.id!), 'is-warn': isWarn(p) }"
      >
        <div class="pc-head">
          <label class="pc-check">
            <input type="checkbox" :checked="isSelected(p.id!)" @change="toggleOne(p.id!)" />
            <span class="pc-name">{{ productName(p) }}</span>
          </label>
          <span class="tag" :class="p.status === 'active' ? 'tag-ok' : 'tag-muted'">
            {{ p.status === 'active' ? '在售' : '停售' }}
          </span>
        </div>
        <div class="pc-meta">
          <span>{{ p.category || '未分类' }}</span>
          <span v-if="canSeePurchasePrice">进 ¥{{ money(p.purchasePrice) }}</span>
          <span v-if="canSeeAnyPrice">批 ¥{{ money(p.wholesalePrice) }}</span>
          <span v-if="canSeeAnyPrice">零 ¥{{ money(p.retailPrice) }}</span>
          <span :class="stockClass(p)">库 {{ stockOf(p.id!) }}</span>
          <span v-if="isWarn(p)" class="tag tag-danger">警</span>
        </div>
        <div class="pc-actions">
          <button class="link-btn" type="button" @click="go(`/boss/products/edit/${p.id}`)">编辑</button>
        </div>
      </li>
      <li v-if="!pager.paged.value.length" class="empty">没有符合条件的商品</li>
    </ul>

    <TablePager
      v-model:page="pageProxy"
      :total="pager.total.value"
      :page-count="pager.pageCount.value"
      :size="pager.size.value"
      :size-options="[100, 200, 500]"
      show-jump
    />

    <button v-if="!loading && isMobile" class="fab" type="button" @click="go('/boss/products/new')">＋</button>

    <!-- ================= 导入 ================= -->
    <!-- 阻塞弹窗：点击遮罩不会关闭，避免误触丢掉粘贴的导入内容；按 ESC 可关闭 -->
    <div v-if="showImport" class="overlay">
      <div class="modal">
        <h4>导入商品</h4>
        <p class="modal-tip">
          支持 CSV / TXT（Excel 另存为 CSV 即可）。首行必须是表头，
          必填 <b>品牌</b> 与 <b>型号</b>；系统会按「品牌 + 型号」自动判定重复。
        </p>

        <div class="field">
          <label>① 选择文件</label>
          <input type="file" accept=".csv,.txt" class="file-input" @change="onFile" />
        </div>

        <div class="field">
          <label>② 或直接粘贴表格内容</label>
          <textarea v-model="pasteText" rows="5" placeholder="从 Excel 复制后粘贴到这里" />
        </div>

        <div class="field">
          <label>重复商品处理方式</label>
          <select v-model="dupMode">
            <option value="skip">跳过（保留现有数据，推荐）</option>
            <option value="overwrite">覆盖（用导入数据更新现有商品）</option>
          </select>
        </div>

        <div class="field row-inline">
          <label class="f-check">
            <input v-model="includeInactiveInDedupe" type="checkbox" />
            停售商品也参与重复判定
          </label>
          <button class="link-btn" type="button" @click="downloadTemplate">下载导入模板</button>
        </div>

        <div v-if="importReport" class="report">
          <div class="report-line"><span class="tag tag-ok">新增 {{ importReport.created }}</span></div>
          <div class="report-line"><span class="tag tag-info">更新 {{ importReport.updated }}</span></div>
          <div class="report-line"><span class="tag tag-warn">重复跳过 {{ importReport.skipped }}</span></div>
          <ul v-if="importReport.duplicated.length" class="dup-list">
            <li v-for="(d, i) in importReport.duplicated.slice(0, 20)" :key="i">第 {{ d.line }} 行：{{ d.name }}</li>
            <li v-if="importReport.duplicated.length > 20" class="tip">…另有 {{ importReport.duplicated.length - 20 }} 条</li>
          </ul>
          <ul v-if="importReport.errors?.length" class="dup-list">
            <li v-for="(e, i) in importReport.errors" :key="`e${i}`" class="tip">第 {{ e.line }} 行：{{ e.reason }}</li>
          </ul>
          <ul v-if="importLineErrors.length" class="dup-list">
            <li v-for="(e, i) in importLineErrors.slice(0, 20)" :key="`le${i}`" class="tip">第 {{ e.line }} 行：{{ e.reason }}</li>
            <li v-if="importLineErrors.length > 20" class="tip">…另有 {{ importLineErrors.length - 20 }} 行被跳过</li>
          </ul>
        </div>

        <div class="modal-actions">
          <button class="ghost-btn" type="button" @click="showImport = false">关闭</button>
          <button class="primary-btn" type="button" :disabled="importing || !importRows.length" @click="doImport">
            {{ importing ? '导入中…' : `导入 ${importRows.length || ''} 行`.trim() }}
          </button>
        </div>
      </div>
    </div>

    <!-- ================= 批量编辑 ================= -->
    <!-- 阻塞弹窗：点击遮罩不会关闭；按 ESC 可关闭 -->
    <div v-if="showBulk" class="overlay">
      <div class="modal">
        <h4>批量编辑（{{ selected.length }} 项）</h4>
        <p class="modal-tip">勾选的字段才会写入，未勾选保持不变。</p>

        <label class="f-check"><input v-model="bulk.category.on" type="checkbox" /> 分类</label>
        <input v-if="bulk.category.on" v-model="bulk.category.value" placeholder="统一改成…" />
        <label class="f-check"><input v-model="bulk.unit.on" type="checkbox" /> 单位</label>
        <input v-if="bulk.unit.on" v-model="bulk.unit.value" placeholder="台 / 件 / 套" />
        <label class="f-check"><input v-model="bulk.status.on" type="checkbox" /> 状态</label>
        <select v-if="bulk.status.on" v-model="bulk.status.value">
          <option value="active">在售</option>
          <option value="inactive">停售</option>
        </select>
        <label class="f-check"><input v-model="bulk.warnStock.on" type="checkbox" /> 库存预警值</label>
        <input v-if="bulk.warnStock.on" v-model.number="bulk.warnStock.value" type="number" />
        <label class="f-check"><input v-model="bulk.reprice.on" type="checkbox" /> 按加价率重算批发价 / 零售价</label>
        <p v-if="bulk.reprice.on" class="modal-tip">
          当前规则：批发 +{{ rule.wholesaleRate }}%，零售 +{{ rule.retailRate }}%（在系统设置里修改）
        </p>

        <div class="modal-actions">
          <button class="ghost-btn dismiss" type="button" @click="showBulk = false">取消</button>
          <button class="primary-btn" type="button" @click="doBulkEdit">应用</button>
        </div>
      </div>
    </div>

    <!-- ================= 重复商品 ================= -->
    <!-- 阻塞弹窗：点击遮罩不会关闭；按 ESC 可关闭 -->
    <div v-if="showDup" class="overlay">
      <div class="modal wide">
        <h4>重复商品</h4>
        <p v-if="!dupGroups.length" class="modal-tip">没有发现重名商品，档案很干净。</p>
        <div v-for="g in dupGroups" :key="g.key" class="dup-group">
          <div class="dg-title">{{ g.name }} <span class="tag tag-warn">重复 {{ g.items.length }} 条</span></div>
          <ul>
            <li v-for="it in g.items" :key="it.id">
              <label>
                <input type="radio" :name="`dup-${g.key}`" :value="it.id" :checked="keepMap[g.key] === it.id" @change="keepMap[g.key] = it.id!" />
                保留这条
              </label>
              <span class="dg-stock">库存 {{ it.stock }}</span>
              <span v-if="canSeePurchasePrice">进价 ¥{{ money(it.purchasePrice) }}</span>
              <span v-if="canSeeAnyPrice">批发 ¥{{ money(it.wholesalePrice) }}</span>
              <span class="dg-id">#{{ it.id }}</span>
            </li>
          </ul>
          <div class="dg-actions">
            <button class="ghost-btn sm" type="button" @click="mergeGroup(g)">合并（库存累加 + 单据改指向）</button>
            <button class="ghost-btn sm danger" type="button" @click="deleteGroup(g)">删除多余</button>
          </div>
        </div>
        <div class="modal-actions">
          <button class="ghost-btn" type="button" @click="showDup = false">关闭</button>
          <button v-if="dupGroups.length" class="primary-btn" type="button" @click="mergeAllGroups">一键合并全部</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import SearchInput from '../../components/SearchInput.vue'
import TablePager from '../../components/TablePager.vue'
import LoadingBlock from '../../components/ui/LoadingBlock.vue'
import { useProductStore } from '../../stores/product'
import { useUserStore } from '../../stores/user'
import { useResponsive } from '../../composables/useResponsive'
import { usePermission } from '../../composables/usePermission'
import { usePagination, PAGE_SIZE_PRODUCT } from '../../composables/usePagination'
import { getPriceRule, calcWholesale, calcRetail, type PriceRule } from '../../utils/priceRule'
import {
  buildProductCSV, buildProductTemplate, downloadTextFile, csvToProducts,
  importProducts, findDuplicateProducts, mergeProducts, deleteProducts, bulkUpdateProducts,
  productKeyOf, type DuplicateGroup, type ImportReport, type DuplicateMode
} from '../../utils/productIO'
import { writeLog, AUDIT_ACTIONS } from '../../utils/audit'
import type { Product } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'

const router = useRouter()
const productStore = useProductStore()
const userStore = useUserStore()
const { isMobile } = useResponsive()
const { canSeeAnyPrice, canSeePurchasePrice } = usePermission()

const keyword = ref('')
const category = ref('')
const status = ref('')
// 搜索输入防抖：商品上千时每敲一个字全量 filter 在手机上会卡 100~300ms，
// 这里把实际过滤值延迟 250ms 刷新，边打边出结果但不拖慢输入。
const kwDebounced = ref('')
let kwTimer: ReturnType<typeof setTimeout> | undefined
watch(keyword, v => {
  clearTimeout(kwTimer)
  kwTimer = setTimeout(() => { kwDebounced.value = v }, 250)
})
onUnmounted(() => clearTimeout(kwTimer))

const all = ref<Product[]>([])
const stockMap = ref<Record<number, number>>({})
const selected = ref<number[]>([])

const rule = ref<PriceRule>(getPriceRule())

// ---------------------------------------------------------------- 列表数据

const loading = ref(true)

async function reload(): Promise<void> {
  try {
    const [list, smap] = await Promise.all([productStore.listAll(true), productStore.stockMap()])
    all.value = list
    stockMap.value = smap
  } finally {
    // 无论成功失败都要收起骨架，否则页面会停在占位状态
    loading.value = false
  }
}

const filtered = computed<Product[]>(() => {
  const kw = kwDebounced.value.trim().toLowerCase()
  return all.value.filter(p => {
    if (status.value && p.status !== status.value) return false
    if (category.value && p.category !== category.value) return false
    if (!kw) return true
    return (
      p.brand.toLowerCase().includes(kw) ||
      p.model.toLowerCase().includes(kw) ||
      (p.category ?? '').toLowerCase().includes(kw) ||
      (p.spec ?? '').toLowerCase().includes(kw) ||
      `${p.brand} ${p.model}`.toLowerCase().includes(kw)
    )
  })
})

const pager = usePagination(filtered, PAGE_SIZE_PRODUCT)
// 筛选条件变化回到第一页，避免停在越界页码
watch([category, status], () => pager.reset())
// 防抖后的关键字变化也回第一页，避免搜索结果变少后停在空白页
watch(kwDebounced, () => pager.reset())

const pageProxy = computed({
  get: () => pager.page.value,
  set: v => pager.go(v)
})

const categories = computed(() => {
  const s = new Set<string>()
  for (const p of all.value) if (p.category) s.add(p.category)
  return [...s].sort()
})

const colspan = computed(() => 8 + (canSeePurchasePrice.value ? 1 : 0) + (canSeeAnyPrice.value ? 2 : 0))

function stockOf(id: number): number { return stockMap.value[id] ?? 0 }
function isWarn(p: Product): boolean { return stockOf(p.id!) <= p.warnStock }
function stockClass(p: Product): string {
  const q = stockOf(p.id!)
  if (q <= 0) return 'stock-out'
  if (q <= p.warnStock) return 'stock-low'
  return 'stock-ok'
}
function productName(p: Product): string { return productStore.productName(p) }
function money(n: number): string { return Number(n ?? 0).toLocaleString() }
function go(p: string): void { router.push(p) }

// ---------------------------------------------------------------- 多选

function isSelected(id: number): boolean { return selected.value.includes(id) }
function toggleOne(id: number): void {
  selected.value = isSelected(id) ? selected.value.filter(x => x !== id) : [...selected.value, id]
}
function clearSelection(): void { selected.value = [] }
const pageIds = computed(() => (pager.paged.value as Product[]).map(p => p.id!))
const allChecked = computed(() => pageIds.value.length > 0 && pageIds.value.every(id => isSelected(id)))
const someChecked = computed(() => !allChecked.value && pageIds.value.some(id => isSelected(id)))
function toggleAll(): void {
  selected.value = allChecked.value
    ? selected.value.filter(id => !pageIds.value.includes(id))
    : [...new Set([...selected.value, ...pageIds.value])]
}

/** 所选商品是否「重名」——只有重名才允许合并 */
const canMergeSelected = computed(() => {
  if (selected.value.length < 2) return false
  const keys = new Set(
    all.value.filter(p => selected.value.includes(p.id!)).map(p => productKeyOf(p))
  )
  return keys.size === 1
})

async function mergeSelected(): Promise<void> {
  await mergeProducts(selected.value[0], selected.value)
  showToast('已合并')
  clearSelection()
  await reload()
}

async function removeSelected(): Promise<void> {
  await showConfirmDialog({ title: '删除商品', message: `确认删除所选 ${selected.value.length} 个商品？已被单据引用的会自动保留。` })
  const r = await deleteProducts(selected.value)
  showToast(`删除 ${r.deleted} 个${r.blocked ? `，${r.blocked} 个已被单据引用不能删` : ''}`)
  clearSelection()
  await reload()
}

// ---------------------------------------------------------------- 导入导出

const showImport = ref(false)
const pasteText = ref('')
const dupMode = ref<DuplicateMode>('skip')
const includeInactiveInDedupe = ref(false)
const importing = ref(false)
const importReport = ref<ImportReport | null>(null)

const importRows = computed<Array<Omit<Product, 'id'>>>(() => {
  const src = pasteText.value.trim()
  if (!src) return []
  const { rows, lineErrors } = csvToProducts(src)
  importLineErrors.value = lineErrors
  return rows
})
const importLineErrors = ref<Array<{ line: number; reason: string }>>([])

function openImport(): void { showImport.value = true }
function downloadTemplate(): void {
  downloadTextFile('商品导入模板.csv', buildProductTemplate())
}

function onFile(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    pasteText.value = String(reader.result ?? '')
    importReport.value = null
    showToast(`已读取 ${importRows.value.length} 行`)
  }
  reader.onerror = () => showToast('文件读取失败')
  reader.readAsText(file, 'utf-8')
}

async function doImport(): Promise<void> {
  if (!importRows.value.length) { showToast('没有可导入的数据'); return }
  importing.value = true
  try {
    const report = await importProducts(importRows.value, dupMode.value, includeInactiveInDedupe.value)
    importReport.value = report
    const uid = userStore.currentUser?.id
    if (uid) {
      await writeLog(uid, AUDIT_ACTIONS.PRODUCT_CREATE, `导入商品：新增 ${report.created} / 更新 ${report.updated} / 重复跳过 ${report.skipped}`)
    }
    showToast(`✅ 导入完成：新增 ${report.created}，更新 ${report.updated}，重复 ${report.skipped}`)
    await reload()
  } catch (e: any) {
    showToast('❌ 导入失败：' + (e?.message || '未知错误'))
  } finally {
    importing.value = false
  }
}

async function exportAll(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10)
  const csv = buildProductCSV(filtered.value.map(p => ({
    brand: p.brand, model: p.model, category: p.category, spec: p.spec, unit: p.unit,
    purchasePrice: p.purchasePrice, wholesalePrice: p.wholesalePrice, retailPrice: p.retailPrice,
    warnStock: p.warnStock, status: p.status, remark: p.remark, stock: stockOf(p.id!)
  })))
  downloadTextFile(`商品档案_${stamp}.csv`, csv)
  showToast(`已导出 ${filtered.value.length} 条`)
}

// ---------------------------------------------------------------- 重复检测

const showDup = ref(false)
const dupGroups = ref<DuplicateGroup[]>([])
const keepMap = reactive<Record<string, number>>({})

async function scanDuplicates(): Promise<void> {
  dupGroups.value = await findDuplicateProducts()
  for (const g of dupGroups.value) keepMap[g.key] = g.items[0].id!
  showDup.value = true
  if (dupGroups.value.length) showToast(`发现 ${dupGroups.value.length} 组重名商品`)
}

async function mergeGroup(g: DuplicateGroup): Promise<void> {
  const keep = keepMap[g.key]
  const others = g.items.map(i => i.id!).filter(id => id !== keep)
  const res = await mergeProducts(keep, others)
  showToast(res.message)
  await scanDuplicates()
  await reload()
}

async function mergeAllGroups(): Promise<void> {
  let n = 0
  for (const g of dupGroups.value) {
    const keep = keepMap[g.key]
    const others = g.items.map(i => i.id!).filter(id => id !== keep)
    const r = await mergeProducts(keep, others)
    if (r.ok) n += others.length
  }
  showToast(n ? `共合并 ${n} 条重复商品` : '没有需要合并的商品')
  await scanDuplicates()
  await reload()
}

async function deleteGroup(g: DuplicateGroup): Promise<void> {
  const keep = keepMap[g.key]
  const others = g.items.map(i => i.id!).filter(id => id !== keep)
  await showConfirmDialog({ title: '删除重复商品', message: `删除 ${others.length} 条重复记录？（已被单据引用的会保留）` })
  const r = await deleteProducts(others)
  showToast(`删除 ${r.deleted} 条${r.blocked ? `，${r.blocked} 条已被单据引用` : ''}`)
  await scanDuplicates()
  await reload()
}

// ---------------------------------------------------------------- 批量编辑

const showBulk = ref(false)
const mk = <T,>(v: T) => reactive({ on: false, value: v })
const bulk = reactive({
  category: mk(''),
  unit: mk(''),
  status: mk<'active' | 'inactive'>('active'),
  warnStock: mk(0),
  reprice: { on: false }
})

function openBulkEdit(): void {
  rule.value = getPriceRule()
  showBulk.value = true
}

async function doBulkEdit(): Promise<void> {
  const patch: Partial<Product> = {}
  if (bulk.category.on && bulk.category.value) patch.category = bulk.category.value
  if (bulk.unit.on && bulk.unit.value) patch.unit = bulk.unit.value
  if (bulk.status.on) patch.status = bulk.status.value
  if (bulk.warnStock.on) patch.warnStock = Number(bulk.warnStock.value)

  if (Object.keys(patch).length) await bulkUpdateProducts(selected.value, patch)

  // 按加价率重算：每件商品按自己的成本分别计算
  if (bulk.reprice.on) {
    const targets = await productStore.listAll(true)
    for (const p of targets.filter(x => selected.value.includes(x.id!))) {
      await productStore.updateProduct(p.id!, {
        wholesalePrice: calcWholesale(p.purchasePrice, rule.value),
        retailPrice: calcRetail(p.purchasePrice, rule.value)
      })
    }
  }

  const uid = userStore.currentUser?.id
  if (uid) {
    await writeLog(uid, AUDIT_ACTIONS.PRODUCT_UPDATE, `批量编辑 ${selected.value.length} 个商品`)
  }
  showToast('已应用')
  showBulk.value = false
  clearSelection()
  await reload()
}

// 阻塞弹窗统一规则：点遮罩不关闭；按 ESC 关闭（导入中不响应，避免关掉正在进行的导入）
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (showImport.value && !importing.value) { showImport.value = false; return }
  if (showBulk.value) { showBulk.value = false; return }
  if (showDup.value) { showDup.value = false }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

onMounted(reload)
</script>

<style scoped>
.sel {
  height: 40px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm);
  padding: 0 12px; font-size: 14px; background: #fff; color: var(--c-text); outline: none;
}
.bulk-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px; margin-bottom: 10px; border-radius: 10px;
  background: #eef6ff; color: var(--c-primary); font-size: 14px;
}
.bulk-btn {
  border: 1px solid var(--c-accent); background: #fff; color: var(--c-accent);
  border-radius: 8px; padding: 5px 12px; font-size: 13px; cursor: pointer;
}
.bulk-btn.danger { border-color: var(--c-danger); color: var(--c-danger); }
.bulk-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.bulk-tip { font-size: 12px; color: var(--c-muted); }
.link-btn { border: none; background: none; color: var(--c-accent); cursor: pointer; font-size: 13px; }
.empty { text-align: center; color: var(--c-muted); padding: 24px; }
.fab {
  position: fixed; right: 20px; bottom: 76px; width: 52px; height: 52px; border-radius: 50%;
  border: none; background: var(--c-accent); color: #fff; font-size: 26px; cursor: pointer;
  box-shadow: 0 4px 14px rgba(37,99,235,0.4); z-index: 60;
}
/* 手机卡片 */
.card-list { border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 2px 10px rgba(26,54,93,0.06); }
.prod-card { padding: 12px 14px; border-bottom: 1px solid var(--c-border); }
.prod-card.is-selected { background: #e0ebff; }
.prod-card.is-warn { box-shadow: inset 3px 0 0 var(--c-danger); }
.pc-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.pc-check { display: inline-flex; align-items: center; gap: 8px; }
.pc-name { font-weight: 600; color: var(--c-primary); }
.pc-meta { display: flex; gap: 12px; margin-top: 6px; font-size: 13px; color: var(--c-muted); flex-wrap: wrap; }
.pc-actions { margin-top: 8px; text-align: right; }
/* 弹窗 */
.overlay {
  position: fixed; inset: 0; background: rgba(15,23,42,0.45);
  display: flex; align-items: center; justify-content: center; z-index: 200; padding: 16px;
}
.modal {
  background: #fff; border-radius: 14px; padding: 20px; width: 100%; max-width: 480px;
  max-height: 86vh; overflow: auto; display: flex; flex-direction: column; gap: 10px;
}
.modal.wide { max-width: 720px; }
.modal h4 { color: var(--c-primary); font-size: 16px; }
.modal-tip { font-size: 13px; color: var(--c-muted); line-height: 1.7; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 13px; color: var(--c-muted); }
.row-inline { flex-direction: row; align-items: center; justify-content: space-between; }
.modal input[type='text'], .modal input:not([type]), .modal select, .modal textarea {
  height: 40px; border: 1px solid var(--c-border); border-radius: 8px;
  padding: 8px 12px; font-size: 14px; outline: none; font-family: inherit;
}
.modal textarea { height: auto; resize: vertical; }
.file-input { font-size: 13px; }
.f-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--c-text); }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
.primary-btn {
  height: 40px; padding: 0 18px; border: none; border-radius: 8px;
  background: var(--c-accent); color: #fff; font-size: 14px; cursor: pointer;
}
.ghost-btn {
  height: 40px; padding: 0 14px; border: 1px solid var(--c-border-strong); border-radius: var(--r-sm);
  background: #fff; color: var(--c-text); font-size: 14px; cursor: pointer;
}
.modal .ghost-btn { height: 40px; }
.ghost-btn.sm { height: 30px; padding: 0 10px; font-size: 13px; }
.ghost-btn.danger { border-color: var(--c-danger); color: var(--c-danger); }
/* 弹窗里的取消 / 关闭按钮：橘红实底白字（全站规范 2026-09-20） */
.ghost-btn.dismiss { border-color: var(--c-amber); background: var(--c-amber); color: #fff; font-weight: 600; }
.ghost-btn.dismiss:hover { background: var(--c-amber-hover); border-color: var(--c-amber-hover); color: #fff; }
.ghost-btn.danger.disabled { opacity: 0.4; }
.report { border-top: 1px dashed var(--c-border); padding-top: 8px; font-size: 13px; }
.report-line { margin-bottom: 4px; }
.dup-list { list-style: none; margin-top: 6px; max-height: 140px; overflow: auto; font-size: 12px; color: var(--c-muted); }
.dup-group { border-top: 1px solid var(--c-border); padding-top: 10px; }
.dg-title { font-weight: 600; color: var(--c-primary); margin-bottom: 6px; }
.dg-group ul, .dup-group ul { list-style: none; }
.dup-group li { display: flex; align-items: center; gap: 12px; padding: 5px 0; font-size: 13px; color: var(--c-muted); }
.dg-id { margin-left: auto; }
.dg-actions { display: flex; gap: 8px; margin-top: 6px; }
.tip { color: var(--c-muted); }
</style>
