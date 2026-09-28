/**
 * 打印分页参数重设（2026-09-28 老板反馈：A5 第二页只打了 6 行，与设计不符）
 *
 * 老板实测拍板的 A5 新参数：
 *   满页（中间页）12 行，首页 10 行（让 2 行给「往来单位」栏），末页 6 行（让 6 行给「合计/大写/备注/签章」）。
 * A4 维持原参数不动（22 行，预留 -3/-4）。
 *
 * 原问题根因：旧参数 A5 满页=9 且收尾两页「均分」（ceil），老板实际把每页行数
 * 自定义为 12 后，首页 12-3=9 行、剩余 12 行被均分成 6/6 —— 中间页永远打不满。
 * 新算法收尾两页「优先填满前一页」（remaining - lastCap），保底均分防孤页。
 */
import { describe, expect, it } from 'vitest'
import { paginateItems } from '../src/utils/printTemplate'
import { PAPER_ROWS, PAPER_ROW_RESERVES } from '../src/utils/printSettings'

const A5 = PAPER_ROW_RESERVES.A5
const A5_CAP = PAPER_ROWS.A5
const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `商品${i + 1}` })) as any[]

describe('打印分页：A5 新参数（满页 12 / 首页 10 / 末页 6）', () => {
  it('PAPER_ROWS 与预留参数为老板拍板值', () => {
    expect(PAPER_ROWS.A5).toBe(12)
    expect(PAPER_ROWS.A4).toBe(22)
    expect(A5).toEqual({ first: 2, last: 6 })
    expect(PAPER_ROW_RESERVES.A4).toEqual({ first: 3, last: 4 })
  })

  it('不超过首页容量时单页打完', () => {
    const pages = paginateItems(mk(10), A5_CAP, A5)
    expect(pages.length).toBe(1)
    expect(pages[0].length).toBe(10)
  })

  it('21 行 → 10 / 6 / 5（老板截图那类单据：首页多打 1 行）', () => {
    const pages = paginateItems(mk(21), A5_CAP, A5)
    expect(pages.map(p => p.length)).toEqual([10, 6, 5])
  })

  it('28 行 → 10 / 12 / 6（正好一个满中间页，末页恰好 6 行）', () => {
    const pages = paginateItems(mk(28), A5_CAP, A5)
    expect(pages.map(p => p.length)).toEqual([10, 12, 6])
  })

  it('30 行 → 10 / 12 / 4 / 4（中间页打满，末页不超 6）', () => {
    const pages = paginateItems(mk(30), A5_CAP, A5)
    expect(pages.map(p => p.length)).toEqual([10, 12, 4, 4])
  })

  it('全量扫描 1..80 行：行数守恒、首页 ≤10、中间页 ≤12、末页 ≤6、不丢行不重复', () => {
    for (let n = 1; n <= 80; n++) {
      const pages = paginateItems(mk(n), A5_CAP, A5)
      const counts = pages.map(p => p.length)
      expect(counts.reduce((a, b) => a + b, 0), `n=${n} 行数守恒`).toBe(n)
      expect(counts[0], `n=${n} 首页 ≤ 10`).toBeLessThanOrEqual(10)
      for (let k = 1; k < counts.length - 1; k++) {
        expect(counts[k], `n=${n} 第${k + 1}页 ≤ 12`).toBeLessThanOrEqual(12)
      }
      expect(counts[counts.length - 1], `n=${n} 末页 ≤ 6（单页时按首页容量 10）`)
        .toBeLessThanOrEqual(pages.length === 1 ? 10 : 6)
      // 除首页外不应出现比末页容量还小的页面（防 1~2 行孤页撑页数）
      if (counts.length >= 3) {
        expect(counts[counts.length - 2], `n=${n} 倒数第二页应尽量填满（≥ 均分线）`)
          .toBeGreaterThanOrEqual(Math.ceil((n - counts[0] - 12 * (counts.length - 3)) / 2) - 0)
      }
    }
  })

  it('A4 行为不变：40 行 → 19 / 11 / 10（与旧均分算法一致）', () => {
    const pages = paginateItems(mk(40), PAPER_ROWS.A4, PAPER_ROW_RESERVES.A4)
    expect(pages.map(p => p.length)).toEqual([19, 11, 10])
  })
})
