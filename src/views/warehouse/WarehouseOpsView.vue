<template>
  <div class="ui-page">
    <!-- embedded 时不重复渲染页头（已被「库存管理」页内 Tab 收纳） -->
    <PageHeader
      v-if="!embedded"
      title="库存作业"
      sub="验货入库、拣货出库、库间调拨、盘点与退换货、库房维护，统一在此处理"
    />
    <div v-else class="sec-line">验货入库、拣货出库、调拨、盘点、退换货与库房维护</div>

    <!-- 模块导航：带待办角标，一眼看出哪里还有活 -->
    <SegmentedTabs v-model="tab" :size="embedded ? 'sm' : 'md'" :options="tabs" />

    <!-- 六大模块：在库存作业页面内嵌展示，菜单只需一个「库存作业」入口 -->
    <div class="tab-pane">
      <InboundView v-if="tab === 'inbound'" />
      <OutboundView v-else-if="tab === 'outbound'" />
      <TransferView v-else-if="tab === 'transfer'" />
      <CountView v-else-if="tab === 'count'" />
      <ReturnsView v-else-if="tab === 'returns'" />
      <LocationsView v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import InboundView from './InboundView.vue'
import OutboundView from './OutboundView.vue'
import TransferView from './TransferView.vue'
import CountView from './CountView.vue'
import ReturnsView from './ReturnsView.vue'
import LocationsView from './LocationsView.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import SegmentedTabs from '../../components/ui/SegmentedTabs.vue'
import { usePurchaseStore } from '../../stores/purchase'
import { useSalesStore } from '../../stores/sales'

type ModuleKey = 'inbound' | 'outbound' | 'transfer' | 'count' | 'returns' | 'locations'

/** 被「库存管理」页内 Tab 收纳时置真：不重复渲染页头，Tab 收小一档 */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const route = useRoute()
const purchaseStore = usePurchaseStore()
const salesStore = useSalesStore()

/** 待收货 / 待发货单数，作为「入库验货 / 出库拣货」的角标 */
const pendingIn = ref(0)
const pendingOut = ref(0)

const tabs = computed(() => [
  { value: 'inbound', label: '入库验货', icon: '⬇️', badge: pendingIn.value },
  { value: 'outbound', label: '出库拣货', icon: '⬆️', badge: pendingOut.value },
  { value: 'transfer', label: '库存调拨', icon: '🔁' },
  { value: 'count', label: '库存盘点', icon: '🔍' },
  { value: 'returns', label: '退换货', icon: '↩️' },
  { value: 'locations', label: '库房管理', icon: '🏬' }
])

const tab = ref<ModuleKey>((route.query.tab as ModuleKey) || 'inbound')

// 支持从系统设置等处带 ?tab=locations 直接落到库房管理
watch(() => route.query.tab, q => {
  if (q && tabs.value.some(t => t.value === q)) tab.value = q as ModuleKey
})

/** 角标随子页操作刷新：切模块时重新取一次，保证「做完一单角标就减一」 */
async function loadBadges(): Promise<void> {
  try {
    const [ins, outs] = await Promise.all([
      purchaseStore.listPendingInbound(),
      salesStore.listPendingOutbound()
    ])
    pendingIn.value = ins.length
    pendingOut.value = outs.length
  } catch {
    /* 数据库尚未就绪时保持无角标，不影响页面使用 */
  }
}

watch(tab, loadBadges)
onMounted(loadBadges)
</script>

<style scoped>
.tab-pane { margin-top: var(--sp-4); }
.sec-line { font-size: 12px; color: var(--c-muted); margin-bottom: var(--sp-2); }
</style>
