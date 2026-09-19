/**
 * 开票与对公账户信息（第十三轮）
 * ----------------------------------------------------------------
 * 客户与供应商都需要留存一套「开票 + 打款」资料：
 * 开票抬头、纳税人识别号、开票地址电话、开户银行、对公账号、备注。
 *
 * 之所以抽成工具：
 *  - 客户页与供应商页共用同一份字段定义，新增字段只改一处；
 *  - 「是否已填」的判断逻辑在列表徽标、打印抬头、导出里都会用到；
 *  - 老数据（第十三轮之前录入的）没有这些字段，一律按空串回落，不报错。
 */
import type { Customer, InvoiceInfo, Supplier } from '../types'

/** 开票字段清单：表单渲染、导入导出都按这个顺序 */
export const INVOICE_FIELDS: Array<{ key: keyof InvoiceInfo; label: string; placeholder: string }> = [
  { key: 'invoiceTitle', label: '开票抬头', placeholder: '发票上的单位全称' },
  { key: 'taxNo', label: '纳税人识别号', placeholder: '税号（15/17/18/20 位）' },
  { key: 'invoiceAddress', label: '开票地址', placeholder: '发票上的注册地址' },
  { key: 'invoicePhone', label: '开票电话', placeholder: '发票上的登记电话' },
  { key: 'bankName', label: '开户银行', placeholder: '如：中国银行北京分行' },
  { key: 'bankAccount', label: '对公账号', placeholder: '对公银行账号' }
]

/** 一组空的开票信息（新建表单的初值） */
export function emptyInvoice(): InvoiceInfo {
  return {
    invoiceTitle: '',
    taxNo: '',
    invoiceAddress: '',
    invoicePhone: '',
    bankName: '',
    bankAccount: ''
  }
}

/** 从任意对象取出开票信息（老数据缺字段一律回落为空串） */
export function invoiceOf(o: Partial<InvoiceInfo> | null | undefined): InvoiceInfo {
  return {
    invoiceTitle: o?.invoiceTitle ?? '',
    taxNo: o?.taxNo ?? '',
    invoiceAddress: o?.invoiceAddress ?? '',
    invoicePhone: o?.invoicePhone ?? '',
    bankName: o?.bankName ?? '',
    bankAccount: o?.bankAccount ?? ''
  }
}

/** 是否已填开票资料（只要填了任意一项就算「已填」） */
export function hasInvoice(o: Partial<InvoiceInfo> | null | undefined): boolean {
  const v = invoiceOf(o)
  return INVOICE_FIELDS.some(f => !!v[f.key].trim())
}

/** 开票资料是否完整（抬头 + 税号必填，才能开票） */
export function invoiceComplete(o: Partial<InvoiceInfo> | null | undefined): boolean {
  const v = invoiceOf(o)
  return !!v.invoiceTitle.trim() && !!v.taxNo.trim()
}

/** 开票关键信息的单行摘要，用于列表与卡片副标题 */
export function invoiceSummary(o: Partial<InvoiceInfo> | null | undefined): string {
  const v = invoiceOf(o)
  const parts: string[] = []
  if (v.invoiceTitle.trim()) parts.push(v.invoiceTitle.trim())
  if (v.taxNo.trim()) parts.push('税号 ' + v.taxNo.trim())
  if (v.bankName.trim() || v.bankAccount.trim()) {
    parts.push([v.bankName.trim(), v.bankAccount.trim()].filter(Boolean).join(' '))
  }
  return parts.join(' · ')
}

/** 客户 / 供应商共用的类型别名 */
export type InvoiceParty = Customer | Supplier
