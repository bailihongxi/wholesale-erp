/**
 * 首屏之后的「空闲任务」调度（V2.0-12）。
 *
 * 背景：以前是 `window.load` 之后固定 400ms 就开始把 40 多个路由分包全部
 * 拉一遍。首屏自己还在拉数据（云端在新加坡，往返 1~3 秒），预取一上来就
 * 跟它抢带宽和主线程，结果是「越优化越慢」。
 *
 * 现在改成：
 *   1. 等首屏网络真正安静下来（有资源请求就顺延）才开始；
 *   2. 一次只取一个分包，取完等下一次空闲再取下一个；
 *   3. 用户切到别的 App（页面不可见）时暂停，切回来再继续 —— 不白耗流量和电。
 *
 * 目标是「用户真正点菜单时直接命中缓存、不再白屏等下载」，同时绝不影响首屏。
 */

/** 空闲调度：优先 requestIdleCallback，老浏览器退回 setTimeout */
function onIdle(cb: () => void, timeout = 2000): void {
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  }).requestIdleCallback
  if (typeof ric === 'function') ric(cb, { timeout })
  else window.setTimeout(cb, 200)
}

/** 只让回调生效一次 */
function once(fn: () => void): () => void {
  let done = false
  return () => {
    if (done) return
    done = true
    fn()
  }
}

/**
 * 等「首屏网络安静」再执行。
 *
 * 用 PerformanceObserver 盯着资源请求：每来一个新请求就把定时器往后推，
 * 连续 QUIET_MS 没有新请求才认为首屏拉完了。另设 HARD_CAP_MS 兜底，
 * 免得页面持续有轮询时永远不开始。
 */
function whenNetworkQuiet(cb: () => void, quietMs = 900, hardCapMs = 4000): void {
  const run = once(cb)
  // 初始静默窗口：首屏如果没有新请求，quietMs 后就开始
  let quietTimer = window.setTimeout(run, quietMs)
  // 兜底：页面持续有请求（轮询等）时也得开始，不能永远等下去
  const hardTimer = window.setTimeout(run, hardCapMs)

  try {
    const po = new PerformanceObserver(() => {
      clearTimeout(quietTimer)
      quietTimer = window.setTimeout(run, quietMs)
    })
    // buffered: true —— 首屏已经发过的请求也算「活动」，一并作为顺延依据
    po.observe({ type: 'resource', buffered: true })
    window.setTimeout(() => po.disconnect(), hardCapMs)
  } catch {
    /* 老浏览器：只用上面两个定时器 */
  }
  void hardTimer
}

/** 预取所有懒加载路由的分包（串行、可暂停） */
function prefetchRoutes(getLoaders: () => Array<() => Promise<unknown>>): void {
  const loaders = getLoaders()
  if (!loaders.length) return

  let i = 0

  function schedule(): void {
    onIdle(step)
  }
  function step(): void {
    // 切到后台就停下，等用户切回来 —— 后台下载纯属浪费流量和电量
    if (document.visibilityState === 'hidden') {
      document.addEventListener('visibilitychange', onVisible, { once: true })
      return
    }
    const loader = loaders[i++]
    if (!loader) return
    // 成功失败都继续下一个：预取失败不该影响任何功能
    loader().then(schedule, schedule)
  }
  function onVisible(): void {
    if (document.visibilityState === 'visible') schedule()
  }

  schedule()
}

/**
 * 入口：首屏渲染完之后调用。
 * @param router 传入 router 而不是直接 import，方便测试时注入假路由
 */
export function initIdleTasks(router: {
  getRoutes: () => ReadonlyArray<{ components?: Record<string, unknown> | null }>
}): void {
  if (typeof window === 'undefined') return

  const start = (): void => {
    whenNetworkQuiet(() => {
      prefetchRoutes(() =>
        router
          .getRoutes()
          .map(r => r.components?.default ?? null)
          .filter((c): c is () => Promise<unknown> => typeof c === 'function')
      )
    })
  }

  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}
