import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import { db, initDefaultAdmin } from '../src/db'
import { saveSession, clearSession } from '../src/utils/loginGuard'
import { useUserStore } from '../src/stores/user'

/**
 * 启动不再白屏 3 秒（V2.0-15）。
 *
 * 原根因：路由守卫在启动导航上 `await restoreSession()`，而它每次都要去云端
 * （Supabase 新加坡）拉一次用户档案证实身份，往返 1~3 秒 —— 这段时间
 * `<router-view>` 是空的，于是「先白屏 3 秒才跳登录页 / 工作台」。
 *
 * 修法：登录时把用户档案存成本地快照（剥掉 password），启动时直接就地恢复，
 * 云端校验挪到后台非阻塞跑。下面锁住「有快照时不再读库」这条关键不变量。
 */
describe('V2.0-15：启动恢复不再等云端', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    localStorage.clear()
  })

  it('登录后的会话带本地快照，且不含密码哈希', async () => {
    await initDefaultAdmin()
    const store = useUserStore()
    await store.login('admin', 'admin123')

    const raw = JSON.parse(localStorage.getItem('erp_session')!)
    expect(raw.profile).toBeTruthy()
    expect(raw.profile.role).toBe('boss')
    // 哈希绝不能落 localStorage
    expect(raw.profile.password).toBeUndefined()
    expect(JSON.stringify(raw)).not.toContain('password')
  })

  it('有快照时 restoreSession 不再读库（不再等云端 1~3 秒）', async () => {
    await initDefaultAdmin()
    const store = useUserStore()
    await store.login('admin', 'admin123')
    expect(store.isLoggedIn).toBe(true)

    // 换一个干净 pinia，模拟「重启应用」后冷启动
    setActivePinia(createPinia())
    const fresh = useUserStore()
    expect(fresh.isLoggedIn).toBe(false)

    const spy = vi.spyOn(db.users, 'get')
    await fresh.restoreSession()

    expect(spy).not.toHaveBeenCalled() // 关键：一次库访问都没有
    expect(fresh.isLoggedIn).toBe(true)
    expect(fresh.currentUser!.role).toBe('boss')
    expect(fresh.currentUser!.name).toBe('老板')
    spy.mockRestore()
  })

  it('快照恢复出的账号字段与登录时一致', async () => {
    await initDefaultAdmin()
    const store = useUserStore()
    await store.login('admin', 'admin123')
    const before = { ...store.currentUser! }

    setActivePinia(createPinia())
    const fresh = useUserStore()
    await fresh.restoreSession()

    expect(fresh.currentUser!.id).toBe(before.id)
    expect(fresh.currentUser!.username).toBe(before.username)
    expect(fresh.currentUser!.phone).toBe(before.phone)
    expect(fresh.currentUser!.role).toBe(before.role)
  })

  it('经销商快照可就地恢复，且不需要读客户表', async () => {
    saveSession(9, 'dealer', { id: 9, name: '经销商A', loginPhone: '13700000001', status: 'active' })
    const store = useUserStore()
    await store.restoreSession()

    expect(store.isLoggedIn).toBe(true)
    expect(store.currentUser!.role).toBe('dealer')
    expect(store.currentUser!.name).toBe('经销商A')
  })

  it('老会话（无快照）仍回源一次，并升级成带快照格式', async () => {
    await initDefaultAdmin()
    const u = await db.users.where('username').equals('admin').first()
    saveSession(u!.id!, 'staff') // 老格式：没有 profile

    const store = useUserStore()
    await store.restoreSession()
    expect(store.isLoggedIn).toBe(true)

    // 回源后自动升级，下次启动就不用再等云端了
    const raw = JSON.parse(localStorage.getItem('erp_session')!)
    expect(raw.profile).toBeTruthy()
    expect(raw.profile.role).toBe('boss')
  })

  it('会话过期时即使带快照也要判为过期并清掉', async () => {
    localStorage.setItem(
      'erp_session',
      JSON.stringify({
        id: 1,
        kind: 'staff',
        expiresAt: Date.now() - 1000,
        profile: { id: 1, name: '老板', phone: '13800000000', role: 'boss', status: 'active', createdAt: '' }
      })
    )
    const store = useUserStore()
    await store.restoreSession()

    expect(store.isLoggedIn).toBe(false)
    expect(store.sessionExpired).toBe(true)
    expect(localStorage.getItem('erp_session')).toBeNull()
  })

  it('无会话时 restoreSession 直接收尾，不读库', async () => {
    clearSession()
    const store = useUserStore()
    const spy = vi.spyOn(db.users, 'get')
    await store.restoreSession()
    expect(spy).not.toHaveBeenCalled()
    expect(store.isLoggedIn).toBe(false)
    spy.mockRestore()
  })
})
