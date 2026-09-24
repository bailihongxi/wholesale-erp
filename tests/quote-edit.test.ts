import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { useQuotesStore } from '../src/stores/quotes'
import { useSalesStore } from '../src/stores/sales'
import { AUDIT_ACTIONS } from '../src/utils/audit'
import type { Product } from '../src/types'

/**
 * 「修改」功能从销售单归纳成通用模式后，落到三张单据页：采购单、预采询价、报价单。
 * 这里锁两件事：
 *  ① quotes store 新增的 updateQuote —— 改数量/单价/备注、金额重算、已转单禁止改；
 *  ② 三个页面确实按销售单那套接好了（useEditMode + EditModePanel，底部只有取消/保存）。
 */
let seq = 0
function uid(): string { seq += 1; return `${Date.now()}-${seq}` }

async function seedProduct(): Promise<Product> {
  const id = await db.products.add({
    brand: '测试品牌',
    model: `M-${uid()}`,
    category: '空调',
    spec: '',
    unit: '台',
    purchasePrice: 1000,
    wholesalePrice: 1200,
    retailPrice: 1500,
    warnStock: 1,
    status: 'active',
    remark: '',
    extra: {}
  }) as number
  return (await db.products.get(id))!
}

function fileOf(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8')
}

describe('报价单 / 预采询价：updateQuote', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.quoteOrders.clear()
    await db.quoteOrderItems.clear()
    await db.auditLogs?.clear?.()
  })

  it('改数量与单价后，明细整单替换、金额按明细重算，备注同步更新', async () => {
    const store = useQuotesStore()
    const a = await seedProduct()
    const b = await seedProduct()

    const created = await store.createQuote({
      customerId: 0,
      customerName: '红星商场 王老板',
      items: [
        { product: a, quantity: 2, price: 1100 },
        { product: b, quantity: 1, price: 900 }
      ],
      remark: '原始备注',
      salesId: 1
    })
    expect(created.ok).toBe(true)
    const id = created.orderId!

    const res = await store.updateQuote(
      id,
      [
        { productId: a.id!, quantity: 5, price: 1000 },
        { productId: b.id!, quantity: 2, price: 800 }
      ],
      '改过之后的备注',
      1
    )
    expect(res.ok).toBe(true)

    const q = (await db.quoteOrders.get(id))!
    // 2*1100 + 1*900 = 3100 → 5*1000 + 2*800 = 6600
    expect(q.totalAmount).toBe(6600)
    expect(q.remark).toBe('改过之后的备注')

    const items = await db.quoteOrderItems.where('quoteOrderId').equals(id).toArray()
    expect(items.length).toBe(2)
    expect(items.find(it => it.productId === a.id!)?.quantity).toBe(5)
    expect(items.find(it => it.productId === b.id!)?.subtotal).toBe(1600)
  })

  it('明细为空时拒绝修改', async () => {
    const store = useQuotesStore()
    const a = await seedProduct()
    const created = await store.createQuote({
      customerId: 0,
      customerName: '散客',
      items: [{ product: a, quantity: 1, price: 500 }],
      remark: '',
      salesId: 1
    })
    const res = await store.updateQuote(created.orderId!, [], 'x', 1)
    expect(res.ok).toBe(false)
    expect(res.message).toContain('明细不能为空')
  })

  it('已转成销售单 / 采购单的报价单不能修改', async () => {
    const store = useQuotesStore()
    const salesStore = useSalesStore()
    const a = await seedProduct()
    // 必须真的建一条库存记录：只 modify 的话，若该商品本来没有库存行，改了个寂寞
    await db.stock.add({ productId: a.id!, quantity: 100, updatedAt: new Date().toISOString() })

    const cid = await salesStore.createCustomer({
      name: '城南电器', contact: '李老板', phone: '138', address: '城南',
      level: 'A', creditLimit: 0, paymentTerm: '', status: 'active', remark: ''
    })

    const created = await store.createQuote({
      customerId: cid,
      customerName: '',
      items: [{ product: a, quantity: 1, price: 1000 }],
      remark: '',
      salesId: 1
    })
    const id = created.orderId!

    const conv = await store.convertToSale(id, 1)
    expect(conv.ok).toBe(true)

    const res = await store.updateQuote(id, [{ productId: a.id!, quantity: 9, price: 1 }], 'x', 1)
    expect(res.ok).toBe(false)
    expect(res.message).toContain('不能修改')
  })

  it('修改会写审计日志', async () => {
    const store = useQuotesStore()
    const a = await seedProduct()
    const created = await store.createQuote({
      customerId: 0, customerName: '散客',
      items: [{ product: a, quantity: 1, price: 100 }],
      remark: '', salesId: 1
    })
    const res = await store.updateQuote(
      created.orderId!,
      [{ productId: a.id!, quantity: 2, price: 100 }],
      '',
      7
    )
    expect(res.ok).toBe(true)

    const logs = await db.auditLogs.toArray()
    const hit = logs.find(l => l.action === AUDIT_ACTIONS.QUOTE_UPDATE)
    expect(hit).toBeTruthy()
    expect(hit!.detail).toContain('修改报价单')
  })
})

describe('三张单据页都按销售单那套接好了「修改」', () => {
  const pages = [
    { name: '采购单', file: 'src/views/purchase/PurchaseOrderDetailView.vue' },
    { name: '报价单', file: 'src/views/sales/QuotesView.vue' },
    { name: '预采询价', file: 'src/views/purchase/PurchaseQuotesView.vue' }
  ]

  for (const p of pages) {
    it(`${p.name}：用 useEditMode + EditModePanel，底部只留「取消 / 保存修改」`, () => {
      const src = fileOf(p.file)
      // 通用件接好了
      expect(src).toContain("from '../../composables/useEditMode'")
      expect(src).toContain("from '../../components/EditModePanel.vue'")
      expect(src).toContain('<EditModePanel')
      expect(src).toContain('@cancel="closeEdit"')
      expect(src).toContain('@save="onSaveEdit"')
      // 进入编辑前先拷副本（页面自己的 beginEdit），而不是直接裸调 startEdit
      expect(src).toContain('async function beginEdit')
      expect(src).toContain('await startEdit()')
      // 保存成功后统一走 closeEdit 关闭模块（橘色返回键随之回来）
      expect(src).toContain('await closeEdit()')
      // 编辑模块里不再放「返回」按钮。
      // 注意：只比对真实标签用法（class="btn btn-back"），不要用裸 'btn-back'
      // —— 采购单的 CSS 注释里提到过这个类名，裸匹配会误报。
      //
      // V2.1-1.3 修正断言范围：报价单**详情头部**的「← 返回列表」（老板 V2.1-1.1 要求新增）
      // 属于详情态、不在编辑模块里，整文件匹配会误伤 —— 这里改成只查 <EditModePanel> 区块内部，
      // 意图（编辑模块内不许有返回键）不变。
      const panelStart = src.indexOf('<EditModePanel')
      const panelEnd = src.indexOf('</EditModePanel>')
      expect(panelStart, `${p.name} 未找到 <EditModePanel>`).toBeGreaterThan(-1)
      expect(panelEnd, `${p.name} 未找到 </EditModePanel>`).toBeGreaterThan(panelStart)
      const panelSrc = src.slice(panelStart, panelEnd)
      expect(panelSrc).not.toContain('btn btn-back')
      expect(panelSrc).not.toContain('class="btn-back"')
    })
  }

  it('采购单：编辑模块不再无条件整屏覆盖（旧 .edit-page 样式已交给组件）', () => {
    const src = fileOf('src/views/purchase/PurchaseOrderDetailView.vue')
    expect(src).not.toContain('.edit-page { position: fixed')
    expect(src).not.toContain('.edit-header')
    expect(src).not.toContain('.edit-items')
    // 样式必须都写在 <style> 里（历史上这里有一段 .modal-* 落在 </style> 之后，从未生效）
    const styleEnd = src.lastIndexOf('</style>')
    expect(styleEnd).toBeGreaterThan(0)
    expect(src.slice(styleEnd + '</style>'.length).trim()).toBe('')
  })
})

/**
 * V2.1-2.1（老板要求）：详情页的「返回」统一挪到**页面最下方**，用系统统一的橘色整行按钮
 * （`<PageActions cancel-text="返回">` → `.pa-cancel.tone-back` 橘）—— 不再挤在单据标题右边
 * 那颗小按钮里。预采询价单详情此前**完全没有**返回入口，这次一并补上。
 *
 * 四张详情页口径必须一致：销售单 / 采购单 / 报价单 / 预采询价单。
 * 编辑态统一收起（`v-if="!showEdit"`），编辑模块一关（useEditMode.closeEdit）自动回来。
 */
describe('详情页「返回」统一放页面最底部（橘色整行）', () => {
  const pages = [
    { name: '销售单', file: 'src/views/sales/SaleOrderDetailView.vue' },
    { name: '采购单', file: 'src/views/purchase/PurchaseOrderDetailView.vue' },
    { name: '报价单', file: 'src/views/sales/QuotesView.vue' },
    { name: '预采询价单', file: 'src/views/purchase/PurchaseQuotesView.vue' }
  ]

  for (const p of pages) {
    it(`${p.name}：底部有橘色「返回」，编辑态收起`, () => {
      const src = fileOf(p.file)
      // 必须挂在 PageActions 上（橘色来自 .pa-cancel.tone-back 这条全局规范），
      // 不能自己写一颗按钮 —— 否则配色/高度会和全站其它页面对不上。
      expect(src, `${p.name} 缺少底部橘色返回键`).toMatch(
        /<PageActions v-if="!showEdit" cancel-text="返回"/
      )
    })
  }

  it('报价单详情头部不再有「← 返回列表」小按钮（返回交给页面底部）', () => {
    const src = fileOf('src/views/sales/QuotesView.vue')
    expect(src).not.toContain('← 返回列表')
    // 头部动作区不再出现返回按钮类名（底部返回走 PageActions，不叫 btn-back）
    expect(src).not.toContain('btn btn-back')
  })

  it('底部返回键接的是回列表动作，不是路由推出', () => {
    const salesSrc = fileOf('src/views/sales/QuotesView.vue')
    const quoteSrc = fileOf('src/views/purchase/PurchaseQuotesView.vue')
    expect(salesSrc).toContain('<PageActions v-if="!showEdit" cancel-text="返回" @cancel="backToList" />')
    expect(quoteSrc).toContain('<PageActions v-if="!showEdit" cancel-text="返回" @cancel="backToList" />')
    // 两个页面都是页内三态（list / create / detail），返回 = 回到列表态
    expect(salesSrc).toContain("function backToList(): void { mode.value = 'list' }")
    expect(quoteSrc).toContain("function backToList(): void { mode.value = 'list' }")
  })
})
