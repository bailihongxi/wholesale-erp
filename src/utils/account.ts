/**
 * 账号字段规则（第十八轮）
 *
 * 登录名与手机号是两条并行的登录通道，规则集中放这里，
 * 免得「新建员工」和「编辑员工」两处各写一份正则、慢慢走样。
 */

/** 登录名：3-20 位字母、数字、下划线；统一转小写存储，登录时不区分大小写 */
export const USERNAME_RULE = /^[a-zA-Z0-9_]{3,20}$/
/** 手机号：11 位、以 1 开头（登录通道之一） */
export const PHONE_RULE = /^1\d{10}$/

export function normalizeUsername(v: string): string {
  return (v ?? '').trim().toLowerCase()
}

export function isValidUsername(v: string): boolean {
  return USERNAME_RULE.test(normalizeUsername(v))
}

export function isValidPhone(v: string): boolean {
  return PHONE_RULE.test((v ?? '').trim())
}

/** 部门建议值：表单里用 datalist 给候选，也允许自由填写 */
export const DEPT_SUGGESTIONS: string[] = [
  '管理部', '采购部', '销售部', '财务部', '仓储部', '售后部'
]

/** 职位建议值 */
export const POSITION_SUGGESTIONS: string[] = [
  '负责人', '主管', '采购员', '销售员', '会计', '出纳', '库管', '安装工', '送货员'
]
