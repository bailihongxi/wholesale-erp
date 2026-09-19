/**
 * 第十三轮：客户 / 供应商的「开票与对公账户信息」
 *
 * 覆盖三件事（用户反馈的正是这三点）：
 *  - 新增了开票抬头 / 税号 / 开票地址电话 / 开户银行 / 对公账号 六个字段
 *  - 编辑保存后能真正落库（不是写了但没存）
 *  - 再次编辑能原样回填（含备注，之前会被写死成空串而丢失）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import 'fake-indexeddb/auto'
import CustomersView from '../src/views/sales/CustomersView.vue'
import SuppliersView from '../src/views/purchase/SuppliersView.vue'
import { useSalesStore } from '../src/stores/sales'
import { usePurchaseStore } from '../src/stores/purchase'
import { db } from '../src/db'
import {
  INVOICE_FIELDS,
  emptyInvoice,
  hasInvoice,
  invoiceComplete,
  invoiceOf,
  invoiceSummary
} from '../src/utils/invoice'

const FULL_INVOICE = {
  invoiceTitle: '城南电器商行有限公司',
  taxNo: '92330106MA2AB1234X',
  invoiceAddress: '城南大道 88 号',
  invoicePhone: '0571-88881234',
  bankName: '农业银行城南支行',
  bankAccount: '1903 0104 0012 3456'
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map(t => t.clear()))
})

describe('开票资料工具方法', () => {
  it('六个字段：抬头、税号、开票地址电话、开户行、对公账号', () => {
    expect(INVOICE_FIELDS.map(f => f.key)).toEqual([
      'invoiceTitle', 'taxNo', 'invoiceAddress', 'invoicePhone', 'bankName', 'bankAccount'
    ])
  })

  it('空开票资料：hasInvoice / invoiceComplete 都为假', () => {
    const v = emptyInvoice()
    expect(hasInvoice(v)).toBe(false)
    expect(invoiceComplete(v)).toBe(false)
    expect(invoiceSummary(v)).toBe('')
  })

  it('只填一部分：已填但「不完整」（抬头 + 税号才算能开票）', () => {
    expect(hasInvoice({ invoiceTitle: '某公司' })).toBe(true)
    expect(invoiceComplete({ invoiceTitle: '某公司' })).toBe(false)
    expect(invoiceComplete({ invoiceTitle: '某公司', taxNo: '91330100MA2CD5678Y' })).toBe(true)
  })

  it('老数据没有开票字段也能安全读取（不报错、按空串回落）', () => {
    const old = { name: '老客户' } // 第十三轮之前录入的记录
    expect(() => invoiceOf(old as never)).not.toThrow()
    expect(hasInvoice(old as never)).toBe(false)
    expect(invoiceOf(old as never)).toEqual(emptyInvoice())
  })

  it('摘要行包含抬头 / 税号 / 开户行账号', () => {
    const s = invoiceSummary(FULL_INVOICE)
    expect(s).toContain('城南电器商行有限公司')
    expect(s).toContain('税号 92330106MA2AB1234X')
    expect(s).toContain('农业银行城南支行 1903 0104 0012 3456')
  })
})

describe('客户：开票资料能存、能回填', () => {
  beforeEach(async () => {
    await useSalesStore().createCustomer({
      name: '城南电器商行', contact: '陈老板', phone: '13800004444',
      address: '城南大道 88 号', level: 'A', creditLimit: 0,
      paymentTerm: '月结30天', status: 'active', remark: '老客户',
      ...FULL_INVOICE
    })
  })

  it('store 层六个字段都能原样落库', async () => {
    const [c] = await useSalesStore().listCustomers()
    expect(c.invoiceTitle).toBe(FULL_INVOICE.invoiceTitle)
    expect(c.taxNo).toBe(FULL_INVOICE.taxNo)
    expect(c.invoiceAddress).toBe(FULL_INVOICE.invoiceAddress)
    expect(c.invoicePhone).toBe(FULL_INVOICE.invoicePhone)
    expect(c.bankName).toBe(FULL_INVOICE.bankName)
    expect(c.bankAccount).toBe(FULL_INVOICE.bankAccount)
  })

  it('列表页按「开票抬头 / 税号」能搜到客户', async () => {
    const w = mount(CustomersView)
    await flushPromises()
    expect(w.text()).toContain('城南电器商行')

    const search = w.find('.tb-search input')
    expect(search.exists()).toBe(true)

    await search.setValue('92330106')
    await flushPromises()
    expect(w.text()).toContain('城南电器商行')

    await search.setValue('城南电器商行有限公司')
    await flushPromises()
    expect(w.text()).toContain('城南电器商行')

    await search.setValue('不存在的税号')
    await flushPromises()
    expect(w.text()).toContain('没有匹配的客户')
  })

  it('列表显示「开票资料完整」徽标', async () => {
    const w = mount(CustomersView)
    await flushPromises()
    expect(w.find('.inv-badge').exists()).toBe(true)
    expect(w.find('.inv-badge').text()).toBe('完整')
    expect(w.find('.inv-badge').classes()).toContain('ok')
  })

  it('编辑：备注与开票资料都能回填，保存后不被清空', async () => {
    const w = mount(CustomersView)
    await flushPromises()

    // 打开编辑
    await w.findAll('.link-btn')[0].trigger('click')
    await flushPromises()

    const inputs = w.findAll('.inv-grid input[type="text"]')
    expect(inputs.length).toBe(6)
    expect((inputs[0].element as HTMLInputElement).value).toBe(FULL_INVOICE.invoiceTitle)
    expect((inputs[1].element as HTMLInputElement).value).toBe(FULL_INVOICE.taxNo)
    expect((inputs[4].element as HTMLInputElement).value).toBe(FULL_INVOICE.bankName)
    expect((inputs[5].element as HTMLInputElement).value).toBe(FULL_INVOICE.bankAccount)

    // 备注也回填了（这是之前被写死成空串丢掉的字段）
    const remark = w.find('textarea.f-area')
    expect((remark.element as HTMLTextAreaElement).value).toBe('老客户')

    // 改一个开票字段再保存
    await inputs[1].setValue('92330106MA2NEW9999')
    await remark.setValue('每月 20 号统一开票')
    await flushPromises()
    await w.find('.save').trigger('click')
    await flushPromises()

    const [c] = await useSalesStore().listCustomers()
    expect(c.taxNo).toBe('92330106MA2NEW9999')
    expect(c.remark).toBe('每月 20 号统一开票')
    expect(c.invoiceTitle).toBe(FULL_INVOICE.invoiceTitle)
    expect(c.bankAccount).toBe(FULL_INVOICE.bankAccount)
  })

  it('新增客户时也能填开票资料', async () => {
    const w = mount(CustomersView)
    await flushPromises()
    await w.find('.add-btn').trigger('click')
    await flushPromises()

    const inputs = w.findAll('.inv-grid input[type="text"]')
    expect(inputs.length).toBe(6)
    expect((inputs[0].element as HTMLInputElement).value).toBe('')

    await inputs[0].setValue('新客户公司')
    await inputs[1].setValue('91330100MA2NEW0001')
    await inputs[4].setValue('中国银行')
    await inputs[5].setValue('1234 5678 9012')
    await w.find('.form-grid input').setValue('新客户')
    await flushPromises()
    await w.find('.save').trigger('click')
    await flushPromises()

    const saved = (await useSalesStore().listCustomers()).find(c => c.name === '新客户')
    expect(saved?.invoiceTitle).toBe('新客户公司')
    expect(saved?.taxNo).toBe('91330100MA2NEW0001')
    expect(saved?.bankName).toBe('中国银行')
    expect(saved?.bankAccount).toBe('1234 5678 9012')
  })
})

describe('供应商：开票资料能存、能回填', () => {
  beforeEach(async () => {
    await usePurchaseStore().createSupplier({
      name: '海尔华南总代', contact: '张经理', phone: '13900001111',
      address: '广州市天河区', paymentTerm: '月结30天',
      remark: '空调、洗衣机主力供应商', ...FULL_INVOICE
    })
  })

  it('store 层六个字段都能原样落库', async () => {
    const [s] = await usePurchaseStore().listSuppliers()
    expect(s.invoiceTitle).toBe(FULL_INVOICE.invoiceTitle)
    expect(s.taxNo).toBe(FULL_INVOICE.taxNo)
    expect(s.bankName).toBe(FULL_INVOICE.bankName)
    expect(s.bankAccount).toBe(FULL_INVOICE.bankAccount)
  })

  it('列表显示开票摘要与「完整」徽标', async () => {
    const w = mount(SuppliersView)
    await flushPromises()
    expect(w.find('.inv-badge').text()).toBe('开票资料完整')
    expect(w.find('.i-inv').text()).toContain('城南电器商行有限公司')
    expect(w.find('.i-inv').text()).toContain('税号')
  })

  it('编辑：备注与开票资料回填且保存后不清空', async () => {
    const w = mount(SuppliersView)
    await flushPromises()
    await w.find('.item').trigger('click')
    await flushPromises()

    const inputs = w.findAll('.inv-grid input[type="text"]')
    expect(inputs.length).toBe(6)
    expect((inputs[0].element as HTMLInputElement).value).toBe(FULL_INVOICE.invoiceTitle)
    expect((inputs[3].element as HTMLInputElement).value).toBe(FULL_INVOICE.invoicePhone)
    expect((w.find('textarea.f-area').element as HTMLTextAreaElement).value).toBe('空调、洗衣机主力供应商')

    await inputs[2].setValue('广州市天河区天河路 208 号')
    await flushPromises()
    await w.find('.save').trigger('click')
    await flushPromises()

    const [s] = await usePurchaseStore().listSuppliers()
    expect(s.invoiceAddress).toBe('广州市天河区天河路 208 号')
    expect(s.remark).toBe('空调、洗衣机主力供应商')
    expect(s.invoiceTitle).toBe(FULL_INVOICE.invoiceTitle)
  })

  it('按开票抬头 / 税号可搜索供应商', async () => {
    const w = mount(SuppliersView)
    await flushPromises()
    const search = w.find('.tb-search input')
    await search.setValue('92330106')
    await flushPromises()
    expect(w.text()).toContain('海尔华南总代')

    await search.setValue('查无此公司')
    await flushPromises()
    expect(w.text()).toContain('没有匹配的供应商')
  })
})

describe('示例数据已带开票资料', () => {
  it('生成的客户 / 供应商都有完整的开票与打款资料', async () => {
    const { seedDemoData } = await import('../src/utils/demoData')
    await seedDemoData()
    const customers = await useSalesStore().listCustomers()
    const suppliers = await usePurchaseStore().listSuppliers()
    expect(customers.length).toBeGreaterThan(0)
    expect(suppliers.length).toBeGreaterThan(0)
    for (const c of customers) expect(invoiceComplete(c)).toBe(true)
    for (const s of suppliers) expect(invoiceComplete(s)).toBe(true)
  })
})
