import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../src/db'
import { useFinanceStore } from '../src/stores/finance'
import { LEDGER_CATEGORIES, categoriesOf } from '../src/utils/ledger'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 「记一笔」：送货费、物流费、快递费、安装费、辅材费等
 * 无法用采购单 / 销售单结算的费用，单独记录收支。
 */
describe('记一笔（其他收支流水）', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
  })

  it('费用分类齐全：送货/物流/快递/安装/辅材/其他都在，且区分收支方向', () => {
    const out = categoriesOf('out').map(c => c.label)
    for (const label of ['送货费用', '物流费用', '快递费用', '安装费用', '辅材费用', '其他费用']) {
      expect(out).toContain(label)
    }
    const inn = categoriesOf('in').map(c => c.label)
    expect(inn.length).toBeGreaterThan(0)
    // 每个分类都必须带方向，否则汇总会算错
    for (const c of LEDGER_CATEGORIES) expect(['in', 'out']).toContain(c.direction)
  })

  it('记一笔支出后可查到，金额与分类正确', async () => {
    const store = useFinanceStore()
    const res = await store.addLedger({
      direction: 'out',
      category: 'delivery',
      amount: 120,
      counterparty: '顺风车队',
      entryDate: today(),
      operatorId: 1,
      remark: '送到城南客户'
    })
    expect(res.ok).toBe(true)
    expect(res.orderNo).toBeTruthy()

    const rows = await store.listLedger()
    expect(rows.length).toBe(1)
    expect(rows[0].direction).toBe('out')
    expect(rows[0].category).toBe('delivery')
    expect(rows[0].amount).toBe(120)
    expect(rows[0].counterparty).toBe('顺风车队')
  })

  it('金额必须大于 0，且必须选分类', async () => {
    const store = useFinanceStore()

    const bad1 = await store.addLedger({
      direction: 'out', category: 'express', amount: 0, operatorId: 1, entryDate: today()
    })
    expect(bad1.ok).toBe(false)
    expect(bad1.message).toContain('大于 0')

    const bad2 = await store.addLedger({
      direction: 'out', category: '', amount: 50, operatorId: 1, entryDate: today()
    })
    expect(bad2.ok).toBe(false)
    expect(bad2.message).toContain('分类')

    expect((await store.listLedger()).length).toBe(0)
  })

  it('汇总能正确算出收入 / 支出 / 净额', async () => {
    const store = useFinanceStore()
    await store.addLedger({ direction: 'out', category: 'delivery', amount: 200, operatorId: 1, entryDate: today() })
    await store.addLedger({ direction: 'out', category: 'install', amount: 300, operatorId: 1, entryDate: today() })
    await store.addLedger({ direction: 'in', category: 'service', amount: 150, operatorId: 1, entryDate: today() })

    const s = await store.ledgerSummary()
    expect(s.expense).toBe(500)
    expect(s.income).toBe(150)
    expect(s.net).toBe(-350)
    expect(s.byCategory.length).toBe(3)
  })

  it('可按方向 / 分类筛选流水', async () => {
    const store = useFinanceStore()
    await store.addLedger({ direction: 'out', category: 'express', amount: 20, operatorId: 1, entryDate: today() })
    await store.addLedger({ direction: 'in', category: 'rebate', amount: 80, operatorId: 1, entryDate: today() })

    expect((await store.listLedger({ direction: 'out' })).length).toBe(1)
    expect((await store.listLedger({ direction: 'in' })).length).toBe(1)
    expect((await store.listLedger({ category: 'express' })).length).toBe(1)
    expect((await store.listLedger({ category: 'rebate' }))[0].amount).toBe(80)
  })

  it('日期区间筛选只保留区间内的记录', async () => {
    const store = useFinanceStore()
    await store.addLedger({ direction: 'out', category: 'other_out', amount: 10, operatorId: 1, entryDate: '2026-01-05' })
    await store.addLedger({ direction: 'out', category: 'other_out', amount: 20, operatorId: 1, entryDate: '2026-03-05' })

    const jan = await store.listLedger({ from: '2026-01-01', to: '2026-01-31' })
    expect(jan.length).toBe(1)
    expect(jan[0].amount).toBe(10)
  })

  it('记错了可以删除，删除后不再出现在流水里', async () => {
    const store = useFinanceStore()
    await store.addLedger({ direction: 'out', category: 'material', amount: 66, operatorId: 1, entryDate: today() })
    const rows = await store.listLedger()
    expect(rows.length).toBe(1)

    const del = await store.deleteLedger(rows[0].id!, 1)
    expect(del.ok).toBe(true)
    expect((await store.listLedger()).length).toBe(0)

    const again = await store.deleteLedger(rows[0].id!, 1)
    expect(again.ok).toBe(false)
  })

  it('记一笔不产生应收应付：与采购/销售结算互不干扰', async () => {
    const store = useFinanceStore()
    await store.addLedger({ direction: 'out', category: 'logistics', amount: 500, operatorId: 1, entryDate: today() })

    const [rec, pay] = await Promise.all([store.listReceivables(), store.listPayables()])
    expect(rec.length).toBe(0)
    expect(pay.length).toBe(0)
    // 记一笔独立于 payments 表
    expect((await db.payments.toArray()).length).toBe(0)
    expect((await db.ledgerEntries.toArray()).length).toBe(1)
  })
})
