import { describe, it, expect, vi } from 'vitest'

// 云端替身：只要 CloudTable 能构造起来，filter() 的真实行为靠下面两个用例锁死
vi.mock('../src/db/supabaseClient', () => ({
  USE_CLOUD: true,
  SUPABASE_URL: 'https://test.supabase.co',
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null, count: 0 })
    })
  }
}))

import { createCloudDb } from '../src/db/cloudDb'

/**
 * CloudTable 的 Dexie 兼容性（2026-09-25 修复）。
 *
 * `db.users.filter(...)` 这种写法是按本地 Dexie 写的，云端 db 却是 CloudTable。
 * CloudTable 只有 where() / orderBy() / queryPage()，**没有 filter()**
 * （filter 只存在于 where() 返回的 CloudQuery 上），所以这类调用在云端会直接
 * 抛 TypeError —— 应收应付空白就是这么来的。这里补上 filter() 并锁死行为，
 * 免得以后再有页面照着 Dexie 的写法写、在云端静默崩掉。
 */
describe('CloudTable.filter()：Dexie 写法在云端不得抛错', () => {
  const cloudDb = createCloudDb()

  it('db 各表都具备 filter 方法（云端不再缺方法）', () => {
    for (const t of ['users', 'payments', 'saleOrders', 'purchaseOrders', 'products']) {
      expect(typeof (cloudDb as any)[t]?.filter, `${t}.filter`).toBe('function')
    }
  })

  it('filter 返回过滤后的数组，且能用 await 直接取到', async () => {
    const table = (cloudDb as any).users
    const spy = vi.spyOn(table, 'toArray').mockResolvedValue([
      { id: 1, status: 'active' },
      { id: 2, status: 'active' },
      { id: 3, status: 'disabled' }
    ])

    const rows = await table.filter((u: any) => u.status === 'active')
    expect(Array.isArray(rows)).toBe(true)
    expect(rows).toHaveLength(2)
    expect(rows.map((r: any) => r.id)).toEqual([1, 2])
    spy.mockRestore()
  })
})
