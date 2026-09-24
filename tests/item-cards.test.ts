/**
 * 商品明细「电脑端列表 / 手机端卡片」规范（V2.1-1.3）防回归
 *
 * 背景：手机端商品明细过去各页各写一份 CSS（有的用 nth-child 拆表、有的自建 .item-cards），
 * 长商品名 + 多列数字经常把页面横向撑破，每加一页就要修一遍。V2.1-1.3 收敛为：
 *   · 只读明细 → components/ui/ItemCards.vue（全站唯一模板，手机端渲染）
 *   · 可编辑明细 → 页面 @media 把 .data-table 转卡片的固定范式（列序写在各自 thead 注释里）
 *   · 电脑端一律保留列表（表格 / 行列表），两端不共用卡片 DOM
 * 规则文档：docs/手机端明细卡片规范.md
 *
 * 本文件锁三件事：组件的渲染契约、四个详情页的接线方式、旧实现不许复活。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import ItemCards from '../src/components/ui/ItemCards.vue'

const ROOT = join(__dirname, '..')
const cmpSfc = readFileSync(join(ROOT, 'src/components/ui/ItemCards.vue'), 'utf8')

const rows = [
  { name: '海信 HF-250LW/TS06SJD', unit: '套', qty: 1, price: 37950, amount: 37950 },
  { name: '美的 KFR-35GW/N8XHC1', unit: '台', qty: 2, price: 2000, amount: 4000 }
]

describe('ItemCards · 组件渲染契约（效果图样式）', () => {
  it('标题用全局 .block-title（自带左侧蓝竖条），并自动补条数', () => {
    const w = mount(ItemCards, { props: { items: rows } })
    const t = w.find('h4.block-title')
    expect(t.exists(), '标题必须套全局 .block-title，才能有左侧蓝竖条').toBe(true)
    expect(t.text()).toBe('商品明细（2）')
  })

  it('标题可自定义（报价明细 / 询价明细）', () => {
    const w = mount(ItemCards, { props: { items: rows, title: '报价明细' } })
    expect(w.find('h4.block-title').text()).toBe('报价明细（2）')
  })

  it('一行读清「商品名 / 数量 单位 / × 单价 = 金额」', () => {
    const w = mount(ItemCards, { props: { items: rows } })
    const first = w.findAll('.ui-items-row')[0]
    expect(first.find('.ui-items-name').text()).toContain('海信 HF-250LW/TS06SJD')
    expect(first.find('.ui-items-qty').text()).toBe('1 套')
    expect(first.find('.ui-items-price').text()).toBe('¥37,950.00')
    expect(first.find('.ui-items-amount').text()).toBe('¥37,950.00')
    expect(first.findAll('.ui-items-op').map(o => o.text()), '必须有 × 与 = 两个运算符').toEqual(['×', '='])
  })

  it('金额千分位 + 两位小数（全站统一格式）', () => {
    const w = mount(ItemCards, { props: { items: rows } })
    const second = w.findAll('.ui-items-row')[1]
    expect(second.find('.ui-items-price').text()).toBe('¥2,000.00')
    expect(second.find('.ui-items-amount').text()).toBe('¥4,000.00')
  })

  it('合计条：左「合计 N 件」，右红色大号金额', () => {
    const w = mount(ItemCards, { props: { items: rows } })
    const total = w.find('.ui-items-total')
    expect(total.exists(), '手机端没有表格 tfoot，卡片必须自带合计条').toBe(true)
    expect(total.text()).toContain('合计')
    expect(total.find('.ui-items-total-qty').text()).toBe('3 件')
    expect(total.find('.ui-items-total-amount').text()).toBe('¥41,950.00')
  })

  it('合计数量 / 金额可外部传入（销售单要排除赠品、金额取单据总额）', () => {
    const w = mount(ItemCards, { props: { items: rows, totalQty: 1, totalAmount: 37950 } })
    expect(w.find('.ui-items-total-qty').text()).toBe('1 件')
    expect(w.find('.ui-items-total-amount').text()).toBe('¥37,950.00')
  })

  it('赠品行用角标 + 说明文字代替价格', () => {
    const w = mount(ItemCards, {
      props: { items: [{ name: '海尔 BCD-216', unit: '台', qty: 1, tag: '🎁 赠品', note: '赠品不计价' }] }
    })
    const row = w.find('.ui-items-row')
    expect(row.find('.ui-items-tag').text()).toContain('赠品')
    expect(row.find('.ui-items-note').text()).toBe('赠品不计价')
    expect(row.find('.ui-items-amount').exists(), '赠品行不显示金额').toBe(false)
  })

  it('show-price=false 时只留数量（库房 / 经销商看不到价格）', () => {
    const w = mount(ItemCards, { props: { items: rows, showPrice: false } })
    expect(w.find('.ui-items-qty').exists()).toBe(true)
    expect(w.findAll('.ui-items-price').length).toBe(0)
    expect(w.find('.ui-items-amount').exists()).toBe(false)
    expect(w.find('.ui-items-total-amount').exists()).toBe(false)
    expect(w.find('.ui-items-total-qty').exists(), '合计数量仍要显示').toBe(true)
  })

  it('空态文案可配，且默认「暂无明细」', () => {
    expect(mount(ItemCards, { props: { items: [] } }).find('.ui-items-empty').text()).toBe('暂无明细')
    expect(
      mount(ItemCards, { props: { items: [], emptyText: '尚未添加商品' } }).find('.ui-items-empty').text()
    ).toBe('尚未添加商品')
  })

  it('show-total=false 时不出合计条（页面自己有合计行的场景）', () => {
    const w = mount(ItemCards, { props: { items: rows, showTotal: false } })
    expect(w.find('.ui-items-total').exists()).toBe(false)
  })
})

describe('ItemCards · 手机端不撑破屏幕（样式硬约束）', () => {
  it('商品名独占一行且可任意折行（长型号不会顶出屏幕）', () => {
    expect(cmpSfc, '长型号必须能折行').toMatch(/\.ui-items-name \.nm\s*\{[^}]*overflow-wrap:\s*anywhere/)
    expect(cmpSfc, '名称行自身不能设固定宽').toMatch(/\.ui-items-name\s*\{[^}]*min-width:\s*0/)
  })

  it('「数量 × 单价 = 金额」用 margin-left:auto 顶到右侧，不靠固定列宽', () => {
    expect(cmpSfc).toMatch(/\.ui-items-amount\s*\{[^}]*margin-left:\s*auto/)
  })

  it('组件内没有任何固定像素宽度（不设 min-width / width: Npx）', () => {
    const widthRules = cmpSfc.match(/^\s*width:\s*\d+px/gm) ?? []
    expect(widthRules, '卡片里出现固定宽度就是撑破屏幕的开始').toEqual([])
    expect(cmpSfc).not.toMatch(/min-width:\s*\d+px/)
  })

  it('极窄屏（<360px）有一档压缩，金额与数量仍在同一行', () => {
    expect(cmpSfc).toMatch(/@media \(max-width: 359px\)/)
  })
})

describe('四个销售 / 采购详情页 · 手机端接线（电脑端仍列表）', () => {
  const PAGES: Array<{ file: string; title: string; desktop: RegExp; label: string }> = [
    { file: 'src/views/sales/SaleOrderDetailView.vue', title: '商品明细', desktop: /<table class="item-table">/, label: '销售单详情' },
    { file: 'src/views/purchase/PurchaseOrderDetailView.vue', title: '商品明细', desktop: /<table class="item-table">/, label: '采购单详情' },
    { file: 'src/views/sales/QuotesView.vue', title: '报价明细', desktop: /<table v-if="detailItems.length" class="data-table">/, label: '报价单详情' },
    { file: 'src/views/purchase/PurchaseQuotesView.vue', title: '询价明细', desktop: /<table v-if="detailItems.length" class="data-table">/, label: '预采询价详情' }
  ]

  for (const p of PAGES) {
    describe(p.label, () => {
      const tpl = readFileSync(join(ROOT, p.file), 'utf8')
      const template = tpl.slice(0, tpl.indexOf('<script'))
      const script = tpl.slice(tpl.indexOf('<script'), tpl.indexOf('</script>'))

      it('手机端走全站统一卡片组件', () => {
        expect(template, '缺少 ItemCards 组件').toContain('<ItemCards')
        expect(template, '卡片只走手机端分支').toMatch(/<ItemCards\s+v-if="isMobile"/)
        expect(template, `标题应为「${p.title}」`).toContain(`title="${p.title}"`)
      })

      it('电脑端仍是列表（两端不共用卡片 DOM）', () => {
        expect(template, '电脑端应保留原列表').toMatch(p.desktop)
        expect(template, '电脑端分支要包在 v-else 里').toMatch(/<template v-else>/)
      })

      it('页面把明细折算成 ItemCardRow（不在组件里耦合业务字段）', () => {
        expect(script).toContain('ItemCardRow')
        expect(script, '缺少行数据映射').toMatch(/const (\w+)\s*=\s*computed<ItemCardRow\[\]>\(/)
      })
    })
  }
})

describe('旧实现不许复活', () => {
  it('全站视图里不再有自建卡片类 .item-cards / .ic-line', () => {
    const files = [
      'src/views/sales/SaleOrderDetailView.vue',
      'src/views/sales/QuotesView.vue',
      'src/views/purchase/PurchaseOrderDetailView.vue',
      'src/views/purchase/PurchaseQuotesView.vue'
    ]
    for (const f of files) {
      const s = readFileSync(join(ROOT, f), 'utf8')
      expect(s, `${f} 仍在用旧的自建卡片类`).not.toContain('item-cards')
      expect(s, `${f} 仍在用旧的 ic-line 类`).not.toContain('ic-line')
    }
  })

  it('报价单详情态的 nth-child 拆表规则已随表格一起删除', () => {
    const s = readFileSync(join(ROOT, 'src/views/sales/QuotesView.vue'), 'utf8')
    expect(s, '.items-view 已被卡片组件取代').not.toContain('items-view')
  })

  it('预采询价新建态的可编辑明细表已挂 items-edit 范式类 + 空态修复', () => {
    const s = readFileSync(join(ROOT, 'src/views/purchase/PurchaseQuotesView.vue'), 'utf8')
    expect(s).toContain('class="data-table items-edit"')
    expect(s, '空态行会被 nth-child(1) 的 display:none 一起隐藏，必须显式放回').toMatch(
      /\.items-edit tbody td\.empty\s*\{\s*display:\s*block/
    )
  })
})

describe('规范文档（写死的口径）', () => {
  const doc = join(ROOT, 'docs/手机端明细卡片规范.md')
  it('存在且写明「电脑端列表 / 手机端卡片」', () => {
    expect(existsSync(doc), '缺少 docs/手机端明细卡片规范.md').toBe(true)
    const s = readFileSync(doc, 'utf8')
    expect(s).toContain('电脑端')
    expect(s).toContain('手机端')
    expect(s, '要写明只读明细用哪个组件').toContain('ItemCards.vue')
    expect(s, '要写明可编辑明细的范式').toContain('items-edit')
  })
})
