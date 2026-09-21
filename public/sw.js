const CACHE_NAME = 'erp-v2';
const ASSETS = ['/'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 缓存静态资源，网络回退
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.method !== 'GET') return;
  // Supabase API 请求不缓存
  if (url.hostname.includes('supabase.co')) return;

  // 打开页面的导航请求走 network-first。
  // 之前所有请求一律「缓存优先」，导致发新版后用户拿到的还是缓存里的旧首页，
  // 新功能看着像没上线。这里让页面本身永远先问网络，断网时才回退到缓存。
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put('/', clone));
          }
          return resp;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // 其余 GET 请求：缓存优先，网络回退
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        // 只缓存同域静态资源
        if (resp.ok && (url.pathname.match(/\.(js|css|png|svg|ico|woff2?)$/) || url.pathname === '/')) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return resp;
      });
    })
  );
});
