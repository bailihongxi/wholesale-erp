import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../src/db'
import { usePermissionStore } from '../src/stores/permission'
import { getNav, DEFAULT_ROLE_PERMS, ALL_MODULES } from '../src/router/navConfig'

/**
 * 角色权限：老板在员工管理里用开关给每个角色分配模块，
 * 保存后该角色登录只看得到勾中的模块。
 */
describe('角色权限配置（模块开关矩阵）', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
  })

  it('未配置时各角色回退到默认权限，菜单不为空', async () => {
    const store = usePermissionStore()
    await store.ensure()

    for (const role of ['purchaser', 'sales', 'finance', 'warehouse']) {
      const routes = store.routesOf(role)
      expect(routes.length, `${role} 默认权限不应为空`).toBeGreaterThan(0)
      expect(routes).toEqual(DEFAULT_ROLE_PERMS[role])
    }
  })

  it('老板恒定全部可见，且不接受配置', async () => {
    const store = usePermissionStore()
    await store.ensure()

    expect(store.canAccess('boss', '/boss/settings')).toBe(true)
    expect(store.canAccess('boss', '/warehouse')).toBe(true)
    // 即便没写进任何权限清单，老板也不能把自己挡在门外
    expect(store.canAccess('boss', '/__not_exist__')).toBe(true)

    const res = await store.setPerms('boss', ['/stock'])
    expect(res.ok).toBe(false)
    expect(res.message).toContain('最高权限')
  })

  it('配置后只保留勾中的模块，未勾中的不可访问', async () => {
    const store = usePermissionStore()
    await store.ensure()

    const res = await store.setPerms('warehouse', ['/warehouse', '/stock'])
    expect(res.ok).toBe(true)

    expect(store.canAccess('warehouse', '/warehouse')).toBe(true)
    expect(store.canAccess('warehouse', '/stock')).toBe(true)
    expect(store.canAccess('warehouse', '/boss/products')).toBe(false)

    const sidebar = store.sidebarOf('warehouse').map(i => i.route)
    expect(sidebar).toEqual(['/warehouse', '/stock'])
  })

  it('配置会持久化到数据库，重新建 store 后仍然生效', async () => {
    const s1 = usePermissionStore()
    await s1.ensure()
    await s1.setPerms('sales', ['/sales/orders'])

    // 模拟刷新页面：换一个 pinia 实例重新加载
    setActivePinia(createPinia())
    const s2 = usePermissionStore()
    await s2.ensure()

    expect(s2.isCustomized('sales')).toBe(true)
    expect(s2.routesOf('sales')).toEqual(['/sales/orders'])
  })

  it('不保存空权限：至少保留一个模块，避免登录后无页面可用', async () => {
    const store = usePermissionStore()
    await store.ensure()

    const res = await store.setPerms('finance', [])
    expect(res.ok).toBe(false)
    expect(res.message).toContain('至少保留一个模块')
  })

  it('过滤非法路由，升级后残留的脏数据不会让菜单崩掉', async () => {
    const store = usePermissionStore()
    await store.ensure()

    await store.setPerms('purchaser', ['/purchase/orders', '/__removed_module__'])
    expect(store.routesOf('purchaser')).toEqual(['/purchase/orders'])
  })

  it('恢复默认：清空自定义后回到 DEFAULT_ROLE_PERMS', async () => {
    const store = usePermissionStore()
    await store.ensure()

    await store.setPerms('warehouse', ['/warehouse'])
    expect(store.isCustomized('warehouse')).toBe(true)

    await store.resetPerms('warehouse')
    expect(store.isCustomized('warehouse')).toBe(false)
    expect(store.routesOf('warehouse')).toEqual(DEFAULT_ROLE_PERMS['warehouse'])
  })

  it('getNav 输出的侧边栏与权限清单一致（模块清单自洽）', () => {
    // 模块清单里不应有重复路由，否则开关矩阵会出现两行指向同一页
    const routes = ALL_MODULES.map(m => m.route)
    expect(new Set(routes).size).toBe(routes.length)

    // 默认权限里的每一项都必须是已登记的模块
    for (const role of Object.keys(DEFAULT_ROLE_PERMS)) {
      for (const r of DEFAULT_ROLE_PERMS[role]) {
        expect(routes, `${role} 的默认权限包含未登记模块 ${r}`).toContain(r)
      }
    }
    expect(getNav('boss').sidebar.length).toBeGreaterThan(0)
  })
})
