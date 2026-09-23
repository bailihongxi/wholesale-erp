import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// jsdom 环境下需要 fake-indexeddb
import 'fake-indexeddb/auto'

describe('阶段1：数据层 + 登录', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    // 清库后重新初始化
    const { db } = await import('../src/db')
    await db.delete()
    await db.open()
  })

  it('首次启动自动创建默认管理员', async () => {
    const { db, initDefaultAdmin } = await import('../src/db')
    await initDefaultAdmin()
    const admin = await db.users.where('phone').equals('13800000000').first()
    expect(admin).toBeDefined()
    expect(admin?.role).toBe('boss')
    // 第十八轮起默认管理员密码存加盐哈希（pbkdf2$…），不再是明文，避免 F12 抓取
    expect(admin?.password).not.toBe('admin123')
    expect(admin?.password.startsWith('pbkdf2$')).toBe(true)
  })

  it('正确密码登录成功', async () => {
    const { useUserStore } = await import('../src/stores/user')
    const store = useUserStore()
    const res = await store.login('13800000000', 'admin123')
    expect(res.ok).toBe(true)
    expect(store.isLoggedIn).toBe(true)
    expect(store.role).toBe('boss')
  })

  it('错误密码登录失败', async () => {
    const { useUserStore } = await import('../src/stores/user')
    const store = useUserStore()
    const res = await store.login('13800000000', 'wrong')
    expect(res.ok).toBe(false)
    expect(store.isLoggedIn).toBe(false)
  })

  it('不存在的手机号登录失败', async () => {
    const { useUserStore } = await import('../src/stores/user')
    const store = useUserStore()
    const res = await store.login('19900000000', 'whatever')
    expect(res.ok).toBe(false)
  })

  it('老板可以创建员工账号', async () => {
    const { useUserStore } = await import('../src/stores/user')
    const store = useUserStore()
    await store.login('13800000000', 'admin123')
    const res = await store.createUser({
      name: '张三', username: 'zhangsan', phone: '13900000001', password: '123456',
      role: 'purchaser', status: 'active'
    })
    expect(res.ok).toBe(true)
    const users = await store.listUsers()
    // 第二十一轮起：admin + 系统账户 hawsystem + 新建张三 = 3
    expect(users.length).toBe(3)
  })

  it('重复手机号创建失败', async () => {
    const { useUserStore } = await import('../src/stores/user')
    const store = useUserStore()
    await store.createUser({ name: '张三', username: 'zhangsan', phone: '13900000001', password: '123', role: 'purchaser', status: 'active' })
    const res = await store.createUser({ name: '李四', username: 'lisi', phone: '13900000001', password: '456', role: 'sales', status: 'active' })
    expect(res.ok).toBe(false)
  })

  it('不同角色跳转到不同首页', async () => {
    const { useUserStore } = await import('../src/stores/user')
    const store = useUserStore()
    expect(store.homeRouteForRole('boss')).toBe('/boss/home')
    expect(store.homeRouteForRole('purchaser')).toBe('/purchase/home')
    expect(store.homeRouteForRole('sales')).toBe('/sales/home')
    expect(store.homeRouteForRole('finance')).toBe('/finance/home')
    expect(store.homeRouteForRole('warehouse')).toBe('/warehouse/home')
    expect(store.homeRouteForRole('dealer')).toBe('/sales/quotes')
  })

  it('登出后状态清空', async () => {
    const { useUserStore } = await import('../src/stores/user')
    const store = useUserStore()
    await store.login('13800000000', 'admin123')
    expect(store.isLoggedIn).toBe(true)
    store.logout()
    expect(store.isLoggedIn).toBe(false)
  })
})
