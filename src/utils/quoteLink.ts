/**
 * 报价单 / 预采询价单 与 销售单 / 采购单 的「转单联动」（V2.1-1.4）
 *
 * 背景（老板 2026-09-24 反馈）：
 *   报价单转销售单后会被写成 `status: 'converted'` 并回填 `convertedSaleOrderId`。
 *   但**销售单侧没有回指字段**（关联是单向的），而删除销售单时原来只删自己 ——
 *   于是来源报价单被永久钉在「已转单」：不能再转、也不能再修改（页面按钮按
 *   `status !== 'converted'` 隐藏），变成一张孤儿单据。
 *
 * 解决：删单时**反向查**来源单据并退回「未转」状态。
 *   - 反向查得通：报价单表里存了 `convertedSaleOrderId`，按被删单据 id 反查即可；
 *   - 转单后禁止重复转 → 严格一对一，不会误伤其它单据；
 *   - 只允许删「待出库 / 待入库」的单（库存没动过），回退是安全的。
 *
 * ⚠️ 回退状态写 `sent`（已报价 / 已询价）：
 *   转单前的原状态没有被记录下来（要加字段就得改云端表结构），而实际业务里
 *   都是「已报价 / 已询价」之后才转单，故统一退回 `sent` —— 可修改、可再次转单。
 */

import { db } from '../db'
import { writeLog, AUDIT_ACTIONS } from './audit'

export type QuoteKind = 'sale' | 'purchase'

/** 回退结果：reverted=false 表示本单不是转来的（或来源单据已删） */
export interface RevertResult {
  reverted: boolean
  quoteNo: string
}

/**
 * 删除销售单 / 采购单时，把来源报价单 / 预采询价单退回未转状态。
 *
 * @param deletedOrderId  被删单据的 id（用于反查 convertedSaleOrderId）
 * @param deletedOrderNo  被删单据号（写日志用）
 * @param kind            sale=销售单→来源报价单；purchase=采购单→来源预采询价单
 * @param operatorId      操作人（写审计日志）
 */
export async function revertQuoteOnOrderDelete(
  deletedOrderId: number,
  deletedOrderNo: string,
  kind: QuoteKind,
  operatorId: number
): Promise<RevertResult> {
  // 先按索引缩小到「已转」的，再在内存里按 id + kind 精确匹配
  // （云端 where('status').equals() 会下推成 PostgREST 过滤，不会整表拉回）
  const converted = await db.quoteOrders.where('status').equals('converted').toArray()
  const src = converted.find(
    q => (q.kind ?? 'sale') === kind && q.convertedSaleOrderId === deletedOrderId
  )
  if (!src?.id) return { reverted: false, quoteNo: '' }

  await db.quoteOrders.update(src.id, {
    status: 'sent',
    convertedSaleOrderId: 0,
    convertedSaleNo: ''
  })

  const quoteLabel = kind === 'sale' ? '报价单' : '预采询价单'
  const orderLabel = kind === 'sale' ? '销售单' : '采购单'
  await writeLog(
    operatorId,
    AUDIT_ACTIONS.QUOTE_REVERT,
    `删除${orderLabel} ${deletedOrderNo}，来源${quoteLabel} ${src.orderNo} 退回未转状态（可重新修改 / 再转单）`
  )
  return { reverted: true, quoteNo: src.orderNo }
}
