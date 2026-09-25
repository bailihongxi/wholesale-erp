/**
 * 手机端卡片结构统一（2026-09-25 老板拍板）。
 *
 * 背景：「记一笔」一直是自己写的一份三行卡片（10px 圆角 + 灰阴影 + 自造 .lc-tag 标签），
 * 其余 15 个页面是另一套（12px 圆角 + 蓝灰阴影）。统一后的目标形态在三处必须一致：
 *   - theme.css「12A. 手机端列表卡片」提供唯一外壳与三行结构
 *   - 对账页（应收 / 应付 / 收付历史）与记一笔都直接复用这些全局类
 *   - 各页面 scoped style 里不许再留卡片外壳副本，否则会盖掉全局
 *
 * 这里全部走源码静态断言（不挂载组件），保证改动样式时不会悄悄退回双轨制。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const THEME = readFileSync(join(__dirname, '../src/styles/theme.css'), 'utf8')
const RECONCILE = readFileSync(join(__dirname, '../src/views/finance/ReconcileView.vue'), 'utf8')
const LEDGER = readFileSync(join(__dirname, '../src/views/finance/LedgerView.vue'), 'utf8')

/** 取某个 SFC 的 <style> 段 */
function scopedStyle(sfc: string): string {
  return sfc.slice(sfc.indexOf('<style'))
}

describe('手机端卡片结构统一', () => {
  it('theme.css 提供唯一的卡片外壳与三行结构类', () => {
    const block = THEME.slice(THEME.indexOf('12A. 手机端列表卡片'), THEME.indexOf('13. 全站表格规范'))
    expect(block).toContain('.card-list')
    expect(block).toContain('.card {')
    // 统一口径：白底 / 12px 圆角 / 蓝灰阴影，与其余 15 个页面一致
    expect(block).toContain('background: #fff')
    expect(block).toContain('border-radius: 12px')
    expect(block).toContain('box-shadow: 0 2px 10px rgba(26,54,93,0.06)')
    // 三行结构四类齐全
    for (const cls of ['.card-head', '.card-body', '.card-foot', '.card-no', '.card-party', '.card-amt', '.card-date']) {
      expect(block, cls).toContain(cls)
    }
  })

  it('对账页与记一笔的 scoped style 里都没有卡片外壳副本', () => {
    expect(scopedStyle(RECONCILE)).not.toMatch(/\.card\s*\{/)
    expect(scopedStyle(LEDGER)).not.toMatch(/\.card\s*\{/)
    // 旧的专属卡片类必须已清除
    expect(scopedStyle(RECONCILE)).not.toMatch(/\.recon-card\b|\.pay-card\b|\.rc-sub\b|\.lc-tag\b/)
    expect(scopedStyle(LEDGER)).not.toMatch(/\.ledger-card\b|\.lc-tag\b|\.lc-amt\b|\.lc-foot\b/)
  })

  it('两页手机端卡片用同一套结构类（head 单号+badge / body 单位+金额 / foot 日期+操作）', () => {
    for (const [name, sfc] of [['对账页', RECONCILE], ['记一笔', LEDGER]] as const) {
      const tpl = sfc.slice(0, sfc.indexOf('<script'))
      // 至少一处完整三行结构
      expect(tpl, name).toMatch(/<li[^>]*class="card">/)
      expect(tpl, name).toMatch(/<div class="card-head">/)
      expect(tpl, name).toMatch(/<div class="card-body">/)
      expect(tpl, name).toMatch(/<div class="card-foot">/)
      // 单号与状态/分类都挂在 head，金额挂在 body，操作挂在 foot
      expect(tpl, name).toContain('card-no')
      expect(tpl, name).toContain('ui-badge')
      expect(tpl, name).toContain('card-party')
      expect(tpl, name).toContain('card-amt')
      expect(tpl, name).toContain('card-date')
    }
    // 标签统一走全局 ui-badge，不再有页面自造的标签类
    expect(LEDGER).not.toMatch(/class="lc-tag"/)
  })

  it('两页都不再保留自造的卡片外壳类名', () => {
    const both = RECONCILE + LEDGER
    expect(both).not.toMatch(/class="(recon-card|ledger-card|pay-card)"/)
    expect(both).not.toMatch(/class="rc-bal"/)
  })
})
