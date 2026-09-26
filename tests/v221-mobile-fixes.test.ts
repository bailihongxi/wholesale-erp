/**
 * V2.2-1.1 四项手机端体验修复 · 回归锁
 *
 * 背景（老板 2026-09-27 拍板的四个问题，一条不许漏）：
 *   问题1：出库历史/入库历史 单据明细「返回」不再固定 push 独立列表路由，
 *          统一走 goBackOr —— 返回后停在进入时的页面（Hub 库存作业或独立列表）。
 *   问题2：新建报价 / 新建询价 的可编辑明细合计行补「数量」合计
 *          （原 colspan=5 把数量列吞掉），列位与样式对齐采购商品明细。
 *   问题3：商品档案手机卡片改两行排列 —— 编辑按钮移到第二行，
 *          右对齐落在第一行「在售」标签的正下方。
 *   问题4：商品档案搜索改「回车 / 手机键盘确认键 / 点 ×」触发，
 *          输入阶段不再逐字符触发搜索（SearchInput 新增 searchOnEnter 模式，
 *          默认关闭 → 全站其它 20+ 处用法行为零变化）。
 *
 * 断言策略：静态契约（SFC 源码）+ SearchInput 的挂载级行为测试。
 *   挂载级行为测试只针对 SearchInput 组件本身（jsdom 可控）；
 *   页面级行为由手机视口实机验证兜底（见工作日志）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import SearchInput from '../src/components/SearchInput.vue'

const root = resolve(__dirname, '..')
function src(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf-8')
}

describe('问题1：单据明细返回走 goBackOr（出库历史/入库历史）', () => {
  const sfc = src('src/views/warehouse/StockDocDetailView.vue')

  it('StockDocDetailView 已接入 goBackOr（返回停在进入时的页面）', () => {
    expect(sfc).toContain("import { goBackOr } from '../../composables/useGoBack'")
    expect(sfc).toContain(
      'goBackOr(router, isIn.value ? \'/warehouse/inbound\' : \'/warehouse/outbound\')'
    )
  })

  it('push 到列表路由只剩「删除成功后」一处（删除后回列表是合理的，返回不走 push）', () => {
    const pushes = sfc.match(/router\.push\((isIn\.value \? '[^']+' : '[^']+')\)/g) ?? []
    expect(pushes.length).toBe(1)
    expect(sfc).toMatch(/已删除[\s\S]{0,200}router\.push\(/)
  })
})

describe('问题2：报价/询价明细合计行补数量合计', () => {
  for (const [file, label] of [
    ['src/views/sales/QuotesView.vue', '报价单'],
    ['src/views/purchase/PurchaseQuotesView.vue', '预采询价']
  ] as const) {
    it(`${label}：合计行数量落在「数量」列（colspan=4 + t-qty），与采购商品明细同款样式`, () => {
      const s = src(file)
      // 数量列不再被 colspan 吞掉：标签列只覆盖前 4 列，第 5 列是数量合计
      expect(s).toMatch(/<td colspan="4" class="total-label">/)
      expect(s).toContain('<td class="num t-qty">{{ totalQty }}</td>')
      // 合计数量 = 各行数量直加（与采购商品明细同口径）
      expect(s).toContain('s + (Number(it.quantity) || 0)')
      // 样式与采购商品明细一致（18px 数字色）
      expect(s).toMatch(/\.data-table tfoot td\.t-qty \{ font-size: 18px/)
    })
  }
})

describe('问题3：商品档案手机卡片两行排列', () => {
  it('编辑按钮在第二行（pc-row2）内，位于「在售」标签所在第一行的正下方；旧三行结构已移除', () => {
    const s = src('src/views/boss/ProductListView.vue')
    // 第二行容器存在，编辑按钮与 meta 信息同处一行
    expect(s).toMatch(/class="pc-row2"[\s\S]*?pc-meta[\s\S]*?编辑<\/button>/)
    // 旧第三行操作区已删除
    expect(s).not.toContain('class="pc-actions"')
    // 第一行标签（在售/停售）仍在 pc-head 内
    expect(s).toMatch(/pc-head[\s\S]*?在售/)
    // 第二行 flex 布局：左右分布，编辑按钮不换行
    expect(s).toMatch(/\.pc-row2 \{ display: flex; justify-content: space-between/)
  })
})

describe('问题4：搜索改回车触发（SearchInput searchOnEnter 模式）', () => {
  it('SearchInput 新增 searchOnEnter 模式：输入阶段不触发 search 事件', () => {
    const s = src('src/components/SearchInput.vue')
    expect(s).toContain('searchOnEnter?: boolean')
    // 输入分支提前返回，不 emit search（默认分支不受影响）
    expect(s).toMatch(/if \(props\.searchOnEnter\) return/)
  })

  it('商品档案页已启用 search-on-enter，且不再有逐字符防抖触发', () => {
    const s = src('src/views/boss/ProductListView.vue')
    expect(s).toContain('search-on-enter')
    expect(s).toContain('function onKwSearch')
    // 旧防抖计时器已移除（不能留下死代码双路触发）
    expect(s).not.toContain('kwTimer')
    expect(s).not.toContain('kwDebounced.value = v }, 250')
  })

  it('行为锁：searchOnEnter 时输入不触发搜索、回车/清除才触发（默认模式行为不变）', async () => {
    // 默认模式（debounce=0）：输入立即触发 —— 全站其它页面的既有行为，必须保持
    const def = mount(SearchInput, { props: { modelValue: '', debounce: 0 } })
    await def.find('input').setValue('海尔')
    expect(def.emitted('search')?.length).toBe(1)

    // searchOnEnter 模式：输入只更新关键词，不触发搜索
    const en = mount(SearchInput, { props: { modelValue: '', debounce: 0, searchOnEnter: true } })
    const input = en.find('input')
    await input.setValue('海尔冰箱')
    expect(en.emitted('search')).toBeUndefined()
    expect(en.emitted('update:modelValue')?.length).toBeGreaterThan(0)

    // 回车（手机键盘确认键同源 keyup.enter）→ 触发一次
    await input.trigger('keyup.enter')
    expect(en.emitted('search')?.length).toBe(1)
    expect(en.emitted('search')?.[0]).toEqual(['海尔冰箱'])

    // 点 × 清除 → 立即触发一次空搜索
    await en.find('.clear-btn').trigger('click')
    expect(en.emitted('search')?.[1]).toEqual([''])
  })
})
