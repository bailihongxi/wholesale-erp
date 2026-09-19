/**
 * 商品档案的导入 / 导出 / 去重 / 合并。
 *
 * 设计要点：
 *  - 走 CSV（UTF-8 带 BOM），Excel 与 WPS 都能直接打开，不引入任何第三方依赖。
 *  - 「商品是否重复」以 **品牌 + 型号** 为准，忽略大小写与内部空格。
 *  - 导入时对三类重复分别处理：文件内重复、与库里重复、本职缺字段的行。
 *  - 合并商品时要把库存累加，并把历史单据明细改指向保留下来的那条，避免单据变孤儿。
 */
import { db } from '../db'
import type { Product } from '../types'

/** 导出模板 / 导入识别的表头（顺序即模板顺序） */
export const PRODUCT_CSV_HEADER = [
  '品牌', '型号', '分类', '规格', '单位',
  '进价', '批发价', '零售价', '库存预警', '状态', '备注', '当前库存'
] as const

/** 去掉空白与大小写差异后的商品唯一键 */
export function productKey(brand: string, model: string): string {
  return `${brand}|${model}`.replace(/\s+/g, '').toLowerCase()
}

export function productKeyOf(p: Pick<Product, 'brand' | 'model'>): string {
  return productKey(p.brand ?? '', p.model ?? '')
}

// ---------------------------------------------------------------- CSV 基础

function toNum(v: unknown): number {
  const n = Number(String(v ?? '').replace(/[¥,,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** CSV 单元格转义：含逗号 / 引号 / 换行时用双引号包裹，内部引号写成两个 */
function cell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * 通用 CSV 解析：支持引号包裹、双引号转义、CRLF / LF。
 * 返回「表头 → 值」的对象数组。
 */
export function parseCSV(text: string): Array<Record<string, string>> {
  const raw = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuote = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (inQuote) {
      if (ch === '"') {
        if (raw[i + 1] === '"') { field += '"'; i++ } else { inQuote = false }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') { inQuote = true; continue }
    if (ch === ',' || ch === '，') { row.push(field); field = ''; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    if (ch === '\r') { continue }
    field += ch
  }
  row.push(field)
  rows.push(row)

  const nonEmpty = rows.filter(r => r.some(c => c.trim() !== ''))
  if (!nonEmpty.length) return []

  const headers = nonEmpty[0].map(h => h.trim())
  return nonEmpty.slice(1).map(cols => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = (cols[i] ?? '').trim() })
    return obj
  })
}

// ---------------------------------------------------------------- 导出

export interface ProductExportRow {
  brand: string
  model: string
  category: string
  spec: string
  unit: string
  purchasePrice: number
  wholesalePrice: number
  retailPrice: number
  warnStock: number
  status: string
  remark: string
  stock: number
}

/** 把商品（含当前库存）拼成可直接下载的 CSV 文本 */
export function buildProductCSV(rows: ProductExportRow[]): string {
  const lines = [PRODUCT_CSV_HEADER.join(',')]
  for (const r of rows) {
    lines.push([
      cell(r.brand), cell(r.model), cell(r.category), cell(r.spec), cell(r.unit),
      cell(r.purchasePrice), cell(r.wholesalePrice), cell(r.retailPrice), cell(r.warnStock),
      cell(r.status === 'active' ? '在售' : '停售'), cell(r.remark), cell(r.stock)
    ].join(','))
  }
  return '\uFEFF' + lines.join('\r\n')
}

/** 生成不含数据的模板，只留表头和一行示例 */
export function buildProductTemplate(): string {
  return buildProductCSV([{
    brand: '格力', model: 'KFR-35GW', category: '空调', spec: '1.5匹 变频', unit: '台',
    purchasePrice: 1800, wholesalePrice: 2070, retailPrice: 2340,
    warnStock: 5, status: 'active', remark: '示例行，导入前请删除', stock: 0
  }])
}

/** 触发浏览器下载（纯前端，无需服务器） */
export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------- 导入

export type DuplicateMode = 'skip' | 'overwrite'

export interface ImportReport {
  created: number
  updated: number
  skipped: number
  /** 行号（从 CSV 第 2 行算起）与失败原因 */
  errors: Array<{ line: number; reason: string }>
  /** 被判为「库里已有」而跳过的重复行明细 */
  duplicated: Array<{ line: number; name: string }>
}

/** 把 CSV 文本转成商品字段，顺手做字段清洗与必填校验 */
export function csvToProducts(text: string): {
  rows: Array<Omit<Product, 'id'>>
  lineErrors: Array<{ line: number; reason: string }>
} {
  const objs = parseCSV(text)
  const rows: Array<Omit<Product, 'id'>> = []
  const lineErrors: Array<{ line: number; reason: string }> = []

  objs.forEach((o, i) => {
    const line = i + 2 // CSV 第 1 行是表头
    const pick = (...names: string[]): string => {
      for (const n of names) if (o[n] !== undefined) return o[n]
      return ''
    }
    const brand = pick('品牌', 'brand').trim()
    const model = pick('型号', 'model').trim()
    if (!brand || !model) {
      lineErrors.push({ line, reason: '品牌或型号为空' })
      return
    }
    const statusRaw = pick('状态', 'status').trim()
    rows.push({
      brand,
      model,
      category: pick('分类', 'category').trim(),
      spec: pick('规格', 'spec').trim(),
      unit: pick('单位', 'unit').trim() || '台',
      purchasePrice: toNum(pick('进价', '成本价', '采购价', 'purchasePrice')),
      wholesalePrice: toNum(pick('批发价', 'wholesalePrice')),
      retailPrice: toNum(pick('零售价', 'retailPrice')),
      warnStock: toNum(pick('库存预警', '预警库存', 'warnStock')),
      status: statusRaw === '停售' || statusRaw === 'inactive' ? 'inactive' : 'active',
      remark: pick('备注', 'remark').trim(),
      extra: {}
    })
  })

  return { rows, lineErrors }
}

/**
 * 执行导入。
 * @param rows 待导入商品
 * @param mode 命中库里同名商品时：skip=跳过保留旧数据，overwrite=用新数据覆盖
 * @param allowInactive 是否连「停售」商品也一起比对重复（默认只比对在售，停售的历史档案可同名）
 */
export async function importProducts(
  rows: Array<Omit<Product, 'id'>>,
  mode: DuplicateMode = 'skip',
  allowInactive = false
): Promise<ImportReport> {
  const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: [], duplicated: [] }

  const existing = allowInactive
    ? await db.products.toArray()
    : await db.products.where('status').equals('active').toArray()
  const byKey = new Map<number, string>()
  for (const p of existing) byKey.set(p.id!, productKeyOf(p))

  const seenInFile = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const key = productKeyOf(row)
    const line = i + 2

    // 1) 同一份文件内部重复：后面的直接跳过，避免一次导入造出两条一样的数据
    if (seenInFile.has(key)) {
      report.skipped++
      report.duplicated.push({ line, name: `${row.brand} ${row.model}（文件内重复）` })
      continue
    }
    seenInFile.add(key)

    // 2) 与库里已有商品重名
    const hit = [...byKey.entries()].find(([, k]) => k === key)
    if (hit) {
      const id = hit[0]
      if (mode === 'overwrite') {
        await db.products.update(id, { ...row, id: undefined } as Partial<Product>)
        report.updated++
      } else {
        report.skipped++
        report.duplicated.push({ line, name: `${row.brand} ${row.model}（已存在）` })
      }
      continue
    }

    // 3) 全新商品
    const id = await db.products.add(row)
    byKey.set(id as number, key)
    const hasStock = await db.stock.where('productId').equals(id as number).count()
    if (!hasStock) {
      await db.stock.add({ productId: id as number, quantity: 0, updatedAt: new Date().toISOString() })
    }
    report.created++
  }

  return report
}

// ---------------------------------------------------------------- 重复检测 / 合并

export interface DuplicateGroup {
  key: string
  name: string
  items: Array<Product & { stock: number }>
}

/** 扫描全库，找出所有「名称重复」的商品分组；只返回确实重复的（≥2 条） */
export async function findDuplicateProducts(): Promise<DuplicateGroup[]> {
  const all = await db.products.toArray()
  const map = new Map<string, DuplicateGroup>()
  for (const p of all) {
    const key = productKeyOf(p)
    const stock = (await db.stock.where('productId').equals(p.id!).first())?.quantity ?? 0
    const g = map.get(key)
    if (g) g.items.push({ ...p, stock })
    else map.set(key, { key, name: `${p.brand} ${p.model}`.trim(), items: [{ ...p, stock }] })
  }
  return [...map.values()].filter(g => g.items.length > 1)
}

/**
 * 合并：保留 keepId 那条，其余重复的删除。
 * 处理三件事，缺一不可：
 *  1. 重复商品的库存累加到保留商品
 *  2. 采购 / 销售明细、出入库流水里的 productId 改指向保留商品（同明细若同一产品出现两次会合并数量留给后续处理）
 *  3. 删除多余的商品行与其库存行
 */
export async function mergeProducts(keepId: number, mergeIds: number[]): Promise<{ ok: boolean; message: string; movedItems: number }> {
  if (!keepId) return { ok: false, message: '未指定保留的商品', movedItems: 0 }
  const dupIds = mergeIds.filter(id => id !== keepId)
  if (!dupIds.length) return { ok: false, message: '没有需要合并的商品', movedItems: 0 }

  let movedItems = 0
  await db.transaction('rw', db.products, db.stock, db.purchaseOrderItems, db.saleOrderItems, db.stockRecords, async () => {
    // 1) 库存累加
    const keepStock = await db.stock.where('productId').equals(keepId).first()
    let extraQty = 0
    for (const id of dupIds) {
      const s = await db.stock.where('productId').equals(id).first()
      if (s) {
        extraQty += s.quantity
        await db.stock.delete(s.id!)
      }
    }
    if (keepStock) {
      await db.stock.update(keepStock.id!, {
        quantity: keepStock.quantity + extraQty,
        updatedAt: new Date().toISOString()
      })
    } else {
      await db.stock.add({ productId: keepId, quantity: extraQty, updatedAt: new Date().toISOString() })
    }

    // 2) 单据明细改指向
    for (const id of dupIds) {
      const poi = await db.purchaseOrderItems.where('productId').equals(id).toArray()
      for (const it of poi) { await db.purchaseOrderItems.update(it.id!, { productId: keepId }); movedItems++ }
      const soi = await db.saleOrderItems.where('productId').equals(id).toArray()
      for (const it of soi) { await db.saleOrderItems.update(it.id!, { productId: keepId }); movedItems++ }
      const sr = await db.stockRecords.where('productId').equals(id).toArray()
      for (const r of sr) { await db.stockRecords.update(r.id!, { productId: keepId }) }
    }

    // 3) 删除重复商品
    await db.products.bulkDelete(dupIds)
  })

  return { ok: true, message: `已合并 ${dupIds.length} 条重复商品`, movedItems }
}

/** 批量删除商品（连同库存行），已被单据引用的商品会被跳过并记录条数 */
export async function deleteProducts(ids: number[]): Promise<{ deleted: number; blocked: number }> {
  let deleted = 0
  let blocked = 0
  for (const id of ids) {
    const poi = await db.purchaseOrderItems.where('productId').equals(id).count()
    const soi = await db.saleOrderItems.where('productId').equals(id).count()
    const sr = await db.stockRecords.where('productId').equals(id).count()
    if (poi || soi || sr) { blocked++; continue }
    const s = await db.stock.where('productId').equals(id).first()
    if (s) await db.stock.delete(s.id!)
    await db.products.delete(id)
    deleted++
  }
  return { deleted, blocked }
}

/** 批量修改：把所有目标商品统一套用同一份字段改动 */
export async function bulkUpdateProducts(
  ids: number[],
  patch: Partial<Product>
): Promise<number> {
  if (!ids.length) return 0
  const clean = { ...patch }
  delete clean.id
  await db.products.bulkGet(ids).then(async list => {
    for (const p of list) {
      if (p?.id) await db.products.update(p.id, clean)
    }
  })
  return ids.length
}
