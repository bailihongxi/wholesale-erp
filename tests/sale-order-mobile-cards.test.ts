/**
 * 销售单详情「商品明细 / 修改明细」统一规范（V2.1-2.x 修订）
 *
 * 背景：详情页商品明细曾经两头走 —— 手机端 ItemCards 卡片、电脑端也在 V2.0-23
 * 被改成语义化 `<ul>` 卡片（.mc-*）。但电脑端 ERP 看台账/对账天然习惯表格，
 * 卡片在宽屏上信息密度低、还把页面拉得很高。老板 2026-09-24 拍板：
 *
 *   - 手机端：全站统一卡片组件 ItemCards（V2.1-1.3 规范，不变）。
 *   - 电脑端：真实表格 `<table class="item-table">`（与采购单详情同源），
 *     不再用 V2.0-23 的「电脑端也卡片」方案。
 *   - 编辑明细、出库流水、收款记录仍走卡片（ec-list / rc-list），这部分不变。
 *
 * ⚠️ 本文件里的断言已随上面的决策更新：商品明细在电脑端是表格、手机端是卡片，
 * 不再断言「全页无线性表格」。属于需求驱动的断言更新，不是放宽。
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

describe('销售单详情 · 商品明细（手机卡片 / 电脑表格）', () => {
  it('手机端走全站统一卡片组件 ItemCards（与采购单详情同源）', () => {
    expect(template, '缺少 ItemCards 组件').toContain('<ItemCards')
    expect(template, '卡片只走手机端分支').toMatch(/<ItemCards\s+v-if="isMobile"/)
    expect(template, '旧的 item-cards 应已废弃').not.toContain('item-cards')
    expect(template, '旧的 ic-line 样式类应已废弃').not.toContain('ic-line')
  })

  it('电脑端是真实表格（采购单同款 item-table），不再是卡片', () => {
    expect(template, '电脑端应有商品明细表格').toContain('<table class="item-table">')
    expect(template, '表格要有表头').toContain('<thead')
    expect(template, '表格要有合计行 tfoot').toContain('<tfoot')
    expect(template, '表格包在 v-else 里（与手机卡片互斥）').toMatch(/<template v-else>/)
    expect(template, '桌面分支不再用 mc-list 卡片').not.toContain('class="mc-list"')
  })

  it('价格列受权限控制（库房/经销商看不到进价）', () => {
    const start = template.indexOf('<table class="item-table">')
    const end = template.indexOf('</table', start)
    const tbl = template.slice(start, end)
    expect(tbl, '单价/金额需挂在 canSeeAnyPrice 下').toContain('canSeeAnyPrice')
  })
})

describe('销售单详情 · 电脑端网格 / 单行排布', () => {
  it('内容短的列表（流水 / 收款）在电脑端用多列网格提高密度', () => {
    expect(desktopCss, '缺少电脑端媒体查询').not.toBe('')
    expect(desktopCss, '.rc-list 在电脑端应为多列网格').toMatch(/\.rc-list\s*\{[^}]*display:\s*grid/)
    expect(desktopCss, '.rc-list 应定义可自适应列宽').toMatch(/grid-template-columns:\s*repeat\(auto-fill/)
  })

  it('编辑明细在电脑端单列铺满整行（要一行排完，不能再切成多列网格）', () => {
    // V2.0-24：电脑端要求「序号 + 商品名 + 数量 + 单价 + 金额」同排一行，
    // 卡片内部要吃满整行宽度，切成多列网格会把输入框挤到下一行。
    expect(desktopCss, '.ec-list 电脑端应为单列铺满').toMatch(/\.ec-list\s*\{[^}]*display:\s*block/)
    expect(desktopCss, '.ec-list 不应再定义多列网格').not.toMatch(/\.ec-list\s*\{[^}]*grid-template-columns/)
    expect(desktopCss, '.ec-item 不应再定义多列网格列数').not.toMatch(/\.ec-item[^{]*\{[^}]*grid-template-columns/)
  })

  it('电脑端编辑明细卡片内容排成一行（数量/单价输入框不再另起一行）', () => {
    expect(desktopCss, '卡片本体应为横向 flex').toMatch(/\.ec-item\s*\{[^}]*display:\s*flex/)
    expect(desktopCss, '.ec-top 这层要拆开，序号/名称/金额才能参与本行排布').toMatch(
      /\.ec-item\s+\.ec-top\s*\{[^}]*display:\s*contents/
    )
    expect(desktopCss, '输入行要并到本行（去掉上边距）').toMatch(/\.ec-item\s+\.ec-row\s*\{[^}]*margin-top:\s*0/)
    expect(desktopCss, '金额挪到行尾').toMatch(/\.ec-item\s+\.ec-amount\s*\{[^}]*order:\s*1/)
    expect(desktopCss, '商品名吃掉剩余宽度').toMatch(/\.ec-item\s+\.ec-name\s*\{[^}]*flex:\s*1/)
    expect(desktopCss, '输入框固定宽度，不被挤压').toMatch(/\.ec-item\s+\.ec-field\s*\{[^}]*width:\s*152px/)
  })

  it('手机端编辑明细仍是上下两行（宽度有限，单行放不下）', () => {
    expect(mobileCss, '手机端不应套用电脑端单行 flex').not.toMatch(/\.ec-item\s*\{[^}]*display:\s*flex/)
    expect(mobileCss, '手机端不应把 .ec-top 拆成 contents').not.toMatch(
      /\.ec-item\s+\.ec-top\s*\{[^}]*display:\s*contents/
    )
    expect(mobileCss, '手机端输入行要保留上边距（与上一行分开）').not.toMatch(
      /\.ec-item\s+\.ec-row\s*\{[^}]*margin-top:\s*0/
    )
  })

  // ⚠️ 以下三段原本断言「商品明细在电脑端是 .mc-list 卡片（单行 flex 排布）」。
  // V2.1-2.x 起电脑端商品明细已变为真实表格 <table class="item-table">，
  // 这些卡片布局断言随之作废（属于需求驱动更新，非放宽）：
  //   - 商品明细在电脑端单列铺满整行（.mc-list / .mc-item margin-bottom）
  //   - 电脑端卡片内容排成一行（.mc-item display:flex / .mc-top flex:1 / .mc-calc margin-top:0）
  //   - 手机端仍是上下两行（.mc-item 不套用电脑端单行 flex）
  // 新的表格行为见上方「商品明细（手机卡片 / 电脑表格）」describe。

  it('手机端不套用网格（仍是单列卡片）', () => {
    expect(mobileCss).not.toMatch(/grid-template-columns:\s*repeat\(auto-fill/)
  })

  it('编辑明细序号只在电脑端显示（手机端单列天然有序，省一行宽度）', () => {
    expect(desktopCss, '电脑端需要序号对应行次').not.toMatch(/\.ec-idx[^{]*\{[^}]*display:\s*none/)
    expect(mobileCss, '手机端应隐藏编辑明细序号').toMatch(/\.ec-idx\s*\{[^}]*display:\s*none/)
  })
})

describe('销售单详情 · 修改明细卡片化', () => {
  it('编辑明细走 ul.ec-list（商品明细的桌面表格不计入编辑区）', () => {
    expect(template, '缺少编辑卡片容器').toContain('class="ec-list"')
    const editIdx = template.indexOf('class="ec-list"')
    const editRegion = template.slice(editIdx)
    expect(editRegion, '编辑区不应再有表格').not.toContain('<table')
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

  it('编辑模块内不再有「返回」按钮（两端都删，返回语义交给详情页的橘色返回键）', () => {
    // V2.0-25：用户要求编辑模块里只留「取消 / 保存修改」。
    // 旧断言（手机端 display:none 隐藏、电脑端保留）随之作废。
    expect(template, '编辑模块不应再有返回按钮').not.toContain('btn-back')
    expect(css, '返回按钮的样式应一并删除').not.toContain('btn-back')
    const i = template.indexOf('class="edit-footer"')
    const footer = template.slice(i, i + 600)
    expect(footer, '按钮条应有取消').toContain('btn-cancel')
    expect(footer, '按钮条应有保存修改').toContain('btn-save')
  })

  it('详情页橘色返回按钮：编辑时收起、关掉模块后自动回来', () => {
    expect(template, '详情页返回按钮要随 showEdit 收起 / 恢复').toMatch(/<PageActions\s+v-if="!showEdit"/)
    expect(template, '取消要调统一关闭函数（不能只改 showEdit）').toContain('@click="closeEdit"')
    expect(script, '缺少统一关闭函数').toContain('function closeEdit')
    // 保存成功后必须同样走 closeEdit，否则模块关了、橘色返回键不回来
    expect(script, '保存成功后也要走 closeEdit').toMatch(/await closeEdit\(\)[\s\S]{0,80}loadOrder/)
    expect(script, '关闭后要把返回键滚进视野').toContain("querySelector('.page-actions')")
  })

  it('编辑模块去掉橘色大边框，内部卡片与详情页同宽同底', () => {
    expect(css, '编辑模块不应再套 4px 橘色边框').not.toMatch(/\.edit-page\s*\{[^}]*border:\s*4px/)
    expect(css, '编辑模块不应再声明橘色边框色').not.toMatch(/\.edit-page\s*\{[^}]*--c-amber/)
    expect(css, '编辑模块内的卡片不应再内缩（margin:12px 会比其他卡片窄一圈）').not.toMatch(
      /\.edit-page\s+\.block\s*\{[^}]*margin:\s*12px/
    )
    // 底部按钮条跟着卡片走：整圈圆角 + 整圈边框，不再是「容器内的下半截」
    expect(css, '按钮条要独立成卡片').toMatch(/\.edit-footer\s*\{[^}]*border:\s*1px solid/)
    expect(css, '按钮条要整圈圆角').toMatch(/\.edit-footer\s*\{[^}]*border-radius:\s*12px/)
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
