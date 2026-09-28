/**
 * keep-alive 缓存页路由监听守卫（2026-09-28 老板反馈「打开销售单/采购单总弹
 * 『没找到商品 #23』」）。
 *
 * 根因：App.vue 用无差别 keep-alive 缓存所有路由组件，缓存页里的
 * `watch(() => route.params.id, ...)` 是全局监听——打开任何带 :id 的路由
 * （销售单/采购单/出入库详情）都会唤醒 5 个缓存页各自加载一趟：
 * 商品编辑页把单据 id 误当商品 id 查商品表，查不到就弹「没找到商品 #N」；
 * 其余 4 个详情页则白白多发跨境请求（变相拖慢单据打开速度）。
 *
 * 修复：5 个路由加 name，5 个页面的监听器先判断 route.name 是不是自己的路由。
 * 本测试锁两件事：路由名存在 + 页面守卫存在。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const SRC = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

const PAIRS: Array<{ file: string; name: string; own: string[] }> = [
  { file: 'src/views/sales/SaleOrderDetailView.vue', name: 'SaleOrderDetail', own: ['SaleOrderDetail'] },
  { file: 'src/views/purchase/PurchaseOrderDetailView.vue', name: 'PurchaseOrderDetail', own: ['PurchaseOrderDetail'] },
  { file: 'src/views/warehouse/InboundDetailView.vue', name: 'InboundDetail', own: ['InboundDetail'] },
  { file: 'src/views/warehouse/OutboundDetailView.vue', name: 'OutboundDetail', own: ['OutboundDetail'] },
  {
    file: 'src/views/boss/ProductEditView.vue',
    name: 'ProductEdit',
    // 商品编辑页同时服务「新增」与「编辑」两个路由，两个都要放行
    own: ['ProductEdit', 'ProductNew'],
  },
]

describe('keep-alive 缓存页路由监听守卫', () => {
  it('router/index.ts 里 5 个带 :id 的路由都有 name', () => {
    const routerSrc = SRC('src/router/index.ts')
    for (const { name } of PAIRS) {
      for (const n of name === 'ProductEdit' ? ['ProductEdit', 'ProductNew'] : [name]) {
        expect(routerSrc, `路由缺少 name: ${n}`).toContain(`name: '${n}'`)
      }
    }
  })

  for (const { file, name, own } of PAIRS) {
    it(`${file} 的 route.params.id 监听器只认自己的路由（${own.join(' / ')}）`, () => {
      const src = SRC(file)
      const idx = src.indexOf('watch(() => route.params.id')
      expect(idx, '缺少 route.params.id 监听器').toBeGreaterThan(0)
      const block = src.slice(idx, idx + 600)
      for (const n of own) {
        expect(block, `守卫里应出现路由名 ${n}`).toContain(`'${n}'`)
      }
    })
  }
})
