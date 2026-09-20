<template>
  <!--
    库存管理（第十二轮合并版）
    ------------------------------------------------------------
    原「库存管理」(/stock) 与「库存作业」(/warehouse) 是两个并列菜单，
    业务上同属库存，来回切菜单很啰嗦。现在合并为一个入口：
      · 库存明细 —— 按库房看商品分布 + 出入库流水
      · 库存预警 —— 低于预警线的商品，每页 50 条、斑马纹表格
      · 库存作业 —— 入库验货 / 出库拣货 / 调拨 / 盘点 / 退换货 / 库房管理
    /warehouse 及其子路由全部保留，收藏夹与外部链接不失效。
  -->
  <div class="ui-page">
    <PageHeader title="库存管理" sub="库存作业、明细、预警与流水，统一在这里处理" />

    <!-- 页内模块导航（库存作业整页并入本页） -->
    <SegmentedTabs v-model="tab" :options="tabOptions" />

    <div class="tab-pane">
      <StockDetailView
        v-if="tab === 'detail'"
        :products="products"
        :stock="stockMap"
        :locations="locations"
        :dist="distByProduct"
        :loading="loadingDetail"
      />
      <StockAlertView
        v-else-if="tab === 'alert'"
        :products="products"
        :stock="stockMap"
        :locations="locations"
        :dist="distByProduct"
      />
      <StockFlowView v-else-if="tab === 'flow'" />
      <WarehouseOpsView v-else embedded />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from '../../components/ui/PageHeader.vue'
import SegmentedTabs from '../../components/ui/SegmentedTabs.vue'
import StockDetailView from './StockDetailView.vue'
import StockAlertView from './StockAlertView.vue'
import StockFlowView from './StockFlowView.vue'
import WarehouseOpsView from '../warehouse/WarehouseOpsView.vue'
import { useProductStore } from '../../stores/product'
import { useInventoryStore } from '../../stores/inventory'
import type { Product, Location } from '../../types'

type StockTab = 'detail' | 'alert' | 'flow' | 'ops'

const route = useRoute()
const productStore = useProductStore()
const inventoryStore = useInventoryStore()

// 用户要求：库存作业（入库/出库/调拨/盘点/退换货/库房管理）放到 Tab 第一位
const TAB_KEYS: StockTab[] = ['ops', 'detail', 'alert', 'flow']

const tabOptions = [
  { value: 'ops', label: '库存作业', icon: '🧱' },
  { value: 'detail', label: '库存明细', icon: '📋' },
  { value: 'alert', label: '库存预警', icon: '⚠️' },
  { value: 'flow', label: '出入库流水', icon: '🔄' }
]

const tab = ref<StockTab>(normalize(route.query.tab))

// 同一路径再次进入（如点侧边栏「库存管理」）时组件不会重建，
// 靠监听 query 把 Tab 拉回 URL 指定的模块（没带 query → 默认库存作业）。
watch(() => route.query.tab, v => { tab.value = normalize(v) })

/** 默认落在「库存作业」：进入库存管理先看到日常收发货入口 */
function normalize(v: unknown): StockTab {
  return TAB_KEYS.includes(v as StockTab) ? (v as StockTab) : 'ops'
}

/**
 * 库存数据在本页统一加载后传给子模块：
 * 切 Tab 不再各自重新查库，避免每次切换都闪一次加载。
 */
const products = ref<Product[]>([])
const stockMap = ref<Record<number, number>>({})
const locations = ref<Location[]>([])
const distByProduct = ref<Record<number, Record<number, number>>>({})
const loadingDetail = ref(true)

async function load(): Promise<void> {
  try {
    // 一次性取全部商品与库存，避免逐个商品查库（商品上千时会非常慢）
    const [list, smap] = await Promise.all([
      productStore.listAll(false),
      productStore.stockMap()
    ])
    products.value = list
    stockMap.value = smap
    loadingDetail.value = false

    // 库房分布较重（自愈 + 全量分布），放到首屏之后异步补齐
    await inventoryStore.ensureLocations()
    const [locs] = await Promise.all([
      inventoryStore.listLocations(),
      inventoryStore.reconcileProducts(list.map(p => p.id!))
    ])
    locations.value = locs
    const { byProduct } = await inventoryStore.distributionAll()
    distByProduct.value = byProduct
  } catch {
    /* 数据库未就绪时保持空表，不抛断页面 */
    loadingDetail.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/* 统计卡已下移到「库存明细」子模块（搜索框上方），本页只留 Tab 与内容区 */
.tab-pane { margin-top: var(--sp-3); }
</style>
