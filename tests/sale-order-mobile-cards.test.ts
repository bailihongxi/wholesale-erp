/**
 * 手机端销售单详情「商品明细 / 修改明细」卡片化（V2.0-22）防回归
 *
 * 背景：这两处以前都用 `nth-child` 把 `<table>` 拆成卡片（tr 改 flex、td 改 block）。
 * 这套「拆表」方案在本项目反复出问题 —— 列宽算不准、与 thead/tfoot 错位、
 * 手机上渲染效果差，而且详情页商品明细在手机端**根本没有合计行**（合计只在表格 tfoot 里）。
 *
 * V2.0-22 改成按设备真正分岔：
 *   - 手机端（isMobile）→ 渲染语义化 `<ul>` 卡片（.mc-* / .ec-* / .rc-*）
 *   - 电脑端            → 仍是原来的 `<table>`，DOM 与样式一字未动
 *
 * 下面锁住这个结构，防止以后又退回拆表方案、或把电脑端表格改掉。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const FILE = join(ROOT, 'src/views/sales/SaleOrderDetailView.vue')
const sfc = readFileSync(FILE, 'utf8')

/** 模板部分（含各分支，便于断言两套 DOM 同时存在） */
const template = sfc.slice(0, sfc.indexOf('<script'))
/** 样式部分 */
const css = sfc.slice(sfc.indexOf('<style'))

/** 手机端媒体查询块（所有 max-width:767px 的 body 拼一起） */
function mobileBlocks(s: string): string {
  const out: string[] = []
  const re = /@media\s*\(max-width:\s*767px\)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    let i = m.index + m[0].length
    let depth = 1
    const start = i
    while (i < s.length && depth > 0) {
      if (s[i] === '{') depth++
      else if (s[i] === '}') depth--
      i++
    }
    out.push(s.slice(start, i - 1))
  }
  return out.join('\n')
}

const mobileCss = mobileBlocks(css)

/**
 * 从某个 `<template ...>` 的起始下标出发，返回它与配对 `</template>` 之间的内容。
 * 模板里还有 `canSeeAnyPrice` / `isGift` 等嵌套 template，所以必须按深度配对，
 * 不能简单用 `indexOf('</template>')`（会命中内层闭合）。
 */
function templateBranch(s: string, startIdx: number): string {
  let depth = 1
  const re = /<template\b[^>]*>|<\/template>/g
  re.lastIndex = s.indexOf('>', startIdx) + 1
  const bodyStart = re.lastIndex
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    depth += m[0].startsWith('</') ? -1 : 1
    if (depth === 0) return s.slice(bodyStart, m.index)
  }
  return s.slice(bodyStart)
}

describe('销售单详情 · 手机端商品明细卡片化', () => {
  it('手机端走语义化卡片 ul.mc-list，不再用旧的 item-cards', () => {
    expect(template, '缺少手机端卡片容器').toContain('class="mc-list"')
    expect(template, '旧的 item-cards 应已废弃').not.toContain('item-cards')
    expect(template, '旧的 ic-line 样式类应已废弃').not.toContain('ic-line')
  })

  it('商品明细按设备分岔：手机卡片 / 电脑表格', () => {
    const branch = templateBranch(template, template.indexOf('v-if="isMobile"'))
    expect(branch, '手机端分支应含卡片容器').toContain('class="mc-list"')
    // 紧随其后的兄弟节点才应该是桌面表格
    const after = template.slice(template.indexOf('v-if="isMobile"') + branch.length)
    expect(after, '电脑端仍要保留原表格').toContain('<table v-else class="item-table">')
  })

  it('卡片里能一行读清「数量 × 单价 = 金额」', () => {
    expect(template).toContain('class="mc-qty"')
    expect(template).toContain('class="mc-op"')
    expect(template).toContain('class="mc-amount"')
  })

  it('手机端补上合计条（表格 tfoot 在手机端不再渲染）', () => {
    const branch = templateBranch(template, template.indexOf('v-if="isMobile"'))
    expect(branch, '手机端缺少合计条').toContain('class="mc-total"')
    expect(branch, '合计条要带金额').toContain('class="mt-amount"')
    expect(branch, '合计条要显示合计数量').toContain('class="mt-qty"')
  })

  it('价格列受权限控制（库房/经销商看不到进价）', () => {
    const mc = template.slice(template.indexOf('class="mc-list"'), template.indexOf('class="mc-total"'))
    expect(mc, '单价/金额需挂在 canSeeAnyPrice 下').toContain('canSeeAnyPrice')
  })
})

describe('销售单详情 · 手机端修改明细卡片化', () => {
  /** 编辑区那个 isMobile 分支（在 ec-list 之前最近的一个） */
  const ecStart = template.lastIndexOf('v-if="isMobile"', template.indexOf('class="ec-list"'))
  const ecBranch = templateBranch(template, ecStart)

  it('编辑明细按设备分岔：手机卡片 ul.ec-list / 电脑仍为 table', () => {
    expect(template, '缺少编辑卡片容器').toContain('class="ec-list"')
    expect(template, '编辑模式电脑端表格要保留').toContain('<table v-else class="item-table">')
  })

  it('每个输入框都有「数量 / 单价」标签，避免手机上误填', () => {
    expect(ecBranch).toContain('<i>数量</i>')
    expect(ecBranch).toContain('<i>单价</i>')
    expect(ecBranch, '数量用数字键盘').toContain('inputmode="numeric"')
    expect(ecBranch, '单价允许小数').toContain('inputmode="decimal"')
  })

  it('编辑卡片实时显示本行金额，并有合计条', () => {
    expect(ecBranch).toContain('class="ec-amount"')
    expect(ecBranch).toContain('class="mc-total"')
  })

  it('手机端编辑页整屏覆盖，底部按钮常驻（不用翻到底找保存）', () => {
    expect(mobileCss, '手机端编辑页应整屏固定').toMatch(/\.edit-page\s*\{[^}]*position:\s*fixed/)
    expect(mobileCss, '内容区要能独立滚动').toContain('.edit-page .edit-scroll')
    expect(mobileCss, '底部按钮条不应再随内容滚走').toMatch(/\.edit-page\s+\.edit-footer\s*\{[^}]*flex:\s*none/)
  })

  it('模板里有独立滚动容器，桌面端结构不受影响', () => {
    expect(template).toContain('class="edit-scroll"')
  })
})

describe('销售单详情 · 出库流水与收款记录手机端卡片化', () => {
  it('两个区块都有手机端卡片分支', () => {
    // 出库流水 2 张 + 收款记录 2 张，共用一个 rc-list 模板片段（各自 v-for）
    expect((template.match(/class="rc-list"/g) ?? []).length).toBe(2)
    expect((template.match(/class="rc-item"/g) ?? []).length).toBe(2)
  })

  it('电脑端表格一并保留', () => {
    expect((template.match(/<table v-else-if="/g) ?? []).length).toBe(2)
  })
})

describe('销售单详情 · 不再使用 nth-child 拆表', () => {
  it('样式里没有按列序号拆表的规则', () => {
    expect(css, '新的卡片方案不需要 nth-child 拆表').not.toMatch(/nth-child\(/)
  })

  it('手机端不存在把 table/tr/td 改成 block/flex 的旧规则', () => {
    expect(mobileCss, '不应再把 .item-table 拆成卡片').not.toMatch(/\.item-table\s+tbody\s+tr\s*\{[^}]*display:\s*flex/)
    expect(mobileCss, '表格在手机端只做横向滚动兜底').toMatch(/\.item-table\s*\{[^}]*overflow-x:\s*auto/)
  })

  it('电脑端表格基础样式仍在媒体查询之外（未被手机端影响）', () => {
    const baseIdx = css.indexOf('.item-table { width: 100%')
    expect(baseIdx, '缺少桌面端表格基础样式').toBeGreaterThan(-1)
    expect(baseIdx, '桌面端样式不能落在手机端媒体查询里').toBeLessThan(css.indexOf('@media'))
  })
})

describe('销售单详情 · CSS 必须写在 <style> 块内', () => {
  it('</style> 之后不应再有任何样式', () => {
    const after = sfc.slice(sfc.lastIndexOf('</style>') + '</style>'.length)
    expect(after.trim(), '</style> 之后的 CSS 浏览器不会解析（V2.0-19 遗留问题）').toBe('')
  })
})
