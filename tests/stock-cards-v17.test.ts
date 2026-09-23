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

describe('版本号一致性（每轮随最新基线刷新）', () => {
  it('version.ts 与 package.json 同步为 V2.1-2 / 2.1.2', () => {
    expect(APP_VERSION).toBe('V2.1-2')
    const pkg = JSON.parse(src('package.json')) as { version: string }
    expect(pkg.version).toBe('2.1.2')
  })

  it('三份文档都记录了当前版本 V2.1-2', () => {
    for (const f of ['PRD.md', 'MENU_SPEC.md', 'DEV_PLAN_V2.md']) {
      expect(src(f), `${f} 未同步版本号`).toContain('V2.1-2')
    }
  })
})
