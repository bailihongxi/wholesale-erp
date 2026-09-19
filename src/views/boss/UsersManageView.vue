<template>
  <div class="ui-page">
    <PageHeader
      title="员工管理"
      sub="维护员工账号，并用开关给每个角色分配可见模块——分配后该角色登录只看得到勾中的功能"
    >
      <template #actions>
        <button v-if="tab === 'staff'" class="ui-btn ui-btn-primary" type="button" @click="openCreate">
          ＋ 新建员工
        </button>
      </template>
    </PageHeader>

    <SegmentedTabs
      v-model="tab"
      :options="[
        { value: 'staff', label: '员工列表', icon: '👥' },
        { value: 'perm', label: '权限配置', icon: '🔐' }
      ]"
    />

    <!-- ==================== 员工列表 ==================== -->
    <div v-if="tab === 'staff'" class="pane">
      <div class="ui-stat-grid">
        <StatCard label="员工总数" :value="staff.length" icon="👥" tone="primary" />
        <StatCard label="在职" :value="activeCount" icon="✅" tone="success" />
        <StatCard label="已停用" :value="staff.length - activeCount" icon="⛔" tone="neutral" />
        <StatCard label="角色数" :value="roleCount" icon="🎭" tone="warning" />
      </div>

      <SectionCard title="员工账号" :desc="`共 ${staff.length} 人`" tight>
        <template #extra>
          <div class="ui-toolbar">
            <input v-model="keyword" class="ui-input f-search" placeholder="搜索姓名 / 手机号" />
            <select v-model="roleFilter" class="ui-select f-role" aria-label="角色筛选">
              <option value="">全部角色</option>
              <option v-for="r in ROLE_KEYS" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
            </select>
          </div>
        </template>

        <table v-if="filteredStaff.length" class="data-table">
          <thead>
            <tr>
              <th>姓名</th>
              <th>登录手机号</th>
              <th>角色</th>
              <th>可见模块</th>
              <th class="center">状态</th>
              <th class="center">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in filteredStaff" :key="u.id">
              <td class="name-cell">
                <span class="avatar">{{ (u.name || '?').slice(0, 1) }}</span>
                {{ u.name }}
              </td>
              <td class="mono">{{ u.phone }}</td>
              <td>
                <span class="ui-badge" :class="roleTone(u.role)">{{ ROLE_LABELS[u.role] ?? u.role }}</span>
              </td>
              <td>
                <div class="mod-cell">
                  <span
                    v-for="m in modulesOfRole(u.role).slice(0, 4)"
                    :key="m.route"
                    class="mod-chip"
                  >{{ m.icon }} {{ m.label }}</span>
                  <span v-if="modulesOfRole(u.role).length > 4" class="mod-more">
                    +{{ modulesOfRole(u.role).length - 4 }}
                  </span>
                  <span v-if="!modulesOfRole(u.role).length" class="ui-hint">未分配</span>
                </div>
              </td>
              <td class="center">
                <span class="ui-badge" :class="u.status === 'active' ? 'success' : 'muted'">
                  {{ u.status === 'active' ? '在职' : '停用' }}
                </span>
              </td>
              <td class="center">
                <span class="op-cell">
                  <button class="ui-link" type="button" @click="openEdit(u)">编辑</button>
                  <button
                    v-if="u.role !== 'boss'"
                    class="ui-link danger"
                    type="button"
                    @click="toggleStatus(u)"
                  >{{ u.status === 'active' ? '停用' : '启用' }}</button>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-else icon="👤" text="没有匹配的员工" hint="换个关键词，或点右上角新建员工" />
      </SectionCard>
    </div>

    <!-- ==================== 权限配置 ==================== -->
    <div v-else class="pane">
      <SectionCard title="按角色分配模块" desc="开关保存后立即生效，该角色下次登录/刷新即可看到新菜单">
        <template #extra>
          <SegmentedTabs
            v-model="permRole"
            :options="CONFIGURABLE_ROLES.map(r => ({ value: r, label: ROLE_LABELS[r], icon: roleIcon(r) }))"
          />
        </template>

        <div class="perm-head">
          <div class="ph-left">
            <span class="ui-label">当前编辑</span>
            <b class="ph-role">{{ ROLE_LABELS[permRole] }}</b>
            <span class="ui-badge" :class="isCustomized(permRole) ? 'warning' : 'muted'">
              {{ isCustomized(permRole) ? '已自定义' : '系统默认' }}
            </span>
            <span class="ui-hint">已选 {{ selected.length }} / {{ ALL_MODULES.length }} 个模块</span>
          </div>
          <div class="ui-toolbar">
            <button class="ui-btn ui-btn-sm" type="button" @click="selectAll">全选</button>
            <button class="ui-btn ui-btn-sm" type="button" @click="selectRecommended">按角色推荐</button>
            <button class="ui-btn ui-btn-sm" type="button" @click="clearAll">清空</button>
          </div>
        </div>

        <div v-for="g in matrix" :key="g.group" class="perm-group">
          <div class="pg-head">
            <span class="pg-title">{{ g.group }}</span>
            <span class="ui-hint">{{ g.items.filter(i => selected.includes(i.route)).length }} / {{ g.items.length }}</span>
            <span class="pg-line"></span>
            <button class="ui-link" type="button" @click="toggleGroup(g)">
              {{ g.items.every(i => selected.includes(i.route)) ? '本组全不选' : '本组全选' }}
            </button>
          </div>
          <div class="pg-grid">
            <label v-for="m in g.items" :key="m.route" class="perm-item" :class="{ on: selected.includes(m.route) }">
              <ToggleSwitch :model-value="selected.includes(m.route)" @update:model-value="v => toggle(m.route, v)" />
              <span class="pi-body">
                <span class="pi-name">{{ m.icon }} {{ m.label }}</span>
                <span class="pi-desc">{{ m.desc }}</span>
              </span>
            </label>
          </div>
        </div>

        <template #foot>
          <button class="ui-btn ui-btn-primary" type="button" :disabled="saving" @click="savePerms">
            {{ saving ? '保存中…' : '💾 保存权限' }}
          </button>
          <button class="ui-btn" type="button" @click="resetPerms">↺ 恢复默认</button>
          <span class="ui-hint">老板为最高权限，不受此处配置影响</span>
        </template>
      </SectionCard>
    </div>

    <!-- ==================== 新建 / 编辑员工 ==================== -->
    <div v-if="editing" class="modal-mask" @click.self="editing = false">
      <div class="modal">
        <div class="modal-head">
          <b>{{ form.id ? '编辑员工' : '新建员工' }}</b>
          <button class="modal-x" type="button" @click="editing = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="ui-form-grid">
            <label class="ui-field">
              <span class="ui-label">姓名<span class="req">*</span></span>
              <input v-model="form.name" class="ui-input" placeholder="如：张三" />
            </label>
            <label class="ui-field">
              <span class="ui-label">登录手机号<span class="req">*</span></span>
              <input v-model="form.phone" class="ui-input" placeholder="11 位手机号" :disabled="!!form.id" />
            </label>
            <label class="ui-field">
              <span class="ui-label">{{ form.id ? '重置密码（留空不改）' : '初始密码' }}<span class="req" v-if="!form.id">*</span></span>
              <input v-model="form.password" class="ui-input" placeholder="如：123456" />
            </label>
            <label class="ui-field">
              <span class="ui-label">角色<span class="req">*</span></span>
              <select v-model="form.role" class="ui-select">
                <option v-for="r in ROLE_KEYS" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
              </select>
            </label>
          </div>
          <p class="ui-hint role-hint">
            该角色可见模块：{{ modulesOfRole(form.role).map(m => m.label).join('、') || '未分配' }}
            <span class="to-perm" @click="gotoPerm(form.role)">去配置 →</span>
          </p>
        </div>
        <div class="modal-foot">
          <button class="ui-btn ui-btn-cancel" type="button" @click="editing = false">取消</button>
          <button class="ui-btn ui-btn-primary" type="button" @click="saveStaff">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { showToast } from 'vant'
import { useUserStore } from '../../stores/user'
import { usePermissionStore } from '../../stores/permission'
import {
  ALL_MODULES, ROLE_LABELS, CONFIGURABLE_ROLES, DEFAULT_ROLE_PERMS, modulesOf,
  type NavItem
} from '../../router/navConfig'
import type { Role, User } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatCard from '../../components/ui/StatCard.vue'
import EmptyState from '../../components/ui/EmptyState.vue'
import SegmentedTabs from '../../components/ui/SegmentedTabs.vue'
import ToggleSwitch from '../../components/ui/ToggleSwitch.vue'

const userStore = useUserStore()
const permStore = usePermissionStore()

const ROLE_KEYS: Role[] = ['boss', 'purchaser', 'sales', 'finance', 'warehouse']
const ROLE_ICON: Record<string, string> = {
  boss: '👑', purchaser: '🛒', sales: '💰', finance: '🧾', warehouse: '🧱'
}
function roleIcon(r: string): string { return ROLE_ICON[r] ?? '👤' }

const tab = ref<'staff' | 'perm'>('staff')
const staff = ref<User[]>([])
const keyword = ref('')
const roleFilter = ref('')
const saving = ref(false)

// ===== 权限配置 =====
const permRole = ref<string>('warehouse')
const selected = ref<string[]>([])
const matrix = computed(() => permStore.matrixOf())

const ALL_MODULE_ROUTES = ALL_MODULES.map(m => m.route)

function modulesOfRole(role: string): NavItem[] {
  return modulesOf(permStore.routesOf(role))
}

function isCustomized(role: string): boolean {
  return permStore.isCustomized(role)
}

function toggle(route: string, on: boolean): void {
  if (on) {
    if (!selected.value.includes(route)) selected.value = [...selected.value, route]
  } else {
    selected.value = selected.value.filter(r => r !== route)
  }
}

function selectAll(): void { selected.value = [...ALL_MODULE_ROUTES] }
function clearAll(): void { selected.value = [] }
function selectRecommended(): void { selected.value = [...(DEFAULT_ROLE_PERMS[permRole.value] ?? [])] }

function toggleGroup(g: { group: string; items: NavItem[] }): void {
  const routes = g.items.map(i => i.route)
  const allOn = routes.every(r => selected.value.includes(r))
  if (allOn) selected.value = selected.value.filter(r => !routes.includes(r))
  else selected.value = Array.from(new Set([...selected.value, ...routes]))
}

// 切换角色时载入该角色当前生效的权限
watch(permRole, () => {
  selected.value = [...permStore.routesOf(permRole.value)]
}, { immediate: true })

async function savePerms(): Promise<void> {
  if (saving.value) return
  saving.value = true
  const res = await permStore.setPerms(permRole.value, selected.value, userStore.currentUser?.id ?? 1)
  saving.value = false
  showToast(res.message)
}

async function resetPerms(): Promise<void> {
  const res = await permStore.resetPerms(permRole.value, userStore.currentUser?.id ?? 1)
  showToast(res.message)
  selected.value = [...permStore.routesOf(permRole.value)]
}

function gotoPerm(role: string): void {
  editing.value = false
  tab.value = 'perm'
  if (CONFIGURABLE_ROLES.includes(role)) permRole.value = role
}

// ===== 员工列表 =====
const filteredStaff = computed(() => staff.value.filter(u => {
  if (roleFilter.value && u.role !== roleFilter.value) return false
  const k = keyword.value.trim()
  if (!k) return true
  return (u.name ?? '').includes(k) || (u.phone ?? '').includes(k)
}))
const activeCount = computed(() => staff.value.filter(u => u.status === 'active').length)
const roleCount = computed(() => new Set(staff.value.map(u => u.role)).size)

function roleTone(r: string): string {
  return { boss: 'info', purchaser: 'muted', sales: 'success', finance: 'warning', warehouse: 'danger' }[r] ?? 'muted'
}

// ===== 新建 / 编辑 =====
const editing = ref(false)
const form = reactive<{ id?: number; name: string; phone: string; password: string; role: Role }>({
  id: undefined, name: '', phone: '', password: '', role: 'warehouse'
})

function openCreate(): void {
  form.id = undefined
  form.name = ''
  form.phone = ''
  form.password = ''
  form.role = 'warehouse'
  editing.value = true
}

function openEdit(u: User): void {
  form.id = u.id
  form.name = u.name
  form.phone = u.phone
  form.password = ''
  form.role = u.role
  editing.value = true
}

async function saveStaff(): Promise<void> {
  if (!form.name.trim()) { showToast('请填写姓名'); return }
  if (!/^\d{6,}$/.test(form.phone.trim())) { showToast('请填写正确的登录手机号'); return }
  if (form.id) {
    const patch: Partial<User> = { name: form.name.trim(), role: form.role }
    if (form.password.trim()) patch.password = form.password.trim()
    const res = await userStore.updateUser(form.id, patch)
    showToast(res.message)
    if (!res.ok) return
  } else {
    if (!form.password.trim()) { showToast('请设置初始密码'); return }
    const res = await userStore.createUser({
      name: form.name.trim(),
      phone: form.phone.trim(),
      password: form.password.trim(),
      role: form.role,
      status: 'active'
    })
    showToast(res.message)
    if (!res.ok) return
  }
  editing.value = false
  await load()
}

async function toggleStatus(u: User): Promise<void> {
  const res = await userStore.setUserStatus(u.id!, u.status === 'active' ? 'disabled' : 'active')
  showToast(res.message)
  if (res.ok) await load()
}

async function load(): Promise<void> {
  staff.value = await userStore.listUsers()
}

onMounted(async () => {
  await permStore.ensure()
  selected.value = [...permStore.routesOf(permRole.value)]
  await load()
})
</script>

<style scoped>
.pane { margin-top: var(--sp-4); }

.f-search { width: 190px; }
.f-role { width: 118px; }

.name-cell { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--c-primary); }
.avatar {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--c-primary-soft); color: var(--c-primary);
  font-size: 12px; font-weight: 700; flex: none;
}
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }

.mod-cell { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.mod-chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 8px; border-radius: var(--r-pill);
  background: var(--c-primary-soft); color: var(--c-text-2);
  font-size: 12px; white-space: nowrap;
}
.mod-more { font-size: 12px; color: var(--c-muted); }

/* ===== 权限配置 ===== */
.perm-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--sp-3); flex-wrap: wrap;
  padding: 12px 14px; margin-bottom: var(--sp-3);
  background: var(--c-surface-alt);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
}
.ph-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ph-role { font-size: 15px; color: var(--c-primary); }

.perm-group { margin-bottom: var(--sp-4); }
.pg-head {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 10px;
}
.pg-title { font-size: 13px; font-weight: 700; color: var(--c-primary); }
.pg-line { flex: 1; height: 1px; background: var(--c-border); }

.pg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 10px;
}
.perm-item {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease;
}
.perm-item:hover { border-color: #c3cede; }
.perm-item.on {
  border-color: var(--c-accent);
  background: var(--c-accent-soft);
}
.pi-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pi-name { font-size: 13.5px; font-weight: 600; color: var(--c-text); }
.pi-desc { font-size: 12px; color: var(--c-muted); line-height: 1.45; }

/* ===== 弹窗 ===== */
.modal-mask {
  position: fixed; inset: 0; z-index: 200;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  background: rgba(16, 32, 60, .42);
  backdrop-filter: blur(2px);
}
.modal {
  width: 100%; max-width: 520px;
  background: var(--c-surface);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-lg);
  overflow: hidden;
}
.modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--c-border);
  color: var(--c-primary);
}
.modal-x {
  border: none; background: none; cursor: pointer;
  font-size: 15px; color: var(--c-muted);
}
.modal-body { padding: 18px; }
.modal-foot {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--c-border);
  background: var(--c-surface-alt);
}
.role-hint { margin-top: 12px; line-height: 1.6; }
.to-perm { color: var(--c-accent); cursor: pointer; margin-left: 6px; }

@media (max-width: 767px) {
  .f-search, .f-role { width: 100%; }
  .pg-grid { grid-template-columns: 1fr; }
}
</style>
