/**
 * 系统设置云端同步（V2.0-6）
 *
 * 目标：电脑和手机打开同一个系统，看到的公司抬头、打印模板、价格规则、
 * App 图标、菜单排序完全一致 —— 不用在每台设备上各配一遍。
 *
 * 设计要点：
 * 1. **零侵入**：各设置模块仍照旧读写 localStorage，把它们当成「本机缓存」。
 *    这里只在「写入之后」补一次云端推送，在「启动之前」做一次拉取，
 *    因此现有读取逻辑和上百条既有用例都不用改。
 * 2. **冲突策略 = last-write-wins**：每条设置带 updatedAt，谁新听谁的。
 *    本地更新时间记在本机 `erp_settings_sync_meta`（不参与同步）。
 * 3. **首次迁移**：老用户本地已有设置、云端还没有 → 启动时自动补推上去，
 *    历史配置不会丢。
 * 4. **安全边界**：登录态 / 会话 / 记住账号 **绝不**同步（否则一台设备输错
 *    密码会把全公司锁住）；侧边栏折叠、面板展开这类「设备本机 UI 状态」
 *    也留在本地（手机和电脑的布局本来就不同，同步会互相打架）。
 * 5. **优雅降级**：表没建、断网、Supabase 报错 —— 全部静默，本地照常可用。
 */
import { USE_CLOUD } from '../db/supabaseClient'

/** 云端表名（与 supabase/schema.sql 保持一致） */
const TABLE = 'systemSettings'

/** 本机记录各设置「最后写入时间」的键（本身不参与同步） */
const META_KEY = 'erp_settings_sync_meta'

/**
 * 参与云端同步的设置键 —— 白名单机制。
 * 只有这里列出的才上传，**不在名单里的一律不同步**，
 * 避免哪天新增 localStorage 键时被意外带到别的设备上。
 */
export const SYNC_KEYS: readonly string[] = [
  'erp_company',          // 公司抬头 / 开票信息
  'erp_print_settings',   // 打印模板：纸张、抬头、列宽、脚注
  'erp_price_rule',       // 价格规则：批发 / 零售加价率、取整方式
  'erp_brand_config'      // 品牌：登录 logo、菜单图标、App 图标
]

/** 参与同步的键前缀（菜单排序按角色各存一条） */
const SYNC_PREFIXES: readonly string[] = ['erp_menu_order_']

/** 判断某个 localStorage 键是否需要跨设备同步 */
export function isSyncKey(key: string): boolean {
  return SYNC_KEYS.includes(key) || SYNC_PREFIXES.some(p => key.startsWith(p))
}

type Meta = Record<string, string>

/** 云端 systemSettings 的一行 */
interface SettingsRow {
  key?: string
  value?: unknown
  updatedAt?: string
}

function readMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Meta) : {}
  } catch {
    return {}
  }
}

function writeMeta(meta: Meta): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    /* 隐私模式等：元信息丢失最多导致多同步一次，不影响功能 */
  }
}

/** 取出 localStorage 里某个键的 JSON 值；不存在或损坏返回 undefined */
function readValue(key: string): unknown | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return undefined
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** 拉取 supabase 客户端；失败返回 null（测试环境 / 模块未就绪） */
async function getClient() {
  if (!USE_CLOUD) return null
  try {
    const mod = await import('../db/supabaseClient')
    return mod.supabase ?? null
  } catch {
    return null
  }
}

// ------------------------------------------------------------------
// 推送：本地改了 → 告诉云端
// ------------------------------------------------------------------

async function pushOne(key: string, updatedAt: string): Promise<boolean> {
  const sb = await getClient()
  if (!sb) return false
  const value = readValue(key)
  if (value === undefined) return false
  try {
    const { error } = await sb
      .from(TABLE)
      .upsert({ key, value, updatedAt }, { onConflict: 'key' })
    return !error
  } catch {
    return false
  }
}

/**
 * 本地写入设置后调用：记录时间戳并异步推到云端。
 * 同步执行（不 await），调用方无需改成 async。
 */
export function touchSetting(key: string): void {
  if (!isSyncKey(key)) return
  const now = new Date().toISOString()
  const meta = readMeta()
  meta[key] = now
  writeMeta(meta)
  void pushOne(key, now)
}

/**
 * 本地删除设置后调用（如「重置菜单顺序」）：同步删掉云端记录，
 * 否则这台设备恢复了默认，换台设备刷新又被拉回来。
 */
export function forgetSetting(key: string): void {
  if (!isSyncKey(key)) return
  const meta = readMeta()
  delete meta[key]
  writeMeta(meta)
  void (async () => {
    const sb = await getClient()
    if (!sb) return
    try {
      await sb.from(TABLE).delete().eq('key', key)
    } catch {
      /* 表不存在 / 离线：本地已删，忽略 */
    }
  })()
}

// ------------------------------------------------------------------
// 拉取：启动时把云端最新的设置灌进本机 localStorage
// ------------------------------------------------------------------

/**
 * 从云端拉取设置，按 updatedAt 决定谁覆盖谁。
 * @returns 实际被云端覆盖的本机条目数（供设置页显示「已同步 N 项」）
 */
export async function pullSettings(): Promise<number> {
  const sb = await getClient()
  if (!sb) return 0
  let rows: SettingsRow[] = []
  try {
    const res = await sb.from(TABLE).select('key,value,updatedAt')
    if (res.error) return 0
    rows = (res.data ?? []) as SettingsRow[]
  } catch {
    return 0
  }
  if (rows.length === 0) return 0

  const meta = readMeta()
  let changed = 0
  for (const row of rows) {
    const key = row.key
    if (!key || !isSyncKey(key)) continue
    const remoteAt = String(row.updatedAt ?? '')
    const localAt = meta[key] ?? ''
    // 本机这条更新（或一样新）→ 保留本机，等 pushPending 时推上去
    if (localAt && remoteAt <= localAt) continue

    const raw = JSON.stringify(row.value ?? null)
    let cur: string | null = null
    try {
      cur = localStorage.getItem(key)
    } catch {
      cur = null
    }
    if (cur !== raw) {
      try {
        localStorage.setItem(key, raw)
      } catch {
        continue
      }
      changed++
    }
    meta[key] = remoteAt
  }
  writeMeta(meta)
  return changed
}

// ------------------------------------------------------------------
// 迁移 / 补推：本机有、云端没有 → 推上去
// ------------------------------------------------------------------

/**
 * 把本机「云端还没有」的设置补推上去。
 * 首次升级到 V2.0-6 的老用户，历史设置靠这一步搬到云端。
 * @returns 推送成功的条数
 */
export async function pushPending(): Promise<number> {
  const sb = await getClient()
  if (!sb) return 0

  const remoteMap = new Map<string, string>()
  try {
    const res = await sb.from(TABLE).select('key,updatedAt')
    if (res.error) return 0
    for (const r of (res.data ?? []) as Array<{ key?: string; updatedAt?: string }>) {
      if (r.key) remoteMap.set(r.key, String(r.updatedAt ?? ''))
    }
  } catch {
    return 0
  }

  const meta = readMeta()
  let pushed = 0
  for (const key of localSyncKeys()) {
    const localAt = meta[key]
    // 本机从未记录过时间，但确实有值 → 视为历史遗留数据，补时间后上传
    const updatedAt = localAt || new Date().toISOString()
    // 云端没有，或云端明显更旧 → 推
    const remoteAt = remoteMap.get(key)
    if (remoteAt != null && remoteAt >= updatedAt && localAt) continue

    if (await pushOne(key, updatedAt)) {
      meta[key] = updatedAt
      pushed++
    }
  }
  writeMeta(meta)
  return pushed
}

/** 本机实际存在值的、参与同步的键列表 */
function localSyncKeys(): string[] {
  const found: string[] = []
  try {
    for (const key of SYNC_KEYS) {
      if (localStorage.getItem(key) != null) found.push(key)
    }
    // 菜单排序按角色存，键名动态，扫一遍 localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && SYNC_PREFIXES.some(p => k.startsWith(p))) found.push(k)
    }
  } catch {
    /* localStorage 不可用：本机没有可推的 */
  }
  return found
}

// ------------------------------------------------------------------
// 重载钩子：localStorage 变了，但组件创建时已经读进内存的 ref 不会自己更新
// ------------------------------------------------------------------

type Reloader = () => void
const reloaders: Reloader[] = []

/**
 * 注册「设置被云端覆盖后需要重新读取」的模块。
 * 只有模块级 ref（import 时就初始化）才需要注册；
 * 每次调用都现读 localStorage 的模块无需注册。
 */
export function onSettingsReloaded(fn: Reloader): void {
  reloaders.push(fn)
}

function notifyReloaded(): void {
  for (const fn of reloaders) {
    try {
      fn()
    } catch {
      /* 单个模块重载失败不影响其它模块 */
    }
  }
}

// ------------------------------------------------------------------
// 启动入口
// ------------------------------------------------------------------

export interface SyncResult {
  /** 被云端覆盖的本机条目数 */
  pulled: number
  /** 补推到云端的本机条目数 */
  pushed: number
  /** 是否已经具备云端同步能力（false = 表没建或不可用，当前是纯本机模式） */
  cloudReady: boolean
  error?: string
}

/** 云端同步表是否可用：表没建、RLS 拒绝、断网都会返回 false */
async function isTableReady(sb: Awaited<ReturnType<typeof getClient>>): Promise<boolean> {
  if (!sb) return false
  try {
    // head + count 必须写在 from().select() 这一步，链式之后再 select 会被静默忽略。
    //
    // 判据只能用 count，**不能**用 error：表不存在时 PostgREST 对 head 请求
    // 返回的是 `{ error: null, count: null }`（不是报错！），普通 select 才抛 PGRST205。
    // 实测踩过：写成 `!res.error` 会在表没建时误判成「已连接云端」，
    // 用户以为在同步，实际各设备还是各存各的。
    const res = await sb.from(TABLE).select('key', { count: 'exact', head: true })
    return res.error == null && typeof res.count === 'number'
  } catch {
    return false
  }
}

/** 最近一次同步的结果，供设置页展示状态 */
let lastSync: SyncResult = { pulled: 0, pushed: 0, cloudReady: false }

export function getLastSync(): SyncResult {
  return { ...lastSync }
}

/**
 * 应用启动时调用一次：先拉云端最新设置，再把本机独有的补推上去。
 * 建议在 mount 之前 await，这样用户一睁眼看到的就是同步后的样子。
 */
export async function initSettingSync(): Promise<SyncResult> {
  const empty: SyncResult = { pulled: 0, pushed: 0, cloudReady: false }
  lastSync = empty
  if (!USE_CLOUD) return empty
  const sb = await getClient()
  // 表没建（还没执行迁移 SQL）时不要让用户白等，直接降级为本机模式
  if (!(await isTableReady(sb))) return empty
  try {
    const pulled = await pullSettings()
    const pushed = await pushPending()
    if (pulled > 0) notifyReloaded()
    lastSync = { pulled, pushed, cloudReady: true }
    return lastSync
  } catch (e) {
    lastSync = { ...empty, error: e instanceof Error ? e.message : String(e) }
    return lastSync
  }
}

/** 当前最后一次同步的简要信息，供设置页展示 */
export function getSyncSummary(): { keys: string[]; count: number } {
  const meta = readMeta()
  const keys = Object.keys(meta).filter(isSyncKey)
  return { keys, count: keys.length }
}
