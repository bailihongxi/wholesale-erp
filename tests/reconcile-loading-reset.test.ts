import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

/**
 * 内存版 db 替身（同 finance-reconcile-balance.test.ts 的理由：
 * 本地 Dexie 在批量建索引时极慢，而这里验的是「页面能不能渲染出来」，与存储引擎无关）。
 */
function memTable() {
  let rows: Array<Record<string, any>> = []
  return {
    async toArray() { return rows.slice() },
    async add(o: Record<string, any>) {
      const id = rows.length + 1
      rows.push({ ...o, id })
      return id
    },
    async bulkAdd(list: Array<Record<string, any>>) { for (const o of list) await this.add(o) },
    async bulkPut(list: Array<Record<string, any>>) { for (const o of list) await this.add(o) },
    async put(o: Record<string, any>) { return this.add(o) },
    async clear() { rows = [] },
    async get(id: number) { return rows.find(r => r.id === id) },
    async update(id: number, ch: Record<string, any>) {
      const r = rows.find(x => x.id === id)
      if (r) Object.assign(r, ch)
    },
    async delete(id: number) { rows = rows.filter(r => r.id !== id) },
    where() { return { equals: () => ({ toArray: async () => [] as Record<string, any>[], count: async () => 0 }) } },
    filter(fn: (r: any) => boolean) { return Promise.resolve(rows.filter(fn)) },
    count() { return Promise.resolve(rows.length) }
  }
}

vi.mock('../src/db', () => {
  const mk = () => memTable()
  const t: Record<string, any> = {
    saleOrders: mk(), purchaseOrders: mk(), payments: mk(),
    customers: mk(), suppliers: mk(), users: mk(), ledger: mk(), products: mk()
  }
  return { db: t, localDb: t, initDefaultAdmin: async () => {} }
})

// 保留 Vant 真身（tests/setup.ts 要把它注册成全局插件），只替换弹窗类 API
vi.mock('vant', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return { ...actual, showToast: vi.fn(), showConfirmDialog: vi.fn(async () => {}) }
})

import { db as tables } from '../src/db'
import { setActivePinia, createPinia } from 'pinia'
import ReconcileView from '../src/views/finance/ReconcileView.vue'

/**
 * 应收应付对账页：加载完成后必须退出骨架屏（2026-09-25 线上事故回归）。
 *
 * 事故：给 reload() 加 try/catch 时，把 `loading.value = false` 从 finally
 * 挪进了 catch 分支 —— 于是**成功路径永不复位**：数据其实拉到了，
 * 但页面永远停在 LoadingBlock 骨架屏上，看起来跟「查不到单据」一模一样。
 *
 * 这里锁死：只要取数成功，骨架屏必须消失、单据必须出现在页面上。
 */
describe('对账页：取数成功后必须退出骨架屏', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    for (const t of Object.keys(tables)) await tables[t].clear()
  })

  it('有未付采购单时，加载结束后列表渲染出单据而不是停在骨架屏', async () => {
    await tables.purchaseOrders.add({
      orderNo: 'CG20260922-602', supplierId: 1, totalAmount: 3260,
      payStatus: 'unpaid', status: 'confirmed', orderDate: '2026-09-22T00:00:00.000Z'
    })
    await tables.suppliers.add({ name: '测试供应商' })

    const wrapper = mount(ReconcileView)
    for (let i = 0; i < 6; i++) await flushPromises()

    // 关键断言一：骨架屏必须消失（这次回归的正面锁）
    expect(wrapper.find('.ui-skeleton').exists()).toBe(false)

    // 默认是「应收」Tab，而应收侧本来就没销售单，切到「应付」再看
    await wrapper.findAll('.ui-seg-item')[1].trigger('click')
    for (let i = 0; i < 6; i++) await flushPromises()

    // 关键断言二：数据真的渲染出来了
    const text = wrapper.text()
    expect(text).toContain('CG20260922-602')
    expect(text).toContain('测试供应商')
    expect(text).toContain('¥3,260')
    wrapper.unmount()
  })

  it('没有任何单据时退出骨架屏并显示空态文案', async () => {
    const wrapper = mount(ReconcileView)
    for (let i = 0; i < 6; i++) await flushPromises()

    expect(wrapper.find('.ui-skeleton').exists()).toBe(false)
    expect(wrapper.text()).toContain('没有符合条件的应收')
    wrapper.unmount()
  })
})
