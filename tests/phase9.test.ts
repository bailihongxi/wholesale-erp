import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import type { Product } from '../src/types'

describe('阶段9：云同步 + 备份', () => {
  let sampleProduct: Product

  beforeEach(async () => {
    setActivePinia(createPinia())
    const { db } = await import('../src/db')
    await db.delete()
    await db.open()

    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    await productStore.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调',
      spec: '', unit: '台', purchasePrice: 1800,
      wholesalePrice: 2100, retailPrice: 2300,
      warnStock: 50, status: 'active', remark: '', extra: {}
    })
    const products = await productStore.search('')
    sampleProduct = products[0]
  })

  it('导出全部数据包含所有表', async () => {
    const { useSyncStore } = await import('../src/stores/sync')
    const store = useSyncStore()
    const backup = await store.exportAll()
    expect(backup.version).toBe(2)
    expect(backup.tables.products.length).toBe(1)
    expect(backup.tables.stock.length).toBe(1)
    expect(backup.tables.users).toBeDefined()
    expect(backup.tables.customers).toBeDefined()
  })

  it('导入恢复后数据完整', async () => {
    const { useSyncStore } = await import('../src/stores/sync')
    const syncStore = useSyncStore()
    const backup = await syncStore.exportAll()

    // 先清空数据
    const { db } = await import('../src/db')
    await db.products.clear()
    expect((await db.products.toArray()).length).toBe(0)

    // 恢复
    const res = await syncStore.importAll(backup)
    expect(res.ok).toBe(true)
    const products = await db.products.toArray()
    expect(products.length).toBe(1)
    expect(products[0].brand).toBe('格力')
  })

  it('从错误格式导入失败', async () => {
    const { useSyncStore } = await import('../src/stores/sync')
    const store = useSyncStore()
    // @ts-expect-error 故意传错格式
    const res = await store.importAll({ version: 1 })
    expect(res.ok).toBe(false)
  })

  it('未配置同步参数时上传会提示先配置（不再假装成功）', async () => {
    const { useSyncStore } = await import('../src/stores/sync')
    const { clearConfig } = await import('../src/utils/cloudSync')
    clearConfig()
    const store = useSyncStore()
    const res = await store.uploadToCloud()
    expect(res.ok).toBe(false)
    expect(res.message).toContain('请填写')
    expect(store.lastSyncAt).toBeFalsy()
  })

  it('导出后再导入，库存数量不变', async () => {
    // 先入库
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const purchaseStore = usePurchaseStore()
    const supplierId = await purchaseStore.createSupplier({
      name: '供应商', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const po = await purchaseStore.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: sampleProduct, quantity: 50 }],
      remark: ''
    })
    await purchaseStore.inbound(po.orderId!, { [sampleProduct.id!]: 50 }, 1)

    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    const beforeQty = await productStore.getStock(sampleProduct.id!)
    expect(beforeQty).toBe(50)

    // 导出再导入
    const { useSyncStore } = await import('../src/stores/sync')
    const syncStore = useSyncStore()
    const backup = await syncStore.exportAll()
    await syncStore.importAll(backup)

    const afterQty = await productStore.getStock(sampleProduct.id!)
    expect(afterQty).toBe(50)
  })
})
