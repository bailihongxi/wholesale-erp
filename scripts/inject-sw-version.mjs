/**
 * 构建后处理：把 dist/sw.js 里的 __BUILD_VERSION__ 换成 package.json 的版本号（V2.0-17）。
 *
 * 为什么必须在构建时做这件事：
 *   浏览器判断「Service Worker 有没有更新」**只看 sw.js 这个文件自身的内容**。
 *   之前 CACHE_NAME 是写死的 'erp-v3'，V2.0-12 之后连续四轮发版都没碰过这个文件，
 *   浏览器便认为 SW 从未更新 → 永远不触发 install/activate →
 *   activate 里「删掉非当前版本的缓存」这句从来没执行过 → 旧缓存（含旧 index.html）
 *   一直留着。手机网络一慢，导航请求就回退到那份旧 HTML，用户永远看不到新版本。
 *
 *   现在每次发版版本号一变，sw.js 内容跟着变，浏览器才会安装新 SW 并清空旧缓存。
 *
 * 之所以做成独立脚本而不是 vite 插件：vite.config.ts 归 tsconfig.node.json 管，
 * 而本项目没装 @types/node，在配置里 import 'node:fs' 会让 `vue-tsc -b` 直接报错。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const swPath = path.join(root, 'dist', 'sw.js')

if (!fs.existsSync(swPath)) {
  console.error('[inject-sw-version] 找不到 dist/sw.js，构建产物不完整')
  process.exit(1)
}

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const src = fs.readFileSync(swPath, 'utf8')

if (!src.includes('__BUILD_VERSION__')) {
  // 重复执行时占位符已被替换，不算失败
  console.log('[inject-sw-version] 未发现占位符（可能已注入过），跳过')
  process.exit(0)
}

fs.writeFileSync(swPath, src.replace(/__BUILD_VERSION__/g, version))
console.log(`[inject-sw-version] dist/sw.js 缓存版本 → erp-${version}`)
