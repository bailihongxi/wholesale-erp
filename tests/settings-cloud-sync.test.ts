/**
 * 系统设置云端同步回归测试（V2.0-6）
 *
 * 背景：系统设置原本全在 localStorage，每台设备各一份 ——
 * 电脑上改了公司抬头，手机上还是旧的，打印出来的单据抬头都不一样。
 * 本测试守住「多设备共用一份设置」这条链路。
 *
 * 关键点：
 * - A 部分守安全边界：登录态 / 会话绝不能被同步到别的设备；
 * - B/C 部分守同步正确性：首迁 + last-write-wins 冲突判定；
 * - D 部分守优雅降级：表没建、断网时不能影响本机使用。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ------------------------------------------------------------------
// 假云端：内存版 systemSettings 表，行为对齐 PostgREST
// ------------------------------------------------------------------
interface Row { key: string; value: unknown; updatedAt: string }

const g = globalThis as unknown as {
  __settingsTable: Map<string, Row>
  __settingsTableBroken: boolean
}

function rows(): Map<string, Row> {
  if (!g.__settingsTable) g.__settingsTable = new Map()
  return g.__settingsTable
}

/** 让表「不可用」：模拟还没执行迁移 SQL 或断网 */
function breakTable(): void {
  g.__settingsTableBroken = true
}

function makeBuilder(): any {
  let mode: 'select' | 'upsert' | 'delete' = 'select'
  let headOnly = false
  let eqField: string | null = null
  let eqValue: unknown = null
  let payload: any = null

  function exec(): any {
    if (g.__settingsTableBroken) {
      // 真实 PostgREST 行为：表不存在时 head 请求 **不报错**，
      // 只是 count 为 null（普通 select 才返回 PGRST205 错误）。
      // 这里必须如实还原，否则测不出「表没建却显示已连接」的误判。
      if (mode === 'select' && headOnly) return { data: null, count: null, error: null }
      return { data: null, count: null, error: { message: 'relation does not exist' } }
    }
    if (mode === 'upsert') {
      rows().set(payload.key, { key: payload.key, value: payload.value, updatedAt: payload.updatedAt })
      return { data: null, error: null }
    }
    if (mode === 'delete') {
      if (eqField === 'key') rows().delete(String(eqValue))
      return { data: null, error: null }
    }
    // select
    const all = [...rows().values()]
    if (headOnly) return { data: null, count: all.length, error: null }
    return { data: all.map(r => ({ key: r.key, value: r.value, updatedAt: r.updatedAt })), error: null }
  }

  const api: any = {
    select(_cols: string, opts?: { head?: boolean }) {
      headOnly = !!opts?.head
      mode = 'select'
      return api
    },
    upsert(row: any, _opts?: { onConflict?: string }) {
      mode = 'upsert'
      payload = row
      return api
    },
    delete() {
      mode = 'delete'
      return api
    },
    eq(field: string, value: unknown) {
      eqField = field
      eqValue = value
      return api
    },
    then(resolve: (v: any) => unknown) {
      return Promise.resolve(exec()).then(resolve)
    }
  }
  return api
}

vi.mock('../src/db/supabaseClient', () => ({
  USE_CLOUD: true,
  supabase: { from: (_t: string) => makeBuilder() }
}))

// 动态 import 必须在 mock 之后
const {
  isSyncKey, touchSetting, forgetSetting, pullSettings, pushPending,
  initSettingSync, getSyncSummary, SYNC_KEYS
} = await import('../src/utils/settingsSync')

const META_KEY = 'erp_settings_sync_meta'

// 等待 touchSetting 里那个「不 await 的异步推送」跑完
const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0))

describe('系统设置云端同步（V2.0-6）', () => {
  beforeEach(() => {
    localStorage.clear()
    rows().clear()
    g.__settingsTableBroken = false
    // 清空本机同步时间戳
    localStorage.removeItem(META_KEY)
  })

  // ---------------- A. 安全边界 ----------------
  describe('同步范围白名单', () => {
    it('业务设置参与同步', () => {
      for (const key of SYNC_KEYS) {
        expect(isSyncKey(key)).toBe(true)
      }
    })

    it('菜单排序按角色各存一条，全部参与同步', () => {
      expect(isSyncKey('erp_menu_order_boss')).toBe(true)
      expect(isSyncKey('erp_menu_order_sales')).toBe(true)
    })

    it('登录失败计数绝不同步（否则一台设备输错密码会锁住全公司）', () => {
      expect(isSyncKey('erp_login_fail')).toBe(false)
    })

    it('会话与记住的账号绝不同步（登录态不能跨设备共享）', () => {
      expect(isSyncKey('erp_session')).toBe(false)
      expect(isSyncKey('erp_remember_account')).toBe(false)
      expect(isSyncKey('erp_current_user')).toBe(false)
      expect(isSyncKey('erp_current_dealer_id')).toBe(false)
    })

    it('设备本机 UI 状态不同步（手机和电脑布局本就不同）', () => {
      expect(isSyncKey('erp_sidebar_collapsed')).toBe(false)
      expect(isSyncKey('erp_settings_panels')).toBe(false)
    })

    it('未知的新键默认不同步（白名单是封闭的）', () => {
      expect(isSyncKey('erp_something_new')).toBe(false)
      expect(isSyncKey('some_random_key')).toBe(false)
    })
  })

  // ---------------- B. 首次迁移：本机 → 云端 ----------------
  describe('首次迁移', () => {
    it('本机已有但云端没有的设置会被补推上去（老用户升级不丢配置）', async () => {
      localStorage.setItem('erp_price_rule', JSON.stringify({ wholesaleRate: 15, retailRate: 30 }))
      const pushed = await pushPending()
      expect(pushed).toBe(1)
      expect(rows().get('erp_price_rule')?.value).toEqual({ wholesaleRate: 15, retailRate: 30 })
    })

    it('补推后本机记录时间戳，下次不会再重复推', async () => {
      localStorage.setItem('erp_print_settings', JSON.stringify({ paper: 'A5' }))
      expect(await pushPending()).toBe(1)
      expect(await pushPending()).toBe(0)
    })

    it('本机没有值的设置不会被推上去（不会拿空值覆盖云端）', async () => {
      expect(await pushPending()).toBe(0)
      expect(rows().size).toBe(0)
    })
  })

  // ---------------- C. 冲突判定：last-write-wins ----------------
  describe('双向同步的冲突处理', () => {
    it('云端更新 → 拉取后覆盖本机', async () => {
      localStorage.setItem('erp_company', JSON.stringify({ name: '旧抬头' }))
      rows().set('erp_company', {
        key: 'erp_company',
        value: { name: '手机上改的新抬头' },
        updatedAt: '2026-09-22T10:00:00.000Z'
      })

      const changed = await pullSettings()
      expect(changed).toBe(1)
      expect(JSON.parse(localStorage.getItem('erp_company')!)).toEqual({ name: '手机上改的新抬头' })
    })

    it('本机更新 → 不会被云端旧值覆盖', async () => {
      localStorage.setItem('erp_company', JSON.stringify({ name: '本机刚改的' }))
      localStorage.setItem(META_KEY, JSON.stringify({ erp_company: '2026-09-22T12:00:00.000Z' }))
      rows().set('erp_company', {
        key: 'erp_company',
        value: { name: '云端旧值' },
        updatedAt: '2026-09-22T10:00:00.000Z'
      })

      const changed = await pullSettings()
      expect(changed).toBe(0)
      expect(JSON.parse(localStorage.getItem('erp_company')!)).toEqual({ name: '本机刚改的' })
    })

    it('本机改完推上云端后，另一台设备拉取就能拿到（端到端）', async () => {
      // 设备 A：改设置
      localStorage.setItem('erp_price_rule', JSON.stringify({ wholesaleRate: 20 }))
      touchSetting('erp_price_rule')
      await flush()
      expect(rows().get('erp_price_rule')?.value).toEqual({ wholesaleRate: 20 })

      // 设备 B：清空本机，从云端拉
      const saved = { ...rows().get('erp_price_rule')! }
      localStorage.clear()
      rows().clear()
      rows().set('erp_price_rule', saved)

      const res = await initSettingSync()
      expect(res.cloudReady).toBe(true)
      expect(res.pulled).toBe(1)
      expect(JSON.parse(localStorage.getItem('erp_price_rule')!)).toEqual({ wholesaleRate: 20 })
    })

    it('内容一致时不算「有变更」，但会把本机时间戳补齐', async () => {
      const same = JSON.stringify({ paper: 'A4' })
      localStorage.setItem('erp_print_settings', same)
      rows().set('erp_print_settings', {
        key: 'erp_print_settings',
        value: JSON.parse(same),
        updatedAt: '2026-09-22T10:00:00.000Z'
      })
      expect(await pullSettings()).toBe(0)
      // 时间戳补上了 → 之后本机改动才推得上去
      expect(JSON.parse(localStorage.getItem(META_KEY)!).erp_print_settings).toBe('2026-09-22T10:00:00.000Z')
    })
  })

  // ---------------- D. 写入与删除 ----------------
  describe('写入与删除', () => {
    it('touchSetting 会把当前值连同时间戳推上云端', async () => {
      localStorage.setItem('erp_company', JSON.stringify({ name: '西安华中恒泰' }))
      touchSetting('erp_company')
      await flush()
      const row = rows().get('erp_company')
      expect(row?.value).toEqual({ name: '西安华中恒泰' })
      expect(row?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('touchSetting 对白名单外的键静默忽略', async () => {
      localStorage.setItem('erp_session', JSON.stringify({ id: 1 }))
      touchSetting('erp_session')
      await flush()
      expect(rows().size).toBe(0)
      // 白名单外连时间戳都不记录，完全当作不存在
      expect(localStorage.getItem(META_KEY)).toBeNull()
    })

    it('forgetSetting 会把云端那条一起删掉（否则别的设备又会拉回来）', async () => {
      localStorage.setItem('erp_menu_order_boss', JSON.stringify(['/boss/home']))
      touchSetting('erp_menu_order_boss')
      await flush()
      expect(rows().has('erp_menu_order_boss')).toBe(true)

      localStorage.removeItem('erp_menu_order_boss')
      forgetSetting('erp_menu_order_boss')
      await flush()
      expect(rows().has('erp_menu_order_boss')).toBe(false)
    })
  })

  // ---------------- E. 优雅降级 ----------------
  describe('云端不可用时不拖垮本机', () => {
    it('表不存在（head 请求不报错、只是 count 为 null）时不能误判成已连接', async () => {
      // 这是线上真实踩过的坑：表没执行迁移 SQL 时 UI 显示「✅ 已连接云端」，
      // 用户以为在同步，结果各设备还是各存各的。
      breakTable()
      const res = await initSettingSync()
      expect(res.cloudReady).toBe(false)
      // 表不可用就不该产生任何同步动作
      expect(res.pulled).toBe(0)
      expect(res.pushed).toBe(0)
    })

    it('云端为空表（count = 0）才算真正就绪', async () => {
      // 表建了但一条数据都没有：count 是数字 0，仍应判定为可用
      const res = await initSettingSync()
      expect(res.cloudReady).toBe(true)
    })

    it('表不存在：标记未就绪，本机数据原样保留', async () => {
      localStorage.setItem('erp_company', JSON.stringify({ name: '本机抬头' }))
      breakTable()

      const res = await initSettingSync()
      expect(res.cloudReady).toBe(false)
      expect(res.pulled).toBe(0)
      expect(res.pushed).toBe(0)
      expect(JSON.parse(localStorage.getItem('erp_company')!)).toEqual({ name: '本机抬头' })
    })

    it('表不存在：写入仍然能落到本机，不报错', async () => {
      breakTable()
      localStorage.setItem('erp_price_rule', JSON.stringify({ wholesaleRate: 5 }))
      expect(() => touchSetting('erp_price_rule')).not.toThrow()
      await flush()
      expect(localStorage.getItem('erp_price_rule')).toContain('wholesaleRate')
    })

    it('云端为空表时也能正常完成同步流程', async () => {
      const res = await initSettingSync()
      expect(res.cloudReady).toBe(true)
      expect(res.pulled).toBe(0)
      expect(res.pushed).toBe(0)
    })
  })

  // ---------------- F. 概要信息 ----------------
  describe('设置页展示用数据', () => {
    it('统计本机已纳入同步的设置项数', async () => {
      localStorage.setItem('erp_company', JSON.stringify({ name: 'A' }))
      localStorage.setItem('erp_price_rule', JSON.stringify({ wholesaleRate: 1 }))
      touchSetting('erp_company')
      touchSetting('erp_price_rule')
      await flush()
      expect(getSyncSummary().count).toBe(2)
      expect(getSyncSummary().keys.sort()).toEqual(['erp_company', 'erp_price_rule'])
    })

    it('不同角色的菜单排序各算一项', async () => {
      touchSetting('erp_menu_order_boss')
      touchSetting('erp_menu_order_sales')
      await flush()
      expect(getSyncSummary().count).toBe(2)
    })
  })
})
