import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { useFinanceStore } from '../src/stores/finance'
import { LEDGER_LINK_TYPES, linkTypeLabel } from '../src/utils/ledger'
import { buildOrderPrintHTML } from '../src/utils/printTemplate'
import ChangePasswordModal from '../src/components/ChangePasswordModal.vue'
import PrintPreview from '../src/components/PrintPreview.vue'

/**
 * 第十九轮（V1.0-8）：
 * ① 打印模板头部两行改一行（公司抬头居左、单据标题居中）；
 * ② 「记一笔」支持关联单据（入库单 / 出库单 / 退换货单 / 采购单 / 销售单等）；
 * ③ 全部弹窗改为阻塞窗口——点遮罩不关闭，按 ESC 关闭。
 */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const sampleOrder = {
  orderNo: 'RK20260920-123',
  date: '2026-09-20',
  partyName: '某某供应商',
  partyLabel: '供应商',
  items: [
    { productName: '滚筒洗衣机', category: '洗衣机', model: 'XQG100', unit: '台', quantity: 2, price: 1800, subtotal: 3600 }
  ],
  totalQuantity: 2,
  totalAmount: 3600,
  title: '入库单'
}

describe('第十九轮①：打印模板头部一行排列', () => {
  it('头部包含单行容器 hd-row，公司抬头与单据标题在同一行内', () => {
    const html = buildOrderPrintHTML(sampleOrder, true)
    expect(html).toContain('hd-row')
    // hd-co（公司抬头）与 hd-title（单据标题）必须在同一 hd-row 内，先抬头后标题
    const rowStart = html.indexOf('class="hd-row"')
    const rowEnd = html.indexOf('</div>', rowStart)
    const rowHtml = html.slice(rowStart, rowEnd)
    expect(rowHtml).toContain('hd-co')
    expect(rowHtml).toContain('hd-title')
    expect(rowHtml.indexOf('hd-co')).toBeLessThan(rowHtml.indexOf('hd-title'))
  })

  it('公司抬头字号规则保留（hd-co 独立字号，不因改行而缩小）', () => {
    const html = buildOrderPrintHTML(sampleOrder, true)
    // 默认 A5：hd-co 字号 16px；A4 为 19px——两种纸张都必须保留独立字号声明
    expect(html).toMatch(/\.hd-co\s*\{[^}]*font-size:\s*(16|19)px/i)
  })

  it('布局用三列 grid：标题绝对居中，公司抬头居左', () => {
    const html = buildOrderPrintHTML(sampleOrder, true)
    expect(html).toContain('grid-template-columns: 1fr auto 1fr')
    expect(html).toContain('justify-self: start')
    expect(html).toContain('justify-self: center')
  })

  it('采购单 / 销售单同样生效（所有打印模板共用同一头部）', () => {
    const purchase = buildOrderPrintHTML({ ...sampleOrder, title: '采购单' }, true)
    const sale = buildOrderPrintHTML({ ...sampleOrder, title: '销售单（送货单）' }, true)
    expect(purchase).toContain('hd-row')
    expect(sale).toContain('hd-row')
    expect(purchase).toMatch(/hd-row[\s\S]*hd-co[\s\S]*hd-title/)
    expect(sale).toMatch(/hd-row[\s\S]*hd-co[\s\S]*hd-title/)
  })
})

describe('第十九轮②：记一笔关联单据', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
  })

  it('可关联入库单：类型 + 单号存储并原样返回', async () => {
    const store = useFinanceStore()
    const res = await store.addLedger({
      direction: 'out',
      category: 'delivery',
      amount: 80,
      operatorId: 1,
      entryDate: today(),
      linkDocType: 'inbound',
      linkDocNo: 'RK20260920-123'
    })
    expect(res.ok).toBe(true)
    const rows = await store.listLedger()
    expect(rows.length).toBe(1)
    expect(rows[0].linkDocType).toBe('inbound')
    expect(rows[0].linkDocNo).toBe('RK20260920-123')
  })

  it('不选关联单据时为空字符串，老数据不受影响', async () => {
    const store = useFinanceStore()
    await store.addLedger({ direction: 'out', category: 'express', amount: 5, operatorId: 1, entryDate: today() })
    const rows = await store.listLedger()
    expect(rows[0].linkDocType).toBe('')
    expect(rows[0].linkDocNo).toBe('')
  })

  it('关联类型覆盖入库 / 出库 / 退换货 / 采购 / 销售等单据', () => {
    const keys = LEDGER_LINK_TYPES.map(t => t.key)
    for (const k of ['inbound', 'outbound', 'return', 'purchase', 'sale', 'transfer', 'stocktake']) {
      expect(keys).toContain(k)
    }
    expect(linkTypeLabel('inbound')).toBe('入库单')
    expect(linkTypeLabel('outbound')).toBe('出库单')
    expect(linkTypeLabel('return')).toBe('退换货单')
    expect(linkTypeLabel('')).toBe('')
  })

  it('关联的单据号可删可不改：删除该笔后关联一并消失', async () => {
    const store = useFinanceStore()
    await store.addLedger({
      direction: 'out', category: 'logistics', amount: 120, operatorId: 1, entryDate: today(),
      linkDocType: 'sale', linkDocNo: 'XS20260920-001'
    })
    const rows = await store.listLedger()
    await store.deleteLedger(rows[0].id!, 1)
    expect((await store.listLedger()).length).toBe(0)
  })
})

describe('第十九轮③：弹窗阻塞 + ESC 关闭', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
  })

  it('修改密码弹窗：点击遮罩不会关闭（不再误触丢失输入）', async () => {
    const wrapper = mount(ChangePasswordModal, { props: { open: true } })
    await wrapper.find('.cp-mask').trigger('click')
    expect(wrapper.emitted('update:open')).toBeFalsy()
    wrapper.unmount()
  })

  it('修改密码弹窗：按 ESC 可关闭', async () => {
    const wrapper = mount(ChangePasswordModal, { props: { open: true } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:open')).toBeTruthy()
    expect(wrapper.emitted('update:open')![0]).toEqual([false])
    wrapper.unmount()
  })

  it('打印预览：点击遮罩不会关闭', async () => {
    const wrapper = mount(PrintPreview, {
      props: { visible: true, title: '单据', html: '<!DOCTYPE html><html><body>x</body></html>' }
    })
    await wrapper.find('.pp-mask').trigger('click')
    expect(wrapper.emitted('cancel')).toBeFalsy()
    wrapper.unmount()
  })

  it('打印预览：按 ESC 可取消', async () => {
    const wrapper = mount(PrintPreview, {
      props: { visible: true, title: '单据', html: '<!DOCTYPE html><html><body>x</body></html>' }
    })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toBeTruthy()
    wrapper.unmount()
  })

  it('弹窗关闭后 ESC 监听随组件卸载移除，不误关其它界面', async () => {
    const wrapper = mount(PrintPreview, {
      props: { visible: true, title: '单据', html: '<!DOCTYPE html><html><body>x</body></html>' }
    })
    wrapper.unmount()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    // 卸载后不再发出 cancel（监听已移除）
    expect(wrapper.emitted('cancel')).toBeFalsy()
  })
})
