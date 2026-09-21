import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { useProductStore } from '../src/stores/product'
import { usePurchaseStore } from '../src/stores/purchase'
import PurchaseOrderDetailView from '../src/views/purchase/PurchaseOrderDetailView.vue'
import type { Product } from '../src/types'
import {
  buildOrderPrintHTML,
  paginateItems,
  type PrintItem,
  type PrintOrderData
} from '../src/utils/printTemplate'
import {
  defaultPrintSettings,
  getPrintSettings,
  savePrintSettings,
  resolveRowsPerPage,
  PAPER_MM,
  PAPER_ROWS,
  type PrintSettings
} from '../src/utils/printSettings'
import PrintPreview from '../src/components/PrintPreview.vue'

const routes = [
  { path: '/', component: { template: '<div/>' } },
  { path: '/:rest(.*)', component: { template: '<div/>' } }
]

function makeRouter() {
  return createRouter({ history: createWebHistory(), routes })
}

function item(i: number): PrintItem {
  const cats = ['洗衣机', '冰箱', '空调']
  return {
    productName: `品牌${i}`,
    category: cats[i % cats.length],
    model: `M-${i}`,
    unit: '台',
    quantity: i + 1,
    price: 1000 + i,
    subtotal: (1000 + i) * (i + 1)
  }
}

function orderData(n: number): PrintOrderData {
  const items = Array.from({ length: n }, (_, i) => item(i + 1))
  return {
    orderNo: 'CG20260919001',
    date: '2026-09-19',
    partyName: '海尔总代',
    partyContact: '张经理',
    partyPhone: '13900000000',
    partyAddress: '青岛',
    partyLabel: '供应商',
    items,
    totalQuantity: items.reduce((s, x) => s + x.quantity, 0),
    totalAmount: items.reduce((s, x) => s + x.subtotal, 0),
    remark: '加急',
    title: '采购单',
    companyName: '测试家电批发'
  }
}

function pageCount(html: string): number {
  return (html.match(/<section class="page">/g) ?? []).length
}

describe('打印纸张与分页', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('默认纸张为 A5（A4 的一半），且 @page 尺寸正确', () => {
    const s = getPrintSettings()
    expect(s.paper).toBe('A5')
    const html = buildOrderPrintHTML(orderData(3), true, s)
    expect(html).toContain(`size: ${PAPER_MM.A5.w}mm ${PAPER_MM.A5.h}mm`)
    expect(html).toContain(`width: ${PAPER_MM.A5.w}mm`)
    // A5 = A4 的一半：210 × 148（横版）
    expect(PAPER_MM.A5.w).toBe(210)
    expect(PAPER_MM.A5.h).toBe(148)
  })

  it('A4 为竖版（210×297），切换后 @page 尺寸同步变化', () => {
    const a4 = buildOrderPrintHTML(orderData(3), true, { ...defaultPrintSettings(), paper: 'A4' })
    expect(a4).toContain(`size: ${PAPER_MM.A4.w}mm ${PAPER_MM.A4.h}mm`)
    expect(PAPER_MM.A4.w).toBe(210)
    expect(PAPER_MM.A4.h).toBe(297)
    expect(PAPER_MM.A4.h).toBeGreaterThan(PAPER_MM.A4.w)
  })

  it('不再提供 A3：纸张只有 A5 横版与 A4 竖版两种', () => {
    expect(Object.keys(PAPER_MM)).toEqual(['A5', 'A4'])
    // 历史设置里若残留 A3，读回时回退为默认 A5
    localStorage.setItem('erp_print_settings', JSON.stringify({ ...defaultPrintSettings(), paper: 'A3' }))
    expect(getPrintSettings().paper).toBe('A5')
  })

  it('小单据不分页：只有一页', () => {
    const html = buildOrderPrintHTML(orderData(3), true, defaultPrintSettings())
    expect(pageCount(html)).toBe(1)
    expect(html).toContain('第 1 / 1 页')
  })

  it('明细超出一页容量时自动分页，每页都有表头与单号', () => {
    const s = defaultPrintSettings() // A5，6 行/页
    const html = buildOrderPrintHTML(orderData(20), true, s)
    const total = pageCount(html)
    expect(total).toBeGreaterThan(1)

    // 每一页都有明细表头与单号
    const heads = html.match(/<th class="c-no">序号<\/th>/g) ?? []
    expect(heads.length).toBe(total)
    // 每页 meta 区都有单号（<title> 里还有一次，故按「单号：<b>」精确计数）
    const nos = html.match(/单号：<b>CG20260919001/g) ?? []
    expect(nos.length).toBe(total)

    // 页码连续
    for (let i = 1; i <= total; i++) {
      expect(html).toContain(`第 ${i} / ${total} 页`)
    }
  })

  it('分页不丢行、不重复：总行数与单据一致', () => {
    const chunks = paginateItems(Array.from({ length: 20 }, (_, i) => item(i + 1)), PAPER_ROWS.A5)
    const flat = chunks.flat()
    expect(flat.length).toBe(20)
    expect(new Set(flat.map(x => x.model)).size).toBe(20)
    // 首页与中间页不超容量，末页不超末页容量
    chunks.forEach((c, i) => {
      const isLast = i === chunks.length - 1
      expect(c.length).toBeLessThanOrEqual(isLast ? Math.max(3, PAPER_ROWS.A5 - 5) : PAPER_ROWS.A5)
    })
  })

  it('每页行数可手动指定并生效', () => {
    const s: PrintSettings = { ...defaultPrintSettings(), paper: 'A4', rowsPerPage: 4 }
    expect(resolveRowsPerPage(s)).toBe(4)
    const html = buildOrderPrintHTML(orderData(12), true, s)
    const total = pageCount(html)
    expect(total).toBeGreaterThan(1)
    // 每页不超过 4 行（首页会因留白略少）
    const perPage = html.split('<section class="page">').slice(1)
      .map(p => (p.match(/<tr>\s*<td class="c-no">/g) ?? []).length)
    perPage.forEach(n => expect(n).toBeLessThanOrEqual(4))
  })

  it('合计只在最后一页，且不再出现「大写金额」方框（已按需求移除）', () => {
    const html = buildOrderPrintHTML(orderData(20), true, defaultPrintSettings())
    const total = pageCount(html)
    const pages = html.split('<section class="page">').slice(1)
    expect(pages.length).toBe(total)
    pages.forEach((p, i) => {
      if (i === total - 1) expect(p).toContain('<tfoot>')
      else expect(p).not.toContain('<tfoot>')
    })
    expect(html).not.toContain('amount-box')
    expect(html).not.toContain('大写')
    // 合计行仍保留数量与金额
    expect(html).toContain('class="total-label">合计')
  })

  it('表头可编辑：公司名称 / 副标题 / 地址 / 电话 / 页脚 生效', () => {
    const s: PrintSettings = {
      ...defaultPrintSettings(),
      companyName: '某某家电批发',
      subtitle: '送货凭证',
      companyAddress: '济南市天桥区',
      companyPhone: '0531-88888888',
      footNote: '请核对无误后签字'
    }
    const html = buildOrderPrintHTML(orderData(2), true, s)
    expect(html).toContain('某某家电批发')
    expect(html).toContain('送货凭证')
    expect(html).toContain('济南市天桥区')
    expect(html).toContain('0531-88888888')
    expect(html).toContain('请核对无误后签字')
  })

  it('明细显示产品类别（洗衣机/冰箱/空调），客户能看懂是什么东西', () => {
    const html = buildOrderPrintHTML(orderData(3), true, defaultPrintSettings())
    expect(html).toContain('类别')
    expect(html).toContain('洗衣机')
    expect(html).toContain('冰箱')
    expect(html).toContain('空调')
  })

  it('字段可勾选：关闭「型号」后明细表不再出现该列', () => {
    const s: PrintSettings = { ...defaultPrintSettings(), paper: 'A4' }
    const on = buildOrderPrintHTML(orderData(2), true, s)
    expect(on).toContain('<th class="">型号</th>')
    expect(on).toContain('类别')

    s.columns = s.columns.map(c => (c.key === 'model' ? { ...c, on: false } : c))
    const off = buildOrderPrintHTML(orderData(2), true, s)
    expect(off).not.toContain('型号')
    // 关掉型号不影响「商品名列」：这里取当前默认列名，改列名时不必改断言
    const nameLabel = defaultPrintSettings().columns.find(c => c.key === 'name')!.label
    expect(off).toContain(nameLabel)
  })

  it('字段可改名：表头使用自定义列名', () => {
    const s: PrintSettings = { ...defaultPrintSettings(), paper: 'A4' }
    s.columns = s.columns.map(c => (c.key === 'model' ? { ...c, label: '规格型号' } : c))
    const html = buildOrderPrintHTML(orderData(2), true, s)
    expect(html).toContain('规格型号')
    expect(html).not.toContain('<th class="">型号</th>')
  })

  it('字段可排序：调整顺序后表头顺序随之变化', () => {
    const s: PrintSettings = { ...defaultPrintSettings(), paper: 'A4' }
    // 把「型号」挪到最前
    const rearranged = [
      s.columns.find(c => c.key === 'model')!,
      ...s.columns.filter(c => c.key !== 'model')
    ]
    s.columns = rearranged
    const html = buildOrderPrintHTML(orderData(2), true, s)
    const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'))
    expect(head.indexOf('型号')).toBeLessThan(head.indexOf('序号'))
  })

  it('不打单价时自动剔除单价/金额列，合计行仍带数量与金额', () => {
    const s: PrintSettings = { ...defaultPrintSettings(), paper: 'A4' }
    const html = buildOrderPrintHTML(orderData(2), false, s)
    expect(html).not.toContain('单价')
    expect(html).not.toContain('金额')
    expect(html).toContain('class="total-label">合计')
  })

  it('字段全部关闭也不报错，并给出兜底列', () => {
    const s: PrintSettings = { ...defaultPrintSettings(), paper: 'A4' }
    s.columns = s.columns.map(c => ({ ...c, on: false }))
    const html = buildOrderPrintHTML(orderData(2), true, s)
    expect(html).toContain('<table>')
    expect(html).toContain('合计')
  })

  it('字段配置持久化且缺失字段会自动补齐', () => {
    const s: PrintSettings = { ...defaultPrintSettings(), paper: 'A4' }
    s.columns = s.columns.map(c => (c.key === 'unit' ? { ...c, on: false } : c))
    savePrintSettings(s)
    const back = getPrintSettings()
    expect(back.columns.length).toBe(8)
    expect(back.columns.find(c => c.key === 'unit')!.on).toBe(false)

    // 历史数据缺少字段时补齐
    localStorage.setItem('erp_print_settings', JSON.stringify({ ...defaultPrintSettings(), columns: [{ key: 'name', on: true }] }))
    const back2 = getPrintSettings()
    expect(back2.columns.length).toBe(8)
    expect(back2.columns[0].key).toBe('name')
  })

  it('打印设置持久化到 localStorage 并可读回', () => {
    const s: PrintSettings = { ...defaultPrintSettings(), paper: 'A4', companyName: '持久公司' }
    savePrintSettings(s)
    const back = getPrintSettings()
    expect(back.paper).toBe('A4')
    expect(back.companyName).toBe('持久公司')
  })

  it('设置损坏时回退默认值，不抛异常', () => {
    localStorage.setItem('erp_print_settings', '{bad json')
    const s = getPrintSettings()
    expect(s.paper).toBe('A5')
    expect(s.companyName).toBe('')
  })
})

describe('详情页换单号必须重新加载（路由参数变化回归）', () => {
  beforeEach(async () => {
    localStorage.clear()
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
  })

  it('从单据 A 切到单据 B 时，详情页展示 B 的数据', async () => {
    const productStore = useProductStore()
    const purchaseStore = usePurchaseStore()

    await productStore.createProduct({
      brand: '海尔', model: 'XQB100', category: '洗衣机', unit: '台',
      purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400,
      dealerPrice: 1100, warnThreshold: 5
    })
    await purchaseStore.createSupplier({ name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: '' })
    await purchaseStore.createSupplier({ name: '美的总代', contact: '李', phone: '138', address: '', paymentTerm: '', remark: '' })
    const suppliers = await purchaseStore.listSuppliers()
    const p = await db.products.where('brand').equals('海尔').first() as Product

    const a = await purchaseStore.createOrder({
      supplierId: suppliers[0].id!, purchaserId: 1, items: [{ product: p, quantity: 2 }], remark: 'A单'
    })
    const b = await purchaseStore.createOrder({
      supplierId: suppliers[1].id!, purchaserId: 1, items: [{ product: p, quantity: 5 }], remark: 'B单'
    })

    const testRouter = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/purchase/orders/:id', component: PurchaseOrderDetailView },
        { path: '/purchase/orders', component: { template: '<div/>' } },
        { path: '/:rest(.*)', component: { template: '<div/>' } }
      ]
    })
    await testRouter.push(`/purchase/orders/${a.orderId}`)
    await testRouter.isReady()

    const wrapper = mount(PurchaseOrderDetailView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('海尔总代'), { timeout: 3000 })

    // 同一路由只换 id：组件被复用，必须重新加载
    await testRouter.push(`/purchase/orders/${b.orderId}`)
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('美的总代'), { timeout: 3000 })
    expect(wrapper.text()).not.toContain('海尔总代')
  })
})

describe('打印预览弹窗（纸张 / 表头编辑）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('提供纸张下拉且切换后立即重排预览', async () => {
    const router = makeRouter()
    const wrapper = mount(PrintPreview, {
      props: { visible: true, title: '采购单', orderData: orderData(20), showPrice: true },
      global: { plugins: [router] }
    })
    const select = wrapper.find('.pp-select')
    expect(select.exists()).toBe(true)
    const options = select.findAll('option').map(o => o.text())
    expect(options.length).toBe(2)
    expect(options[0]).toContain('A5')
    expect(options[1]).toContain('A4')
    expect(options.some(t => t.includes('A3'))).toBe(false)

    await select.setValue('A4')
    await flushPromises()
    const src = wrapper.find('iframe').attributes('srcdoc') ?? ''
    expect(src).toContain(`size: ${PAPER_MM.A4.w}mm ${PAPER_MM.A4.h}mm`)
  })

  it('表头设置可展开编辑并保存，预览随即更新', async () => {
    const router = makeRouter()
    const wrapper = mount(PrintPreview, {
      props: { visible: true, title: '采购单', orderData: orderData(2), showPrice: true },
      global: { plugins: [router] }
    })
    // 默认不展开编辑区
    expect(wrapper.find('.pp-editor').exists()).toBe(false)

    await wrapper.findAll('.pp-btn-mini').find(b => b.text().includes('表头设置'))!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.pp-editor').exists()).toBe(true)

    const inputs = wrapper.findAll('.pp-editor input[type="text"]')
    await inputs[0].setValue('新的公司抬头')
    await wrapper.findAll('.pp-btn-mini').find(b => b.text().includes('保存表头'))!.trigger('click')
    await flushPromises()

    expect(getPrintSettings().companyName).toBe('新的公司抬头')
    const src = wrapper.find('iframe').attributes('srcdoc') ?? ''
    expect(src).toContain('新的公司抬头')
  })

  it('未传 orderData 时沿用外部 html（向后兼容）', () => {
    const router = makeRouter()
    const wrapper = mount(PrintPreview, {
      props: { visible: true, title: '采购单', html: '<html><body>外部HTML</body></html>' },
      global: { plugins: [router] }
    })
    expect(wrapper.find('iframe').attributes('srcdoc')).toContain('外部HTML')
  })
})
