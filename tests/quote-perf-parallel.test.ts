/**
 * 报价单列表/详情提速（2026-09-28 老板反馈：经销商进列表慢、点单号打开详情慢）
 *
 * 根因（云端模式每个 db 调用 = 一次新加坡跨境往返）：
 *  1. 列表 loader：ensureCustomers()（客户名单）→ serverPage()（分页查询）串行，
 *     首屏要等 2 个往返；
 *  2. openDetail：getQuote()（单头）→ getQuoteItems()（明细）串行，点单号要等 2 个往返
 *     ——原代码 `const [items] = await Promise.all([...])` 只包了一个请求，是假并行。
 *
 * 修复：两处都改成真并行，等待时间减半。本测试用源码契约锁住并行结构，
 * 防止以后改回串行（不锁运行时行为——那需要 mock 整条云端链路，收益低）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const src = readFileSync(resolve(ROOT, 'src/views/sales/QuotesView.vue'), 'utf8')

describe('报价单列表/详情并行提速', () => {
  it('openDetail 必须真并行：getQuote 与 getQuoteItems 同在一个 Promise.all', () => {
    const start = src.indexOf('async function openDetail')
    const end = src.indexOf('const stockMap = ref')
    expect(start).toBeGreaterThan(0)
    const fn = src.slice(start, end)
    expect(fn).toContain('Promise.all([')
    expect(fn).toContain('quotesStore.getQuote(id)')
    expect(fn).toContain('quotesStore.getQuoteItems(id)')
    // 两个调用必须落在同一个 await Promise.all([...]) 里（提取该块校验）
    const block = fn.slice(fn.indexOf('Promise.all(['), fn.indexOf('])', fn.indexOf('Promise.all([')))
    expect(block).toContain('getQuote(id)')
    expect(block).toContain('getQuoteItems(id)')
  })

  it('列表 loader 必须并行：serverPage 与 ensureCustomers 同在一个 Promise.all', () => {
    const start = src.indexOf('const pager = useServerPager')
    const end = src.indexOf('const page = computed')
    expect(start).toBeGreaterThan(0)
    const fn = src.slice(start, end)
    const block = fn.slice(fn.indexOf('Promise.all(['), fn.indexOf('])', fn.indexOf('Promise.all([')))
    expect(block).toContain('serverPage<QuoteOrder>')
    expect(block).toContain('ensureCustomers()')
  })

  it('有关键词时才允许先等客户名单（按客户名搜索需要拼 customerId.in）；无关键词不得串行等待', () => {
    const start = src.indexOf('const pager = useServerPager')
    const end = src.indexOf('const page = computed')
    const fn = src.slice(start, end)
    // await ensureCustomers() 只能出现在 if (kw) 分支内
    const kwBranch = fn.slice(fn.indexOf('if (kw)'), fn.indexOf('const extraFilter'))
    expect(kwBranch).toContain('await ensureCustomers()')
    const beforeKw = fn.slice(0, fn.indexOf('if (kw)'))
    expect(beforeKw).not.toContain('await ensureCustomers()')
  })
})
