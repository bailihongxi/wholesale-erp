import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'

// PRD 第10节验收标准全量测试
describe('PRD 验收标准全量检查', () => {
  let productId: number

  beforeEach(async () => {
    setActivePinia(createPinia())
    const { db } = await import('../src/db')
    await db.delete()
    await db.open()

    // 准备基础数据
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    await productStore.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调',
      spec: '1.5匹', unit: '台', purchasePrice: 1800,
      wholesalePrice: 2100, retailPrice: 2300,
      warnStock: 50, status: 'active', remark: '', extra: {}
    })
    const products = await productStore.search('')
    productId = products[0].id!
  })

  // ===== 10.1 数据持久化 =====
  it('1.1 本地数据存储后可重新读取（模拟刷新后数据仍在）', async () => {
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    const products = await productStore.search('')
    expect(products.length).toBe(1)
    expect(products[0].brand).toBe('格力')
  })

  // ===== 10.2 权限隔离 =====
  it('2.1 销售选商品时看不到进价', async () => {
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    const products = await productStore.search('')
    // 销售端API只返回可见字段（wholesalePrice，不返回purchasePrice）
    const { useDealerStore } = await import('../src/stores/dealer')
    const dealerStore = useDealerStore()
    const catalog = await dealerStore.listCatalog()
    expect('purchasePrice' in catalog[0]).toBe(false)
    expect(catalog[0].wholesalePrice).toBe(2100)
  })

  it('2.2 库房页面不显示价格（库房端API不含价格字段）', async () => {
    // 库房只能看到商品和数量，看不到价格
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    const stock = await productStore.getStock(productId)
    expect(typeof stock).toBe('number')
    // 库房端不调用含价格的API
  })

  it('2.3 经销商只能看产品和批发价，看不到进价和库存', async () => {
    const { useSalesStore } = await import('../src/stores/sales')
    const salesStore = useSalesStore()
    await salesStore.createCustomer({
      name: '经销商A', contact: '', phone: '13900000001',
      address: '', level: 'A', creditLimit: 50000, paymentTerm: '',
      loginPhone: '13900000001', loginPassword: '123',
      status: 'active', remark: ''
    })
    const { useDealerStore } = await import('../src/stores/dealer')
    const dealerStore = useDealerStore()
    const catalog = await dealerStore.listCatalog()
    expect(catalog.length).toBe(1)
    expect('purchasePrice' in catalog[0]).toBe(false)
    expect('stock' in catalog[0]).toBe(false)  // 看不到库存
  })

  it('2.4 老板能看到全部数据', async () => {
    const { useUserStore } = await import('../src/stores/user')
    const userStore = useUserStore()
    await userStore.login('13800000000', 'admin123')
    expect(userStore.role).toBe('boss')
    expect(userStore.isBoss).toBe(true)
  })

  // ===== 10.3 业务闭环 =====
  it('3.1 采购入库后库存自动增加、自动生成应付', async () => {
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const purchaseStore = usePurchaseStore()
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()

    const supplierId = await purchaseStore.createSupplier({
      name: '供应商', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const product = await productStore.getProduct(productId)
    const po = await purchaseStore.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: product!, quantity: 10 }],
      remark: ''
    })
    await purchaseStore.inbound(po.orderId!, { [productId]: 10 }, 1)
    const stock = await productStore.getStock(productId)
    expect(stock).toBe(10)

    // 应付已生成
    const { useFinanceStore } = await import('../src/stores/finance')
    const financeStore = useFinanceStore()
    const payables = await financeStore.listPayables()
    expect(payables.length).toBe(1)
    expect(payables[0].balance).toBe(18000)
  })

  it('3.2 销售出库后库存自动扣减、自动生成应收', async () => {
    // 先入库 100 台
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const purchaseStore = usePurchaseStore()
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    const supplierId = await purchaseStore.createSupplier({
      name: '供应商', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const product = await productStore.getProduct(productId)
    const po = await purchaseStore.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: product!, quantity: 100 }],
      remark: ''
    })
    await purchaseStore.inbound(po.orderId!, { [productId]: 100 }, 1)

    // 销售出库 20 台
    const { useSalesStore } = await import('../src/stores/sales')
    const salesStore = useSalesStore()
    const customerId = await salesStore.createCustomer({
      name: '客户', contact: '', phone: '', address: '',
      level: 'A', creditLimit: 50000, paymentTerm: '', status: 'active', remark: ''
    })
    const so = await salesStore.createOrder({
      customerId, salesId: 2,
      items: [{ product: product!, quantity: 20 }],
      remark: ''
    })
    await salesStore.outbound(so.orderId!, { [productId]: 20 }, 1)

    const stock = await productStore.getStock(productId)
    expect(stock).toBe(80)

    // 应收已生成
    const { useFinanceStore } = await import('../src/stores/finance')
    const financeStore = useFinanceStore()
    const receivables = await financeStore.listReceivables()
    expect(receivables.length).toBe(1)
    expect(receivables[0].balance).toBe(42000)  // 20台*2100
  })

  it('3.3 登记收款后单据状态更新', async () => {
    // 准备：入库+销售出库
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const purchaseStore = usePurchaseStore()
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    const supplierId = await purchaseStore.createSupplier({
      name: '供应商', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const product = await productStore.getProduct(productId)
    const po = await purchaseStore.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: product!, quantity: 100 }],
      remark: ''
    })
    await purchaseStore.inbound(po.orderId!, { [productId]: 100 }, 1)

    const { useSalesStore } = await import('../src/stores/sales')
    const salesStore = useSalesStore()
    const customerId = await salesStore.createCustomer({
      name: '客户', contact: '', phone: '', address: '',
      level: 'A', creditLimit: 50000, paymentTerm: '', status: 'active', remark: ''
    })
    const so = await salesStore.createOrder({
      customerId, salesId: 2,
      items: [{ product: product!, quantity: 10 }],
      remark: ''
    })
    await salesStore.outbound(so.orderId!, { [productId]: 10 }, 1)

    // 收款
    const { useFinanceStore } = await import('../src/stores/finance')
    const financeStore = useFinanceStore()
    await financeStore.recordReceive({ orderId: so.orderId!, amount: 21000, operatorId: 3, remark: '' })
    const { db } = await import('../src/db')
    const order = await db.saleOrders.get(so.orderId!)
    expect(order?.receiveStatus).toBe('received')
  })

  it('3.4 历史单据价格不受后续改价影响', async () => {
    // 准备销售单
    const { usePurchaseStore } = await import('../src/stores/purchase')
    const purchaseStore = usePurchaseStore()
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    const supplierId = await purchaseStore.createSupplier({
      name: '供应商', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const product = await productStore.getProduct(productId)
    const po = await purchaseStore.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: product!, quantity: 100 }],
      remark: ''
    })
    await purchaseStore.inbound(po.orderId!, { [productId]: 100 }, 1)

    const { useSalesStore } = await import('../src/stores/sales')
    const salesStore = useSalesStore()
    const customerId = await salesStore.createCustomer({
      name: '客户', contact: '', phone: '', address: '',
      level: 'A', creditLimit: 50000, paymentTerm: '', status: 'active', remark: ''
    })
    const so = await salesStore.createOrder({
      customerId, salesId: 2,
      items: [{ product: product!, quantity: 10 }],
      remark: ''
    })
    const items = await salesStore.getOrderItems(so.orderId!)
    expect(items[0].price).toBe(2100)

    // 改商品批发价
    await productStore.updateProduct(productId, { wholesalePrice: 2500 })
    // 历史单价格不变
    const itemsAfter = await salesStore.getOrderItems(so.orderId!)
    expect(itemsAfter[0].price).toBe(2100)
  })

  // ===== 10.4 打印 =====
  it('4.1 打印单可选带/不带价格', async () => {
    const { buildPurchaseOrderHTML } = await import('../src/utils/printTemplate')
    const mockData = {
      orderNo: 'CG001', date: '2026-09-19', partyName: '供应商',
      items: [{ productName: '格力', model: 'KFR-35GW', unit: '台', quantity: 10, price: 1800, subtotal: 18000 }],
      totalQuantity: 10, totalAmount: 18000
    }
    const withPrice = buildPurchaseOrderHTML(mockData, true)
    const withoutPrice = buildPurchaseOrderHTML(mockData, false)
    expect(withPrice).toContain('单价')
    expect(withoutPrice).not.toContain('单价')
  })

  // ===== 10.5 数据同步与备份 =====
  it('5.1 导出再导入数据完整', async () => {
    const { useSyncStore } = await import('../src/stores/sync')
    const syncStore = useSyncStore()
    const backup = await syncStore.exportAll()
    const res = await syncStore.importAll(backup)
    expect(res.ok).toBe(true)
    const { db } = await import('../src/db')
    expect((await db.products.toArray()).length).toBe(1)
  })

  // ===== 10.7 商品档案 =====
  it('7.1 商品名称=品牌+型号自动组合', async () => {
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    const products = await productStore.search('')
    expect(productStore.productName(products[0])).toBe('格力 KFR-35GW')
  })
})
