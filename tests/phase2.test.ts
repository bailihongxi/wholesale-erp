import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'

describe('阶段2：商品档案 + 库存基础', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    const { db } = await import('../src/db')
    await db.delete()
    await db.open()
  })

  it('创建商品后名称=品牌+型号自动组合', async () => {
    const { useProductStore } = await import('../src/stores/product')
    const store = useProductStore()
    const res = await store.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调',
      spec: '1.5匹', unit: '台',
      purchasePrice: 1800, wholesalePrice: 2100, retailPrice: 2300,
      warnStock: 50, status: 'active', remark: '', extra: {}
    })
    expect(res.ok).toBe(true)
    const products = await store.search('')
    expect(products.length).toBe(1)
    expect(store.productName(products[0])).toBe('格力 KFR-35GW')
  })

  it('相同品牌+型号重复创建失败', async () => {
    const { useProductStore } = await import('../src/stores/product')
    const store = useProductStore()
    await store.createProduct({
      brand: '海尔', model: 'BCD-500', category: '冰箱',
      spec: '', unit: '台', purchasePrice: 1600, wholesalePrice: 1900, retailPrice: 2100,
      warnStock: 30, status: 'active', remark: '', extra: {}
    })
    const res = await store.createProduct({
      brand: '海尔', model: 'BCD-500', category: '冰箱',
      spec: '', unit: '台', purchasePrice: 1600, wholesalePrice: 1900, retailPrice: 2100,
      warnStock: 30, status: 'active', remark: '', extra: {}
    })
    expect(res.ok).toBe(false)
  })

  it('品牌或型号为空时创建失败', async () => {
    const { useProductStore } = await import('../src/stores/product')
    const store = useProductStore()
    const res = await store.createProduct({
      brand: '', model: '', category: '', spec: '', unit: '',
      purchasePrice: 0, wholesalePrice: 0, retailPrice: 0,
      warnStock: 0, status: 'active', remark: '', extra: {}
    })
    expect(res.ok).toBe(false)
  })

  it('新商品初始库存为 0', async () => {
    const { useProductStore } = await import('../src/stores/product')
    const store = useProductStore()
    await store.createProduct({
      brand: '美的', model: 'XQB80', category: '洗衣机',
      spec: '', unit: '台', purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400,
      warnStock: 20, status: 'active', remark: '', extra: {}
    })
    const products = await store.search('')
    const qty = await store.getStock(products[0].id!)
    expect(qty).toBe(0)
  })

  it('按品牌搜索商品', async () => {
    const { useProductStore } = await import('../src/stores/product')
    const store = useProductStore()
    await store.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调',
      spec: '', unit: '台', purchasePrice: 1800, wholesalePrice: 2100, retailPrice: 2300,
      warnStock: 50, status: 'active', remark: '', extra: {}
    })
    await store.createProduct({
      brand: '海尔', model: 'BCD-500', category: '冰箱',
      spec: '', unit: '台', purchasePrice: 1600, wholesalePrice: 1900, retailPrice: 2100,
      warnStock: 30, status: 'active', remark: '', extra: {}
    })
    const results = await store.search('格力')
    expect(results.length).toBe(1)
    expect(results[0].model).toBe('KFR-35GW')
  })

  it('库存低于预警值时标记预警', async () => {
    const { useProductStore } = await import('../src/stores/product')
    const store = useProductStore()
    await store.createProduct({
      brand: '西门子', model: 'WM10', category: '洗衣机',
      spec: '', unit: '台', purchasePrice: 2000, wholesalePrice: 2400, retailPrice: 2600,
      warnStock: 10, status: 'active', remark: '', extra: {}
    })
    // 库存初始为 0，预警值 10，应触发预警
    const low = await store.getLowStockProducts()
    expect(low.length).toBe(1)
    expect(low[0].quantity).toBe(0)
  })

  it('金额大写转换正确', async () => {
    const { toChineseUpper } = await import('../src/utils/orderNo')
    expect(toChineseUpper(26000)).toContain('贰万陆仟')
    expect(toChineseUpper(0)).toBe('零元整')
  })
})
