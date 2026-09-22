/**
 * 销售单详情「商品明细 / 修改明细」卡片化（V2.0-22 手机端 → V2.0-23 电脑端）防回归
 *
 * 背景：这两处以前都用 `nth-child` 把 `<table>` 拆成卡片（tr 改 flex、td 改 block）。
 * 这套「拆表」方案在本项目反复出问题 —— 列宽算不准、与 thead/tfoot 错位、
 * 手机上渲染效果差，而且详情页商品明细在手机端**根本没有合计行**（合计只在表格 tfoot 里）。
 *
 * 演进：
 *   - V2.0-22：手机端先改成语义化 `<ul>` 卡片（.mc-* / .ec-* / .rc-*），电脑端仍保留 `<table>`。
 *   - V2.0-23：用户要求电脑端也用同一套卡片 —— 表格整体退场，电脑端在
 *     `min-width:768px` 里改为多列网格铺开；同时点「修改」后自动滚到编辑区。
 *
 * ⚠️ 本文件里「电脑端保留表格」的旧断言已被需求作废，替换为
 * 「全页无线性表格 + 两端共用同一套卡片 DOM」，不是放宽断言。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const FILE = join(ROOT, 'src/views/sales/SaleOrderDetailView.vue')
const sfc = readFileSync(FILE, 'utf8')

/** 模板部分 */
const template = sfc.slice(0, sfc.indexOf('<script'))
/** 脚本部分 */
const script = sfc.slice(sfc.indexOf('<script'), sfc.indexOf('</script>'))
/** 样式部分 */
const css = sfc.slice(sfc.indexOf('<style'))

/** 取某个宽度媒体查询块的内容（所有匹配块拼一起） */
function mediaBlocks(s: string, query: RegExp): string {
  const out: string[] = []
  const re = new RegExp(query.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    let i = m.index + m[0].length
    const start = i
    let depth = 1
    while (i < s.length && depth > 0) {
      if (s[i] === '{') depth++
      else if (s[i] === '}') depth--
      i++
    }
    out.push(s.slice(start, i - 1))
  }
  return out.join('\n')
}

const mobileCss = mediaBlocks(css, /@media\s*\(max-width:\s*767px\)\s*\{/)
const desktopCss = mediaBlocks(css, /@media\s*\(min-width:\s*768px\)\s*\{/)

describe('销售单详情 · 商品明细卡片化（手机 / 电脑共用）', () => {
  it('页面里已不存在线性表格', () => {
    expect(template, '本页明细应全部走卡片，不再有 <table>').not.toContain('<table')
    expect(template, '不应再有 tfoot/tbody 片段残留').not.toContain('<tfoot')
  })

  it('走语义化卡片 ul.mc-list，旧的 item-cards 已废弃', () => {
    expect(template, '缺少卡片容器').toContain('class="mc-list"')
    expect(template, '旧的 item-cards 应已废弃').not.toContain('item-cards')
    expect(template, '旧的 ic-line 样式类应已废弃').not.toContain('ic-line')
  })

  it('卡片里能一行读清「数量 × 单价 = 金额」', () => {
    expect(template).toContain('class="mc-qty"')
    expect(template).toContain('class="mc-op"')
    expect(template).toContain('class="mc-amount"')
  })

  it('合计条不再受设备分岔控制（表格 tfoot 已退场）', () => {
    expect(template, '缺少合计条').toContain('class="mc-total"')
    expect(template, '合计条要带金额').toContain('class="mt-amount"')
    expect(template, '合计条要显示合计数量').toContain('class="mt-qty"')
    const i = template.indexOf('class="mc-total"')
    const seg = template.slice(Math.max(0, i - 900), i)
    expect(seg, '合计条必须渲染在商品明细区块内且无 isMobile 分岔').not.toContain('isMobile')
  })

  it('价格列受权限控制（库房/经销商看不到进价）', () => {
    const mc = template.slice(template.indexOf('class="mc-list"'), template.indexOf('class="mc-total"'))
    expect(mc, '单价/金额需挂在 canSeeAnyPrice 下').toContain('canSeeAnyPrice')
  })
})

describe('销售单详情 · 电脑端多列网格铺开', () => {
  it('内容短的列表（编辑明细 / 流水 / 收款）在电脑端用多列网格提高密度', () => {
    expect(desktopCss, '缺少电脑端媒体查询').not.toBe('')
    for (const cls of ['.ec-list', '.rc-list']) {
      const re = new RegExp(`${cls.replace('.', '\\.')}\\s*\\{[^}]*display:\\s*grid`)
      expect(desktopCss, `${cls} 在电脑端应为多列网格`).toMatch(re)
      expect(desktopCss, `${cls} 应定义可自适应列宽`).toMatch(/grid-template-columns:\s*repeat\(auto-fill/)
    }
  })

  it('商品明细在电脑端单列铺满整行（宽度够，不需要切成多列）', () => {
    expect(desktopCss).not.toMatch(/\.mc-list\s*\{[^}]*grid-template-columns/)
    expect(desktopCss, '单列时靠 margin-bottom 拉开间距').toMatch(/\.mc-item\s*\{[^}]*margin-bottom:\s*8px/)
  })

  it('电脑端卡片内容排成一行，不再像手机端那样上下两行', () => {
    expect(desktopCss, '电脑端卡片应改为横向 flex').toMatch(/\.mc-item\s*\{[^}]*display:\s*flex/)
    expect(desktopCss, '商品名要吃掉剩余宽度').toMatch(/\.mc-item\s+\.mc-top\s*\{[^}]*flex:\s*1/)
    expect(desktopCss, '「数量 × 单价 = 金额」靠右且不换行到下一行').toMatch(
      /\.mc-item\s+\.mc-calc\s*\{[^}]*margin-top:\s*0/
    )
  })

  it('手机端仍是上下两行（宽度有限，单行放不下）', () => {
    expect(mobileCss, '手机端不应套用电脑端单行 flex').not.toMatch(/\.mc-item\s*\{[^}]*display:\s*flex/)
  })

  it('手机端不套用网格（仍是单列卡片）', () => {
    expect(mobileCss).not.toMatch(/grid-template-columns:\s*repeat\(auto-fill/)
  })

  it('序号只在电脑端显示（手机端单列天然有序，省一行宽度）', () => {
    expect(desktopCss, '电脑端需要序号对应行次').not.toMatch(/\.mc-idx[^{]*\{[^}]*display:\s*none/)
    expect(mobileCss, '手机端应隐藏序号').toMatch(/\.mc-idx,\s*\.ec-idx\s*\{[^}]*display:\s*none/)
  })
})

describe('销售单详情 · 修改明细卡片化', () => {
  it('编辑明细走 ul.ec-list，不再有表格', () => {
    expect(template, '缺少编辑卡片容器').toContain('class="ec-list"')
    expect((template.match(/<table/g) ?? []).length, '编辑区不应再有表格').toBe(0)
  })

  it('每个输入框都有「数量 / 单价」标签，避免误填', () => {
    const ec = template.slice(template.indexOf('class="ec-list"'))
    expect(ec).toContain('<i>数量</i>')
    expect(ec).toContain('<i>单价</i>')
    expect(ec, '数量用数字键盘').toContain('inputmode="numeric"')
    expect(ec, '单价允许小数').toContain('inputmode="decimal"')
  })

  it('编辑卡片实时显示本行金额，并有合计条', () => {
    const ec = template.slice(template.indexOf('class="ec-list"'))
    expect(ec).toContain('class="ec-amount"')
    expect(ec).toContain('class="mc-total"')
  })

  it('电脑端点「修改」后自动滚到编辑区（不能停在顶部像没反应）', () => {
    expect(script, '编辑区在详情页下方，必须主动滚动过去').toContain('scrollIntoView')
    expect(script, '滚动要等 DOM 渲染完').toContain('nextTick')
    expect(script, '仅电脑端需要滚动（手机端编辑页是整屏 fixed）').toContain('window.innerWidth >= 768')
  })

  it('手机端编辑页整屏覆盖，底部按钮常驻（不用翻到底找保存）', () => {
    expect(mobileCss, '手机端编辑页应整屏固定').toMatch(/\.edit-page\s*\{[^}]*position:\s*fixed/)
    expect(mobileCss, '内容区要能独立滚动').toContain('.edit-page .edit-scroll')
    expect(mobileCss, '底部按钮条不应再随内容滚走').toMatch(/\.edit-page\s+\.edit-footer\s*\{[^}]*flex:\s*none/)
  })

  it('模板里有独立滚动容器', () => {
    expect(template).toContain('class="edit-scroll"')
  })

  it('手机端去掉「返回」按钮（编辑页整屏覆盖，返回不如取消直观）', () => {
    expect(mobileCss, '手机端应隐藏返回按钮').toMatch(
      /\.edit-page\s+\.edit-footer\s+\.btn-back\s*\{[^}]*display:\s*none/
    )
    // 电脑端编辑区是内联的，返回按钮要留着
    expect(desktopCss, '电脑端不应隐藏返回按钮').not.toMatch(/\.btn-back\s*\{[^}]*display:\s*none/)
    expect(template, '详情页的返回按钮不受影响').toContain('PageActions')
  })

  it('备注框是 textarea，且文字超过两行时自增高度', () => {
    expect(template, '备注应改为多行输入').toContain('<textarea')
    expect(script, '缺少高度自增函数').toContain('autoGrowRemark')
    expect(script, '输入时要实时撑开').toContain('onRemarkInput')
    expect(script, '进入编辑态要先按已有内容撑开').toContain(
      "querySelector<HTMLTextAreaElement>('.edit-remark-input')"
    )
    expect(script).not.toMatch(/edit-remark-input[^)]*height:\s*38px/)
  })

  it('备注标签贴着输入框（原来 62px 固定列宽留了太多空白）', () => {
    expect(css, '备注标签列应改为按内容自适应').toMatch(
      /\.edit-page\s+\.d-meta\s*\{[^}]*grid-template-columns:\s*auto\s+1fr/
    )
    expect(css, '标签与输入框间距应收到 6px').toMatch(/\.edit-page\s+\.d-meta\s*\{[^}]*gap:\s*6px/)
    expect(css, '不应再给标签留 62px 固定宽').not.toMatch(/grid-template-columns:\s*62px/)
    // 全局 `.d-meta i` 的 62px 宽度会被编辑页继承，必须显式收回，否则白空 36px
    expect(css, '编辑页标签宽度要收回成文字宽').toMatch(
      /\.edit-page\s+\.d-meta\s+i\s*\{[^}]*width:\s*auto/
    )
  })
})

describe('销售单详情 · 出库流水与收款记录卡片化', () => {
  it('两个区块共用同一份卡片模板（各一个 v-for）', () => {
    expect((template.match(/class="rc-list"/g) ?? []).length).toBe(2)
    expect((template.match(/class="rc-item"/g) ?? []).length).toBe(2)
  })

  it('两端不再分岔，空态提示保留', () => {
    expect(template).toContain('尚未出库')
    expect(template).toContain('尚未登记收款')
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

  it('电脑端表格基础样式仍在媒体查询之外（安全网未被就地改写）', () => {
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
