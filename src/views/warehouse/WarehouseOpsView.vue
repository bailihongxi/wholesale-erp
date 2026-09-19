<template>
  <div class="ui-page">
    <PageHeader
      title="库存作业"
      sub="入库验货、出库拣货、库存调拨、库存盘点、退换货、库房管理，统一在此处理"
    />

    <SegmentedTabs v-model="tab" :options="tabs" />

    <!-- 六大模块：在库存作业页面内嵌展示，菜单只需一个「库存作业」入口 -->
    <div class="pane">
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
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import InboundView from './InboundView.vue'
import OutboundView from './OutboundView.vue'
import TransferView from './TransferView.vue'
import CountView from './CountView.vue'
import ReturnsView from './ReturnsView.vue'
import LocationsView from './LocationsView.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import SegmentedTabs from '../../components/ui/SegmentedTabs.vue'

type ModuleKey = 'inbound' | 'outbound' | 'transfer' | 'count' | 'returns' | 'locations'

const tabs: Array<{ value: ModuleKey; label: string; icon: string }> = [
  { value: 'inbound', label: '入库验货', icon: '⬇️' },
  { value: 'outbound', label: '出库拣货', icon: '⬆️' },
  { value: 'transfer', label: '库存调拨', icon: '🔁' },
  { value: 'count', label: '库存盘点', icon: '🔍' },
  { value: 'returns', label: '退换货', icon: '↩️' },
  { value: 'locations', label: '库房管理', icon: '🏬' }
]

const route = useRoute()
const tab = ref<ModuleKey>((route.query.tab as ModuleKey) || 'inbound')

// 支持从系统设置等处带 ?tab=locations 直接落到库房管理
watch(() => route.query.tab, q => {
  if (q && tabs.some(t => t.value === q)) tab.value = q as ModuleKey
})
</script>

<style scoped>
.pane { margin-top: var(--sp-4); }
</style>
