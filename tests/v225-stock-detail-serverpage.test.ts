/**
 * V2.2-2.5 回归：库存明细改服务端分页
 * ------------------------------------------------------------
 * 以前「库存明细」进页面要把全部商品（现网 6453 行）+ 全部库存各扫一遍（≈2.4s）
 * 才出表格。现在表格按页取 20 行、库存只查这 20 个商品；
 * 统计卡与「仅看低库存」跨表比对下推不了，改走带缓存的「底稿」。
 *
 * 本文件锁住三件事：
 *   1) stockPage 的分页 / 关键词 / 分类 / 库房下推与总数都正确；
 *   2) 当前页只带这一页的库存，不再整表搬；
 *   3) 底稿有缓存（不重复扫表），clearStockBase() 能让它重新算；
 *   4) 表格里的进价 / 批发价必须还在（V2.2-2.3 I2 窄字段漏了价格列，这里补锁）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import StockManageView from '../src/views/stock/StockManageView.vue'
import { useProductStore } from '../src/stores/product'
import { useUserStore } from '../src/stores/user'
import { db } from '../src/db'
import { PAGE_SIZE_LIST } from '../src/composables/usePagination'

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: { template: '<div/>' } },
    { path: '/stock', component: { template: '<div/>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div/>' } }
  ]
})

function setRole(role: string): void {
  const u = useUserStore()
  u.currentUser = {
    id: 1, name: 'tester', phone: '1', password: '',
    role: role as any, status: 'active', createdAt: ''
  }
}

/**
 * 造 n 个商品（品牌 5 个循环、分类空调/冰箱交替），返回真实的商品 id。
 * ⚠️ createProduct 不返回带 id 的对象，必须回头查表拿 id。
 */
async function seedProducts(n: number): Promise<number[]> {
  const store = useProductStore()
  for (let i = 0; i < n; i++) {
    await store.createProduct({
      brand: '品牌' + (i % 5),
      model: '型号-' + String(i + 1).padStart(3, '0'),
      category: i % 2 === 0 ? '空调' : '冰箱',
      spec: '1.5匹',
      unit: '台',
      purchasePrice: 1000,
      wholesalePrice: 1200,
      retailPrice: 1500,
      warnStock: 10,
      status: 'active',
      remark: '',
      extra: {}
    } as any)
  }
  const all = await db.products.toArray()
  return all.map(p => Number(p.id)).sort((a, b) => a - b)
}

describe('V2.2-2.5 库存明细：服务端分页取数', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    window.innerWidth = 1280
    setRole('boss')
    await Promise.all(db.tables.map(t => t.clear()))
    await testRouter.push('/stock?tab=detail')
    await testRouter.isReady()
  })

  it('分页粒度锁定 20 条/页（全站统一口径）', () => {
    expect(PAGE_SIZE_LIST).toBe(20)
  })

  it('25 条商品：第 1 页 20 行 / 总数 25，第 2 页 5 行', async () => {
    await seedProducts(25)
    const store = useProductStore()

    const p1 = await store.stockPage({ page: 1, pageSize: 20 })
    expect(p1.rows.length).toBe(20)
    expect(p1.total).toBe(25)

    const p2 = await store.stockPage({ page: 2, pageSize: 20 })
    expect(p2.rows.length).toBe(5)
    expect(p2.total).toBe(25)
  })

  it('关键词与分类都下推到服务端（总数按过滤结果算）', async () => {
    await seedProducts(10)
    const store = useProductStore()

    const byKw = await store.stockPage({ page: 1, pageSize: 20, keyword: '型号-007' })
    expect(byKw.total).toBe(1)
    expect(byKw.rows[0].model).toBe('型号-007')

    const byCat = await store.stockPage({ page: 1, pageSize: 20, category: '冰箱' })
    expect(byCat.total).toBe(5)
    expect(byCat.rows.every(r => r.category === '冰箱')).toBe(true)
  })

  it('「只看某库房有货」下推成 id 过滤：只有该库房有货的商品入选', async () => {
    const ids = await seedProducts(6)
    await db.locationStock.clear()
    await db.locationStock.bulkAdd([
      { productId: ids[0], locationId: 1, quantity: 3, updatedAt: '' },
      { productId: ids[1], locationId: 1, quantity: 0, updatedAt: '' }, // 数量为 0 不算有货
      { productId: ids[2], locationId: 2, quantity: 5, updatedAt: '' }
    ] as any)

    const store = useProductStore()
    const loc1 = await store.stockPage({ page: 1, pageSize: 20, locationId: 1 })
    expect(loc1.total).toBe(1)
    expect(loc1.rows[0].id).toBe(ids[0])

    const loc2 = await store.stockPage({ page: 1, pageSize: 20, locationId: 2 })
    expect(loc2.total).toBe(1)
    expect(loc2.rows[0].id).toBe(ids[2])
  })

  it('库存只查当前页这些商品（不再为 20 行搬整张 stock 表）', async () => {
    await seedProducts(25)
    const store = useProductStore()
    const res = await store.stockPage({ page: 1, pageSize: 20 })
    const ids = new Set(res.rows.map(r => Number(r.id)))
    expect(Object.keys(res.stock).length).toBeLessThanOrEqual(20)
    expect(Object.keys(res.stock).every(k => ids.has(Number(k)))).toBe(true)
  })
})

describe('V2.2-2.5 库存底稿：带缓存，不重复扫表', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    window.innerWidth = 1280
    setRole('boss')
    await Promise.all(db.tables.map(t => t.clear()))
  })

  it('60s 内重复取底稿不再扫商品表；clearStockBase() 后重新扫', async () => {
    await seedProducts(3)
    const store = useProductStore()
    const spy = vi.spyOn(db.products, 'toArray')

    const first = await store.stockBase()
    const after1 = spy.mock.calls.length
    expect(first.lites.length).toBe(3)

    const second = await store.stockBase()
    expect(second.lites.length).toBe(3)
    expect(spy.mock.calls.length, '第二次必须命中缓存，不能重复扫表').toBe(after1)

    store.clearStockBase()
    await store.stockBase()
    expect(spy.mock.calls.length, '清缓存后必须重新扫表').toBe(after1 + 1)

    spy.mockRestore()
  })

  it('底稿汇总的库存量与 stock 表一致，且带进价（统计卡金额要用）', async () => {
    const ids = await seedProducts(2)
    // 新增商品会自动带一行库存（数量 0），先清掉再铺确定值，避免累加干扰
    await db.stock.clear()
    await db.stock.bulkAdd([
      { productId: ids[0], quantity: 7, updatedAt: '' },
      { productId: ids[1], quantity: 3, updatedAt: '' }
    ] as any)

    const store = useProductStore()
    const base = await store.stockBase()
    expect(base.stock[ids[0]]).toBe(7)
    expect(base.stock[ids[1]]).toBe(3)
    // 进价必须带上：V2.2-2.3 的窄字段漏了它，导致「库存金额（进价）」恒为 0
    expect(base.lites.every(l => Number(l.purchasePrice) === 1000)).toBe(true)
  })
})

describe('V2.2-2.5 库存明细页：首屏只渲染当前页，价格列仍在', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    window.innerWidth = 1280
    setRole('boss')
    await Promise.all(db.tables.map(t => t.clear()))
    await testRouter.push('/stock?tab=detail')
    await testRouter.isReady()
  })

  it('25 条商品：表格只渲染 20 行，分页条显示共 25 条', async () => {
    await seedProducts(25)
    const w = mount(StockManageView, { global: { plugins: [testRouter] } })
    await flushPromises()

    await vi.waitFor(() => {
      expect(w.findAll('.stock-table tbody tr').length).toBe(20)
    }, { timeout: 3000 })
    expect(w.find('.pager-info').text()).toContain('25')

    // 翻到第 2 页应只剩 5 行（证明是按页取，不是前端切片全量）
    await w.find('.pager-btn[aria-label="下一页"]').trigger('click')
    await vi.waitFor(() => {
      expect(w.findAll('.stock-table tbody tr').length).toBe(5)
    }, { timeout: 3000 })

    w.unmount()
  })

  it('明细表格仍显示进价 / 批发价（守住 V2.2-2.3 漏字段的回归）', async () => {
    await seedProducts(1)
    const w = mount(StockManageView, { global: { plugins: [testRouter] } })
    await flushPromises()

    await vi.waitFor(() => {
      expect(w.findAll('.stock-table tbody tr').length).toBe(1)
    }, { timeout: 3000 })
    const row = w.find('.stock-table tbody tr').text()
    expect(row).toContain('¥1,000') // 进价
    expect(row).toContain('¥1,200') // 批发价

    w.unmount()
  })
})
