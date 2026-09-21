/**
 * 线上事故回归：Supabase 单次请求最多 1000 行 + count 只在 from().select() 这一步生效。
 *
 * 事故现象（V2.0-4 线上）：商品档案 6281 条，但「采购单 / 销售单 / 报价单」里的
 * 「选择商品」弹窗永远只显示 **共 1000 条**，第 2 页之后翻不出来 → 无法正常开单。
 *
 * 根因：cloudDb 的 CloudQuery 先 `.select('*')` 拿到 FilterBuilder，之后又链式
 * `.select('*', { count: 'exact' })`。而 PostgREST 在 FilterBuilder 上的 select
 * **只认列名，{count}/{head} 被静默忽略（不报错）**，于是：
 *   - toArray 拿到的 count 恒为 null → 退化成 rows.length = 1000 →
 *     `total <= 1000` 直接 return，第 2 页永不拉取；
 *   - count() 的 head 失效 → 恒返回 0。
 * 而 `db.products.toArray()`（走 CloudTable._fetchAll）当时是对的，
 * 所以只有「商品档案」显示 6281、「选商品」显示 1000 —— 两边不一致。
 *
 * 本文件用一个严格复刻 PostgREST 这两条语义的假客户端来守这条线：
 * 只要有人把 CloudQuery 改回链式二次 select，本文件立刻变红。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import 'fake-indexeddb/auto'
import { CloudTable } from '../src/db/cloudDb'
import { db } from '../src/db'
import { useProductStore } from '../src/stores/product'
import type { Product } from '../src/types'

// ============================================================================
// Part A：复刻 PostgREST 语义的假客户端
// ============================================================================

/** 服务的 db-max-rows 上限：单次请求最多回 1000 行，Range 再大也没用 */
const MAX_ROWS = 1000

class FakeBuilder {
  private seenSelect = false
  private countRequested = false
  private head = false
  private filters: Array<(r: any) => boolean> = []
  private from = 0
  private to = Number.MAX_SAFE_INTEGER
  private orderField: string | null = null
  private orderAsc = true

  constructor(private rows: any[]) {}

  /**
   * 关键语义：**只有紧跟在 from() 之后的第一次 select 能开 count / head**；
   * 已经是 FilterBuilder 之后再调 select，只替换列名，选项一律忽略。
   */
  select(_cols: string, opts?: { count?: string; head?: boolean }): this {
    if (!this.seenSelect && opts) {
      this.countRequested = !!opts.count
      this.head = !!opts.head
    }
    this.seenSelect = true
    return this
  }

  eq(field: string, v: any): this { this.filters.push(r => r[field] === v); return this }
  in(field: string, vals: any[]): this { this.filters.push(r => (vals as any[]).includes(r[field])); return this }
  gt(field: string, v: any): this { this.filters.push(r => Number(r[field]) > Number(v)); return this }
  range(from: number, to: number): this { this.from = from; this.to = to; return this }
  limit(n: number): this { this.to = this.from + n - 1; return this }
  order(field: string, opts?: { ascending?: boolean }): this {
    this.orderField = field
    this.orderAsc = opts?.ascending !== false
    return this
  }

  private exec() {
    let rows = this.rows.filter(r => this.filters.every(f => f(r)))
    const total = rows.length
    if (this.orderField) {
      const f = this.orderField
      const dir = this.orderAsc ? 1 : -1
      rows = rows.slice().sort((a, b) => (a[f] < b[f] ? -1 : a[f] > b[f] ? 1 : 0) * dir)
    }
    // db-max-rows：Range 要得再多，单次也只给 1000 行
    const want = Math.max(0, Math.min(this.to - this.from + 1, MAX_ROWS))
    return {
      data: this.head ? null : rows.slice(this.from, this.from + want),
      count: this.countRequested ? total : null,
      error: null,
      status: 200
    }
  }

  then(resolve: any, reject?: any): any { return Promise.resolve(this.exec()).then(resolve, reject) }
}

function fakeClient(tables: Record<string, any[]>): any {
  return { from: (name: string) => new FakeBuilder(tables[name] ?? []) }
}

// ============================================================================
// Part A：断言
// ============================================================================

const TOTAL = 6281

/** 6281 条商品；「稀有分类」只出现在第 5001 条之后，用来暴露「只扫前 1000 行」的问题 */
function seedProducts(): any[] {
  return Array.from({ length: TOTAL }, (_, i) => ({
    id: i + 1,
    brand: `品牌${(i % 40) + 1}`,
    model: `M${i + 1}`,
    category: i === 5000 ? '稀有分类' : `分类${(i % 12) + 1}`,
    spec: `规格${i + 1}`,
    unit: '台',
    status: 'active',
    purchasePrice: 1000,
    wholesalePrice: 1200,
    retailPrice: 1500,
    warnStock: 1
  }))
}

describe('A. Supabase 1000 行上限：选商品只出 1000 条的根因回归', () => {
  function table(): CloudTable {
    return new CloudTable(fakeClient({ products: seedProducts(), stock: [] }), 'products')
  }

  it('假客户端确实复刻了 1000 行上限与「链式二次 select 吞掉 count」两条语义', async () => {
    const c = fakeClient({ products: seedProducts() })
    // 正确写法：count 在 from().select() 时传入 → 拿到真实总数
    const good: any = await c.from('products').select('*', { count: 'exact' }).range(0, 999)
    expect(good.count).toBe(TOTAL)
    expect(good.data).toHaveLength(1000)
    // 错误写法：FilterBuilder 上再 select，count 被忽略 → null（这就是当初的 bug）
    const bad: any = await c.from('products').select('*').select('*', { count: 'exact' }).range(0, 999)
    expect(bad.count).toBeNull()
    // 单次 Range 再大也只回 1000 行
    const big: any = await c.from('products').select('*').range(0, 9999)
    expect(big.data).toHaveLength(MAX_ROWS)
  })

  it('where().equals().toArray() 必须取全 6281 行（选商品的关键路径）', async () => {
    const rows = await table().where('status').equals('active').toArray()
    expect(rows).toHaveLength(TOTAL)
  })

  it('where().equals().count() 返回真实总数，而不是 0', async () => {
    const n = await table().where('status').equals('active').count()
    expect(n).toBe(TOTAL)
  })

  it('CloudTable.toArray() / count() 同样取全', async () => {
    expect(await table().toArray()).toHaveLength(TOTAL)
    expect(await table().count()).toBe(TOTAL)
  })

  it('where().equals().first() 用过滤后的第一行', async () => {
    const p = await table().where('id').equals(6281).first()
    expect(p?.id).toBe(6281)
  })

  it('distinct() 不会漏掉「第 1000 行之后才出现」的分类', async () => {
    const cats = await table().distinct('category')
    expect(cats).toContain('稀有分类')
    expect(cats).toHaveLength(13)
  })

  it('scanNarrow() 窄字段并行翻页取全', async () => {
    const rows = await table().scanNarrow('brand')
    expect(rows).toHaveLength(TOTAL)
  })

  it('scanNarrow() 支持把过滤条件下推（有货商品 id）', async () => {
    const t = new CloudTable(
      fakeClient({ stock: [{ id: 1, productId: 5, quantity: 0 }, { id: 2, productId: 9, quantity: 3 }] }),
      'stock'
    )
    const rows = await t.scanNarrow<{ productId: number }>('productId,quantity', (q: any) => q.gt('quantity', 0))
    expect(rows.map(r => r.productId)).toEqual([9])
  })

  it('bulkGet() 只发一个 id in 查询，并严格保持入参顺序（报价转单靠它对位）', async () => {
    const rows = await table().bulkGet([6281, 1, 99999, 500])
    expect(rows.map(r => r?.id)).toEqual([6281, 1, undefined, 500])
  })

  it('bulkGet() 入参为空时不发请求', async () => {
    expect(await table().bulkGet([])).toEqual([])
  })

  it('queryPage() 只拉当前页 + 返回正确总数（首屏不会把 6281 行搬进浏览器）', async () => {
    const p1 = await table().queryPage({ page: 1, pageSize: 20, orderBy: 'id', ascending: true })
    expect(p1.total).toBe(TOTAL)
    expect(p1.rows).toHaveLength(20)
    expect(p1.rows[0].id).toBe(1)

    const last = await table().queryPage({ page: 315, pageSize: 20, orderBy: 'id', ascending: true })
    expect(last.rows).toHaveLength(1)
    expect(last.rows[0].id).toBe(6281)
  })

  it('queryPage() 的分类等值过滤下推到服务端', async () => {
    const res = await table().queryPage({ page: 1, pageSize: 20, eq: { category: '稀有分类' } })
    expect(res.total).toBe(1)
    expect(res.rows[0].id).toBe(5001)
  })
})

// ============================================================================
// Part B：pickerPage 本地模式（测试环境 USE_CLOUD=false，走 IndexedDB 分支）
// ============================================================================

describe('B. productStore.pickerPage：按页取商品 + 当前页库存', () => {
  let store: ReturnType<typeof useProductStore>
  const COUNT = 45

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))

    await db.products.bulkAdd(
      Array.from({ length: COUNT }, (_, i) => ({
        brand: '格力',
        model: `KFR-${String(i + 1).padStart(3, '0')}`,
        category: i < 10 ? '空调' : '冰箱',
        spec: '1.5匹',
        unit: '台',
        purchasePrice: 1000,
        wholesalePrice: 1200,
        retailPrice: 1400,
        warnStock: 1,
        status: 'active',
        remark: '',
        extra: {}
      })) as Array<Omit<Product, 'id'>>
    )
    const list = await db.products.toArray()
    // 只有前 3 个商品有货
    await db.stock.bulkPut(
      list.map((p, i) => ({
        productId: p.id!,
        quantity: i < 3 ? 5 : 0,
        updatedAt: new Date().toISOString()
      }))
    )
    store = useProductStore()
    store.clearPickerCache()
  })

  it('默认按 20 条/页分页，总数是过滤后的真实条数', async () => {
    const p1 = await store.pickerPage({ page: 1 })
    expect(p1.total).toBe(COUNT)
    expect(p1.rows).toHaveLength(20)

    const p3 = await store.pickerPage({ page: 3 })
    expect(p3.rows).toHaveLength(5)
    // 页码连续：第 1 页与第 3 页不重复
    expect(p3.rows[0].product.id).not.toBe(p1.rows[0].product.id)
  })

  it('每行都带上该商品自己的库存（不是整表）', async () => {
    const p1 = await store.pickerPage({ page: 1 })
    expect(p1.rows[0].stock).toBe(5)
    expect(p1.rows[1].stock).toBe(5)
    expect(p1.rows[2].stock).toBe(5)
    expect(p1.rows[3].stock).toBe(0)
  })

  it('关键词下推过滤：模糊命中品牌 / 型号', async () => {
    const byModel = await store.pickerPage({ keyword: 'KFR-045' })
    expect(byModel.total).toBe(1)
    expect(byModel.rows[0].product.model).toBe('KFR-045')

    const byBrand = await store.pickerPage({ keyword: '格力' })
    expect(byBrand.total).toBe(COUNT)
  })

  it('关键词支持「空格分词、词内 AND」：品牌 + 型号一起查', async () => {
    const res = await store.pickerPage({ keyword: '格力 KFR-007' })
    expect(res.total).toBe(1)
    expect(res.rows[0].product.model).toBe('KFR-007')
  })

  it('分类过滤', async () => {
    const res = await store.pickerPage({ category: '空调' })
    expect(res.total).toBe(10)
    expect(res.rows.every(r => r.product.category === '空调')).toBe(true)
  })

  it('只看有货：只返回 quantity>0 的商品', async () => {
    const res = await store.pickerPage({ onlyInStock: true, pageSize: 50 })
    expect(res.total).toBe(3)
    expect(res.rows.every(r => r.stock > 0)).toBe(true)
  })

  it('分类集合供下拉使用，且命中全部分类', async () => {
    const cats = await store.pickerCategories()
    expect(cats).toEqual(['冰箱', '空调'])
  })
})

// ============================================================================
// Part C：ProductPicker 服务端模式
// ============================================================================

describe('C. ProductPicker 服务端模式（loader）', () => {
  const pickerProduct = {
    id: 7, brand: '海尔', model: 'H9', category: '空调', spec: '1.5匹', unit: '台',
    purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1500, warnStock: 0, status: 'active'
  } as any

  async function mountPicker(loader: any) {
    const { mount } = await import('@vue/test-utils')
    const ProductPicker = (await import('../src/components/ProductPicker.vue')).default
    const wrapper = mount(ProductPicker, { props: { loader, categories: ['空调', '冰箱'] } })
    await new Promise(r => setTimeout(r, 40))
    return wrapper
  }

  it('按 loader 拉当前页：占位条显示服务端总数，只渲染这一页', async () => {
    const calls: any[] = []
    const wrapper = await mountPicker(async (args: any) => {
      calls.push(args)
      return { rows: [{ product: pickerProduct, stock: 4 }], total: 6281 }
    })
    expect(calls[0]).toMatchObject({ page: 1, pageSize: 20, keyword: '', category: '', onlyInStock: false })
    expect(wrapper.text()).toContain('共 6281 条')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    // 服务端模式首拉完成后不再显示骨架
    expect(wrapper.find('.pk-loading').exists()).toBe(false)
    // 分类下拉来自 categories（rows 里只有当前页，推导不出全部分类）
    expect(wrapper.findAll('.pk-sel option').map(o => o.text())).toEqual(['全部分类', '空调', '冰箱'])
  })

  it('点击「＋ 添加」把该行库存一并抛出（开单页据此不再全量拉库存表）', async () => {
    const wrapper = await mountPicker(async () => ({
      rows: [{ product: pickerProduct, stock: 4 }], total: 1
    }))
    await wrapper.find('.pk-add').trigger('click')
    const evt = wrapper.emitted('pick')!
    expect(evt).toHaveLength(1)
    expect(evt[0][0]).toEqual(pickerProduct)
    expect(evt[0][1]).toBe(4)
  })

  it('关键词输入防抖后带着 keyword 重新请求（每敲一个字不发请求）', async () => {
    const calls: any[] = []
    const wrapper = await mountPicker(async (args: any) => {
      calls.push(args)
      return { rows: [], total: 0 }
    })
    expect(calls).toHaveLength(1)

    await wrapper.find('input.search-field').setValue('海尔')
    // 防抖窗口内不应触发新请求
    expect(calls).toHaveLength(1)
    await new Promise(r => setTimeout(r, 400))
    expect(calls).toHaveLength(2)
    expect(calls[1].keyword).toBe('海尔')
  })

  it('「只看有货」勾选后立即带着 onlyInStock 重新请求', async () => {
    const calls: any[] = []
    const wrapper = await mountPicker(async (args: any) => {
      calls.push(args)
      return { rows: [], total: 0 }
    })
    await wrapper.find('.pk-check input').setValue(true)
    await new Promise(r => setTimeout(r, 20))
    expect(calls.at(-1).onlyInStock).toBe(true)
  })
})
