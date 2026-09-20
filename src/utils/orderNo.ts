// 生成采购单号：CG + 日期 + 序号
export function genPurchaseNo(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const rand = Math.floor(Math.random() * 900 + 100)
  return `CG${y}${m}${d}-${rand}`
}

// 生成报价单号：BJ + 日期 + 序号
export function genQuoteNo(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const rand = Math.floor(Math.random() * 900 + 100)
  return `BJ${y}${m}${d}-${rand}`
}

// 生成销售单号：XS + 日期 + 序号
export function genSaleNo(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const rand = Math.floor(Math.random() * 900 + 100)
  return `XS${y}${m}${d}-${rand}`
}

/**
 * 生成出入库单号（批次号）。
 * 一张采购单可能分多次收货，每次收货生成一张独立的入库单 RK…；
 * 出库同理为 CK…。这样「部分入库 / 部分出库」就有单可查、可打印、可撤回，
 * 并且通过 refOrderId 始终关联回最初的采购单 / 销售单。
 */
export function genStockDocNo(kind: 'RK' | 'CK' | 'DB' | 'PD' | 'TH' | string, date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const rand = Math.floor(Math.random() * 900 + 100)
  return `${kind}${y}${m}${d}-${rand}`
}

// 金额转大写
export function toChineseUpper(n: number): string {
  const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
  const units = ['', '拾', '佰', '仟']
  const bigUnits = ['', '万', '亿']
  const str = Math.round(n * 100).toString()
  if (str === '0') return '零元整'
  const intPart = str.slice(0, -2)
  const decPart = str.slice(-2)
  let result = ''
  const len = intPart.length
  for (let i = 0; i < len; i++) {
    const d = Number(intPart[i])
    const pos = len - 1 - i
    const bigPos = Math.floor(pos / 4)
    const smallPos = pos % 4
    if (d === 0) {
      if (smallPos === 0 && bigPos > 0) result += bigUnits[bigPos]
    } else {
      result += digits[d] + units[smallPos] + (smallPos === 0 ? bigUnits[bigPos] : '')
    }
  }
  result += '元'
  if (decPart === '00') {
    result += '整'
  } else {
    const jiao = Number(decPart[0])
    const fen = Number(decPart[1])
    if (jiao > 0) result += digits[jiao] + '角'
    if (fen > 0) result += digits[fen] + '分'
  }
  return result
}
