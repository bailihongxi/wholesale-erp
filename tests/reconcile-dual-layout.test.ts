/**
 * 应收应付对账页「电脑端表格 / 手机端卡片」范式（2026-09-25 老板拍板）。
 *
 * 之前这页两端都渲染大卡片：电脑端 ERP 看台账/对账天然习惯表格，卡片在宽屏上
 * 信息密度低、还把页面拉得很高，和采购单/销售单列表（电脑端 data-table + 手机端
 * card-list）不是一套范式。现在统一：
 *   - 电脑端：`<table class="data-table recon-table">`（单号/往来单位/日期/总额/已收付/余额/操作）
 *   - 手机端：`card-list zebra-list` 卡片，卡片外壳样式与其它列表页一致
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount, flushPromises } from '@vue/test-utils'

function memTable() {
  let rows: Array<Record<string, any>> = []
  return {
    async toArray() { return rows.slice() },
    async add(o: Record<string, any>) {
      const id = rows.length + 1
      rows.push({ ...o, id })
      return id
    },
    async bulkAdd(list: Array<Record<string, any>>) { for (const o of list) await this.add(o) },
    async bulkPut(list: Array<Record<string, any>>) { for (const o of list) await this.add(o) },
    async put(o: Record<string, any>) { return this.add(o) },
    async clear() { rows = [] },
    async get(id: number) { return rows.find(r => r.id === id) },
    async update(id: number, ch: Record<string, any>) {
      const r = rows.find(x => x.id === id)
      if (r) Object.assign(r, ch)
    },
    async delete(id: number) { rows = rows.filter(r => r.id !== id) },
    where() { return { equals: () => ({ toArray: async () => [] as Record<string, any>[], count: async () => 0 }) } },
    filter(fn: (r: any) => boolean) { return Promise.resolve(rows.filter(fn)) },
    count() { return Promise.resolve(rows.length) }
  }
}

vi.mock('../src/db', () => {
  const mk = () => memTable()
  const t: Record<string, any> = {
    saleOrders: mk(), purchaseOrders: mk(), payments: mk(),
    customers: mk(), suppliers: mk(), users: mk(), ledger: mk(), products: mk()
  }
  return { db: t, localDb: t, initDefaultAdmin: async () => {} }
})

vi.mock('vant', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return { ...actual, showToast: vi.fn(), showConfirmDialog: vi.fn(async () => {}) }
})

import { db as tables } from '../src/db'
import { setActivePinia, createPinia } from 'pinia'
import ReconcileView from '../src/views/finance/ReconcileView.vue'

function setWidth(w: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w })
}

const SFC = readFileSync(join(__dirname, '../src/views/finance/ReconcileView.vue'), 'utf8')
const template = SFC.slice(0, SFC.indexOf('<script'))

async function seedPayable(): Promise<void> {
  await tables.purchaseOrders.add({
    orderNo: 'CG20260922-602', supplierId: 1, totalAmount: 3260,
    payStatus: 'unpaid', status: 'confirmed', orderDate: '2026-09-22T00:00:00.000Z'
  })
  await tables.suppliers.add({ name: '测试供应商' })
}

/** 挂载后切到「应付」Tab（应收侧本就没有销售单） */
async function mountPayable() {
  const wrapper = mount(ReconcileView)
  for (let i = 0; i < 6; i++) await flushPromises()
  await wrapper.findAll('.ui-seg-item')[1].trigger('click')
  for (let i = 0; i < 6; i++) await flushPromises()
  return wrapper
}

describe('对账页 · 双端渲染范式', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    for (const t of Object.keys(tables)) await tables[t].clear()
    await seedPayable()
  })

  it('电脑端渲染表格，不再用卡片', async () => {
    setWidth(1280)
    const wrapper = await mountPayable()

    expect(wrapper.find('.recon-table').exists()).toBe(true)
    expect(wrapper.find('.recon-card').exists()).toBe(false)

    const header = wrapper.findAll('.recon-table thead th').map(th => th.text())
    expect(header).toEqual(['单号', '供应商', '日期', '总额', '已付', '余额', '操作'])

    const cells = wrapper.findAll('.recon-table tbody tr')[0].findAll('td').map(td => td.text())
    expect(cells[0]).toBe('CG20260922-602')
    expect(cells[1]).toBe('测试供应商')
    expect(cells[3]).toBe('¥3,260')
    expect(cells[4]).toBe('¥0')
    expect(cells[5]).toBe('¥3,260')
    expect(wrapper.findAll('.recon-table tbody tr')[0].text()).toContain('登记付款')

    wrapper.unmount()
  })

  it('手机端渲染卡片，不出现表格', async () => {
    setWidth(390)
    const wrapper = await mountPayable()

    expect(wrapper.find('.recon-card').exists()).toBe(true)
    expect(wrapper.find('.recon-table').exists()).toBe(false)

    const card = wrapper.find('.recon-card').text()
    expect(card).toContain('CG20260922-602')
    expect(card).toContain('测试供应商')
    expect(card).toContain('¥3,260')
    expect(card).toContain('登记付款')

    wrapper.unmount()
    setWidth(1280)
  })

  it('模板里卡片与表格按 isMobile 二选一，不会两端都渲染', () => {
    expect(template).toMatch(/<ul\s+v-if="isMobile"\s+class="card-list/)
    expect(template).toMatch(/<table\s+v-else\s+class="data-table recon-table">/)
  })

  it('手机卡片外壳样式与其它列表页一致（白底 / 12px 圆角 / 同款阴影）', () => {
    const css = SFC.slice(SFC.indexOf('<style'))
    const block = css.slice(css.indexOf('.recon-card'), css.indexOf('.rc-head'))
    expect(block).toContain('background: #fff')
    expect(block).toContain('border-radius: 12px')
    expect(block).toContain('box-shadow: 0 2px 10px rgba(26,54,93,0.06)')
  })
})
