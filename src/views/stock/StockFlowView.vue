<template>
  <!-- 出入库流水：采购入库 / 销售出库 / 库存调整的最近记录 -->
  <div class="page">
    <div class="sum-line">最近 {{ pager.total.value }} 条出入库记录</div>

    <LoadingBlock v-if="pager.loading.value" :rows="6" />

    <template v-else>
      <ul v-if="isMobile" class="zebra-list">
        <li v-for="r in pager.paged.value" :key="r.id" class="flow-card">
          <div class="fc-head">
            <span class="r-type" :class="r.type">{{ typeLabel(r.type) }}</span>
            <span class="r-qty" :class="r.quantity > 0 ? 'in' : 'out'">
              {{ r.quantity > 0 ? '+' : '' }}{{ r.quantity }}
            </span>
          </div>
          <div class="fc-name">{{ r.productName }}</div>
          <div class="fc-sub">{{ fmtDate(r.createdAt) }}</div>
        </li>
        <li v-if="!pager.total.value" class="empty">暂无流水</li>
      </ul>

      <table v-else class="data-table flow-table">
        <thead>
          <tr>
            <th class="center" style="width: 92px">序号</th>
            <th>时间</th>
            <th>类型</th>
            <th>商品名称</th>
            <th class="num">数量</th>
            <th>关联单号</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in pager.paged.value" :key="r.id">
            <td class="center c-muted">{{ pager.startIndex.value + i }}</td>
            <td class="c-muted">{{ fmtDate(r.createdAt) }}</td>
            <td><span class="ui-badge" :class="r.quantity > 0 ? 'success' : 'muted'">{{ typeLabel(r.type) }}</span></td>
            <td>{{ r.productName }}</td>
            <td class="num" :class="r.quantity > 0 ? 'in' : 'out'">
              <b>{{ r.quantity > 0 ? '+' : '' }}{{ r.quantity }}</b>
            </td>
            <td class="c-muted">{{ r.refOrderId ? `#${r.refOrderId}` : '-' }}</td>
          </tr>
          <tr v-if="!pager.total.value"><td colspan="6" class="empty">暂无流水</td></tr>
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import LoadingBlock from '../../components/ui/LoadingBlock.vue'
import TablePager from '../../components/TablePager.vue'
import { useResponsive } from '../../composables/useResponsive'
import { useServerPager } from '../../composables/useServerPager'
import { db } from '../../db'
import { serverPage } from '../../db/serverPage'

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

/** 流水列表只用到这几列：云端按列取，不再整行搬（库存流水是增长最快的表） */
const FLOW_FIELDS = 'id,type,productId,quantity,refOrderId,createdAt'

function nameOf(p: any): string {
  return `${p?.brand ?? ''} ${p?.model ?? ''}`.trim()
}

/** 商品表登录后已 warmUp 进内存缓存；命中缓存 = 0 次网络请求，没有则返回 null */
function readProductCache(): any[] | null {
  const t = db.products as any
  return typeof t?.readCache === 'function' ? (t.readCache() as any[] | null) : null
}

/** 补取缓存里没有的商品名：云端走窄字段扫描（只取 id/brand/model），本地回落 bulkGet */
async function fetchProductNames(ids: number[]): Promise<Record<number, string>> {
  const out: Record<number, string> = {}
  if (!ids.length) return out
  const t = db.products as any
  let rows: any[] = []
  if (typeof t?.scanNarrow === 'function') {
    rows = await t.scanNarrow('id,brand,model', (q: any) => q.in('id', ids)).catch(() => [] as any[])
  }
  if (!rows.length) rows = ((await t.bulkGet(ids).catch(() => [] as any[])) ?? []).filter(Boolean)
  for (const p of rows) if (p?.id) out[p.id] = nameOf(p)
  return out
}

// 服务端分页：只拉当前页 + 总数，不再把流水整表（旧实现最多 500 条）拉进内存。
// 商品名只查当前页用到的那些商品，避免逐条查库。
//
// V2.2-1.11 提速：原来是「流水分页 → 拿到 productId → 批量取商品」两段串行
// （实测 1.84s + 0.65s ≈ 2.5s）。现在流水分页发出去的同时就读商品缓存，
// 缓存里没有的商品再补一次窄字段批量查询，绝大多数情况下只剩一趟。
const pager = useServerPager<FlowRow>({
  loader: async (pg, size) => {
    const [res, cachedProducts] = await Promise.all([
      serverPage<any>(db.stockRecords, {
        page: pg,
        pageSize: size,
        orderBy: 'createdAt',
        ascending: false,
        select: FLOW_FIELDS,
      }),
      Promise.resolve(readProductCache() ?? []),
    ])
    const nameMap: Record<number, string> = {}
    for (const p of cachedProducts) if (p?.id) nameMap[p.id] = nameOf(p)
    const miss = Array.from(new Set(res.rows.map(r => r.productId))).filter(id => nameMap[id] == null)
    if (miss.length) Object.assign(nameMap, await fetchProductNames(miss))
    const rows = res.rows
    return {
      rows: rows.map(r => ({
        id: r.id,
        type: r.type,
        productId: r.productId,
        productName: nameMap[r.productId] ?? `商品#${r.productId}`,
        quantity: r.quantity,
        refOrderId: r.refOrderId,
        createdAt: r.createdAt,
      })),
      total: res.total,
    }
  },
})
const page = computed({ get: () => pager.page.value, set: v => pager.go(v) })

function typeLabel(t: string): string {
  return t === 'purchase_in' ? '采购入库' : t === 'sale_out' ? '销售出库' : '库存调整'
}
function fmtDate(s: string): string {
  return s ? s.slice(0, 16).replace('T', ' ') : ''
}

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
