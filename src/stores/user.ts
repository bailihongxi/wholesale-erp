import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db, initDefaultAdmin } from '../db'
import type { User, Role } from '../types'

export const useUserStore = defineStore('user', () => {
  const currentUser = ref<User | null>(null)

  const isLoggedIn = computed(() => currentUser.value !== null)
  const role = computed<Role | null>(() => currentUser.value?.role ?? null)
  const isBoss = computed(() => currentUser.value?.role === 'boss')

  async function login(phone: string, password: string): Promise<{ ok: boolean; message: string }> {
    await initDefaultAdmin()
    // 先查员工表
    const user = await db.users.where('phone').equals(phone).first()
    if (user) {
      if (user.status !== 'active') return { ok: false, message: '账号已停用，请联系老板' }
      if (user.password !== password) return { ok: false, message: '密码错误' }
      currentUser.value = user
      localStorage.setItem('erp_current_user_id', String(user.id))
      return { ok: true, message: '登录成功' }
    }
    // 再查经销商表
    const dealer = await db.customers.where('loginPhone').equals(phone).first()
    if (dealer) {
      if (dealer.status !== 'active') return { ok: false, message: '经销商账号已停用' }
      if (dealer.loginPassword !== password) return { ok: false, message: '密码错误' }
      // 经销商以 dealer 角色登录
      currentUser.value = {
        id: dealer.id,
        name: dealer.name,
        phone: dealer.loginPhone!,
        password: '',
        role: 'dealer',
        status: 'active',
        createdAt: ''
      }
      localStorage.setItem('erp_current_dealer_id', String(dealer.id))
      return { ok: true, message: '登录成功' }
    }
    return { ok: false, message: '账号不存在' }
  }

  function logout() {
    currentUser.value = null
    localStorage.removeItem('erp_current_user_id')
  }

  async function restoreSession(): Promise<void> {
    const id = localStorage.getItem('erp_current_user_id')
    if (id) {
      const user = await db.users.get(Number(id))
      if (user && user.status === 'active') {
        currentUser.value = user
      }
    }
  }

  async function createUser(data: Omit<User, 'id' | 'createdAt'>): Promise<{ ok: boolean; message: string }> {
    const existing = await db.users.where('phone').equals(data.phone).first()
    if (existing) return { ok: false, message: '该手机号已注册' }
    await db.users.add({
      ...data,
      createdAt: new Date().toISOString()
    })
    return { ok: true, message: '创建成功' }
  }

  async function listUsers(): Promise<User[]> {
    return await db.users.toArray()
  }

  /** 修改员工资料（姓名 / 角色 / 密码……） */
  async function updateUser(id: number, patch: Partial<User>): Promise<{ ok: boolean; message: string }> {
    const user = await db.users.get(id)
    if (!user) return { ok: false, message: '员工不存在' }
    if (patch.phone && patch.phone !== user.phone) {
      const dup = await db.users.where('phone').equals(patch.phone).first()
      if (dup && dup.id !== id) return { ok: false, message: '该手机号已被其他员工使用' }
    }
    await db.users.update(id, patch)
    return { ok: true, message: '已保存' }
  }

  /** 启用 / 停用账号（停用的员工无法登录） */
  async function setUserStatus(id: number, status: 'active' | 'disabled'): Promise<{ ok: boolean; message: string }> {
    const user = await db.users.get(id)
    if (!user) return { ok: false, message: '员工不存在' }
    if (user.role === 'boss') return { ok: false, message: '老板账号不可停用' }
    await db.users.update(id, { status })
    return { ok: true, message: status === 'active' ? '已启用' : '已停用' }
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
    currentUser, isLoggedIn, role, isBoss,
    login, logout, restoreSession, createUser, listUsers, updateUser, setUserStatus, homeRouteForRole
  }
})
