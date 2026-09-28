/**
 * 报价单明细「库存」显示调整（V2.2-1.12，2026-09-29 老板拍板）。
 *
 * 需求原文要点：
 *  1. 只动**手机端**的管理者 / 销售 / 员工报价单明细卡片；
 *  2. 「库存 12」→「库12」，从金额右侧**挪到金额左侧**，与金额之间留 2 个字符；
 *  3. 字号与单价一致（13px，极窄屏 12px），颜色仍为蓝色；
 *  4. **经销商端（手机版 + 电脑版）零改动**，电脑版表格也零改动；
 *  5. 纯渲染层调整，不新增任何网络请求，不影响加载速度。
 *
 * 为此通用组件 ItemCards 新增 `noteLead` 开关（默认 false）：
 * 不开的页面（销售单/采购单的赠品说明等）位置与字号逐像素不变。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const cards = readFileSync(resolve(ROOT, 'src/components/ui/ItemCards.vue'), 'utf8')
const quotes = readFileSync(resolve(ROOT, 'src/views/sales/QuotesView.vue'), 'utf8')
const saleDetail = readFileSync(resolve(ROOT, 'src/views/sales/SaleOrderDetailView.vue'), 'utf8')
const purchaseDetail = readFileSync(resolve(ROOT, 'src/views/purchase/PurchaseOrderDetailView.vue'), 'utf8')

/** 取 ItemCards 模板里「数量 × 单价 = 金额 / note」这一块 */
const calcStart = cards.indexOf('<div class="ui-items-calc">')
const calcBlock = cards.slice(calcStart, cards.indexOf('</div>', calcStart))

describe('ItemCards：note 位置开关', () => {
  it('默认（不开 noteLead）：note 仍在行尾，且不带 lead 类（全站原样）', () => {
    expect(cards).toContain('noteLead: false')
    expect(calcBlock).toContain('<span v-if="it.note && !leadNote(it)" class="ui-items-note">')
    // 行尾这一支必须出现在金额 <b> 之后
    expect(calcBlock.indexOf('ui-items-amount')).toBeLessThan(
      calcBlock.indexOf('<span v-if="it.note && !leadNote(it)"')
    )
  })

  it('开启 noteLead：note 渲染在金额之前，并带 lead 类', () => {
    expect(calcBlock).toContain('<span v-if="leadNote(it)" class="ui-items-note lead">')
    expect(calcBlock.indexOf('class="ui-items-note lead"')).toBeLessThan(
      calcBlock.indexOf('ui-items-amount')
    )
  })

  it('lead 只在「开了开关 + 有 note + 显示金额」时生效（赠品行不丢信息）', () => {
    expect(cards).toContain('function leadNote(it: ItemCardRow): boolean {')
    expect(cards).toContain('return !!props.noteLead && it.note != null && props.showPrice && it.price != null')
  })
})

describe('ItemCards：库N 的字号与间距', () => {
  it('与金额之间固定 2 个字符（13px×2 = 26px），整体顶到右侧', () => {
    expect(cards).toContain('.ui-items-note.lead {')
    expect(cards).toContain('margin-left: auto;')
    // 行内还有 .ui-items-calc 的 gap:6px，所以 lead 只补 20px（20 + 6 = 26px = 2 个字符）
    // —— 实机量过：写 26px 会让实际间距变成 32px，比「两个字符」宽
    expect(cards).toContain('padding-right: 20px;')
    expect(cards).toContain('gap: 6px;')
  })

  it('字号与单价一致：常规 13px，极窄屏（<360px）跟单价一起降到 12px', () => {
    const leadCss = cards.slice(cards.indexOf('.ui-items-note.lead {'))
    expect(leadCss.slice(0, 200)).toContain('font-size: 13px;')
    // 极窄屏分支
    const narrow = cards.slice(cards.indexOf('@media (max-width: 359px)'))
    expect(narrow).toContain('.ui-items-note.lead { font-size: 12px; padding-right: 20px; }')
  })

  it('「库N」必须贴着金额左侧：lead 独占剩余空间并右对齐（否则与金额的 auto 平分空隙）', () => {
    const leadCss = cards.slice(
      cards.indexOf('.ui-items-note.lead {'),
      cards.indexOf('}', cards.indexOf('.ui-items-note.lead {'))
    )
    // 金额自身也挂着 margin-left:auto，两个 auto 会把剩余空间平分，
    // 把「库N」甩到行中间 —— 必须由 lead 吃掉剩余空间（flex:1）并右对齐才能贴住金额
    expect(leadCss, 'lead 必须 flex:1 独占剩余空间').toContain('flex: 1')
    expect(leadCss, 'lead 文字要右对齐，才能停在金额左侧').toContain('text-align: right')
  })

  it('颜色仍走 accent 蓝（不改颜色，只改位置与字号）', () => {
    expect(cards).toContain('.ui-items-note { color: var(--c-accent); }')
    // lead 分支不得覆盖颜色
    const leadCss = cards.slice(cards.indexOf('.ui-items-note.lead {'), cards.indexOf('}', cards.indexOf('.ui-items-note.lead {')))
    expect(leadCss).not.toContain('color:')
  })
})

describe('报价单页：文案与开关', () => {
  it('手机端卡片库存文案由「库存 N」改为「库N」', () => {
    expect(quotes).toContain('note: isDealer.value ? undefined : `库${stockText(it.productId)}`')
    expect(quotes).not.toContain('`库存 ${stockText(it.productId)}`')
  })

  it('只有非经销商开启前移（经销商 note 本来就是 undefined）', () => {
    expect(quotes).toContain(':note-lead="!isDealer"')
  })

  it('经销商端不显示库存的既有逻辑保持不变', () => {
    expect(quotes).toContain("note: isDealer.value ? undefined")
    expect(quotes).toContain('<th v-if="!isDealer" class="num">库存</th>')
    expect(quotes).toContain('<td v-if="!isDealer" class="num" :class="stockClass(it.productId)">')
  })

  it('电脑端表格库存列位置不动（仍在数量之后、报价之前）', () => {
    const head = quotes.slice(quotes.indexOf('<table v-if="detailItems.length" class="data-table">'))
    const tr = head.slice(head.indexOf('<tr><th>#</th>'), head.indexOf('</tr>'))
    expect(tr.indexOf('库存')).toBeLessThan(tr.indexOf('金额'))
  })
})

describe('不波及其它页面 / 不影响速度', () => {
  it('销售单、采购单详情仍不传 note-lead（note 位置字号不变）', () => {
    expect(saleDetail).not.toContain('note-lead')
    expect(purchaseDetail).not.toContain('note-lead')
  })

  it('库存取值仍走已有的 stockMap，不新增请求', () => {
    // stockOf 批量取一次（V2.1-2.32 已有），本次不得再加第二个取库存的调用
    const hits = quotes.split('stockOf(').length - 1
    expect(hits).toBe(1)
    expect(quotes).toContain('function stockText(id: number): string {')
    // 卡片行是纯 computed 映射，不能有 await
    const cardsComputed = quotes.slice(
      quotes.indexOf('const detailCards = computed<ItemCardRow[]>'),
      quotes.indexOf('function fmtDate')
    )
    expect(cardsComputed).not.toContain('await')
  })

  it('明细加载的等待时间不变：库存仍是 fire-and-forget 补上', () => {
    expect(quotes).toContain('.then(m => { stockMap.value = m; stockLoaded.value = true })')
    expect(quotes).toContain('不增加明细显示的等待')
  })
})

describe('V2.2-1.13：库存「…」只表示加载中，无记录显示 0', () => {
  it('stockText 必须用 stockLoaded 区分加载中与无记录', () => {
    expect(quotes).toContain('const stockLoaded = ref(false)')
    // 加载中才显示「…」
    expect(quotes).toContain("if (!stockLoaded.value) return '…'")
    // 无记录（undefined）回落为 0 —— 与选商品弹窗 pickerPage 的 `?? 0` 同口径
    expect(quotes).toContain('return String(stockMap.value[id] ?? 0)')
    // 旧写法（把 undefined 一律当「…」）不得回归
    expect(quotes).not.toContain("n === undefined ? '…' : String(n)")
  })

  it('stockLoaded 在打开详情时先复位，then 与 catch 都要置 true（防失败后永远转圈）', () => {
    // 打开新详情必须复位，避免沿用上一单的已加载状态
    expect(quotes).toContain('stockLoaded.value = false')
    expect(quotes).toContain('.catch(() => { stockMap.value = {}; stockLoaded.value = true })')
  })

  it('不新增任何库存请求：stockOf 仍只调 1 次', () => {
    const hits = quotes.split('stockOf(').length - 1
    expect(hits).toBe(1)
  })
})
