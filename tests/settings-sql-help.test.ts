/**
 * 「云端设置尚未启用」自助指引回归测试（V2.0-10）
 *
 * 背景：多设备设置同步依赖云端表 `systemSettings`，而建表是 DDL ——
 * 前端用的 publishable / anon key 没有这个权限，必须由用户在 Supabase
 * 控制台执行一次 SQL。但部署出去的网站里根本没有 supabase/*.sql 这个文件，
 * 用户在手机上看不到、也拷不出来，页面只写一句「执行 xxx.sql」等于没给办法。
 *
 * 所以设置页补三样东西，本文件把它们钉住：
 *  1. 「📋 复制建表 SQL」按钮：把 SQL 原文塞进剪贴板；
 *  2. 「打开 Supabase SQL Editor」链接：由 supabaseClient 的项目地址推导，直达本项目；
 *  3. 「🔄 刷新页面」按钮 + 四步指引：建完表回来点一下就能看到「已连接云端」。
 *
 * ⚠️ 内嵌在 `src/utils/settingsSql.ts` 里的 SQL 必须与
 *   `supabase/migrate_v2.0-6_system_settings.sql` 一字不差，否则用户复制执行的是
 *   一份过期脚本 —— 所以第一条用例就是逐字符比对。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import 'fake-indexeddb/auto'
import router from '../src/router'
import SettingsView from '../src/views/boss/SettingsView.vue'
import {
  SYSTEM_SETTINGS_SQL, SUPABASE_SQL_EDITOR_URL, copyText
} from '../src/utils/settingsSql'

function src(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8')
}

/** 模拟剪贴板可用 */
function stubClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return { writeText }
}

/** 模拟剪贴板不可用（非 https / 老浏览器） */
function killClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
}

function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockReturnValue(result)
  Object.defineProperty(document, 'execCommand', { value: fn, configurable: true })
  return fn
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  // SettingsView 里用了 syncStore / userStore，挂载前必须先有 active pinia
  setActivePinia(createPinia())
})

describe('建表 SQL 与仓库里的迁移脚本一致', () => {
  it('内嵌 SQL 与 supabase/migrate_v2.0-6_system_settings.sql 一字不差', () => {
    const file = src('supabase/migrate_v2.0-6_system_settings.sql')
    // 去掉首尾空行后逐字符比对：两边改一处就必须一起改
    expect(SYSTEM_SETTINGS_SQL.trim()).toBe(file.trim())
  })

  it('复制出去的内容真的能建出这张表（关键语句齐全）', () => {
    expect(SYSTEM_SETTINGS_SQL).toContain('CREATE TABLE IF NOT EXISTS "systemSettings"')
    expect(SYSTEM_SETTINGS_SQL).toContain('"key" text NOT NULL UNIQUE')
    expect(SYSTEM_SETTINGS_SQL).toContain('"value" jsonb')
    // 少了这两条授权，前端即使建了表也读写不了（会静默失败）
    expect(SYSTEM_SETTINGS_SQL).toContain('GRANT ALL ON "systemSettings" TO anon')
    expect(SYSTEM_SETTINGS_SQL).toContain('GRANT ALL ON SEQUENCE "systemSettings_id_seq" TO anon')
    // 幂等：重复执行不能报错，用户多点几次也没关系
    expect(SYSTEM_SETTINGS_SQL).toContain('CREATE TABLE IF NOT EXISTS')
    expect(SYSTEM_SETTINGS_SQL).toContain('CREATE INDEX IF NOT EXISTS')
  })

  it('SQL Editor 链接指向本项目（由 supabaseClient 的项目地址推导）', () => {
    expect(SUPABASE_SQL_EDITOR_URL).toBe(
      'https://supabase.com/dashboard/project/athxdnxyqwgkolxggras/sql/new'
    )
    expect(src('src/utils/settingsSql.ts')).toContain("from '../db/supabaseClient'")
  })
})

describe('复制到剪贴板', () => {
  it('剪贴板可用时优先用它', async () => {
    const { writeText } = stubClipboard()
    await expect(copyText('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('剪贴板不存在时回退 execCommand，返回其结果', async () => {
    killClipboard()
    const exec = stubExecCommand(true)
    await expect(copyText('hello')).resolves.toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')

    stubExecCommand(false)
    await expect(copyText('hello')).resolves.toBe(false)
  })

  it('writeText 抛错（权限被拒）也要回退，不能直接崩', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    stubExecCommand(true)
    await expect(copyText('hello')).resolves.toBe(true)
  })

  it('两条路都不行时返回 false（调用方据此提示手动复制）', async () => {
    killClipboard()
    stubExecCommand(false)
    await expect(copyText('hello')).resolves.toBe(false)
  })
})

describe('设置页「云端设置尚未启用」指引', () => {
  async function mountSettings() {
    const w = mount(SettingsView, { global: { plugins: [router] } })
    await flushPromises()
    return w
  }

  it('未连上云端时给出按钮与四步指引（而不是只甩一个文件名）', async () => {
    const w = await mountSettings()
    const warn = w.find('.sync-state.warn')
    expect(warn.exists()).toBe(true)
    const text = warn.text()
    expect(text).toContain('复制建表 SQL')
    expect(text).toContain('打开 Supabase SQL Editor')
    expect(text).toContain('刷新页面')
    // 指引分四步，且不再让用户自己去仓库里找 xxx.sql 文件
    expect(warn.findAll('.sync-steps li').length).toBe(4)
    expect(warn.text()).toContain('粘贴')
  })

  it('SQL Editor 链接是可直接点开的新标签页', async () => {
    const w = await mountSettings()
    const link = w.find('.sync-state.warn a.ghost-btn')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe(SUPABASE_SQL_EDITOR_URL)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
  })

  it('点「复制建表 SQL」把完整脚本写进剪贴板', async () => {
    const { writeText } = stubClipboard()
    const w = await mountSettings()
    const btn = w.findAll('.sync-state.warn button')
      .find(b => b.text().includes('复制建表 SQL'))
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toContain('CREATE TABLE IF NOT EXISTS "systemSettings"')
    expect(copied.trim()).toBe(SYSTEM_SETTINGS_SQL.trim())
  })

  it('复制失败时给出明确提示（不让按钮像没反应）', async () => {
    killClipboard()
    stubExecCommand(false)
    const w = await mountSettings()
    const btn = w.findAll('.sync-state.warn button')
      .find(b => b.text().includes('复制建表 SQL'))
    await btn!.trigger('click')
    await flushPromises()
    // Vant 的 toast 挂在 body 上，直接断言页面里出现了提示文案
    expect(document.body.textContent).toContain('复制失败')
  })

  it('回归：原有「立即同步」按钮与本机设置计数不能被挤掉', async () => {
    const w = await mountSettings()
    const card = w.find('.sync-state.warn').element.parentElement as HTMLElement
    expect(card.textContent).toContain('立即同步')
    expect(card.textContent).toContain('本机已纳入同步的设置')
  })
})
