/**
 * 记一笔「关联单号」下拉提速（2026-09-28 老板反馈：选采购单后单号候选出得慢，
 * 来回切换才显示）。
 *
 * 根因：每切一次「关联单据」类型都现场扫一遍云端对应表（新加坡往返），
 * 切走再切回同类型也要重新等；等待期间下拉为空且无任何提示。
 * 修复三件套：
 *  1. linkDocCache 会话级缓存：同类型第二次选择秒出；
 *  2. preloadLinkNos 进入页面后台预载各类型单号（只填缓存不动下拉）；
 *  3. linkDocLoading 加载中占位提示；linkDocSeq 序号防快速切换时旧结果覆盖新结果。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const src = readFileSync(resolve(ROOT, 'src/views/finance/LedgerView.vue'), 'utf8')

describe('记一笔关联单号下拉提速', () => {
  it('有 linkDocCache 会话级缓存，且 loadLinkDocs 缓存命中时先回填再后台刷新', () => {
    expect(src).toContain('const linkDocCache = new Map<string, string[]>()')
    expect(src).toContain('linkDocCache.set(type, nos)')
    expect(src).toContain('if (cached) linkDocNos.value = cached')
  })

  it('onMounted 后台预载各类型单号（preloadLinkNos，火后不理）', () => {
    expect(src).toContain('function preloadLinkNos()')
    expect(src).toContain('preloadLinkNos()')
    const mountStart = src.indexOf('onMounted(async')
    const mountEnd = src.indexOf('useReloadOnActivate', mountStart)
    const mountBlock = src.slice(mountStart, mountEnd)
    expect(mountBlock).toContain('preloadLinkNos()')
  })

  it('加载中占位提示 linkDocLoading，且快速切换有序号防串（linkDocSeq）', () => {
    expect(src).toContain('const linkDocLoading = ref(false)')
    expect(src).toContain("'单号加载中…'")
    expect(src).toContain('let linkDocSeq = 0')
    expect(src).toContain('if (seq === linkDocSeq) linkDocNos.value = nos')
  })

  it('窄字段取行 narrowRows 保留（C 档优化不回退：仍只拉单号一列）', () => {
    expect(src).toContain('async function narrowRows(')
    expect(src).toContain('scanNarrow')
  })
})
