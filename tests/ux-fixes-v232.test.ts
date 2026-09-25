/**
 * V2.1-2.32 六项体验修复的回归锁（2026-09-25 老板拍板的六项）
 *
 * ① 转单查询修复：useServerPager 加载失败弹提示 + convertToSale 回填报错提示
 * ② 登录闪屏：App 等 router.isReady 再放行 + 登录态分流（/ 与 /login）
 * ③ 入库后清列表缓存（30 秒延迟根因）
 * ④ 报价单明细显示库存（非经销商）
 * ⑤ 手机端防误触（下拉误进明细）+ 删 sessionStorage 自动弹详情
 * ⑥ 登记付款防重 + 提示 + payments 全表只拉一次
 *
 * 静态断言：检查源码里的关键实现点，防止回退。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('V2.1-2.32 体验修复', () => {
  it('① useServerPager.load 必须有 catch 并弹失败提示（不许静默停在旧列表）', () => {
    const t = src('src/composables/useServerPager.ts')
    expect(t).toMatch(/catch \(e: any\)/)
    expect(t).toMatch(/showToast\(\{\s*type: 'fail'/)
  })

  it('① convertToSale 回填报价单状态失败必须返回提示（不许异常穿出）', () => {
    const t = src('src/stores/quotes.ts')
    expect(t).toMatch(/转单回填报价单状态失败/)
    expect(t).toMatch(/已创建，但报价单状态回填失败/)
  })

  it('② App.vue 必须等 router.isReady 再放行渲染（根除空壳闪跳）', () => {
    const t = src('src/App.vue')
    expect(t).toMatch(/router\.isReady\(\)/)
    expect(t).toMatch(/appReady\.value = true/)
  })

  it('② 路由登录态分流：/ 按登录态跳工作台或登录页；已登录访问 /login 送回工作台', () => {
    const t = src('src/router/index.ts')
    expect(t).toMatch(/redirect: \(\) =>/)
    expect(t).toMatch(/userStore\.isLoggedIn && role/)
    expect(t).not.toMatch(/\{ path: '\/', redirect: '\/login' \}/)
  })

  it('③ 写操作成功后必须清列表缓存：useListCache 导出 clearAllListCaches 且五个写入口都调用', () => {
    const util = src('src/composables/useListCache.ts')
    expect(util).toMatch(/export function clearAllListCaches/)
    for (const f of [
      'src/views/warehouse/InboundDetailView.vue',
      'src/views/warehouse/OutboundDetailView.vue',
      'src/views/warehouse/ReturnsView.vue',
      'src/views/finance/LedgerView.vue',
      'src/views/finance/ReconcileView.vue',
      'src/views/purchase/PurchaseCreateView.vue',
    ]) {
      expect(existsSync(resolve(ROOT, f)), `${f} 应存在`).toBe(true)
      expect(src(f), `${f} 应调用 clearAllListCaches`).toMatch(/clearAllListCaches\(\)/)
    }
  })

  it('④ 报价单明细显示库存：非经销商可见，经销商不拉不显示', () => {
    const t = src('src/views/sales/QuotesView.vue')
    expect(t).toMatch(/stockOf\(items\.map\(/)
    expect(t).toMatch(/v-if="!isDealer" class="num">库存</)
    expect(t).toMatch(/stock-out/)
    expect(t).toMatch(/stock-low/)
    expect(t).toMatch(/note: isDealer\.value \? undefined : `库存/)
  })

  it('⑤ AppLayout 全局防误触：overscroll-behavior + 位移>10px 拦截合成 click', () => {
    const t = src('src/components/AppLayout.vue')
    expect(t).toMatch(/overscroll-behavior:\s*contain/)
    expect(t).toMatch(/onGuardTouchEnd/)
    expect(t).toMatch(/dx > 10 \|\| dy > 10/)
    expect(t).toMatch(/e\.preventDefault\(\)/)
  })

  it('⑤ 报价单不得再用 sessionStorage 自动弹详情（误触会被放大）', () => {
    const t = src('src/views/sales/QuotesView.vue')
    expect(t).not.toMatch(/sales_quote_detail_id/)
  })

  it('⑥ 登记付款防重 + loading 提示 + 成功提示带已付合计', () => {
    const t = src('src/views/finance/ReconcileView.vue')
    expect(t).toMatch(/submittingPayment\.value\) return/)
    expect(t).toMatch(/showLoadingToast\(/)
    expect(t).toMatch(/正在登记付款/)
    expect(t).toMatch(/已登记\$\{isPay \? '付款' : '收款'\}/)
    expect(t).toMatch(/:disabled="submittingPayment"/)
    expect(t).toMatch(/finally[\s\S]{0,200}submittingPayment\.value = false/)
  })

  it('⑥ finance.loadAll 提速：payments 全表复用 + 六表并行', () => {
    const t = src('src/stores/finance.ts')
    expect(t).toMatch(/listReceivables\(includeSettled = false, paysAll\?/)
    expect(t).toMatch(/listPayables\(includeSettled = false, paysAll\?/)
    expect(t).toMatch(/listPaymentHistory\(paysAll\?/)
    expect(t).toMatch(/Promise\.all\(\[\s*paysAll/)
  })
})
