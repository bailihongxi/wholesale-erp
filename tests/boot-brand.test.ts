/**
 * 首屏加载页品牌名回归测试（V2.0-9）：
 *
 * 问题：刷新页面时，JS 解析前那一下的加载页写死「家电批发ERP」，
 *       而系统设置 → 品牌与图标 → 系统名称 改成别的名字后，加载页不跟着变。
 *
 * 约定（三重一致，改一处必须改全，否则本文件会红）：
 *  1. index.html 的静态占位默认名 = 家电批发ERP（无 JS 时的兜底）；
 *  2. index.html 的内联脚本读 localStorage 的 erp_brand_config.loginTitle 就地改名，
 *     并在 main.ts 之前同步执行（不然会出现「先闪旧名再变新名」）；
 *  3. src/utils/brand.ts 的系统名称默认值 = 同一个 DEFAULT_SYSTEM_NAME，
 *     改名 / 云端拉到新配置后，浏览器标签页标题也跟着变。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function src(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8')
}

const HTML = src('index.html')

/** 取出 index.html 里那段读 localStorage 改名的内联脚本源码 */
function bootScriptSource(): string {
  const blocks = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const found = blocks.find((b) => b.includes('erp_brand_config'))
  if (!found) throw new Error('index.html 里找不到读 erp_brand_config 的内联脚本')
  return found
}

/** 从 index.html 里抠出 #app-boot 那段静态占位（保证测的是同一份真实 DOM） */
function bootMarkup(): string {
  const m = HTML.match(/<div id="app-boot">[\s\S]*?<\/div>\s*<\/div>/)
  if (!m) throw new Error('index.html 里找不到 #app-boot 占位')
  return m[0]
}

/** 还原「浏览器刚解析到这段脚本」的时刻，并执行真实脚本源码 */
function runBootScript(): void {
  document.body.innerHTML = `<div id="app">${bootMarkup()}</div>`
  // eslint-disable-next-line no-new-func
  new Function(bootScriptSource())()
}

function setBrand(value: unknown): void {
  if (value === undefined) localStorage.removeItem('erp_brand_config')
  else localStorage.setItem('erp_brand_config', typeof value === 'string' ? value : JSON.stringify(value))
}

beforeEach(() => {
  localStorage.clear()
  document.head.innerHTML = '<meta name="apple-mobile-web-app-title" content="批发ERP" />'
  document.body.innerHTML = ''
  document.title = ''
})

describe('首屏加载页：跟随「系统名称」', () => {
  it('静态占位默认名与品牌默认值一致（无 JS 时也不会空白）', () => {
    const boot = bootMarkup()
    expect(boot).toContain('class="boot-logo"')
    expect(boot).toContain('家电批发ERP')
    expect(boot).toContain('boot-bar')
  })

  it('内联脚本在 main.ts 之前执行（不能先闪旧名再改）', () => {
    const inline = HTML.indexOf('erp_brand_config')
    const main = HTML.indexOf('/src/main.ts')
    expect(inline).toBeGreaterThan(-1)
    expect(main).toBeGreaterThan(inline)
  })

  it('本机改过系统名称时，加载页与标签页标题都用新名字', () => {
    setBrand({ loginTitle: '百利鸿禧商贸 ERP', loginSub: '随便写的副标题' })
    runBootScript()
    expect(document.getElementById('boot-logo')?.textContent).toBe('百利鸿禧商贸 ERP')
    expect(document.title).toBe('百利鸿禧商贸 ERP')
    expect(document.head.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content'))
      .toBe('百利鸿禧商贸 ERP')
  })

  it('名字偏长时自动缩字号，不换行挤掉呼吸条', () => {
    setBrand({ loginTitle: '一二三四五六七八九十十一' }) // 12 字
    runBootScript()
    expect((document.getElementById('boot-logo') as HTMLElement).style.fontSize).toBe('18px')
  })

  it('名字很长时进一步缩字号', () => {
    setBrand({ loginTitle: '一二三四五六七八九十十一十二十三十四十五十六十七' }) // 20 字
    runBootScript()
    expect((document.getElementById('boot-logo') as HTMLElement).style.fontSize).toBe('15px')
  })

  it('没配置过 / 名字是空白时，回落到默认「家电批发ERP」', () => {
    runBootScript()
    expect(document.getElementById('boot-logo')?.textContent).toBe('家电批发ERP')

    setBrand({ loginTitle: '   ' })
    runBootScript()
    expect(document.getElementById('boot-logo')?.textContent).toBe('家电批发ERP')
  })

  it('localStorage 是脏数据也不能让页面挂掉，保持默认名', () => {
    setBrand('{ 这不是 JSON')
    expect(() => runBootScript()).not.toThrow()
    expect(document.getElementById('boot-logo')?.textContent).toBe('家电批发ERP')
  })
})

describe('系统名称 → 浏览器标签页标题', () => {
  it('brand.ts 初始化时把已保存的「系统名称」写到标题上', async () => {
    // 本文件里第一次加载 brand.ts，配置在 import 前就摆好，模拟「带着旧配置打开页面」
    vi.resetModules()
    localStorage.setItem('erp_brand_config', JSON.stringify({ loginTitle: '鸿禧电器批发' }))
    await import('../src/utils/brand')
    expect(document.title).toBe('鸿禧电器批发')
  })

  it('在设置里改名后标题立即跟着变，不需要刷新', async () => {
    localStorage.clear()
    const brand = await import('../src/utils/brand')
    brand.useBrand().setLoginText('新系统名', '新副标题')
    expect(document.title).toBe('新系统名')
    // 同时落盘，下次刷新时首屏加载页读到的是新名字
    expect(JSON.parse(localStorage.getItem('erp_brand_config') as string).loginTitle).toBe('新系统名')
  })

  it('名称留空时回落到默认名，不会把标题清空', async () => {
    const brand = await import('../src/utils/brand')
    brand.useBrand().setLoginText('', '')
    expect(brand.DEFAULT_SYSTEM_NAME).toBe('家电批发ERP')
    expect(document.title).toBe('家电批发ERP')
  })

  it('云端配置拉下来后（手机改的名字）标题同步更新', async () => {
    const brand = await import('../src/utils/brand')
    // 模拟 initSettingSync 把云端值写进 localStorage 后触发的重载回调
    localStorage.setItem('erp_brand_config', JSON.stringify({ loginTitle: '手机改的名字' }))
    brand.reloadBrand()
    expect(document.title).toBe('手机改的名字')
  })
})
