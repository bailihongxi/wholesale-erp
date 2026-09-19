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

      <table class="data-table">
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
          <tr v-for="(l, i) in locations" :key="l.id">
            <td class="center">{{ i + 1 }}</td>
            <td>
              <template v-if="editingId === l.id">
                <input v-model="editName" class="txt-input inline" type="text" maxlength="20" />
              </template>
              <template v-else>
                <span class="loc-name">{{ l.name }}</span>
                <span v-if="i === 0" class="badge default-badge">默认</span>
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
                  <button class="link-btn muted" type="button" @click="cancelEdit">取消</button>
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
          <tr v-if="!locations.length">
            <td colspan="6" class="empty">还没有库房，请先新增一个</td>
          </tr>
        </tbody>
      </table>

      <p class="foot-tip">
        「{{ locations[0]?.name || '默认库房' }}」是默认库房：入库、出库未另行选择时货物落在这里。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { showToast, showConfirmDialog } from 'vant'
import { useInventoryStore } from '../../stores/inventory'
import { useUserStore } from '../../stores/user'
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

.data-table { width: 100%; border-collapse: collapse; }
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

/* 操作列里的「改名 / 删除」拉开间距，降低误触 */
.op-cell { display: inline-flex; align-items: center; gap: 16px; }
.link-btn { border: none; background: none; color: var(--c-accent); cursor: pointer; font-size: 13px; }
.link-btn.muted { color: var(--c-muted); }
.link-btn.danger { color: var(--c-danger); }
.link-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.empty { text-align: center; color: var(--c-muted); padding: 20px; font-size: 13px; }
.foot-tip { font-size: 12px; color: var(--c-muted); margin-top: 10px; }
</style>
