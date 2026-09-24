/**
 * 发送到桌面（第十六轮）
 * ----------------------------------------------------------------
 * 需求：给系统一个「把这个网页装到桌面」的入口，装完点桌面图标就能直接打开，
 * 且图标就是我们设置好的那张。
 *
 * 现实差异（决定了这里为什么要分平台写引导）：
 *  - 安卓 Chrome / 电脑 Chrome、Edge：支持 beforeinstallprompt，能弹系统原生安装窗，
 *    一键完成，桌面图标、开始菜单图标自动用 manifest 里的图；
 *  - 苹果 Safari：不支持该事件，只能手动「分享 → 添加到主屏幕」，所以要给图示步骤；
 *  - 微信内置浏览器：不支持安装，需要提示用系统浏览器打开。
 *
 * 这里只做「判断 + 引导」，真正的图标与 manifest 由 utils/appIcon.ts 负责。
 */
import { ref } from 'vue'
import { currentSystemName } from './brand'

/** 浏览器原生安装事件（TS 标准库没有，自己声明） */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type Platform = 'ios' | 'android' | 'wechat' | 'desktop'

export const installReady = ref(false)
export const installed = ref(false)

let deferred: BeforeInstallPromptEvent | null = null

/** 平台判定：只看 UA 字符串，方便单测 */
export function platformOf(ua: string): Platform {
  const s = ua.toLowerCase()
  if (/micromessenger/.test(s)) return 'wechat'
  if (/iphone|ipad|ipod/.test(s)) return 'ios'
  // 新版 iPad 的 UA 与 Mac 相同，但能触摸
  if (/macintosh/.test(s) && /mobile/.test(s)) return 'ios'
  if (/android/.test(s)) return 'android'
  return 'desktop'
}

/** 是否已经处于「已安装/独立窗口」状态 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  try {
    return window.matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

/** 各平台的手动安装步骤（原生安装不可用时展示） */
export function installSteps(ua: string): { title: string; steps: string[] } {
  switch (platformOf(ua)) {
    case 'ios':
      return {
        title: '苹果手机 / 平板（Safari）',
        steps: [
          '用 Safari 打开本系统（微信里请点右上角「…」→ 在 Safari 中打开）',
          '点屏幕底部中间的「分享」按钮 ⬆️',
          '在弹出菜单里向下滑，选「添加到主屏幕」',
          '右上角点「添加」，桌面就会出现带本系统图标的快捷方式'
        ]
      }
    case 'android':
      return {
        title: '安卓手机 / 平板',
        steps: [
          '用 Chrome 或系统浏览器打开本系统',
          '点右上角「⋮」菜单',
          '选「添加到主屏幕 / 安装应用」',
          '确认后桌面即出现快捷方式'
        ]
      }
    case 'wechat':
      return {
        title: '微信内打开时',
        steps: [
          '微信内置浏览器不支持安装到桌面',
          '点右上角「…」，选「在浏览器打开」',
          '再按浏览器里的「添加到主屏幕」操作'
        ]
      }
    default:
      return {
        title: '电脑端（Chrome / Edge）',
        steps: [
          '看地址栏最右侧，点「安装」图标 ⊕（一个屏幕带箭头的小图标）',
          `或点浏览器右上角「⋮」菜单 →「安装 ${currentSystemName()}」`,
          '确认后桌面 / 开始菜单会生成快捷方式，双击即用，窗口和普通软件一样',
          '若没看到安装入口，说明当前是隐私模式或系统策略禁止，换普通窗口重试'
        ]
      }
  }
}

/** 当前环境能否弹原生安装窗 */
export function canPromptInstall(): boolean {
  return !!deferred
}

/**
 * 弹原生安装窗。
 * 返回 accepted（用户装了）/ dismissed（用户取消）/ unavailable（不支持，请走手动步骤）
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable'
  try {
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    deferred = null
    installReady.value = false
    return outcome === 'accepted' ? 'accepted' : 'dismissed'
  } catch {
    deferred = null
    installReady.value = false
    return 'unavailable'
  }
}

/** 应用启动时调用一次：挂上事件监听，初始化状态 */
export function initInstall(): void {
  if (typeof window === 'undefined') return
  installed.value = isStandalone()
  window.addEventListener('beforeinstallprompt', (e) => {
    // 拦下浏览器自带的横幅，改由设置页里的按钮触发，避免打扰用户
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    installReady.value = true
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installReady.value = false
    installed.value = true
  })
}

/**
 * 注册 Service Worker（断网也能打开的关键）。
 * 只在生产环境注册：开发时 vite 的 HMR 与缓存会互相打架。
 *
 * V2.0-17：缓存名改成随构建版本变化（见 public/sw.js 的说明）之后，
 * 老用户被钉在旧缓存的问题已经解决；这里再补一层「新 SW 接管后自动刷新一次」，
 * 让用户**打开就看到新版**，不用等下一次冷启动。
 *
 * ⚠️ 但绝不无条件刷新：用户可能正在录采购单/销售单，刷一下就把填好的数据冲没了。
 * 所以只在「本次会话还没发生任何交互」时才刷 —— 冷启动那一刻用户还没来得及点，
 * 刷新是安全的；已经在操作就交给下次打开，那也正是版本化缓存名兜住的部分。
 */
const SW_RELOAD_KEY = 'erp_sw_reloaded_once'

export function registerServiceWorker(isProd: boolean): void {
  if (!isProd) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (typeof window !== 'undefined' && !/^https?:$/.test(window.location.protocol)) return

  // 首次安装 Service Worker 时本来就没有 controller，装好后不该触发一次无谓的刷新
  const hadController = !!navigator.serviceWorker.controller

  let userInteracted = false
  const markInteracted = () => { userInteracted = true }
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(ev, markInteracted, { once: true, passive: true })
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return
    if (userInteracted) return
    try {
      if (sessionStorage.getItem(SW_RELOAD_KEY)) return
      sessionStorage.setItem(SW_RELOAD_KEY, '1')
    } catch {
      // 隐私模式下拿不到 sessionStorage：宁可不刷，也不要冒「无限刷新」的险
      return
    }
    window.location.reload()
  })

  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL || './'
    navigator.serviceWorker
      /**
       * updateViaCache: 'none' —— 更新检查连 HTTP 缓存都不走。
       * 默认值 'imports' 理论上已让主脚本绕过 HTTP 缓存，但各家实现历来有差异，
       * 显式关掉最保险：发一次新版，用户打开就该拿到。
       */
      .register(`${base}sw.js`, { updateViaCache: 'none' })
      .then(reg => {
        /**
         * 注册完成后**主动**再查一次有没有新版本。
         *
         * 浏览器对 SW 的自动更新检查是**有节流**的：距上次检查没隔多久就会跳过。
         * 实测（本地 http 服务 + 发一次新版）只靠 register() 时，刷新后缓存仍停在
         * 上一个版本，直到显式调用 update() 才立刻切到新版本。对「发一次新版，
         * 用户打开就该看到」这种预期来说，等浏览器自己想起来太被动了，这里直接催一下。
         * sw.js 只有几 KB，代价可以忽略。
         */
        return reg.update().catch(() => undefined)
      })
      .catch(() => {
        // 注册失败不影响主流程（比如 file:// 打开、或浏览器禁用了 SW）
      })
  })
}
