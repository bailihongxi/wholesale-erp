/**
 * 第十七轮（V1.0-6）回归测试：
 *  - 库存概况卡片（SKU / 库存总量 / 库存金额（进价）/ 库存预警）下移到
 *    「库存明细」模块内、搜索框上方；Hub 页头不再放卡
 *  - 「库存管理」默认打开「库存作业」，且 URL query 变化时 Tab 跟随
 *  - 金额卡按进价权限控制（销售、库房看不到）
 *  - 版本号三处一致（version.ts / package.json / 三份文档）
 *
 * 说明：这里做的是「结构 + 源码约束」层面的守护，行为断言（默认渲染哪个子页、
 * 卡片数值与明细一致、权限文本）在 stock-hub.test.ts 与 search-and-merge.test.ts。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_VERSION } from '../src/version'

function src(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8')
}

const HUB = 'src/views/stock/StockManageView.vue'
const DETAIL = 'src/views/stock/StockDetailView.vue'

describe('第十七轮：库存概况卡片下移', () => {
  it('Hub 页头不再渲染统计卡（卡片与 stats 计算一起下移）', () => {
    const hub = src(HUB)
    expect(hub).not.toContain('stat-row')
    expect(hub).not.toContain('stats.')
  })

  it('库存明细把四张卡放在搜索框上方（DOM 顺序：ui-stat-grid → toolbar）', () => {
    const detail = src(DETAIL)
    const gridIdx = detail.indexOf('ui-stat-grid')
    const toolbarIdx = detail.indexOf('class="toolbar"')
    expect(gridIdx).toBeGreaterThan(-1)
    expect(toolbarIdx).toBeGreaterThan(-1)
    expect(gridIdx).toBeLessThan(toolbarIdx)
  })

  it('四张卡的标题与顺序保持：SKU / 总量 / 金额 / 预警', () => {
    const detail = src(DETAIL)
    const labels = ['商品 SKU', '库存总量', '库存金额（进价）', '库存预警']
    let last = -1
    for (const label of labels) {
      const idx = detail.indexOf(label)
      expect(idx, `缺少卡片：${label}`).toBeGreaterThan(last)
      last = idx
    }
  })

  it('金额卡按进价权限控制（销售、库房都不显示）', () => {
    const detail = src(DETAIL)
    // 金额由 purchasePrice 汇总 → 可见性必须挂 canSeePurchasePrice
    expect(detail).toContain('p.purchasePrice')
    expect(detail).toMatch(/canSeePurchasePrice[\s\S]{0,200}库存金额/)
  })
})

describe('第十七轮：库存管理默认打开「库存作业」', () => {
  it('兜底值是 ops（不再回落到库存明细），Tab 顺序仍是库存作业在前', () => {
    const hub = src(HUB)
    // normalize 的兜底必须是 ops（旧写法在此处回落 'detail'）
    expect(hub).toMatch(/TAB_KEYS\.includes\(v as StockTab\)\s*\?\s*\(v as StockTab\)\s*:\s*'ops'/)
    expect(hub.indexOf("label: '库存作业'")).toBeLessThan(hub.indexOf("label: '库存明细'"))
  })

  it('监听 route.query.tab，保证从别处再进本页时 Tab 跟着 URL 走', () => {
    const hub = src(HUB)
    expect(hub).toMatch(/watch\(\(\) => route\.query\.tab/)
    expect(hub).toContain('normalize(route.query.tab)')
  })
})

describe('版本号一致性（V2.2-1.2 断言现代化：不再每轮改测试）', () => {
  /**
   * 版本号体系（老板 2026-09-24 定）：
   *   整体以 V2.1-1 为基线；错误修复 / 小改动在其后递进 V2.1-1.1、V2.1-1.2 …
   *   只有「大的功能添加」才把 -1 递进为 -2。
   *   package.json 必须是合法 semver（三段），故用 patch 位承载修订号。
   *   它同时是 Service Worker 缓存名的来源，**每次发版都必须变**，否则老用户拿不到新版。
   *
   * 断言现代化（2026-09-27）：旧写法把具体版本号写死在测试里
   * （expect(APP_VERSION).toBe('V2.1-2.2')），结果每轮发版测试必红一次、
   * 后来干脆没人更新，断言停在 V2.1-2.2 失去保护意义。
   * 现在改为「锚点 join 校验」——发版照常只改既定三处
   * （src/version.ts / package.json / docs/版本号规范与总表.md），
   * 本测试用总表当锚点验证三处互相对得上，任何一处漏改都会红：
   *   · 总表「当前产品版本」行必须包含 APP_VERSION（version.ts ↔ 总表）；
   *   · 同一行必须包含 package.json 的 version（package.json ↔ 总表）。
   * version.ts 被砍坏（0bff80e 事故）由下面第一条用例守住。
   */
  const REGISTRY = 'docs/版本号规范与总表.md'

  it('version.ts 完整：APP_VERSION / APP_RELEASE_DATE 都在且格式合法', () => {
    expect(APP_VERSION, 'APP_VERSION 必须形如 V<主>.<次>-<修订>[.<小修>]，例如 V2.2-1.1')
      .toMatch(/^V\d+\.\d+-\d+(\.\d+)?$/)
    const verSrc = src('src/version.ts')
    expect(verSrc, 'APP_RELEASE_DATE（版本发布基线日期）不能丢 —— 0bff80e 曾把本文件砍坏')
      .toContain('APP_RELEASE_DATE')
    expect(verSrc).toContain('APP_NAME')
  })

  it('总表「当前产品版本」行同时记录了 version.ts 与 package.json 的版本（三处互相对得上）', () => {
    const pkg = JSON.parse(src('package.json')) as { version: string }
    expect(pkg.version, 'package.json 必须是三段 semver').toMatch(/^\d+\.\d+\.\d+$/)

    const reg = src(REGISTRY)
    const cur = reg.match(/\*\*当前产品版本[：:]\s*(\S+)\*\*/)
    expect(cur, `总表头部必须有一行「当前产品版本：Vx.y-z」（锚点在 ${REGISTRY}）`).not.toBeNull()
    const current = cur![1]
    expect(current, '总表「当前产品版本」与 src/version.ts 的 APP_VERSION 不一致 —— 发版漏更新总表了')
      .toBe(APP_VERSION)

    // 找到总表里当前版本那一行（第二列带反引号的 `Vx.y-z`），行内必须同时带 package.json 版本与 SW 缓存名
    const row = reg.split('\n').find(l => l.includes('`' + APP_VERSION + '`'))
    expect(row, `总表里找不到 ${APP_VERSION} 的版本行（tag / 缓存名列也要填）`).not.toBeUndefined()
    expect(row, `总表 ${APP_VERSION} 行缺少 package.json 版本 ${pkg.version} —— 发版漏更新总表了`)
      .toContain(`\`${pkg.version}\``)
    expect(row, `总表 ${APP_VERSION} 行缺少 SW 缓存名 erp-${pkg.version}`)
      .toContain(`erp-${pkg.version}`)
  })
})
