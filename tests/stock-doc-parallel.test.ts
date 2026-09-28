/**
 * 出入库历史列表提速（V2.2-1.11，2026-09-29 实测老板账号线上）：
 *   入库历史 3.2s / 3 个请求 / 3 段串行；出库历史 4.0s / 7 个请求 / 4 段串行。
 *
 * 根因：listDocs 把「流水 → 字典/商品 → 来源单 → 往来单位」排成 4 段串行，
 * 每段都要等上一趟新加坡往返（~0.5s/趟）结束才发下一趟。
 * 修复：压成 2 段——
 *   段 1：stockRecords 与 users/locations/明细表/往来单位 并行发出；
 *   段 2：商品与来源单据并行（这俩必须拿到 records 的 id 才能查）。
 * 往来单位改为整表随段 1 并行（客户/供应商体量小且 warmUp 已缓存），
 * 省掉「查完来源单再拿 id 查单位」这一整段等待。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const src = readFileSync(resolve(ROOT, 'src/stores/stockDoc.ts'), 'utf8')

/** 取 listDocs 函数体（到下一个顶层 async function 为止） */
const start = src.indexOf('async function listDocs(')
const end = src.indexOf('async function orderNoOf(', start)
const body = src.slice(start, end)

describe('出入库历史列表并行化', () => {
  it('段 1：流水与 users/locations/明细/往来单位 在同一处并行发出', () => {
    expect(start).toBeGreaterThan(0)
    const para = body.indexOf('await Promise.all([')
    expect(para).toBeGreaterThan(0)
    const block = body.slice(para, body.indexOf('])', para))
    expect(block).toContain("db.stockRecords.where('type').equals(recordType).toArray()")
    expect(block).toContain('db.users.toArray()')
    expect(block).toContain('db.locations.toArray()')
    expect(block).toContain('itemsTable.toArray()')
    expect(block).toContain('partyTable.toArray()')
  })

  it('段 2：商品与来源单据并行（都只依赖 records 的 id）', () => {
    const first = body.indexOf('await Promise.all([')
    const second = body.indexOf('await Promise.all([', first + 1)
    expect(second).toBeGreaterThan(first)
    // 注意：不能按 '])' 收尾——`Promise.resolve([] as any[])` 里也有 '])'
    const block = body.slice(second, second + 400)
    expect(block).toContain("db.products.where('id').anyOf(productIds).toArray()")
    expect(block).toContain("ordersTable.where('id').anyOf(refOrderIds)")
  })

  it('不再有「查完来源单再按 id 查往来单位」的第四段串行', () => {
    expect(body).not.toContain('const partyIds')
    expect(body).not.toMatch(/await \(type === 'in' \? db\.suppliers : db\.customers\)/)
    // 往来单位直接由段 1 的整表结果建索引
    expect(body).toContain('const partyMap = new Map(partyRows.map(')
  })

  it('空流水仍直接返回，不做后续查询（不回退）', () => {
    expect(body).toContain('if (!records.length) return []')
  })

  it('商品仍按 productIds 批量取，不回退成逐个 get', () => {
    expect(body).toContain("db.products.where('id').anyOf(productIds)")
    expect(body).not.toContain('db.products.get(')
  })
})
