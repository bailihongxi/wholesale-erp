<template>
  <div class="page">
    <!-- 新增库房 -->
    <section class="block">
      <h4 class="sec-title">
        新增库房
        <span class="sec-tip">库房由你自己设定：总仓 / 门店 / 京东仓 / 退货仓…… 入库、出库、调拨、盘点都从这里选</span>
      </h4>
      <div class="add-row">
        <input
          v-model="newName"
          class="txt-input"
          type="text"
          maxlength="20"
          placeholder="库房名称，例如：北京仓"
          @keyup.enter="add"
        />
        <input
          v-model="newRemark"
          class="txt-input remark"
          type="text"
          maxlength="40"
          placeholder="备注（选填）：地址 / 用途"
          @keyup.enter="add"
        />
        <button class="btn primary" type="button" :disabled="busy || !newName.trim()" @click="add">新增</button>
      </div>
    </section>

    <!-- 库房列表 -->
    <section class="block">
      <h4 class="sec-title">
        库房一览（{{ locations.length }}）
        <span class="sec-tip">「库存件数」为该库房当前所有商品的合计件数；有库存的库房需先调拨清空才能删除</span>
      </h4>

      <!-- items-edit：手机端卡片范式的契约类，列序见 <style> 末尾 @media -->
      <table class="data-table items-edit">
        <thead>
          <tr>
            <th class="center" style="width:56px">序号</th>
            <th>库房名称</th>
            <th>备注</th>
            <th class="num" style="width:110px">库存件数</th>
            <th class="num" style="width:110px">商品种数</th>
            <th class="center" style="width:200px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in pager.paged.value" :key="l.id">
            <td class="center">{{ pager.startIndex.value + i }}</td>
            <td>
              <template v-if="editingId === l.id">
                <input v-model="editName" class="txt-input inline" type="text" maxlength="20" />
              </template>
              <template v-else>
                <span class="loc-name">{{ l.name }}</span>
                <!-- 「默认」只给真正的第一条，翻页后不能再按 i===0 兜 -->
                <span v-if="i === 0 && pager.page.value === 1" class="badge default-badge">默认</span>
              </template>
            </td>
            <td>
              <template v-if="editingId === l.id">
                <input v-model="editRemark" class="txt-input inline" type="text" maxlength="40" placeholder="备注（选填）" />
              </template>
              <template v-else>{{ l.remark || '—' }}</template>
            </td>
            <td class="num">{{ totals[l.id!] ?? 0 }}</td>
            <td class="num">{{ kinds[l.id!] ?? 0 }}</td>
            <td class="center">
              <span class="op-cell">
                <template v-if="editingId === l.id">
                  <button class="link-btn" type="button" :disabled="busy" @click="saveEdit(l)">保存</button>
                  <button class="link-btn muted btn-cancel" type="button" @click="cancelEdit">取消</button>
                </template>
                <template v-else>
                  <button class="link-btn" type="button" @click="startEdit(l)">改名</button>
                  <button
                    class="link-btn danger"
                    type="button"
                    :disabled="locations.length <= 1"
                    @click="remove(l)"
                  >
                    删除
                  </button>
                </template>
              </span>
            </td>
          </tr>
          <tr v-if="!pager.total.value">
            <td colspan="6" class="empty">还没有库房，请先新增一个</td>
          </tr>
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

      <p class="foot-tip">
        「{{ locations[0]?.name || '默认库房' }}」是默认库房：入库、出库未另行选择时货物落在这里。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useReloadOnActivate } from '../../composables/useReloadOnActivate'
import { showToast, showConfirmDialog } from 'vant'
import { useInventoryStore } from '../../stores/inventory'
import { useUserStore } from '../../stores/user'
import { usePagination, PAGE_SIZE_LIST } from '../../composables/usePagination'
import TablePager from '../../components/TablePager.vue'
import type { Location } from '../../types'

const inventoryStore = useInventoryStore()
const userStore = useUserStore()

const locations = ref<Location[]>([])
const totals = ref<Record<number, number>>({})
const kinds = ref<Record<number, number>>({})
const newName = ref('')
const newRemark = ref('')
const editingId = ref(0)
const editName = ref('')
const editRemark = ref('')
const busy = ref(false)

function operatorId(): number {
  return userStore.currentUser?.id ?? 1
}


// 全站统一：列表每页 20 条 + 斑马纹（表格已挂 data-table）
const pager = usePagination(locations, PAGE_SIZE_LIST)
watch(locations, () => pager.reset())
const page = computed({ get: () => pager.page.value, set: v => pager.go(v) })

async function load(): Promise<void> {
  await inventoryStore.ensureLocations()
  locations.value = await inventoryStore.listLocations()
  totals.value = await inventoryStore.locationTotals()

  // 商品种数：该库房里数量 > 0 的商品个数
  const { byLocation } = await inventoryStore.distributionAll()
  const k: Record<number, number> = {}
  for (const [locId, map] of Object.entries(byLocation)) {
    k[Number(locId)] = Object.keys(map).length
  }
  kinds.value = k
}

async function add(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const res = await inventoryStore.addLocation(newName.value, newRemark.value, operatorId())
    showToast(res.message)
    if (res.ok) {
      newName.value = ''
      newRemark.value = ''
      await load()
    }
  } finally {
    busy.value = false
  }
}

function startEdit(l: Location): void {
  editingId.value = l.id!
  editName.value = l.name
  editRemark.value = l.remark ?? ''
}

function cancelEdit(): void {
  editingId.value = 0
  editName.value = ''
  editRemark.value = ''
}

async function saveEdit(l: Location): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const res = await inventoryStore.renameLocation(l.id!, editName.value, editRemark.value, operatorId())
    showToast(res.message)
    if (res.ok) {
      cancelEdit()
      await load()
    }
  } finally {
    busy.value = false
  }
}

async function remove(l: Location): Promise<void> {
  const used = totals.value[l.id!] ?? 0
  await showConfirmDialog({
    title: '删除库房',
    message: used > 0
      ? `「${l.name}」还有 ${used} 件库存，需先调拨或出库清空后才能删除。`
      : `删除「${l.name}」后不可恢复（历史单据里的名称仍会保留）。确定删除？`
  }).catch(() => { throw new Error('cancelled') })

  const res = await inventoryStore.deleteLocation(l.id!, operatorId())
  showToast(res.message)
  if (res.ok) await load()
}

onMounted(load)

// 回到本页时自动刷新：路由组件被 App.vue 的 <keep-alive> 缓存，
// 从别的页面回来是「复活」而非「重新挂载」，onMounted 不会再跑，数据会停在旧状态。
useReloadOnActivate(load)
</script>

<style scoped>
.page { max-width: 1100px; margin: 0 auto; }

.add-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.txt-input {
  flex: 1; min-width: 160px; height: 40px; border: 1px solid var(--c-border-strong);
  border-radius: var(--r-sm); padding: 0 12px; font-size: 14px; color: var(--c-text);
  background: #fff; box-sizing: border-box;
}
.txt-input.remark { flex: 1.6; }
.txt-input.inline { height: 32px; min-width: 120px; border-radius: var(--r-xs); font-size: 13px; }
.txt-input:focus { outline: none; border-color: var(--c-accent); }

.btn { height: 40px; border-radius: var(--r-sm); font-size: 14px; cursor: pointer; padding: 0 20px; flex: 0 0 auto; }
.btn.primary { border: none; background: var(--c-accent); color: #fff; }
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }

/* 宽度与边框交给全站 .data-table，避免 collapse 把圆角与斑马纹底色挤掉 */
.data-table th, .data-table td {
  padding: 11px 12px; border-bottom: 1px solid var(--c-border);
  font-size: 14px; text-align: left; color: var(--c-text);
}
.data-table th { background: #f1f5f9; color: var(--c-primary); font-weight: 600; font-size: 13px; }
.data-table .num { text-align: right; }
.data-table .center { text-align: center; }
.loc-name { font-weight: 600; }
.badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; margin-left: 8px; }
.default-badge { background: #ecfdf5; color: var(--c-success); }

/* 操作列里的「改名 / 删除」拉开间距 —— 间距口径统一在 theme.css 的 .op-cell */
.link-btn { border: none; background: none; color: var(--c-accent); cursor: pointer; font-size: 13px; }
/* 取消按钮：橘红实底白字（全站规范 2026-09-20） */
.link-btn.muted { color: #fff; background: var(--c-amber); border-radius: var(--r-xs); padding: 4px 12px; font-weight: 600; }
.link-btn.muted:hover { background: var(--c-amber-hover); }
.link-btn.danger { color: var(--c-danger); }
.link-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.empty { text-align: center; color: var(--c-muted); padding: 20px; font-size: 13px; }
.foot-tip { font-size: 12px; color: var(--c-muted); margin-top: 10px; }

/* ── 手机端：库房一览 → 卡片（V2.1-1.4，与采购/销售开单同一套范式） ──
   列序（thead）：1序号 2库房名称 3备注 4库存件数 5商品种数 6操作
   ⚠️ 往表里插列必须同步改这里的 nth-child 与 order。 */
@media (max-width: 767px) {
  .items-edit, .items-edit tbody { min-width: 0; }
  .items-edit thead { display: none; }
  .items-edit, .items-edit tbody, .items-edit tr, .items-edit td { display: block; width: 100%; }
  .items-edit tbody tr {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px;
    background: #f8fafc; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px;
  }
  .items-edit tbody td { padding: 2px 0; border: none; width: auto; }
  .items-edit tbody td:nth-child(1) { display: none; }                                   /* 序号 */
  .items-edit tbody td:nth-child(2) { width: 100%; font-size: 15px; font-weight: 600; order: 1; }
  .items-edit tbody td:nth-child(3) { order: 2; font-size: 12px; color: var(--c-muted); }  /* 备注 */
  .items-edit tbody td:nth-child(4) { order: 3; margin-left: auto; font-size: 12px; color: var(--c-muted); }
  .items-edit tbody td:nth-child(5) { order: 4; font-size: 12px; color: var(--c-muted); }
  .items-edit tbody td:nth-child(6) { order: 5; width: 100%; }                            /* 操作独占一行 */
  .items-edit tbody td:nth-child(4)::before { content: '库存 '; }
  .items-edit tbody td:nth-child(5)::before { content: '种数 '; }
  .items-edit tbody td::before { font-size: 12px; font-weight: 400; color: var(--c-muted); }
  /* 改名 / 改备注的输入框在卡片里要能撑满，否则手机上只有一小截能点 */
  .items-edit .txt-input.inline { width: 100%; }
  .items-edit tbody td.empty { display: block; width: 100%; }
  .items-edit tfoot tr {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px;
    background: #fff; border-top: 2px solid var(--c-border); padding: 12px 4px 0;
  }
  .items-edit tfoot td { border: none; padding: 0; width: auto; font-size: 13px; }
  .items-edit tfoot td.total-label { text-align: left; font-weight: 700; }
}
</style>
