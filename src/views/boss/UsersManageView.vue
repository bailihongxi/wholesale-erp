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
        <StatCard label="部门数" :value="deptCount" icon="🏢" tone="warning" />
      </div>

      <SectionCard title="员工账号" :desc="`共 ${staff.length} 人`" tight>
        <template #extra>
          <div class="ui-toolbar">
            <input v-model="keyword" class="ui-input f-search" placeholder="搜索姓名 / 工号 / 登录名 / 手机" />
            <select v-model="deptFilter" class="ui-select f-dept" aria-label="部门筛选">
              <option value="">全部部门</option>
              <option v-for="d in deptOptions" :key="d" :value="d">{{ d }}</option>
            </select>
            <select v-model="roleFilter" class="ui-select f-role" aria-label="角色筛选">
              <option value="">全部角色</option>
              <option v-for="r in ROLE_KEYS" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
            </select>
            <select v-model="statusFilter" class="ui-select f-status" aria-label="状态筛选">
              <option value="">全部状态</option>
              <option value="active">在职</option>
              <option value="disabled">停用</option>
            </select>
          </div>
        </template>

        <div v-if="filteredStaff.length" class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-no">工号</th>
              <th>姓名</th>
              <th>登录账号</th>
              <th>部门 / 职位</th>
              <th>角色</th>
              <th class="col-mod">可见模块</th>
              <th class="center">状态</th>
              <th class="center">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in pager.paged.value" :key="u.id">
              <td class="col-no mono">{{ u.employeeNo || '—' }}</td>
              <td class="name-cell">
                <span class="avatar" :class="{ 'is-emoji': !!u.avatar }">
                  {{ u.avatar || (u.name || '?').slice(0, 1) }}
                </span>
                <span class="nm">{{ u.name }}</span>
                <span v-if="u.system" class="ui-badge system-badge" title="系统内置账户，不可修改、不可删除">系统</span>
              </td>
              <td>
                <div class="stack">
                  <span class="stack-main mono">{{ usernameOf(u) }}</span>
                  <span class="stack-sub mono">{{ u.phone }}</span>
                </div>
              </td>
              <td>
                <div class="stack">
                  <span class="stack-main">{{ u.dept || '未分配' }}</span>
                  <span class="stack-sub">{{ u.position || '—' }}</span>
                </div>
              </td>
              <td>
                <span class="ui-badge" :class="roleTone(u.role)">{{ ROLE_LABELS[u.role] ?? u.role }}</span>
              </td>
              <td class="col-mod">
                <div class="mod-cell">
                  <span
                    v-for="m in modulesOfRole(u.role).slice(0, 3)"
                    :key="m.route"
                    class="mod-chip"
                  >{{ m.icon }} {{ m.label }}</span>
                  <span v-if="modulesOfRole(u.role).length > 3" class="mod-more">
                    +{{ modulesOfRole(u.role).length - 3 }}
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
                  <button class="ui-link" type="button" :disabled="!!u.system" :title="u.system ? '系统账户不可修改' : ''" @click="openEdit(u)">编辑</button>
                  <button
                    v-if="u.role !== 'boss' && !u.system"
                    class="ui-link"
                    type="button"
                    @click="doReset(u)"
                  >重置密码</button>
                  <button
                    v-if="u.role !== 'boss' && !u.system"
                    class="ui-link danger"
                    type="button"
                    @click="toggleStatus(u)"
                  >{{ u.status === 'active' ? '停用' : '启用' }}</button>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <EmptyState v-else icon="👤" text="没有匹配的员工" hint="换个关键词，或点右上角新建员工" />

        <TablePager
          v-if="pager.total.value"
          v-model:page="page"
          :page-count="pager.pageCount.value"
          :total="pager.total.value"
          :size="pager.size.value"
          show-jump
        />
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
    <!-- 阻塞弹窗：点击遮罩不会关闭，避免误触丢掉正在编辑的表单；按 ESC 可关闭 -->
    <div v-if="editing" class="modal-mask">
      <div class="modal">
        <div class="modal-head">
          <b>{{ form.id ? '编辑员工' : '新建员工' }}</b>
          <button class="modal-x" type="button" @click="editing = false">✕</button>
        </div>
        <div class="modal-body">
          <!-- ① 账号信息：能不能登、以什么身份登 -->
          <div class="grp">
            <div class="grp-head">
              <span class="grp-title">账号信息</span>
              <span class="grp-line"></span>
            </div>
            <div class="ui-form-grid">
              <label class="ui-field">
                <span class="ui-label">姓名<span class="req">*</span></span>
                <input v-model="form.name" class="ui-input" placeholder="如：张三" />
              </label>
              <label class="ui-field">
                <span class="ui-label">工号</span>
                <input class="ui-input" :value="form.employeeNo || '保存时自动生成'" disabled />
              </label>
              <label class="ui-field">
                <span class="ui-label">登录名<span class="req">*</span></span>
                <input v-model="form.username" class="ui-input" placeholder="3-20 位字母 / 数字 / 下划线" />
              </label>
              <label class="ui-field">
                <span class="ui-label">手机号<span class="req">*</span></span>
                <input v-model="form.phone" class="ui-input" placeholder="11 位手机号，同样可以登录" />
              </label>
              <label class="ui-field">
                <span class="ui-label">
                  {{ form.id ? '重置密码（留空不改）' : '初始密码' }}<span v-if="!form.id" class="req">*</span>
                </span>
                <input
                  v-model="form.password"
                  class="ui-input"
                  :placeholder="form.id ? '留空表示不修改' : `至少 ${PWD_MIN} 位`"
                />
              </label>
              <label class="ui-field">
                <span class="ui-label">角色<span class="req">*</span></span>
                <select v-model="form.role" class="ui-select">
                  <option v-for="r in ROLE_KEYS" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
                </select>
              </label>
            </div>
            <p class="ui-hint role-hint">
              登录名与手机号任填其一即可登录；该角色可见模块：{{ modulesOfRole(form.role).map(m => m.label).join('、') || '未分配' }}
              <span class="to-perm" @click="gotoPerm(form.role)">去配置 →</span>
            </p>
          </div>

          <!-- ② 任职信息 -->
          <div class="grp">
            <div class="grp-head">
              <span class="grp-title">任职信息</span>
              <span class="grp-line"></span>
            </div>
            <div class="ui-form-grid">
              <label class="ui-field">
                <span class="ui-label">部门</span>
                <input v-model="form.dept" class="ui-input" list="staff-dept" placeholder="如：采购部" />
                <datalist id="staff-dept">
                  <option v-for="d in DEPT_SUGGESTIONS" :key="d" :value="d" />
                </datalist>
              </label>
              <label class="ui-field">
                <span class="ui-label">职位</span>
                <input v-model="form.position" class="ui-input" list="staff-position" placeholder="如：采购员" />
                <datalist id="staff-position">
                  <option v-for="p in POSITION_SUGGESTIONS" :key="p" :value="p" />
                </datalist>
              </label>
              <label class="ui-field">
                <span class="ui-label">入职日期</span>
                <input v-model="form.joinDate" class="ui-input" type="date" />
              </label>
            </div>
          </div>

          <!-- ③ 补充信息 -->
          <div class="grp">
            <div class="grp-head">
              <span class="grp-title">补充信息</span>
              <span class="grp-line"></span>
            </div>
            <div class="ui-field">
              <span class="ui-label">头像</span>
              <div class="av-pick">
                <button
                  v-for="a in AVATAR_CHOICES"
                  :key="a"
                  class="av-item"
                  :class="{ on: form.avatar === a }"
                  type="button"
                  @click="form.avatar = form.avatar === a ? '' : a"
                >{{ a }}</button>
                <span class="av-hint">不选则显示姓名首字</span>
              </div>
            </div>
            <label class="ui-field">
              <span class="ui-label">备注</span>
              <textarea v-model="form.remark" class="ui-textarea" rows="2" placeholder="如：负责市区配送"></textarea>
            </label>
          </div>
        </div>
        <div class="modal-foot">
          <button class="ui-btn ui-btn-cancel" type="button" @click="editing = false">取消</button>
          <button class="ui-btn ui-btn-primary" type="button" @click="saveStaff">保存</button>
        </div>
      </div>
    </div>

    <!-- ==================== 重置密码结果 ==================== -->
    <!-- 阻塞弹窗：临时密码只展示一次，点遮罩不会关闭；按 ESC 可关闭 -->
    <div v-if="resetResult" class="modal-mask">
      <div class="modal modal-sm">
        <div class="modal-head">
          <b>密码已重置</b>
          <button class="modal-x" type="button" @click="resetResult = null">✕</button>
        </div>
        <div class="modal-body">
          <p class="ui-hint reset-tip">
            请把下面的临时密码告知「{{ resetResult.name }}」，并提醒他登录后在「我的 → 修改密码」里改成自己的。
            密码以不可逆哈希保存，关闭本窗口后无法再次查看。
          </p>
          <div class="temp-pwd">
            <code>{{ resetResult.password }}</code>
            <button class="ui-btn ui-btn-sm" type="button" @click="copyTemp">复制</button>
          </div>
        </div>
        <div class="modal-foot">
          <button class="ui-btn ui-btn-primary" type="button" @click="resetResult = null">我知道了</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useReloadOnActivate } from '../../composables/useReloadOnActivate'
import { showToast } from 'vant'
import { useUserStore } from '../../stores/user'
import { usePermissionStore } from '../../stores/permission'
import {
  ALL_MODULES, ROLE_LABELS, CONFIGURABLE_ROLES, DEFAULT_ROLE_PERMS, modulesOf,
  type NavItem
} from '../../router/navConfig'
import { usernameOf, type Role, type User } from '../../types'
import { DEPT_SUGGESTIONS, POSITION_SUGGESTIONS } from '../../utils/account'
import { PASSWORD_MIN_LEN as PWD_MIN } from '../../utils/password'
import TablePager from '../../components/TablePager.vue'
import { usePagination, PAGE_SIZE_LIST } from '../../composables/usePagination'
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
const deptFilter = ref('')
const statusFilter = ref('')
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
  if (deptFilter.value && (u.dept ?? '') !== deptFilter.value) return false
  if (statusFilter.value && u.status !== statusFilter.value) return false
  const k = keyword.value.trim().toLowerCase()
  if (!k) return true
  return [u.name, u.employeeNo, usernameOf(u), u.phone]
    .some(v => (v ?? '').toLowerCase().includes(k))
}))
const activeCount = computed(() => staff.value.filter(u => u.status === 'active').length)
// 部门去重（空串 / 未分配不计），供「部门数」统计卡与部门筛选下拉
const deptOptions = computed(() => {
  const set = new Set<string>()
  for (const u of staff.value) if ((u.dept ?? '').trim()) set.add(u.dept!.trim())
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
})
const deptCount = computed(() => deptOptions.value.length)


// 全站统一：列表每页 20 条 + 斑马纹（表格已挂 data-table）
const pager = usePagination(filteredStaff, PAGE_SIZE_LIST)
watch([keyword, roleFilter, deptFilter, statusFilter], () => pager.reset())
const page = computed({ get: () => pager.page.value, set: v => pager.go(v) })

function roleTone(r: string): string {
  return { boss: 'info', purchaser: 'muted', sales: 'success', finance: 'warning', warehouse: 'danger' }[r] ?? 'muted'
}

// ===== 新建 / 编辑 =====
const editing = ref(false)
interface StaffForm {
  id?: number
  name: string
  employeeNo: string
  username: string
  phone: string
  password: string
  role: Role
  dept: string
  position: string
  joinDate: string
  remark: string
  avatar: string
}
const form = reactive<StaffForm>({
  id: undefined, name: '', employeeNo: '', username: '', phone: '', password: '',
  role: 'warehouse', dept: '', position: '', joinDate: '', remark: '', avatar: ''
})

// 头像候选：emoji 选一个，留空则显示姓名首字
const AVATAR_CHOICES = ['😀', '🧑', '👩', '🧔', '👨', '👩‍💼', '🧑‍💼', '👨‍💼', '🐱', '🌟', '🍀', '⚡']

function resetForm(): void {
  form.id = undefined
  form.name = ''
  form.employeeNo = ''
  form.username = ''
  form.phone = ''
  form.password = ''
  form.role = 'warehouse'
  form.dept = ''
  form.position = ''
  form.joinDate = ''
  form.remark = ''
  form.avatar = ''
}

function openCreate(): void {
  resetForm()
  editing.value = true
}

function openEdit(u: User): void {
  form.id = u.id
  form.name = u.name
  form.employeeNo = u.employeeNo ?? ''
  form.username = u.username ?? ''
  form.phone = u.phone
  form.password = ''
  form.role = u.role
  form.dept = u.dept ?? ''
  form.position = u.position ?? ''
  form.joinDate = u.joinDate ?? ''
  form.remark = u.remark ?? ''
  form.avatar = u.avatar ?? ''
  editing.value = true
}

async function saveStaff(): Promise<void> {
  if (!form.name.trim()) { showToast('请填写姓名'); return }
  if (!form.username.trim()) { showToast('请填写登录名'); return }
  if (!/^1\d{10}$/.test(form.phone.trim())) { showToast('请填写正确的 11 位手机号'); return }

  if (form.id) {
    const patch: Partial<User> = {
      name: form.name.trim(),
      username: form.username.trim(),
      phone: form.phone.trim(),
      role: form.role,
      dept: form.dept.trim(),
      position: form.position.trim(),
      joinDate: form.joinDate,
      remark: form.remark.trim(),
      avatar: form.avatar
    }
    if (form.password.trim()) patch.password = form.password.trim()
    const res = await userStore.updateUser(form.id, patch)
    showToast(res.message)
    if (!res.ok) return
  } else {
    if (!form.password.trim()) { showToast('请设置初始密码'); return }
    const res = await userStore.createUser({
      name: form.name.trim(),
      username: form.username.trim(),
      phone: form.phone.trim(),
      password: form.password.trim(),
      role: form.role,
      dept: form.dept.trim(),
      position: form.position.trim(),
      joinDate: form.joinDate,
      remark: form.remark.trim(),
      avatar: form.avatar
    })
    showToast(res.message)
    if (!res.ok) return
  }
  editing.value = false
  await load()
}

// 老板重置员工密码：临时密码只在这次的弹窗里出现一次
const resetResult = ref<{ name: string; password: string } | null>(null)
async function doReset(u: User): Promise<void> {
  if (!u.id) return
  const res = await userStore.resetPassword(u.id)
  showToast(res.message)
  if (res.ok && res.password) resetResult.value = { name: u.name, password: res.password }
}

async function copyTemp(): Promise<void> {
  const pwd = resetResult.value?.password ?? ''
  try {
    await navigator.clipboard.writeText(pwd)
    showToast('已复制临时密码')
  } catch {
    showToast('复制失败，请手动选择文本')
  }
}

async function toggleStatus(u: User): Promise<void> {
  const res = await userStore.setUserStatus(u.id!, u.status === 'active' ? 'disabled' : 'active')
  showToast(res.message)
  if (res.ok) await load()
}

async function load(): Promise<void> {
  staff.value = await userStore.listUsers()
}

// 阻塞弹窗统一规则：点遮罩不关闭；按 ESC 关闭（保存中不响应，避免关掉正在提交的表单）
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (resetResult.value) { resetResult.value = null; return }
  if (editing.value && !saving.value) editing.value = false
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

onMounted(async () => {
  await permStore.ensure()
  selected.value = [...permStore.routesOf(permRole.value)]
  await load()
})

// 回到本页时自动刷新：路由组件被 App.vue 的 <keep-alive> 缓存，
// 从别的页面回来是「复活」而非「重新挂载」，onMounted 不会再跑，数据会停在旧状态。
useReloadOnActivate(load)
</script>

<style scoped>
.system-badge { margin-left: 6px; background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe; }
.ui-link:disabled { opacity: .45; cursor: not-allowed; }
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

/* 表格列：工号窄、可见模块宽 */
.col-no { width: 96px; }
.col-mod { width: 240px; }

/* 堆叠单元格（登录账号 / 部门职位 上下两行） */
.stack { display: flex; flex-direction: column; gap: 2px; }
.stack-main { font-weight: 600; color: var(--c-text); line-height: 1.4; }
.stack-sub { font-size: 12px; color: var(--c-muted); }

/* 操作列 */
.op-cell { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; }

/* 头像：emoji 头像用强调色浅底，与首字头像区分 */
.avatar.is-emoji { background: var(--c-accent-soft); color: var(--c-accent); }

/* 弹窗内分组（账号 / 任职 / 补充） */
.grp { margin-bottom: var(--sp-4); }
.grp-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.grp-title { font-size: 13px; font-weight: 700; color: var(--c-primary); }
.grp-line { flex: 1; height: 1px; background: var(--c-border); }

/* 头像选择 */
.av-pick { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.av-item {
  width: 36px; height: 36px; border-radius: 50%;
  border: 1px solid var(--c-border); background: var(--c-surface);
  font-size: 18px; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.av-item:hover { border-color: #c3cede; }
.av-item.on { border-color: var(--c-accent); box-shadow: 0 0 0 2px var(--c-accent-soft); }
.av-hint { font-size: 12px; color: var(--c-muted); }

/* 重置密码结果：临时密码 + 复制 */
.modal-sm { max-width: 400px; }
.temp-pwd {
  display: flex; align-items: center; gap: 10px;
  margin: 12px 0 4px; padding: 10px 12px;
  background: var(--c-surface-alt); border: 1px dashed var(--c-border-strong);
  border-radius: var(--r-md);
}
.temp-pwd code {
  flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 16px; font-weight: 700; letter-spacing: 1px; color: var(--c-primary);
  word-break: break-all;
}
.reset-tip { line-height: 1.6; }

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
  /* 手机端长表单（如新建员工）可滚动：整体限高，头部/底部固定、主体滚动，
     避免内容超出视口被裁切、确定按钮点不到（用户反馈） */
  display: flex;
  flex-direction: column;
  max-height: 90vh;
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
.modal-body { padding: 18px; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.modal-foot {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--c-border);
  background: var(--c-surface-alt);
}
.role-hint { margin-top: 12px; line-height: 1.6; }
.to-perm { color: var(--c-accent); cursor: pointer; margin-left: 6px; }

/* 员工表手机端：横向滑动代替撑爆屏幕（旧版直接溢出，操作列在屏外点不到） */
.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }

@media (max-width: 767px) {
  .f-search, .f-role, .f-dept, .f-status { width: 100%; }
  .pg-grid { grid-template-columns: 1fr; }
  /* 手机端表格保持最小宽度，左右滑动即可点到最右的「编辑」操作 */
  .table-scroll .data-table { min-width: 660px; }
  /* 「可见模块」列最占宽度，手机端藏起来（模块权限在电脑端配置即可） */
  th.col-mod, td.col-mod { display: none; }
}
</style>
