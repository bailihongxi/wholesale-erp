/**
 * 云同步：把整库数据加密后存到 GitHub 仓库的一个文件里，
 * 任何一台设备打开同一个 GitHub Pages 网址、填同样的仓库与口令，就能拉取恢复。
 *
 * 设计要点
 *  - 存储：GitHub Contents API（GET 读取 / PUT 写入），仓库同时用于 GitHub Pages 托管页面。
 *  - 加密：PBKDF2-SHA256 派生密钥 + AES-GCM 加密，口令只有你自己知道，
 *          仓库里即便文件公开也只是一段密文。
 *  - 压缩：先 gzip 再加密，体积通常能降到 1/5 左右。
 *  - 去重：写入前比对内容指纹（明文 SHA-256），没变化就跳过上传，减少 commit 噪音。
 *  - 覆盖历史：每次上传覆盖同一个文件，不做版本堆积（仓库不会越用越大）。
 */

const CONFIG_KEY = 'erp_cloud_sync_config'
const PBKDF2_ITER = 200_000
const APP_TAG = 'wholesale-erp'

export interface SyncConfig {
  /** GitHub 用户名（或组织名） */
  owner: string
  /** 仓库名 */
  repo: string
  /** 分支，一般 main */
  branch: string
  /** 快照在仓库里的路径，如 data/erp-snapshot.json */
  path: string
  /** Personal Access Token（需要 Contents 读写权限） */
  token: string
  /** 同步口令，用于派生加密密钥，务必牢记 */
  passphrase: string
}

export interface SyncResult {
  ok: boolean
  message: string
  /** 上传时内容无变化被跳过 */
  skipped?: boolean
  /** 快照时间（云端文件的 updatedAt） */
  updatedAt?: string
  /** 快照字节数 */
  bytes?: number
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  owner: '',
  repo: '',
  branch: 'main',
  path: 'data/erp-snapshot.json',
  token: '',
  passphrase: ''
}

// ----------------------------------------------------------------- 配置存取

export function loadConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return { ...DEFAULT_SYNC_CONFIG }
    return { ...DEFAULT_SYNC_CONFIG, ...(JSON.parse(raw) as Partial<SyncConfig>) }
  } catch {
    return { ...DEFAULT_SYNC_CONFIG }
  }
}

export function saveConfig(c: SyncConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c))
}

export function clearConfig(): void {
  localStorage.removeItem(CONFIG_KEY)
}

export function validateConfig(c: SyncConfig): { ok: boolean; message: string } {
  if (!c.owner.trim()) return { ok: false, message: '请填写 GitHub 用户名' }
  if (!c.repo.trim()) return { ok: false, message: '请填写仓库名' }
  if (!c.branch.trim()) return { ok: false, message: '请填写分支名' }
  if (!c.path.trim()) return { ok: false, message: '请填写快照路径' }
  if (!c.token.trim()) return { ok: false, message: '请填写 Access Token' }
  if (!c.passphrase) return { ok: false, message: '请填写同步口令' }
  if (c.passphrase.length < 6) return { ok: false, message: '同步口令至少 6 位' }
  return { ok: true, message: '' }
}

/** GitHub Pages 访问地址 */
export function pagesUrl(c: SyncConfig): string {
  if (!c.owner || !c.repo) return ''
  return `https://${c.owner.trim()}.github.io/${c.repo.trim()}/`
}

/**
 * 如果当前页面正跑在 GitHub Pages 上，从网址反推 owner / repo，
 * 省得用户手填（username.github.io/repo 或 xxx.github.io 两种形态都覆盖）。
 */
export function guessFromLocation(): Partial<SyncConfig> {
  try {
    const host = location.hostname
    if (!host.endsWith('.github.io')) return {}
    const owner = host.replace('.github.io', '')
    const first = location.pathname.split('/').filter(Boolean)[0]
    return { owner, repo: first || '' }
  } catch {
    return {}
  }
}

// ----------------------------------------------------------------- 编码 / 摘要

function toBase64(bytes: Uint8Array): string {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode(...bytes.subarray(i, i + CH))
  }
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ----------------------------------------------------------------- 压缩

/**
 * 压缩。压不了就原样返回（zipped=false），解密时按标记决定要不要解压——
 * 老浏览器 / jsdom 没有 CompressionStream 也能正常同步，只是体积大一点。
 */
async function gzip(bytes: Uint8Array): Promise<{ bytes: Uint8Array; zipped: boolean }> {
  try {
    const CS = (globalThis as any).CompressionStream
    if (!CS || typeof Blob.prototype.stream !== 'function') return { bytes, zipped: false }
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CS('gzip'))
    const buf = await new Response(stream).arrayBuffer()
    const out = new Uint8Array(buf)
    // 压缩后反而变大（极小数据常见）就没必要压
    if (out.length >= bytes.length) return { bytes, zipped: false }
    return { bytes: out, zipped: true }
  } catch {
    return { bytes, zipped: false }
  }
}

async function gunzip(bytes: Uint8Array, zipped: boolean): Promise<Uint8Array> {
  if (!zipped) return bytes
  try {
    const DS = (globalThis as any).DecompressionStream
    if (!DS || typeof Blob.prototype.stream !== 'function') return bytes
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DS('gzip'))
    const buf = await new Response(stream).arrayBuffer()
    return new Uint8Array(buf)
  } catch {
    return bytes
  }
}

// ----------------------------------------------------------------- 加解密

/** WebCrypto 只在安全上下文可用（https 或 localhost）；非安全环境给出明确提示 */
function assertCrypto(): void {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持加密，请通过 https 或 localhost 打开系统')
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  assertCrypto()
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

interface Envelope {
  app: string
  format: string
  v: number
  /** 密文里的数据有没有经过 gzip（压不了的设备会是 false） */
  zipped: boolean
  salt: string
  iv: string
  data: string
  bytes: number
  updatedAt: string
  fingerprint: string
}

/** 明文对象 → 加密信封（会写进仓库文件的就是这个 JSON） */
export async function encryptJSON(obj: unknown, passphrase: string): Promise<Envelope> {
  const plain = JSON.stringify(obj)
  const fingerprint = await sha256Hex(plain)
  const packed = await gzip(new TextEncoder().encode(plain))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource }, key, packed.bytes as BufferSource
  )
  return {
    app: APP_TAG,
    format: packed.zipped ? 'aes-gcm+gzip' : 'aes-gcm',
    v: 1,
    zipped: packed.zipped,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(cipher)),
    bytes: packed.bytes.length,
    updatedAt: new Date().toISOString(),
    fingerprint
  }
}

/** 加密信封 → 明文对象；口令错误会抛「解密失败」 */
export async function decryptJSON(env: Envelope, passphrase: string): Promise<unknown> {
  if (!env || env.app !== APP_TAG) throw new Error('不是本系统的同步快照文件')
  if (env.v !== 1) throw new Error(`快照版本 v${env.v} 不支持，请升级系统后重试`)
  const key = await deriveKey(passphrase, fromBase64(env.salt))
  const packed = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(env.iv) as BufferSource },
    key,
    fromBase64(env.data) as BufferSource
  )
  const plain = await gunzip(new Uint8Array(packed), env.zipped === true)
  return JSON.parse(new TextDecoder().decode(plain))
}

/** 只解出指纹用于「有没有变化」比对，不用完整解密 */
export function envelopeFingerprint(env: Envelope): string {
  return env?.fingerprint ?? ''
}

// ----------------------------------------------------------------- GitHub API

function apiUrl(c: SyncConfig, query = ''): string {
  const path = c.path.trim().replace(/^\/+/, '')
  const owner = encodeURIComponent(c.owner.trim())
  const repo = encodeURIComponent(c.repo.trim())
  const ref = encodeURIComponent(c.branch.trim() || 'main')
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}${query || `?ref=${ref}`}`
}

function headers(c: SyncConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${c.token.trim()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  }
}

/** 把 GitHub 的 HTTP 状态码翻成中文人话 */
function explain(status: number, raw: string): string {
  switch (status) {
    case 401: return 'Token 无效或已过期，请重新生成后填入'
    case 403: return raw.includes('rate limit')
      ? 'GitHub 接口调用太频繁，请稍后再试'
      : '没有权限：请确认 Token 勾选了 Contents 的读写权限'
    case 404: return '仓库或路径不存在：请检查用户名、仓库名、分支是否填对'
    case 409: return '内容冲突：快照文件刚被别的设备改过，请重试一次'
    case 422: return '提交失败：请检查仓库是否为空仓库（需先有一次提交）'
    default: return `同步失败（HTTP ${status}）${raw ? '：' + raw : ''}`
  }
}

async function ghFetch(url: string, init: RequestInit): Promise<any> {
  let resp: Response
  try {
    resp = await fetch(url, init)
  } catch (e) {
    throw new Error('连不上 GitHub，请检查网络（如需代理请确认浏览器可访问 api.github.com）')
  }
  if (resp.ok) return resp.status === 204 ? null : await resp.json()
  let raw = ''
  try { raw = (await resp.json())?.message ?? '' } catch { /* 忽略非 JSON 响应 */ }
  if (resp.status === 404 && init.method === 'GET') return null // 快照还没建过，正常
  throw new Error(explain(resp.status, raw))
}

/** 测试连接：只探仓库与 Token 是否有效，不写任何文件 */
export async function checkAuth(c: SyncConfig): Promise<SyncResult> {
  const v = validateConfig(c)
  if (!v.ok) return { ok: false, message: v.message }
  try {
    const info = await ghFetch(
      `https://api.github.com/repos/${encodeURIComponent(c.owner.trim())}/${encodeURIComponent(c.repo.trim())}`,
      { method: 'GET', headers: headers(c) }
    )
    const perm = info?.permissions
    if (perm && perm.push === false) {
      return { ok: false, message: 'Token 对该仓库没有写入权限，请换一个有 Contents 读写权限的 Token' }
    }
    return { ok: true, message: `连接成功：${info?.full_name ?? c.owner + '/' + c.repo}` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/** 读取云端快照（不存在返回 null，不报错） */
export async function fetchSnapshot(c: SyncConfig): Promise<{ env: Envelope; sha: string } | null> {
  const data = await ghFetch(apiUrl(c), { method: 'GET', headers: headers(c) })
  if (!data || !data.content) return null
  const text = new TextDecoder().decode(fromBase64(data.content))
  return { env: JSON.parse(text) as Envelope, sha: data.sha }
}

/**
 * 上传快照。内容与云端一致时直接跳过，不产生多余 commit。
 * sha 传 null 表示文件还不存在（首次创建）。
 */
export async function pushSnapshot(
  c: SyncConfig,
  env: Envelope,
  sha: string | null
): Promise<SyncResult> {
  const body: Record<string, unknown> = {
    message: `erp sync ${new Date().toLocaleString('zh-CN')}`,
    content: toBase64(new TextEncoder().encode(JSON.stringify(env))),
    branch: c.branch.trim() || 'main'
  }
  if (sha) body.sha = sha
  await ghFetch(apiUrl(c, ''), { method: 'PUT', headers: headers(c), body: JSON.stringify(body) })
  return { ok: true, message: '已上传到云端', updatedAt: env.updatedAt, bytes: env.bytes }
}

// ----------------------------------------------------------------- 对外主流程

/**
 * 上传：导出 → 加密 → 与云端指纹比对 → 有变化才写入。
 * 传入的 exportFn 由 sync store 提供，避免工具层依赖 Pinia。
 */
export async function pushData(
  c: SyncConfig,
  exportFn: () => Promise<unknown>
): Promise<SyncResult> {
  const v = validateConfig(c)
  if (!v.ok) return { ok: false, message: v.message }
  try {
    const data = await exportFn()
    const env = await encryptJSON(data, c.passphrase)
    const remote = await fetchSnapshot(c)
    if (remote && envelopeFingerprint(remote.env) === env.fingerprint) {
      return {
        ok: true, skipped: true,
        message: '云端已是最新，无需上传',
        updatedAt: remote.env.updatedAt, bytes: remote.env.bytes
      }
    }
    return await pushSnapshot(c, env, remote?.sha ?? null)
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/** 拉取：读取云端 → 解密 → 交回调用方恢复 */
export async function pullData(c: SyncConfig): Promise<SyncResult & { data?: unknown }> {
  const v = validateConfig(c)
  if (!v.ok) return { ok: false, message: v.message }
  try {
    const remote = await fetchSnapshot(c)
    if (!remote) return { ok: false, message: '云端还没有快照，请先在一台设备上点击「同步到云端」' }
    const data = await decryptJSON(remote.env, c.passphrase)
    return {
      ok: true, data,
      message: '已从云端读取',
      updatedAt: remote.env.updatedAt, bytes: remote.env.bytes
    }
  } catch (e) {
    const msg = (e as Error).message
    // AES-GCM 解密失败统一说成口令错误，用户更容易理解
    if (msg.includes('decrypt') || msg.includes('operation-specific reason')) {
      return { ok: false, message: '同步口令不对，无法解密这份快照' }
    }
    return { ok: false, message: msg }
  }
}
