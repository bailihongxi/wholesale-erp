<template>
  <!-- 出入库流水：采购入库 / 销售出库 / 库存调整的最近记录 -->
  <div class="page">
    <div class="sum-line">最近 {{ records.length }} 条出入库记录</div>

    <LoadingBlock v-if="loading" :rows="6" />

    <template v-else>
      <ul v-if="isMobile" class="zebra-list">
        <li v-for="r in records" :key="r.id" class="flow-card">
          <div class="fc-head">
            <span class="r-type" :class="r.type">{{ typeLabel(r.type) }}</span>
            <span class="r-qty" :class="r.quantity > 0 ? 'in' : 'out'">
              {{ r.quantity > 0 ? '+' : '' }}{{ r.quantity }}
            </span>
          </div>
          <div class="fc-name">{{ r.productName }}</div>
          <div class="fc-sub">{{ fmtDate(r.createdAt) }}</div>
        </li>
        <li v-if="!records.length" class="empty">暂无流水</li>
      </ul>

      <table v-else class="data-table flow-table">
        <thead>
          <tr>
            <th class="center" style="width: 92px">序号</th>
            <th>时间</th>
            <th>类型</th>
            <th>商品</th>
            <th class="num">数量</th>
            <th>关联单号</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in records" :key="r.id">
            <td class="center c-muted">{{ i + 1 }}</td>
            <td class="c-muted">{{ fmtDate(r.createdAt) }}</td>
            <td><span class="ui-badge" :class="r.quantity > 0 ? 'success' : 'muted'">{{ typeLabel(r.type) }}</span></td>
            <td>{{ r.productName }}</td>
            <td class="num" :class="r.quantity > 0 ? 'in' : 'out'">
              <b>{{ r.quantity > 0 ? '+' : '' }}{{ r.quantity }}</b>
            </td>
            <td class="c-muted">{{ r.refOrderId ? `#${r.refOrderId}` : '-' }}</td>
          </tr>
          <tr v-if="!records.length"><td colspan="6" class="empty">暂无流水</td></tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import LoadingBlock from '../../components/ui/LoadingBlock.vue'
import { useResponsive } from '../../composables/useResponsive'
import { db } from '../../db'

interface FlowRow {
  id?: number
  type: string
  productId: number
  productName: string
  quantity: number
  refOrderId?: number
  createdAt: string
}

const { isMobile } = useResponsive()
const records = ref<FlowRow[]>([])
const loading = ref(true)

async function load(): Promise<void> {
  try {
    const rows = await db.stockRecords.orderBy('createdAt').reverse().limit(50).toArray()
    // 商品名一次性查全，避免逐条查库
    const ids = Array.from(new Set(rows.map(r => r.productId)))
    const products = await db.products.bulkGet(ids)
    const nameMap: Record<number, string> = {}
    products.forEach(p => {
      if (p?.id) nameMap[p.id] = `${p.brand} ${p.model}`.trim()
    })
    records.value = rows.map(r => ({
      id: r.id,
      type: r.type,
      productId: r.productId,
      productName: nameMap[r.productId] ?? `商品#${r.productId}`,
      quantity: r.quantity,
      refOrderId: r.refOrderId,
      createdAt: r.createdAt
    }))
  } catch {
    records.value = []
  } finally {
    loading.value = false
  }
}

function typeLabel(t: string): string {
  return t === 'purchase_in' ? '采购入库' : t === 'sale_out' ? '销售出库' : '库存调整'
}
function fmtDate(s: string): string {
  return s ? s.slice(0, 16).replace('T', ' ') : ''
}

onMounted(load)
</script>

<style scoped>
.sum-line { font-size: 12px; color: var(--c-muted); margin-bottom: 10px; }
.c-muted { color: var(--c-muted); }
.flow-table td.in, .in { color: var(--c-success); font-weight: 600; }
.flow-table td.out, .out { color: var(--c-danger); font-weight: 600; }

.zebra-list { list-style: none; }
.flow-card { padding: 12px 14px; border-bottom: 1px solid var(--c-border); }
.flow-card:last-child { border-bottom: none; }
.fc-head { display: flex; justify-content: space-between; align-items: center; }
.r-type { font-size: 12px; padding: 1px 8px; border-radius: 6px; background: var(--c-bg); color: var(--c-text-2); }
.fc-name { font-size: 14px; margin-top: 6px; color: var(--c-text); }
.fc-sub { font-size: 12px; color: var(--c-muted); margin-top: 2px; }
</style>
