/**
 * V2.2-2.4 回归锁：keep-alive 内存上限 = 24
 *
 * 背景：V2.2-2.1 Z1 为治「弱机越用越卡」给 <keep-alive> 加 :max=12（LRU 淘汰）。
 * 实测 12 太小：系统 49 个路由，日常跨模块使用必超限，销售/采购等高频列表页
 * 被挤出缓存 → 每次进入都重新挂载（骨架屏+等网络），丢失「旧数据秒开+后台刷新」
 * 的体感，老板实测列表变慢。V2.2-2.4 调整为 24（覆盖日常高频页面集，内存仍封顶）。
 *
 * 本测试用 Vite 的 ?raw 导入读源码（不依赖 fs，规避测试环境 fs shim 限制），
 * 锁定 max 值防止未来被改回过小值。
 */
import { describe, it, expect } from 'vitest'
import appSource from '../src/App.vue?raw'

describe('V2.2-2.4 keep-alive 内存上限', () => {
  it('keep-alive 必须带 :max="24"（12 会导致高频列表页被 LRU 淘汰、进页变慢）', () => {
    expect(appSource).toContain(':max="24"')
  })

  it('不允许回退到 :max="12"', () => {
    expect(appSource).not.toContain(':max="12"')
  })
})
