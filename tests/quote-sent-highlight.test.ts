/**
 * 报价单列表「已确定」状态放大加红（2026-09-28 老板要求）
 *
 * 需求口径（老板原话确认）：汉字内容不改变——经销商端保持「已确认」、
 * 销售/老板端保持「已报价」，只把颜色和字体改为红色 + 15px + 加粗。
 *
 * 本测试为源码级契约：
 * 1. statusText 各分支文案必须保持原样（不许改成统一文案）
 * 2. 筛选下拉 sent 选项文案保持「已报价」
 * 3. 手机端卡片徽章 .qc-status.sent 必须红色 + 15px + 加粗
 * 4. 电脑端表格 .quote-table td.sent 必须红色 + 15px + 加粗
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const SRC = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('报价单列表已确定状态放大加红（文案不动）', () => {
  const src = SRC('src/views/sales/QuotesView.vue')

  it('statusText 文案保持原样：经销商「已确认」/ 内部「已报价」', () => {
    const fn = src.slice(src.indexOf('function statusText'), src.indexOf('const canConvertQuote'))
    expect(fn).toContain("draft: '待确认'")
    expect(fn).toContain("sent: '已确认'")
    expect(fn).toContain("draft: '待报价'")
    expect(fn).toContain("sent: '已报价'")
  })

  it('筛选下拉的 sent 选项文案保持「已报价」', () => {
    expect(src).toContain('<option value="sent">已报价</option>')
  })

  it('手机端卡片徽章 .qc-status.sent：红色 15px 加粗', () => {
    expect(src).toContain('.qc-status.sent')
    const rule = src.slice(src.indexOf('.qc-status.sent'), src.indexOf('.quote-table td.sent'))
    expect(rule).toContain('#e53935')
    expect(rule).toContain('15px')
    expect(rule).toContain('font-weight: 600')
  })

  it('电脑端表格状态格 .quote-table td.sent：红色 15px 加粗', () => {
    const rule = src.slice(src.indexOf('.quote-table td.sent'))
    expect(rule).toContain('#e53935')
    expect(rule).toContain('15px')
    expect(rule).toContain('font-weight: 600')
  })
})
