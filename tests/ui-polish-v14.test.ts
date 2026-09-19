/**
 * 第十四轮（V1.0-4）UI / 体验回归测试：
 *  - 问题1：搜索框输入后放大镜淡出，不再压住文字（且 scoped 左内边距特异性足够）
 *  - 问题2：经营报表左右对齐（reports-page 去 max-width:1100，改 width:100%）、
 *           库存预警 50 条分页 + 斑马纹（BossReportsView 内嵌分页）
 *  - 问题3：财务「登记收款」行金额框固定宽度、确认/取消按钮不挤字（nowrap）
 *  - 问题4：库存管理「库存作业」Tab 移到最前
 *  - 问题5：全站「返回 / 取消」按钮统一橘红实底白字（--c-amber 令牌 + .ui-btn-cancel）
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import SearchInput from '../src/components/SearchInput.vue'

function src(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8')
}

describe('问题1：搜索框放大镜输入后淡出 + 特异性', () => {
  it('全局 input 基线把类型排除整体写进 :where()（特异性降为 0，不压组件 scoped）', () => {
    const css = src('src/styles/theme.css')
    // 修复后形态：类型排除在 :where() 内部，不存在 :where(input):not(...) 这种链
    expect(css).toMatch(/:where\(input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='file'\]\)\)/)
    // 旧写法（会破坏布局）不应再存在：完整写出类型排除的 :where(input):not(...):not(...):not(...)
    expect(css).not.toMatch(/:where\(input\):not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='file'\]\)/)
  })

  it('SearchInput 有输入内容时放大镜加 .faded 淡出', async () => {
    const w = mount(SearchInput, { props: { modelValue: '' } })
    expect(w.find('.search-icon').classes()).not.toContain('faded')
    await w.find('input').setValue('空调')
    expect(w.find('.search-icon').classes()).toContain('faded')
  })

  it('SearchInput 组件内用双类选择器保护左内边距（不被基线覆盖）', () => {
    const code = src('src/components/SearchInput.vue')
    expect(code).toMatch(/\.search-wrap \.search-field\s*\{/)
    expect(code).toMatch(/padding:\s*0 40px 0 34px/)
  })
})

describe('问题2：经营报表对齐 + 预警 50 条分页斑马纹', () => {
  it('BossReportsView 的 reports-page 不再自带 max-width:1100（交给全局 1240 控制）', () => {
    const code = src('src/views/boss/BossReportsView.vue')
    expect(code).not.toMatch(/\.reports-page\s*\{\s*[^}]*max-width:\s*1100px/)
    expect(code).toMatch(/\.reports-page\s*\{\s*width:\s*100%/)
    // 全局兜底也把 reports-page 纳入 max-width:none
    const css = src('src/styles/theme.css')
    expect(css).toMatch(/\.tab-pane > div:is\([^)]*\.reports-page/)
  })

  it('BossReportsView 低库存预警：内嵌 50 条分页斑马纹表格', () => {
    const code = src('src/views/boss/BossReportsView.vue')
    expect(code).toContain("import { usePagination, PAGE_SIZE_ALERT } from '../../composables/usePagination'")
    expect(code).toContain("import TablePager from '../../components/TablePager.vue'")
    expect(code).toContain('usePagination(lowStock, PAGE_SIZE_ALERT)')
    expect(code).toContain('class="data-table warn-table"')
    expect(code).toContain("class=\"is-warn\"")
    expect(code).toContain('<TablePager')
  })
})

describe('问题3：财务登记收款行按钮不挤字', () => {
  it('金额框用双类选择器固定 120px，确认/取消按钮 nowrap 不竖排', () => {
    const code = src('src/views/finance/ReconcileView.vue')
    expect(code).toMatch(/\.edit-row \.amt-input\s*\{[^}]*width:\s*120px/)
    expect(code).toMatch(/\.confirm-btn\s*\{[^}]*white-space:\s*nowrap/)
    expect(code).toMatch(/\.cancel-btn\s*\{[^}]*white-space:\s*nowrap/)
  })
})

describe('问题4：库存作业 Tab 移到最前', () => {
  it('StockManageView 的 tabOptions 中「库存作业」排在「库存明细」之前', () => {
    const code = src('src/views/stock/StockManageView.vue')
    const opsIdx = code.indexOf("value: 'ops', label: '库存作业'")
    const detailIdx = code.indexOf("value: 'detail', label: '库存明细'")
    expect(opsIdx).toBeGreaterThan(-1)
    expect(detailIdx).toBeGreaterThan(-1)
    expect(opsIdx).toBeLessThan(detailIdx)
  })
})

describe('问题5：全站返回/取消按钮橘红实底白字', () => {
  it('全局定义 --c-amber 令牌与 .ui-btn-cancel 橘红类', () => {
    const css = src('src/styles/theme.css')
    expect(css).toMatch(/--c-amber:\s*#f97316/)
    expect(css).toMatch(/--c-amber-hover:\s*#ea580c/)
    expect(css).toMatch(/\.ui-btn-cancel\s*\{[^}]*background:\s*var\(--c-amber(?:,\s*[^)]*)?\)/)
    // PageActions 的返回/取消也走橘红
    const pa = src('src/components/PageActions.vue')
    expect(pa).toMatch(/\.pa-cancel\s*\{[^}]*var\(--c-amber(?:,\s*[^)]*)?\)/)
  })

  it('各页取消按钮均套用橘红（财务/客户/供应商/打印/库房位置/员工/商品弹窗）', () => {
    expect(src('src/views/finance/ReconcileView.vue')).toMatch(/\.cancel-btn\s*\{[^}]*var\(--c-amber(?:,\s*[^)]*)?\)/)
    expect(src('src/views/sales/CustomersView.vue')).toMatch(/\.cancel\s*\{[^}]*var\(--c-amber(?:,\s*[^)]*)?\)/)
    expect(src('src/views/purchase/SuppliersView.vue')).toMatch(/\.cancel\s*\{[^}]*var\(--c-amber(?:,\s*[^)]*)?\)/)
    expect(src('src/components/PrintPreview.vue')).toMatch(/\.pp-btn\.ghost\s*\{[^}]*var\(--c-amber(?:,\s*[^)]*)?\)/)
    expect(src('src/views/warehouse/LocationsView.vue')).toMatch(/\.link-btn\.muted\s*\{[^}]*var\(--c-amber(?:,\s*[^)]*)?\)/)
    expect(src('src/views/boss/UsersManageView.vue')).toContain('class="ui-btn ui-btn-cancel"')
    expect(src('src/views/boss/ProductListView.vue')).toMatch(/\.ghost-btn\.dismiss\s*\{[^}]*var\(--c-amber(?:,\s*[^)]*)?\)/)
  })
})
