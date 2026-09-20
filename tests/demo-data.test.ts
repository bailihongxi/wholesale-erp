import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHashHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { seedDemoData, clearBusinessData } from '../src/utils/demoData'
import { usePurchaseStore } from '../src/stores/purchase'
import { useSalesStore } from '../src/stores/sales'
import { useProductStore } from '../src/stores/product'
import { useFinanceStore } from '../src/stores/finance'
import InboundView from '../src/views/warehouse/InboundView.vue'
import OutboundView from '../src/views/warehouse/OutboundView.vue'
import PurchaseOrdersView from '../src/views/purchase/PurchaseOrdersView.vue'
import SalesOrdersView from '../src/views/sales/SalesOrdersView.vue'
import CustomersView from '../src/views/sales/CustomersView.vue'
import SuppliersView from '../src/views/purchase/SuppliersView.vue'
import ReconcileView from '../src/views/finance/ReconcileView.vue'
import StockManageView from '../src/views/stock/StockManageView.vue'
import BossHomeView from '../src/views/boss/BossHomeView.vue'

const testRouter = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: { template: '<div/>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div/>' } }
  ]
})

// jsdom 默认宽度 1024 → 走电脑端表格分支
function mountView(comp: unknown) {
  return mount(comp as any, { global: { plugins: [testRouter] } })
}

describe('示例数据生成', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
  })

  it('一键生成后各业务表都有数据（不再空白）', async () => {
    const res = await seedDemoData()
    expect(res.ok).toBe(true)

    await vi.waitFor(async () => {
      expect(await db.products.count()).toBe(6)
    }, { timeout: 5000 })

    expect(await db.suppliers.count()).toBe(3)
    expect(await db.customers.count()).toBe(3)
    expect(await db.purchaseOrders.count()).toBe(3)
    expect(await db.saleOrders.count()).toBe(3)
    expect(await db.stockRecords.count()).toBeGreaterThan(0)
    expect(await db.payments.count()).toBeGreaterThan(0)
    expect(await db.stock.count()).toBe(6)
  })

  it('生成后「入库验货」有真实待入库单据', async () => {
    await seedDemoData()
    const pending = await usePurchaseStore().listPendingInbound()
    expect(pending.length).toBeGreaterThan(0)

    const w = mountView(InboundView)
    await vi.waitFor(() => {
      expect(w.text()).not.toContain('暂无待收货')
    }, { timeout: 5000 })
    expect(w.findAll('.order-table tbody tr').length).toBe(pending.length)
    w.unmount()
  })

  it('生成后「出库拣货」有真实待出库单据', async () => {
    await seedDemoData()
    const pending = await useSalesStore().listPendingOutbound()
    expect(pending.length).toBeGreaterThan(0)

    const w = mountView(OutboundView)
    await vi.waitFor(() => {
      expect(w.findAll('.order-table tbody tr').length).toBe(pending.length)
    }, { timeout: 5000 })
    w.unmount()
  })

  it('生成后采购单 / 销售单列表有内容', async () => {
    await seedDemoData()
    await flushPromises()

    const pw = mountView(PurchaseOrdersView)
    await vi.waitFor(() => expect(pw.findAll('.order-table tbody tr').length).toBe(3), { timeout: 5000 })
    pw.unmount()

    const sw = mountView(SalesOrdersView)
    await vi.waitFor(() => expect(sw.findAll('.order-table tbody tr').length).toBe(3), { timeout: 5000 })
    sw.unmount()
  })

  it('生成后客户 / 供应商 / 库存管理页有内容', async () => {
    await seedDemoData()
    await flushPromises()

    const cw = mountView(CustomersView)
    await vi.waitFor(() => expect(cw.text()).toContain('城南电器商行'), { timeout: 5000 })
    cw.unmount()

    const spw = mountView(SuppliersView)
    await vi.waitFor(() => expect(spw.text()).toContain('海尔华南总代'), { timeout: 5000 })
    spw.unmount()

    // 库存管理默认打开「库存作业」，商品明细在「库存明细」子模块里
    await testRouter.push('/stock?tab=detail')
    const stw = mountView(StockManageView)
    await vi.waitFor(() => expect(stw.text()).toContain('KFR-35GW'), { timeout: 5000 })
    stw.unmount()  })

  it('生成后财务应收应付有数据', async () => {
    await seedDemoData()
    const finance = useFinanceStore()
    await vi.waitFor(async () => {
      expect((await finance.listReceivables()).length).toBeGreaterThan(0)
    }, { timeout: 5000 })
    expect((await finance.listPayables()).length).toBeGreaterThan(0)

    const w = mountView(ReconcileView)
    await flushPromises()
    expect(w.text()).not.toContain('暂无')
    w.unmount()
  })

  it('库存数量与出入库流水一致', async () => {
    await seedDemoData()
    const productStore = useProductStore()
    const products = await db.products.toArray()
    const kfr = products.find(p => p.model === 'KFR-35GW')!
    // 采购入库 10 台，销售出库 4 + 2 台 → 剩 4 台
    await vi.waitFor(async () => {
      expect(await productStore.getStock(kfr.id!)).toBe(4)
    }, { timeout: 5000 })
  })

  it('已开通经销商登录号的客户可用手机号登录', async () => {
    await seedDemoData()
    const dealer = await db.customers.where('loginPhone').equals('13800006666').first()
    expect(dealer).toBeTruthy()
    expect(dealer?.loginPassword).toBe('123456')
  })

  it('生成了各角色员工账号且密码统一', async () => {
    await seedDemoData()
    const staff = await db.users.where('phone').startsWith('1370000000').toArray()
    expect(staff.length).toBe(4)
    expect(staff.map(s => s.role).sort()).toEqual(['finance', 'purchaser', 'sales', 'warehouse'])
    // 第十八轮起密码统一哈希存储，不再落明文
    expect(staff.every(s => /^pbkdf2\$/.test(s.password) || /^weak\$/.test(s.password))).toBe(true)
    // 哈希后仍可按原始密码登录（加盐哈希可校验）
    const { useUserStore } = await import('../src/stores/user')
    const loginRes = await useUserStore().login('13700000001', '123456')
    expect(loginRes.ok).toBe(true)
  })

  it('重复生成不会产生脏数据（幂等保护）', async () => {
    await seedDemoData()
    await vi.waitFor(async () => expect(await db.products.count()).toBe(6), { timeout: 5000 })

    const again = await seedDemoData()
    expect(again.ok).toBe(false)
    expect(await db.products.count()).toBe(6)
  })

  it('空数据时老板工作台显示「开始使用」引导，有数据后自动隐藏', async () => {
    const empty = mount(BossHomeView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await vi.waitFor(() => expect(empty.find('.guide').exists()).toBe(true), { timeout: 3000 })
    expect(empty.text()).toContain('载入示例数据')
    empty.unmount()

    await seedDemoData()
    await vi.waitFor(async () => expect(await db.products.count()).toBe(6), { timeout: 5000 })

    const filled = mount(BossHomeView, { global: { plugins: [testRouter] } })
    await vi.waitFor(() => expect(filled.find('.guide').exists()).toBe(false), { timeout: 5000 })
    filled.unmount()
  })

  it('清空后业务表归零且可再次生成', async () => {
    await seedDemoData()
    await vi.waitFor(async () => expect(await db.products.count()).toBe(6), { timeout: 5000 })

    await clearBusinessData()
    expect(await db.products.count()).toBe(0)
    expect(await db.purchaseOrders.count()).toBe(0)
    // 账号必须保留，否则清空后无法登录
    expect(await db.users.count()).toBeGreaterThan(0)

    const res = await seedDemoData()
    expect(res.ok).toBe(true)
  })
})
