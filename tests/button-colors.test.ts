import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 全站按钮配色统一（V2.0-29，用户硬性规范）：
 *   打印 = 绿    删除 / 取消 = 红    返回 = 橘    修改 = 蓝
 * 其余按钮（保存 / 确认 / 新增 / 查看 ……）一律不动。
 *
 * 这里是静态审计而非像素级截图 —— 目的是锁住「约定的底色确实有规则、
 * 且各页确实挂上了语义类」，防止后人改样式时把配色改回去或漏挂。
 */
const ROOT = resolve(__dirname, '..')
function src(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf-8')
}

const THEME = src('src/styles/theme.css')

/**
 * 从 theme.css 里取出某条规则块的声明体。
 * 选择器可能出现在选择器组里（如 `.btn-delete,\n.btn.danger {`），
 * 所以不能用「选择器后紧跟 {」的正则 —— 改为定位后向后找最近的一对花括号。
 */
function ruleBody(selector: string): string {
  // 只取「全站按钮配色统一」段落之后的规则，避免匹配到别处的同名类
  const seg = THEME.slice(THEME.indexOf('全站按钮配色统一'))
  const i = seg.indexOf(selector)
  if (i < 0) throw new Error(`theme.css 里找不到规则：${selector}`)
  const start = seg.indexOf('{', i)
  const end = seg.indexOf('}', start)
  if (start < 0 || end < 0) throw new Error(`theme.css 里规则不完整：${selector}`)
  return seg.slice(start + 1, end)
}

const GREEN = '#16a34a'
const RED = '#ef4444'
const ORANGE = '#f97316'
const BLUE = '#2f6bff'

describe('全站按钮配色：打印绿 / 删除取消红 / 返回橘 / 修改蓝', () => {
  it('theme.css 里定义了四种语义底色', () => {
    expect(THEME).toContain('--c-btn-print')
    expect(THEME).toContain('--c-btn-delete')
    expect(THEME).toContain('--c-btn-back')
    expect(THEME).toContain('--c-btn-edit')
  })

  it('打印按钮是绿色', () => {
    const b = ruleBody('.btn-print')
    expect(b).toContain('--c-btn-print')
    expect(THEME).toContain(`--c-btn-print: ${GREEN}`)
  })

  it('删除按钮是红色（含既有的 .btn.danger）', () => {
    expect(ruleBody('.btn-delete')).toContain('--c-btn-delete')
    expect(ruleBody('.btn.danger')).toContain('--c-btn-delete')
    expect(THEME).toContain(`--c-btn-delete: ${RED}`)
  })

  it('取消按钮是红色（含 .cancel / .cancel-btn / .ui-btn-cancel）', () => {
    for (const sel of ['.btn-cancel', '.cancel', '.cancel-btn', '.ui-btn-cancel']) {
      expect(ruleBody(sel), `${sel} 应为红`).toContain('--c-btn-delete')
    }
  })

  it('返回按钮是橘色', () => {
    expect(ruleBody('.btn-back')).toContain('--c-btn-back')
    expect(ruleBody('.pa-cancel.tone-back')).toContain('--c-btn-back')
    expect(THEME).toContain(`--c-btn-back: ${ORANGE}`)
  })

  it('修改按钮是蓝色', () => {
    expect(ruleBody('.btn-edit')).toContain('--c-btn-edit')
    expect(THEME).toContain(`--c-btn-edit: ${BLUE}`)
  })

  it('只覆盖底色/边框/文字色，不动字体与尺寸', () => {
    const seg = THEME.slice(THEME.indexOf('全站按钮配色统一'))
    // 统一段里不应出现 font-size / border-radius / padding / height 之类的版式声明
    expect(seg).not.toMatch(/font-size\s*:/)
    expect(seg).not.toMatch(/border-radius\s*:/)
    expect(seg).not.toMatch(/padding\s*:/)
    expect(seg).not.toMatch(/height\s*:/)
  })

  it('四张单据页的「修改/打印/删除」都挂上了语义类', () => {
    const pages = [
      'src/views/sales/SaleOrderDetailView.vue',
      'src/views/purchase/PurchaseOrderDetailView.vue',
      'src/views/sales/QuotesView.vue',
      'src/views/purchase/PurchaseQuotesView.vue'
    ]
    for (const p of pages) {
      const s = src(p)
      expect(s, `${p} 的修改按钮缺 btn-edit`).toMatch(/btn-edit[^>]*>?[\s\S]{0,120}修改/)
      expect(s, `${p} 的打印按钮缺 btn-print`).toContain('btn-print')
    }
  })

  it('出入库单：打印挂 btn-print、删除挂 btn-delete', () => {
    const s = src('src/views/warehouse/StockDocDetailView.vue')
    expect(s).toContain('btn-print')
    expect(s).toContain('btn-delete')
  })

  it('PageActions 按文案区分返回(橘) / 取消(红)', () => {
    const s = src('src/components/PageActions.vue')
    expect(s).toContain("'tone-cancel'")
    expect(s).toContain("'tone-back'")
    expect(s).toContain('isCancelText')
    expect(s).toContain("includes('取消')")
  })
})

describe('出入库单：撤回已合并进删除（V2.0-29）', () => {
  it('不再有独立的「撤回本单」按钮与 handleRevert', () => {
    const s = src('src/views/warehouse/StockDocDetailView.vue')
    expect(s).not.toContain('撤回本单')
    expect(s).not.toContain('handleRevert')
  })

  it('删除按钮仍受 canDeleteDoc 权限闸控制', () => {
    const s = src('src/views/warehouse/StockDocDetailView.vue')
    expect(s).toContain('canDeleteDoc')
    expect(s).toContain('🗑 删除本单')
  })

  it('页头副标题不再宣称可以整单撤回', () => {
    const s = src('src/views/warehouse/StockDocDetailView.vue')
    expect(s).not.toMatch(/也可整单撤/)
  })
})
