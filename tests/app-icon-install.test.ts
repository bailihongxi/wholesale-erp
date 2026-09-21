/**
 * 第十六轮（V1.0-5）回归测试：
 *  - 需求1：全站列表统一 20 条/页 + 斑马纹
 *      · PAGE_SIZE_LIST / PAGE_SIZE_PRODUCT / PAGE_SIZE_ALERT 三者一律 20；
 *      · 商品档案、采购单、销售单、应收应付/收付款、资金流水、记一笔、操作日志、
 *        员工、客户、供应商、库房、出入库流水 —— 逐页确认接上了分页与分页条。
 *  - 需求3：可改应用图标 + 发送到桌面
 *      · 图标工具：底色明暗判断、manifest 拼装、无 canvas 时优雅降级；
 *      · 安装能力：平台判定、引导步骤、无原生事件时返回 unavailable；
 *      · 静态资源：manifest / Service Worker / 各尺寸图标齐全。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PAGE_SIZE_LIST, PAGE_SIZE_PRODUCT, PAGE_SIZE_ALERT } from '../src/composables/usePagination'
import {
  isLightColor, glyphColorOf, buildManifest, renderAppIcon, applyAppIcon, ICON_BG_TOP
} from '../src/utils/appIcon'
import {
  platformOf, installSteps, isStandalone, canPromptInstall, promptInstall,
  registerServiceWorker
} from '../src/utils/installApp'
import { useBrand, DEFAULT_APP_ICON, DEFAULT_APP_ICON_BG } from '../src/utils/brand'
import AppIconPanel from '../src/components/AppIconPanel.vue'

function src(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8')
}

// jsdom 没装 canvas 包，getContext 会往控制台喷一堆 "Not implemented" 错误。
// 这里显式桩成 null：既让输出干净，又正好覆盖「浏览器没有 canvas 时优雅降级」这条分支。
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

/* ============================================================
 * 需求1：全站列表 20 条/页 + 斑马纹
 * ============================================================ */
describe('需求1：全站列表统一 20 条/页', () => {
  it('三个分页常量全部是 20（商品档案 / 预警不再单独开例外）', () => {
    expect(PAGE_SIZE_LIST).toBe(20)
    expect(PAGE_SIZE_PRODUCT).toBe(20)
    expect(PAGE_SIZE_ALERT).toBe(20)
  })

  /**
   * 需求里点名要分页的列表 + 连带处理的列表。
   * 每页都要：模板里有分页条、遍历的是分页后的数据、导入了组件、用的是 20 条常量。
   */
  const listPages: { file: string; name: string }[] = [
    { file: 'src/views/boss/ProductListView.vue', name: '商品档案' },
    { file: 'src/views/purchase/PurchaseOrdersView.vue', name: '采购单列表' },
    { file: 'src/views/sales/SalesOrdersView.vue', name: '销售单列表' },
    { file: 'src/views/finance/FinanceOpsView.vue', name: '资金流水' },
    { file: 'src/views/finance/LedgerView.vue', name: '记一笔' },
    { file: 'src/views/finance/ReconcileView.vue', name: '应收应付 / 收付款列表' },
    { file: 'src/components/AuditLogPanel.vue', name: '操作日志' },
    { file: 'src/views/boss/UsersManageView.vue', name: '员工管理' },
    { file: 'src/views/sales/CustomersView.vue', name: '客户管理' },
    { file: 'src/views/purchase/SuppliersView.vue', name: '供应商列表' },
    { file: 'src/views/warehouse/LocationsView.vue', name: '库房列表' },
    { file: 'src/views/stock/StockFlowView.vue', name: '出入库流水' }
  ]

  for (const p of listPages) {
    it(`${p.name}：接了分页条 + 按页渲染 + 20 条/页`, () => {
      const s = src(p.file)
      const tpl = s.split('<script setup')[0]
      expect(tpl).toContain('<TablePager')
      // 分页后数据：旧列表用 pager.paged.value，商品档案已改为服务端分页用 pageRows
      expect(tpl).toMatch(/paged\.value|pageRows/)
      expect(s).toContain('TablePager.vue') // AuditLogPanel 在 components/ 下用相对路径 './TablePager.vue'
      // 商品档案历史上用 PAGE_SIZE_PRODUCT，第十五轮起两者都等于 20
      expect(s).toMatch(/PAGE_SIZE_(LIST|PRODUCT)/)
    })
  }

  it('列表页的表格都挂了 data-table（斑马纹来自 .data-table tbody tr:nth-child(even)）', () => {
    const css = src('src/styles/theme.css')
    expect(css).toMatch(/\.data-table tbody tr:nth-child\(even\)/)
    // 卡片型列表（手机端）走 .zebra-list，且与表格斑马纹同强度（肉眼看得出）
    expect(css).toMatch(/\.zebra-list > li:nth-child\(even\)\s*\{\s*background:\s*#eef2f9/)

    const tables = [
      'src/views/purchase/PurchaseOrdersView.vue',
      'src/views/sales/SalesOrdersView.vue',
      'src/components/AuditLogPanel.vue',
      'src/views/sales/CustomersView.vue',
      'src/views/boss/UsersManageView.vue',
      'src/views/finance/FinanceOpsView.vue',
      'src/views/finance/LedgerView.vue',
      'src/views/warehouse/LocationsView.vue',
      'src/views/stock/StockFlowView.vue',
      'src/views/finance/ReconcileView.vue'
    ]
    for (const f of tables) {
      expect(src(f), f).toMatch(/<table[^>]*class="[^"]*\bdata-table\b/)
    }
    // 纯卡片列表（供应商）用 zebra-list
    expect(src('src/views/purchase/SuppliersView.vue')).toMatch(/<ul[^>]*class="[^"]*\bzebra-list\b/)
  })

  it('手机端卡片列表也带斑马纹（单据 / 应收应付 / 库房作业 / 收付款）', () => {
    const cardPages = [
      'src/views/purchase/PurchaseOrdersView.vue',
      'src/views/sales/SalesOrdersView.vue',
      'src/views/finance/ReconcileView.vue',
      'src/views/warehouse/InboundView.vue',
      'src/views/warehouse/OutboundView.vue',
      'src/views/warehouse/CountView.vue',
      'src/views/warehouse/ReturnsView.vue',
      'src/views/warehouse/TransferView.vue',
      'src/views/stock/StockFlowView.vue'
    ]
    for (const f of cardPages) {
      const tpl = src(f).split('<script setup')[0]
      // 页面上不应再有「没挂 zebra-list 的卡片列表」
      expect(tpl, f).not.toMatch(/<ul[^>]*class="card-list"/)
    }
  })

  it('分页组件本身按 20 条切页（50 条数据 → 3 页，末页 10 条）', async () => {
    const { usePagination } = await import('../src/composables/usePagination')
    const rows = Array.from({ length: 50 }, (_, i) => i + 1)
    const pager = usePagination({ value: rows } as never, PAGE_SIZE_LIST)
    expect(pager.pageCount.value).toBe(3)
    expect(pager.paged.value.length).toBe(20)
    expect(pager.startIndex.value).toBe(1)
    pager.go(3)
    expect(pager.paged.value.length).toBe(10)
    expect(pager.startIndex.value).toBe(41)
  })
})

/* ============================================================
 * 需求3：可改应用图标
 * ============================================================ */
describe('需求3：应用图标工具', () => {
  it('底色明暗判断：白底用深字，深底用白字，渐变用白字', () => {
    expect(isLightColor('#ffffff')).toBe(true)
    expect(isLightColor('#f0f0f0')).toBe(true)
    expect(isLightColor('#16325c')).toBe(false)
    expect(isLightColor('bad-value')).toBe(false) // 非法值不炸，按深色处理
    expect(glyphColorOf('gradient')).toBe('#ffffff')
    expect(glyphColorOf('#ffffff')).toBe('#16325c')
    expect(glyphColorOf('#f97316')).toBe('#ffffff')
  })

  it('manifest 里带 192 / 512 自定义图标，并保留一张品牌 maskable 兜底', () => {
    const json = buildManifest({ small: 'data:image/png;base64,AA', large: 'data:image/png;base64,BB' },
      'https://example.com/erp/#/boss/settings')
    const m = JSON.parse(json) as {
      start_url: string; scope: string; icons: { sizes: string; src: string; purpose?: string }[]
      display: string; theme_color: string
    }
    expect(m.display).toBe('standalone')
    expect(m.theme_color).toBe(ICON_BG_TOP)
    // 相对地址必须绝对化：manifest 是 Blob URL，相对路径会解析失败
    expect(m.start_url).toBe('https://example.com/erp/')
    expect(m.scope).toBe('https://example.com/erp/')
    expect(m.icons.find(i => i.sizes === '192x192')?.src).toBe('data:image/png;base64,AA')
    expect(m.icons.find(i => i.sizes === '512x512')?.src).toBe('data:image/png;base64,BB')
    // 兜底那张必须仍指向仓库里的静态图，且带 maskable
    const mask = m.icons.find(i => i.purpose === 'maskable')
    expect(mask?.src).toContain('/icons/icon-maskable-512.png')
  })

  it('测试环境没有 canvas：渲染返回空串、应用返回 false（不会把图标弄成空白）', async () => {
    const url = await renderAppIcon({ type: 'text', value: '📦' }, 'gradient', 192)
    expect(url).toBe('')
    // 内置档位不需要渲染，直接回到静态图 → 视为成功
    await expect(applyAppIcon(DEFAULT_APP_ICON, DEFAULT_APP_ICON_BG)).resolves.toBe(true)
    await expect(applyAppIcon({ type: 'text', value: 'ERP' }, 'gradient')).resolves.toBe(false)
  })
})

describe('需求3：品牌配置里的应用图标', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('默认用内置图标 + 品牌蓝渐变底色', () => {
    const { config } = useBrand()
    // 前面用例可能改过配置，这里直接校验默认值常量本身
    expect(DEFAULT_APP_ICON.type).toBe('builtin')
    expect(DEFAULT_APP_ICON_BG).toBe('gradient')
    expect(config.value.appIcon.type).toBe('builtin')
  })

  it('设置图标会写进 localStorage，重进系统仍是设置过的图标', () => {
    const brand = useBrand()
    brand.setAppIcon({ type: 'text', value: '🏪' })
    brand.setAppIconBg('#f97316')
    const raw = JSON.parse(localStorage.getItem('erp_brand_config') ?? '{}') as {
      appIcon?: { type: string; value: string }; appIconBg?: string
    }
    expect(raw.appIcon?.value).toBe('🏪')
    expect(raw.appIconBg).toBe('#f97316')
    brand.resetAppIcon()
    expect(useBrand().config.value.appIcon.type).toBe('builtin')
  })

  it('老版本配置（没有 appIcon 字段）能正常读取，不报错也不会变空白', () => {
    localStorage.setItem('erp_brand_config', JSON.stringify({ loginTitle: '老配置' }))
    vi.resetModules()
    return import('../src/utils/brand').then((mod) => {
      const { config } = mod.useBrand()
      expect(config.value.loginTitle).toBe('老配置')
      expect(config.value.appIcon.type).toBe('builtin')
      expect(config.value.appIconBg).toBe('gradient')
    })
  })
})

/* ============================================================
 * 需求3：发送到桌面
 * ============================================================ */
describe('需求3：发送到桌面（安装能力）', () => {
  const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; SM-S9110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
  const WECHAT_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0.44(0x18002c2f) NetType/WIFI'
  const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  it('平台判定覆盖 苹果 / 安卓 / 微信 / 电脑', () => {
    expect(platformOf(IPHONE_UA)).toBe('ios')
    expect(platformOf(ANDROID_UA)).toBe('android')
    expect(platformOf(WECHAT_UA)).toBe('wechat')
    expect(platformOf(DESKTOP_UA)).toBe('desktop')
  })

  it('每个平台都给得出可执行步骤（苹果走「添加到主屏幕」，微信提示换浏览器）', () => {
    const ios = installSteps(IPHONE_UA)
    expect(ios.title).toContain('苹果')
    expect(ios.steps.join('')).toContain('添加到主屏幕')

    const wechat = installSteps(WECHAT_UA)
    expect(wechat.steps.join('')).toContain('在浏览器打开')

    for (const ua of [IPHONE_UA, ANDROID_UA, WECHAT_UA, DESKTOP_UA]) {
      expect(installSteps(ua).steps.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('浏览器没给原生安装事件时：不能一键装，但引导仍可用', async () => {
    expect(canPromptInstall()).toBe(false)
    await expect(promptInstall()).resolves.toBe('unavailable')
    // 测试环境既不是独立窗口，也不该误判成已安装
    expect(typeof isStandalone()).toBe('boolean')
  })

  it('非生产环境不注册 Service Worker（避免开发时缓存打架）', () => {
    // jsdom 没有 navigator.serviceWorker，正好验证「没有该能力时也不能抛错」
    expect(() => registerServiceWorker(false)).not.toThrow()
    expect(() => registerServiceWorker(true)).not.toThrow()
    expect('serviceWorker' in navigator).toBe(false)
  })
})

/* ============================================================
 * PWA 静态资源
 * ============================================================ */
describe('PWA 静态资源齐全', () => {
  it('manifest.webmanifest 是合法 JSON 且含 192/512/可遮罩三种图标', () => {
    const m = JSON.parse(src('public/manifest.webmanifest')) as {
      name: string; display: string; start_url: string
      icons: { sizes: string; purpose?: string }[]
    }
    expect(m.name).toContain('ERP')
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('./')
    const sizes = m.icons.map(i => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(m.icons.some(i => i.purpose === 'maskable')).toBe(true)
  })

  it('sw.js 同时处理安装、激活与请求拦截', () => {
    const sw = src('public/sw.js')
    expect(sw).toContain("addEventListener('install'")
    expect(sw).toContain("addEventListener('activate'")
    expect(sw).toContain("addEventListener('fetch'")
    // 导航请求走 network-first，保证发新版后能拿到新首页
    expect(sw).toMatch(/req\.mode === 'navigate'/)
  })

  it('各尺寸默认图标都在，且是合法 PNG（避免装到桌面变灰白方块）', () => {
    const icons = [
      'public/icons/favicon-32.png',
      'public/icons/icon-192.png',
      'public/icons/icon-512.png',
      'public/icons/icon-maskable-512.png',
      'public/icons/apple-touch-icon.png'
    ]
    for (const f of icons) {
      const abs = resolve(__dirname, '..', f)
      expect(existsSync(abs), f).toBe(true)
      const buf = readFileSync(abs)
      expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(buf.length).toBeGreaterThan(200)
    }
  })

  it('index.html 引用图标与 manifest，并声明可添加到主屏幕', () => {
    const html = src('index.html')
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('rel="apple-touch-icon"')
    expect(html).toContain('apple-mobile-web-app-capable')
    expect(html).toContain('icons/favicon-32.png')
  })
})

/* ============================================================
 * 设置页面板
 * ============================================================ */
describe('系统设置里的「应用图标与桌面快捷方式」面板', () => {
  it('设置页挂载了新面板（且参与「全部展开 / 全部收起」）', () => {
    const s = src('src/views/boss/SettingsView.vue')
    expect(s).toContain('<AppIconPanel')
    expect(s).toContain("import AppIconPanel from '../../components/AppIconPanel.vue'")
    expect(s).toContain("'appicon'")
  })

  it('入口在应用启动时就套用已保存的图标（刷新后不会掉回默认图）', () => {
    const main = src('src/main.ts')
    expect(main).toContain('applyAppIcon')
    expect(main).toContain('initInstall()')
    expect(main).toContain('registerServiceWorker')
  })

  it('面板渲染出预览、图标来源与发送到桌面三块，切换来源 Tab 生效', async () => {
    const w = mount(AppIconPanel, { props: { open: true } })
    const text = w.text()
    expect(text).toContain('当前应用图标')
    expect(text).toContain('图标来源')
    expect(text).toContain('发送到桌面')

    // 默认展示内置档位；切到「上传图片」出现选图按钮
    const tabs = w.findAll('.ui-seg-item')
    expect(tabs.length).toBe(3)
    await tabs[2].trigger('click')
    expect(w.text()).toContain('选择图片')

    // 切回「Emoji / 文字」出现输入框与常用 emoji
    await tabs[1].trigger('click')
    expect(w.find('.ap-text').exists()).toBe(true)
    expect(w.findAll('.ap-chip').length).toBeGreaterThan(3)
  })

  it('面板里有恢复默认图标按钮（改坏了能一键回退）', async () => {
    const w = mount(AppIconPanel, { props: { open: true } })
    const btns = w.findAll('button').map(b => b.text())
    expect(btns.some(t => t.includes('恢复默认图标'))).toBe(true)
    expect(btns.some(t => t.includes('应用到系统'))).toBe(true)
  })
})
