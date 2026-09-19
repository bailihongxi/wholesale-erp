import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import type { Product } from '../src/types'

describe('阶段5：财务（应收应付 + 收付款 + 毛利）', () => {
  let sampleProduct: Product
  let saleOrderId: number

  beforeEach(async () => {
    setActivePinia(createPinia())
    const { db } = await import('../src/db')
    await db.delete()
    await db.open()

    // 准备商品+入库+销售出库
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    await productStore.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调',
      spec: '', unit: '台', purchasePrice: 1800,
      wholesalePrice: 2100, retailPrice: 2300,
      warnStock: 50, status: 'active', remark: '', extra: {}
    })
    const products = await productStore.search('')
    sampleProduct = products[0]

    const { usePurchaseStore } = await import('../src/stores/purchase')
    const purchaseStore = usePurchaseStore()
    const supplierId = await purchaseStore.createSupplier({
      name: '供应商A', contact: '', phone: '', address: '', paymentTerm: '', remark: ''
    })
    const po = await purchaseStore.createOrder({
      supplierId, purchaserId: 1,
      items: [{ product: sampleProduct, quantity: 100 }],
      remark: ''
    })
    await purchaseStore.inbound(po.orderId!, { [sampleProduct.id!]: 100 }, 1)

    const { useSalesStore } = await import('../src/stores/sales')
    const salesStore = useSalesStore()
    const customerId = await salesStore.createCustomer({
      name: '客户B', contact: '', phone: '', address: '',
      level: 'A', creditLimit: 50000, paymentTerm: '', status: 'active', remark: ''
    })
    const so = await salesStore.createOrder({
      customerId, salesId: 2,
      items: [{ product: sampleProduct, quantity: 10 }],
      remark: ''
    })
    saleOrderId = so.orderId!
    await salesStore.outbound(saleOrderId, { [sampleProduct.id!]: 10 }, 1)
  })

  it('销售单出库后自动产生应收', async () => {
    const { useFinanceStore } = await import('../src/stores/finance')
    const financeStore = useFinanceStore()
    const receivables = await financeStore.listReceivables()
    expect(receivables.length).toBe(1)
    expect(receivables[0].balance).toBe(21000)
  })

  it('登记收款后应收余额减少', async () => {
    const { useFinanceStore } = await import('../src/stores/finance')
    const financeStore = useFinanceStore()
    await financeStore.recordReceive({ orderId: saleOrderId, amount: 10000, operatorId: 3, remark: '' })
    const receivables = await financeStore.listReceivables()
    expect(receivables[0].balance).toBe(11000)
  })

  it('收齐款后销售单收款状态变为received', async () => {
    const { useFinanceStore } = await import('../src/stores/finance')
    const financeStore = useFinanceStore()
    await financeStore.recordReceive({ orderId: saleOrderId, amount: 21000, operatorId: 3, remark: '' })
    const { db } = await import('../src/db')
    const order = await db.saleOrders.get(saleOrderId)
    expect(order?.receiveStatus).toBe('received')
  })

  it('部分收款状态为partial', async () => {
    const { useFinanceStore } = await import('../src/stores/finance')
    const financeStore = useFinanceStore()
    await financeStore.recordReceive({ orderId: saleOrderId, amount: 5000, operatorId: 3, remark: '' })
    const { db } = await import('../src/db')
    const order = await db.saleOrders.get(saleOrderId)
    expect(order?.receiveStatus).toBe('partial')
  })

  it('采购单入库后自动产生应付', async () => {
    const { useFinanceStore } = await import('../src/stores/finance')
    const financeStore = useFinanceStore()
    const payables = await financeStore.listPayables()
    expect(payables.length).toBe(1)
    expect(payables[0].balance).toBe(180000)  // 100台 * 1800
  })

  it('登记付款后应付余额减少', async () => {
    const { useFinanceStore } = await import('../src/stores/finance')
    const financeStore = useFinanceStore()
    const payables = await financeStore.listPayables()
    const purchaseOrderId = payables[0].orderId
    await financeStore.recordPay({ orderId: purchaseOrderId, amount: 50000, operatorId: 3, remark: '' })
    const after = await financeStore.listPayables()
    expect(after[0].balance).toBe(130000)
  })

  it('毛利计算正确：销售收入 - 成本', async () => {
    const { useFinanceStore } = await import('../src/stores/finance')
    const financeStore = useFinanceStore()
    const summary = await financeStore.getProfitSummary()
    // 销售收入：10台 * 2100 = 21000
    // 销售成本：10台 * 1800 = 18000
    // 毛利 = 3000
    expect(summary.totalSales).toBe(21000)
    expect(summary.totalCost).toBe(18000)
    expect(summary.grossProfit).toBe(3000)
  })
})
