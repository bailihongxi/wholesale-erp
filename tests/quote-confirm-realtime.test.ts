/**
 * V2.1-2（B1 下）：销售「确认询价单」+ 实时回传；转单权限收紧为仅销售 / 管理。
 *
 * 闭环比喻：经销商在窗口买票（提交询价单）→ 售票员确认（confirmQuote，draft→sent）
 * → 结果实时回传到窗口（Realtime）→ 经销商看到「已确认」，转销售单由销售 / 管理发起。
 *
 * 本文件锁三件事：
 *   1. confirmQuote 的状态机与留痕（错的状态不能确认、确认要能审计）；
 *   2. 转销售单权限：仅销售 / 管理账户可转，经销商及其它内部角色均无此权限；
 *   3. Realtime 订阅的三条硬约束（能停、有兜底、云端才订阅）与后台发布脚本存在。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { useQuotesStore } from '../src/stores/quotes'
import { AUDIT_ACTIONS } from '../src/utils/audit'

const SRC = (rel: string): string => readFileSync(resolve(__dirname, '..', rel), 'utf8')

async function seedQuote(status: 'draft' | 'sent' | 'converted' | 'void', withItem = true) {
  const qs = useQuotesStore()
  const id = await db.quoteOrders.add({
    orderNo: `BJ-TEST-${Math.random().toString(36).slice(2, 8)}`,
    customerId: 9,
    customerName: '',
    quoteDate: new Date().toISOString(),
    status,
    totalAmount: 1000,
    remark: '',
    salesId: 1,
    kind: 'sale',
    createdAt: new Date().toISOString(),
  } as never) as number
  if (withItem) {
    await db.quoteOrderItems.add({ quoteOrderId: id, productId: 1, quantity: 1, price: 1000, subtotal: 1000 } as never)
  }
  return id
}

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map(t => t.clear()))
})

describe('确认询价单（confirmQuote）', () => {
  it('draft → sent，回填确认人与时间，并写审计', async () => {
    const qs = useQuotesStore()
    const id = await seedQuote('draft')
    const res = await qs.confirmQuote(id, 7)
    expect(res.ok).toBe(true)

    const q = await db.quoteOrders.get(id)
    expect(q!.status).toBe('sent')
    expect(q!.confirmedBy).toBe(7)
    expect(q!.confirmedAt).toBeTruthy()

    const logs = await db.auditLogs.toArray()
    const log = logs.find(l => l.action === AUDIT_ACTIONS.QUOTE_CONFIRM)
    expect(log).toBeTruthy()
    expect(log!.detail).toContain(q!.orderNo)
  })

  it('已经确认 / 已转单 / 已失效 / 没有明细的都不能再确认', async () => {
    const qs = useQuotesStore()
    const sent = await seedQuote('sent')
    expect((await qs.confirmQuote(sent, 7)).ok).toBe(false)

    const converted = await seedQuote('converted')
    expect((await qs.confirmQuote(converted, 7)).ok).toBe(false)

    const voided = await seedQuote('void')
    expect((await qs.confirmQuote(voided, 7)).ok).toBe(false)

    const empty = await seedQuote('draft', false)
    const r = await qs.confirmQuote(empty, 7)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('明细')

    expect((await qs.confirmQuote(999999, 7)).ok).toBe(false)
  })

  it('确认只改状态，不动明细与金额', async () => {
    const qs = useQuotesStore()
    const id = await seedQuote('draft')
    const before = await qs.getQuoteItems(id)
    await qs.confirmQuote(id, 7)
    const after = await qs.getQuoteItems(id)
    expect(after.length).toBe(before.length)
    expect(after[0].price).toBe(before[0].price)
    expect((await db.quoteOrders.get(id))!.totalAmount).toBe(1000)
  })
})

describe('转销售单的权限', () => {
  it('仅销售 / 管理账户可转；经销商彻底取消此权限（源码级）', () => {
    const src = SRC('src/views/sales/QuotesView.vue')
    expect(src).toContain('const canConvertQuote = computed(')
    const fn = src.slice(src.indexOf('const canConvertQuote'), src.indexOf('function partyName'))
    expect(fn).toContain('isSales')
    expect(fn).toContain('isBoss')
    // 经销商不再出现在转单闸门里（不再有「经销商满足某状态即可转」的逻辑）
    expect(fn).not.toContain('isDealer')
    expect(fn).not.toContain("q.status === 'sent'")
    // 转单按钮仍由这个开关控制，而不是旧的「非经销商即可」写法
    expect(src).toContain('v-if="canConvertQuote"')
  })

  it('销售侧有「确认询价单」入口（详情 + 列表行）', () => {
    const src = SRC('src/views/sales/QuotesView.vue')
    expect(src).toContain("quote.status === 'draft'")
    expect(src).toContain('handleConfirm')
    expect(src).toContain('confirmFromList')
    expect(src).toContain('确认询价单')
  })

  it('经销商看到的是流程语言：待确认 / 已确认，不是内部的「待报价」', () => {
    const src = SRC('src/views/sales/QuotesView.vue')
    const fn = src.slice(src.indexOf('function statusText'), src.indexOf('const canConvertQuote'))
    expect(fn).toContain("draft: '待确认'")
    expect(fn).toContain("sent: '已确认'")
  })
})

describe('实时回传（Realtime）', () => {
  it('订阅必须能被移除，且只在云端订阅（源码级）', () => {
    const src = SRC('src/composables/useQuoteRealtime.ts')
    expect(src).toContain('onUnmounted(stop)')
    expect(src).toContain('removeChannel')
    expect(src).toContain('USE_CLOUD')
    expect(src).toContain('onSubscribed')
  })

  it('报价单页只在经销商身份下订阅，自己的单才收得到', () => {
    const src = SRC('src/views/sales/QuotesView.vue')
    const block = src.slice(src.indexOf('useQuoteRealtime({'), src.indexOf('</script>'))
    expect(block).toContain('enabled: () => isDealer.value')
    expect(block).toContain('customerId: () => userStore.currentUser?.id')
  })

  it('后台发布脚本存在：加 publication + REPLICA IDENTITY FULL', () => {
    const p = resolve(__dirname, '..', 'supabase/migrate_v2.1-2_realtime_quote_orders.sql')
    expect(existsSync(p)).toBe(true)
    const sql = readFileSync(p, 'utf8')
    expect(sql.toLowerCase()).toContain('supabase_realtime')
    expect(sql.toLowerCase()).toContain('replica identity full')
  })
})

// ============================================================ 操作列间距

describe('报价单列表：查看 / 确认 必须拉开间距', () => {
  it('两个按钮包在 .op-cell 里，不再裸挨着', () => {
    const src = SRC('src/views/sales/QuotesView.vue')
    // 列表「操作」列（第一处 <td class="center">，即列表表格那一格）
    const start = src.indexOf('<td class="center">')
    const cell = src.slice(start, src.indexOf('</td>', start))
    expect(cell).toContain('<span class="op-cell">')
    // 同一格里两个按钮都在 span 内：查看（总是）+ 确认（仅销售 + 待报价）
    const open = cell.indexOf('<span class="op-cell">')
    const close = cell.indexOf('</span>', open)
    const inner = cell.slice(open, close)
    expect(inner).toContain('>查看</button>')
    expect(inner).toContain("confirmingId === o.id ? '确认中…' : '确认'")
  })

  it('间距口径只有一处：theme.css 的 .op-cell（16px）', () => {
    const css = SRC('src/styles/theme.css')
    expect(css).toContain('.op-cell {')
    const block = css.slice(css.indexOf('.op-cell {'))
    expect(block.slice(0, block.indexOf('}'))).toContain('gap: 16px')
    expect(block.slice(0, block.indexOf('}'))).toContain('inline-flex')
    // 各页不再重复定义，避免「改一处漏一处」
    for (const f of [
      'src/views/warehouse/InboundDetailView.vue',
      'src/views/warehouse/OutboundDetailView.vue',
      'src/views/warehouse/LocationsView.vue',
      'src/views/boss/UsersManageView.vue',
    ]) {
      expect(SRC(f)).not.toContain('.op-cell {')
    }
  })
})
