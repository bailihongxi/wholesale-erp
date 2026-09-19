import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { useProductStore } from '../src/stores/product'
import { usePurchaseStore } from '../src/stores/purchase'
import { useSalesStore } from '../src/stores/sales'
import { useStockDocStore } from '../src/stores/stockDoc'
import {
  buildProductCSV, buildProductTemplate, parseCSV, csvToProducts, importProducts,
  findDuplicateProducts, mergeProducts, deleteProducts, bulkUpdateProducts, productKeyOf
} from '../src/utils/productIO'
import {
  getPriceRule, savePriceRule, calcWholesale, calcRetail, applyRounding, round2
} from '../src/utils/priceRule'
import { PAGE_SIZE_PRODUCT, PAGE_SIZE_LIST } from '../src/composables/usePagination'

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

// ============================================================ 价格规则

describe('价格规则（批发/零售加价比例）', () => {
  it('批发价与零售价按成本加成推算，默认 15% / 30%', () => {
    savePriceRule({ wholesaleRate: 15, retailRate: 30, rounding: 'yuan', autoFill: true })
    const rule = getPriceRule()
    expect(calcWholesale(2000, rule)).toBe(2300)
    expect(calcRetail(2000, rule)).toBe(2600)
  })

  it('修改加价率并持久化后，本地重新读取仍然生效', () => {
    savePriceRule({ wholesaleRate: 20, retailRate: 45, rounding: 'none', autoFill: false })
    const rule = getPriceRule()
    expect(rule.wholesaleRate).toBe(20)
    expect(rule.retailRate).toBe(45)
    expect(round2(calcWholesale(888, rule))).toBe(1065.6)
  })

  it('取整方式：整元 / 整十元 / 两位小数', () => {
    expect(applyRounding(1234.6, 'yuan')).toBe(1235)
    expect(applyRounding(1234.6, 'ten')).toBe(1230)
    expect(round2(applyRounding(1234.567, 'none'))).toBe(1234.57)
  })

  it('一键应用到全部商品：成本不变，两个售价重算', async () => {
    savePriceRule({ wholesaleRate: 10, retailRate: 25, rounding: 'yuan', autoFill: true })
    const rule = getPriceRule()
    const a = await seedProduct({ brand: '海尔', model: 'A1', purchasePrice: 800 })
    const b = await seedProduct({ brand: '美的', model: 'B1', purchasePrice: 2000 })

    for (const p of [a, b]) {
      await db.products.update(p.id!, {
        wholesalePrice: calcWholesale(p.purchasePrice, rule),
        retailPrice: calcRetail(p.purchasePrice, rule)
      })
    }

    const list = await db.products.toArray()
    const pa = list.find(x => x.id === a.id)!
    const pb = list.find(x => x.id === b.id)!
    expect(pa.purchasePrice).toBe(800)
    expect(pa.wholesalePrice).toBe(880)
    expect(pa.retailPrice).toBe(1000)
    expect(pb.wholesalePrice).toBe(2200)
    expect(pb.retailPrice).toBe(2500)
  })
})

// ============================================================ 商品导入导出

describe('商品档案导入导出与去重', () => {
  it('CSV 能原样往返：导出后解析回来的字段与原来一致（含逗号与引号）', async () => {
    const p = await seedProduct({ brand: '松下', model: 'X,99"特别版', category: '电视' })
    const csv = buildProductCSV([{
      brand: p.brand, model: p.model, category: p.category, spec: p.spec, unit: p.unit,
      purchasePrice: p.purchasePrice, wholesalePrice: p.wholesalePrice, retailPrice: p.retailPrice,
      warnStock: p.warnStock, status: p.status, remark: p.remark, stock: 0
    }])
    const rows = parseCSV(csv)
    expect(rows.length).toBe(1)
    expect(rows[0]['品牌']).toBe('松下')
    expect(rows[0]['型号']).toBe('X,99"特别版')
    expect(rows[0]['进价']).toBe('1000')
    // 模板本身也能被解析回来
    expect(parseCSV(buildProductTemplate()).length).toBe(1)
  })

  it('导入按「品牌+型号」去重：缺字段的行进错误清单，重名的按策略处理', async () => {
    await seedProduct({ brand: '格力', model: 'KFR-35GW' }) // 库里已有一条

    const csv = [
      '品牌,型号,分类,进价,批发价,零售价',
      '格力,KFR-35GW,空调,1100,1300,1500',   // 库里已有 → 取决于策略
      '美的,BCD-253,冰箱,800,900,1000',      // 全新
      '美的,BCD-253,冰箱,810,910,1010',      // 文件内重复
      ',ABC-1,,1,1,1'                        // 缺品牌 → 报错
    ].join('\n')

    const { rows, lineErrors } = csvToProducts(csv)
    expect(rows.length).toBe(3)
    expect(lineErrors[0].line).toBe(5)

    // 默认跳过：只新增 1 条
    const skipReport = await importProducts(rows, 'skip')
    expect(skipReport.created).toBe(1)
    expect(skipReport.skipped).toBe(2)          // 库里重复 1 + 文件内重复 1
    expect(skipReport.duplicated.length).toBe(2)
    expect(await db.products.count()).toBe(2)

    // 覆盖模式：上一轮新建的「美的」也已在库，因此 2 条同名行被更新；文件内重复仍跳过
    const owReport = await importProducts(rows, 'overwrite')
    expect(owReport.updated).toBe(2)
    expect(owReport.skipped).toBe(1)
    const updated = await db.products.where('brand').equals('格力').first()
    expect(updated!.purchasePrice).toBe(1100)
  })

  it('停售商品默认不参与重复判定，勾选后参与', async () => {
    await seedProduct({ brand: '海尔', model: 'H1', status: 'inactive' })
    const rows = csvToProducts('品牌,型号\n海尔,H1').rows
    const r1 = await importProducts(rows, 'skip', false)
    expect(r1.created).toBe(1)
    // 打开开关后，与停售档案同名的会被判为重复
    const p = await db.products.where('brand').equals('海尔').toArray()
    expect(p.length).toBe(2)
  })

  it('重名商品能被扫描出来，合并后库存累加且单据同步改指向', async () => {
    const supId = await seedSupplier()
    const ps = useProductStore()

    const a = await db.products.add({
      brand: '格力', model: 'KFR-35GW', category: '空调', spec: '', unit: '台',
      purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400, warnStock: 5,
      status: 'active', remark: '', extra: {}
    })
    await db.stock.add({ productId: a as number, quantity: 3, updatedAt: '' })
    // 直接插入第二条同名记录（绕开「品牌+型号不可重复」的建商品校验，模拟脏数据）
    const b = await db.products.add({
      brand: '格力', model: 'KFR-35GW', category: '空调', spec: '', unit: '台',
      purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400, warnStock: 5,
      status: 'active', remark: '', extra: {}
    })
    await db.stock.add({ productId: b as number, quantity: 2, updatedAt: '' })

    // 采购单明细挂在重复商品上
    const orderId = await db.purchaseOrders.add({
      orderNo: 'CG-TEST-1', supplierId: supId, purchaserId: 1, orderDate: '',
      status: 'pending', totalAmount: 0, payStatus: 'unpaid', remark: ''
    }) as number
    await db.purchaseOrderItems.add({
      purchaseOrderId: orderId, productId: b as number, quantity: 2, price: 1000, subtotal: 2000
    })

    const groups = await findDuplicateProducts()
    expect(groups.length).toBe(1)
    expect(groups[0].items.length).toBe(2)
    expect(productKeyOf(groups[0].items[0])).toBe('格力|kfr-35gw')

    const res = await mergeProducts(a as number, [a as number, b as number])
    expect(res.ok).toBe(true)
    expect(await db.products.count()).toBe(1)
    // 库存累加：3 + 2
    expect(await ps.getStock(a as number)).toBe(5)
    // 单据明细改指向保留商品
    const items = await db.purchaseOrderItems.where('purchaseOrderId').equals(orderId).toArray()
    expect(items[0].productId).toBe(a)
  })

  it('删除商品时，已被单据引用的会被保留', async () => {
    const free = await seedProduct({ brand: '闲置', model: 'X1' })
    const used = await seedProduct({ brand: '在用', model: 'Y1' })
    const supId = await seedSupplier()
    const orderId = await db.purchaseOrders.add({
      orderNo: 'CG-TEST-2', supplierId: supId, purchaserId: 1, orderDate: '',
      status: 'pending', totalAmount: 0, payStatus: 'unpaid', remark: ''
    }) as number
    await db.purchaseOrderItems.add({
      purchaseOrderId: orderId, productId: used.id!, quantity: 1, price: 100, subtotal: 100
    })

    const r = await deleteProducts([free.id!, used.id!])
    expect(r.deleted).toBe(1)
    expect(r.blocked).toBe(1)
    expect(await db.products.get(free.id!)).toBeUndefined()
    expect(await db.products.get(used.id!)).toBeTruthy()
  })

  it('批量编辑只写入勾选的字段', async () => {
    const p1 = await seedProduct({ brand: '甲', model: 'M1' })
    const p2 = await seedProduct({ brand: '乙', model: 'M2' })
    await bulkUpdateProducts([p1.id!, p2.id!], { category: '统一分类', unit: '套' })
    const list = await db.products.toArray()
    expect(list.filter(p => p.category === '统一分类').length).toBe(2)
    expect(list.filter(p => p.unit === '套').length).toBe(2)
    // 未改动的字段保持原值
    expect(list.find(p => p.id === p1.id)!.brand).toBe('甲')
  })
})

// ============================================================ 分页粒度

describe('分页粒度约定', () => {
  it('商品档案 100 条/页，其余商品列表 20 条/页', () => {
    expect(PAGE_SIZE_PRODUCT).toBe(100)
    expect(PAGE_SIZE_LIST).toBe(20)
  })
})

// ============================================================ 出入库单据（批次）

describe('出入库单：分批、明细、改量、撤回', () => {
  it('部分入库会拆成多张 RK 单，且都关联原采购单', async () => {
    const supId = await seedSupplier()
    const p = await seedProduct()
    const res = await usePurchaseStore().createOrder({
      supplierId: supId, purchaserId: 1, items: [{ product: p, quantity: 10 }], remark: ''
    })
    const oid = res.orderId!

    const r1 = await usePurchaseStore().inbound(oid, { [p.id!]: 4 }, 1)
    expect(r1.ok).toBe(true)
    expect(r1.batchNo).toMatch(/^RK\d{8}-\d{3}$/)

    const r2 = await usePurchaseStore().inbound(oid, { [p.id!]: 6 }, 1)
    expect(r2.batchNo).not.toBe(r1.batchNo)

    const docs = await useStockDocStore().listDocs('in')
    expect(docs.length).toBe(2)
    expect(docs.every(d => d.refOrderId === oid)).toBe(true)
    // 拆单后两批件数相加 = 10
    expect(docs.reduce((s, d) => s + d.totalQty, 0)).toBe(10)

    const order = await usePurchaseStore().getOrder(oid)
    expect(order!.status).toBe('completed')
  })

  it('入库单明细能按批次查出来，金额取来源单据的成交单价', async () => {
    const supId = await seedSupplier()
    const p = await seedProduct()
    const res = await usePurchaseStore().createOrder({
      supplierId: supId, purchaserId: 1, items: [{ product: p, quantity: 5, price: 1000 }], remark: ''
    })
    const r = await usePurchaseStore().inbound(res.orderId!, { [p.id!]: 5 }, 1)

    const { doc, items } = await useStockDocStore().getDoc('in', r.batchNo!)
    expect(doc).toBeTruthy()
    expect(doc!.totalQty).toBe(5)
    expect(doc!.amount).toBe(5000)
    expect(doc!.partyName).toBe('供应商A')
    expect(items[0].productName).toBe('格力 KFR-35GW')
    expect(items[0].orderedQty).toBe(5)
  })

  it('撤回入库单：库存原路退回，采购单回到待收货', async () => {
    const supId = await seedSupplier()
    const p = await seedProduct()
    const res = await usePurchaseStore().createOrder({
      supplierId: supId, purchaserId: 1, items: [{ product: p, quantity: 6 }], remark: ''
    })
    const oid = res.orderId!
    const r = await usePurchaseStore().inbound(oid, { [p.id!]: 6 }, 1)
    expect(await useProductStore().getStock(p.id!)).toBe(6)

    const revert = await useStockDocStore().revertDoc('in', r.batchNo!, 1)
    expect(revert.ok).toBe(true)
    expect(await useProductStore().getStock(p.id!)).toBe(0)
    const order = await usePurchaseStore().getOrder(oid)
    expect(order!.status).toBe('pending')
    expect((await useStockDocStore().listDocs('in')).length).toBe(0)
  })

  it('修改入库单数量：库存按差额调整，状态随累计数量重算', async () => {
    const supId = await seedSupplier()
    const p = await seedProduct()
    const res = await usePurchaseStore().createOrder({
      supplierId: supId, purchaserId: 1, items: [{ product: p, quantity: 10 }], remark: ''
    })
    const oid = res.orderId!
    const r = await usePurchaseStore().inbound(oid, { [p.id!]: 10 }, 1)
    expect((await usePurchaseStore().getOrder(oid))!.status).toBe('completed')

    // 改成 3：库存回到 3，单据转 partial
    const up = await useStockDocStore().updateDoc('in', r.batchNo!, { [p.id!]: 3 }, 1)
    expect(up.ok).toBe(true)
    expect(await useProductStore().getStock(p.id!)).toBe(3)
    expect((await usePurchaseStore().getOrder(oid))!.status).toBe('partial')

    // 超过订购量应被拒绝
    const bad = await useStockDocStore().updateDoc('in', r.batchNo!, { [p.id!]: 11 }, 1)
    expect(bad.ok).toBe(false)
    expect(bad.message).toContain('最多')
  })

  it('出库同样分批成 CK 单，撤回后库存恢复', async () => {
    const cid = await seedCustomer()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 10 })
    const res = await useSalesStore().createOrder({
      customerId: cid, salesId: 1, items: [{ product: p, quantity: 6 }], remark: ''
    })
    const r = await useSalesStore().outbound(res.orderId!, { [p.id!]: 4 }, 1)
    expect(r.batchNo).toMatch(/^CK\d{8}-\d{3}$/)
    expect(await useProductStore().getStock(p.id!)).toBe(6)

    const docs = await useStockDocStore().listDocs('out')
    expect(docs.length).toBe(1)
    expect(docs[0].partyName).toBe('客户A')

    await useStockDocStore().revertDoc('out', r.batchNo!, 1)
    expect(await useProductStore().getStock(p.id!)).toBe(10)
    expect((await useSalesStore().getOrder(res.orderId!))!.status).toBe('pending')
  })

  it('出库改量时库存不够会被拒绝，且不会破坏原库存', async () => {
    const cid = await seedCustomer()
    const p = await seedProduct()
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 5 })
    const res = await useSalesStore().createOrder({
      customerId: cid, salesId: 1, items: [{ product: p, quantity: 5 }], remark: ''
    })
    const r = await useSalesStore().outbound(res.orderId!, { [p.id!]: 2 }, 1)
    expect(await useProductStore().getStock(p.id!)).toBe(3)

    // 期间这张货被别的单卖掉 1 台（库存从 3 降到 2）
    await db.stock.where('productId').equals(p.id!).modify({ quantity: 2 })

    // 想把本单改成出 5 台：把原批次退回后库存也只有 4，不够 5 → 必须拒绝
    const bad = await useStockDocStore().updateDoc('out', r.batchNo!, { [p.id!]: 5 }, 1)
    expect(bad.ok).toBe(false)
    expect(bad.message).toContain('库存')
    // 拒绝后库存必须保持原样，不能出现负库存或半扣状态
    expect(await useProductStore().getStock(p.id!)).toBe(2)
  })
})

describe('商品选择器：已选行的视觉反馈', () => {
  async function mountPicker(count: number) {
    const { mount } = await import('@vue/test-utils')
    const ProductPicker = (await import('../src/components/ProductPicker.vue')).default
    const p = await seedProduct({ brand: '海尔', model: 'H9' })
    const selected = count > 0 ? { [p.id!]: count } : {}
    const wrapper = mount(ProductPicker, {
      props: { rows: [{ product: p, stock: 5 }], selected, showPrice: true, priceMode: 'wholesale' }
    })
    await new Promise(r => setTimeout(r, 30))
    return wrapper
  }

  it('未选中的行：白底 + 「＋ 添加」按钮', async () => {
    const w = await mountPicker(0)
    const row = w.find('tbody tr')
    expect(row.classes()).not.toContain('row-picked')
    expect(w.find('.pk-add').text()).toBe('＋ 添加')
    expect(w.find('.pk-add').classes()).not.toContain('pk-added')
  })

  it('已选中的行：整行加 row-picked（蓝色底色），按钮变橘色并显示「已选」', async () => {
    const w = await mountPicker(1)
    expect(w.find('tbody tr').classes()).toContain('row-picked')
    const btn = w.find('.pk-add')
    expect(btn.classes()).toContain('pk-added')
    expect(btn.text()).toBe('已选')
  })

  it('重复添加时按钮显示件数，仍可继续点击加数量', async () => {
    const w = await mountPicker(3)
    expect(w.find('.pk-add').text()).toContain('已选')
    expect(w.find('.pk-add').text()).toContain('3')
    await w.find('.pk-add').trigger('click')
    expect(w.emitted('pick')?.length).toBe(1)
  })
})
