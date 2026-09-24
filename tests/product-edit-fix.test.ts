/**
 * 商品档案四个线上 bug 的回归锁（V2.1-2）。
 *
 *   1. 搜索出多个商品时，只有第一次点「编辑」能改成功 —— 编辑页把 `route.params.id`
 *      在 setup 里取成常量，keep-alive 复用组件后保存仍写回第一个商品的 id。
 *   2. 新建 / 编辑后表单不清空，换一个商品编辑显示的还是上一个商品。
 *   3. 「合并同名」点了没反应 —— mergeProducts 用了云端 db 不存在的 db.transaction()。
 *   4. 商品信息没有备注字段 —— 表单里根本没有 remark，编辑还会把原备注冲掉。
 *
 * 既有用例只覆盖「合并功能本身」，没覆盖「点下去在云端能不能跑」，
 * 所以这里既有源码断言（防止把坑改回去），也有真实挂载的行为断言。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { db } from '../src/db'
import { useProductStore } from '../src/stores/product'
import { mergeProducts, findDuplicateProducts } from '../src/utils/productIO'
import ProductEditView from '../src/views/boss/ProductEditView.vue'

const SRC = (rel: string): string => readFileSync(resolve(__dirname, '..', rel), 'utf8')
/** 去掉注释后的源码：注释里会引用旧写法的方法名，断言代码时要先剥掉 */
const CODE = (rel: string): string =>
  SRC(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

async function seed(brand: string, model: string, over: Record<string, unknown> = {}) {
  const ps = useProductStore()
  await ps.createProduct({
    brand, model, category: '空调', spec: '1.5匹', unit: '台',
    purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400, warnStock: 5,
    status: 'active', remark: '', extra: {}, ...over
  } as never)
  const all = await ps.listAll(true)
  return all.find(p => p.brand === brand && p.model === model)!
}

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map(t => t.clear()))
})

// ============================================================ Bug 1 / 2 / 4：编辑页

describe('商品编辑页：换商品编辑必须换 id、换数据（bug 1 / 2）', () => {
  async function mountEdit(startPath: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/boss/products', component: { template: '<div>list</div>' } },
        { path: '/boss/products/new', component: ProductEditView },
        { path: '/boss/products/edit/:id', component: ProductEditView },
      ],
    })
    router.push(startPath)
    await router.isReady()
    const wrapper = mount(ProductEditView, { global: { plugins: [router] } } as any)
    // 等 initForm（分类 + 商品）跑完
    await new Promise(r => setTimeout(r, 60))
    return { wrapper, router }
  }

  it('依次编辑两个商品：第二个商品的修改落在自己身上，第一个不受影响', async () => {
    const a = await seed('海尔', 'H1')
    const b = await seed('海尔', 'H2')

    const { wrapper, router } = await mountEdit(`/boss/products/edit/${a.id}`)
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('海尔')

    // 切到第二个商品：表单必须整体换掉（品牌输入、型号输入都要跟着变）
    await router.push(`/boss/products/edit/${b.id}`)
    await new Promise(r => setTimeout(r, 80))
    const inputs = wrapper.findAll('input')
    expect((inputs[0].element as HTMLInputElement).value).toBe('海尔')
    expect((inputs[1].element as HTMLInputElement).value).toBe('H2')

    // 改备注 → 保存
    const remark = wrapper.find('textarea')
    await remark.setValue('第二台的备注')
    await wrapper.find('.pa-confirm').trigger('click')
    await new Promise(r => setTimeout(r, 120))

    expect((await db.products.get(b.id!))!.remark).toBe('第二台的备注')
    expect((await db.products.get(a.id!))!.remark).toBe('')
  })

  it('从新增页切到编辑页时，新建时填的内容不会残留到编辑表单', async () => {
    const p = await seed('美的', 'M1')
    const { wrapper, router } = await mountEdit('/boss/products/new')
    await wrapper.findAll('input')[0].setValue('残留品牌')
    await wrapper.findAll('input')[1].setValue('残留型号')
    expect((wrapper.findAll('input')[0].element as HTMLInputElement).value).toBe('残留品牌')

    await router.push(`/boss/products/edit/${p.id}`)
    await new Promise(r => setTimeout(r, 80))
    expect((wrapper.findAll('input')[0].element as HTMLInputElement).value).toBe('美的')
    expect((wrapper.findAll('input')[1].element as HTMLInputElement).value).toBe('M1')
  })

  it('保存时用的是当前路由的 id，而不是组件首次挂载时的 id（源码级）', () => {
    const src = CODE('src/views/boss/ProductEditView.vue')
    // 旧写法：const id = route.params.id —— setup 只跑一次，keep-alive 下永远停在第一件商品
    expect(src).not.toContain('const id = route.params.id')
    expect(src).toContain('const editId = computed(')
    expect(src).toContain('productStore.updateProduct(editId.value')
    // 每次载入都要先整份重置，否则上一个商品的字段会串到下一个
    expect(src).toContain('Object.assign(form, emptyForm())')
  })
})

describe('商品备注字段（bug 4）', () => {
  it('编辑页有备注输入框，且备注会写进商品档案', async () => {
    const src = SRC('src/views/boss/ProductEditView.vue')
    expect(src).toContain('v-model="form.remark"')
    expect(src).toContain("remark: String(form.remark ?? '')")

    const p = await seed('格力', 'G1', { remark: '原备注' })
    await useProductStore().updateProduct(p.id!, { remark: '新备注' })
    expect((await db.products.get(p.id!))!.remark).toBe('新备注')
  })

  it('编辑已有商品时不传 remark 也不会把原备注清空（payload 必带 remark）', () => {
    const src = SRC('src/views/boss/ProductEditView.vue')
    const payload = src.slice(src.indexOf('function payload()'), src.indexOf('async function handleSave'))
    expect(payload).toContain('remark')
  })
})

// ============================================================ Bug 3：合并同名

describe('合并同名商品（bug 3）', () => {
  it('mergeProducts 不得依赖 db.transaction（云端 db 没有这个方法）', () => {
    expect(CODE('src/utils/productIO.ts')).not.toContain('db.transaction')
  })

  it('列表页「合并同名」必须看返回值，不能无条件提示已合并', () => {
    const src = SRC('src/views/boss/ProductListView.vue')
    const fn = src.slice(src.indexOf('async function mergeSelected'), src.indexOf('async function removeSelected'))
    expect(fn).toContain('res.ok')
    expect(fn).toContain('mergeProducts(keep, ids)')
  })

  it('合并后：库存累加、单据与库位库存改指向、重名分组消失', async () => {
    const ps = useProductStore()
    const a = await seed('格力', 'KFR-35GW')
    // 直接插第二条同名脏数据（绕开新增时的同名校验）
    const b = await db.products.add({
      brand: '格力', model: 'KFR-35GW', category: '空调', spec: '', unit: '台',
      purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400, warnStock: 5,
      status: 'active', remark: '', extra: {}
    } as never)
    // 建档时已有一条库存行，直接改量，不要再加第二条（一个商品在 stock 表里只有一行）
    await db.stock.where('productId').equals(a.id!).modify({ quantity: 3 } as never)
    await db.stock.add({ productId: b as number, quantity: 2, updatedAt: '' } as never)
    await db.locationStock.add({ productId: b as number, locationId: 1, quantity: 2, updatedAt: '' } as never)
    await db.saleOrderItems.add({ saleOrderId: 1, productId: b as number, quantity: 1, price: 1200, subtotal: 1200 } as never)

    const res = await mergeProducts(a.id!, [a.id!, b as number])
    expect(res.ok).toBe(true)
    expect(await ps.getStock(a.id!)).toBe(5)
    expect((await db.saleOrderItems.toArray())[0].productId).toBe(a.id)
    expect((await db.locationStock.toArray())[0].productId).toBe(a.id)
    expect(await findDuplicateProducts()).toHaveLength(0)
  })
})

// ============================================================ 同名拦截

describe('同名商品拦截：新增与改名都不允许撞名', () => {
  it('品牌 / 型号带多余空格也视为同名，不会建出第二个商品', async () => {
    const ps = useProductStore()
    await seed('格力', 'KFR-35GW')
    const dup = await ps.createProduct({
      brand: ' 格力 ', model: 'KFR-35GW ', category: '空调', spec: '', unit: '台',
      purchasePrice: 1, wholesalePrice: 1, retailPrice: 1, warnStock: 0,
      status: 'active', remark: '', extra: {}
    } as never)
    expect(dup.ok).toBe(false)
    expect(await db.products.count()).toBe(1)
  })

  it('findSameName 能排除自身：编辑时改别的不该被同名校验拦住', async () => {
    const ps = useProductStore()
    const p = await seed('海尔', 'H9')
    expect(await ps.findSameName('海尔', 'H9')).toHaveLength(1)
    expect(await ps.findSameName('海尔', 'H9', p.id)).toHaveLength(0)
    expect(await ps.findSameName('海尔', 'H8')).toHaveLength(0)
  })

  it('改商品名撞到别的商品时，编辑页给出提示而不是写库（源码级）', () => {
    const src = SRC('src/views/boss/ProductEditView.vue')
    const save = src.slice(src.indexOf('async function handleSave'))
    expect(save).toContain('findSameName')
    expect(save).toContain('已存在同名商品')
  })
})
