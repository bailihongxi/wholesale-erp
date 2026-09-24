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
const loading = ref(false)

/**
 * 加载全量商品基础信息（只拉一次）
 */
async function loadAll(): Promise<void> {
  if (loaded.value || loading.value) return
  loading.value = true
  try {
    // 云端和本地都用toArray()，cloudDb已经做了兼容
    const all = await db.products.toArray()
    const products = all.map(p => ({
      id: p.id!,
      brand: p.brand,
      model: p.model,
      unit: p.unit,
      category: p.category
    }))
    const m: Record<number, ProductBasic> = {}
    for (const p of products) {
      m[p.id] = p
    }
    cache.value = m
    loaded.value = true
  } catch (e) {
    console.error('加载商品缓存失败:', e)
  } finally {
    loading.value = false
  }
}

/**
 * 根据商品id获取商品名称（品牌+型号）
 */
function productName(id: number): string {
  const p = cache.value[id]
  if (!p) return `商品#${id}`
  return `${p.brand || ''}${p.model || ''}`.trim() || `商品#${id}`
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
  await loadAll()
}

export function useProductCache() {
  // 首次调用自动加载
  loadAll()
  return {
    cache,
    loaded,
    loadAll,
    refresh,
    productName,
    productUnit
  }
}
