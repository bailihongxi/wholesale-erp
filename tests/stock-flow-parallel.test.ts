/**
 * 出入库流水列表提速（V2.2-1.11，2026-09-29 实测：2.5s / 2 段串行）。
 *
 * 根因：loader 先拉流水分页（1.84s），拿到 productId 后再批量取商品（0.65s）。
 * 修复：流水分页发出的同时读商品内存缓存（warmUp 预热，命中 = 0 次网络请求），
 * 缓存里缺的商品再补一次窄字段（id,brand,model）批量查询；流水本身也只取用到的列。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const src = readFileSync(resolve(ROOT, 'src/views/stock/StockFlowView.vue'), 'utf8')

describe('出入库流水列表提速', () => {
  it('loader 里流水分页与商品读取在同一处并行发起', () => {
    const loaderStart = src.indexOf('loader: async (pg, size)')
    const loaderEnd = src.indexOf('})\nconst page = computed', loaderStart)
    const loader = src.slice(loaderStart, loaderEnd)
    expect(loader).toContain('await Promise.all([')
    expect(loader).toContain('serverPage<any>(db.stockRecords')
    expect(loader).toContain('readProductCache()')
  })

  it('流水按窄字段取（FLOW_FIELDS，不整行搬）', () => {
    expect(src).toContain("const FLOW_FIELDS = 'id,type,productId,quantity,refOrderId,createdAt'")
    expect(src).toContain('select: FLOW_FIELDS')
  })

  it('商品名缺失时补取，且云端走窄字段扫描、本地回落 bulkGet（不回退）', () => {
    expect(src).toContain('async function fetchProductNames(')
    expect(src).toContain("scanNarrow('id,brand,model'")
    expect(src).toContain('t.bulkGet(ids)')
    expect(src).toContain('if (miss.length) Object.assign(nameMap, await fetchProductNames(miss))')
  })

  it('商品缓存不可用时退化为读缓存空数组，不抛错', () => {
    expect(src).toContain('readProductCache() ?? []')
    expect(src).toContain("typeof t?.readCache === 'function'")
  })

  it('分页总数仍然透传（total: res.total）', () => {
    expect(src).toContain('total: res.total')
  })
})
