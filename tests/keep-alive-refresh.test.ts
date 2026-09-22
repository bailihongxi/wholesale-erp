/**
 * 回归锁：新建/修改单据后回到列表页，列表必须自动刷新（V2.0-27）。
 *
 * ## 背景
 *
 * `App.vue` 用 `<keep-alive>` 无差别缓存所有路由组件。列表页进新建页 → 提交 →
 * 跳回列表时，组件是「复活（activated）」而不是「重新挂载（mounted）」，
 * `onMounted` 里的加载不会再跑，于是列表一直是旧数据 —— 表现为
 * 「新建的采购单不出现，必须整页刷新、再等好几秒才出来」。
 *
 * 修法是 `src/composables/useReloadOnActivate.ts`：回到本页时重拉一次。
 * 本文件同时验证「真的会在往返时刷新」与「首次挂载不会重复拉」。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref, onMounted, KeepAlive, nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { useReloadOnActivate } from '../src/composables/useReloadOnActivate'

const ROOT = process.cwd()

/** 造一个「列表页」组件：onMounted 拉一次，并挂上回到本页自动刷新 */
function makeListView(onLoad: () => void, name = 'ListView') {
  return defineComponent({
    name,
    setup() {
      onMounted(onLoad)
      useReloadOnActivate(onLoad)
      return () => h('div', 'list')
    },
  })
}

/** 造一个「别的页面」组件，用来从列表页切走 */
function makeOtherView(name = 'OtherView') {
  return defineComponent({ name, setup: () => () => h('div', 'other') })
}

describe('useReloadOnActivate：keep-alive 下回到本页要刷新', () => {
  it('首次挂载只拉一次（不被 onActivated 重复触发）', () => {
    let n = 0
    const ListView = makeListView(() => { n += 1 })
    mount(h(KeepAlive, null, { default: () => h(ListView) }))
    expect(n).toBe(1)
  })

  it('切走再切回，会重新拉一次（这是本轮要修的核心行为）', async () => {
    let n = 0
    const ListView = makeListView(() => { n += 1 })
    const OtherView = makeOtherView()

    const showList = ref(true)
    mount(
      defineComponent({
        setup: () => () =>
          h(KeepAlive, null, {
            default: () => h(showList.value ? ListView : OtherView),
          }),
      }),
    )
    await nextTick()
    expect(n).toBe(1) // 首次挂载

    showList.value = false // 切到别的页面（列表被缓存起来）
    await nextTick()
    expect(n).toBe(1) // 切走时不该拉

    showList.value = true // 回到列表页
    await nextTick()
    expect(n).toBe(2) // 回到本页要刷新
  })

  it('多次往返每次都刷新', async () => {
    let n = 0
    const ListView = makeListView(() => { n += 1 })
    const OtherView = makeOtherView()
    const showList = ref(true)
    mount(
      defineComponent({
        setup: () => () =>
          h(KeepAlive, null, {
            default: () => h(showList.value ? ListView : OtherView),
          }),
      }),
    )
    await nextTick()

    for (let i = 1; i <= 3; i++) {
      showList.value = false
      await nextTick()
      showList.value = true
      await nextTick()
      expect(n).toBe(1 + i)
    }
  })

  it('非 keep-alive 环境（测试里直接 mount）只由 onMounted 触发一次', async () => {
    let n = 0
    const ListView = makeListView(() => { n += 1 })
    mount(ListView)
    await nextTick()
    expect(n).toBe(1)
  })
})

describe('接线检查：各页面都挂上了 useReloadOnActivate', () => {
  function src(rel: string): string {
    return readFileSync(`${ROOT}/${rel}`, 'utf-8')
  }

  it('useServerPager 内置了回到本页刷新（一处覆盖所有服务端分页列表）', () => {
    const s = src('src/composables/useServerPager.ts')
    expect(s).toContain('useReloadOnActivate')
  })

  // 这些页面不走 useServerPager，必须各自接上，否则同样会出现
  // 「新建/修改后回到本页还是旧数据」的问题。
  const WIRED = [
    'src/views/warehouse/InboundView.vue',
    'src/views/warehouse/OutboundView.vue',
    'src/views/warehouse/TransferView.vue',
    'src/views/warehouse/CountView.vue',
    'src/views/warehouse/ReturnsView.vue',
    'src/views/warehouse/LocationsView.vue',
    'src/views/warehouse/WarehouseOpsView.vue',
    'src/views/warehouse/StockDocDetailView.vue',
    'src/views/warehouse/InboundDetailView.vue',
    'src/views/warehouse/OutboundDetailView.vue',
    'src/views/sales/SaleOrderDetailView.vue',
    'src/views/purchase/PurchaseOrderDetailView.vue',
    'src/views/finance/FinanceHomeView.vue',
    'src/views/finance/FinanceOpsView.vue',
    'src/views/finance/LedgerView.vue',
    'src/views/finance/ReconcileView.vue',
    'src/views/purchase/PurchaseHomeView.vue',
    'src/views/sales/SalesHomeView.vue',
    'src/views/warehouse/WarehouseHomeView.vue',
    'src/views/boss/ProductListView.vue',
    'src/views/boss/UsersManageView.vue',
    'src/views/boss/BossReportsView.vue',
    'src/views/boss/BossHomeView.vue',
  ]

  it('23 个非分页页面都调用了 useReloadOnActivate', () => {
    const missing = WIRED.filter(f => !src(f).includes('useReloadOnActivate('))
    expect(missing, `这些页面漏接了 useReloadOnActivate：${missing.join(', ')}`).toEqual([])
  })

  it('调用都放在 onMounted 之后（保证首次挂载由 onMounted 负责）', () => {
    for (const f of WIRED) {
      const s = src(f)
      const mountAt = s.indexOf('onMounted(')
      const hookAt = s.indexOf('useReloadOnActivate(')
      expect(mountAt, `${f} 没有 onMounted`).toBeGreaterThanOrEqual(0)
      expect(hookAt, `${f} 没有 useReloadOnActivate`).toBeGreaterThan(mountAt)
    }
  })
})

describe('首屏不再重复拉两次', () => {
  it('采购单 / 销售单列表不再在 onMounted 里额外 pager.reload()', () => {
    for (const f of [
      'src/views/purchase/PurchaseOrdersView.vue',
      'src/views/sales/SalesOrdersView.vue',
    ]) {
      const s = readFileSync(`${ROOT}/${f}`, 'utf-8')
      const body = s.slice(s.indexOf('onMounted('))
      // 注释里提到它不算，实际调用才是问题
      const hasRealCall = /^\s*pager\.reload\(\)/m.test(body)
      expect(hasRealCall, `${f} 仍在 onMounted 里重复拉一次`).toBe(false)
    }
  })
})
