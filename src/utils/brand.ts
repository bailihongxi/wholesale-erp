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

const STORAGE_KEY = 'erp_brand_config'

/** 图标可以是 emoji / 短文字，也可以是一张图片（dataURL） */
export interface BrandIcon {
  type: 'text' | 'image'
  value: string
}

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

function defaultConfig(): BrandConfig {
  const roleAvatars: Record<string, BrandIcon> = {}
  for (const r of AVATAR_ROLES) {
    roleAvatars[r] = { type: 'text', value: DEFAULT_ROLE_AVATARS[r] ?? '👤' }
  }
  return {
    loginLogo: { type: 'text', value: 'ERP' },
    loginTitle: '家电批发ERP',
    loginSub: '进货 · 库存 · 销售 · 对账 全流程管理',
    sideLogo: { type: 'text', value: 'ERP' },
    roleAvatars,
    moduleIcons: {}
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
      moduleIcons: { ...base.moduleIcons, ...(saved.moduleIcons ?? {}) }
    }
  } catch {
    // 配置损坏时静默回落默认值，绝不让页面因为一段脏 localStorage 打不开
    return base
  }
}

/** 全局响应式配置 */
const config = ref<BrandConfig>(read())

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config.value))
  } catch {
    /* 隐私模式 / 配额满：内存里仍然生效，只是不落盘 */
  }
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
      persist()
    },
    setSideLogo(v: BrandIcon): void {
      config.value = { ...config.value, sideLogo: { ...v } }
      persist()
    },
    setLoginText(title: string, sub: string): void {
      config.value = { ...config.value, loginTitle: title, loginSub: sub }
      persist()
    },
    setModuleIcon(route: string, icon: string): void {
      config.value = {
        ...config.value,
        moduleIcons: { ...config.value.moduleIcons, [route]: icon }
      }
      persist()
    },
    setRoleAvatar(role: string, v: BrandIcon): void {
      config.value = {
        ...config.value,
        roleAvatars: { ...config.value.roleAvatars, [role]: { ...v } }
      }
      persist()
    },
    resetModuleIcons(): void {
      config.value = { ...config.value, moduleIcons: {} }
      persist()
    },
    resetRoleAvatars(): void {
      const roleAvatars: Record<string, BrandIcon> = {}
      for (const r of AVATAR_ROLES) {
        roleAvatars[r] = { type: 'text', value: DEFAULT_ROLE_AVATARS[r] ?? '👤' }
      }
      config.value = { ...config.value, roleAvatars }
      persist()
    },
    resetAll(): void {
      config.value = defaultConfig()
      persist()
    }
  }
}
