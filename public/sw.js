/**
 * Service Worker（V2.0-12 重写）
 *
 * 目标是「打开快」与「发新版立刻可见」同时成立，所以分两类处理：
 *
 *  1. 导航请求（打开页面本身）：网络优先，但**最多等 NAV_TIMEOUT_MS**。
 *     超时或失败就立刻用上次缓存的页面壳显示，不再让用户对着白屏等网络。
 *     网络正常时拿到的仍然是最新页面，改了功能发新版本照样立刻生效。
 *
 *  2. 同域静态资源（js/css/图片/字体）：缓存优先。构建产物文件名带 hash，
 *     同一个名字的内容永远不会变，所以缓存优先是安全的，二次打开基本零等待。
 *
 * ⚠️ 旧版把页面缓存写在 `'/'` 这个键上。本应用部署在 GitHub Pages 的
 *    子路径（/wholesale-erp/），`'/'` 解析出来是站点根目录，导航请求的 URL
 *    却是 /wholesale-erp/ —— 两边对不上，缓存**永远命中不了**，
 *    断网时打不开、每次打开都要等网络。现在一律用请求自身的 URL 做键。
 */

/**
 * ⚠️ 缓存名必须带构建版本（V2.0-17 补的坑）。
 *
 * 浏览器判断「Service Worker 有没有更新」**只看 sw.js 这个文件本身的内容**。
 * V2.0-12 定下 CACHE_NAME='erp-v3' 之后，V2.0-13/14/15/16 四轮发版都只改了源码、
 * 没碰过这个文件 —— 于是浏览器认为 SW 从来没变过，**永远不触发 install/activate**，
 * activate 里那句「删掉非当前版本的缓存」也就从来没跑过。
 *
 * 结果就是老用户被永久钉在 V2.0-12 的缓存上：
 *   · 网络好（< NAV_TIMEOUT_MS）时拿到新页面，看起来是好的；
 *   · 网络一慢，navigationResponse 回退到缓存里的**旧 index.html**，
 *     旧 HTML 又引用旧的 index-xxxx.css（缓存里有），于是一直显示旧界面。
 *   GitHub Pages 在国内经常超过 1.5s —— 「改好了但我手机上还是老样子」的根因就在这里。
 *
 * 现在缓存名由 scripts/inject-sw-version.mjs 在构建后把 __BUILD_VERSION__
 * 换成 package.json 的版本号，每次发版文件内容必变 →
 * 浏览器安装新 SW → activate 清掉全部旧缓存。
 */
const BUILD_VERSION = '__BUILD_VERSION__';
const CACHE_NAME = 'erp-' + BUILD_VERSION;
const NAV_TIMEOUT_MS = 1500;

self.addEventListener('install', () => {
  // 不做 precache：构建产物文件名带 hash，首屏自己会带下来，
  // 主动预缓存反而要在安装阶段多下一份、拖慢首个页面。
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Supabase API 请求不缓存（数据要实时）
  if (url.hostname.includes('supabase.co')) return;

  if (req.mode === 'navigate') {
    e.respondWith(navigationResponse(req));
    return;
  }

  e.respondWith(cacheFirst(req));
});

/** 导航请求：网络优先 + 超时回退缓存 */
async function navigationResponse(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: true });

  const network = fetch(req)
    .then(resp => {
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => cached || Response.error());

  if (!cached) return network;

  // 有缓存兜底：和网络赛跑，网络超过 NAV_TIMEOUT_MS 就先拿旧的顶上
  return Promise.race([
    network,
    new Promise(resolve => setTimeout(() => resolve(cached), NAV_TIMEOUT_MS))
  ]);
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
    // 断网且没缓存：抛回给浏览器，让页面自己处理失败
    throw err;
  }
}

function isCacheable(url) {
  /**
   * ⚠️ sw.js 自己**永远不缓存**（V2.0-17）。
   *
   * 它是 .js，会被下面那条后缀规则一起缓存进来 —— 于是「Service Worker 有没有
   * 新版本」这件事本身就变得不可信了：检查更新时拿到的可能是自己缓存的那一份
   * 旧脚本，越更新越旧。浏览器发出的 SW 更新请求本不该经过这里，但多这层防线
   * 成本为零，能避免哪天踩到实现差异。
   */
  if (url.pathname.endsWith('/sw.js')) return false;
  return /\.(js|mjs|css|png|jpe?g|svg|ico|webp|woff2?|ttf)$/.test(url.pathname);
}
