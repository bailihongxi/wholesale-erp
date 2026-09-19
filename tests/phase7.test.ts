import { describe, it, expect } from 'vitest'
import { buildPurchaseOrderHTML, buildSaleOrderHTML } from '../src/utils/printTemplate'

const mockData = {
  orderNo: 'CG20260919-001',
  date: '2026-09-19',
  partyName: 'XX家电供应商',
  partyContact: '王老板',
  partyPhone: '138****',
  items: [
    { productName: '格力', model: 'KFR-35GW', unit: '台', quantity: 10, price: 1800, subtotal: 18000 }
  ],
  totalQuantity: 10,
  totalAmount: 18000,
  remark: ''
}

describe('阶段7：打印模板', () => {
  it('采购单带价格时包含单价和金额', () => {
    const html = buildPurchaseOrderHTML(mockData, true)
    expect(html).toContain('采购单')
    expect(html).toContain('CG20260919-001')
    expect(html).toContain('XX家电供应商')
    expect(html).toContain('单价')
    expect(html).toContain('金额')
    // 单据金额保留两位小数并带千分位
    expect(html).toContain('1,800.00')
    expect(html).toContain('18,000.00')
    // 合计直接落在表格底部合计行；独立的「数量/金额/大写」方框已按需求移除
    expect(html).toContain('class="total-label">合计')
    expect(html).toContain('¥18,000.00')
    expect(html).not.toContain('壹万捌仟')
  })

  it('采购单不带价格时不显示单价和金额列', () => {
    const html = buildPurchaseOrderHTML(mockData, false)
    expect(html).toContain('采购单')
    expect(html).toContain('CG20260919-001')
    expect(html).not.toContain('单价')
    expect(html).not.toContain('金额')
    expect(html).not.toContain('1,800.00')
    expect(html).not.toContain('18,000.00')
    expect(html).toContain('合计')
    expect(html).toContain('10')  // 总数量仍显示
  })

  it('销售单带价格时包含客户信息和签收栏', () => {
    const html = buildSaleOrderHTML({ ...mockData, partyName: 'XX家电卖场' }, true)
    expect(html).toContain('销售单')
    expect(html).toContain('送货单')
    expect(html).toContain('客户签收')
    expect(html).toContain('仓库发货')
    expect(html).toContain('单价')
  })

  it('销售单不带价格时隐藏价格但保留数量', () => {
    const html = buildSaleOrderHTML(mockData, false)
    expect(html).not.toContain('单价')
    expect(html).not.toContain('金额')
    expect(html).toContain('客户签收')
    expect(html).toContain('10')
  })

  it('打印单包含签字栏', () => {
    const html = buildPurchaseOrderHTML(mockData, true)
    expect(html).toContain('制单人')
    expect(html).toContain('供应商确认')
  })
})
