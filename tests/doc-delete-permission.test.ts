import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../src/db'
import { useUserStore } from '../src/stores/user'
import { usePermission } from '../src/composables/usePermission'
import { useSalesStore } from '../src/stores/sales'
import { usePurchaseStore } from '../src/stores/purchase'
import { AUDIT_ACTIONS } from '../src/utils/audit'

/**
 * 单据删除权限（V2.0-28）：
 * 只有「老板」与系统内置管理员（hawsystem，工号 E000）能删单据，
 * 采购 / 销售 / 财务 / 库房 / 经销商一律没有删除权。
 * 能编辑的单据都要有删除入口：销售单、采购单、报价单、预采询价、出入库单。
 */
describe('单据删除权限：仅老板与系统管理员', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
  })

  function loginAs(role: string, system = false): void {
    const u = useUserStore()
    u.currentUser = {
      id: 1, name: 'tester', phone: '13000000000', password: '',
      role: role as any, status: 'active', createdAt: '', system
    }
  }

  it('老板与系统管理员有删除权，其余角色一律没有', () => {
    // 老板（工号 E001 / 登录名 admin）
    loginAs('boss')
    expect(usePermission().canDeleteDoc.value).toBe(true)

    // 系统内置管理员（hawsystem，工号 E000）：role 也是 boss，另有 system 标记
    loginAs('boss', true)
    expect(usePermission().canDeleteDoc.value).toBe(true)

    // 即便角色不是 boss，只要带 system 标记（内置管理员）也保留删除权
    loginAs('sales', true)
    expect(usePermission().canDeleteDoc.value).toBe(true)

    for (const role of ['purchaser', 'sales', 'finance', 'warehouse', 'dealer']) {
      loginAs(role)
      expect(usePermission().canDeleteDoc.value, `${role} 不该有删除权`).toBe(false)
    }
  })

  it('未登录时不给删除权', () => {
    const u = useUserStore()
    u.currentUser = null
    expect(usePermission().canDeleteDoc.value).toBe(false)
  })
})

describe('销售单删除：只删待出库，且干净带走明细', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
  })

  async function seedSale(status: 'pending' | 'partial' | 'completed'): Promise<number> {
    const id = await db.saleOrders.add({
      orderNo: 'XS-DEL-TEST', customerId: 1, salesId: 1,
      orderDate: '2026-09-23', status, totalAmount: 100,
      receiveStatus: 'unreceived', remark: ''
    })
    await db.saleOrderItems.add({ saleOrderId: id, productId: 1, quantity: 2, price: 50, subtotal: 100 })
    return id
  }

  it('待出库的单可以删除，主表与明细一起清掉', async () => {
    const id = await seedSale('pending')
    const res = await useSalesStore().removeOrder(id, 1)

    expect(res.ok).toBe(true)
    expect(await db.saleOrders.get(id)).toBeUndefined()
    expect(await db.saleOrderItems.where('saleOrderId').equals(id).toArray()).toHaveLength(0)
  })

  it('已出库 / 部分出库的单拒绝删除（库存已动过，必须先撤回）', async () => {
    for (const status of ['partial', 'completed'] as const) {
      const id = await seedSale(status)
      const res = await useSalesStore().removeOrder(id, 1)

      expect(res.ok, `${status} 不该允许删除`).toBe(false)
      expect(res.message).toContain('已出库')
      // 单据必须还在，不能被误删
      expect(await db.saleOrders.get(id)).toBeDefined()
    }
  })

  it('删除会写审计日志，可追溯是谁删的', async () => {
    const id = await seedSale('pending')
    await useSalesStore().removeOrder(id, 7)

    const logs = (await db.auditLogs.toArray())
      .filter(l => l.action === AUDIT_ACTIONS.SALE_DELETE)
    expect(logs).toHaveLength(1)
    expect(logs[0].detail).toContain('XS-DEL-TEST')
    expect(logs[0].operatorId).toBe(7)
  })

  it('删除不存在的单不会误报成功', async () => {
    const res = await useSalesStore().removeOrder(99999, 1)
    expect(res.ok).toBe(false)
    expect(res.message).toContain('不存在')
  })
})

describe('采购单删除：只删待入库', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
  })

  async function seedPurchase(status: 'pending' | 'partial' | 'completed'): Promise<number> {
    const id = await db.purchaseOrders.add({
      orderNo: 'CG-DEL-TEST', supplierId: 1, purchaserId: 1,
      orderDate: '2026-09-23', status, totalAmount: 200,
      payStatus: 'unpaid', remark: ''
    })
    await db.purchaseOrderItems.add({ purchaseOrderId: id, productId: 1, quantity: 4, price: 50, subtotal: 200 })
    return id
  }

  it('待入库的单可以删除，主表与明细一起清掉', async () => {
    const id = await seedPurchase('pending')
    const res = await usePurchaseStore().removeOrder(id, 1)

    expect(res.ok).toBe(true)
    expect(await db.purchaseOrders.get(id)).toBeUndefined()
    expect(await db.purchaseOrderItems.where('purchaseOrderId').equals(id).toArray()).toHaveLength(0)
  })

  it('已入库 / 部分入库的单拒绝删除', async () => {
    for (const status of ['partial', 'completed'] as const) {
      const id = await seedPurchase(status)
      const res = await usePurchaseStore().removeOrder(id, 1)

      expect(res.ok, `${status} 不该允许删除`).toBe(false)
      expect(res.message).toContain('已入库')
      expect(await db.purchaseOrders.get(id)).toBeDefined()
    }
  })

  it('删除会写审计日志', async () => {
    const id = await seedPurchase('pending')
    await usePurchaseStore().removeOrder(id, 3)

    const logs = (await db.auditLogs.toArray())
      .filter(l => l.action === AUDIT_ACTIONS.PURCHASE_DELETE)
    expect(logs).toHaveLength(1)
    expect(logs[0].detail).toContain('CG-DEL-TEST')
  })
})

describe('五类可编辑单据都接上了删除入口，且带权限闸', () => {
  function src(rel: string): string {
    return readFileSync(resolve(__dirname, '..', rel), 'utf-8')
  }

  const targets: Array<{ file: string; label: string }> = [
    { file: 'src/views/sales/SaleOrderDetailView.vue', label: '销售单' },
    { file: 'src/views/purchase/PurchaseOrderDetailView.vue', label: '采购单' },
    { file: 'src/views/sales/QuotesView.vue', label: '报价单' },
    { file: 'src/views/purchase/PurchaseQuotesView.vue', label: '预采询价' },
    { file: 'src/views/warehouse/StockDocDetailView.vue', label: '出入库单' }
  ]

  it('每页都有删除按钮，且都挂在 canDeleteDoc 权限闸上', () => {
    for (const { file, label } of targets) {
      const s = src(file)
      expect(s, `${label} 未引入 canDeleteDoc`).toContain('canDeleteDoc')
      // 删除按钮必须与权限闸同在一个 v-if 里，不能出现裸奔的删除按钮
      expect(s, `${label} 的删除按钮缺少权限闸`).toMatch(/v-if="canDeleteDoc[^"]*"/)
      expect(s, `${label} 缺少删除处理函数`).toContain('handleRemove')
    }
  })

  it('销售单 / 采购单的删除还限定在待出(入)库状态', () => {
    expect(src('src/views/sales/SaleOrderDetailView.vue'))
      .toMatch(/v-if="canDeleteDoc && order\?\.status === 'pending'"/)
    expect(src('src/views/purchase/PurchaseOrderDetailView.vue'))
      .toMatch(/v-if="canDeleteDoc && order\?\.status === 'pending'"/)
  })

  it('审计动作常量齐备', () => {
    expect(AUDIT_ACTIONS.SALE_DELETE).toBe('删除销售单')
    expect(AUDIT_ACTIONS.PURCHASE_DELETE).toBe('删除采购单')
    expect(AUDIT_ACTIONS.STOCK_DOC_DELETE).toBe('删除出入库单')
  })
})
