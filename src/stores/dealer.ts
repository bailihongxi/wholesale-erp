import { defineStore } from 'pinia'
import { db } from '../db'

export const useDealerStore = defineStore('dealer', () => {
  // 经销商看产品目录：只返回产品名+批发价，不含进价
  interface DealerProductView {
    id: number
    brand: string
    model: string
    category: string
    spec: string
    unit: string
    wholesalePrice: number
  }

  async function listCatalog(keyword: string = ''): Promise<DealerProductView[]> {
    const all = await db.products.where('status').equals('active').toArray()
    const filtered = keyword
      ? all.filter(p =>
          p.brand.toLowerCase().includes(keyword.toLowerCase()) ||
          p.model.toLowerCase().includes(keyword.toLowerCase())
        )
      : all
    // 只暴露经销商可见字段，不含 purchasePrice（进价）
    return filtered.map(p => ({
      id: p.id!,
      brand: p.brand,
      model: p.model,
      category: p.category,
      spec: p.spec,
      unit: p.unit,
      wholesalePrice: p.wholesalePrice
    }))
  }

  // 验证：经销商看不到进价（返回对象中不应有 purchasePrice）
  function hasPurchasePrice(product: DealerProductView): boolean {
    return 'purchasePrice' in product
  }

  return { listCatalog, hasPurchasePrice }
})
