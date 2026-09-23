import { db } from '../db'
import type { AuditLog } from '../types'

/**
 * 操作日志：记录关键业务动作，供「操作日志」页面追溯。
 * 写入失败不能影响主流程，因此内部吞掉异常。
 */
export async function writeLog(
  operatorId: number,
  action: string,
  detail: string
): Promise<void> {
  try {
    const log: Omit<AuditLog, 'id'> = {
      operatorId,
      action,
      detail,
      createdAt: new Date().toISOString()
    }
    await db.auditLogs.add(log)
  } catch {
    // 日志失败不影响业务
  }
}

/** 常用动作枚举，避免各处拼写不一致 */
export const AUDIT_ACTIONS = {
  LOGIN: '登录',
  LOGOUT: '退出登录',
  PRODUCT_CREATE: '新增商品',
  PRODUCT_UPDATE: '修改商品',
  PURCHASE_CREATE: '创建采购单',
  PURCHASE_INBOUND: '采购入库',
  SALE_CREATE: '创建销售单',
  SALE_OUTBOUND: '销售出库',
  PAYMENT_RECEIVE: '登记收款',
  PAYMENT_PAY: '登记付款',
  STOCK_ADJUST: '出入库单调整',
  RETURN_SALE: '销售退货',
  RETURN_PURCHASE: '采购退货',
  LEDGER_ADD: '记一笔',
  LEDGER_DELETE: '删除记一笔',
  SALE_DELETE: '删除销售单',
  PURCHASE_DELETE: '删除采购单',
  STOCK_DOC_DELETE: '删除出入库单',
  QUOTE_CREATE: '创建报价单',
  QUOTE_UPDATE: '修改报价单',
  QUOTE_DELETE: '删除报价单',
  QUOTE_CONVERT: '报价转销售单',
  /** 删销售单/采购单时把来源报价单/询价单退回未转（V2.1-1.4 双向联动） */
  QUOTE_REVERT: '撤回转单',
  PERM_UPDATE: '配置角色权限',
  DOC_PRINT: '打印单据',
  CUSTOMER_CREATE: '新增客户',
  SUPPLIER_CREATE: '新增供应商',
  USER_CREATE: '新增员工',
  DATA_EXPORT: '导出备份',
  DATA_IMPORT: '导入恢复'
} as const
