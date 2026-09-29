/**
 * V8 批二（V2.2-2.2）回归测试
 *  - K1 销售单提交：逐条 getStock 改一次批量 stockOf（N 个商品只发 1 次库存查询）
 *  - K2 调拨/盘点选商品：改用服务端 pickerPage loader，进页不再把全量商品拉进内存
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import { useProductStore } from '../src/stores/product'
import { useSalesStore } from '../src/stores/sales'
import TransferView from '../src/views/warehouse/TransferView.vue'
import CountView from '../src/views/warehouse/CountView.vue'
import { db } from '../src/db'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: { template: '<div/>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div/>' } }
  ]
})

async function seedProduct(brand: string, model: string, stock: number) {
  const ps = useProductStore()
  await ps.createProduct({
    brand, model, category: '测试', spec: '', unit: '台',
    purchasePrice: 100, wholesalePrice: 120, retailPrice: 140,
    warnStock: 5, status: 'active', remark: '', extra: {}
  } as never)
  const list = await ps.listAll(true)
  const p = list[list.length - 1]
  await db.stock.add({ productId: p.id!, quantity: stock })
  return p
}

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map(t => t.clear()))
})

describe('K1 销售单提交：库存检查 N→1', () => {
  it('N 个商品只发一次库存查询（批量 stockOf）', async () => {
    const a = await seedProduct('格力', 'A1', 5)
    const b = await seedProduct('美的', 'B2', 10)
    const c = await seedProduct('海尔', 'C3', 8)

    const whereSpy = vi.spyOn(db.stock, 'where')
    const sales = useSalesStore()
    const res = await sales.createOrder({
      customerId: 1, salesId: 1, remark: '',
      items: [
        { product: a, quantity: 3 },
        { product: b, quantity: 4 },
        { product: c, quantity: 2 }
      ]
    })
    expect(res.ok).toBe(true)
    // 三个商品只触发一次 stock.where（逐条 getStock 会是 3 次）
    expect(whereSpy).toHaveBeenCalledTimes(1)
  })

  it('任一商品库存不足时拦截，并带出商品名', async () => {
    const a = await seedProduct('格力', 'A1', 5)
    const b = await seedProduct('美的', 'B2', 10)
    const sales = useSalesStore()
    const res = await sales.createOrder({
      customerId: 1, salesId: 1, remark: '',
      items: [
        { product: a, quantity: 3 },
        { product: b, quantity: 99 } // 仅有 10
      ]
    })
    expect(res.ok).toBe(false)
    expect(res.message).toContain('美的')
    expect(res.message).toContain('库存不足')
  })
})

describe('K2 调拨/盘点选商品：服务端 loader（不再进页拉全量）', () => {
  it('TransferView 挂载即用 pickerLoader，分类已加载', async () => {
    const wrapper = mount(TransferView, { global: { plugins: [router, createPinia()] } })
    await flushPromises()
    await new Promise(r => setTimeout(r, 0))
    await flushPromises()
    expect(wrapper.find('.picker').exists()).toBe(true)
    // 服务端的 loader 已接入（不再是一次性 :rows 全量）
    expect(typeof (wrapper.vm as any).pickerLoader).toBe('function')
    expect(Array.isArray((wrapper.vm as any).pickerCats)).toBe(true)
  })

  it('CountView 挂载即用 pickerLoader', async () => {
    const wrapper = mount(CountView, { global: { plugins: [router, createPinia()] } })
    await flushPromises()
    await new Promise(r => setTimeout(r, 0))
    await flushPromises()
    expect(wrapper.find('.picker').exists()).toBe(true)
    expect(typeof (wrapper.vm as any).pickerLoader).toBe('function')
  })
})
