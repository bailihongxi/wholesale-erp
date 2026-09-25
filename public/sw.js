/**
 * Service Worker（V2.1-2.13 重写缓存策略）
 *
 * 导航请求：永远网络优先，只有网络失败才用缓存兜底
 * 静态资源：缓存优先，文件名带hash，内容不会变
 */

const BUILD_VERSION = "2.23.0";
const CACHE_NAME = 'erp-' + BUILD_VERSION;

self.addEventListener('install', () => {
  // 不自动skipWaiting：新版本SW安装后，等所有旧页面关闭，下次打开时再激活，不中途刷新页面
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
    // 不自动claim：不接管正在打开的旧页面，等下次打开时再用新版本
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.hostname.includes('supabase.co')) return;

  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req));
    return;
  }

  e.respondWith(cacheFirst(req));
});

/** 导航请求：永远网络优先，只有网络失败才用缓存 */
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const resp = await fetch(req);
    if (resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    return cached || Response.error();
  }
}

/** 静态资源：缓存优先，未命中再走网络并写入缓存 */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const resp = await fetch(req);
    if (resp && resp.ok && isCacheable(new URL(req.url))) {
      cache.put(req, resp.clone());
    }
    return resp;
  } catch (err) {
    throw err;
  }
}

function isCacheable(url) {
  if (url.pathname.endsWith('/sw.js')) return false;
  return /\.(js|mjs|css|png|jpe?g|svg|ico|webp|woff2?|ttf)$/.test(url.pathname);
}
