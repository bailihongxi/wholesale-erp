/**
 * 价格规则（加价率）——老板在系统设置里一次性设定，
 * 之后「新建商品只填成本」、或「一键重算全库价格」都以这里为准。
 *
 * 计算方式（成本加成法，最贴合家电批发的实际习惯）：
 *   批发价 = 成本价 × (1 + 批发加价率 / 100)
 *   零售价 = 成本价 × (1 + 零售加价率 / 100)
 * 例：成本 2000，批发加价 15% → 批发价 2300；零售加价 30% → 零售价 2600。
 */
const STORAGE_KEY = 'erp_price_rule'

export interface PriceRule {
  /** 批发加价率（百分比） */
  wholesaleRate: number
  /** 零售加价率（百分比） */
  retailRate: number
  /** 自动计算后的取整方式 */
  rounding: 'none' | 'yuan' | 'ten'
  /** 新建商品时是否按规则自动带出批发价 / 零售价 */
  autoFill: boolean
}

export function defaultPriceRule(): PriceRule {
  return { wholesaleRate: 15, retailRate: 30, rounding: 'yuan', autoFill: true }
}

/** 保留两位小数，避免 2000 * 1.15 = 2299.9999999999995 这类浮点误差 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** 按取整方式收尾：none=两位小数，yuan=整元，ten=整十元 */
export function applyRounding(n: number, rounding: PriceRule['rounding'] = 'yuan'): number {
  if (!Number.isFinite(n)) return 0
  switch (rounding) {
    case 'yuan': return Math.round(n)
    case 'ten': return Math.round(n / 10) * 10
    default: return round2(n)
  }
}

export function getPriceRule(): PriceRule {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPriceRule()
    const parsed = JSON.parse(raw) as Partial<PriceRule>
    const base = defaultPriceRule()
    return {
      wholesaleRate: Number.isFinite(parsed.wholesaleRate) ? Number(parsed.wholesaleRate) : base.wholesaleRate,
      retailRate: Number.isFinite(parsed.retailRate) ? Number(parsed.retailRate) : base.retailRate,
      rounding: parsed.rounding === 'none' || parsed.rounding === 'yuan' || parsed.rounding === 'ten'
        ? parsed.rounding : base.rounding,
      autoFill: typeof parsed.autoFill === 'boolean' ? parsed.autoFill : base.autoFill
    }
  } catch {
    return defaultPriceRule()
  }
}

export function savePriceRule(rule: PriceRule): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rule))
}

/** 由成本推算批发价 */
export function calcWholesale(cost: number, rule: PriceRule = getPriceRule()): number {
  return applyRounding(cost * (1 + rule.wholesaleRate / 100), rule.rounding)
}

/** 由成本推算零售价 */
export function calcRetail(cost: number, rule: PriceRule = getPriceRule()): number {
  return applyRounding(cost * (1 + rule.retailRate / 100), rule.rounding)
}
