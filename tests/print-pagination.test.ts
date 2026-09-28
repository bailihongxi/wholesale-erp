/**
 * 打印分页参数与分配规则（2026-09-28 定参 → 2026-09-29 凌晨修正）
 *
 * A5 参数（老板实测）：
 *   满页（中间页）12 行，首页 10 行（让 2 行给「往来单位」栏），末页不预留（装余数，≤ 12 行）。
 *
 * 两次反馈的来龙去脉：
 *   1) 2026-09-28：A5 第二页只打 6 行（旧「均分」算法把 12 行劈成 6/6）→ 定 满页 12 / 首页 10 / 末页 6；
 *   2) 2026-09-29 凌晨：20 行单据打成 10/5/5 三页（末页预留 6 把余数 10 行劈成 5+5），
 *      老板要求「20 行 = 首页 10 行 + 第二页 10 行，不出现第三页」→ 末页改为不预留、装余数；
 *      只有在「打满中间页会让末页只剩 1~2 行」时才匀出几行做防孤页。
 */
import { describe, expect, it } from 'vitest'
import { paginateItems } from '../src/utils/printTemplate'
import { PAPER_ROWS, PAPER_ROW_RESERVES } from '../src/utils/printSettings'

const A5 = PAPER_ROW_RESERVES.A5
const A5_CAP = PAPER_ROWS.A5
const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `商品${i + 1}` })) as any[]
const counts = (n: number, cap = A5_CAP, res = A5) => paginateItems(mk(n), cap, res).map(p => p.length)

describe('打印分页：A5（满页 12 / 首页 10 / 末页装余数）', () => {
  it('PAPER_ROWS 与预留参数为当前口径（A5 末页不预留；A4 维持 22 + 3/4）', () => {
    expect(PAPER_ROWS.A5).toBe(12)
    expect(PAPER_ROWS.A4).toBe(22)
    expect(A5).toEqual({ first: 2, last: 0 })
    expect(PAPER_ROW_RESERVES.A4).toEqual({ first: 3, last: 4 })
  })

  it('不超过首页容量时单页打完（≤10 行）', () => {
    expect(counts(10)).toEqual([10])
    expect(counts(7)).toEqual([7])
  })

  it('老板反馈用例：20 行 → 10 / 10，只有两页', () => {
    expect(counts(20)).toEqual([10, 10])
  })

  it('21 / 22 行 → 两页，末页装下全部余数', () => {
    expect(counts(21)).toEqual([10, 11])
    expect(counts(22)).toEqual([10, 12])
  })

  it('28 / 30 行 → 中间页打满 12 行，末页装余数', () => {
    expect(counts(28)).toEqual([10, 12, 6])
    expect(counts(30)).toEqual([10, 12, 8])
  })

  it('23 / 24 / 35 行 → 防孤页：末页至少 3 行，不出现 1~2 行的尾巴', () => {
    expect(counts(23)).toEqual([10, 10, 3])
    expect(counts(24)).toEqual([10, 11, 3])
    expect(counts(35)).toEqual([10, 12, 10, 3])
  })

  it('34 行 → 10 / 12 / 12', () => {
    expect(counts(34)).toEqual([10, 12, 12])
  })

  it('全量扫描 1..80 行：行数守恒、首页 ≤10、其余页 ≤12、无 1~2 行孤页（末页除外的小单场景）', () => {
    for (let n = 1; n <= 80; n++) {
      const c = counts(n)
      expect(c.reduce((a, b) => a + b, 0), `n=${n} 行数守恒`).toBe(n)
      expect(c[0], `n=${n} 首页 ≤ 10`).toBeLessThanOrEqual(10)
      for (let k = 1; k < c.length; k++) {
        expect(c[k], `n=${n} 第${k + 1}页 ≤ 12`).toBeLessThanOrEqual(12)
      }
      // 除「行数本身就少、只能凑出一页小尾巴」的情形外，任何页都不得只有 1~2 行
      for (let k = 1; k < c.length; k++) {
        if (c[k] <= 2) {
          expect(n, `n=${n} 出现 ${c[k]} 行孤页（仅 n ≤ 12 的小单允许）`).toBeLessThanOrEqual(12)
        }
      }
    }
  })

  it('A4 行为不变：40 行 → 19 / 11 / 10（与旧均分算法一致）', () => {
    expect(counts(40, PAPER_ROWS.A4, PAPER_ROW_RESERVES.A4)).toEqual([19, 11, 10])
  })

  it('A4 长单：50 行 → 19 / 22 / 9（中间页打满，末页装余数）', () => {
    expect(counts(50, PAPER_ROWS.A4, PAPER_ROW_RESERVES.A4)).toEqual([19, 22, 9])
  })
})
