import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'

describe('阶段8：经销商端', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    const { db } = await import('../src/db')
    await db.delete()
    await db.open()

    // 准备商品
    const { useProductStore } = await import('../src/stores/product')
    const productStore = useProductStore()
    await productStore.createProduct({
      brand: '格力', model: 'KFR-35GW', category: '空调',
      spec: '1.5匹', unit: '台', purchasePrice: 1800,
      wholesalePrice: 2100, retailPrice: 2300,
      warnStock: 50, status: 'active', remark: '', extra: {}
    })
  })

  it('经销商用手机号密码登录成功', async () => {
    const { useSalesStore } = await import('../src/stores/sales')
    const salesStore = useSalesStore()
    await salesStore.createCustomer({
      name: 'XX家电卖场', contact: '李经理', phone: '13900000001',
      address: '', level: 'A', creditLimit: 50000, paymentTerm: '月结30天',
      loginPhone: '13900000001', loginPassword: 'dealer123',
      status: 'active', remark: ''
    })

    const { useUserStore } = await import('../src/stores/user')
    const userStore = useUserStore()
    const res = await userStore.login('13900000001', 'dealer123')
    expect(res.ok).toBe(true)
    expect(userStore.role).toBe('dealer')
  })

  it('经销商密码错误登录失败', async () => {
    const { useSalesStore } = await import('../src/stores/sales')
    const salesStore = useSalesStore()
    await salesStore.createCustomer({
      name: 'XX卖场', contact: '', phone: '13900000002',
      address: '', level: 'A', creditLimit: 50000, paymentTerm: '',
      loginPhone: '13900000002', loginPassword: '123456',
      status: 'active', remark: ''
    })
    const { useUserStore } = await import('../src/stores/user')
    const userStore = useUserStore()
    const res = await userStore.login('13900000002', 'wrong')
    expect(res.ok).toBe(false)
  })

  it('经销商产品目录只含批发价，不含进价', async () => {
    const { useDealerStore } = await import('../src/stores/dealer')
    const dealerStore = useDealerStore()
    const catalog = await dealerStore.listCatalog()
    expect(catalog.length).toBe(1)
    expect(catalog[0].wholesalePrice).toBe(2100)
    // 关键：经销商看不到进价
    expect('purchasePrice' in catalog[0]).toBe(false)
  })

  it('经销商搜索产品按品牌型号', async () => {
    const { useDealerStore } = await import('../src/stores/dealer')
    const dealerStore = useDealerStore()
    const results = await dealerStore.listCatalog('格力')
    expect(results.length).toBe(1)
    expect(results[0].model).toBe('KFR-35GW')
  })

  it('经销商被停用后登录失败', async () => {
    const { useSalesStore } = await import('../src/stores/sales')
    const salesStore = useSalesStore()
    const customerId = await salesStore.createCustomer({
      name: 'XX卖场', contact: '', phone: '13900000003',
      address: '', level: 'A', creditLimit: 50000, paymentTerm: '',
      loginPhone: '13900000003', loginPassword: '123',
      status: 'active', remark: ''
    })
    // 停用账号
    const { db } = await import('../src/db')
    await db.customers.update(customerId, { status: 'disabled' })

    const { useUserStore } = await import('../src/stores/user')
    const userStore = useUserStore()
    const res = await userStore.login('13900000003', '123')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('停用')
  })
})
