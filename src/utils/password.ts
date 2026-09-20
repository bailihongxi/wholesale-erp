/**
 * 密码哈希工具（第十八轮）
 *
 * 改造前密码是**明文**存进 IndexedDB 的：F12 → Application → IndexedDB → users，
 * 全员密码一览无余。这里统一改成加盐哈希：
 *
 *  - 优先走 WebCrypto 的 PBKDF2-SHA256，存储格式 `pbkdf2$<迭代>$<salt>$<hash>`
 *  - 非安全上下文（`file://` 打开 dist 时拿不到 `crypto.subtle`）降级成 `weak$…`，
 *    强度不高但至少不是明文；回到 https/localhost 后登录成功会自动升级
 *  - **老库里的明文密码照样能登录**，校验通过后由调用方重写为哈希（渐进迁移，员工无感）
 *
 * 代价要知道：哈希不可逆，**老板无法查看员工密码，只能「重置密码」生成临时密码告知**。
 */
const ALGO = 'pbkdf2'
const WEAK = 'weak'
const HASH_ALGO = 'SHA-256'
const SALT_BYTES = 16
const KEY_BITS = 256
/** 100k 迭代单次校验约 20~50ms：够挡住离线爆破，又不至于让人等登录 */
export const PASSWORD_ITERATIONS = 100_000
/** 密码最短长度（新建员工 / 改密都按这个校验） */
export const PASSWORD_MIN_LEN = 6

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(out)
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256)
  return out
}

function canUseSubtle(): boolean {
  return Boolean(globalThis.crypto?.subtle?.importKey)
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: HASH_ALGO },
    base,
    KEY_BITS
  )
  return toBase64(new Uint8Array(bits))
}

/** 拿不到 crypto.subtle 时的降级实现：djb2 反复打散，只求「不是明文」 */
function weakHash(password: string, salt: string, rounds = 1000): string {
  let h = 5381
  let seed = `${salt}:${password}`
  for (let n = 0; n < rounds; n++) {
    for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0
    seed = String(h)
  }
  return (h >>> 0).toString(16)
}

/** 判断存的是不是哈希（老数据是明文，会返回 false） */
export function isHashed(stored: string): boolean {
  return typeof stored === 'string' && (stored.startsWith(`${ALGO}$`) || stored.startsWith(`${WEAK}$`))
}

/** 生成哈希串；同一密码每次结果都不同（salt 随机） */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  if (canUseSubtle()) {
    const digest = await pbkdf2(password, salt, PASSWORD_ITERATIONS)
    return `${ALGO}$${PASSWORD_ITERATIONS}$${toBase64(salt)}$${digest}`
  }
  const saltStr = toBase64(salt)
  return `${WEAK}$1$${saltStr}$${weakHash(password, saltStr)}`
}

export interface VerifyResult {
  ok: boolean
  /** 明文或低强度老格式通过校验 → 调用方应立即重写为最新哈希 */
  needsUpgrade: boolean
}

/** 校验密码；老明文数据也能通过，并通过 needsUpgrade 提示上层做升级 */
export async function verifyPassword(password: string, stored: string): Promise<VerifyResult> {
  const value = stored ?? ''
  if (!value) return { ok: false, needsUpgrade: false }

  if (!isHashed(value)) {
    // 第十八轮之前的老数据：明文比对
    const ok = value === password
    return { ok, needsUpgrade: ok }
  }

  const [kind, iterText, saltText, expect] = value.split('$')
  if (!saltText || !expect) return { ok: false, needsUpgrade: false }

  if (kind === ALGO) {
    if (!canUseSubtle()) return { ok: false, needsUpgrade: false }
    const iterations = Number(iterText) || PASSWORD_ITERATIONS
    const actual = await pbkdf2(password, fromBase64(saltText), iterations)
    const ok = actual === expect
    return { ok, needsUpgrade: ok && iterations < PASSWORD_ITERATIONS }
  }

  if (kind === WEAK) {
    const ok = weakHash(password, saltText) === expect
    // 明明是弱格式，只要现在能跑 PBKDF2 就该升级
    return { ok, needsUpgrade: ok }
  }

  return { ok: false, needsUpgrade: false }
}

/** 去掉容易混淆的 0/O/1/l/I，便于口头转述临时密码 */
const TEMP_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateTempPassword(len = 8): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += TEMP_CHARS[bytes[i] % TEMP_CHARS.length]
  return out
}
