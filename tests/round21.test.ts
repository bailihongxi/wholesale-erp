import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import { db, initDefaultAdmin } from '../src/db'
import { useUserStore } from '../src/stores/user'
import { verifyPassword } from '../src/utils/password'

/**
 * 第二十一轮（V1.0-10）：
 * ① 系统内置账户 hawsystem / admina1b22c333：boss 级最高权限，
 *    资料不可改、密码不可重置/修改、不可停用，老库登录时自动补上；
 * ② 记一笔「关联单据」单号选择框 bug：从网格窄列改为独占整行（约 3 倍宽）。
 */

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.users.clear()
  await initDefaultAdmin()
})

describe('系统内置账户 hawsystem', () => {
  it('initDefaultAdmin 自动创建 hawsystem，boss 权限且带 system 标记', async () => {
    const sys = await db.users.where('username').equals('hawsystem').first()
    expect(sys).toBeTruthy()
    expect(sys!.role).toBe('boss')
    expect(sys!.system).toBe(true)
    expect(sys!.status).toBe('active')
    expect(sys!.name).toBe('系统管理员')
  })

  it('hawsystem / admina1b22c333 能正常登录', async () => {
    const store = useUserStore()
    const r = await store.login('hawsystem', 'admina1b22c333')
    expect(r.ok).toBe(true)
    expect(store.isBoss).toBe(true)
    // 密码是 PBKDF2 哈希存储，不是明文
    const row = await db.users.where('username').equals('hawsystem').first()
    expect(row!.password).not.toBe('admina1b22c333')
    expect((await verifyPassword('admina1b22c333', row!.password)).ok).toBe(true)
  })

  it('密码错误不能登录', async () => {
    const store = useUserStore()
    const r = await store.login('hawsystem', 'wrong-password')
    expect(r.ok).toBe(false)
  })

  it('资料不可修改：updateUser 一律拒绝', async () => {
    const store = useUserStore()
    const sys = await db.users.where('username').equals('hawsystem').first()
    const r = await store.updateUser(sys!.id!, { name: '想改名', phone: '13900000000' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('不可修改')
    const after = await db.users.get(sys!.id!)
    expect(after!.name).toBe('系统管理员')
  })

  it('密码不可重置：resetPassword 拒绝', async () => {
    const store = useUserStore()
    const sys = await db.users.where('username').equals('hawsystem').first()
    const r = await store.resetPassword(sys!.id!, 'newpass999')
    expect(r.ok).toBe(false)
    const after = await db.users.get(sys!.id!)
    expect((await verifyPassword('admina1b22c333', after!.password)).ok).toBe(true)
  })

  it('自助改密也被锁定：changePassword 拒绝', async () => {
    const store = useUserStore()
    const sys = await db.users.where('username').equals('hawsystem').first()
    const r = await store.changePassword(sys!.id!, 'admina1b22c333', 'another999')
    expect(r.ok).toBe(false)
    const after = await db.users.get(sys!.id!)
    expect((await verifyPassword('admina1b22c333', after!.password)).ok).toBe(true)
  })

  it('不可停用：setUserStatus disabled 拒绝', async () => {
    const store = useUserStore()
    const sys = await db.users.where('username').equals('hawsystem').first()
    const r = await store.setUserStatus(sys!.id!, 'disabled')
    expect(r.ok).toBe(false)
    const after = await db.users.get(sys!.id!)
    expect(after!.status).toBe('active')
  })

  it('initDefaultAdmin 幂等：重复调用不会建第二个 hawsystem', async () => {
    await initDefaultAdmin()
    await initDefaultAdmin()
    const rows = await db.users.where('username').equals('hawsystem').toArray()
    expect(rows).toHaveLength(1)
  })

  it('原 admin / admin123 保留，不受影响', async () => {
    const admin = await db.users.where('username').equals('admin').first()
    expect(admin).toBeTruthy()
    expect(admin!.role).toBe('boss')
    const store = useUserStore()
    const r = await store.login('admin', 'admin123')
    expect(r.ok).toBe(true)
  })
})

describe('记一笔关联单号框加宽（V1.0-10 bug 修复）', () => {
  it('LedgerView 关联单据字段独占整行 link-field', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/views/finance/LedgerView.vue', 'utf-8')
    expect(src).toContain('ui-field link-field')
    expect(src).toContain('.link-field { grid-column: 1 / -1; }')
    // 输入框列改为 minmax(0,1fr)，桌面端约整行宽（原窄列 ~300px → 整行 ~900px，约 3 倍）
    expect(src).toContain('grid-template-columns: 176px minmax(0, 1fr)')
  })
})
