// 示例数据（演示/试用用）。
// 新部署时 IndexedDB 是空的，采购、销售、入库、出库、财务等页面会全部显示「暂无数据」，
// 容易被误认为功能没有开发。这里提供一套覆盖完整业务链路的示例数据，
// 一键生成后各页面即可看到真实内容与可操作单据。
//
// 所有数据均通过各业务 store 写入，与真实操作走同一套逻辑，
// 因此会同步产生库存、出入库流水、应收应付与操作日志，数据一致。

import { db } from '../db'
import { useProductStore } from '../stores/product'
import { usePurchaseStore } from '../stores/purchase'
import { useSalesStore } from '../stores/sales'
import { useFinanceStore } from '../stores/finance'
import { useInventoryStore } from '../stores/inventory'
import type { Product } from '../types'

/** 当前登录操作人（示例数据统一记在该账号下） */
const OPERATOR_ID = 1

interface DemoResult {
  ok: boolean
  message: string
}

/**
 * 生成示例数据。
 * 已有商品时不重复生成，避免把用户真实数据搞乱。
 */
export async function seedDemoData(): Promise<DemoResult> {
  const existing = await db.products.count()
  if (existing > 0) {
    return { ok: false, message: '已有商品数据，未重复生成示例数据' }
  }

  const productStore = useProductStore()
  const purchaseStore = usePurchaseStore()
  const salesStore = useSalesStore()
  const financeStore = useFinanceStore()

  // ===== 1. 商品档案（6 个 SKU，覆盖空调/冰箱/洗衣机/电视/厨电） =====
  const productSeeds: Array<Omit<Product, 'id'>> = [
    { brand: '海尔', model: 'KFR-35GW', category: '空调', spec: '1.5匹 冷暖', unit: '台', purchasePrice: 1800, wholesalePrice: 2200, retailPrice: 2699, warnStock: 5, status: 'active', remark: '挂机', extra: {} },
    { brand: '格力', model: 'KFR-72LW', category: '空调', spec: '3匹 柜机', unit: '台', purchasePrice: 4200, wholesalePrice: 5100, retailPrice: 5999, warnStock: 3, status: 'active', remark: '柜机', extra: {} },
    { brand: '美的', model: 'BCD-253', category: '冰箱', spec: '253升 三门', unit: '台', purchasePrice: 1600, wholesalePrice: 2000, retailPrice: 2499, warnStock: 5, status: 'active', remark: '', extra: {} },
    { brand: '海尔', model: 'XQB100', category: '洗衣机', spec: '10公斤 波轮', unit: '台', purchasePrice: 1200, wholesalePrice: 1500, retailPrice: 1899, warnStock: 5, status: 'active', remark: '', extra: {} },
    { brand: 'TCL', model: '65C12', category: '电视', spec: '65英寸 4K', unit: '台', purchasePrice: 2600, wholesalePrice: 3200, retailPrice: 3999, warnStock: 3, status: 'active', remark: '', extra: {} },
    { brand: '美的', model: 'M3-L235', category: '厨电', spec: '23升 微波', unit: '台', purchasePrice: 380, wholesalePrice: 480, retailPrice: 599, warnStock: 10, status: 'active', remark: '', extra: {} }
  ]
  for (const seed of productSeeds) {
    await productStore.createProduct(seed, OPERATOR_ID)
  }
  const products = await db.products.toArray()
  const byModel = (m: string): Product => products.find(p => p.model === m) as Product

  // ===== 2. 供应商 =====
  const supplierSeeds = [
    { name: '海尔华南总代', contact: '张经理', phone: '13900001111', address: '广州市天河区', paymentTerm: '月结30天', remark: '空调、洗衣机主力供应商' },
    { name: '格力广东分公司', contact: '李主管', phone: '13900002222', address: '深圳市福田区', paymentTerm: '月结30天', remark: '' },
    { name: '美的电器批发', contact: '王经理', phone: '13900003333', address: '佛山市顺德区', paymentTerm: '现结', remark: '冰箱、厨电' }
  ]
  for (const s of supplierSeeds) {
    await purchaseStore.createSupplier(s, OPERATOR_ID)
  }
  const suppliers = await purchaseStore.listSuppliers()

  // ===== 3. 客户（含 1 个经销商账号，可直接登录体验经销商端） =====
  const customerSeeds = [
    { name: '城南电器商行', contact: '陈老板', phone: '13800004444', address: '城南大道 88 号', level: 'A', creditLimit: 200000, paymentTerm: '月结30天', status: 'active' as const, remark: '老客户' },
    { name: '华联家电超市', contact: '刘店长', phone: '13800005555', address: '华联商场 3 层', level: 'B', creditLimit: 100000, paymentTerm: '月结15天', status: 'active' as const, remark: '' },
    { name: '顺发家电经销部', contact: '赵总', phone: '13800006666', address: '城西批发市场 A12', level: 'A', creditLimit: 150000, paymentTerm: '月结30天', status: 'active' as const, remark: '已开通经销商自助查询' }
  ]
  for (const c of customerSeeds) {
    await salesStore.createCustomer(c, OPERATOR_ID)
  }
  const customers = await salesStore.listCustomers()
  // 给顺发家电开通经销商登录号（13800006666 / 123456）
  const dealer = customers.find(c => c.name === '顺发家电经销部')
  if (dealer?.id) {
    await db.customers.update(dealer.id, { loginPhone: '13800006666', loginPassword: '123456' })
  }

  // ===== 4. 采购单 =====
  // PO1：已全部入库 + 已付款（历史完成单）
  const po1 = await purchaseStore.createOrder({
    supplierId: suppliers[0].id!,
    purchaserId: OPERATOR_ID,
    items: [
      { product: byModel('KFR-35GW'), quantity: 10 },
      { product: byModel('XQB100'), quantity: 8 }
    ],
    remark: '首批备货'
  })
  if (po1.ok && po1.orderId) {
    await purchaseStore.inbound(po1.orderId, {
      [byModel('KFR-35GW').id!]: 10,
      [byModel('XQB100').id!]: 8
    }, OPERATOR_ID)
    const o = await purchaseStore.getOrder(po1.orderId)
    await financeStore.recordPay({ orderId: po1.orderId, amount: o?.totalAmount ?? 0, operatorId: OPERATOR_ID, remark: '已付款' })
  }

  // PO2：待入库（让「入库验货」有单可做）
  await purchaseStore.createOrder({
    supplierId: suppliers[1].id!,
    purchaserId: OPERATOR_ID,
    items: [
      { product: byModel('KFR-72LW'), quantity: 6 },
      { product: byModel('65C12'), quantity: 5 }
    ],
    remark: '旺季备货，待收货'
  })

  // PO3：部分入库 + 部分付款（演示分批收货与分期付款）
  const po3 = await purchaseStore.createOrder({
    supplierId: suppliers[2].id!,
    purchaserId: OPERATOR_ID,
    items: [
      { product: byModel('BCD-253'), quantity: 12 },
      { product: byModel('M3-L235'), quantity: 20 }
    ],
    remark: '分批到货'
  })
  if (po3.ok && po3.orderId) {
    // 只收一半，采购单应停留在「部分入库」
    await purchaseStore.inbound(po3.orderId, {
      [byModel('BCD-253').id!]: 6,
      [byModel('M3-L235').id!]: 10
    }, OPERATOR_ID)
    await financeStore.recordPay({ orderId: po3.orderId, amount: 5000, operatorId: OPERATOR_ID, remark: '预付定金' })
  }

  // ===== 5. 销售单 =====
  // SO1：已出库 + 已收款
  const so1 = await salesStore.createOrder({
    customerId: customers[0].id!,
    salesId: OPERATOR_ID,
    items: [
      { product: byModel('KFR-35GW'), quantity: 4 },
      { product: byModel('XQB100'), quantity: 3 }
    ],
    remark: '已完成'
  })
  if (so1.ok && so1.orderId) {
    await salesStore.outbound(so1.orderId, {
      [byModel('KFR-35GW').id!]: 4,
      [byModel('XQB100').id!]: 3
    }, OPERATOR_ID)
    const o = await salesStore.getOrder(so1.orderId)
    await financeStore.recordReceive({ orderId: so1.orderId, amount: o?.totalAmount ?? 0, operatorId: OPERATOR_ID, remark: '已收款' })
  }

  // SO2：待出库（让「出库拣货」有单可做）
  await salesStore.createOrder({
    customerId: customers[1].id!,
    salesId: OPERATOR_ID,
    items: [
      { product: byModel('BCD-253'), quantity: 3 },
      { product: byModel('M3-L235'), quantity: 6 }
    ],
    remark: '待发货'
  })

  // SO3：部分出库 + 部分收款
  // 注意：销售建单会校验库存，因此这里只能用已入库的商品
  //（KFR-72LW / 65C12 尚在 PO2 待入库，不能用于销售单）
  const so3 = await salesStore.createOrder({
    customerId: customers[2].id!,
    salesId: OPERATOR_ID,
    items: [
      { product: byModel('KFR-35GW'), quantity: 5 },
      { product: byModel('XQB100'), quantity: 2 }
    ],
    remark: '分批发货'
  })
  if (so3.ok && so3.orderId) {
    await salesStore.outbound(so3.orderId, {
      [byModel('KFR-35GW').id!]: 2
    }, OPERATOR_ID)
    await financeStore.recordReceive({ orderId: so3.orderId, amount: 5000, operatorId: OPERATOR_ID, remark: '预收款' })
  }

  // ===== 6. 库房与调拨（演示「一个商品分散在多个库房」） =====
  const inventoryStore = useInventoryStore()
  await inventoryStore.ensureLocations()
  // 老数据/直接写总库存的商品先铺到默认库房，保证 总库存 = Σ各库位
  await inventoryStore.syncLocationStock()
  const locs = await inventoryStore.listLocations()
  const mainLoc = locs[0]?.id
  const secondLoc = locs[1]?.id
  if (mainLoc && secondLoc) {
    // 从主库房调一部分货到第二个库房，库存明细里就能看到分布
    await inventoryStore.transfer(mainLoc, secondLoc, {
      [byModel('KFR-35GW').id!]: 2,
      [byModel('XQB100').id!]: 1
    }, OPERATOR_ID)
  }

  // ===== 7. 员工账号（方便用各角色登录后查看各自菜单） =====
  // 登录号：13700000001~13700000004，密码统一 123456
  const staffSeeds = [
    { name: '采购小李', phone: '13700000001', password: '123456', role: 'purchaser' as const },
    { name: '销售小王', phone: '13700000002', password: '123456', role: 'sales' as const },
    { name: '财务小张', phone: '13700000003', password: '123456', role: 'finance' as const },
    { name: '库房老陈', phone: '13700000004', password: '123456', role: 'warehouse' as const }
  ]
  for (const s of staffSeeds) {
    const dup = await db.users.where('phone').equals(s.phone).first()
    if (!dup) {
      await db.users.add({ ...s, status: 'active', createdAt: new Date().toISOString() })
    }
  }

  return {
    ok: true,
    message: `示例数据已生成：${productSeeds.length} 个商品、${supplierSeeds.length} 个供应商、${customerSeeds.length} 个客户、3 张采购单、3 张销售单、1 张调拨单`
  }
}

/**
 * 清空全部业务数据（保留账号与库房定义），便于从干净状态开始录入真实数据。
 * 库房是基础资料（用户自行设定），清空业务数据时保留，避免用户重建。
 */
export async function clearBusinessData(): Promise<DemoResult> {
  await Promise.all([
    db.products.clear(),
    db.stock.clear(),
    db.purchaseOrders.clear(),
    db.purchaseOrderItems.clear(),
    db.saleOrders.clear(),
    db.saleOrderItems.clear(),
    db.stockRecords.clear(),
    db.payments.clear(),
    db.suppliers.clear(),
    db.customers.clear(),
    // 库存作业产生的数据
    db.locationStock.clear(),
    db.transferOrders.clear(),
    db.transferItems.clear(),
    db.stocktakes.clear(),
    db.stocktakeItems.clear(),
    db.returnOrders.clear(),
    db.returnItems.clear()
  ])
  return { ok: true, message: '业务数据已清空（账号与库房定义保留）' }
}
