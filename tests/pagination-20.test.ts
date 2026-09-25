/**
 * 分页粒度定值 20 —— 老板 2026-09-25 拍板：「本系统的分页一律按照 20，代码有冲突的一律以 20 为准，
 * 这是定值不允许以后有更改」。PRD.md 分页粒度条款同样是 20 行/页。
 *
 * 这些断言是防止以后有人（包括我）又手滑改回 50 / 100 / 1000，所以写得比较硬。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  PAGE_SIZE_LIST,
  PAGE_SIZE_PRODUCT,
  PAGE_SIZE_ALERT,
  usePagination,
} from '../src/composables/usePagination'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|vue|js)$/.test(p)) out.push(p)
  }
  return out
}

describe('分页粒度：全站一律 20 条/页（定值）', () => {
  it('PAGE_SIZE_LIST 必须是 20', () => {
    expect(PAGE_SIZE_LIST).toBe(20)
  })

  it('三个粒度别名恒等于 PAGE_SIZE_LIST，不存在第二套粒度', () => {
    expect(PAGE_SIZE_PRODUCT).toBe(20)
    expect(PAGE_SIZE_ALERT).toBe(20)
    expect(PAGE_SIZE_PRODUCT).toBe(PAGE_SIZE_LIST)
    expect(PAGE_SIZE_ALERT).toBe(PAGE_SIZE_LIST)
  })

  it('usePagination 切出来的每页行数不超过 20', () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({ i }))
    const pager = usePagination({ value: rows } as never, PAGE_SIZE_LIST)

    expect(pager.paged.value.length).toBe(20)
    // 第二页应从第 21 条开始，第二页末尾不越界（45 条 → 20/20/5）
    pager.go(2)
    expect(pager.paged.value.length).toBe(20)
    expect(pager.paged.value[0].i).toBe(20)
    expect(pager.paged.value[19].i).toBe(39)
    expect(pager.startIndex.value).toBe(21)
    // 45 条 → 3 页
    expect(pager.pageCount.value).toBe(3)
    pager.go(3)
    expect(pager.paged.value.length).toBe(5)
  })

  it('源码里不得出现「不是 20 的分页大小」硬编码', () => {
    const files = walk(join(__dirname, '..', 'src'))
    // 白名单：这些位置允许出现非 20 的数字，且都已注明理由
    const allowed: Array<[RegExp, RegExp]> = [
      // PostgREST 单次请求上限 1000 行，取的是「全表」，不是列表分页粒度
      [/ROW_PAGE\s*=/, /\d+/],
    ]

    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf-8')
      // 只盯 pageSize 字面量：其它 `size:`（字体/图标）与本规范无关
      const re = /\bpageSize\s*[:=]\s*(\d+)\b/g
      let m: RegExpExecArray | null
      const rel = f.replace(join(__dirname, '..') + '/', '')
      while ((m = re.exec(src)) !== null) {
        const n = Number(m[1])
        if (n === 20) continue
        if (allowed.some(([r]) => r.test(rel))) continue
        offenders.push(`${rel}:${src.slice(0, m.index).split('\n').length} → ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
