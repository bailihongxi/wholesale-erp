/**
 * 库存作业增强的回归测试：
 *  - 验收 / 拣货备注：随出入库单留存，可事后修改
 *  - 操作列「明细 / 撤回（撤销）」按钮已拉开间距
 *  - 新增「调拨」「盘点」模块的库存一致性
 *  - 退换货：销售退货 / 采购退货 的库存与财务红冲
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import InboundDetailView from '../src/views/warehouse/InboundDetailView.vue'
import OutboundDetailView from '../src/views/warehouse/OutboundDetailView.vue'
import ReturnsView from '../src/views/warehouse/ReturnsView.vue'
import { useProductStore } from '../src/stores/product'
import { usePurchaseStore } from '../src/stores/purchase'
import { useSalesStore } from '../src/stores/sales'
import { useStockDocStore } from '../src/stores/stockDoc'
import { useInventoryStore } from '../src/stores/inventory'
import { db } from '../src/db'

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/warehouse/inbound/1' },
    { path: '/warehouse/inbound', component: { template: '<div>list</div>' } },
    { path: '/warehouse/inbound/:id', component: { template: '<div>detail</div>' } },
    { path: '/warehouse/inbound/doc/:batchNo', component: { template: '<div>doc</div>' } },
    { path: '/warehouse/outbound', component: { template: '<div>list</div>' } },
    { path: '/warehouse/outbound/:id', component: { template: '<div>detail</div>' } },
    { path: '/warehouse/outbound/doc/:batchNo', component: { template: '<div>doc</div>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div></div>' } }
  ]
})

async function seedProduct(over: Record<string, unknown> = {}) {
  const ps = useProductStore()
  await ps.createProduct({
    brand: '格力', model: 'KFR-35GW', category: '空调', spec: '1.5匹', unit: '台',
    purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400, warnStock: 10,
    status: 'active', remark: '', extra: {}, ...over
  } as never)
  const list = await ps.listAll(true)
  return list[list.length - 1]
}

async function seedSupplier(name = '供应商A') {
  return await usePurchaseStore().createSupplier({ name, contact: '王', phone: '1', address: '', paymentTerm: '', remark: '' })
}
async function seedCustomer(name = '客户A') {
  return await useSalesStore().createCustomer({
    name, contact: '李', phone: '2', address: '', level: 'A', creditLimit: 0,
    paymentTerm: '', loginPhone: '', loginPassword: '', status: 'active', remark: ''
  })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map(t => t.clear()))
})

// ============================================================ 备注

describe('验收 / 拣货备注', () => {
  it('入库备注写入流水，并随入库单明细带出，可事后修改', async () => {
    const sup = await seedSupplier()
    const p = await seedProduct()
    const res = await usePurchaseStore().createOrder({
      supplierId: sup, purchaserId: 1, items: [{ product: p, quantity: 5 }], remark: ''
    })
    const batchNo = (await usePurchaseStore().inbound(
      res.orderId!, { [p.id!]: 5 }, 1, '外箱破损 2 台已拒收，已拍照留证'
    )).batchNo!

    // 流水留痕
    const recs = await db.stockRecords.where('type').equals('purchase_in').toArray()
    expect(recs.length).toBe(1)
    expect(recs[0].remark).toContain('外箱破损')
    expect(recs[0].locationId).toBe(1)

    // 单据明细能带出备注
    const { doc } = await useStockDocStore().getDoc('in', batchNo)
    expect(doc!.remark).toBe('外箱破损 2 台已拒收，已拍照留证')

    // 事后修改备注
    await useStockDocStore().setDocRemark('in', batchNo, '已与供应商协商换货', 1)
    const after = await useStockDocStore().getDoc('in', batchNo)
    expect(after.doc!.remark).toBe('已与供应商协商换货')
  })

  it('出库备注写入流水，并随出库单明细带出', async () => {
    const cus = await seedCustomer()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 10 })
    const res = await useSalesStore().createOrder({
      customerId: cus, salesId: 2, items: [{ product: p, quantity: 4 }], remark: ''
    })
    const batchNo = (await useSalesStore().outbound(
      res.orderId!, { [p.id!]: 4 }, 1, '客户要求分两车发，首车 4 台'
    )).batchNo!

    const recs = await db.stockRecords.where('type').equals('sale_out').toArray()
    expect(recs[0].remark).toBe('客户要求分两车发，首车 4 台')
    const { doc } = await useStockDocStore().getDoc('out', batchNo)
    expect(doc!.remark).toBe('客户要求分两车发，首车 4 台')
  })
})

// ============================================================ 操作列间距

describe('操作列按钮间距', () => {
  it('入库验货：明细 / 撤回 成对渲染在 .op-cell 内', async () => {
    const sup = await seedSupplier()
    const p = await seedProduct()
    const res = await usePurchaseStore().createOrder({
      supplierId: sup, purchaserId: 1, items: [{ product: p, quantity: 3 }], remark: ''
    })
    await usePurchaseStore().inbound(res.orderId!, { [p.id!]: 1 }, 1)

    await testRouter.push(`/warehouse/inbound/${res.orderId!}`)
    await testRouter.isReady()
    const w = mount(InboundDetailView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await new Promise(r => setTimeout(r, 100))

    const cells = w.findAll('.op-cell')
    expect(cells.length).toBe(1)
    const btns = cells[0].findAll('button')
    expect(btns.length).toBe(2)
    expect(btns[0].text()).toBe('明细')
    expect(btns[1].text()).toBe('撤回')
    w.unmount()
  })

  it('出库拣货：明细 / 撤销 成对渲染在 .op-cell 内', async () => {
    const cus = await seedCustomer()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 10 })
    const res = await useSalesStore().createOrder({
      customerId: cus, salesId: 2, items: [{ product: p, quantity: 3 }], remark: ''
    })
    await useSalesStore().outbound(res.orderId!, { [p.id!]: 1 }, 1)

    await testRouter.push(`/warehouse/outbound/${res.orderId!}`)
    await testRouter.isReady()
    const w = mount(OutboundDetailView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await new Promise(r => setTimeout(r, 100))

    const cells = w.findAll('.op-cell')
    expect(cells.length).toBe(1)
    const btns = cells[0].findAll('button')
    expect(btns.length).toBe(2)
    expect(btns[0].text()).toBe('明细')
    expect(btns[1].text()).toBe('撤销')
    w.unmount()
  })
})

// ============================================================ 调拨 / 盘点

describe('调拨与盘点的库存一致性', () => {
  it('调拨只在库位间移动，总库存不变；来源库位不足时整体拒绝', async () => {
    const p = await seedProduct()
    const inv = useInventoryStore()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 10 })
    await inv.syncLocationStock()

    // 总仓 10 → 门店 4
    const ok = await inv.transfer(1, 2, { [p.id!]: 4 }, 1)
    expect(ok.ok).toBe(true)
    expect(await useProductStore().getStock(p.id!)).toBe(10)      // 总库存不变
    expect((await inv.locationStockMap(1))[p.id!]).toBe(6)        // 总仓剩 6
    expect((await inv.locationStockMap(2))[p.id!]).toBe(4)        // 门店得 4

    // 调出=调入 被拒
    expect((await inv.transfer(1, 1, { [p.id!]: 1 }, 1)).ok).toBe(false)
    // 门店只有 4，调 5 被拒
    const bad = await inv.transfer(2, 1, { [p.id!]: 5 }, 1)
    expect(bad.ok).toBe(false)
    expect(bad.message).toContain('不够')
    // 失败不改变分布
    expect((await inv.locationStockMap(2))[p.id!]).toBe(4)

    expect((await inv.listTransfers()).length).toBe(1)
  })

  it('盘点按实盘差异同时校正库位与总库存，并区分盘盈盘亏', async () => {
    const p = await seedProduct()
    const inv = useInventoryStore()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 10 })
    await inv.syncLocationStock()

    // 总仓系统 10，实盘 7 → 盘亏 3
    const r = await inv.stocktake(1, { [p.id!]: 7 }, 1)
    expect(r.ok).toBe(true)
    expect(r.loss).toBe(3)
    expect(r.profit).toBe(0)
    expect((await inv.locationStockMap(1))[p.id!]).toBe(7)
    expect(await useProductStore().getStock(p.id!)).toBe(7)

    // 再盘一次：实盘 9 → 盘盈 2
    const r2 = await inv.stocktake(1, { [p.id!]: 9 }, 1)
    expect(r2.profit).toBe(2)
    expect(await useProductStore().getStock(p.id!)).toBe(9)
    expect((await inv.listStocktakes()).length).toBe(2)
  })
})

// ============================================================ 退换货页面

describe('退换货页面', () => {
  it('渲染销售退货 / 采购退货 / 历史 三个子页', async () => {
    await testRouter.push('/warehouse')
    await testRouter.isReady()
    const w = mount(ReturnsView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await new Promise(r => setTimeout(r, 100))

    const text = w.text()
    expect(text).toContain('销售退货')
    expect(text).toContain('采购退货')
    expect(text).toContain('退换货历史')
    expect(w.findAll('select').length).toBeGreaterThanOrEqual(1)
    w.unmount()
  })
})
