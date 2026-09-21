import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db, initDefaultAdmin, nextEmployeeNo } from '../db'
import { hashPassword, verifyPassword, generateTempPassword, PASSWORD_MIN_LEN } from '../utils/password'
import { isValidPhone, isValidUsername, normalizeUsername } from '../utils/account'
import {
  MAX_FAILS, checkLock, recordFail, clearFail, remainText,
  saveSession, readSession, touchSession, clearSession, type LockState
} from '../utils/loginGuard'
import type { User, Role, Customer } from '../types'

export interface LoginResult {
  ok: boolean
  message: string
}

/** 新建员工入参：登录名与手机号各需唯一 */
export interface CreateUserInput {
  name: string
  username: string
  phone: string
  password: string
  role: Role
  dept?: string
  position?: string
  joinDate?: string
  remark?: string
  avatar?: string
}

/** 内置老板密码：仍在用它时工作台顶部会给一条温和提醒 */
const BUILTIN_PASSWORD = 'admin123'

export const useUserStore = defineStore('user', () => {
  const currentUser = ref<User | null>(null)
  /** 上次是因为「登录状态过期」被踢出来的 —— 登录页据此给一句提示 */
  const sessionExpired = ref(false)

  const isLoggedIn = computed(() => currentUser.value !== null)
  const role = computed<Role | null>(() => currentUser.value?.role ?? null)
  const isBoss = computed(() => currentUser.value?.role === 'boss')

  function failMessage(s: LockState): string {
    if (s.locked) return `密码连续输错 ${MAX_FAILS} 次，账号已锁定，请 ${remainText(s.remainMs)} 后再试`
    const left = MAX_FAILS - s.count
    return left <= 2 ? `密码错误，还可以再试 ${left} 次` : '密码错误'
  }

  /** 登录名优先、手机号兜底；登录名不区分大小写 */
  async function findUser(account: string): Promise<User | undefined> {
    const key = account.trim()
    if (!key) return undefined
    const byName = await db.users.where('username').equals(normalizeUsername(key)).first()
    if (byName) return byName
    return await db.users.where('phone').equals(key).first()
  }

  /** 经销商复用客户表记录，这里统一转成 User 形状供各页面读取 */
  function dealerAsUser(dealer: Customer): User {
    return {
      id: dealer.id,
      username: dealer.loginPhone ?? '',
      employeeNo: '',
      name: dealer.name,
      phone: dealer.loginPhone ?? '',
      password: '',
      role: 'dealer',
      status: 'active',
      createdAt: ''
    }
  }

  /**
   * 登录：账号支持「登录名」或「手机号」两种写法。
   * 顺序 —— 查员工 → 查经销商；密码走哈希校验，老数据（明文）通过后自动升级。
   * 连续失败会被 utils/loginGuard 计数并锁定。
   */
  async function login(account: string, password: string): Promise<LoginResult> {
    await initDefaultAdmin()
    const key = account.trim()
    const lockKey = normalizeUsername(key)

    const lock = checkLock(lockKey)
    if (lock.locked) {
      return { ok: false, message: `账号已锁定，请 ${remainText(lock.remainMs)} 后再试` }
    }

    const user = await findUser(key)
    if (user) {
      if (user.status !== 'active') return { ok: false, message: '账号已停用，请联系老板' }

      const verified = await verifyPassword(password, user.password)
      if (!verified.ok) return { ok: false, message: failMessage(recordFail(lockKey)) }
      clearFail(lockKey)

      const now = new Date().toISOString()
      if (user.id) {
        const patch: Partial<User> = { lastLoginAt: now }
        // 明文或低强度老哈希：登录成功后静默升级为 PBKDF2，员工无感
        if (verified.needsUpgrade) patch.password = await hashPassword(password)
        await db.users.update(user.id, patch)
      }
      const fresh = { ...user, lastLoginAt: now }
      currentUser.value = fresh
      if (user.id) saveSession(user.id, 'staff')
      sessionExpired.value = false
      db.warmUp() // 后台预拉常用表，不阻塞登录
      return { ok: true, message: '登录成功' }
    }

    // 经销商：仍是手机号登录，密码沿用客户表自带字段（不纳入员工档案体系）
    const dealer = await db.customers.where('loginPhone').equals(key).first()
    if (dealer) {
      if (dealer.status !== 'active') return { ok: false, message: '经销商账号已停用' }
      if (dealer.loginPassword !== password) {
        return { ok: false, message: failMessage(recordFail(lockKey)) }
      }
      clearFail(lockKey)
      currentUser.value = dealerAsUser(dealer)
      if (dealer.id) saveSession(dealer.id, 'dealer')
      sessionExpired.value = false
      db.warmUp()
      return { ok: true, message: '登录成功' }
    }

    // 账号不存在也计一次失败，避免用返回文案反推哪些账号存在
    recordFail(lockKey)
    return { ok: false, message: '账号或密码错误' }
  }

  function logout(): void {
    currentUser.value = null
    sessionExpired.value = false
    clearSession()
  }

  /**
   * 恢复登录态（刷新页面 / 重开应用时）。
   * 会话有效期 7 天且滑动续期：期间只要用过一次就顺延，闲置满 7 天才需要重新登录。
   */
  async function restoreSession(): Promise<void> {
    const session = readSession()
    if (!session) {
      currentUser.value = null
      return
    }
    if (session.expired) {
      clearSession()
      currentUser.value = null
      sessionExpired.value = true
      return
    }

    if (session.kind === 'dealer') {
      const dealer = await db.customers.get(session.id)
      if (!dealer || dealer.status !== 'active') {
        clearSession()
        currentUser.value = null
        return
      }
      currentUser.value = dealerAsUser(dealer)
      touchSession()
      db.warmUp()
      return
    }

    const user = await db.users.get(session.id)
    if (!user || user.status !== 'active') {
      clearSession()
      currentUser.value = null
      return
    }
    currentUser.value = user
    touchSession()
    db.warmUp()
  }

  async function createUser(input: CreateUserInput): Promise<{ ok: boolean; message: string }> {
    const name = (input.name ?? '').trim()
    const username = normalizeUsername(input.username)
    const phone = (input.phone ?? '').trim()

    if (!name) return { ok: false, message: '请填写姓名' }
    if (!isValidUsername(username)) return { ok: false, message: '登录名需 3-20 位字母、数字或下划线' }
    if (!isValidPhone(phone)) return { ok: false, message: '请填写 11 位手机号' }
    if ((input.password ?? '').length < PASSWORD_MIN_LEN) {
      return { ok: false, message: `初始密码不能少于 ${PASSWORD_MIN_LEN} 位` }
    }
    if (await db.users.where('username').equals(username).first()) {
      return { ok: false, message: `登录名「${username}」已被使用` }
    }
    if (await db.users.where('phone').equals(phone).first()) {
      return { ok: false, message: '该手机号已被其他员工使用' }
    }

    await db.users.add({
      name,
      username,
      phone,
      employeeNo: await nextEmployeeNo(),
      password: await hashPassword(input.password),
      role: input.role,
      status: 'active',
      dept: input.dept ?? '',
      position: input.position ?? '',
      joinDate: input.joinDate ?? '',
      remark: input.remark ?? '',
      avatar: input.avatar ?? '',
      createdAt: new Date().toISOString()
    })
    return { ok: true, message: '创建成功' }
  }

  /** 员工列表：按工号排序，未编工号的老账号排在最后 */
  async function listUsers(): Promise<User[]> {
    const rows = await db.users.toArray()
    return rows.sort((a, b) => (a.employeeNo ?? '').localeCompare(b.employeeNo ?? '', 'zh-CN'))
  }

  /** 修改员工资料；传了 password 就按明文重新哈希，留空表示不改密码 */
  async function updateUser(id: number, patch: Partial<User>): Promise<{ ok: boolean; message: string }> {
    const user = await db.users.get(id)
    if (!user) return { ok: false, message: '员工不存在' }
    if (user.system) return { ok: false, message: '系统内置账户不可修改' }

    const next: Partial<User> = { ...patch }

    if (patch.username !== undefined) {
      const username = normalizeUsername(patch.username)
      if (!isValidUsername(username)) return { ok: false, message: '登录名需 3-20 位字母、数字或下划线' }
      const dup = await db.users.where('username').equals(username).first()
      if (dup && dup.id !== id) return { ok: false, message: `登录名「${username}」已被使用` }
      next.username = username
    }

    if (patch.phone !== undefined && patch.phone !== user.phone) {
      const phone = (patch.phone ?? '').trim()
      if (!isValidPhone(phone)) return { ok: false, message: '请填写 11 位手机号' }
      const dup = await db.users.where('phone').equals(phone).first()
      if (dup && dup.id !== id) return { ok: false, message: '该手机号已被其他员工使用' }
      next.phone = phone
    }

    if (patch.password !== undefined) {
      const plain = (patch.password ?? '').trim()
      if (!plain) {
        delete next.password
      } else {
        if (plain.length < PASSWORD_MIN_LEN) {
          return { ok: false, message: `密码不能少于 ${PASSWORD_MIN_LEN} 位` }
        }
        next.password = await hashPassword(plain)
      }
    }

    await db.users.update(id, next)
    if (currentUser.value?.id === id) currentUser.value = { ...currentUser.value, ...next }
    return { ok: true, message: '已保存' }
  }

  /** 启用 / 停用账号（停用的员工无法登录） */
  async function setUserStatus(id: number, status: 'active' | 'disabled'): Promise<{ ok: boolean; message: string }> {
    const user = await db.users.get(id)
    if (!user) return { ok: false, message: '员工不存在' }
    if (user.system) return { ok: false, message: '系统内置账户不可停用' }
    if (user.role === 'boss') return { ok: false, message: '老板账号不可停用' }
    if (user.id === currentUser.value?.id) return { ok: false, message: '不能停用当前登录的账号' }
    if (status === 'disabled') {
      const active = await db.users.filter(u => u.status === 'active').count()
      if (active <= 1) return { ok: false, message: '至少要保留一个可登录的账号' }
    }
    await db.users.update(id, { status })
    return { ok: true, message: status === 'active' ? '已启用' : '已停用' }
  }

  /** 员工自助改密：必须验旧密码 */
  async function changePassword(
    id: number, oldPassword: string, newPassword: string
  ): Promise<{ ok: boolean; message: string }> {
    const user = await db.users.get(id)
    if (!user) return { ok: false, message: '账号不存在' }
    if (user.system) return { ok: false, message: '系统内置账户密码不可修改' }
    if (newPassword.length < PASSWORD_MIN_LEN) {
      return { ok: false, message: `新密码不能少于 ${PASSWORD_MIN_LEN} 位` }
    }
    if (newPassword === oldPassword) return { ok: false, message: '新密码不能与原密码相同' }
    const verified = await verifyPassword(oldPassword, user.password)
    if (!verified.ok) return { ok: false, message: '原密码不正确' }

    const hashed = await hashPassword(newPassword)
    await db.users.update(id, { password: hashed })
    if (currentUser.value?.id === id) currentUser.value = { ...currentUser.value, password: hashed }
    return { ok: true, message: '密码已修改' }
  }

  /**
   * 老板重置员工密码：返回**临时密码**，只在这一次的返回值里出现。
   * 密码哈希不可逆，所以「忘了密码」只能走重置，不能查看。
   */
  async function resetPassword(
    id: number, tempPassword?: string
  ): Promise<{ ok: boolean; message: string; password?: string }> {
    const user = await db.users.get(id)
    if (!user) return { ok: false, message: '员工不存在' }
    if (user.system) return { ok: false, message: '系统内置账户密码不可重置' }
    const pwd = (tempPassword ?? '').trim() || generateTempPassword()
    if (pwd.length < PASSWORD_MIN_LEN) {
      return { ok: false, message: `临时密码不能少于 ${PASSWORD_MIN_LEN} 位` }
    }
    const hashed = await hashPassword(pwd)
    await db.users.update(id, { password: hashed })
    if (currentUser.value?.id === id) currentUser.value = { ...currentUser.value, password: hashed }
    return { ok: true, message: '已重置密码', password: pwd }
  }

  /** 老板是否还在用内置默认密码 —— 只用于那条可关闭的提醒，不做强制 */
  async function usesDefaultPassword(): Promise<boolean> {
    const u = currentUser.value
    if (!u || u.role !== 'boss' || !u.password) return false
    return (await verifyPassword(BUILTIN_PASSWORD, u.password)).ok
  }

  function homeRouteForRole(r: Role | null): string {
    switch (r) {
      case 'boss': return '/boss/home'
      case 'purchaser': return '/purchase/home'
      case 'sales': return '/sales/home'
      case 'finance': return '/finance/home'
      case 'warehouse': return '/warehouse/home'
      case 'dealer': return '/dealer/catalog'
      default: return '/login'
    }
  }

  return {
    currentUser, sessionExpired, isLoggedIn, role, isBoss,
    login, logout, restoreSession,
    createUser, listUsers, updateUser, setUserStatus,
    changePassword, resetPassword, usesDefaultPassword,
    homeRouteForRole
  }
})
