/**
 * 手机端详情表格「撑破」防回归（V2.2-1.3）
 *
 * 背景（老板 2026-09-27 反馈 + 截图）：
 *   手机版「入库验货 → 本单收货批次」的表格被撑破 —— 6 列表格里
 *   `.data-table thead th` 是 `white-space: nowrap`，最小内容宽度超过屏幕，
 *   表格只能横向滚动，用户看到的是「左右两列被裁在卡片边缘」的破相。
 *
 * 修法（与全站既定规范一致：手机端明细一律卡片，见 docs/手机端明细卡片规范.md）：
 *   手机端改渲染 12A 卡片（src/styles/theme.css 的 .card-list / .card），
 *   电脑端保持表格（窄窗口时由 .tb-scroll 兜底）。全站巡查 49 张表格后，
 *   同类问题共 5 处：入库/出库批次表、采购单详情的入库流水与付款记录、
 *   盘点/退换货/调拨的明细弹层。
 *
 * 这组用例锁两件事：
 *   ① 结构契约：这 5 处必须保留「手机端卡片 + 电脑端表格」双分支，旧写法不许回来；
 *   ② 全站兜底：任何页面里新加的 <table> 都不许在没有滚动容器、没有手机端卡片、
 *      也不是桌面专属分支的情况下直接渲染 —— 否则又会撑破。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import InboundDetailView from '../src/views/warehouse/InboundDetailView.vue'
import { useProductStore } from '../src/stores/product'
import { usePurchaseStore } from '../src/stores/purchase'
import { db } from '../src/db'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')

/** 递归列出所有 .vue 源码 */
function allVueFiles(dir: string): string[] {
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...allVueFiles(p))
    else if (ent.name.endsWith('.vue')) out.push(p)
  }
  return out
}

/** 模板部分（第一个 <script> 之前）。用 <script 而不是 </template> 切，
 *  否则带嵌套 <template v-else> 的文件会被截断、漏检后半段表格。 */
function templateOf(sfc: string): string {
  const i = sfc.indexOf('<script')
  return i === -1 ? sfc : sfc.slice(0, i)
}

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf-8')
}

const SCROLL_HOSTS = /(tb-scroll|table-scroll|pk-scroll|items-scroll)/

describe('全站手机端表格兜底：不许有「裸表直出」', () => {
  it('每张表格都必须满足其一：滚动容器 / 手机端卡片处理 / 桌面专属分支', () => {
    const offenders: string[] = []
    for (const f of allVueFiles(SRC)) {
      const src = readFileSync(f, 'utf-8')
      const lines = templateOf(src).split('\n')
      const mediaIdx = src.indexOf('@media (max-width: 767px)')
      const media = mediaIdx > 0 ? src.slice(mediaIdx) : ''

      lines.forEach((ln, i) => {
        if (!/<table[\s>]/.test(ln)) return
        const above = lines.slice(Math.max(0, i - 14), i).join('\n')
        const cls = (ln.match(/class="([^"]*)"/) || [])[1] || ''
        const clsList = cls.split(/\s+/)
        const key = clsList.find(c => !['data-table', 'items-edit'].includes(c)) || ''

        const inScroll = SCROLL_HOSTS.test(above)
        const guarded = /v-else|isMobile/.test(ln) || /v-if="isMobile"|v-else|isMobile/.test(above)
        const mediaHandled =
          (clsList.includes('items-edit') && media.includes('items-edit')) ||
          (key !== '' && media.includes('.' + key))

        if (!inScroll && !guarded && !mediaHandled) {
          offenders.push(`${relative(ROOT, f)}:${i + 1}  [${cls || '无 class'}]`)
        }
      })
    }
    expect(
      offenders,
      '这些位置的表格在手机端会直接渲染且没有任何处理（列多就会被撑破）。' +
        '请照 V2.2-1.3 的做法：手机端用 12A 卡片（.card-list/.card）渲染、' +
        '电脑端保持表格并包一层 .tb-scroll。'
    ).toEqual([])
  })
})

describe('批次表：手机端卡片 + 电脑端表格', () => {
  const cases: Array<[string, string]> = [
    ['views/warehouse/InboundDetailView.vue', 'batches'],
    ['views/warehouse/OutboundDetailView.vue', 'batches']
  ]

  for (const [rel, list] of cases) {
    it(`${rel} 手机端渲染卡片列表（不再是挤压的 6 列表格）`, () => {
      const code = read(rel)
      expect(
        code,
        '手机端分支必须存在，否则 6 列表格又会在手机上被撑破'
      ).toContain(`<ul v-if="${list}.length && isMobile" class="card-list">`)
      // 电脑端表格分支必须留着，并包在滚动容器里
      expect(code).toContain(`<div v-else-if="${list}.length" class="tb-scroll">`)
      // 旧写法（裸表 v-if）不许回来
      expect(
        code,
        '旧的「裸表格 v-if」写法不许回来 —— 那正是被撑破的那一版'
      ).not.toContain(`<table v-if="${list}.length" class="data-table">`)
    })

    it(`${rel} 卡片上的操作按钮仍绑定原有动作（功能不能丢）`, () => {
      const code = read(rel)
      expect(code).toMatch(/class="card-act"[^>]*@click="openBatch\(b\.batchNo\)"/)
      expect(code).toMatch(/class="card-del"[^>]*@click="revertBatch\(b\)"/)
    })
  }
})

describe('采购单详情：入库流水 / 付款记录 手机端走卡片', () => {
  const code = read('views/purchase/PurchaseOrderDetailView.vue')

  it('两条流水都是「手机端卡片 + 电脑端表格(v-else-if)」', () => {
    expect(code).toContain('<ul v-if="inboundRecords.length && isMobile" class="card-list">')
    expect(code).toContain('<table v-else-if="inboundRecords.length" class="item-table">')
    expect(code).toContain('<ul v-if="payments.length && isMobile" class="card-list">')
    expect(code).toContain('<table v-else-if="payments.length" class="item-table">')
  })
})

describe('盘点 / 退换货 / 调拨：明细弹层手机端走卡片', () => {
  for (const rel of [
    'views/warehouse/CountView.vue',
    'views/warehouse/ReturnsView.vue',
    'views/warehouse/TransferView.vue'
  ]) {
    it(`${rel} 明细弹层手机端是卡片、电脑端是表格`, () => {
      const code = read(rel)
      expect(code).toContain('<ul v-if="isMobile" class="card-list">')
      expect(code, '电脑端表格必须保留（v-else）').toMatch(/<table v-else class="data-table">/)
    })
  }
})

describe('卡片外壳不得白底套白底', () => {
  it('批次表所在页：.block 已是白底卡片，卡片外壳要中和掉', () => {
    for (const rel of [
      'views/warehouse/InboundDetailView.vue',
      'views/warehouse/OutboundDetailView.vue',
      'views/purchase/PurchaseOrderDetailView.vue'
    ]) {
      const style = read(rel).slice(read(rel).indexOf('<style'))
      expect(style, `${rel} 少了卡片外壳中和规则`).toContain('.block .card-list { background: none; }')
      expect(style).toMatch(/\.block \.card \{[\s\S]*?box-shadow: none;/)
    }
  })

  it('明细弹层所在页：弹层本身是白底面板，卡片外壳同样要中和', () => {
    for (const rel of [
      'views/warehouse/CountView.vue',
      'views/warehouse/ReturnsView.vue',
      'views/warehouse/TransferView.vue'
    ]) {
      const style = read(rel).slice(read(rel).indexOf('<style'))
      expect(style, `${rel} 少了弹层内卡片外壳中和规则`).toContain('.detail-pop .card-list { background: none;')
      expect(style).toMatch(/\.detail-pop \.card \{[\s\S]*?box-shadow: none;/)
    }
  })
})

// ─────────────────────────────────────────────────────────────
// 真机行为锁：真的挂载一次「入库验货」，手机视口必须渲染卡片、电脑视口必须渲染表格
// （静态契约只能证明"代码写了"，这里证明"渲染出来是对的"）
// ─────────────────────────────────────────────────────────────

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/warehouse/inbound/1' },
    { path: '/warehouse/inbound', component: { template: '<div>list</div>' } },
    { path: '/warehouse/inbound/:id', component: { template: '<div>detail</div>' } },
    { path: '/warehouse/inbound/doc/:batchNo', component: { template: '<div>doc</div>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div></div>' } }
  ]
})

/** 把视口宽度改成指定值（useResponsive 在 setup 阶段读 window.innerWidth） */
function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true })
}

/** 造一张已部分收货的采购单，让「本单收货批次」真的有数据 */
async function seedPartialInboundOrder(): Promise<number> {
  const ps = useProductStore()
  await ps.createProduct({
    brand: '海尔', model: 'XQB100', category: '洗衣机', spec: '', unit: '台',
    purchasePrice: 1000, wholesalePrice: 1200, retailPrice: 1400, warnStock: 5,
    status: 'active', remark: '', extra: {}
  } as never)
  const list = await ps.listAll(true)
  const p = list[list.length - 1]

  const purchase = usePurchaseStore()
  const supplierId = await purchase.createSupplier({
    name: '海尔总代', contact: '张', phone: '139', address: '', paymentTerm: '', remark: ''
  })
  const res = await purchase.createOrder({
    supplierId, purchaserId: 1, items: [{ product: p, quantity: 5 }], remark: ''
  })
  // 只收 2 件 → 生成一张 RK 批次单，批次表有内容
  await purchase.inbound(res.orderId!, { [p.id!]: 2 }, 1)
  return res.orderId!
}

describe('入库验货：手机视口渲染卡片、电脑视口渲染表格（真挂载）', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    localStorage.clear()
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
  })

  it('手机视口（390px）：本单收货批次是卡片列表，不再有被撑破的表格', async () => {
    const orderId = await seedPartialInboundOrder()
    setViewport(390)
    await testRouter.push(`/warehouse/inbound/${orderId}`)
    await testRouter.isReady()

    const w = mount(InboundDetailView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await new Promise(r => setTimeout(r, 50))
    await flushPromises()

    const cards = w.findAll('.card-list .card')
    expect(cards.length, '手机端没渲染出批次卡片').toBeGreaterThan(0)
    // 批次里的关键字与两个操作按钮都在卡片上
    expect(cards[0].text()).toContain('RK')
    expect(cards[0].find('.card-act').exists()).toBe(true)
    expect(cards[0].find('.card-del').exists()).toBe(true)
    // 6 列批次表在手机端必须整张不渲染（它才是被撑破的那张）。
    // ⚠️ 这里按 .batch-table 精确匹配：明细表（.items-edit）在手机端是
    //    「仍然渲染 table、靠 scoped CSS 变卡片」，不能拿它当判据。
    expect(
      w.findAll('table.batch-table').length,
      '手机端仍然渲染了批次表格 —— 就是被撑破的那张'
    ).toBe(0)
    w.unmount()
  })

  it('电脑视口（1280px）：批次仍是表格（列对齐、信息密度高）', async () => {
    const orderId = await seedPartialInboundOrder()
    setViewport(1280)
    await testRouter.push(`/warehouse/inbound/${orderId}`)
    await testRouter.isReady()

    const w = mount(InboundDetailView, { global: { plugins: [testRouter] } })
    await flushPromises()
    await new Promise(r => setTimeout(r, 50))
    await flushPromises()

    const table = w.find('table.batch-table')
    expect(table.exists(), '电脑端批次表不见了').toBe(true)
    expect(table.text()).toContain('RK')
    expect(table.text()).toContain('入库单号')
    expect(w.findAll('.card-list .card').length, '电脑端不该渲染卡片').toBe(0)
    w.unmount()
  })
})
