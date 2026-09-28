/**
 * 慢请求兜底提示（V2.2-1.11）。
 *
 * 背景：supabase-js 的 fetch 永不超时（2026-09-29 实测 saleOrders 偶发 12.7s，
 * 正常 0.44s），出入库历史整表跨境拉取期间用户面对一个没有任何提示的空白页。
 * 修复：withSlowHint 软超时——到点提示一次，但**不取消**请求，结果照常返回；
 * 真正的失败仍由调用方原有 catch 报错。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { withSlowHint, SLOW_HINT_MS } from '../src/utils/slowHint'

const ROOT = resolve(__dirname, '..')
const inbound = readFileSync(resolve(ROOT, 'src/views/warehouse/InboundView.vue'), 'utf8')
const outbound = readFileSync(resolve(ROOT, 'src/views/warehouse/OutboundView.vue'), 'utf8')

const sleep = (ms: number, v?: unknown) => new Promise(r => setTimeout(() => r(v), ms))

describe('withSlowHint 行为', () => {
  it('请求够快：不触发提示，正常返回结果', async () => {
    let hinted = 0
    const v = await withSlowHint(sleep(10, 'ok'), 200, () => { hinted++ })
    expect(v).toBe('ok')
    expect(hinted).toBe(0)
  })

  it('请求超时：提示一次，但仍继续等到真实结果', async () => {
    let hinted = 0
    const v = await withSlowHint(sleep(120, 'late'), 30, () => { hinted++ })
    expect(v).toBe('late')
    expect(hinted).toBe(1)
  })

  it('请求失败：不拦截异常，原样抛出（失败提示仍归调用方的 catch）', async () => {
    let hinted = 0
    await expect(
      withSlowHint(sleep(10).then(() => { throw new Error('boom') }), 5, () => { hinted++ })
    ).rejects.toThrow('boom')
  })

  it('没传 onSlow 时原样返回（零开销直通）', async () => {
    const p = sleep(5, 'x')
    expect(await withSlowHint(p)).toBe('x')
  })

  it('默认阈值 5s（跨境请求正常 0.5s 内，不会误报）', () => {
    expect(SLOW_HINT_MS).toBe(5000)
  })
})

describe('出入库历史接入慢加载提示', () => {
  it('入库历史：listDocs 包了 withSlowHint 并有可见文案', () => {
    expect(inbound).toContain("import { withSlowHint, SLOW_HINT_MS } from '../../utils/slowHint'")
    expect(inbound).toContain("docStore.listDocs('in')")
    expect(inbound).toContain('网络较慢，入库历史仍在加载…')
  })

  it('出库历史：listDocs 包了 withSlowHint 并有可见文案', () => {
    expect(outbound).toContain("import { withSlowHint, SLOW_HINT_MS } from '../../utils/slowHint'")
    expect(outbound).toContain("docStore.listDocs('out')")
    expect(outbound).toContain('网络较慢，出库历史仍在加载…')
  })

  it('提示不替换数据加载：结果照常写入缓存（不回退）', () => {
    expect(inbound).toContain('historyCache.set(docs.value)')
    expect(outbound).toContain('historyCache.set(docs.value)')
  })
})
