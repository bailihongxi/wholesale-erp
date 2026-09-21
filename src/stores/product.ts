import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '../db'
import { USE_CLOUD } from '../db/supabaseClient'
import { writeLog, AUDIT_ACTIONS } from '../utils/audit'
import type { Product } from '../types'
import { PAGE_SIZE_PRODUCT, PAGE_SIZE_LIST } from '../composables/usePagination'
import { serverPage } from '../db/serverPage'
import { escapeOr } from '../db/cloudDb'

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
   *
   * ⚠️ 云端只取 productId / quantity 两列做窄字段扫描：stock 表有 6281 行，
   * 全字段拉（id/productId/quantity/updatedAt…）要搬几百 KB，而这里只用得到两个字段。
   * 本地（Dexie / 测试）仍然 toArray()，保持原有语义。
   */
  async function stockMap(): Promise<Record<number, number>> {
    const map: Record<number, number> = {}
    if (USE_CLOUD) {
      const rows = (await (db.stock as any)
        .scanNarrow('productId,quantity')) as Array<{ productId: number; quantity: number }>
      for (const s of rows) map[s.productId] = (map[s.productId] ?? 0) + (Number(s.quantity) || 0)
      return map
    }
    const all = await db.stock.toArray()
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

  /**
   * 分类下拉数据源：取去重后的分类列表（窄字段一次拉取）。
   *
   * ⚠️ 必须缓存：取一次分类要**扫整张商品表**（6281 行 = 7 次并行 Range 请求，
   * 新加坡节点下 1~2 秒）。分类是「几个固定值」，几乎不变，而商品档案页每次
   * 进入都要它 —— 不缓存就是白等两次往返。
   *
   * 缓存分三层，目的都是让下拉框永远不用等网络：
   *   1) 内存 catCache  —— 同一次会话内复用（商品档案与「选商品」共用一份）；
   *   2) 并发去重 catPending —— 首屏两个组件同时要分类时只扫一次表；
   *   3) localStorage（仅云端）—— 刷新 / 重开浏览器也能立刻出下拉；超过 CAT_TTL_MS
   *      先返回旧值、再后台静默刷新一轮，既秒开又不会一直陈旧。
   * 失效交给 clearPickerCache()（新增/修改商品、导入/删除/批量改后都会调）。
   */
  const CAT_CACHE_KEY = 'erp.product.categories.v1'
  /** 超过这个时长就后台重新扫一次（先给缓存值，不让用户等） */
  const CAT_TTL_MS = 10 * 60 * 1000
  let catCache: string[] | null = null
  let catPending: Promise<string[]> | null = null
  let catTs = 0

  /** 把上次会话留下的分类读回内存（仅云端；本地/测试保持原来的每次扫表语义） */
  function readCatStore(): void {
    if (catCache || !USE_CLOUD) return
    try {
      const raw = localStorage.getItem(CAT_CACHE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed?.list)) {
        catCache = parsed.list as string[]
        catTs = Number(parsed.ts) || 0
      }
    } catch { /* 存储不可用就退化成每次扫表，不影响功能 */ }
  }

  function writeCatStore(list: string[]): void {
    if (!USE_CLOUD) return
    try { localStorage.setItem(CAT_CACHE_KEY, JSON.stringify({ list, ts: Date.now() })) } catch { /* 无痕模式等忽略 */ }
  }

  /** 真正去扫表：云端走窄字段 distinct，本地 / 测试走 Dexie 全表 */
  async function scanCategories(): Promise<string[]> {
    return USE_CLOUD
      ? await (db.products as any).distinct('category')
      : [...new Set((await db.products.toArray()).map(p => p.category).filter(Boolean))].sort()
  }

  /** 后台静默刷新一轮（过期时用；出错就继续用旧值） */
  async function refreshCategoriesSilently(): Promise<void> {
    try {
      const list = await scanCategories()
      catCache = list
      catTs = Date.now()
      writeCatStore(list)
    } catch { /* 网络出错就保持旧值 */ }
  }

  async function distinctCategories(): Promise<string[]> {
    readCatStore()
    if (catCache) {
      // 过期了也先把缓存值交出去，同时后台补一轮刷新
      if (Date.now() - catTs > CAT_TTL_MS) void refreshCategoriesSilently()
      return catCache
    }
    if (!catPending) {
      catPending = scanCategories()
        .then(list => {
          catCache = list
          catTs = Date.now()
          writeCatStore(list)
          return list
        })
        .finally(() => { catPending = null })
    }
    return catPending
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
    const existing = await db.products.where('brand').equals(data.brand).filter((p: any) => p.model === data.model).first()
    if (existing) return { ok: false, message: '相同品牌+型号的商品已存在' }
    const id = await db.products.add(data)
    clearPickerCache()
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
    clearPickerCache()
    if (operatorId) {
      await writeLog(operatorId, AUDIT_ACTIONS.PRODUCT_UPDATE, `修改商品 #${id}`)
    }
  }

  async function getProduct(id: number): Promise<Product | undefined> {
    return await db.products.get(id)
  }

  /**
   * 商品 id → 名称 映射：下拉、历史列表只想显示商品名时用它。
   * ⚠️ 云端走窄字段扫描（只要 id / brand / model 三列）——
   * 为了显示个名字把 6281 行 × 十几个字段全拉下来太亏。
   */
  async function nameMap(): Promise<Record<number, string>> {
    if (USE_CLOUD) {
      const rows = (await (db.products as any)
        .scanNarrow('id,brand,model')) as Array<{ id: number; brand?: string; model?: string }>
      const m: Record<number, string> = {}
      for (const p of rows) m[p.id] = productName({ brand: p.brand ?? '', model: p.model ?? '' }) || `商品#${p.id}`
      return m
    }
    const all = await db.products.toArray()
    const m: Record<number, string> = {}
    for (const p of all) m[p.id!] = productName(p) || `商品#${p.id}`
    return m
  }

  async function getStock(productId: number): Promise<number> {
    const s = await db.stock.where('productId').equals(productId).first()
    return s?.quantity ?? 0
  }

  /**
   * 低库存商品（经营看板统计、经营报表预警清单都用它）。
   *
   * ⚠️ 云端走**窄字段扫描**：这里只需要 id / 品牌 / 型号 / 分类 / 预警值 5 列，
   * 而 `db.products.toArray()` 会把 6281 行 × 十几个字段全搬下来（7 次 Range 请求、
   * 几百 KB），绝大部分字段根本用不上。库存同样走窄字段的 stockMap()。
   * 本地 / 测试保持原来 `where('status')` 的语义，两者结果一致。
   */
  const LOW_STOCK_FIELDS = 'id,brand,model,category,warnStock,status'
  async function getLowStockProducts(): Promise<Array<{ product: Product; quantity: number }>> {
    // 一次性把库存表读进内存再比对：逐个 getStock 在商品上千时会很慢
    let all: Product[]
    if (USE_CLOUD) {
      const rows = (await (db.products as any)
        .scanNarrow(LOW_STOCK_FIELDS, (q: any) => q.eq('status', 'active'))) as Array<Record<string, any>>
      all = rows as unknown as Product[]
    } else {
      all = await db.products.where('status').equals('active').toArray()
    }
    const smap = await stockMap()
    return all
      .map(p => ({ product: p, quantity: smap[p.id!] ?? 0 }))
      .filter(x => x.quantity <= x.product.warnStock)
  }

  // ==================== 「选商品」服务端取数（V2.0-5）====================
  //
  // 背景：商品已到 6281 条、stock 表同样 6281 行。旧实现（V2.0-4 及以前）是
  // 「进开单页 -> search('') 拉全量商品 + stockMap() 拉全量库存」，一次开单要先搬
  // 12562 行数据到浏览器，还得踩 Supabase 单请求 1000 行的上限（见 db/cloudDb.ts）。
  // 现在改成「按页取」：任何一页都只发 2 个请求、几十行数据。

  /** 商品导入 / 新增 / 改名后调用，让分类下拉重新扫一遍（含 localStorage 里的那份） */
  function clearPickerCache(): void {
    catCache = null
    catTs = 0
    try { if (USE_CLOUD) localStorage.removeItem(CAT_CACHE_KEY) } catch { /* 忽略 */ }
  }

  /** 分类集合（带缓存），供 ProductPicker 的 categories 用 */
  /** 与商品档案页共用同一份分类缓存（见 distinctCategories） */
  async function pickerCategories(): Promise<string[]> {
    return distinctCategories()
  }

  /**
   * 按商品 id 批量取库存（只查这几个商品的行）。
   * 一个商品多库位各一行，这里汇总；不再为了 20 行数据拉整张 stock 表。
   */
  async function stockOf(productIds: number[]): Promise<Record<number, number>> {
    const map: Record<number, number> = {}
    const ids = productIds.filter(n => Number.isFinite(n))
    if (!ids.length) return map
    const rows = (await (db.stock as any).where('productId').anyOf(ids).toArray()) as Array<{ productId: number; quantity: number }>
    for (const s of rows) map[s.productId] = (map[s.productId] ?? 0) + (Number(s.quantity) || 0)
    return map
  }

  /**
   * 有货商品 id 集合（quantity > 0）。
   * 云端只把 productId 一列并行翻页扫下来（窄字段，比 toArray 全字段省一个数量级），
   * 供「只看有货」下推成 in 过滤；本地直接读 stock 表。
   */
  async function inStockProductIds(): Promise<number[]> {
    if (USE_CLOUD) {
      const rows = (await (db.stock as any)
        .scanNarrow('productId,quantity', (q: any) => q.gt('quantity', 0))) as Array<{ productId: number }>
      return [...new Set(rows.map(r => Number(r.productId)))]
    }
    const all = await db.stock.toArray()
    return [...new Set(all.filter(s => (Number(s.quantity) || 0) > 0).map(s => s.productId))]
  }

  /**
   * 关键词 -> 查询条件（云端 orExpr / 本地 extraFilter，两种模式语义完全一致）。
   * 规则：按空格切成多个词，**词内 AND、字段间 OR**——
   * 所以「海尔 H9」能同时命中品牌与型号，比原来只按整串匹配更符合直觉。
   */
  function keywordCond(kw: string): { orExpr?: string; extraFilter?: (r: any) => boolean } {
    const fields = ['brand', 'model', 'category', 'spec']
    const tokens = kw.trim().split(/\s+/).filter(Boolean)
    if (!tokens.length) return {}
    const groups = tokens.map(
      t => `or(${fields.map(f => `${f}.ilike.*${escapeOr(t)}*`).join(',')})`
    )
    const orExpr = groups.length === 1 ? groups[0].slice(3, -1) : `and(${groups.join(',')})`
    const lc = tokens.map(t => t.toLowerCase())
    const extraFilter = (r: any): boolean =>
      lc.every(t => fields.some(f => String(r[f] ?? '').toLowerCase().includes(t)))
    return { orExpr, extraFilter }
  }

  /**
   * 「选商品」弹窗的服务端分页取数：当前页商品 + 这页商品的库存 + 过滤后总数。
   * 关键词 / 分类 / 只看有货全部下推到服务端，前端内存里永远只有一页。
   */
  async function pickerPage(opts: {
    page?: number
    pageSize?: number
    keyword?: string
    category?: string
    onlyInStock?: boolean
    /** 是否只要在售商品（默认 true；调拨/盘点场景可放开） */
    activeOnly?: boolean
  } = {}): Promise<{ rows: Array<{ product: Product; stock: number }>; total: number }> {
    const page = Math.max(1, opts.page ?? 1)
    const pageSize = opts.pageSize ?? PAGE_SIZE_LIST
    const activeOnly = opts.activeOnly !== false

    // 「只看有货」：先把有货商品 id 集合拿到，下推成 id in (...)
    let ids: number[] | undefined
    if (opts.onlyInStock) {
      ids = await inStockProductIds()
      if (!ids.length) return { rows: [], total: 0 }
    }

    const cond = keywordCond(opts.keyword ?? '')
    const res = await serverPage<Product>(db.products, {
      page,
      pageSize,
      eq: {
        ...(activeOnly ? { status: 'active' } : {}),
        ...(opts.category ? { category: opts.category } : {}),
      },
      // 固定按 id 升序：翻页必须有稳定顺序，否则每页可能重复或漏项
      orderBy: 'id',
      ascending: true,
      orExpr: cond.orExpr,
      extraFilter: cond.extraFilter,
      inFilter: ids ? { id: ids } : undefined,
    })

    const stock = await stockOf(res.rows.map(p => Number(p.id)))
    return {
      rows: res.rows.map(p => ({ product: p, stock: stock[Number(p.id)] ?? 0 })),
      total: res.total,
    }
  }

  return {
    products, productName, loadAll, search, createProduct, listAll, listPage, distinctCategories, stockMap,
    updateProduct, getProduct, nameMap, getStock, getLowStockProducts,
    pickerPage, pickerCategories, stockOf, inStockProductIds, clearPickerCache
  }
})
