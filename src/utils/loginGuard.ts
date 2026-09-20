/**
 * 登录保护（第十八轮）：连续失败锁定 + 会话有效期
 *
 * 这套系统没有服务端，两者都只存在本机 localStorage。目的不是防专业攻击，
 * 而是防「共用电脑上有人坐在登录页反复猜密码」和「登录一次就永远在线」。
 */

const FAIL_KEY = 'erp_login_fail'
const SESSION_KEY = 'erp_session'
/** 第十六轮及以前只存了这个 id，没有过期时间；保留以兼容老会话 */
const LEGACY_KEY = 'erp_current_user_id'

/** 连续失败多少次后锁定 */
export const MAX_FAILS = 5
/** 锁定时长 */
export const LOCK_MS = 5 * 60 * 1000
/** 会话有效期：期间只要用一次就自动续期，等于「7 天没打开过就重新登录」 */
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000

interface FailRecord {
  count: number
  lockedUntil: number
}
type FailMap = Record<string, FailRecord>

function readFails(): FailMap {
  try {
    const raw = localStorage.getItem(FAIL_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as FailMap) : {}
  } catch {
    return {}
  }
}

function writeFails(map: FailMap): void {
  try {
    localStorage.setItem(FAIL_KEY, JSON.stringify(map))
  } catch {
    /* 隐私模式下写不进去也不该阻断登录 */
  }
}

export interface LockState {
  locked: boolean
  remainMs: number
  /** 已失败次数（未锁定时用来提示「还剩 N 次」） */
  count: number
}

/** 查询某账号当前是否处于锁定状态 */
export function checkLock(key: string): LockState {
  const rec = readFails()[key]
  if (!rec) return { locked: false, remainMs: 0, count: 0 }
  const remain = rec.lockedUntil - Date.now()
  if (remain <= 0) return { locked: false, remainMs: 0, count: rec.lockedUntil ? 0 : rec.count }
  return { locked: true, remainMs: remain, count: rec.count }
}

/** 记一次失败；达到阈值即锁定 */
export function recordFail(key: string): LockState {
  const map = readFails()
  const rec = map[key] ?? { count: 0, lockedUntil: 0 }
  rec.count += 1
  if (rec.count >= MAX_FAILS) rec.lockedUntil = Date.now() + LOCK_MS
  map[key] = rec
  writeFails(map)
  const remain = rec.lockedUntil - Date.now()
  return { locked: remain > 0, remainMs: Math.max(0, remain), count: rec.count }
}

/** 登录成功后清掉失败计数 */
export function clearFail(key: string): void {
  const map = readFails()
  if (map[key]) {
    delete map[key]
    writeFails(map)
  }
}

/** 把剩余毫秒说成人话，用于「请 4 分 32 秒后再试」 */
export function remainText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const min = Math.floor(total / 60)
  const sec = total % 60
  return min > 0 ? `${min} 分 ${sec} 秒` : `${sec} 秒`
}

// ------------------------------------------------------------------ 会话

/** 会话主体：员工（users 表）还是经销商（customers 表，手机号登录） */
export type SessionKind = 'staff' | 'dealer'

interface Session {
  id: number
  kind: SessionKind
  expiresAt: number
}

/**
 * 保存会话。
 * ⚠️ 必须带 kind：改造前只存了一个裸 id，而员工与经销商是两张表，
 * 经销商的 id 一旦和某个员工的 id 撞上，刷新后就会**以那个员工的身份登录**。
 */
export function saveSession(id: number, kind: SessionKind = 'staff'): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id, kind, expiresAt: Date.now() + SESSION_MS }))
    if (kind === 'staff') localStorage.setItem(LEGACY_KEY, String(id))
  } catch {
    /* 隐私模式写不进去也不该阻断本次登录 */
  }
}

/** 读会话；返回 expired=true 表示「有登录记录但已过期」 */
export function readSession(): { id: number; kind: SessionKind; expired: boolean } | null {
  const raw = localStorage.getItem(SESSION_KEY)
  if (raw) {
    try {
      const s = JSON.parse(raw) as Session
      if (!s?.id) return null
      const kind: SessionKind = s.kind === 'dealer' ? 'dealer' : 'staff'
      if (s.expiresAt && s.expiresAt > Date.now()) return { id: s.id, kind, expired: false }
      return { id: s.id, kind, expired: true }
    } catch {
      return null
    }
  }
  // 老版本只写了员工 id：首次读到补一个 7 天会话，避免升级后把所有人踢下线
  const legacy = localStorage.getItem(LEGACY_KEY)
  if (legacy) {
    const id = Number(legacy)
    if (id) {
      saveSession(id, 'staff')
      return { id, kind: 'staff', expired: false }
    }
  }
  return null
}

/** 把会话续期到「从现在起 7 天」（活跃使用不掉线） */
export function touchSession(): void {
  const cur = readSession()
  if (cur && !cur.expired) saveSession(cur.id, cur.kind)
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(LEGACY_KEY)
    localStorage.removeItem('erp_current_dealer_id')
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ 记住账号

const REMEMBER_KEY = 'erp_remember_account'

export function saveRememberedAccount(account: string): void {
  try {
    localStorage.setItem(REMEMBER_KEY, account)
  } catch {
    /* ignore */
  }
}

export function readRememberedAccount(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? ''
  } catch {
    return ''
  }
}

export function clearRememberedAccount(): void {
  try {
    localStorage.removeItem(REMEMBER_KEY)
  } catch {
    /* ignore */
  }
}
