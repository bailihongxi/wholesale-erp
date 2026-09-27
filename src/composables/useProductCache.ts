/**
 * 全局商品基础信息缓存（V2.1-2.9）
 * 
 * 全系统共享：商品id → 品牌、型号、单位、分类
 * 只拉一次，所有页面共用，不用每个详情页都拉一遍商品表
 */

import { ref } from 'vue'
import { db } from '../db'

interface ProductBasic {
  id: number
  brand?: string
  model?: string
  unit?: string
  category?: string
}

const cache = ref<Record<number, ProductBasic>>({})
const loaded = ref(false)

/**
 * 只取这 5 列。原来这里用 `products.toArray()` 全字段拉取 ——
 * 6286 行全字段实测约 **1.4 MB**，窄字段只有约 **0.37 MB**（-74%），
 * 弱网下就是「明细页要等好几秒、商品名先显示『商品#123』」的直接原因。
 * 本组件只需要这 5 列，语义完全不变。
 */
const NARROW_FIELDS = 'id,brand,model,unit,category'

/** 正在进行的加载（并发调用共用同一次请求，不会重复拉） */
let inflight: Promise<void> | null = null

/**
 * 加载全量商品基础信息（只拉一次，并发调用共用）
 */
function loadAll(): Promise<void> {
  if (loaded.value) return Promise.resolve()
  if (inflight) return inflight
  inflight = (async () => {
    try {
      // 云端：走窄字段扫描（CloudTable.scanNarrow）。
      // 本地 / 测试（USE_CLOUD=false，Dexie 表没有这个方法）回落到 toArray()。
      const table = db.products as any
      const all: Array<Partial<ProductBasic>> = typeof table.scanNarrow === 'function'
        ? await table.scanNarrow(NARROW_FIELDS)
        : await table.toArray()
      const products = all.map(p => ({
        id: p.id!,
        brand: p.brand,
        model: p.model,
        unit: p.unit,
        category: p.category
      }))
      const m: Record<number, ProductBasic> = {}
      for (const p of products) {
        m[p.id] = p as ProductBasic
      }
      cache.value = m
      loaded.value = true
    } catch (e) {
      console.error('加载商品缓存失败:', e)
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * 等到缓存就绪（幂等，可并发）。
 *
 * 详情页要显示商品名，必须**等**它 —— 原来只是「触发了就不管」，
 * 于是首屏会先渲染成「商品#123」，等整表拉完才闪回真名。
 * 与详情页其它查询一起放进 Promise.all，商品名就不会迟到，也不额外占用时间。
 */
async function ensure(): Promise<void> {
  await loadAll()
}

/**
 * 根据商品id获取商品名称（品牌+型号）
 */
function productName(id: number): string {
  const p = cache.value[id]
  if (!p) return `商品#${id}`
  // 口径必须与 productStore.productName 一致：「品牌 型号」，中间一个空格。
  // 曾经写成 `${brand}${model}` 直接拼接 —— 全站商品名显示成「海尔XQB100」，
  // 跟商品档案、单据打印里的「海尔 XQB100」对不上，看着像两个商品。
  return [p.brand, p.model].filter(Boolean).join(' ').trim() || `商品#${id}`
}

/**
 * 根据商品id获取单位
 */
function productUnit(id: number): string {
  return cache.value[id]?.unit || ''
}

/**
 * 手动刷新缓存（商品改了之后调用）
 */
async function refresh(): Promise<void> {
  loaded.value = false
  inflight = null
  await loadAll()
}

/**
 * 标记缓存已过期：下次 ensure() / loadAll() 会重拉一次。
 *
 * 商品新增 / 改品牌型号后**必须**调用 —— 否则全局缓存里根本没有这条新商品，
 * 采购单、销售单、出入库明细页会一直显示「商品#6287」，只有手动刷新整个页面才恢复。
 *
 * 这里只置标志、**不清空旧值**：新值拉回来之前仍用旧名顶着，界面不会闪回「商品#id」；
 * 也不立刻发请求，批量导入 6000 行时不会因为每写一行就重拉一次整表（那是灾难）。
 */
export function markDirty(): void {
  loaded.value = false
}

export function useProductCache() {
  // 首次调用自动加载（不阻塞；要「等到名字到位」的页面自己调 ensure()）
  void loadAll()
  return {
    cache,
    loaded,
    loadAll,
    ensure,
    refresh,
    markDirty,
    productName,
    productUnit
  }
}
