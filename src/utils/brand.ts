/**
 * 品牌与图标配置（第十二轮）
 * ----------------------------------------------------------------
 * 需求：网页版的「快捷图标」样式、登录页的头像，以及各角色的头像，
 * 都希望能在系统里自己改，而不是写死在代码里。
 *
 * 设计：
 *  - 全部存 localStorage（键 erp_brand_config），可随整库备份/云同步一起走；
 *  - 用模块级 ref 保存，全局响应式 —— 在「系统设置」里改完，
 *    侧边栏 / 手机端 Tab / 顶栏头像立即跟着变，不需要刷新；
 *  - 图标支持「emoji（或任意 1~2 个字）」与「上传图片（自动压成 96px 方图）」两种；
 *  - 任何字段缺省都回落到 navConfig 里的默认 emoji，升级不会把菜单图标变空。
 */
import { ref, computed } from 'vue'
import { ALL_MODULES, ROLE_LABELS, type NavItem } from '../router/navConfig'

import { touchSetting, onSettingsReloaded } from './settingsSync'

const STORAGE_KEY = 'erp_brand_config'

/** 图标可以是 emoji / 短文字，也可以是一张图片（dataURL） */
export interface BrandIcon {
  type: 'text' | 'image'
  value: string
}

/** 应用图标（桌面快捷方式 / 浏览器标签 / 添加到主屏幕 用的那张图） */
export type AppIconSource = 'builtin' | 'text' | 'image'

export interface AppIconSetting {
  /** builtin = 用内置的品牌图标（public/icons 里的默认图） */
  type: AppIconSource
  /** text 时是 emoji/文字；image 时是 dataURL 图片；builtin 时留空 */
  value: string
}

/** 应用图标默认值：内置图，未做任何自定义 */
export const DEFAULT_APP_ICON: AppIconSetting = { type: 'builtin', value: '' }

/** 图标底色预设：gradient 为品牌蓝渐变，其余为纯色 */
export const APP_ICON_BG_PRESETS: { key: string; label: string }[] = [
  { key: 'gradient', label: '品牌蓝渐变' },
  { key: '#16325c', label: '深海蓝' },
  { key: '#2f6bff', label: '亮蓝' },
  { key: '#1f2937', label: '墨黑' },
  { key: '#f97316', label: '橘红' },
  { key: '#10b981', label: '翡翠绿' },
  { key: '#ffffff', label: '纯白' }
]

export const DEFAULT_APP_ICON_BG = 'gradient'

export interface BrandConfig {
  /** 登录页左侧品牌区的标志 */
  loginLogo: BrandIcon
  /** 登录页主标题（公司名可自定义） */
  loginTitle: string
  /** 登录页副标题 */
  loginSub: string
  /** 侧边栏左上角标志 */
  sideLogo: BrandIcon
  /** 各角色头像：老板 / 采购 / 销售 / 财务 / 库房 / 经销商 */
  roleAvatars: Record<string, BrandIcon>
  /** 模块快捷图标：route -> emoji（缺省用 navConfig 默认值） */
  moduleIcons: Record<string, string>
  /** 应用图标：桌面快捷方式 / 浏览器标签 / 添加到主屏幕（第十六轮） */
  appIcon: AppIconSetting
  /** 应用图标底色：gradient 或 #rrggbb */
  appIconBg: string
}

/** 各角色头像的默认值（emoji），可被用户覆盖 */
export const DEFAULT_ROLE_AVATARS: Record<string, string> = {
  boss: '👑',
  purchaser: '🛒',
  sales: '💼',
  finance: '🧾',
  warehouse: '📦',
  dealer: '🏪'
}

/** 可配置头像的角色（与 ROLE_LABELS 对齐，顺序固定便于展示） */
export const AVATAR_ROLES: string[] = ['boss', 'purchaser', 'sales', 'finance', 'warehouse', 'dealer']

export function roleLabelOf(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/** 系统名称的出厂默认值；index.html 的首屏加载页写的是同一个字面量 */
export const DEFAULT_SYSTEM_NAME = '家电批发ERP'

function defaultConfig(): BrandConfig {
  const roleAvatars: Record<string, BrandIcon> = {}
  for (const r of AVATAR_ROLES) {
    roleAvatars[r] = { type: 'text', value: DEFAULT_ROLE_AVATARS[r] ?? '👤' }
  }
  return {
    loginLogo: { type: 'text', value: 'ERP' },
    loginTitle: DEFAULT_SYSTEM_NAME,
    loginSub: '进货 · 库存 · 销售 · 对账 全流程管理',
    sideLogo: { type: 'text', value: 'ERP' },
    roleAvatars,
    moduleIcons: {},
    appIcon: { ...DEFAULT_APP_ICON },
    appIconBg: DEFAULT_APP_ICON_BG
  }
}

function read(): BrandConfig {
  const base = defaultConfig()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as Partial<BrandConfig>
    return {
      ...base,
      ...saved,
      loginLogo: { ...base.loginLogo, ...(saved.loginLogo ?? {}) },
      sideLogo: { ...base.sideLogo, ...(saved.sideLogo ?? {}) },
      roleAvatars: { ...base.roleAvatars, ...(saved.roleAvatars ?? {}) },
      moduleIcons: { ...base.moduleIcons, ...(saved.moduleIcons ?? {}) },
      // 老版本 localStorage 里没有 appIcon，缺省即内置图，升级不会变成空白图标
      appIcon: { ...base.appIcon, ...(saved.appIcon ?? {}) },
      appIconBg: saved.appIconBg ?? base.appIconBg
    }
  } catch {
    // 配置损坏时静默回落默认值，绝不让页面因为一段脏 localStorage 打不开
    return base
  }
}

/** 全局响应式配置 */
const config = ref<BrandConfig>(read())

/**
 * 把「系统名称」同步到浏览器标签页标题与苹果主屏名称。
 *
 * index.html 的首屏加载页（#app-boot）读的是同一份 localStorage 配置，
 * 两边取值一致 —— 刷新时加载页显示的名字不会和进来之后的标题打架。
 */
function syncDocumentTitle(title: string): void {
  if (typeof document === 'undefined') return
  const name = title.trim() || DEFAULT_SYSTEM_NAME
  document.title = name
  const apple = document.querySelector('meta[name="apple-mobile-web-app-title"]')
  if (apple) apple.setAttribute('content', name)
}

// import 时就先对齐一次（标签页标题等于「系统名称」）
syncDocumentTitle(config.value.loginTitle)

async function persist(): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config.value))
  } catch {
    /* 隐私模式 / 配额满：内存里仍然生效，只是不落盘 */
  }
  syncDocumentTitle(config.value.loginTitle)
  // 推到云端，手机和电脑共用同一套品牌配置（V2.0-6）
  touchSetting(STORAGE_KEY)
}

/**
 * 重新从本机缓存（localStorage）读一遍品牌配置。
 * 启动时云端拉取会把新值写进 localStorage，但 config 这个模块级 ref
 * 在 import 时就已经初始化过了，不会自动感知 —— 所以必须显式重载一次。
 */
export function reloadBrand(): void {
  config.value = read()
  // 云端拉下来的系统名称可能是别的设备改的，标题跟着一起换
  syncDocumentTitle(config.value.loginTitle)
}

// 云端设置被拉下来之后，自动把内存里的品牌配置刷新成最新值
onSettingsReloaded(reloadBrand)

/**
 * 启动时同步品牌配置（多设备共享，V2.0-6）。
 *
 * 说明：云端读写已统一交给 settingsSync 引擎，这里不再单独发请求 ——
 * initSettingSync() 一次拉完全部设置写进 localStorage，本函数只负责
 * 把最新的 localStorage 重新灌进内存 ref。
 */
export async function loadBrandFromCloud(): Promise<void> {
  try {
    const { initSettingSync } = await import('./settingsSync')
    await initSettingSync()
  } catch {
    /* 云端不可用：保留本机设置 */
  }
  reloadBrand()
}

/** 模块快捷图标：用户改过就用改过的，否则用 navConfig 的默认 emoji */
function iconOf(item: NavItem): string {
  const custom = config.value.moduleIcons[item.route]
  return custom && custom.trim() ? custom : item.icon
}

/** 某角色头像（含默认兜底） */
function roleAvatar(role: string | null | undefined): BrandIcon {
  if (!role) return { type: 'text', value: '👤' }
  return config.value.roleAvatars[role] ?? { type: 'text', value: DEFAULT_ROLE_AVATARS[role] ?? '👤' }
}

export function useBrand() {
  return {
    config,
    /** 全部模块的快捷图标（供设置页渲染清单） */
    modules: computed(() => ALL_MODULES),
    iconOf,
    roleAvatar,
    setLoginLogo(v: BrandIcon): void {
      config.value = { ...config.value, loginLogo: { ...v } }
      void persist()
    },
    setSideLogo(v: BrandIcon): void {
      config.value = { ...config.value, sideLogo: { ...v } }
      void persist()
    },
    setLoginText(title: string, sub: string): void {
      config.value = { ...config.value, loginTitle: title, loginSub: sub }
      void persist()
    },
    setModuleIcon(route: string, icon: string): void {
      config.value = {
        ...config.value,
        moduleIcons: { ...config.value.moduleIcons, [route]: icon }
      }
      void persist()
    },
    setAppIcon(v: AppIconSetting): void {
      config.value = { ...config.value, appIcon: { ...v } }
      void persist()
    },
    setAppIconBg(bg: string): void {
      config.value = { ...config.value, appIconBg: bg }
      void persist()
    },
    resetAppIcon(): void {
      config.value = { ...config.value, appIcon: { ...DEFAULT_APP_ICON }, appIconBg: DEFAULT_APP_ICON_BG }
      void persist()
    },
    setRoleAvatar(role: string, v: BrandIcon): void {
      config.value = {
        ...config.value,
        roleAvatars: { ...config.value.roleAvatars, [role]: { ...v } }
      }
      void persist()
    },
    resetModuleIcons(): void {
      config.value = { ...config.value, moduleIcons: {} }
      void persist()
    },
    resetRoleAvatars(): void {
      const roleAvatars: Record<string, BrandIcon> = {}
      for (const r of AVATAR_ROLES) {
        roleAvatars[r] = { type: 'text', value: DEFAULT_ROLE_AVATARS[r] ?? '👤' }
      }
      config.value = { ...config.value, roleAvatars }
      void persist()
    },
    resetAll(): void {
      config.value = defaultConfig()
      void persist()
    }
  }
}
