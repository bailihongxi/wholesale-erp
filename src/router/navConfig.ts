// 角色导航配置：电脑端侧边栏（完整模块）与手机端底部 Tab（每个角色 3 个）。
// 以此作为 AppLayout 渲染导航的唯一数据源，保证双端一致。
// icon 使用 emoji，便于在自定义组件中直接渲染，无需依赖图标字体。
//
// 说明（2026-09-19 菜单去重）：
// 原「库存查询」与「库存管理」合并为统一的「库存管理」/stock；
// 原「经销商」与「客户管理」合并为统一的「客户管理」/customers；
// 原「毛利核算」并入「经营报表」/boss/reports（报表内提供日期筛选与毛利区块）。
// 旧路径在 router 中保留重定向，收藏夹不会失效。
//
// 说明（第八轮 · 角色权限）：
// ALL_MODULES 是系统里「全部可分配模块」的清单，员工管理页的权限配置
// 就以它为开关矩阵。每个角色默认勾中的模块见 DEFAULT_ROLE_PERMS；
// 老板改完之后，该角色登录只看得到勾中的模块（见 stores/permission.ts）。

export interface NavItem {
  label: string
  icon: string
  route: string
  /** 分组名，供权限配置页按组展示 */
  group?: string
  /** 该模块的用途说明，权限开关旁的小字提示 */
  desc?: string
}

export interface RoleNav {
  sidebar: NavItem[]
  tabbar: NavItem[]
}

export type ModuleGroup = '工作台' | '业务' | '库存' | '财务' | '系统'

/** 分组顺序：权限配置页与侧边栏都按此顺序排列 */
export const MODULE_GROUPS: ModuleGroup[] = ['工作台', '业务', '库存', '财务', '系统']

/**
 * 系统全部可分配模块。
 * 新增功能时只需要在下面加一行，权限配置页、侧边栏、路由守卫都会自动纳入。
 */
export const ALL_MODULES: NavItem[] = [
  // ===== 工作台 =====
  { label: '工作台', icon: '🏠', route: '/boss/home', group: '工作台', desc: '老板经营总览与待办' },
  { label: '采购工作台', icon: '🏠', route: '/purchase/home', group: '工作台', desc: '采购待办与统计' },
  { label: '销售工作台', icon: '🏠', route: '/sales/home', group: '工作台', desc: '销售待办与业绩' },
  { label: '财务工作台', icon: '🏠', route: '/finance/home', group: '工作台', desc: '应收应付概览' },
  { label: '库房工作台', icon: '🏠', route: '/warehouse/home', group: '工作台', desc: '待收待发概览' },
  // ===== 业务 =====
  { label: '商品档案', icon: '📦', route: '/boss/products', group: '业务', desc: '商品增删改查与导入导出' },
  { label: '采购管理', icon: '🛒', route: '/purchase/orders', group: '业务', desc: '采购单新建与跟踪' },
  { label: '销售管理', icon: '💰', route: '/sales/orders', group: '业务', desc: '销售单新建与跟踪' },
  { label: '客户管理', icon: '👥', route: '/customers', group: '业务', desc: '客户档案与经销商' },
  { label: '供应商', icon: '🏭', route: '/purchase/suppliers', group: '业务', desc: '供应商档案' },
  // ===== 库存 =====
  { label: '库存管理', icon: '🗃️', route: '/stock', group: '库存', desc: '库存明细与多库房分布' },
  { label: '库存作业', icon: '🧱', route: '/warehouse', group: '库存', desc: '验货/拣货/调拨/盘点/退换货' },
  // ===== 财务 =====
  { label: '财务管理', icon: '🧾', route: '/finance', group: '财务', desc: '对账 / 经营报表 / 记一笔' },
  { label: '经营报表', icon: '📊', route: '/boss/reports', group: '财务', desc: '销售趋势与毛利分析' },
  // ===== 系统 =====
  { label: '员工管理', icon: '👤', route: '/boss/users', group: '系统', desc: '员工账号与角色权限' },
  { label: '操作日志', icon: '📜', route: '/boss/audit-logs', group: '系统', desc: '全站操作痕迹' },
  { label: '系统设置', icon: '⚙️', route: '/boss/settings', group: '系统', desc: '公司信息 / 备份 / 云同步' }
]

/** 路由 -> 模块定义，便于按路由反查图标与名称 */
export const MODULE_BY_ROUTE: Record<string, NavItem> = Object.fromEntries(
  ALL_MODULES.map(m => [m.route, m])
)

/** 全部模块路由（权限校验与过滤的合法池） */
export const ALL_MODULE_ROUTES: string[] = ALL_MODULES.map(m => m.route)

/**
 * 各角色的默认可见模块。
 * 第一次使用（或点了「恢复默认」）时按这份清单渲染侧边栏。
 */
export const DEFAULT_ROLE_PERMS: Record<string, string[]> = {
  boss: [
    '/boss/home', '/boss/products', '/stock', '/warehouse',
    '/purchase/orders', '/sales/orders', '/customers', '/purchase/suppliers',
    '/finance', '/boss/users', '/boss/audit-logs', '/boss/settings'
  ],
  purchaser: ['/purchase/home', '/purchase/orders', '/purchase/suppliers'],
  sales: ['/sales/home', '/sales/orders', '/customers'],
  finance: ['/finance/home', '/finance', '/stock'],
  warehouse: ['/warehouse/home', '/warehouse', '/stock']
}

/** 角色显示名 */
export const ROLE_LABELS: Record<string, string> = {
  boss: '老板',
  purchaser: '采购',
  sales: '销售',
  finance: '财务',
  warehouse: '库房',
  dealer: '经销商'
}

/** 可配置权限的角色（老板为最高权限，不需要配置） */
export const CONFIGURABLE_ROLES: string[] = ['purchaser', 'sales', 'finance', 'warehouse']

/** 把路由数组转成菜单项（自动剔除已下线模块，保持清单顺序） */
export function modulesOf(routes: string[]): NavItem[] {
  return routes
    .map(r => MODULE_BY_ROUTE[r])
    .filter((i): i is NavItem => Boolean(i))
}

export const navConfig: Record<string, RoleNav> = {
  boss: {
    sidebar: modulesOf(DEFAULT_ROLE_PERMS.boss),
    tabbar: [
      { label: '工作台', icon: '🏠', route: '/boss/home' },
      { label: '业务', icon: '🧩', route: '/boss/business' },
      { label: '我的', icon: '👤', route: '/boss/mine' }
    ]
  },
  purchaser: {
    sidebar: modulesOf(DEFAULT_ROLE_PERMS.purchaser),
    tabbar: [
      { label: '工作台', icon: '🏠', route: '/purchase/home' },
      { label: '采购单', icon: '🛒', route: '/purchase/orders' },
      { label: '我的', icon: '👤', route: '/purchase/mine' }
    ]
  },
  sales: {
    sidebar: modulesOf(DEFAULT_ROLE_PERMS.sales),
    tabbar: [
      { label: '工作台', icon: '🏠', route: '/sales/home' },
      { label: '销售单', icon: '💰', route: '/sales/orders' },
      { label: '我的', icon: '👤', route: '/sales/mine' }
    ]
  },
  finance: {
    sidebar: modulesOf(DEFAULT_ROLE_PERMS.finance),
    tabbar: [
      { label: '工作台', icon: '🏠', route: '/finance/home' },
      { label: '财务', icon: '🧾', route: '/finance' },
      { label: '我的', icon: '👤', route: '/finance/mine' }
    ]
  },
  warehouse: {
    sidebar: modulesOf(DEFAULT_ROLE_PERMS.warehouse),
    tabbar: [
      { label: '工作台', icon: '🏠', route: '/warehouse/home' },
      { label: '库存作业', icon: '🧱', route: '/warehouse' },
      { label: '库存', icon: '🗃️', route: '/stock' }
    ]
  }
}

export function getNav(role: string | null): RoleNav {
  if (role && navConfig[role]) return navConfig[role]
  return { sidebar: [], tabbar: [] }
}
