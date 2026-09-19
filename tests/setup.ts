// 测试环境全局 setup：注册 Vant 组件库，避免组件测试中出现
// "Failed to resolve component: van-xxx" 警告，并保证 van-* 可正常渲染。
import { config } from '@vue/test-utils'
import Vant from 'vant'

config.global.plugins.push(Vant)

// jsdom 不提供 WebCrypto（crypto.subtle），而云同步的 AES-GCM 加解密依赖它，
// 这里用 Node 自带的 webcrypto 补齐，保证加解密相关用例可跑。
import { webcrypto } from 'node:crypto'
if (typeof (globalThis as any).crypto === 'undefined' || !(globalThis as any).crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

// jsdom 缺少 matchMedia，部分 Vant 组件依赖它，提供兜底实现。
if (typeof window !== 'undefined' && !window.matchMedia) {
  // @ts-expect-error 测试用兜底
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })
}
