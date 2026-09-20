/*
 * Service Worker（第十六轮）
 * ----------------------------------------------------------------
 * 目的：让「发送到桌面」之后的图标点开就能用，即使当时没有网。
 *
 * 策略要点（都是踩过的坑，改动前先读完）：
 *  1. 导航请求（打开页面）用 network-first —— 只要联着网就拿最新的 index.html，
 *     这样发新版后用户不会一直卡在旧版；没网时才回落到缓存里的首页。
 *  2. 静态资源（带 hash 的 js/css、图标）用 stale-while-revalidate ——
 *     先给缓存的（秒开），同时在后台拉一份新的更新缓存。hash 变了就是新文件，
 *     所以不存在拿到旧内容的可能。
 *  3. 只处理同源 GET 请求。云同步的 GitHub API 是跨域的，一律放行走网络。
 *  4. 升级时缓存名 +1（CACHE），activate 里清掉旧缓存，避免磁盘越积越多。
 */
const CACHE = 'erp-shell-v5'

/** 首页兜底：装 SW 时先存一份，断网也能起界面 */
const CORE = [
  './',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // 逐个存：某一个 404 不至于让整个 SW 装不上
      Promise.all(CORE.map((url) => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

/** 判断这个响应值不值得缓存 */
function cacheable(res) {
  return res && res.status === 200 && res.type === 'basic'
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    if (cacheable(res)) cache.put(req, res.clone())
    return res
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true })
    if (hit) return hit
    const shell = await cache.match('./')
    if (shell) return shell
    throw err
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req, { ignoreSearch: true })
  const refetch = fetch(req)
    .then((res) => {
      if (cacheable(res)) cache.put(req, res.clone())
      return res
    })
    .catch(() => null)
  if (hit) {
    // 后台更新，不阻塞本次返回
    refetch.then(() => undefined).catch(() => undefined)
    return hit
  }
  const res = await refetch
  if (res) return res
  throw new Error('offline and not cached')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req))
    return
  }
  event.respondWith(staleWhileRevalidate(req))
})

/** 设置页里「立即更新」用：新 SW 已 ready，直接接管 */
self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'SKIP_WAITING') self.skipWaiting()
  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))))
  }
})
