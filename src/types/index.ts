// 角色类型定义
export type Role = 'boss' | 'purchaser' | 'sales' | 'finance' | 'warehouse' | 'dealer'

// 员工账号
export interface User {
  id?: number
  /**
   * 登录名（第十八轮新增）：唯一，登录主通道。
   * 老数据没有这个字段，读取时用 `usernameOf(user)` 兜底成手机号，免迁移。
   */
  username?: string
  /** 工号（第十八轮新增）：唯一，形如 E001；老数据由 v7 迁移自动补齐 */
  employeeNo?: string
  name: string
  phone: string
  /** 密码：第十八轮起存加盐哈希（见 utils/password.ts），老数据仍是明文，登录成功后自动升级 */
  password: string
  role: Role
  status: 'active' | 'disabled'
  /** 部门（可选，自由填写，带建议值） */
  dept?: string
  /** 职位（可选） */
  position?: string
  /** 入职日期 YYYY-MM-DD（可选） */
  joinDate?: string
  /** 备注（可选） */
  remark?: string
  /** 头像：emoji 或图片 dataURL；为空则用姓名首字兜底 */
  avatar?: string
  /** 最近一次登录时间 ISO（可选） */
  lastLoginAt?: string
  createdAt: string
}

/** 员工登录名：新数据取 username，老数据回落手机号 */
export function usernameOf(user: Pick<User, 'username' | 'phone'>): string {
  return (user.username ?? '').trim() || user.phone
}

/** 员工显示名：优先工号，便于管理页与打印单据对照 */
export function displayNoOf(user: Pick<User, 'employeeNo' | 'phone'>): string {
  return user.employeeNo || user.phone
}

/**
 * 角色权限：某个角色可见的模块（以路由为键）。
 * modules 为空数组表示「未自定义」，此时回退到系统内置默认权限。
 */
export interface RolePerm {
  id?: number
  role: Role
  /** 该角色可见模块的路由数组 */
  modules: string[]
  updatedAt: string
}

/** 记一笔：方向（收 / 支） */
export type LedgerDirection = 'in' | 'out'

/**
 * 记一笔流水：记录无法用采购单 / 销售单结算的日常收支
 * （送货费、物流费、快递费、安装费、辅材费……）。
 */
export interface LedgerEntry {
  id?: number
  /** 流水单号，如 JY20260919-123 */
  orderNo: string
  direction: LedgerDirection
  /** 费用分类（见 utils/ledger.ts 的 LEDGER_CATEGORIES） */
  category: string
  amount: number
  /** 往来单位名称（可留空） */
  counterparty: string
  /** 发生日期 YYYY-MM-DD */
  entryDate: string
  operatorId: number
  remark: string
  /** 关联单据类型：inbound / outbound / return / purchase / sale / transfer / stocktake，空表示不关联 */
  linkDocType?: string
  /** 关联单据号（如 RK20260920-123 / CG20260919001 / TH…），便于追踪费用来源单据 */
  linkDocNo?: string
  createdAt: string
}

// 客户/经销商
export interface Customer {
  id?: number
  name: string
  contact: string
  phone: string
  address: string
  level: string
  creditLimit: number
  paymentTerm: string
  loginPhone?: string
  loginPassword?: string
  status: 'active' | 'disabled'
  remark: string
  // ↓ 开票与对公账户信息（第十三轮新增，老数据无此字段也能正常读取）
  invoiceTitle?: string
  taxNo?: string
  invoiceAddress?: string
  invoicePhone?: string
  bankName?: string
  bankAccount?: string
}

// 供应商
export interface Supplier {
  id?: number
  name: string
  contact: string
  phone: string
  address: string
  paymentTerm: string
  remark: string
  // ↓ 开票与对公账户信息（第十三轮新增）
  invoiceTitle?: string
  taxNo?: string
  invoiceAddress?: string
  invoicePhone?: string
  bankName?: string
  bankAccount?: string
}

/**
 * 开票与对公账户信息（客户 / 供应商通用的一组字段）。
 * 用于表单回显、详情展示与「是否已填」判断。
 */
export interface InvoiceInfo {
  /** 开票抬头（发票上的单位名称） */
  invoiceTitle: string
  /** 纳税人识别号（税号） */
  taxNo: string
  /** 开票注册地址 */
  invoiceAddress: string
  /** 开票登记电话 */
  invoicePhone: string
  /** 开户银行（对公） */
  bankName: string
  /** 对公银行账号 */
  bankAccount: string
}

// 商品档案
export interface Product {
  id?: number
  brand: string
  model: string
  category: string
  spec: string
  unit: string
  purchasePrice: number
  wholesalePrice: number
  retailPrice: number
  warnStock: number
  status: 'active' | 'inactive'
  remark: string
  extra: Record<string, unknown>
}

// 库存
export interface Stock {
  id?: number
  productId: number
  quantity: number
  updatedAt: string
}

// 采购单主表
export interface PurchaseOrder {
  id?: number
  orderNo: string
  supplierId: number
  purchaserId: number
  orderDate: string
  status: 'pending' | 'partial' | 'completed'
  totalAmount: number
  payStatus: 'unpaid' | 'partial' | 'paid'
  remark: string
}

// 采购单明细
export interface PurchaseOrderItem {
  id?: number
  purchaseOrderId: number
  productId: number
  quantity: number
  price: number
  subtotal: number
  /** 赠品行（第二十轮）：金额计 0、不参与合计，但照常入库与打印标记 */
  isGift?: boolean
}

// 销售单主表
export interface SaleOrder {
  id?: number
  orderNo: string
  customerId: number
  salesId: number
  orderDate: string
  status: 'pending' | 'partial' | 'completed'
  totalAmount: number
  receiveStatus: 'unreceived' | 'partial' | 'received'
  remark: string
  /**
   * 本单按哪种价格成交：批发价 / 零售价。
   * 同一个客户可能拿批发也可能拿零售，由开单人在这张单上切换。
   * 老单据没有该字段时按 wholesale 处理。
   */
  priceMode?: 'wholesale' | 'retail'
}

// 销售单明细
export interface SaleOrderItem {
  id?: number
  saleOrderId: number
  productId: number
  quantity: number
  price: number
  subtotal: number
  /** 赠品行（第二十轮）：金额计 0、不参与合计，但照常出库与打印标记 */
  isGift?: boolean
}

// 出入库流水
export interface StockRecord {
  id?: number
  type: 'purchase_in' | 'sale_out' | 'adjust' | 'transfer' | 'sale_return' | 'purchase_return'
  refOrderId: number
  productId: number
  /** 入库记正数，出库记负数（历史约定，取数量时用 Math.abs） */
  quantity: number
  operatorId: number
  createdAt: string
  /**
   * 所属出入库单号（批次号）。
   * 一次收货 / 发货操作 = 一张出入库单，该批所有流水共用同一个 batchNo，
   * 便于按单查看明细、打印、修改与撤回。
   */
  batchNo?: string
  /** 库位 id（调拨 / 盘点会带出具体库位，普通收发货默认总仓=1） */
  locationId?: number
  /** 备注（验收单 / 拣货单的有效信息备注，随流水保存） */
  remark?: string
}

// 库位（总仓 / 门店 等；库存调拨在库位之间移动货物）
export interface Location {
  id?: number
  name: string
  /** 备注：地址 / 用途说明（可选） */
  remark?: string
  createdAt?: string
}

// 调拨单主表
export interface TransferOrder {
  id?: number
  orderNo: string
  fromLoc: number
  toLoc: number
  date: string
  operatorId: number
  status: 'done'
}

// 调拨单明细
export interface TransferItem {
  id?: number
  transferOrderId: number
  productId: number
  quantity: number
}

// 库位库存分布（与总库存 `stock` 互为校验：总库存 = 各库位之和）
export interface LocationStock {
  id?: number
  productId: number
  locationId: number
  quantity: number
}

// 盘点单主表
export interface Stocktake {
  id?: number
  orderNo: string
  /** 盘点所在库位（默认总仓） */
  locationId: number
  date: string
  operatorId: number
  status: 'done'
}

// 盘点单明细：系统库存 vs 实盘数
export interface StocktakeItem {
  id?: number
  stocktakeId: number
  productId: number
  /** 盘点时该库位的系统库存 */
  systemQty: number
  /** 实盘数量 */
  actualQty: number
}

// 退换货单主表（销售退货 / 采购退货 统一在此管理）
export interface ReturnOrder {
  id?: number
  orderNo: string
  /** 退货类型：销售退货（客户退货，库存回流）/ 采购退货（退给供应商，库存流出） */
  kind: 'sale' | 'purchase'
  /** 关联的源单据（销售单 / 采购单） */
  refOrderId: number
  refOrderNo: string
  /** 往来单位：销售退货为客户、采购退货为供应商 */
  partyId: number
  date: string
  operatorId: number
  status: 'done'
  /** 退货总金额（数量 × 成交单价 之和） */
  totalAmount: number
  remark?: string
}

// 退换货单明细
export interface ReturnItem {
  id?: number
  returnOrderId: number
  productId: number
  /** 退货数量（正数） */
  quantity: number
  /** 退货时的成交单价 */
  price: number
  /** 行金额 = quantity × price */
  amount: number
  /** 退货原因（质量问题 / 尺码不符 / 发错货 等） */
  reason?: string
}

// 收付款记录
export interface Payment {
  id?: number
  type: 'receive' | 'pay' | 'refund' | 'supplier_credit'
  refOrderId: number
  counterpartyId: number
  amount: number
  payDate: string
  operatorId: number
  remark: string
}

// 出入库历史行（供入库/出库历史列表查询展示）
export interface StockHistoryRow {
  id: number
  /** 关联单据 ID（采购单 / 销售单） */
  orderId: number
  orderNo: string
  /** 往来单位：入库为供应商、出库为客户 */
  partyName: string
  productId: number
  productName: string
  /** 数量，统一为正数（出库流水存负数，此处取绝对值） */
  quantity: number
  operatorId: number
  operatorName: string
  createdAt: string
}

// 收付款历史行（供财务流水查询展示）
export interface PaymentHistoryRow {
  id: number
  type: 'receive' | 'pay' | 'refund' | 'supplier_credit'
  orderId: number
  orderNo: string
  /** 往来单位：收款为客户、付款为供应商 */
  counterpartyName: string
  amount: number
  payDate: string
  operatorId: number
  operatorName: string
  remark: string
}

// 操作日志
export interface AuditLog {
  id?: number
  operatorId: number
  action: string
  detail: string
  createdAt: string
}

// 报价单（第二十轮）
export interface QuoteOrder {
  id?: number
  orderNo: string
  /** 客户ID；散客（未建档询价）为 0，名字存 customerName，转销售单时自动建档 */
  customerId: number
  customerName: string
  quoteDate: string
  /** draft 待报价 / sent 已报价 / converted 已转销售单 / void 已失效 */
  status: 'draft' | 'sent' | 'converted' | 'void'
  totalAmount: number
  /** 有效期天数（选填），到期后自动视为待确认 */
  validDays?: number
  remark: string
  salesId: number
  /** 转销售单后回填：销售单 ID 与单号，双向可查 */
  convertedSaleOrderId?: number
  convertedSaleNo?: string
  createdAt: string
}

export interface QuoteOrderItem {
  id?: number
  quoteOrderId: number
  productId: number
  quantity: number
  price: number
  subtotal: number
}
