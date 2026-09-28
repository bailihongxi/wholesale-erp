/**
 * 搜索特殊字符修复（2026-09-28 老板反馈：商品档案搜「CWY22-DFZ696GHU1 (Y6Pro)」
 * 弹「列表加载失败：products.queryPage: failed to parse logic tree」）。
 *
 * 根因：搜索词带圆括号时，旧的反斜杠转义 PostgREST 逻辑树解析器不认，
 * 整条 or() 查询被拒 → 列表加载失败。
 * 修复：所有 ilike 值统一用双引号包裹（`f.ilike."*词*"`，PostgREST 官方做法），
 * 引号内的括号/逗号按普通文字处理；escapeOr 只再转义会破坏引号语法的 `"` 与 `\`。
 *
 * 影响面（7 处调用点，全部要包引号）：cloudDb.queryPage 内置 search、
 * 商品 keywordCond、销售单 / 采购单 / 报价单 / 预采询价 / 客户 列表搜索。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { escapeOr } from '../src/db/cloudDb'

const ROOT = resolve(__dirname, '..')
const SRC = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

const CALL_SITES: Array<{ file: string; snippet: string }> = [
  { file: 'src/db/cloudDb.ts', snippet: '`${f}.ilike."*${escapeOr(kw)}*"`' },
  { file: 'src/stores/product.ts', snippet: '`or(${fields.map(f => `${f}.ilike."*${escapeOr(t)}*"`).join(\',\')})`' },
  { file: 'src/views/sales/SalesOrdersView.vue', snippet: 'const parts = [`orderNo.ilike."*${escapeOr(kw)}*"`]' },
  { file: 'src/views/purchase/PurchaseOrdersView.vue', snippet: 'const parts = [`orderNo.ilike."*${escapeOr(kw)}*"`]' },
  { file: 'src/views/sales/QuotesView.vue', snippet: 'const kwParts = [`orderNo.ilike."*${escapeOr(kw)}*"`, `customerName.ilike."*${escapeOr(kw)}*"`]' },
  { file: 'src/views/purchase/PurchaseQuotesView.vue', snippet: 'const kwParts = [`orderNo.ilike."*${escapeOr(kw)}*"`, `customerName.ilike."*${escapeOr(kw)}*"`]' },
  { file: 'src/views/sales/CustomersView.vue', snippet: '`${f}.ilike."*${escapeOr(kw)}*"`' },
]

describe('搜索特殊字符：ilike 值必须双引号包裹', () => {
  it('escapeOr 只转义双引号与反斜杠（引号内的括号/逗号交给引号保护）', () => {
    expect(escapeOr('CWY22-DFZ696GHU1')).toBe('CWY22-DFZ696GHU1')
    expect(escapeOr('(Y6Pro)')).toBe('(Y6Pro)')
    expect(escapeOr('a"b')).toBe('a\\"b')
    expect(escapeOr('a\\b')).toBe('a\\\\b')
  })

  for (const { file, snippet } of CALL_SITES) {
    it(`${file} 的搜索值用双引号包裹`, () => {
      expect(SRC(file)).toContain(snippet)
    })
  }

  it('全仓不允许再出现未加引号的 ilike.*${escapeOr…} 写法', () => {
    const files = [
      'src/db/cloudDb.ts', 'src/stores/product.ts',
      'src/views/sales/SalesOrdersView.vue', 'src/views/sales/QuotesView.vue',
      'src/views/sales/CustomersView.vue',
      'src/views/purchase/PurchaseOrdersView.vue', 'src/views/purchase/PurchaseQuotesView.vue',
    ]
    for (const f of files) {
      expect(SRC(f), `${f} 仍存在未加引号的 ilike 模式`).not.toMatch(/ilike\.\*\$\{escapeOr/)
    }
  })
})
