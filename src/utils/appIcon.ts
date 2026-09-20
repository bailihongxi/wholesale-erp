/**
 * 应用图标（第十六轮）
 * ----------------------------------------------------------------
 * 需求：系统里能改「应用图标」，改完后
 *   1. 浏览器标签 / 收藏夹的图标立刻变；
 *   2. 苹果手机「添加到主屏幕」、安卓「发送到桌面」生成的快捷方式，
 *      用的也是改过的这张图。
 *
 * 做法：
 *  - 用 canvas 把「emoji/文字」或「上传的图片」画成 32/180/192/512 四张 PNG，
 *    直接替换 <link rel="icon"> 与 <link rel="apple-touch-icon">，不用刷新；
 *  - 同时重建一份 manifest（图标换成刚画出来的 dataURL）并用 Blob URL 顶上，
 *    这样安卓安装到桌面时读到的就是新图标。
 *
 * 为什么保留「内置图」这一档：用户点了「恢复默认」要能回到 public/icons 里的
 * 品牌图，所以启动时先把 index.html 里原始 href 记下来，恢复时写回去。
 */
import { APP_ICON_BG_PRESETS, type AppIconSetting } from './brand'

/** 图标底色渐变的两端，与 public/icons 的默认图一致 */
export const ICON_BG_TOP = '#16325c'
export const ICON_BG_BOTTOM = '#2f6bff'

/** 需要生成的尺寸：标签页 / 苹果主屏 / 安卓桌面 / 商店大图 */
const FAVICON_SIZE = 32
const APPLE_SIZE = 180
const ANDROID_SIZE = 192
const LARGE_SIZE = 512

export interface IconLinkSnapshot {
  favicon32: string
  favicon192: string
  apple: string
  manifest: string
}

/** 启动时抓一次的原始链接，用于「恢复默认」 */
let snapshot: IconLinkSnapshot | null = null
/** 上一次生成的 manifest Blob URL，切换时回收，避免内存泄漏 */
let lastManifestUrl: string | null = null

function linkOf(rel: string, sizes?: string): HTMLLinkElement | null {
  const sel = sizes ? `link[rel="${rel}"][sizes="${sizes}"]` : `link[rel="${rel}"]`
  return document.querySelector<HTMLLinkElement>(sel)
}

/** 拿到 canvas 2d 上下文；极老环境或测试环境可能没有 */
function ctxOf(size: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return canvas.getContext('2d')
}

/** 判断一个底色是否偏亮 —— 亮底上要用深色字，否则看不清 */
export function isLightColor(color: string): boolean {
  const hex = color.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return false
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  // 感知亮度（人眼对绿色更敏感）
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255 > 0.72
}

/** 底色是 light 时前景用深色，其余用白色 */
export function glyphColorOf(bg: string): string {
  if (bg === 'gradient') return '#ffffff'
  return isLightColor(bg) ? '#16325c' : '#ffffff'
}

function paintBackground(ctx: CanvasRenderingContext2D, size: number, bg: string): void {
  if (bg === 'gradient') {
    const grad = ctx.createLinearGradient(0, 0, 0, size)
    grad.addColorStop(0, ICON_BG_TOP)
    grad.addColorStop(1, ICON_BG_BOTTOM)
    ctx.fillStyle = grad
  } else {
    ctx.fillStyle = bg
  }
  ctx.fillRect(0, 0, size, size)
}

/** 内置图标的矢量版：白色纸箱（与 public/icons 的 PNG 同一造型） */
function drawBuiltinBox(ctx: CanvasRenderingContext2D, size: number, color: string): void {
  const u = size / 512 // 设计稿基准 512
  const rect = (x: number, y: number, w: number, h: number, r: number): void => {
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x * u, y * u, w * u, h * u, r * u)
    else ctx.rect(x * u, y * u, w * u, h * u)
    ctx.fill()
  }
  ctx.fillStyle = color
  rect(96, 140, 320, 72, 26) // 箱盖
  rect(96, 196, 320, 224, 26) // 箱体
  // 掏空箱体内部，形成描边
  ctx.globalCompositeOperation = 'destination-out'
  rect(126, 226, 260, 164, 14)
  ctx.globalCompositeOperation = 'source-over'
  rect(238, 140, 36, 280, 6) // 封箱胶带
}

/** 把 emoji / 文字画在正中间 */
function drawText(ctx: CanvasRenderingContext2D, size: number, text: string, color: string): void {
  const t = text.trim()
  if (!t) return
  // 1 个字放大些，2~6 个字相应缩小，保证不溢出
  const scale = t.length <= 1 ? 0.62 : t.length === 2 ? 0.5 : t.length <= 3 ? 0.4 : 0.32
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.round(size * scale)}px -apple-system, "PingFang SC", "Microsoft YaHei", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
  ctx.fillText(t, size / 2, size / 2 + size * 0.02)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解析失败'))
    img.src = src
  })
}

/**
 * 把应用图标渲染成 PNG dataURL。
 * 传 bg = 'transparent' 时不给底色（上传的图片用它，保留原图透明区）。
 */
export async function renderAppIcon(
  icon: AppIconSetting,
  bg: string,
  size: number
): Promise<string> {
  const ctx = ctxOf(size)
  if (!ctx) return '' // 无 canvas（极老浏览器 / 测试环境）：调用方回落到内置图

  if (icon.type === 'image' && icon.value) {
    try {
      const img = await loadImage(icon.value)
      // 上传的图片自带设计，直接铺满，不叠加底色
      const scale = Math.max(size / img.width, size / img.height)
      const w = img.width * scale
      const h = img.height * scale
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
      return ctx.canvas.toDataURL('image/png')
    } catch {
      return ''
    }
  }

  if (bg !== 'transparent') paintBackground(ctx, size, bg)
  const color = glyphColorOf(bg)
  if (icon.type === 'builtin') drawBuiltinBox(ctx, size, color)
  else drawText(ctx, size, icon.value, color)
  return ctx.canvas.toDataURL('image/png')
}

/** 把 index.html 里的原始 href 记下来（只在第一次调用时记录） */
export function snapshotIconLinks(): void {
  if (snapshot || typeof document === 'undefined') return
  snapshot = {
    favicon32: linkOf('icon', '32x32')?.href ?? '',
    favicon192: linkOf('icon', '192x192')?.href ?? '',
    apple: linkOf('apple-touch-icon')?.href ?? '',
    manifest: linkOf('manifest')?.href ?? ''
  }
}

/** 恢复成 public/icons 里的内置图 */
export function restoreBuiltinIconLinks(): void {
  snapshotIconLinks()
  if (!snapshot) return
  const icons = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')
  icons.forEach((el, i) => {
    // 两张 icon：按 sizes 对应回写，多余的自定义图标删掉
    const target = el.getAttribute('sizes') === '192x192' ? snapshot!.favicon192 : snapshot!.favicon32
    if (target) el.href = target
    else if (i > 1) el.remove()
  })
  const apple = linkOf('apple-touch-icon')
  if (apple && snapshot.apple) apple.href = snapshot.apple
  const manifest = linkOf('manifest')
  if (manifest && snapshot.manifest) manifest.href = snapshot.manifest
  if (lastManifestUrl) {
    URL.revokeObjectURL(lastManifestUrl)
    lastManifestUrl = null
  }
}

/** 拼一份新的 manifest：图标换成刚渲染出来的 dataURL */
export function buildManifest(icons: { small: string; large: string }, pageUrl: string): string {
  const abs = (p: string): string => new URL(p, pageUrl).href
  return JSON.stringify({
    id: 'wholesale-erp',
    name: '家电批发进销存 ERP',
    short_name: '批发ERP',
    description: '进货 · 库存 · 销售 · 对账 全流程管理。数据保存在本机，断网也能打开。',
    lang: 'zh-CN',
    start_url: abs('./'),
    scope: abs('./'),
    display: 'standalone',
    background_color: '#f4f6fa',
    theme_color: ICON_BG_TOP,
    icons: [
      { src: icons.small, sizes: `${ANDROID_SIZE}x${ANDROID_SIZE}`, type: 'image/png', purpose: 'any' },
      { src: icons.large, sizes: `${LARGE_SIZE}x${LARGE_SIZE}`, type: 'image/png', purpose: 'any' },
      // 保底：即使个别浏览器不认 dataURL 图标，安装仍能用这张品牌图
      { src: abs('./icons/icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts: [
      { name: '销售开单', url: abs('./#/sales/create') },
      { name: '采购入库', url: abs('./#/purchase/create') },
      { name: '库存预警', url: abs('./#/stock') }
    ]
  })
}

/**
 * 应用图标设置生效：改标签页图标 + 苹果主屏图标 + manifest。
 * 内置档位就回到 index.html 的原始链接。
 */
export async function applyAppIcon(icon: AppIconSetting, bg: string): Promise<boolean> {
  snapshotIconLinks()
  if (icon.type === 'builtin') {
    restoreBuiltinIconLinks()
    return true
  }
  if (icon.type === 'text' && !icon.value.trim()) {
    restoreBuiltinIconLinks()
    return true
  }

  const [small, apple, android, large] = await Promise.all([
    renderAppIcon(icon, bg, FAVICON_SIZE),
    renderAppIcon(icon, bg, APPLE_SIZE),
    renderAppIcon(icon, bg, ANDROID_SIZE),
    renderAppIcon(icon, bg, LARGE_SIZE)
  ])
  // 渲染不出来（无 canvas）就保持原样，别把图标弄成空白
  if (!android || !large) return false

  const fav32 = linkOf('icon', '32x32')
  const fav192 = linkOf('icon', '192x192')
  if (fav32 && small) fav32.href = small
  if (fav192) fav192.href = android
  const appleLink = linkOf('apple-touch-icon')
  if (appleLink && apple) appleLink.href = apple

  const manifestLink = linkOf('manifest')
  if (manifestLink) {
    try {
      const json = buildManifest({ small: android, large }, window.location.href)
      const blob = new Blob([json], { type: 'application/manifest+json' })
      const url = URL.createObjectURL(blob)
      manifestLink.href = url
      if (lastManifestUrl) URL.revokeObjectURL(lastManifestUrl)
      lastManifestUrl = url
    } catch {
      /* 拼装失败就不动原来的 manifest */
    }
  }
  return true
}

/** 供设置页做底色选项（数据来自 brand.ts，这里只是转出去方便面板复用） */
export const ICON_BG_CHOICES = APP_ICON_BG_PRESETS
