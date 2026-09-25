/**
 * V2.1-2.33 回归锁：三件老板反馈的修复
 * ① ItemCards 传 note（库存行）时不得顶替「× 单价 = 金额」行（2.32 回归）
 * ② 全站二级页面「返回」统一走 goBackOr（历史栈为空时回落到逻辑父列表，不再退出应用）
 * ③ 出入库列表/历史加载：消灭逐单 await 明细（N+1）与逐商品 await get，改 anyOf 批量 + 并行
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')
const read = (p: string): string => readFileSync(join(root, p), 'utf8')

describe('① ItemCards：note 是附加信息，不是单价行的替身', () => {
  const tpl = read('src/components/ui/ItemCards.vue')

  it('不得再出现「有 note 就跳过单价」的分支', () => {
    expect(tpl).not.toContain('showPrice && it.note')
    expect(tpl).not.toContain('v-else-if="showPrice"')
  })

  it('单价行（× ¥price = 金额）只在有价时出现（赠品行无价不出金额）', () => {
    expect(tpl).toContain('v-if="showPrice && it.price != null"')
    expect(tpl).toContain('ui-items-price">¥{{ money(it.price) }}')
    expect(tpl).toContain('ui-items-amount">¥{{ money(it.amount ?? (it.qty || 0) * (it.price || 0)) }}')
  })

  it('note 追加在行尾且与 showPrice 互不排斥', () => {
    expect(tpl).toContain('v-if="it.note"')
  })
})

describe('② 二级页面返回：goBackOr 统一兜底', () => {
  it('composable 存在且按 history.state.back 判定', () => {
    const src = read('src/composables/useGoBack.ts')
    expect(src).toContain('history.state?.back != null')
    expect(src).toContain('router.back()')
    expect(src).toContain('router.replace(fallback)')
  })

  it('views 目录下不得再有裸 router.back()', () => {
    const walk = (dir: string): string[] =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap(d =>
        d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]
      )
    const offenders = walk('src/views').filter(p => p.endsWith('.vue') && read(p).includes('router.back()'))
    expect(offenders).toEqual([])
  })

  const cases: Array<[string, string]> = [
    ['src/views/sales/SalesCreateView.vue', '/sales/orders'],
    ['src/views/sales/SaleOrderDetailView.vue', '/sales/orders'],
    ['src/views/boss/ProductEditView.vue', '/boss/products'],
    ['src/views/purchase/PurchaseCreateView.vue', '/purchase/orders'],
    ['src/views/purchase/PurchaseOrderDetailView.vue', '/purchase/orders'],
    ['src/views/warehouse/OutboundDetailView.vue', '/warehouse/outbound'],
    ['src/views/warehouse/InboundDetailView.vue', '/warehouse/inbound']
  ]
  for (const [file, fallback] of cases) {
    it(`${file} 返回回落到 ${fallback}`, () => {
      expect(read(file)).toContain(`goBackOr(router, '${fallback}')`)
    })
  }

  it('出入库操作页左键文案是「返回」不是「取消」（详情/操作页口径）', () => {
    expect(read('src/views/warehouse/OutboundDetailView.vue')).toContain('cancel-text="返回"')
    expect(read('src/views/warehouse/InboundDetailView.vue')).toContain('cancel-text="返回"')
  })

  it('返回列表时不得强行恢复历史 Tab（返回应停在离开时的 Tab）', () => {
    for (const [f, key] of [['src/views/warehouse/OutboundView.vue', 'outbound_tab'], ['src/views/warehouse/InboundView.vue', 'inbound_tab']] as const) {
      const src = read(f)
      // 只允许 setup 初始值读一次（整页刷新恢复用）；activate 回调里的强切已删
      const count = src.split(`getItem('${key}')`).length - 1
      expect(count, `${f} 里 getItem('${key}') 只能出现在 setup 初始值一处`).toBe(1)
      expect(src, 'activate 回调不得再读 tab 强切').not.toMatch(/savedTab/)
    }
  })
})

describe('③ 列表加载：批量查询替代逐条 await（N+1 清零）', () => {
  it('OutboundView 待发货计数一次 anyOf 查完，两个列表请求并行', () => {
    const src = read('src/views/warehouse/OutboundView.vue')
    expect(src).toContain("db.saleOrderItems.where('saleOrderId').anyOf(ids)")
    expect(src).toContain('Promise.all([')
    expect(src).not.toContain('(await salesStore.getOrderItems(o.id!)).length')
  })

  it('InboundView 待收货计数同治', () => {
    const src = read('src/views/warehouse/InboundView.vue')
    expect(src).toContain("db.purchaseOrderItems.where('purchaseOrderId').anyOf(ids)")
    expect(src).not.toContain('(await purchaseStore.getOrderItems(o.id!)).length')
  })

  it('出入库首页不再无条件拉历史（待发/待收优先出）', () => {
    for (const f of ['src/views/warehouse/OutboundView.vue', 'src/views/warehouse/InboundView.vue']) {
      const src = read(f)
      expect(src).toContain("if (tab.value === 'history') await loadHistory()")
    }
  })

  it('stockDoc.listDocs：商品/单号/往来单位全部 anyOf 批量，无逐条 await get', () => {
    const src = read('src/stores/stockDoc.ts')
    expect(src).toContain("db.products.where('id').anyOf(productIds)")
    expect(src).toContain("where('id').anyOf(refOrderIds)")
    expect(src).toContain("where('id').anyOf(partyIds)")
    expect(src).toContain('orderNoOfBatch(r.refOrderId)')
    expect(src).toContain('partyNameOfBatch(r.refOrderId)')
    expect(src).not.toContain('await db.products.get(pid)')
    // 仅 listDocs 的逐单 await 属于 N+1；getDoc（单张详情，固定 1 单）里保留是合法的
    expect(src).not.toContain('orderNoCache.set(r.refOrderId, await orderNoOf')
    expect(src).not.toContain('partyCache.set(r.refOrderId, await partyNameOf')
  })
})
