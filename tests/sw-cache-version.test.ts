/**
 * V2.0-17 回归测试：Service Worker 缓存必须随版本更新
 *
 * 背景（用户两次反馈「改好了但我手机上还是老样子」的真正原因）：
 *   浏览器判断「Service Worker 有没有更新」**只看 sw.js 这个文件自身的内容**。
 *   V2.0-12 定下 CACHE_NAME = 'erp-v3' 之后，V2.0-13/14/15/16 连续四轮发版都只改
 *   源码、没碰过这个文件 —— 浏览器便认为 SW 从未更新，**永远不触发 install/activate**，
 *   activate 里「删掉非当前版本的缓存」这句从来没执行过，旧缓存一直留着。
 *   手机网络一慢，导航请求就回退到缓存里的旧 index.html，旧 HTML 又引用旧的
 *   index-xxxx.css（缓存里有），用户于是永远停留在修复前的界面。
 *
 * 这里把三件事锁死：
 *   1. 缓存名必须由构建版本派生（不能写死，否则文件内容永不变化）；
 *   2. 构建必须真的把版本注入进 dist/sw.js（漏掉就白改）；
 *   3. 新 SW 接管后可以自动刷新到新版，但**不能打断正在录单的用户**。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function src(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8')
}

function exists(rel: string): boolean {
  return existsSync(resolve(__dirname, '..', rel))
}

/** 去掉注释，只留真实代码 —— 否则讲解背景时写进注释的反面示例会被误判 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const SW = 'public/sw.js'
const INJECT = 'scripts/inject-sw-version.mjs'
const INSTALL = 'src/utils/installApp.ts'

describe('V2.0-17：Service Worker 缓存名必须随构建版本变化', () => {
  it('缓存名不再写死固定版本（写死 = 浏览器永远认为 SW 没更新）', () => {
    const code = stripComments(src(SW))
    expect(code).not.toMatch(/CACHE_NAME\s*=\s*['"]erp-v\d+['"]/)
  })

  it('缓存名由 __BUILD_VERSION__ 占位符派生', () => {
    const code = stripComments(src(SW))
    expect(code).toContain("const BUILD_VERSION = '__BUILD_VERSION__'")
    expect(code).toMatch(/CACHE_NAME\s*=\s*['"]erp-['"]\s*\+\s*BUILD_VERSION/)
  })

  it('activate 里会删掉非当前版本的旧缓存', () => {
    const code = src(SW)
    expect(code).toMatch(/keys\.filter\(k\s*=>\s*k\s*!==\s*CACHE_NAME\)/)
    expect(code).toContain('caches.delete(k)')
  })

  it('注入脚本存在，且真的会把占位符换成 package.json 的版本号', () => {
    expect(exists(INJECT), '缺少构建期注入脚本').toBe(true)
    const inj = src(INJECT)
    expect(inj).toContain('__BUILD_VERSION__')
    expect(inj).toContain('package.json')
    expect(inj).toMatch(/replace\(/)
  })

  it('build 脚本链上了注入步骤（漏掉这一步等于没改）', () => {
    const pkg = JSON.parse(src('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts.build).toContain('inject-sw-version')
  })

  it('已构建的 dist/sw.js 不再残留占位符（dist 不一定存在，故条件判断）', () => {
    if (!exists('dist/sw.js')) return
    expect(src('dist/sw.js'), 'dist/sw.js 仍是占位符 —— 注入脚本没生效').not.toContain('__BUILD_VERSION__')
  })
})

describe('V2.0-17：新版本自动接管，但不能打断正在录单的用户', () => {
  it('监听 controllerchange，新 SW 接管后刷新到新版', () => {
    const code = src(INSTALL)
    expect(code).toContain('controllerchange')
    expect(code).toContain('location.reload')
  })

  it('首次安装 SW（本来就没有 controller）不触发无谓刷新', () => {
    const code = src(INSTALL)
    expect(code).toContain('hadController')
    expect(code).toMatch(/if\s*\(!hadController\)\s*return/)
  })

  it('用户已经操作过就不刷新（避免录单填好的数据被冲掉）', () => {
    const code = src(INSTALL)
    expect(code).toContain('userInteracted')
    expect(code).toMatch(/if\s*\(userInteracted\)\s*return/)
    expect(code, '必须监听用户交互信号').toMatch(/pointerdown|keydown|touchstart/)
  })

  it('注册后主动触发一次更新检查（浏览器自身检查有节流，只靠 register 会漏更新）', () => {
    const code = src(INSTALL)
    expect(code, '缺少 registration.update() —— 发版后用户可能这次打开拿不到新版').toMatch(
      /reg\.update\(\)|registration\.update\(\)/
    )
  })

  it('用 sessionStorage 标记防止「无限刷新」循环', () => {
    const code = src(INSTALL)
    expect(code).toContain('sessionStorage')
    expect(code).toContain('erp_sw_reloaded_once')
  })
})
