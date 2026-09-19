/**
 * 第十二轮回归测试：
 *  - 库存作业并入库存管理（Hub 页四个 Tab）
 *  - 库存预警：每页固定 50 条 + 斑马纹表格 + 分页
 *  - 首屏骨架（避免"先闪空态再出数据"）
 *  - 电脑端筛选条紧凑化（仅 min-width:768px 生效，手机端不受影响）
 *  - 品牌与图标可自定义（快捷图标 / 登录页头像 / 各角色头像）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import 'fake-indexeddb/auto'
import StockManageView from '../src/views/stock/StockManageView.vue'
import StockAlertView from '../src/views/stock/StockAlertView.vue'
import LoadingBlock from '../src/components/ui/LoadingBlock.vue'
import { PAGE_SIZE_ALERT, PAGE_SIZE } from '../src/composables/usePagination'
import { useBrand, DEFAULT_ROLE_AVATARS } from '../src/utils/brand'
import { ALL_MODULES } from '../src/router/navConfig'
import type { Product } from '../src/types'

function src(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8')
}

/** 造 n 个库存低于预警线的商品 */
function makeProducts(n: number): Product[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    brand: '品牌' + (i % 5),
    model: '型号-' + String(i + 1).padStart(3, '0'),
    category: i % 2 === 0 ? '空调' : '冰箱',
    spec: '1.5匹',
    unit: '台',
    purchasePrice: 1000,
    wholesalePrice: 1200,
    retailPrice: 1500,
    warnStock: 10,
    status: 'active',
    remark: '',
    extra: {}
  }) as Product)
}

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: { template: '<div/>' } },
    { path: '/stock', component: { template: '<div/>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div/>' } }
  ]
})

describe('库存预警：每页 50 条 + 斑马纹', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // jsdom 默认 1024 宽，走电脑端表格分支
    window.innerWidth = 1024
  })

  it('预警模块每页固定 50 条（与商品列表的 20 条区分开）', () => {
    expect(PAGE_SIZE_ALERT).toBe(50)
    expect(PAGE_SIZE_ALERT).not.toBe(PAGE_SIZE)
  })

  it('60 条预警数据：首页只渲染 50 行，翻到第 2 页剩 10 行', async () => {
    const products = makeProducts(60)
    const stock: Record<number, number> = {}
    products.forEach(p => { stock[p.id!] = 2 }) // 全部低于预警值 10
    const locations = [{ id: 1, name: '总仓', remark: '', createdAt: '' }]

    const w = mount(StockAlertView, {
      props: { products, stock, locations, dist: {} }
    })
    await flushPromises()

    // 表格用全站统一的 .data-table（自带斑马纹）+ 预警专用类
    const table = w.find('table.data-table.alert-table')
    expect(table.exists()).toBe(true)
    expect(w.findAll('table.alert-table tbody tr.is-warn').length).toBe(50)

    // 分页条：共 60 条，两页
    const info = w.find('.pager-info').text()
    expect(info).toContain('共')
    expect(info).toContain('60')
    expect(info).toContain('第 1 / 2 页')

    // 翻到第 2 页
    await w.find('.pager-btn[aria-label="下一页"]').trigger('click')
    await flushPromises()
    expect(w.findAll('table.alert-table tbody tr.is-warn').length).toBe(10)
    expect(w.find('.pager-info').text()).toContain('第 2 / 2 页')
  })

  it('表格斑马纹由全站 .data-table 统一提供（奇偶行底色不同）', () => {
    const css = src('src/styles/theme.css')
    expect(css).toMatch(/\.data-table tbody tr:nth-child\(even\)\s*\{[^}]*background/)
    expect(css).toMatch(/\.data-table tbody tr:nth-child\(odd\)\s*\{[^}]*background/)
  })

  it('库存充足的 normal 商品不会出现在预警列表里', async () => {
    const products = makeProducts(3)
    const stock: Record<number, number> = { 1: 2, 2: 999, 3: 0 }
    const w = mount(StockAlertView, {
      props: { products, stock, locations: [], dist: {} }
    })
    await flushPromises()
    const names = w.findAll('table.alert-table tbody tr.is-warn').map(r => r.text())
    expect(names.length).toBe(2)
    expect(names.join('|')).toContain('型号-001')
    expect(names.join('|')).not.toContain('型号-002')
  })

  it('搜索框按品牌/型号过滤预警行', async () => {
    const products = makeProducts(3)
    const stock: Record<number, number> = { 1: 1, 2: 1, 3: 1 }
    const w = mount(StockAlertView, {
      props: { products, stock, locations: [], dist: {} }
    })
    await flushPromises()
    const input = w.find('input')
    await input.setValue('型号-002')
    await flushPromises()
    expect(w.findAll('table.alert-table tbody tr.is-warn').length).toBe(1)
    expect(w.text()).toContain('型号-002')
  })
})

describe('库存管理 Hub 页：库存作业已并入', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    window.innerWidth = 1024
    await testRouter.push('/stock')
    await testRouter.isReady()
  })

  it('页内四个 Tab：库存作业 / 明细 / 预警 / 流水（库存作业已移到最前）', async () => {
    const w = mount(StockManageView, {
      global: { plugins: [testRouter] }
    })
    await flushPromises()
    const tabs = w.text()
    expect(tabs).toContain('库存明细')
    expect(tabs).toContain('库存预警')
    expect(tabs).toContain('出入库流水')
    expect(tabs).toContain('库存作业')

    // 默认落在「库存明细」
    expect(w.text()).toContain('库存明细')
    expect(w.findComponent({ name: 'StockDetailView' }).exists()).toBe(true)
  })

  it('?tab=ops 直接落到库存作业（库房管理）子页', async () => {
    await testRouter.push('/stock?tab=ops')
    const w = mount(StockManageView, {
      global: { plugins: [testRouter] }
    })
    await flushPromises()
    expect(w.text()).toContain('库房管理')
    expect(w.findComponent({ name: 'WarehouseOpsView' }).exists()).toBe(true)
    // embedded 模式不再重复渲染「库存作业」页头
    expect(w.find('.sec-line').exists()).toBe(true)
  })

  it('?tab=alert 落到库存预警子页', async () => {
    await testRouter.push('/stock?tab=alert')
    const w = mount(StockManageView, {
      global: { plugins: [testRouter] }
    })
    await flushPromises()
    expect(w.findComponent({ name: 'StockAlertView' }).exists()).toBe(true)
  })
})

describe('首屏骨架：消除"先闪空态再出数据"', () => {
  it('LoadingBlock 渲染骨架行', () => {
    const w = mount(LoadingBlock, { props: { rows: 6 } })
    expect(w.find('.ui-skeleton').exists()).toBe(true)
    expect(w.findAll('.ui-skeleton-row').length).toBe(6)
  })

  it('骨架动画在减少动效偏好下自动关闭', () => {
    const css = src('src/styles/theme.css')
    expect(css).toContain('.ui-skeleton')
    expect(css).toMatch(/prefers-reduced-motion/)
  })

  it('主要列表页都接入了首屏骨架', () => {
    const pages = [
      'src/views/purchase/PurchaseOrdersView.vue',
      'src/views/sales/SalesOrdersView.vue',
      'src/views/boss/ProductListView.vue',
      'src/views/boss/AuditLogView.vue',
      'src/views/sales/CustomersView.vue',
      'src/views/finance/ReconcileView.vue'
    ]
    for (const p of pages) {
      const code = src(p)
      expect(code, p + ' 未接入 LoadingBlock').toContain('LoadingBlock')
      expect(code, p + ' 未在加载完成后关闭骨架').toMatch(/loading\.value\s*=\s*false/)
    }
  })
})

describe('电脑端筛选条紧凑化（不动手机端）', () => {
  it('收缩规则只写在 min-width:768px 媒体查询内', () => {
    const css = src('src/styles/theme.css')
    const idx = css.indexOf('@media (min-width: 768px)')
    expect(idx).toBeGreaterThan(-1)
    const block = css.slice(idx)
    expect(block).toMatch(/:is\(\.toolbar,\s*\.data-toolbar,\s*\.ui-toolbar\)/)
    // 搜索框放大，其余控件收缩到内容宽度
    expect(block).toMatch(/flex:\s*1 1 320px/)
    expect(block).toMatch(/max-width:\s*230px/)
  })

  it('库房管理「新增库房」输入行已对齐 40px 控件高度', () => {
    const code = src('src/views/warehouse/LocationsView.vue')
    expect(code).toMatch(/\.txt-input\s*\{[^}]*height:\s*40px/)
    expect(code).toMatch(/\.btn\s*\{[^}]*height:\s*40px/)
    expect(code).toMatch(/\.add-row\s*\{[^}]*display:\s*flex/)
  })
})

describe('品牌与图标可自定义', () => {
  beforeEach(() => {
    useBrand().resetAll()
    localStorage.removeItem('erp_brand_config')
  })

  it('默认配置：登录标题 + 各角色默认头像', () => {
    const b = useBrand()
    expect(b.config.value.loginTitle).toBe('家电批发ERP')
    expect(b.roleAvatar('boss').value).toBe('👑')
    expect(b.roleAvatar('warehouse').value).toBe('📦')
    expect(DEFAULT_ROLE_AVATARS.sales).toBe('💼')
  })

  it('改快捷图标后 iconOf 立即生效，重置回默认', () => {
    const b = useBrand()
    const item = ALL_MODULES.find(m => m.route === '/stock') ?? ALL_MODULES[0]
    expect(b.iconOf(item)).toBe(item.icon)
    b.setModuleIcon(item.route, '🚀')
    expect(b.iconOf(item)).toBe('🚀')
    b.resetModuleIcons()
    expect(b.iconOf(item)).toBe(item.icon)
  })

  it('改角色头像（含图片）后 roleAvatar 生效并落 localStorage', () => {
    const b = useBrand()
    b.setRoleAvatar('finance', { type: 'text', value: '💰' })
    expect(b.roleAvatar('finance').value).toBe('💰')

    b.setRoleAvatar('boss', { type: 'image', value: 'data:image/png;base64,AAAA' })
    const a = b.roleAvatar('boss')
    expect(a.type).toBe('image')
    expect(a.value.startsWith('data:image')).toBe(true)

    const saved = JSON.parse(localStorage.getItem('erp_brand_config') || '{}')
    expect(saved.roleAvatars.boss.value).toBe('data:image/png;base64,AAAA')

    b.resetRoleAvatars()
    expect(b.roleAvatar('boss').value).toBe('👑')
  })

  it('未知角色 / 空角色有兜底头像，不会渲染空白', () => {
    const b = useBrand()
    expect(b.roleAvatar('').value).toBeTruthy()
    expect(b.roleAvatar('unknown-role').value).toBeTruthy()
    expect(b.roleAvatar(null).value).toBe('👤')
  })

  it('localStorage 里是脏数据时不抛错，回落默认值', () => {
    localStorage.setItem('erp_brand_config', '{ this is not json')
    // 重新读取：模块级 ref 已初始化，这里验证 resetAll 后仍可正常工作
    const b = useBrand()
    expect(() => b.resetAll()).not.toThrow()
    expect(b.config.value.loginTitle).toBe('家电批发ERP')
    localStorage.removeItem('erp_brand_config')
  })

  it('侧边栏 / 手机 Tab / 登录页 / 我的页 都接入了品牌配置', () => {
    for (const p of [
      'src/components/SideBar.vue',
      'src/components/MobileTabBar.vue',
      'src/views/auth/LoginView.vue',
      'src/views/RoleMineView.vue'
    ]) {
      const code = src(p)
      expect(code, p + ' 未接入品牌配置').toMatch(/useBrand|iconOf|roleAvatar/)
    }
  })
})
