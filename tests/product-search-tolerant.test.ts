import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import 'fake-indexeddb/auto'
import { useProductStore } from '../src/stores/product'
import { useUserStore } from '../src/stores/user'
import { db } from '../src/db'
import type { Product } from '../src/types'

/**
 * 商品搜索「符号容错」回归测试（方案 N：纯算法归一 + 子序列，不改档案数据）。
 * 验证：输入与档案里符号差一点（空格 / 横杠 / 括号 / 斜杠 / 中文夹杂）也能命中，
 * 且现有「精确字面搜索」行为零回归。
 */
describe('商品搜索符号容错（keywordCond 归一子序列）', () => {
  let productStore: ReturnType<typeof useProductStore>

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    productStore = useProductStore()
    // 审计日志依赖当前用户，先行置位
    useUserStore().currentUser = {
      id: 1, name: 'tester', phone: '1', password: '',
      role: 'boss', status: 'active', createdAt: ''
    }
  })

  async function seed(over: Partial<Product>): Promise<Product> {
    await productStore.createProduct({
      brand: '海尔', model: 'KFR-72LW/E2-1Pro 舒适风Pro', category: '空调', spec: '',
      unit: '台', purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400,
      warnStock: 5, status: 'active', remark: '', extra: {}, ...over
    })
    const list = await productStore.search('')
    return list[list.length - 1]
  }

  const TARGET_MODEL = 'KFR-72LW/E2-1Pro 舒适风Pro'

  it('① 搜「72LW/E2-1Pro舒适」(无空格/少符号) 能命中含空格的档案 KFR-72LW/E2-1Pro 舒适风Pro', async () => {
    await seed({ brand: '海尔', model: TARGET_MODEL })            // 目标
    await seed({ brand: '美的', model: 'KFR-72LW/X1-1 风酷' })      // 同含 72LW 的干扰项
    const { rows } = await productStore.listPage({ keyword: '72LW/E2-1Pro舒适' })
    expect(rows.some(p => p.model === TARGET_MODEL)).toBe(true)
    expect(rows.some(p => p.model === 'KFR-72LW/X1-1 风酷')).toBe(false)
  })

  it('② 搜「35GW/E1-1 Plus」(有空格) 能命中档案 35GW/E1-1Plus（符号在档案侧缺失，双向覆盖）', async () => {
    await seed({ brand: '格力', model: 'KFR-35GW/E1-1Plus' })
    const { rows } = await productStore.listPage({ keyword: '35GW/E1-1 Plus' })
    expect(rows.some(p => p.model === 'KFR-35GW/E1-1Plus')).toBe(true)
  })

  it('③ 反向：搜「35GW/E1-1Plus」(无空格) 也能命中档案 35GW/E1-1 Plus（符号在输入侧缺失）', async () => {
    await seed({ brand: '格力', model: 'KFR-35GW/E1-1 Plus' })
    const { rows } = await productStore.listPage({ keyword: '35GW/E1-1Plus' })
    expect(rows.some(p => p.model === 'KFR-35GW/E1-1 Plus')).toBe(true)
  })

  it('④ 零回归：精确字面搜索仍然生效', async () => {
    await seed({ brand: '海尔', model: TARGET_MODEL })
    const { rows } = await productStore.listPage({ keyword: 'KFR-72LW/E2-1Pro 舒适风Pro' })
    expect(rows.some(p => p.model === TARGET_MODEL)).toBe(true)
  })

  it('⑤ 括号变体也能命中：搜「(35GW/E1-1)Plus」命中 35GW/E1-1 Plus', async () => {
    await seed({ brand: '格力', model: 'KFR-35GW/E1-1 Plus' })
    const { rows } = await productStore.listPage({ keyword: '(35GW/E1-1)Plus' })
    expect(rows.some(p => p.model === 'KFR-35GW/E1-1 Plus')).toBe(true)
  })

  it('⑥ 完全不相关的关键词不应误命中', async () => {
    await seed({ brand: '海尔', model: TARGET_MODEL })
    await seed({ brand: '美的', model: 'KFR-72LW/X1-1 风酷' })
    const { rows } = await productStore.listPage({ keyword: '格力ABC999' })
    expect(rows.length).toBe(0)
  })
})
