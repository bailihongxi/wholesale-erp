import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'

// 强制云端分支：USE_CLOUD 在 vitest 下默认是 false，不 mock 就走不到本次要锁的判定。
// 给一个最小可用的 supabase 替身，只保证 CloudTable 能构造（校验会被下面的 spy 拦下）。
vi.mock('../src/db/supabaseClient', () => ({
  USE_CLOUD: true,
  SUPABASE_URL: 'https://test.supabase.co',
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: { message: 'stub' } })
        })
      })
    })
  }
}))

import { db } from '../src/db'
import { saveSession, clearSession } from '../src/utils/loginGuard'
import { useUserStore } from '../src/stores/user'

/**
 * 会话校验判定（2026-09-25 登录误踢修复）。
 *
 * 背景：cloudDb.get() 在「请求失败」与「查不到」时都返回 undefined，
 * 旧写法 `if (!row || row.status !== 'active')` 会把网络抖动解读成
 * 「账号已停用」并立刻 clearSession —— 弱网、手机切后台再回来就会
 * 被无端踢回登录页。这里锁死新判定：只有**确实查到且已停用**才踢。
 */
describe('会话校验：网络异常不得误踢下线', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    clearSession()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** 带本地快照的 staff 会话：模拟「重启应用后冷启动」 */
  function seedStaffSession(): void {
    saveSession(1, 'staff', {
      id: 1, name: '老板', username: 'admin', phone: '13800000000',
      role: 'boss', status: 'active', createdAt: ''
    })
  }

  it('云端查不到（网络抖动时 cloudDb 返回 undefined）时保持登录，不踢回登录页', async () => {
    seedStaffSession()
    const store = useUserStore()
    const spy = vi.spyOn(db.users, 'get').mockResolvedValue(undefined)

    await store.restoreSession()
    // 让后台校验的那次 get 落地
    await new Promise(r => setTimeout(r, 0))

    expect(spy).toHaveBeenCalled() // 确实去云端校验了，不是跳过
    expect(store.isLoggedIn).toBe(true)
    expect(store.currentUser).not.toBeNull()
    // 会话也不能被清掉
    expect(localStorage.getItem('erp_session')).toBeTruthy()
  })

  it('确实查到且已停用时才踢下线，并清掉本地会话', async () => {
    seedStaffSession()
    const store = useUserStore()
    vi.spyOn(db.users, 'get').mockResolvedValue({
      id: 1, name: '老板', role: 'boss', status: 'disabled'
    })

    await store.restoreSession()
    await new Promise(r => setTimeout(r, 0))

    expect(store.isLoggedIn).toBe(false)
    expect(store.currentUser).toBeNull()
    expect(localStorage.getItem('erp_session')).toBeNull()
  })

  it('查到且状态正常时保持登录', async () => {
    seedStaffSession()
    const store = useUserStore()
    vi.spyOn(db.users, 'get').mockResolvedValue({
      id: 1, name: '老板', role: 'boss', status: 'active'
    })

    await store.restoreSession()
    await new Promise(r => setTimeout(r, 0))

    expect(store.isLoggedIn).toBe(true)
    expect(store.currentUser!.status).toBe('active')
    expect(localStorage.getItem('erp_session')).toBeTruthy()
  })

  it('经销商账号同口径：查不到不踢，已停用才踢', async () => {
    saveSession(9, 'dealer', { id: 9, name: '经销商A', loginPhone: '13700000001', status: 'active' })

    const store = useUserStore()
    const spy = vi.spyOn(db.customers, 'get').mockResolvedValue(undefined)
    await store.restoreSession()
    await new Promise(r => setTimeout(r, 0))
    expect(store.isLoggedIn).toBe(true)
    expect(localStorage.getItem('erp_session')).toBeTruthy()

    // 换成已停用
    clearSession()
    vi.restoreAllMocks()
    saveSession(9, 'dealer', { id: 9, name: '经销商A', loginPhone: '13700000001', status: 'active' })
    const store2 = useUserStore()
    vi.spyOn(db.customers, 'get').mockResolvedValue({ id: 9, name: '经销商A', status: 'disabled' })
    await store2.restoreSession()
    await new Promise(r => setTimeout(r, 0))
    expect(store2.isLoggedIn).toBe(false)
    expect(localStorage.getItem('erp_session')).toBeNull()
    expect(spy).toBeDefined()
  })

  it('云端请求直接抛错（断网 / 超时）时同样保持登录', async () => {
    seedStaffSession()
    const store = useUserStore()
    // 断网时 cloudDb.get 会 reject；必须被 catch 吞掉，绝不能顺带把人踢掉
    vi.spyOn(db.users, 'get').mockRejectedValue(new Error('network down'))

    await store.restoreSession()
    await new Promise(r => setTimeout(r, 0))

    expect(store.isLoggedIn).toBe(true)
    expect(store.currentUser).not.toBeNull()
    expect(localStorage.getItem('erp_session')).toBeTruthy()
  })
})
