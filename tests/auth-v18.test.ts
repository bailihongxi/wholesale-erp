import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import { db, initDefaultAdmin } from '../src/db'
import {
  hashPassword, verifyPassword, generateTempPassword, isHashed, PASSWORD_MIN_LEN
} from '../src/utils/password'
import {
  recordFail, checkLock, clearFail, MAX_FAILS, LOCK_MS,
  saveSession, readSession
} from '../src/utils/loginGuard'
import { useUserStore } from '../src/stores/user'

/**
 * 第十八轮：登录体系加固回归测试。
 * 覆盖：密码加盐哈希、用户名/手机号双通道登录、连续失败锁定、
 * 会话 7 天有效期（带 kind 避免串号）、老板重置密码返回临时密码。
 */
describe('第十八轮：登录体系加固', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    localStorage.clear()
  })

  describe('密码哈希', () => {
    it('哈希结果与明文不同，且每次盐不同', async () => {
      const a = await hashPassword('secret1')
      const b = await hashPassword('secret1')
      expect(a).not.toBe('secret1')
      expect(a).not.toBe(b)
      expect(isHashed(a)).toBe(true)
    })

    it('verifyPassword 正确密码返回 ok，错误密码返回 false', async () => {
      const h = await hashPassword('secret1')
      expect((await verifyPassword('secret1', h)).ok).toBe(true)
      expect((await verifyPassword('wrong', h)).ok).toBe(false)
    })

    it('明文老数据仍可校验，并标记 needsUpgrade', async () => {
      const r = await verifyPassword('plain123', 'plain123')
      expect(r.ok).toBe(true)
      expect(r.needsUpgrade).toBe(true)
    })

    it('generateTempPassword 排除易混淆字符且长度达标', () => {
      const pwd = generateTempPassword(8)
      expect(pwd).toHaveLength(8)
      expect(/[0O1lI]/.test(pwd)).toBe(false)
    })

    it('PASSWORD_MIN_LEN 暴露为常量', () => {
      expect(PASSWORD_MIN_LEN).toBeGreaterThanOrEqual(6)
    })
  })

  describe('连续失败锁定', () => {
    it('连续失败达到阈值后锁定，并显示剩余时间', () => {
      let last = checkLock('bob')
      expect(last.locked).toBe(false)
      for (let i = 0; i < MAX_FAILS; i++) last = recordFail('bob')
      expect(last.locked).toBe(true)
      expect(last.remainMs).toBeGreaterThan(0)
      expect(last.remainMs).toBeLessThanOrEqual(LOCK_MS)
    })

    it('清计数后不进入锁定', () => {
      for (let i = 0; i < 3; i++) recordFail('alice')
      clearFail('alice')
      expect(checkLock('alice').locked).toBe(false)
    })
  })

  describe('会话有效期', () => {
    it('保存的会话在有效期内可读、不报过期、带 kind', () => {
      saveSession(1, 'staff')
      const s = readSession()
      expect(s).not.toBeNull()
      expect(s!.expired).toBe(false)
      expect(s!.kind).toBe('staff')
    })

    it('过期会话返回 expired=true', () => {
      localStorage.setItem('erp_session', JSON.stringify({ id: 2, kind: 'staff', expiresAt: Date.now() - 1000 }))
      const s = readSession()
      expect(s!.expired).toBe(true)
    })

    it('经销商会话带 kind=dealer，避免与员工 id 串号', () => {
      saveSession(9, 'dealer')
      expect(readSession()!.kind).toBe('dealer')
    })
  })

  describe('登录与账号体系', () => {
    it('可用用户名登录（与手机号等价）', async () => {
      await initDefaultAdmin()
      const res = await useUserStore().login('admin', 'admin123')
      expect(res.ok).toBe(true)
    })

    it('错误密码触发失败锁定计数', async () => {
      await initDefaultAdmin()
      const store = useUserStore()
      for (let i = 0; i < MAX_FAILS; i++) await store.login('13800000000', 'wrong')
      expect(checkLock('13800000000').locked).toBe(true)
    })

    it('老板重置员工密码后：返回临时密码、旧密码失效、临时密码可用', async () => {
      await initDefaultAdmin()
      const store = useUserStore()
      await store.createUser({ name: '员工', username: 'emp1', phone: '13900000099', password: 'start1', role: 'sales', status: 'active' })
      const emp = await db.users.where('username').equals('emp1').first()
      const res = await store.resetPassword(emp!.id!)
      expect(res.ok).toBe(true)
      expect(res.password).toBeTruthy()
      expect((await store.login('emp1', 'start1')).ok).toBe(false)
      expect((await store.login('emp1', res.password!)).ok).toBe(true)
    })

    it('usesDefaultPassword 对初始老板密码返回 true', async () => {
      await initDefaultAdmin()
      const store = useUserStore()
      await store.login('13800000000', 'admin123')
      expect(await store.usesDefaultPassword()).toBe(true)
    })
  })
})
