import type { LedgerDirection } from '../types'

/**
 * 「记一笔」的费用分类。
 * 这些收支无法用采购单 / 销售单结算（没有商品、不走库存），
 * 只能单独记一笔，用于算清真实经营利润。
 */
export interface LedgerCategory {
  key: string
  label: string
  direction: LedgerDirection
  /** 分类图标，列表与选择器里展示 */
  icon: string
}

export const LEDGER_CATEGORIES: LedgerCategory[] = [
  // ===== 支出 =====
  { key: 'delivery', label: '送货费用', direction: 'out', icon: '🚚' },
  { key: 'logistics', label: '物流费用', direction: 'out', icon: '📦' },
  { key: 'express', label: '快递费用', direction: 'out', icon: '✉️' },
  { key: 'install', label: '安装费用', direction: 'out', icon: '🔧' },
  { key: 'material', label: '辅材费用', direction: 'out', icon: '🧰' },
  { key: 'repair', label: '维修费用', direction: 'out', icon: '🛠️' },
  { key: 'salary', label: '工资薪酬', direction: 'out', icon: '👷' },
  { key: 'rent', label: '房租水电', direction: 'out', icon: '🏠' },
  { key: 'office', label: '办公用品', direction: 'out', icon: '🖊️' },
  { key: 'entertain', label: '招待差旅', direction: 'out', icon: '🍽️' },
  { key: 'other_out', label: '其他费用', direction: 'out', icon: '➖' },
  // ===== 收入 =====
  { key: 'service', label: '服务收入', direction: 'in', icon: '🛎️' },
  { key: 'rebate', label: '返利收入', direction: 'in', icon: '🎁' },
  { key: 'interest', label: '利息收入', direction: 'in', icon: '🏦' },
  { key: 'deposit', label: '押金退回', direction: 'in', icon: '🔙' },
  { key: 'other_in', label: '其他收入', direction: 'in', icon: '➕' }
]

export function categoriesOf(direction: LedgerDirection): LedgerCategory[] {
  return LEDGER_CATEGORIES.filter(c => c.direction === direction)
}

export function categoryLabel(key: string): string {
  return LEDGER_CATEGORIES.find(c => c.key === key)?.label ?? key
}

export function categoryIcon(key: string): string {
  return LEDGER_CATEGORIES.find(c => c.key === key)?.icon ?? '💰'
}

export function directionLabel(d: LedgerDirection): string {
  return d === 'in' ? '收入' : '支出'
}

/** 生成记一笔单号：JY + 日期 + 3 位随机 */
export function genLedgerNo(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const rand = String(Math.floor(Math.random() * 900) + 100)
  return `JY${y}${m}${d}-${rand}`
}

/** 今天的 YYYY-MM-DD */
export function todayStr(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
