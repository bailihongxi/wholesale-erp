import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 回归锁：登录链路必须「永不抛出、永不无限等待」（V2.2-1.9，2026-09-28）。
 *
 * ## 背景（老板实报：换手机登录一直显示「登录中…」）
 *
 * 登录链路全部是云端请求（supabase-js 的 fetch 默认没有超时），而旧实现整条链
 * 没有任何 try/catch、没有超时：换设备（无本地会话快照，必须走真实云端登录）时，
 * 手机所在网络到 Supabase 后端不通/极慢 → fetch 无限挂起 → 登录按钮永远停在
 * 「登录中…」且没有任何报错（老设备正常只是因为本地快照直接恢复会话）。
 *
 * 修法：user.login 包一层 15 秒超时 + 异常转失败文案；登录页 loading 复位改
 * try/finally；initDefaultAdmin 兜底种子失败只告警不阻断。本文件锁定：
 * 「云端全挂时 login 必须返回 ok:false 的失败文案，绝不能 reject」。
 */

vi.mock('../src/db', () => ({
  db: {
    users: {
      count: async () => { throw new Error('simulated network down') },
      where: () => { throw new Error('simulated network down') },
    },
    customers: {
      where: () => { throw new Error('simulated network down') },
    },
    locations: { count: async () => 2 },
    warmUp: () => {},
  },
  localDb: {},
  // 让兜底种子也炸：loginInner 不应被它拖崩
  initDefaultAdmin: async () => { throw new Error('simulated network down') },
  nextEmployeeNo: () => 'E001',
}))

import { useUserStore } from '../src/stores/user'

describe('登录链路兜底：云端全挂时必须返回失败文案，不能 reject', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('云端请求全部抛错时，login 返回「网络异常」而不是抛出异常', async () => {
    const s = useUserStore()
    const res = await s.login('boss', 'admin123')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('网络')
  })

  it('多次失败也不会把 Promise 挂起（可连续调用，每次都有结果）', async () => {
    const s = useUserStore()
    for (let i = 0; i < 3; i++) {
      const res = await Promise.race([
        s.login('boss', 'admin123'),
        new Promise<'HANG'>(resolve => setTimeout(() => resolve('HANG'), 2000)),
      ])
      expect(res, 'login 在 2 秒内必须有结果（不能无限挂起）').not.toBe('HANG')
      expect((res as { ok: boolean }).ok).toBe(false)
    }
  })
})
