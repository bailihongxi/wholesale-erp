import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '../db'
import { USE_CLOUD } from '../db/supabaseClient'
import { writeLog, AUDIT_ACTIONS } from '../utils/audit'
import type { Product } from '../types'
import { PAGE_SIZE_PRODUCT } from '../composables/usePagination'

export const useProductStore = defineStore('product', () => {
  const products = ref<Product[]>([])

  function productName(p: Pick<Product, 'brand' | 'model'>): string {
    return `${p.brand} ${p.model}`.trim()
  }

  async function loadAll(): Promise<void> {
    products.value = await db.products.where('status').equals('active').toArray()
  }

  /**
   * 一次性取出全部商品的库存，避免在列表里逐条查询（商品多时非常慢）。
   * 一个商品在多个库位（总仓/门店…）各有一行，这里**汇总**成总库存——
   * 旧实现直接覆盖只保留最后一个库位，多库位时库存数是错的。
   */
  async function stockMap(): Promise<Record<number, number>> {
    const all = await db.stock.toArray()
    const map: Record<number, number> = {}
    for (const s of all) map[s.productId] = (map[s.productId] ?? 0) + s.quantity
    return map
  }

  /** 含停售在内的全量商品，给商品档案、重复检测、导入去重使用 */
  async function listAll(includeInactive = false): Promise<Product[]> {
    const all = await db.products.toArray()
    return includeInactive ? all : all.filter(p => p.status !== 'inactive')
  }

  /**
   * 服务端分页查询（商品档案等大表首屏专用）：只拉当前页 + 总数，
   * 支持状态/分类等值过滤与品牌/型号/分类/规格模糊搜索。无论数据多大首屏都只拉几十行。
   */
  async function listPage(opts: {
    page?: number
    pageSize?: number
    status?: string
    category?: string
    keyword?: string
  }): Promise<{ rows: Product[]; total: number }> {
    const page = opts.page ?? 1
    const pageSize = opts.pageSize ?? PAGE_SIZE_PRODUCT
    if (USE_CLOUD) {
      return (db.products as any).queryPage({
        page, pageSize,
        eq: {
          ...(opts.status ? { status: opts.status } : {}),
          ...(opts.category ? { category: opts.category } : {}),
        },
        search: opts.keyword ? { fields: ['brand', 'model', 'category', 'spec'], keyword: opts.keyword } : undefined,
      })
    }
    // 本地（测试 / 离线）模式：整表读进内存后过滤 + 切片，行为与服务端分页一致
    let all = await db.products.toArray()
    if (opts.status) all = all.filter(p => p.status === opts.status)
    if (opts.category) all = all.filter(p => p.category === opts.category)
    if (opts.keyword) {
      const kw = opts.keyword.trim().toLowerCase()
      all = all.filter(p =>
        p.brand.toLowerCase().includes(kw) ||
        p.model.toLowerCase().includes(kw) ||
        (p.category ?? '').toLowerCase().includes(kw) ||
        (p.spec ?? '').toLowerCase().includes(kw) ||
        `${p.brand} ${p.model}`.toLowerCase().includes(kw)
      )
    }
    const start = (page - 1) * pageSize
    return { rows: all.slice(start, start + pageSize), total: all.length }
  }

  /** 分类下拉数据源：取去重后的分类列表（窄字段一次拉取） */
  async function distinctCategories(): Promise<string[]> {
    if (USE_CLOUD) return (db.products as any).distinct('category')
    const all = await db.products.toArray()
    return [...new Set(all.map(p => p.category).filter(Boolean))].sort()
  }

  async function search(keyword: string): Promise<Product[]> {
    if (!keyword) return await db.products.where('status').equals('active').toArray()
    const all = await db.products.where('status').equals('active').toArray()
    const kw = keyword.toLowerCase()
    return all.filter(p =>
      p.brand.toLowerCase().includes(kw) ||
      p.model.toLowerCase().includes(kw) ||
      productName(p).toLowerCase().includes(kw) ||
      p.category.toLowerCase().includes(kw)
    )
  }

  // operatorId 可选：传入时会记录操作日志
  async function createProduct(data: Omit<Product, 'id'>, operatorId?: number): Promise<{ ok: boolean; message: string }> {
    if (!data.brand || !data.model) return { ok: false, message: '品牌和型号不能为空' }
    const existing = await db.products.where('brand').equals(data.brand).and(p => p.model === data.model).first()
    if (existing) return { ok: false, message: '相同品牌+型号的商品已存在' }
    const id = await db.products.add(data)
    // 初始化库存为 0
    await db.stock.add({ productId: id as number, quantity: 0, updatedAt: new Date().toISOString() })
    if (operatorId) {
      await writeLog(operatorId, AUDIT_ACTIONS.PRODUCT_CREATE, `新增商品 ${data.brand} ${data.model}`)
    }
    return { ok: true, message: '创建成功' }
  }

  // operatorId 可选：传入时会记录操作日志
  async function updateProduct(id: number, data: Partial<Product>, operatorId?: number): Promise<void> {
    await db.products.update(id, data)
    if (operatorId) {
      await writeLog(operatorId, AUDIT_ACTIONS.PRODUCT_UPDATE, `修改商品 #${id}`)
    }
  }

  async function getProduct(id: number): Promise<Product | undefined> {
    return await db.products.get(id)
  }

  async function getStock(productId: number): Promise<number> {
    const s = await db.stock.where('productId').equals(productId).first()
    return s?.quantity ?? 0
  }

  async function getLowStockProducts(): Promise<Array<{ product: Product; quantity: number }>> {
    // 一次性把库存表读进内存再比对：逐个 getStock 在商品上千时会很慢
    const [all, smap] = await Promise.all([
      db.products.where('status').equals('active').toArray(),
      stockMap()
    ])
    return all
      .map(p => ({ product: p, quantity: smap[p.id!] ?? 0 }))
      .filter(x => x.quantity <= x.product.warnStock)
  }

  return {
    products, productName, loadAll, search, createProduct, listAll, listPage, distinctCategories, stockMap,
    updateProduct, getProduct, getStock, getLowStockProducts
  }
})
