/**
 * 多库房能力的回归测试：
 *  - 库房可自行设定：新增 / 改名 / 删除（有货拦截、最后一个保留）
 *  - 入库落到指定库房、出库从指定库房扣（该库不够就拒绝）
 *  - 库存明细能看出「一个商品分布在不同库房」，且 Σ各库 = 总库存
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { useProductStore } from '../src/stores/product'
import { useSalesStore } from '../src/stores/sales'
import { usePurchaseStore } from '../src/stores/purchase'
import { useInventoryStore } from '../src/stores/inventory'
import { db } from '../src/db'
import type { Product } from '../src/types'

describe('多库房：设定、出入库落库与分布展示', () => {
  let productStore: ReturnType<typeof useProductStore>
  let salesStore: ReturnType<typeof useSalesStore>
  let purchaseStore: ReturnType<typeof usePurchaseStore>
  let inv: ReturnType<typeof useInventoryStore>

  async function seedProduct(): Promise<Product> {
    await productStore.createProduct({
      brand: '测试', model: '鞋A', category: '鞋', spec: '42', unit: '双',
      purchasePrice: 100, wholesalePrice: 120, retailPrice: 150, warnStock: 5,
      status: 'active', remark: '', extra: {}
    })
    const list = await productStore.search('')
    return list[list.length - 1]
  }

  async function seedSupplier() {
    return await purchaseStore.createSupplier({ name: '供应商A', contact: '王', phone: '1', address: '', paymentTerm: '', remark: '' })
  }
  async function seedCustomer() {
    return await salesStore.createCustomer({
      name: '客户A', contact: '李', phone: '2', address: '', level: 'A', creditLimit: 0,
      paymentTerm: '', loginPhone: '', loginPassword: '', status: 'active', remark: ''
    })
  }

  /** 直接给某商品在某库房铺库存（模拟已入库状态） */
  async function putStock(productId: number, locationId: number, qty: number): Promise<void> {
    await inv.applyLocationDelta(productId, locationId, qty)
    const s = await db.stock.where('productId').equals(productId).first()
    if (s) await db.stock.update(s.id!, { quantity: (s.quantity ?? 0) + qty })
    else await db.stock.add({ productId, quantity: qty, updatedAt: new Date().toISOString() })
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    productStore = useProductStore()
    salesStore = useSalesStore()
    purchaseStore = usePurchaseStore()
    inv = useInventoryStore()
    await inv.ensureLocations()
  })

  // ---------------------------------------------------------- 库房设定

  it('新增库房：正常新增 / 空名与重名被拦截', async () => {
    const base = await inv.listLocations()
    expect(base.length).toBeGreaterThanOrEqual(2)

    const r1 = await inv.addLocation('北京仓')
    expect(r1.ok).toBe(true)
    const all = await inv.listLocations()
    expect(all.map(l => l.name)).toContain('北京仓')

    expect((await inv.addLocation('   ')).ok).toBe(false)
    expect((await inv.addLocation('北京仓')).ok).toBe(false)
    expect((await inv.addLocation('总仓')).ok).toBe(false)
  })

  it('改名：id 不变，库存与历史跟着新名字走', async () => {
    const before = (await inv.listLocations())[0]
    const p = await seedProduct()
    await putStock(p.id!, before.id!, 6)

    const r = await inv.renameLocation(before.id!, '主仓')
    expect(r.ok).toBe(true)

    const after = await inv.listLocations()
    const target = after.find(l => l.id === before.id)!
    expect(target.name).toBe('主仓')
    // 库存没有被改名带走
    const dist = await inv.productDistribution(p.id!)
    expect(dist[before.id!]).toBe(6)
  })

  it('删除库房：有货拦截；清空后可删；最后一个不让删', async () => {
    const p = await seedProduct()
    const locs = await inv.listLocations()
    const target = locs[0]

    await putStock(p.id!, target.id!, 4)
    const blocked = await inv.deleteLocation(target.id!)
    expect(blocked.ok).toBe(false)
    expect(blocked.message).toContain('还有')

    // 调拨清空后就能删了
    await inv.applyLocationDelta(p.id!, target.id!, -4)
    const ok = await inv.deleteLocation(target.id!)
    expect(ok.ok).toBe(true)
    expect((await inv.listLocations()).some(l => l.id === target.id)).toBe(false)

    // 只剩一个时不许删
    const rest = await inv.listLocations()
    expect(rest.length).toBeGreaterThanOrEqual(1)
    // 把剩下的都删掉只留最后一个
    for (const l of rest.slice(1)) await inv.deleteLocation(l.id!)
    const last = (await inv.listLocations())[0]
    expect((await inv.deleteLocation(last.id!)).ok).toBe(false)
  })

  // ---------------------------------------------------------- 入库落库

  it('入库落到指定库房：总库存与该库房同步增加，别的库房不动', async () => {
    const p = await seedProduct()
    const sid = await seedSupplier()
    const po = await purchaseStore.createOrder({ supplierId: sid, purchaserId: 1, items: [{ product: p, quantity: 10 }], remark: '' })

    const newLoc = await inv.addLocation('二号仓')
    const r = await purchaseStore.inbound(po.orderId!, { [p.id!]: 10 }, 1, '到货正常', newLoc.id)
    expect(r.ok).toBe(true)

    // 总库存 10
    expect(await productStore.getStock(p.id!)).toBe(10)
    // 指定库房 10，默认库房 0
    const dist = await inv.productDistribution(p.id!)
    expect(dist[newLoc.id!]).toBe(10)
    const defId = await inv.defaultLocationId()
    expect(dist[defId] ?? 0).toBe(0)
    // 流水记录了库房
    const rec = await db.stockRecords.where('refOrderId').equals(po.orderId!).first()
    expect(rec?.locationId).toBe(newLoc.id)
  })

  // ---------------------------------------------------------- 出库扣库

  it('出库从指定库房扣：该库房不够就拒绝（哪怕总库存够）', async () => {
    const p = await seedProduct()
    const cid = await seedCustomer()
    const locs = await inv.listLocations()
    const a = locs[0], b = locs[1]

    // 总库存 10，全在 A 库房，B 库房 0
    await putStock(p.id!, a.id!, 10)

    const so = await salesStore.createOrder({ customerId: cid, salesId: 1, items: [{ product: p, quantity: 3 }], remark: '' })

    // 从 B 库房出：B 没货 → 拒绝
    const bad = await salesStore.outbound(so.orderId!, { [p.id!]: 3 }, 1, '', b.id)
    expect(bad.ok).toBe(false)

    // 从 A 库房出：正常
    const good = await salesStore.outbound(so.orderId!, { [p.id!]: 3 }, 1, '', a.id)
    expect(good.ok).toBe(true)

    const dist = await inv.productDistribution(p.id!)
    expect(dist[a.id!]).toBe(7)
    expect(await productStore.getStock(p.id!)).toBe(7)
  })

  // ---------------------------------------------------------- 分布展示

  it('一个商品可以分开存放在多个库房，Σ各库 = 总库存', async () => {
    const p = await seedProduct()
    const locs = await inv.listLocations()
    const a = locs[0]
    const c = await inv.addLocation('三号仓')

    await putStock(p.id!, a.id!, 6)
    await putStock(p.id!, c.id!, 4)

    // 调拨 2 件：A → 三号仓，总库存不变
    await inv.transfer(a.id!, c.id!, { [p.id!]: 2 }, 1)

    const dist = await inv.productDistribution(p.id!)
    expect(dist[a.id!]).toBe(4)
    expect(dist[c.id!]).toBe(6)
    expect(Object.values(dist).reduce((s, n) => s + n, 0)).toBe(10)
    expect(await productStore.getStock(p.id!)).toBe(10)

    // 库房维度的合计也正确
    const totals = await inv.locationTotals()
    expect(totals[a.id!]).toBe(4)
    expect(totals[c.id!]).toBe(6)
  })

  it('老数据（只写总库存、没有分布）打开时自动补齐，不破坏等式', async () => {
    const p = await seedProduct()
    // 模拟老版本：只在 stock 表里有数，locationStock 为空
    const s = await db.stock.where('productId').equals(p.id!).first()
    await db.stock.update(s!.id!, { quantity: 9 })
    await db.locationStock.where('productId').equals(p.id!).delete()

    await inv.reconcileProduct(p.id!)
    const dist = await inv.productDistribution(p.id!)
    expect(Object.values(dist).reduce((x, n) => x + n, 0)).toBe(9)
    expect(await productStore.getStock(p.id!)).toBe(9)
  })
})
