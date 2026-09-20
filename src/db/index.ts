import Dexie, { type Table } from 'dexie'
import { hashPassword } from '../utils/password'
import type {
  User, Customer, Supplier, Product, Stock,
  PurchaseOrder, PurchaseOrderItem,
  SaleOrder, SaleOrderItem,
  StockRecord, Payment, AuditLog,
  Location, TransferOrder, TransferItem, LocationStock, Stocktake, StocktakeItem,
  ReturnOrder, ReturnItem, RolePerm, LedgerEntry
} from '../types'

class ERPDatabase extends Dexie {
  users!: Table<User, number>
  customers!: Table<Customer, number>
  suppliers!: Table<Supplier, number>
  products!: Table<Product, number>
  stock!: Table<Stock, number>
  purchaseOrders!: Table<PurchaseOrder, number>
  purchaseOrderItems!: Table<PurchaseOrderItem, number>
  saleOrders!: Table<SaleOrder, number>
  saleOrderItems!: Table<SaleOrderItem, number>
  stockRecords!: Table<StockRecord, number>
  payments!: Table<Payment, number>
  auditLogs!: Table<AuditLog, number>
  locations!: Table<Location, number>
  locationStock!: Table<LocationStock, number>
  transferOrders!: Table<TransferOrder, number>
  transferItems!: Table<TransferItem, number>
  stocktakes!: Table<Stocktake, number>
  stocktakeItems!: Table<StocktakeItem, number>
  returnOrders!: Table<ReturnOrder, number>
  returnItems!: Table<ReturnItem, number>
  rolePerms!: Table<RolePerm, number>
  ledgerEntries!: Table<LedgerEntry, number>

  constructor() {
    super('wholesale-erp')
    this.version(1).stores({
      users: '++id, phone, role, status',
      customers: '++id, name, level, status, loginPhone',
      suppliers: '++id, name',
      products: '++id, brand, model, category, status',
      stock: '++id, productId',
      purchaseOrders: '++id, orderNo, supplierId, purchaserId, status, payStatus, orderDate',
      purchaseOrderItems: '++id, purchaseOrderId, productId',
      saleOrders: '++id, orderNo, customerId, salesId, status, receiveStatus, orderDate',
      saleOrderItems: '++id, saleOrderId, productId',
      stockRecords: '++id, type, refOrderId, productId, operatorId',
      payments: '++id, type, refOrderId, counterpartyId',
      auditLogs: '++id, operatorId, createdAt'
    })
    // v2：为出入库流水增加 createdAt 索引。
    // 库存管理页需要按时间倒序展示最近流水（orderBy('createdAt')），
    // 未建索引时 Dexie 会抛 SchemaError 导致该页流水加载失败。
    this.version(2).stores({
      stockRecords: '++id, type, refOrderId, productId, operatorId, createdAt'
    })
    // v3：出入库流水增加 batchNo 索引。
    // 一次收货/发货 = 一张出入库单（RK…/CK…），该批流水共用 batchNo，
    // 才能按单聚合查询明细、打印、改量与撤回。
    this.version(3).stores({
      stockRecords: '++id, type, refOrderId, productId, operatorId, createdAt, batchNo'
    })
    // v4：库存作业扩展——库位（总仓/门店）、库位库存分布、调拨单、盘点单。
    // 调拨在库位之间移动货物（不影响总库存），盘点校正系统库存与实盘的差异。
    this.version(4).stores({
      locations: '++id, name',
      locationStock: '++id, productId, locationId',
      transferOrders: '++id, orderNo, fromLoc, toLoc, status, date, operatorId',
      transferItems: '++id, transferOrderId, productId',
      stocktakes: '++id, orderNo, locationId, date, operatorId, status',
      stocktakeItems: '++id, stocktakeId, productId'
    })
    // v5：退换货模块——销售退货 / 采购退货 统一单据。
    // 退货同时校正库存（销售退货↑、采购退货↓）并作为财务红冲（退款/供应商 Credit）。
    this.version(5).stores({
      returnOrders: '++id, orderNo, kind, refOrderId, partyId, operatorId, status, date',
      returnItems: '++id, returnOrderId, productId'
    })
    // v6：角色权限配置 + 「记一笔」流水。
    // rolePerms 按角色保存可见模块路由；ledgerEntries 记录采购/销售之外的日常收支。
    this.version(6).stores({
      rolePerms: '++id, role',
      ledgerEntries: '++id, orderNo, direction, category, entryDate, operatorId'
    })
    // v7：员工档案扩展 + 登录名（第十八轮）。
    // users 增加 username（登录主通道）与 employeeNo（工号）索引；
    // upgrade 里给老数据补 username = phone、employeeNo = E001…，
    // 用户不需要手工重建任何账号，升级后照原样登录。
    this.version(7).stores({
      users: '++id, phone, role, status, username, employeeNo'
    }).upgrade(async tx => {
      const rows = (await tx.table('users').toArray()) as Array<Record<string, any>>
      let seq = 0
      for (const u of rows) {
        seq += 1
        const patch: Record<string, string> = {}
        if (!u.username) patch.username = String(u.phone ?? '')
        if (!u.employeeNo) patch.employeeNo = `E${String(seq).padStart(3, '0')}`
        if (Object.keys(patch).length) await tx.table('users').update(u.id, patch)
      }
    })
  }
}

export const db = new ERPDatabase()

// 初始化默认管理员账号与默认库位
export async function initDefaultAdmin(): Promise<void> {
  const count = await db.users.count()
  if (count === 0) {
    await db.users.add({
      name: '老板',
      username: 'admin',
      employeeNo: 'E001',
      phone: '13800000000',
      password: await hashPassword('admin123'),
      role: 'boss',
      status: 'active',
      dept: '管理部',
      position: '负责人',
      joinDate: '',
      remark: '',
      avatar: '',
      createdAt: new Date().toISOString()
    })
  }
  // 默认库位：总仓(1) 与 门店(2)。调拨在二者之间移动货物。
  const locCount = await db.locations.count()
  if (locCount === 0) {
    // 用 bulkPut 而非 bulkAdd：并发初始化时不会因重复主键报错
    await db.locations.bulkPut([
      { id: 1, name: '总仓', createdAt: new Date().toISOString() },
      { id: 2, name: '门店', createdAt: new Date().toISOString() }
    ])
  }
}

/**
 * 生成下一个工号 E001 / E002 …
 * 取现有最大号 +1，删掉的号不复用——工号一旦印在单据上就不该被别人顶替。
 */
export async function nextEmployeeNo(): Promise<string> {
  const rows = await db.users.toArray()
  let max = 0
  for (const u of rows) {
    const m = /^E(\d+)$/.exec(u.employeeNo ?? '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `E${String(max + 1).padStart(3, '0')}`
}
